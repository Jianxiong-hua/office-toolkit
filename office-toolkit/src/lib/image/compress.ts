import imageCompression, { type Options as CompressionOptions } from "browser-image-compression";
import type { ImageCompressOptions } from "@/types";

const defaultOptions: ImageCompressOptions = {
  quality: 80,
  format: "original",
};

export async function compressImage(
  file: File,
  options: Partial<ImageCompressOptions> = {}
): Promise<{ blob: Blob; originalSize: number; compressedSize: number }> {
  const opts = { ...defaultOptions, ...options };

  const originalSizeMB = file.size / 1024 / 1024;
  // 根据质量等级设置目标大小上限
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
  Array<{ blob: Blob; name: string; originalSize: number; compressedSize: number }>
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
