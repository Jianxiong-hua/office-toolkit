import { AppError } from "@/types";
import type {
  ExtractFramesOptions,
  ExtractFramesResult,
  FrameSink,
} from "@/types/video";
import { ffmpegInputName } from "./ffmpeg";
import { runImageSequence } from "./ffmpegSequence";

/**
 * 视频提取图片的兼容路径：ffmpeg.wasm 的 select 滤镜按帧序抽帧。
 *
 * 为什么不走 WebCodecs：非 MP4/MOV 容器（WebM/MKV/AVI）与非 H.264 编码
 * 都需要 demux + 软解，只有 ffmpeg 能做。
 *
 * 硬约束（两条，都是页面把关）：
 * - 源文件 ≤ 200MB：整份要写进 wasm 内存，再大就只剩极速模式可用
 * - 一次 exec 期间全部输出帧堆在 MEMFS，读回要等 exec 结束，所以张数也有上限
 */

/** 兼容路径单次最多导出的张数 */
export const COMPAT_MAX_FRAMES = 1000;

/**
 * 兼容路径允许的最大源文件（200MB）。
 * 超过这个体积一律不走 ffmpeg：整份写进 MEMFS 会吃掉大量堆，
 * 且这类大文件基本都是长视频，逐帧解码在浏览器里本就跑不完。
 */
export const COMPAT_MAX_FILE_SIZE = 200 * 1024 * 1024;

/**
 * 本路径单次截取时长的上限（秒）。
 * select 抽帧必须从头解码整段，而 wasm 单线程解码 1080p 只有实时速度的几十分之一，
 * 一小时级别的片段根本跑不完；按「解码成本」设限比按导出张数设限更贴合真实开销。
 */
export const COMPAT_MAX_CLIP_SEC = 600;

/** 输出文件名前缀（与 ffmpeg 的 %06d 补零位数一致） */
export const FRAME_PREFIX = "frame_";

/** JPEG 质量（0.5~1）映射到 ffmpeg mjpeg 的 qscale（2 最好、31 最差） */
function jpegQscale(quality: number): number {
  const q = Math.min(1, Math.max(0.5, quality));
  return Math.min(31, Math.max(2, Math.round(2 + (1 - q) * 28)));
}

export interface CompatHooks {
  /** 读回阶段的进度（已写入张数 / 总张数） */
  onProgress?: (done: number, total: number) => void;
  /** 解码阶段进度 0~1（exec 期间唯一的进度来源） */
  onDecodeProgress?: (ratio: number) => void;
  /** 截取段时长（秒），用于把解码时间折算成百分比 */
  clipDurationSec?: number;
}

export async function extractFramesCompat(
  file: File,
  options: ExtractFramesOptions,
  sink: FrameSink,
  /** 预估张数（0 = 未知），只用于进度分母 */
  estimatedCount: number,
  hooks: CompatHooks = {}
): Promise<ExtractFramesResult> {
  const startedAt = performance.now();
  const step = Math.max(1, Math.floor(options.everyNFrames) + 1);
  const start = Math.max(0, options.trimStart);
  const end = options.trimEnd;
  if (end !== null && end <= start) {
    throw new AppError("INVALID_INPUT", "结束时间必须晚于开始时间");
  }
  // 防御：页面已在选文件时拦下，这里再兜一次，避免超大文件被整份写进 wasm 内存
  if (file.size > COMPAT_MAX_FILE_SIZE) {
    throw new AppError(
      "FILE_TOO_LARGE",
      "兼容模式最大支持 200MB，超过请改用极速模式（H.264 编码的 MP4/MOV）",
      `${(file.size / 1024 / 1024).toFixed(1)}MB`
    );
  }

  const ext = options.format === "png" ? "png" : "jpg";
  const inputName = ffmpegInputName(file.name);

  // -y：MEMFS 里可能残留上次失败的输出，不加会因「文件已存在」直接退出
  // -ss / -t 放在 -i 之前（输入选项）
  // -vsync 0（而非新版才有的 -fps_mode）：wasm core 版本未知，-vsync 全版本可用
  // -an：图片序列不需要音轨，少解析一路
  const args: string[] = ["-y", "-ss", String(start)];
  if (end !== null) args.push("-t", String(end - start));
  args.push("-i", inputName);
  if (step > 1) {
    // select 的 mod 参数里逗号要转义，否则会被滤镜图解析成参数分隔符
    args.push("-vf", `select=not(mod(n\\,${step}))`);
  }
  args.push("-vsync", "0", "-an");
  if (options.format === "jpeg") {
    args.push("-q:v", String(jpegQscale(options.quality)));
  }
  args.push(`${FRAME_PREFIX}%06d.${ext}`);

  const { fetchFile } = await import("@ffmpeg/util");
  let totalBytes = 0;

  const count = await runImageSequence({
    inputName,
    // 兼容模式只处理 ≤200MB 的文件，直接写进 MEMFS（不走 WORKERFS 挂载）
    inputData: await fetchFile(file),
    outputPrefix: FRAME_PREFIX,
    outputExt: ext,
    args,
    expectedCount: estimatedCount,
    onFile: async (name, data) => {
      const blob = new Blob([data as BlobPart], {
        type: options.format === "png" ? "image/png" : "image/jpeg",
      });
      totalBytes += blob.size;
      // ffmpeg 的 1 起序号直接当输出序号：步进抽帧后编号仍连续
      const index = Number.parseInt(name.slice(FRAME_PREFIX.length), 10);
      await sink.save(Number.isFinite(index) ? index : 0, blob);
    },
    onProgress: hooks.onProgress,
    onDecodeProgress: hooks.onDecodeProgress,
    clipDurationSec:
      hooks.clipDurationSec ?? (end !== null ? end - start : undefined),
  });

  return {
    count,
    totalBytes,
    engine: "compat",
    folderName: "",
    elapsedMs: performance.now() - startedAt,
  };
}
