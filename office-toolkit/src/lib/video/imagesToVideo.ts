import { AppError } from "@/types";
import type {
  ImagesOutputSize,
  ImagesToVideoOptions,
  ImagesVideoQuality,
  ImagesToVideoResult,
} from "@/types/video";
import {
  ArrayBufferTarget,
  FileSystemWritableFileStreamTarget,
  Muxer,
} from "mp4-muxer";
import { pickAvcCodec } from "./fastCompress";

/**
 * 图片序列 → MP4(H.264)：VideoEncoder 逐帧编码 + mp4-muxer 封装。
 *
 * 输出路径两条：
 * - 传入可写流（Chromium 的「另存为」）：FileSystemWritableFileStreamTarget 边编边写盘，内存 O(1)
 * - 不传：ArrayBufferTarget 全内存，产出 Blob 交给常规下载（有总时长上限，由页面把关）
 *
 * 约束：浏览器需支持 WebCodecs 的 VideoEncoder（Chrome/Edge 94+、Safari 16.4+、Firefox 130+）；
 * H.264 要求宽高为偶数，这里统一向上取偶。
 */

/** 输出高度档位（original = 以第一张图为准） */
const RESOLUTION_HEIGHT: Record<ImagesOutputSize, number | null> = {
  original: null,
  "1080p": 1080,
  "720p": 720,
  "480p": 480,
};

/**
 * 每帧码率系数（bits per pixel per frame）。
 * 静态画面虽然帧间差异小，但**第一眼看到的仍是每一帧的细节**，
 * 给低码率（早期取 0.025，1080p30 仅 1.55 Mbps）会明显糊。
 *
 * - 极高 0.25：接近视觉无损（1080p30 约 15.5 Mbps），体积大，适合成片要留档
 * - 高 0.12：默认（1080p30 约 7.5 Mbps），与「视频压缩」高质量档同级
 * - 标准 0.06 / 小体积 0.03：以体积为先
 */
const BPP_BY_QUALITY: Record<ImagesVideoQuality, number> = {
  veryhigh: 0.25,
  high: 0.12,
  standard: 0.06,
  small: 0.03,
};
const MIN_BITRATE = 800_000;
/** 4K30 在 0.25 bpp 下要约 62 Mbps，上限必须留足，否则「极高」档会被悄悄截断 */
const MAX_BITRATE = 80_000_000;

/** 目标码率（bps）：页面预估与实际编码共用同一套计算，避免显示与实编码不一致 */
export function targetBitrate(
  width: number,
  height: number,
  fps: number,
  quality: ImagesVideoQuality
): number {
  const bpp = BPP_BY_QUALITY[quality] ?? BPP_BY_QUALITY.high;
  return Math.min(
    MAX_BITRATE,
    Math.max(MIN_BITRATE, Math.round(bpp * width * height * fps))
  );
}

/** 编码队列背压：4K 位图单张约 33MB，不设限会把整段帧压进内存 */
const ENCODE_QUEUE_LIMIT = 8;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 偶数对齐（H.264 要求），最小 2 */
const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);

let cancelReject: ((reason: unknown) => void) | null = null;

/** 取消当前合成 */
export function cancelImagesToVideo(): void {
  cancelReject?.(new AppError("CANCELLED", "已取消合成"));
}

/** 浏览器是否支持本功能 */
export function isImagesToVideoSupported(): boolean {
  return (
    typeof VideoEncoder !== "undefined" &&
    typeof VideoFrame !== "undefined" &&
    typeof OffscreenCanvas !== "undefined"
  );
}

/** 每张图占多少帧 */
export function framesPerImage(options: ImagesToVideoOptions): number {
  if (options.mode === "frame") return 1;
  return Math.max(1, Math.round(options.secondsPerImage * options.fps));
}

/**
 * 合成视频。
 * `stream` 由调用方通过 `pickSaveFileStream` 打开并负责最终的 close / abort。
 */
export async function imagesToVideo(
  files: File[],
  options: ImagesToVideoOptions,
  onProgress?: (done: number, total: number) => void,
  stream?: FileSystemWritableFileStream
): Promise<ImagesToVideoResult> {
  if (!isImagesToVideoSupported()) {
    throw new AppError(
      "BROWSER_NOT_SUPPORTED",
      "当前浏览器不支持视频编码，请使用 Chrome / Edge / Safari 16.4+ / Firefox 130+",
      "VideoEncoder 不可用"
    );
  }
  if (files.length === 0) {
    throw new AppError("INVALID_INPUT", "请先添加图片");
  }

  const startedAt = performance.now();
  const fps = Math.min(60, Math.max(1, Math.round(options.fps)));
  const perImage = framesPerImage({ ...options, fps });
  const totalFrames = files.length * perImage;
  const frameDurUs = Math.round(1e6 / fps);

  let cancelled = false;
  let encoder: VideoEncoder | null = null;
  let failed: Error | null = null;

  const cancelPromise = new Promise<never>((_, reject) => {
    cancelReject = (reason: unknown) => {
      cancelled = true;
      try {
        encoder?.close();
      } catch {
        /* 已关闭 */
      }
      reject(reason);
    };
  });
  const guard = <T>(p: Promise<T>): Promise<T> =>
    Promise.race([p, cancelPromise]) as Promise<T>;

  /** 首张图定输出尺寸 */
  let first: ImageBitmap | null = null;
  try {
    first = await guard(createImageBitmap(files[0]));
    const targetH = RESOLUTION_HEIGHT[options.size];
    const outW = even(
      targetH ? (first.width * targetH) / first.height : first.width
    );
    const outH = even(targetH ?? first.height);

    const canvas = new OffscreenCanvas(outW, outH);
    const ctx = canvas.getContext("2d", { alpha: false })!;

    /** 把一张位图按适配方式画满画布（黑边居中 / 居中裁切，画布外的部分自动被裁掉） */
    const draw = (bmp: ImageBitmap) => {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, outW, outH);
      const scale =
        options.fit === "cover"
          ? Math.max(outW / bmp.width, outH / bmp.height)
          : Math.min(outW / bmp.width, outH / bmp.height);
      const dw = bmp.width * scale;
      const dh = bmp.height * scale;
      ctx.drawImage(bmp, (outW - dw) / 2, (outH - dh) / 2, dw, dh);
    };

    /* ---------- muxer ---------- */

    const videoTrack = { codec: "avc" as const, width: outW, height: outH };
    const muxer = stream
      ? new Muxer({
          target: new FileSystemWritableFileStreamTarget(stream, {
            chunkSize: 8 * 1024 * 1024,
          }),
          video: videoTrack,
          // moov 置尾：写入保持顺序，才能边编边写盘
          fastStart: false,
        })
      : new Muxer({
          target: new ArrayBufferTarget(),
          video: videoTrack,
          fastStart: false,
        });

    /* ---------- encoder ---------- */

    const codec = pickAvcCodec(outH);
    const bitrate = targetBitrate(outW, outH, fps, options.quality);
    const baseConfig: VideoEncoderConfig = {
      codec,
      width: outW,
      height: outH,
      bitrate,
      framerate: fps,
      latencyMode: "quality",
    };

    let hw: HardwareAcceleration = "prefer-hardware";
    let support = await VideoEncoder.isConfigSupported({
      ...baseConfig,
      hardwareAcceleration: hw,
    });
    if (!support.supported) {
      hw = "no-preference";
      support = await VideoEncoder.isConfigSupported({
        ...baseConfig,
        hardwareAcceleration: hw,
      });
    }
    if (!support.supported) {
      throw new AppError(
        "BROWSER_NOT_SUPPORTED",
        `当前浏览器无法编码 ${outW}×${outH} 的 H.264 视频，请改小输出尺寸`,
        codec
      );
    }
    // 目标码率 × 时长：实际体积受场景切换密度影响（每帧都是关键帧时会超出 20~40%），
    // 所以给区间而不是单值
    const predictedBytes = (bitrate * (totalFrames / fps)) / 8;
    const mb = (v: number) => (v / 1024 / 1024).toFixed(1);
    console.info(
      `[imagesToVideo] encoder: ${codec} ${outW}x${outH} ` +
        `${(bitrate / 1e6).toFixed(2)}Mbps fps=${fps} hw=${hw} ` +
        `图=${files.length} 帧=${totalFrames} 时长=${(totalFrames / fps).toFixed(1)}s ` +
        `预计体积≈${mb(predictedBytes)}~${mb(predictedBytes * 1.4)}MB`
    );

    encoder = new VideoEncoder({
      output: (chunk, meta) => {
        try {
          muxer.addVideoChunk(chunk, meta);
        } catch (e) {
          failed =
            e instanceof AppError
              ? e
              : new AppError("PROCESS_FAILED", "封装视频失败", String(e));
        }
      },
      error: (e) => {
        console.error("[imagesToVideo] 编码器错误:", e);
        failed = new AppError(
          "PROCESS_FAILED",
          "编码失败，请降低输出尺寸或缩短时长",
          e instanceof Error ? e.message : String(e)
        );
      },
    });
    await encoder.configure({ ...baseConfig, hardwareAcceleration: hw });

    /* ---------- 逐图逐帧编码 ---------- */

    let frameIndex = 0;
    let bmp: ImageBitmap | null = first;
    for (let i = 0; i < files.length; i++) {
      if (cancelled || failed) break;
      if (i > 0) {
        bmp = await guard(createImageBitmap(files[i]));
      }
      try {
        draw(bmp!);
        for (let k = 0; k < perImage; k++) {
          while (encoder.encodeQueueSize > ENCODE_QUEUE_LIMIT) {
            await guard(sleep(4));
          }
          if (cancelled || failed) break;
          const frame = new VideoFrame(canvas, {
            timestamp: Math.round((frameIndex * 1e6) / fps),
            duration: frameDurUs,
          });
          try {
            encoder.encode(frame);
          } finally {
            frame.close();
          }
          frameIndex++;
          onProgress?.(frameIndex, totalFrames);
        }
      } finally {
        // 第一张的位图由 first 持有，循环结束后统一释放
        if (i > 0) bmp?.close();
      }
    }

    if (cancelled) throw new AppError("CANCELLED", "已取消合成");
    if (failed) throw failed;

    await guard(encoder.flush());
    if (failed) throw failed;
    muxer.finalize();

    const blob = stream
      ? undefined
      : new Blob([(muxer.target as ArrayBufferTarget).buffer], {
          type: "video/mp4",
        });

    const dot = files[0].name.lastIndexOf(".");
    const stem = dot > 0 ? files[0].name.slice(0, dot) : files[0].name;

    console.info(
      `[imagesToVideo] 完成：${frameIndex} 帧 / ${(frameIndex / fps).toFixed(1)} 秒，` +
        `耗时 ${((performance.now() - startedAt) / 1000).toFixed(1)} 秒`
    );

    return {
      blob,
      filename: `${stem}.mp4`,
      width: outW,
      height: outH,
      frameCount: frameIndex,
      durationSec: frameIndex / fps,
      elapsedMs: performance.now() - startedAt,
      bitrate,
      savedToDisk: !!stream,
    };
  } finally {
    cancelReject = null;
    try {
      first?.close();
    } catch {
      /* 已关闭 */
    }
    try {
      encoder?.close();
    } catch {
      /* 已关闭 */
    }
  }
}
