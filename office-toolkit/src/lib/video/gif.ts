import { AppError } from "@/types";
import type {
  VideoConvertPhase,
  VideoGifOptions,
  VideoGifResult,
} from "@/types/video";
import { generateOutputFilename } from "@/lib/file";
import { ffmpegInputName, runConversion } from "./ffmpeg";
import { readVideoMeta } from "./probe";

const OUTPUT_NAME = "output.gif";

export async function videoToGif(
  file: File,
  options: VideoGifOptions,
  onProgress?: (ratio: number, phase: VideoConvertPhase) => void
): Promise<VideoGifResult> {
  const meta = await readVideoMeta(file);
  const { fetchFile } = await import("@ffmpeg/util");

  const inputName = ffmpegInputName(file.name);
  const filename = generateOutputFilename(file.name, "gif", "gif");

  const start = Math.max(0, options.trimStart);
  const end = options.trimEnd ?? (meta.duration > 0 ? meta.duration : null);
  if (end !== null && end <= start) {
    throw new AppError("INVALID_INPUT", "截取结束时间必须晚于开始时间");
  }

  // 滤镜链：倍速(setpts) → 抽帧(fps) → 缩放( lanczos ) → 全局调色板(split+palettegen/paletteuse)
  // setpts 必须在 fps 之前：先压缩时间轴，再按新时间轴抽帧，倍速后帧率才正确
  const filters: string[] = [];
  if (options.speed !== 1) filters.push(`setpts=PTS/${options.speed}`);
  filters.push(`fps=${options.fps}`);
  // min(iw, W)：只缩不放，小视频不会被放大成模糊大图
  filters.push(`scale=min(iw\\,${options.width}):-2:flags=lanczos`);
  filters.push(
    `split[s0][s1];[s0]palettegen=max_colors=${options.maxColors}[p];[s1][p]paletteuse=dither=bayer`
  );

  const args: string[] = ["-ss", String(start), "-i", inputName];
  if (end !== null) args.push("-t", String(end - start));
  args.push(
    "-vf",
    filters.join(","),
    "-loop",
    options.loop === "infinite" ? "0" : "-1", // 0=无限循环，-1=播放一次
    OUTPUT_NAME
  );

  const data = await runConversion({
    inputName,
    inputData: await fetchFile(file),
    args,
    outputName: OUTPUT_NAME,
    onProgress,
  });

  // 输出宽高与帧数（信息展示用）：与 scale=min(iw,W):-2 的实际输出保持一致
  const outWidth = Math.min(options.width, meta.width);
  const outHeight = Math.max(2, Math.round((meta.height * outWidth) / meta.width / 2) * 2);
  const duration = end !== null ? end - start : meta.duration > 0 ? meta.duration - start : 0;
  const frameCount =
    duration > 0 ? Math.max(1, Math.round((duration / options.speed) * options.fps)) : 0;

  return {
    blob: new Blob([data as BlobPart], { type: "image/gif" }),
    originalSize: file.size,
    outputSize: data.byteLength,
    filename,
    width: outWidth,
    height: outHeight,
    frameCount,
  };
}
