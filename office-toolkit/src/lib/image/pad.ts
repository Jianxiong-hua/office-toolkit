import { loadImage, readFileAsDataURL } from "@/lib/file";
import { AppError } from "@/types";

export type PadMode = "fit-center" | "stretch" | "original-center";
export type PadOutputFormat = "png" | "jpeg" | "webp" | "original";

export interface PadOptions {
  width: number;
  height: number;
  mode?: PadMode;
  backgroundColor?: string; // hex like #ffffff or transparent
  padding?: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
  format?: PadOutputFormat;
  quality?: number;
}

function hexToRgba(hex: string): { r: number; g: number; b: number; a: number } {
  if (hex === "transparent") {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return { r, g, b, a: 1 };
}

function getOutputMimeType(
  originalType: string,
  format: PadOutputFormat
): string {
  if (format && format !== "original") {
    return `image/${format}`;
  }
  return originalType || "image/png";
}

/**
 * 给图片添加背景填充 / Padding
 */
export async function padImage(
  file: File,
  options: PadOptions
): Promise<{ blob: Blob; width: number; height: number }> {
  if (!file.type.startsWith("image/")) {
    throw new AppError("UNSUPPORTED_FORMAT", "请选择图片文件");
  }

  const dataUrl = await readFileAsDataURL(file);
  const img = await loadImage(dataUrl);

  const canvas = document.createElement("canvas");
  canvas.width = options.width;
  canvas.height = options.height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new AppError("BROWSER_NOT_SUPPORTED", "当前浏览器不支持 Canvas");
  }

  const bg = hexToRgba(options.backgroundColor ?? "#FFFFFF");
  const isTransparent = bg.a === 0;
  const outputFormat = isTransparent ? "png" : options.format ?? "original";

  ctx.fillStyle = isTransparent
    ? "rgba(0,0,0,0)"
    : `rgba(${bg.r},${bg.g},${bg.b},${bg.a})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const paddingLeft = options.padding?.left ?? 0;
  const paddingRight = options.padding?.right ?? 0;
  const paddingTop = options.padding?.top ?? 0;
  const paddingBottom = options.padding?.bottom ?? 0;

  const availableWidth = canvas.width - paddingLeft - paddingRight;
  const availableHeight = canvas.height - paddingTop - paddingBottom;

  let drawWidth = img.naturalWidth;
  let drawHeight = img.naturalHeight;

  if (options.mode === "stretch") {
    drawWidth = availableWidth;
    drawHeight = availableHeight;
  } else if (options.mode === "fit-center") {
    const scale = Math.min(
      availableWidth / img.naturalWidth,
      availableHeight / img.naturalHeight
    );
    drawWidth = img.naturalWidth * scale;
    drawHeight = img.naturalHeight * scale;
  } else if (options.mode === "original-center") {
    drawWidth = Math.min(img.naturalWidth, availableWidth);
    drawHeight = Math.min(img.naturalHeight, availableHeight);
  }

  const x = paddingLeft + (availableWidth - drawWidth) / 2;
  const y = paddingTop + (availableHeight - drawHeight) / 2;

  ctx.drawImage(img, x, y, drawWidth, drawHeight);

  const mimeType = getOutputMimeType(file.type, outputFormat);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new AppError("PROCESS_FAILED", "图片填充失败"));
      },
      mimeType,
      mimeType === "image/jpeg" || mimeType === "image/webp"
        ? options.quality ?? 0.92
        : undefined
    );
  });

  return { blob, width: canvas.width, height: canvas.height };
}

/**
 * 常用画布尺寸预设
 */
export const padPresets = [
  { name: "1 寸证件照", width: 295, height: 413 },
  { name: "2 寸证件照", width: 413, height: 626 },
  { name: "小红书封面", width: 1242, height: 1660 },
  { name: "微信公众号封面", width: 900, height: 383 },
  { name: "Instagram 方形", width: 1080, height: 1080 },
];
