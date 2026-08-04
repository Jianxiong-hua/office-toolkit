import imageCompression, { type Options as CompressionOptions } from "browser-image-compression";
import type { ImageCompressOptions } from "@/types";
import { AppError } from "@/types";
import { compressGif, type GifColorCount } from "./compress-gif";

const defaultOptions: ImageCompressOptions = {
  quality: 80,
  format: "original",
  gifColors: 128,
};

export interface CompressImageResult {
  blob: Blob;
  originalSize: number;
  compressedSize: number;
  /** GIF 才有：尺寸、帧数、颜色数（"320×240 · 24帧 · 128色"） */
  info?: string;
}

/**
 * 压缩图片
 * - 输入是 GIF + 输出是 original/gif → 走 GIF 路径（保留动画）
 * - 其他情况 → 走 browser-image-compression 路径
 */
export async function compressImage(
  file: File,
  options: Partial<ImageCompressOptions> = {}
): Promise<CompressImageResult> {
  const opts = { ...defaultOptions, ...options };

  // ── GIF 路径 ────────────────────────────────────
  if (file.type === "image/gif") {
    // GIF 不允许转其他格式（避免职责重叠）
    if (opts.format !== "original" && opts.format !== "gif") {
      throw new AppError(
        "UNSUPPORTED_FORMAT",
        "GIF 文件仅支持输出为 GIF。如需转换为其他格式，请使用「格式转换」工具。"
      );
    }
    const result = await compressGif(file, {
      colors: (opts.gifColors ?? 128) as GifColorCount,
      maxWidth: opts.maxWidth,
      maxHeight: opts.maxHeight,
    });
    return {
      blob: result.blob,
      originalSize: result.originalSize,
      compressedSize: result.compressedSize,
      info: `${result.width}×${result.height} · ${result.frameCount}帧 · ${opts.gifColors ?? 128}色`,
    };
  }

  // ── 非 GIF 不能转 GIF ──────────────────────────
  if (opts.format === "gif") {
    throw new AppError(
      "UNSUPPORTED_FORMAT",
      "仅当输入为 GIF 时才能输出 GIF。其他格式暂不支持转换为 GIF，请使用 JPG / WebP / PNG。"
    );
  }

  // ── 标准路径（PNG/JPG/WebP/BMP）────────────────
  const originalSizeMB = file.size / 1024 / 1024;
  const qualityRatio = opts.quality / 100;
  const targetSizeMB = Math.max(0.05, originalSizeMB * qualityRatio * 0.9);

  const compressOpts: CompressionOptions = {
    maxSizeMB: targetSizeMB,
    maxWidthOrHeight: opts.maxWidth || opts.maxHeight
      ? Math.max(opts.maxWidth || 0, opts.maxHeight || 0)
      : undefined,
    initialQuality: qualityRatio,
    useWebWorker: true,
    fileType: opts.format === "original" ? undefined : `image/${opts.format}`,
  };

  const compressed = await imageCompression(file, compressOpts);

  return {
    blob: compressed,
    originalSize: file.size,
    compressedSize: compressed.size,
  };
}

export async function compressImages(
  files: File[],
  options: Partial<ImageCompressOptions> = {},
  onProgress?: (current: number, total: number) => void
): Promise<
  Array<{ blob: Blob; name: string; originalSize: number; compressedSize: number; info?: string }>
> {
  const results = [];
  for (let i = 0; i < files.length; i++) {
    const result = await compressImage(files[i], options);
    results.push({ ...result, name: files[i].name });
    onProgress?.(i + 1, files.length);
  }
  return results;
}

export function getCompressionRatio(original: number, compressed: number): number {
  if (original === 0) return 0;
  return Math.round(((original - compressed) / original) * 100);
}
