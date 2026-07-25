import { loadImage, readFileAsDataURL } from "@/lib/file";
import { AppError } from "@/types";

export type ImageOutputFormat = "jpeg" | "png" | "webp" | "bmp";

function getMimeType(format: ImageOutputFormat): string {
  switch (format) {
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "bmp":
      return "image/bmp";
    default:
      return "image/png";
  }
}

function getExtension(format: ImageOutputFormat): string {
  return format === "jpeg" ? "jpg" : format;
}

/**
 * 转换图片格式
 */
export async function convertImage(
  file: File,
  targetFormat: ImageOutputFormat,
  quality = 0.92
): Promise<{ blob: Blob; ext: string }> {
  if (!file.type.startsWith("image/")) {
    throw new AppError("UNSUPPORTED_FORMAT", "请选择图片文件");
  }

  const dataUrl = await readFileAsDataURL(file);
  const img = await loadImage(dataUrl);

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new AppError("BROWSER_NOT_SUPPORTED", "当前浏览器不支持 Canvas");
  }

  // JPG 不支持透明，填充白色背景
  if (targetFormat === "jpeg") {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.drawImage(img, 0, 0);

  const mimeType = getMimeType(targetFormat);
  if (!canvas.toDataURL(mimeType).startsWith(`data:${mimeType}`)) {
    throw new AppError(
      "BROWSER_NOT_SUPPORTED",
      `当前浏览器不支持输出 ${targetFormat.toUpperCase()} 格式`
    );
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new AppError("PROCESS_FAILED", "图片转换失败"));
      },
      mimeType,
      targetFormat === "jpeg" || targetFormat === "webp" ? quality : undefined
    );
  });

  return { blob, ext: getExtension(targetFormat) };
}

/**
 * 批量转换图片格式
 */
export async function convertImages(
  files: File[],
  targetFormat: ImageOutputFormat,
  quality = 0.92,
  onProgress?: (current: number, total: number) => void
): Promise<Array<{ blob: Blob; name: string; ext: string }>> {
  const results = [];
  for (let i = 0; i < files.length; i++) {
    const { blob, ext } = await convertImage(files[i], targetFormat, quality);
    results.push({ blob, name: files[i].name, ext });
    onProgress?.(i + 1, files.length);
  }
  return results;
}
