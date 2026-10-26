import { AppError } from "@/types";
import type {
  VideoCompressOptions,
  VideoCompressResult,
  VideoMeta,
  VideoQualityPreset,
  VideoResolution,
} from "@/types/video";
import { generateOutputFilename } from "@/lib/file";
import { ffmpegInputName, MOUNT_THRESHOLD_BYTES, runConversion } from "./ffmpeg";
import { readVideoMeta } from "./probe";

/** x264 CRF：20 高质量 / 23 标准 / 28 强压缩 */
const X264_CRF: Record<VideoQualityPreset, number> = {
  high: 20,
  standard: 23,
  strong: 28,
};

/** VP9 CRF 视觉等效映射（VP9 量程与 x264 不同，默认 32） */
const VP9_CRF: Record<VideoQualityPreset, number> = {
  high: 30,
  standard: 33,
  strong: 40,
};

/**
 * 源码率折扣上限。CRF 只控制质量、不控制体积：对已经压过的片源
 * （流媒体 rip、网盘视频）二次编码极易「越压越大」——实测 3.0 Mbps 的 1080p
 * 片源用 crf23 + ultrafast 重编成了 10.3 Mbps。因此再用 maxrate 封顶，
 * 保证任何档位的输出码率都不超过源码率的对应比例。
 */
const SOURCE_CAP_RATIO: Record<VideoQualityPreset, number> = {
  high: 0.85,
  standard: 0.6,
  strong: 0.4,
};

const RESOLUTION_HEIGHT: Record<VideoResolution, number | null> = {
  original: null,
  "1080p": 1080,
  "720p": 720,
  "480p": 480,
};

export interface CompressCommand {
  inputName: string;
  outputName: string;
  filename: string;
  args: string[];
}

/**
 * 构建压缩命令。页面「实际执行的命令」展示与实际执行共用本函数，保证两边一致。
 * meta 需已由 readVideoMeta 读取。
 */
export function buildCompressCommand(
  file: File,
  meta: VideoMeta,
  options: VideoCompressOptions
): CompressCommand {
  const inputName = ffmpegInputName(file.name);
  const outputName = `output.${options.format}`;
  const filename = generateOutputFilename(file.name, "compressed", options.format);

  // 截取区间：end 为 null 表示到片尾（时长未知时同样到片尾）
  const start = Math.max(0, options.trimStart);
  const end = options.trimEnd ?? (meta.duration > 0 ? meta.duration : null);
  if (end !== null && end <= start) {
    throw new AppError("INVALID_INPUT", "截取结束时间必须晚于开始时间");
  }

  // -ss 与 -t 都必须放在 -i 之前（输入选项）：
  // 放在 -i 之后会变成「输出时长」，而下面的 setpts=PTS/speed 会压缩时间轴，
  // 导致实际截取范围被放大 speed 倍（选 4 秒 + 2 倍速会读 8 秒原片）
  const args: string[] = ["-ss", String(start)];
  if (end !== null) args.push("-t", String(end - start));
  args.push("-i", inputName);

  // 缩放与倍速合并进同一 -vf
  const filters: string[] = [];
  const targetH = RESOLUTION_HEIGHT[options.resolution];
  if (targetH !== null && meta.height > targetH) {
    filters.push(`scale=-2:${targetH}`);
  }
  if (options.speed !== 1) {
    filters.push(`setpts=PTS/${options.speed}`);
  }

  if (options.format === "mp4") {
    args.push(
      "-c:v",
      "libx264",
      "-crf",
      String(X264_CRF[options.quality]),
      "-preset",
      options.preset,
      "-pix_fmt",
      "yuv420p"
    );
    // CRF + maxrate：质量仍按 CRF 自适应，但码率封顶到源码率的对应比例，
    // 避免对已压缩片源二次编码后比原文件还大
    if (meta.duration > 0) {
      const sourceBps = (file.size * 8) / meta.duration - 128_000;
      if (sourceBps > 0) {
        const maxrate = Math.round(sourceBps * SOURCE_CAP_RATIO[options.quality]);
        args.push("-maxrate", String(maxrate), "-bufsize", String(maxrate * 2));
      }
    }
  } else {
    args.push(
      "-c:v",
      "libvpx-vp9",
      "-crf",
      String(VP9_CRF[options.quality]),
      "-b:v",
      "0",
      "-deadline",
      "good",
      "-cpu-used",
      "2"
    );
  }
  if (filters.length > 0) args.push("-vf", filters.join(","));
  // 音频：MP4 用 AAC，WebM 只能用 Opus（AAC 进 WebM 会直接报错）
  // 不加 -movflags +faststart：它会让 ffmpeg 在编码结束后重写整个输出文件，
  // 收尾阶段白等十几秒；下载到本地的文件不需要「边下边播」的 moov 前置
  if (options.format === "mp4") {
    args.push("-c:a", "aac", "-b:a", "128k");
  } else {
    args.push("-c:a", "libopus", "-b:a", "128k");
  }
  if (options.speed !== 1) args.push("-af", `atempo=${options.speed}`);

  args.push(outputName);

  return { inputName, outputName, filename, args };
}

export async function compressVideo(
  file: File,
  options: VideoCompressOptions,
  onProgress?: (ratio: number) => void
): Promise<VideoCompressResult> {
  const startedAt = performance.now();
  const meta = await readVideoMeta(file);
  const { fetchFile } = await import("@ffmpeg/util");

  const { inputName, outputName, filename, args } = buildCompressCommand(
    file,
    meta,
    options
  );

  // 与 buildCompressCommand 同口径的截取区间：用于进度分母与「同长度对比」
  const trimStart = Math.max(0, options.trimStart);
  const trimEnd = options.trimEnd ?? (meta.duration > 0 ? meta.duration : null);
  const segmentDuration =
    trimEnd !== null ? Math.max(0, trimEnd - trimStart) : 0;

  const data = await runConversion({
    inputName,
    // >200MB 走 WORKERFS 挂载，整个文件不进 wasm 内存
    ...(file.size > MOUNT_THRESHOLD_BYTES
      ? { inputFile: file }
      : { inputData: await fetchFile(file) }),
    args,
    outputName,
    // core-mt 在本环境实测不可用：多线程下解码阶段卡死（GIF 与视频压缩均如此），
    // 单线程是已知可用路径
    forceSingleThread: true,
    debugLog: true,
    // 分母是「输出时长」：progress 的 time 是 out_time（输出时间轴），
    // 变速后输出时长 = 片段时长 / 倍速
    expectedDurationSec:
      segmentDuration > 0 ? segmentDuration / options.speed : undefined,
    onProgress,
  });

  return {
    blob: new Blob([data as BlobPart], {
      type: options.format === "mp4" ? "video/mp4" : "video/webm",
    }),
    originalSize: file.size,
    outputSize: data.byteLength,
    filename,
    elapsedMs: performance.now() - startedAt,
    // 输出时长占完整时长的比例：结果面板据此按「同长度」比较体积。
    // 必须按倍速折算——变速本身就会让时长短一截，不能把它算进「压缩节省」
    segmentRatio:
      meta.duration > 0 && segmentDuration > 0
        ? segmentDuration / options.speed / meta.duration
        : 1,
  };
}
