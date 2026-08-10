import { loadImage, readFileAsDataURL } from "@/lib/file";
import { AppError } from "@/types";

export interface ResizeOptions {
  width?: number;
  height?: number;
  keepRatio?: boolean;
  mode?: "fit" | "stretch" | "cover";
  format?: "original" | "jpeg" | "png" | "webp";
  quality?: number;
}

function getOutputMimeType(
  originalType: string,
  format: ResizeOptions["format"]
): string {
  if (format && format !== "original") {
    return `image/${format}`;
  }
  return originalType || "image/png";
}

/**
 * 计算缩放后的尺寸
 *
 * 缩放一律以宽/高为准。保持宽高比时，三个输入框（宽/高/百分比）在 UI 层自动联动，
 * 百分比仅作输入与显示，实际缩放依据是联动计算出的宽/高尺寸。
 */
export function calculateResizeDimensions(
  originalWidth: number,
  originalHeight: number,
  options: ResizeOptions
): { width: number; height: number } {
  let width = originalWidth;
  let height = originalHeight;

  if (options.keepRatio !== false) {
    const ratio = originalWidth / originalHeight;

    if (options.width && options.height) {
      if (options.mode === "stretch") {
        return { width: options.width, height: options.height };
      }
      if (options.mode === "cover") {
        const scale = Math.max(options.width / originalWidth, options.height / originalHeight);
        return {
          width: Math.round(originalWidth * scale),
          height: Math.round(originalHeight * scale),
        };
      }
      // fit mode default
      const scale = Math.min(options.width / originalWidth, options.height / originalHeight);
      return {
        width: Math.round(originalWidth * scale),
        height: Math.round(originalHeight * scale),
      };
    }

    if (options.width) {
      return {
        width: options.width,
        height: Math.round(options.width / ratio),
      };
    }

    if (options.height) {
      return {
        width: Math.round(options.height * ratio),
        height: options.height,
      };
    }
  }

  if (options.width && options.height) {
    return { width: options.width, height: options.height };
  }

  return { width, height };
}

/**
 * 缩放图片
 */
export async function resizeImage(
  file: File,
  options: ResizeOptions
): Promise<{ blob: Blob; width: number; height: number }> {
  if (!file.type.startsWith("image/")) {
    throw new AppError("UNSUPPORTED_FORMAT", "请选择图片文件");
  }

  const dataUrl = await readFileAsDataURL(file);
  const img = await loadImage(dataUrl);

  const originalWidth = img.naturalWidth;
  const originalHeight = img.naturalHeight;
  const { width, height } = calculateResizeDimensions(originalWidth, originalHeight, options);

  if (width > 4096 || height > 4096) {
    throw new AppError(
      "INVALID_INPUT",
      "输出尺寸不能超过 4096×4096 像素"
    );
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new AppError("BROWSER_NOT_SUPPORTED", "当前浏览器不支持 Canvas");
  }

  if (options.format === "jpeg") {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, width, height);
  }

  ctx.drawImage(img, 0, 0, width, height);

  const mimeType = getOutputMimeType(file.type, options.format);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new AppError("PROCESS_FAILED", "图片缩放失败"));
      },
      mimeType,
      mimeType === "image/jpeg" || mimeType === "image/webp"
        ? options.quality ?? 0.92
        : undefined
    );
  });

  return { blob, width, height };
}
