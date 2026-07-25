import { loadImage, readFileAsDataURL } from "@/lib/file";
import { AppError } from "@/types";

export interface DpiOptions {
  dpi: number; // target DPI
  keepPixels?: boolean; // if true, keep original pixels, only simulate DPI change
  format?: "original" | "jpeg" | "png" | "webp";
  quality?: number;
}

function getOutputMimeType(
  originalType: string,
  format: DpiOptions["format"]
): string {
  if (format && format !== "original") {
    return `image/${format}`;
  }
  return originalType || "image/png";
}

/**
 * 修改图片 DPI（等效像素调整）
 *
 * 注意：Web 浏览器无法直接修改图片 EXIF 中的 DPI 信息。
 * 这里按照 "像素 = DPI × 英寸" 的公式，根据目标 DPI 和原始打印尺寸重新计算像素。
 */
export async function changeImageDpi(
  file: File,
  options: DpiOptions
): Promise<{
  blob: Blob;
  width: number;
  height: number;
  printWidth: number; // inches
  printHeight: number; // inches
}> {
  if (!file.type.startsWith("image/")) {
    throw new AppError("UNSUPPORTED_FORMAT", "请选择图片文件");
  }

  if (options.dpi < 1 || options.dpi > 2400) {
    throw new AppError("INVALID_INPUT", "DPI 值必须在 1-2400 之间");
  }

  const dataUrl = await readFileAsDataURL(file);
  const img = await loadImage(dataUrl);

  const originalWidth = img.naturalWidth;
  const originalHeight = img.naturalHeight;

  let outputWidth = originalWidth;
  let outputHeight = originalHeight;

  if (!options.keepPixels) {
    // 假设默认原图为 72 DPI，计算打印尺寸后再按目标 DPI 重算像素
    const originalDpi = 72;
    const printWidth = originalWidth / originalDpi;
    const printHeight = originalHeight / originalDpi;

    outputWidth = Math.round(printWidth * options.dpi);
    outputHeight = Math.round(printHeight * options.dpi);
  }

  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new AppError("BROWSER_NOT_SUPPORTED", "当前浏览器不支持 Canvas");
  }

  if (options.format === "jpeg") {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, outputWidth, outputHeight);
  }

  ctx.drawImage(img, 0, 0, outputWidth, outputHeight);

  const mimeType = getOutputMimeType(file.type, options.format ?? "original");
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new AppError("PROCESS_FAILED", "DPI 调整失败"));
      },
      mimeType,
      mimeType === "image/jpeg" || mimeType === "image/webp"
        ? options.quality ?? 0.92
        : undefined
    );
  });

  return {
    blob,
    width: outputWidth,
    height: outputHeight,
    printWidth: outputWidth / options.dpi,
    printHeight: outputHeight / options.dpi,
  };
}
