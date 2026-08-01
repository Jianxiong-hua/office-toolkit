import { loadImage, readFileAsDataURL } from "@/lib/file";
import { AppError } from "@/types";

export type PadMode = "pixels" | "canvas-offset";
export type PadOutputFormat = "png" | "jpeg" | "webp" | "original";

/**
 * 4 边像素扩展参数
 */
export interface PaddingPixels {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * 画布 + 偏移扩展参数
 */
export interface CanvasOffset {
  width: number;   // 扩展后画布宽度
  height: number;  // 扩展后画布高度
  dx: number;      // 水平偏移（正值向右，可为负）
  dy: number;      // 垂直偏移（正值向下，可为负）
}

export interface PadOptions {
  mode: PadMode;
  backgroundColor?: string; // hex like #ffffff or "transparent"
  pixels?: PaddingPixels;
  canvasOffset?: CanvasOffset;
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
 * 计算 padding 模式下的最终参数
 * 返回 { canvasWidth, canvasHeight, drawX, drawY } 供绘制使用
 */
function calculatePadLayout(
  originalWidth: number,
  originalHeight: number,
  options: PadOptions
): { canvasWidth: number; canvasHeight: number; drawX: number; drawY: number } {
  if (options.mode === "pixels") {
    const p = options.pixels;
    if (!p) {
      throw new AppError("INVALID_INPUT", "缺少 4 边像素参数");
    }
    if (p.top < 0 || p.right < 0 || p.bottom < 0 || p.left < 0) {
      throw new AppError("INVALID_INPUT", "4 边像素数必须 ≥ 0");
    }
    return {
      canvasWidth: originalWidth + p.left + p.right,
      canvasHeight: originalHeight + p.top + p.bottom,
      drawX: p.left,
      drawY: p.top,
    };
  } else if (options.mode === "canvas-offset") {
    const c = options.canvasOffset;
    if (!c) {
      throw new AppError("INVALID_INPUT", "缺少画布参数");
    }
    if (c.width < originalWidth || c.height < originalHeight) {
      throw new AppError(
        "INVALID_INPUT",
        `画布尺寸（${c.width}×${c.height}）必须 ≥ 原图尺寸（${originalWidth}×${originalHeight}）`
      );
    }
    // 居中 + 偏移，自动 clamp 保证 drawX/drawY ≥ 0
    const baseX = (c.width - originalWidth) / 2;
    const baseY = (c.height - originalHeight) / 2;
    const drawX = Math.max(0, Math.min(c.width - originalWidth, baseX + c.dx));
    const drawY = Math.max(0, Math.min(c.height - originalHeight, baseY + c.dy));
    return {
      canvasWidth: c.width,
      canvasHeight: c.height,
      drawX,
      drawY,
    };
  }
  throw new AppError("INVALID_INPUT", `不支持的扩展模式：${options.mode}`);
}

/**
 * 给图片添加扩展画布（Padding）
 * 不缩放原图，原图 1:1 放置在扩展后画布上
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

  const layout = calculatePadLayout(img.naturalWidth, img.naturalHeight, options);

  const canvas = document.createElement("canvas");
  canvas.width = layout.canvasWidth;
  canvas.height = layout.canvasHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new AppError("BROWSER_NOT_SUPPORTED", "当前浏览器不支持 Canvas");
  }

  const bg = hexToRgba(options.backgroundColor ?? "#FFFFFF");
  const isTransparent = bg.a === 0;
  const outputFormat = isTransparent ? "png" : options.format ?? "original";

  // 填充背景
  ctx.fillStyle = isTransparent
    ? "rgba(0,0,0,0)"
    : `rgba(${bg.r},${bg.g},${bg.b},${bg.a})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 1:1 绘制原图
  ctx.drawImage(img, layout.drawX, layout.drawY, img.naturalWidth, img.naturalHeight);

  const mimeType = getOutputMimeType(file.type, outputFormat);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new AppError("PROCESS_FAILED", "图片扩展失败"));
      },
      mimeType,
      mimeType === "image/jpeg" || mimeType === "image/webp"
        ? options.quality ?? 0.92
        : undefined
    );
  });

  return { blob, width: canvas.width, height: canvas.height };
}
