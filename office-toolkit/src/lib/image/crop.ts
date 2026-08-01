import { loadImage, readFileAsDataURL } from "@/lib/file";
import { AppError } from "@/types";

export type CropOutputFormat = "original" | "jpeg" | "png" | "webp";

export interface CropArea {
  x: number; // pixels
  y: number; // pixels
  width: number; // pixels
  height: number; // pixels
}

export interface CropOptions {
  crop: CropArea;
  rotation?: 0 | 90 | 180 | 270;
  flipX?: boolean;
  flipY?: boolean;
  format?: CropOutputFormat;
  quality?: number;
}

function getOutputMimeType(
  originalType: string,
  format: CropOutputFormat
): string {
  if (format && format !== "original") {
    return `image/${format}`;
  }
  return originalType || "image/png";
}

/**
 * 裁剪图片
 */
export async function cropImage(
  file: File,
  options: CropOptions
): Promise<{ blob: Blob; width: number; height: number }> {
  if (!file.type.startsWith("image/")) {
    throw new AppError("UNSUPPORTED_FORMAT", "请选择图片文件");
  }

  const { crop, rotation = 0, flipX, flipY } = options;

  if (crop.width <= 0 || crop.height <= 0) {
    throw new AppError("INVALID_INPUT", "裁剪区域尺寸必须大于 0");
  }

  const dataUrl = await readFileAsDataURL(file);
  const img = await loadImage(dataUrl);

  const isRotated90 = rotation === 90 || rotation === 270;
  const outputWidth = isRotated90 ? crop.height : crop.width;
  const outputHeight = isRotated90 ? crop.width : crop.height;

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

  ctx.save();
  ctx.translate(outputWidth / 2, outputHeight / 2);

  if (rotation) {
    ctx.rotate((rotation * Math.PI) / 180);
  }
  if (flipX) {
    ctx.scale(-1, 1);
  }
  if (flipY) {
    ctx.scale(1, -1);
  }

  const drawWidth = isRotated90 ? outputHeight : outputWidth;
  const drawHeight = isRotated90 ? outputWidth : outputHeight;

  ctx.drawImage(
    img,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    -drawWidth / 2,
    -drawHeight / 2,
    drawWidth,
    drawHeight
  );

  ctx.restore();

  const mimeType = getOutputMimeType(file.type, options.format ?? "original");
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new AppError("PROCESS_FAILED", "图片裁剪失败"));
      },
      mimeType,
      mimeType === "image/jpeg" || mimeType === "image/webp"
        ? options.quality ?? 0.92
        : undefined
    );
  });

  return { blob, width: outputWidth, height: outputHeight };
}

/**
 * 计算固定比例下的裁剪区域
 */
export function calculateCropAreaForAspectRatio(
  imageWidth: number,
  imageHeight: number,
  aspectRatio: number
): CropArea {
  let width = imageWidth;
  let height = imageWidth / aspectRatio;

  if (height > imageHeight) {
    height = imageHeight;
    width = imageHeight * aspectRatio;
  }

  return {
    x: Math.round((imageWidth - width) / 2),
    y: Math.round((imageHeight - height) / 2),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/**
 * 参数化裁剪：按左上角坐标 + 宽高裁剪原图（无旋转、无翻转）
 * 用于"图片参数化裁剪"工具：用户输入 (x1, y1, x2, y2) 精确指定裁剪区域
 */
export interface CropByRegionOptions {
  x: number;       // 裁剪区域左上角 x
  y: number;       // 裁剪区域左上角 y
  width: number;   // 裁剪区域宽度
  height: number;  // 裁剪区域高度
  format?: CropOutputFormat;
  quality?: number;
}

export async function cropImageByRegion(
  file: File,
  options: CropByRegionOptions
): Promise<{ blob: Blob; width: number; height: number }> {
  if (!file.type.startsWith("image/")) {
    throw new AppError("UNSUPPORTED_FORMAT", "请选择图片文件");
  }

  const { x, y, width, height } = options;
  if (width <= 0 || height <= 0) {
    throw new AppError("INVALID_INPUT", "裁剪区域尺寸必须大于 0");
  }

  const dataUrl = await readFileAsDataURL(file);
  const img = await loadImage(dataUrl);

  // 边界校验
  if (x < 0 || y < 0 || x + width > img.naturalWidth || y + height > img.naturalHeight) {
    throw new AppError(
      "INVALID_INPUT",
      `裁剪区域超出图片边界（图片尺寸：${img.naturalWidth}×${img.naturalHeight}）`
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

  // 直接从原图提取目标区域
  ctx.drawImage(img, x, y, width, height, 0, 0, width, height);

  const mimeType = getOutputMimeType(file.type, options.format ?? "original");
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new AppError("PROCESS_FAILED", "图片裁剪失败"));
      },
      mimeType,
      mimeType === "image/jpeg" || mimeType === "image/webp"
        ? options.quality ?? 0.92
        : undefined
    );
  });

  return { blob, width, height };
}
