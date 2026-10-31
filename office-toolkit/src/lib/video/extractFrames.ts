import { AppError } from "@/types";
import type {
  ExtractFramesOptions,
  ExtractFramesResult,
  FrameSink,
} from "@/types/video";
import { createFile, MP4BoxBuffer, type ISOFile, type Sample } from "mp4box";
import {
  extractAvcCDescription,
  isRotated,
  rotationTransform,
} from "./fastCompress";

/**
 * 视频提取图片的快路径：mp4box 跳读 moov → VideoDecoder 解码
 *   → 按「每隔 N 帧」步进 → canvas 旋转烘焙 → convertToBlob → 交给调用方落盘
 *
 * 解码骨架与 fastGif.ts 同源（都刻意与 fastCompress 保持小份重复，
 * 避免动已稳定跑通的三条编码流水线）。差别只在本文件不缩放、不编码 GIF。
 *
 * 约束：输入必须是 MP4/MOV(ISO-BMFF) + H.264；不满足时抛错，由页面回退 ffmpeg 路径。
 */

/** 解码队列背压阈值 */
const DECODE_QUEUE_LIMIT = 12;
/** 单批读取/解码的样本数上限 */
const SAMPLE_BATCH = 64;
/** 单次随机读取的字节上限 */
const READ_CHUNK_BYTES = 4 * 1024 * 1024;

/** 解码端偏好软解：硬解帧是 GPU 纹理，drawImage 到 CPU 侧要额外回读（实测 16.5ms vs 0.4ms） */
const DECODE_ACCELERATION: HardwareAcceleration = "prefer-software";

let cancelReject: ((reason: unknown) => void) | null = null;

/** 取消当前提取 */
export function cancelExtractFrames(): void {
  cancelReject?.(new AppError("CANCELLED", "已取消提取"));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** H.264 的两种 sample entry：avc1（参数集在 avcC 盒）/ avc3（参数集在码流里） */
function isH264Codec(codec: string | undefined): boolean {
  return !!codec && (codec.startsWith("avc1") || codec.startsWith("avc3"));
}

/** 快路径是否可能适用（粗筛；codec 校验在解析后做） */
export function isFastExtractCandidate(file: File): boolean {
  if (typeof VideoDecoder === "undefined") return false;
  const dot = file.name.lastIndexOf(".");
  const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  return ext === "mp4" || ext === "m4v" || ext === "mov";
}

type TrackInfo = Parameters<NonNullable<ISOFile["onReady"]>>[0];

/** 只读 moov：先喂文件头，再按顶层 box 顺序跳过 mdat */
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
          "无法解析该 MP4/MOV 文件",
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

/** 取一批样本并一次性读完它们的字节 */
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

/** 快路径视频信息：总帧数、平均帧率、每帧展示时间（秒） */
export interface FastVideoInfo {
  totalFrames: number;
  fps: number;
  /** 升序展示时间（秒），用于精确预估某个截取区间会导出多少张 */
  times: Float64Array;
}

/**
 * 读取 MP4/MOV 的帧统计（只解析 moov，不读样本数据）。
 * 页面用它做导出前的张数预警；也能顺带判断是否真的能走快路径。
 */
export async function readFastVideoInfo(file: File): Promise<FastVideoInfo> {
  const identity = <T>(p: Promise<T>): Promise<T> => p;
  const { mp4file, info } = await parseMp4(file, identity);
  const track = info.videoTracks[0];
  if (!track?.video) {
    throw new AppError("UNSUPPORTED_FORMAT", "文件中没有视频轨");
  }
  // avc1 与 avc3 都是 H.264：avc3 的参数集在码流里（in-band），构造解码配置时不传 description
  if (!isH264Codec(track.codec)) {
    throw new AppError(
      "UNSUPPORTED_FORMAT",
      `仅支持 H.264 编码的视频（检测到 ${track.codec}）`
    );
  }
  const samples = mp4file.getTrackSamplesInfo(track.id) ?? [];
  const times = new Float64Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    times[i] = samples[i].cts / samples[i].timescale;
  }
  const duration = times.length > 0 ? times[times.length - 1] : 0;
  return {
    totalFrames: samples.length,
    fps: duration > 0 ? samples.length / duration : 0,
    times,
  };
}

/** 截取区间 [start, end] 内共有多少帧（end=null 表示到片尾） */
export function countFramesInRange(
  info: FastVideoInfo,
  start: number,
  end: number | null
): number {
  let n = 0;
  for (let i = 0; i < info.times.length; i++) {
    const t = info.times[i];
    if (t < start) continue;
    if (end !== null && t > end) break;
    n++;
  }
  return n;
}

export async function extractFramesFast(
  file: File,
  options: ExtractFramesOptions,
  sink: FrameSink,
  onProgress?: (saved: number, estimatedTotal: number) => void,
  /** 导出前的精确预估总张数（页面用 countFramesInRange 算好传入，仅用于进度分母） */
  estimatedTotal = 0
): Promise<ExtractFramesResult> {
  if (typeof VideoDecoder === "undefined") {
    throw new AppError(
      "BROWSER_NOT_SUPPORTED",
      "当前浏览器不支持 WebCodecs",
      "需要 Chrome/Edge 94+、Safari 16.4+ 或 Firefox 130+"
    );
  }

  const startedAt = performance.now();
  const step = Math.max(1, Math.floor(options.everyNFrames) + 1);
  const mime = options.format === "png" ? "image/png" : "image/jpeg";
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
    console.error("[extractFrames] 提取失败:", e);
    failed =
      e instanceof AppError
        ? e
        : e instanceof Error
          ? new AppError("PROCESS_FAILED", "提取失败", e.message)
          : new AppError("PROCESS_FAILED", "提取失败", String(e));
  };

  try {
    const { mp4file, info } = await parseMp4(file, guard);
    if (cancelled) throw new AppError("CANCELLED", "已取消提取");

    const track = info.videoTracks[0];
    if (!track?.video) {
      throw new AppError("UNSUPPORTED_FORMAT", "文件中没有视频轨");
    }
    if (!isH264Codec(track.codec)) {
      throw new AppError(
        "UNSUPPORTED_FORMAT",
        `仅支持 H.264 编码的视频（检测到 ${track.codec}）`
      );
    }

    const samples = mp4file.getTrackSamplesInfo(track.id) ?? [];
    if (samples.length === 0) {
      throw new AppError("PROCESS_FAILED", "无法读取视频帧信息");
    }

    /* ---------- 截取区间（与 ffmpeg 路径同口径） ---------- */

    const startSec = Math.max(0, options.trimStart);
    const endSec = options.trimEnd;

    let lastCtsSec = 0;
    for (const s of samples) {
      const t = s.cts / s.timescale;
      if (t > lastCtsSec) lastCtsSec = t;
    }
    if (startSec > 0 && lastCtsSec < startSec) {
      throw new AppError(
        "INVALID_INPUT",
        `起点（${startSec.toFixed(1)} 秒）已超出视频长度（${lastCtsSec.toFixed(1)} 秒），请调整时间`
      );
    }

    // 起点必须落在关键帧上；整表扫完（B 帧下 cts 会跳到后面，不能提前 break）
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
        // 多解一个 GOP，保证末端 B 帧的参考链完整（多余帧按时间戳丢弃）
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

    const startTsUs = startSec * 1e6;
    const endTsUs = endSec !== null ? endSec * 1e6 : Number.POSITIVE_INFINITY;

    /* ---------- 画面准备 ---------- */

    const trackMatrix = track.matrix ? Array.from(track.matrix) : null;
    const sourceRotated = isRotated(trackMatrix);
    const canvas = new OffscreenCanvas(2, 2);
    // 不开 willReadFrequently：只做 draw + convertToBlob（编码），无需频繁回读
    const ctx = canvas.getContext("2d", { alpha: false })!;

    let outW = 0;
    let outH = 0;
    let codedW = 0;
    let codedH = 0;
    /** 区间内已解出的帧序（0 起）：命中步进才导出 */
    let rangeIndex = -1;
    let saved = 0;
    let totalBytes = 0;
    let pending: Promise<void> = Promise.resolve();

    const ensureSize = (frame: VideoFrame) => {
      codedW = frame.displayWidth || frame.codedWidth;
      codedH = frame.displayHeight || frame.codedHeight;
      outW = sourceRotated ? codedH : codedW;
      outH = sourceRotated ? codedW : codedH;
      canvas.width = outW;
      canvas.height = outH;
      console.info(
        `[extractFrames] 画面=${codedW}x${codedH} rotated=${sourceRotated} 输出=${outW}x${outH} 步进=${step}`
      );
    };

    /** 分阶段累计耗时（ms）：draw / 编码(convertToBlob) / 写盘(sink) */
    const cost = { draw: 0, encode: 0, write: 0, frames: 0 };

    /** 导出当前帧（draw → blob → sink）。sink 串行执行，避免并发写满内存 */
    const exportFrame = async (frame: VideoFrame): Promise<void> => {
      const t0 = performance.now();
      ctx.save();
      if (sourceRotated) {
        const t = rotationTransform(trackMatrix!, codedW, codedH, outW, outH);
        ctx.setTransform(t[0], t[1], t[2], t[3], t[4], t[5]);
        ctx.drawImage(frame, 0, 0, codedW, codedH);
      } else {
        ctx.drawImage(frame, 0, 0, codedW, codedH);
      }
      ctx.restore();
      const t1 = performance.now();

      const blob = await canvas.convertToBlob({
        type: mime,
        ...(options.format === "jpeg" ? { quality: options.quality } : {}),
      });
      const t2 = performance.now();

      await sink.save(saved + 1, blob);
      const t3 = performance.now();

      saved++;
      totalBytes += blob.size;
      onProgress?.(saved, estimatedTotal);

      cost.draw += t1 - t0;
      cost.encode += t2 - t1;
      cost.write += t3 - t2;
      cost.frames++;

      // 每 50 张打一次：累计均速 + 最近 50 张的分阶段均值，用于定位瓶颈
      if (saved % 50 === 0) {
        const avg = (v: number) => (v / cost.frames).toFixed(0);
        console.info(
          `[extractFrames] 已导出 ${saved} 张，均 ${((performance.now() - startedAt) / saved).toFixed(1)} ms/张` +
            `｜近 ${cost.frames} 张：draw=${avg(cost.draw)} encode=${avg(cost.encode)} write=${avg(cost.write)} ms`
        );
        cost.draw = cost.encode = cost.write = 0;
        cost.frames = 0;
      }
    };

    decoder = new VideoDecoder({
      output: (frame) => {
        if (cancelled || failed) {
          frame.close();
          return;
        }
        try {
          // 起点之前的帧（含起点所在关键帧的前置帧）不进输出；1ms 容差吸收时间戳取整误差
          if (
            frame.timestamp < startTsUs - 1000 ||
            frame.timestamp > endTsUs
          ) {
            frame.close();
            return;
          }
          rangeIndex++;
          if (rangeIndex % step !== 0) {
            frame.close();
            return;
          }
          if (outW === 0) ensureSize(frame);
          // sink 是异步的（写盘/压缩），用链式 promise 串行化：
          // 保证顺序、不堆内存，且 VideoFrame 必须等 draw 完才能 close
          pending = pending
            .then(() => exportFrame(frame))
            .catch(fail)
            .finally(() => frame.close());
        } catch (e) {
          frame.close();
          fail(e);
        }
      },
      error: (e) => {
        console.error("[extractFrames] 解码器错误:", e);
        fail(
          new AppError(
            "PROCESS_FAILED",
            "解码失败",
            `${e instanceof Error ? e.message : String(e)} codec=${track.codec}`
          )
        );
      },
    });

    // avc3 的参数集在码流里，传 description 反而会让解码器用错配置
    const description = track.codec.startsWith("avc1")
      ? extractAvcCDescription(mp4file.getTrackById(track.id))
      : null;
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
        `当前浏览器无法解码该视频（${track.codec}）`
      );
    }
    await decoder.configure({ ...decCfg, hardwareAcceleration: decHw });

    /* ---------- 送帧 ---------- */

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
            timestamp: Math.round((s.cts / s.timescale) * 1e6),
            duration: Math.max(
              1,
              Math.round(((s.duration || 0) / s.timescale) * 1e6)
            ),
            data: got.bytes.subarray(off, off + s.size),
          })
        );
      }
    }

    if (cancelled) throw new AppError("CANCELLED", "已取消提取");
    if (failed) throw failed;

    while (decoder.decodeQueueSize > 0 && !failed && !cancelled) {
      await guard(sleep(10));
    }
    await guard(decoder.flush());
    if (failed) throw failed;
    // 等最后几张的写盘完成
    await guard(pending);
    if (cancelled) throw new AppError("CANCELLED", "已取消提取");
    if (saved === 0) {
      throw new AppError(
        "PROCESS_FAILED",
        "没有产出任何图片，请调整起止时间或检查文件"
      );
    }

    return {
      count: saved,
      totalBytes,
      engine: "fast",
      folderName: "",
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
