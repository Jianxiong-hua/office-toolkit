import { AppError } from "@/types";
import type {
  VideoCompressOptions,
  VideoCompressResult,
  VideoMeta,
  VideoQualityPreset,
  VideoResolution,
} from "@/types/video";
import { generateOutputFilename } from "@/lib/file";
import { ffmpegInputName, runConversion } from "./ffmpeg";
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

  const args: string[] = ["-ss", String(start), "-i", inputName];
  if (end !== null) args.push("-t", String(end - start));

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
  if (options.format === "mp4") {
    args.push("-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart");
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
  const meta = await readVideoMeta(file);
  const { fetchFile } = await import("@ffmpeg/util");

  const { inputName, outputName, filename, args } = buildCompressCommand(
    file,
    meta,
    options
  );

  const data = await runConversion({
    inputName,
    inputData: await fetchFile(file),
    args,
    outputName,
    onProgress,
  });

  return {
    blob: new Blob([data as BlobPart], {
      type: options.format === "mp4" ? "video/mp4" : "video/webm",
    }),
    originalSize: file.size,
    outputSize: data.byteLength,
    filename,
  };
}
