import { AppError } from "@/types";
import type {
  VideoConvertPhase,
  VideoGifOptions,
  VideoGifResult,
} from "@/types/video";
import { generateOutputFilename } from "@/lib/file";
import { createFile, MP4BoxBuffer, type ISOFile, type Sample } from "mp4box";
import { GIFEncoder, applyPalette, quantize, type Palette } from "gifenc";
import {
  extractAvcCDescription,
  isRotated,
  rotationTransform,
} from "./fastCompress";

/**
 * 视频转 GIF 的极速路径：WebCodecs 硬件解码 + gifenc 编码
 * mp4box 跳读 moov/样本表 → VideoDecoder 解码 → OffscreenCanvas 缩放/旋转
 *   → 按 fps 抽帧 → 每帧独立调色板量化 → GIFEncoder 流式写入
 *
 * 与 ffmpeg 路径的差异：调色板是每帧独立（而非全片全局），
 * 好处是单遍解码、内存 O(1)；代价是体积可能略大、极端画面有轻微帧间色闪。
 *
 * 约束：输入必须是 MP4/MOV(ISO-BMFF) + H.264；不满足时抛错，由页面提示关闭极速模式。
 */

/** 解码队列背压阈值：避免把整片帧压在解码器里 */
const DECODE_QUEUE_LIMIT = 12;
/** 单批读取/解码的样本数上限 */
const SAMPLE_BATCH = 64;
/** 单次随机读取的字节上限 */
const READ_CHUNK_BYTES = 4 * 1024 * 1024;
/**
 * 调色板复用间隔（帧）：每 N 帧重新量化一次，其余帧复用上次的调色板。
 * quantize 是绝对瓶颈（约为 applyPalette+LZW 的 7 倍），而 8 帧之后
 * 收益已趋饱和（16 帧 → 30 帧总耗时只再降约 7%），故取 16（15fps 约 1 秒）
 */
const PALETTE_REUSE_FRAMES = 16;

/**
 * 解码端的硬件加速偏好。
 * GIF 路径每帧都要 getImageData 回读像素，硬解帧（GPU 纹理）落到 CPU 位图
 * 要额外一次回读，实测 drawImage 约 16.5ms/帧。软解把帧直接留在内存里，
 * 理论上省掉这次回读——代价是软解本身更慢，需实测净收益（A/B 结论见设计文档）。
 */
const DECODE_ACCELERATION: HardwareAcceleration = "prefer-software";

let cancelReject: ((reason: unknown) => void) | null = null;

/** 取消当前极速 GIF 转换 */
export function cancelFastGif(): void {
  cancelReject?.(new AppError("CANCELLED", "已取消转换"));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 极速模式是否可能适用（粗筛；H.264 校验在解析后做） */
export function isFastGifCandidate(file: File): boolean {
  if (typeof VideoDecoder === "undefined") return false;
  const dot = file.name.lastIndexOf(".");
  const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  return ext === "mp4" || ext === "m4v" || ext === "mov";
}

type TrackInfo = Parameters<NonNullable<ISOFile["onReady"]>>[0];

/** 只读 moov：先喂文件头，再按顶层 box 顺序跳过 mdat，避免把整个文件读进内存 */
async function parseMp4(
  file: File,
  guard: <T>(p: Promise<T>) => Promise<T>
): Promise<{ mp4file: ISOFile; info: TrackInfo }> {
  const mp4file: ISOFile = createFile(false);
  let readyFired = false;

  const info = await new Promise<TrackInfo>((resolve, reject) => {
    mp4file.onError = (e) =>
      reject(
        new AppError(
          "UNSUPPORTED_FORMAT",
          "极速模式仅支持 MP4/MOV 文件，请关闭「极速模式」",
          String(e)
        )
      );
    mp4file.onReady = (i) => {
      readyFired = true;
      resolve(i);
    };

    void (async () => {
      try {
        const headBytes = Math.min(256 * 1024, file.size);
        const head = await guard(file.slice(0, headBytes).arrayBuffer());
        mp4file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(head, 0));

        let pos = 0;
        while (!readyFired && pos < file.size) {
          const hdr = await guard(file.slice(pos, pos + 16).arrayBuffer());
          if (hdr.byteLength < 8) break;
          const dv = new DataView(hdr);
          let size = dv.getUint32(0);
          const type = String.fromCharCode(...new Uint8Array(hdr, 4, 4));
          if (size === 1) {
            if (hdr.byteLength < 16) break;
            size = Number(dv.getBigUint64(8));
          } else if (size === 0) {
            size = file.size - pos;
          }
          if (size < 8) break;
          // moov 已被文件头完整覆盖时不必重读
          if (type === "moov" && pos + size > headBytes) {
            const moov = await guard(file.slice(pos, pos + size).arrayBuffer());
            mp4file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(moov, pos));
          }
          pos += size;
        }
        if (!readyFired) mp4file.flush();
      } catch (e) {
        reject(
          e instanceof AppError
            ? e
            : new AppError("PROCESS_FAILED", "文件读取失败", String(e))
        );
      }
    })();
  });

  return { mp4file, info };
}

/** 取一批样本并一次性读完它们的字节（同轨样本通常连续存放） */
async function readSampleBatch(
  file: File,
  guard: <T>(p: Promise<T>) => Promise<T>,
  table: Sample[],
  fromIdx: number,
  toIdx: number
) {
  const batch: Sample[] = [];
  let start = Number.POSITIVE_INFINITY;
  let end = 0;
  let idx = fromIdx;
  while (idx < toIdx && idx < table.length && batch.length < SAMPLE_BATCH) {
    const s = table[idx];
    const newStart = Math.min(start, s.offset);
    const newEnd = Math.max(end, s.offset + s.size);
    if (batch.length > 0 && newEnd - newStart > READ_CHUNK_BYTES) break;
    batch.push(s);
    start = newStart;
    end = newEnd;
    idx++;
  }
  if (batch.length === 0) return { samples: batch, bytes: null, start, nextIdx: idx };
  const bytes = new Uint8Array(await guard(file.slice(start, end).arrayBuffer()));
  return { samples: batch, bytes, start, nextIdx: idx };
}

/** 偶数对齐（GIF 尺寸与缩放都按偶数算，避免半像素抖动） */
const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);

export async function fastGifVideo(
  file: File,
  options: VideoGifOptions,
  onProgress?: (ratio: number, phase: VideoConvertPhase) => void,
  /** 源视频时长（秒，来自页面 readVideoMeta；0/undefined = 未知，此时按样本表推算） */
  sourceDurationSec?: number
): Promise<VideoGifResult> {
  if (typeof VideoDecoder === "undefined") {
    throw new AppError(
      "BROWSER_NOT_SUPPORTED",
      "当前浏览器不支持 WebCodecs，请关闭「极速模式」",
      "需要 Chrome/Edge 94+、Safari 16.4+ 或 Firefox 130+"
    );
  }

  const startedAt = performance.now();
  let cancelled = false;
  let decoder: VideoDecoder | null = null;
  let failed: Error | null = null;

  const cancelPromise = new Promise<never>((_, reject) => {
    cancelReject = (reason: unknown) => {
      cancelled = true;
      try {
        decoder?.close();
      } catch {
        /* 已关闭 */
      }
      reject(reason);
    };
  });
  const guard = <T>(p: Promise<T>): Promise<T> =>
    Promise.race([p, cancelPromise]) as Promise<T>;

  const fail = (e: unknown) => {
    if (failed) return;
    console.error("[fastGif] 转换失败:", e);
    failed =
      e instanceof AppError
        ? e
        : e instanceof Error
          ? new AppError("PROCESS_FAILED", "极速模式转换失败", e.message)
          : new AppError("PROCESS_FAILED", "极速模式转换失败", String(e));
  };

  try {
    onProgress?.(0, "analyzing");
    const { mp4file, info } = await parseMp4(file, guard);
    if (cancelled) throw new AppError("CANCELLED", "已取消转换");

    const track = info.videoTracks[0];
    if (!track?.video) {
      throw new AppError(
        "UNSUPPORTED_FORMAT",
        "极速模式未找到视频轨，请关闭「极速模式」"
      );
    }
    if (!track.codec.startsWith("avc1")) {
      throw new AppError(
        "UNSUPPORTED_FORMAT",
        `极速模式仅支持 H.264 编码的视频（检测到 ${track.codec}），请关闭「极速模式」`
      );
    }

    const samples = mp4file.getTrackSamplesInfo(track.id) ?? [];
    if (samples.length === 0) {
      throw new AppError(
        "PROCESS_FAILED",
        "极速模式无法读取视频帧信息，请关闭「极速模式」"
      );
    }

    /* ---------- 截取区间（与 ffmpeg 路径同口径） ---------- */

    const startSec = Math.max(0, options.trimStart);
    const endSec = options.trimEnd;
    const speed = options.speed;

    let lastCtsSec = 0;
    for (const s of samples) {
      const t = s.cts / s.timescale;
      if (t > lastCtsSec) lastCtsSec = t;
    }
    if (startSec > 0 && lastCtsSec < startSec) {
      throw new AppError(
        "INVALID_INPUT",
        `截取起点（${startSec.toFixed(1)} 秒）已超出视频长度（${lastCtsSec.toFixed(1)} 秒），请调整时间`
      );
    }

    // 起点必须是关键帧；整表扫完（B 帧下 cts 会跳到后面，不能提前 break）
    let fromIdx = 0;
    if (startSec > 0) {
      let lastKey = 0;
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        if (s.is_sync && s.cts / s.timescale <= startSec) lastKey = i;
      }
      fromIdx = lastKey;
    }
    let toIdx = samples.length;
    if (endSec !== null) {
      let last = -1;
      for (let i = 0; i < samples.length; i++) {
        if (samples[i].cts / samples[i].timescale <= endSec) last = i;
      }
      if (last < 0) {
        toIdx = 0;
      } else {
        // 多解一个 GOP，保证截取末端 B 帧的参考链完整（多余帧按时间戳丢弃）
        toIdx = last + 1;
        for (let i = last + 1; i < samples.length; i++) {
          toIdx = i + 1;
          if (samples[i].is_sync) break;
        }
      }
    }
    if (toIdx <= fromIdx) {
      throw new AppError(
        "INVALID_INPUT",
        "截取区间内没有可用的视频帧，请调整起止时间"
      );
    }

    // 输出末帧时间戳上限（us）：截取终点之后多解的 GOP 丢弃
    const endTsUs =
      endSec !== null ? Math.round(((endSec - startSec) / speed) * 1e6) : Infinity;

    /* ---------- 进度估算 ---------- */

    const trimDuration =
      endSec !== null
        ? endSec - startSec
        : sourceDurationSec && sourceDurationSec > startSec
          ? sourceDurationSec - startSec
          : lastCtsSec - startSec;
    const estimatedTotalFrames = Math.max(
      1,
      Math.round((trimDuration / speed) * options.fps)
    );
    // GIF 帧延时单位是 10ms，取最近档；fps>100 时兜底 10ms
    const delayMs = Math.max(10, Math.round(1000 / options.fps / 10) * 10);

    /* ---------- 解码器 ---------- */

    const trackMatrix = track.matrix ? Array.from(track.matrix) : null;
    const sourceRotated = isRotated(trackMatrix);
    const canvas = new OffscreenCanvas(2, 2);
    // 刻意不开 willReadFrequently：配上软件解码后帧本就在内存里，
    // 走 GPU 后端的 getImageData 反而更快（实测 read 3.3ms vs 7.5ms/帧）
    const ctx = canvas.getContext("2d", { alpha: false })!;
    const encoder = GIFEncoder();

    /** 各阶段累计耗时（ms），每 200 帧打印一次均值，便于定位瓶颈 */
    const cost = { draw: 0, read: 0, quant: 0, apply: 0, lzw: 0 };
    let costFrames = 0;
    const reportCost = () => {
      if (costFrames === 0) return;
      const avg = (v: number) => (v / costFrames).toFixed(1);
      console.info(
        `[fastGif] 近 ${costFrames} 帧均值(ms)：draw=${avg(cost.draw)} ` +
          `read=${avg(cost.read)} quantize=${avg(cost.quant)} ` +
          `apply=${avg(cost.apply)} lzw=${avg(cost.lzw)}`
      );
      cost.draw = cost.read = cost.quant = cost.apply = cost.lzw = 0;
      costFrames = 0;
    };

    let outW = 0;
    let outH = 0;
    let codedW = 0;
    let codedH = 0;
    let frameCount = 0;
    /** 当前复用的调色板（每 PALETTE_REUSE_FRAMES 帧重算一次） */
    let palette: Palette | null = null;
    /** 抽帧网格游标：同一网格内只保留第一帧 */
    let lastGrid = -1;
    const gridUs = 1e6 / options.fps;

    /** 首帧确定输出尺寸（SPS 裁切后的显示尺寸才是准的） */
    const ensureSize = (frame: VideoFrame) => {
      const fw = frame.displayWidth || frame.codedWidth;
      const fh = frame.displayHeight || frame.codedHeight;
      codedW = fw;
      codedH = fh;
      const dispW = sourceRotated ? fh : fw;
      const dispH = sourceRotated ? fw : fh;
      // 只缩不放，宽度不超过用户设定
      const targetW = Math.min(options.width, dispW);
      outW = even(targetW);
      outH = even((dispH * targetW) / dispW);
      canvas.width = outW;
      canvas.height = outH;
      console.info(
        `[fastGif] 首帧: 画面=${fw}x${fh} rotated=${sourceRotated} 输出=${outW}x${outH} delay=${delayMs}ms`
      );
    };

    const encodeFrame = (frame: VideoFrame) => {
      const t0 = performance.now();
      ctx.save();
      if (sourceRotated) {
        // 旋转矩阵同时完成旋转与缩放
        const t = rotationTransform(
          trackMatrix!,
          codedW,
          codedH,
          outW,
          outH
        );
        ctx.setTransform(t[0], t[1], t[2], t[3], t[4], t[5]);
        ctx.drawImage(frame, 0, 0, codedW, codedH);
      } else {
        ctx.drawImage(frame, 0, 0, codedW, codedH, 0, 0, outW, outH);
      }
      ctx.restore();
      const t1 = performance.now();

      const rgba = ctx.getImageData(0, 0, outW, outH).data;
      const t2 = performance.now();

      // 每 PALETTE_REUSE_FRAMES 帧重算一次调色板，其余帧复用它：
      // quantize 是瓶颈（约为 applyPalette+LZW 的 7 倍），复用后总耗时降到约 1/3
      if (!palette || frameCount % PALETTE_REUSE_FRAMES === 0) {
        palette = quantize(rgba, options.maxColors, { format: "rgb444" });
      }
      const t3 = performance.now();

      const index = applyPalette(rgba, palette, "rgb444");
      const t4 = performance.now();

      const first = frameCount === 0;
      encoder.writeFrame(index, outW, outH, {
        palette,
        delay: delayMs,
        ...(first && options.loop === "infinite" ? { repeat: 0 } : {}),
      });
      const t5 = performance.now();

      cost.draw += t1 - t0;
      cost.read += t2 - t1;
      cost.quant += t3 - t2;
      cost.apply += t4 - t3;
      cost.lzw += t5 - t4;
      costFrames++;
      if (frameCount > 0 && frameCount % 200 === 0) reportCost();
      frameCount++;
    };

    decoder = new VideoDecoder({
      output: (frame) => {
        if (cancelled || failed) {
          frame.close();
          return;
        }
        try {
          // 截取起点的关键帧可能早于起点（时间戳为负），不进输出
          if (frame.timestamp < 0 || frame.timestamp > endTsUs) return;
          // 按目标 fps 抽帧：落在同一 1/fps 网格里的后续帧丢弃
          const grid = Math.round(frame.timestamp / gridUs);
          if (grid <= lastGrid) return;
          lastGrid = grid;
          if (outW === 0) ensureSize(frame);
          encodeFrame(frame);
          onProgress?.(
            Math.min(0.95, frameCount / estimatedTotalFrames),
            "encoding"
          );
        } catch (e) {
          fail(e);
        } finally {
          frame.close();
        }
      },
      error: (e) => {
        console.error("[fastGif] 解码器错误:", e);
        fail(
          new AppError(
            "PROCESS_FAILED",
            "极速模式解码失败，请关闭「极速模式」后重试",
            `${e instanceof Error ? e.message : String(e)} codec=${track.codec}`
          )
        );
      },
    });

    // 解码配置：description 取 stsd 的 avcC；不给 codedWidth/codedHeight，
    // 让解码器从 SPS 推导（sample entry 的宽高可能是显示尺寸）
    const description = extractAvcCDescription(mp4file.getTrackById(track.id));
    const decCfg = {
      codec: track.codec,
      ...(description ? { description } : {}),
    };
    let decHw: HardwareAcceleration = DECODE_ACCELERATION;
    let support = await VideoDecoder.isConfigSupported({
      ...decCfg,
      hardwareAcceleration: decHw,
    });
    if (!support.supported) {
      decHw = "no-preference";
      support = await VideoDecoder.isConfigSupported({
        ...decCfg,
        hardwareAcceleration: decHw,
      });
    }
    if (!support.supported) {
      throw new AppError(
        "BROWSER_NOT_SUPPORTED",
        `当前浏览器无法解码该视频（${track.codec}），请关闭「极速模式」`
      );
    }
    console.info(`[fastGif] decoder: ${track.codec} hw=${decHw}`);
    await decoder.configure({ ...decCfg, hardwareAcceleration: decHw });

    /* ---------- 送帧：按样本随机读 → 解码 ---------- */

    let idx = fromIdx;
    while (idx < toIdx && !cancelled && !failed) {
      const got = await readSampleBatch(file, guard, samples, idx, toIdx);
      if (!got.bytes || got.samples.length === 0) break;
      idx = got.nextIdx;

      while (decoder.decodeQueueSize > DECODE_QUEUE_LIMIT) {
        await guard(sleep(4));
        if (cancelled || failed) break;
      }
      if (cancelled || failed) break;

      for (const s of got.samples) {
        const off = s.offset - got.start;
        decoder.decode(
          new EncodedVideoChunk({
            type: s.is_sync ? "key" : "delta",
            // 输出时间轴：减去起点并压缩掉 speed
            timestamp: Math.round(((s.cts / s.timescale - startSec) / speed) * 1e6),
            duration: Math.max(
              1,
              Math.round(((s.duration || 0) / s.timescale / speed) * 1e6)
            ),
            data: got.bytes.subarray(off, off + s.size),
          })
        );
      }
    }

    if (cancelled) throw new AppError("CANCELLED", "已取消转换");
    if (failed) throw failed;

    // 排空解码队列并 flush：剩余帧在 output 回调里编码
    while (decoder.decodeQueueSize > 0 && !failed && !cancelled) {
      await guard(sleep(10));
    }
    await guard(decoder.flush());
    if (failed) throw failed;
    if (frameCount === 0) {
      throw new AppError(
        "PROCESS_FAILED",
        "极速模式没有产出任何帧，请调整起止时间或关闭「极速模式」"
      );
    }

    onProgress?.(1, "writing");
    reportCost();
    const totalMs = performance.now() - startedAt;
    console.info(
      `[fastGif] 总耗时 ${(totalMs / 1000).toFixed(1)} 秒，${frameCount} 帧，` +
        `平均 ${(totalMs / frameCount).toFixed(1)} ms/帧`
    );
    encoder.finish();
    const bytes = encoder.bytes();

    return {
      blob: new Blob([bytes as BlobPart], { type: "image/gif" }),
      originalSize: file.size,
      outputSize: bytes.byteLength,
      filename: generateOutputFilename(file.name, "gif", "gif"),
      width: outW,
      height: outH,
      frameCount,
      elapsedMs: performance.now() - startedAt,
    };
  } finally {
    cancelReject = null;
    try {
      decoder?.close();
    } catch {
      /* 已关闭 */
    }
  }
}
