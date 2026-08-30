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
  /**
   * 裁剪区域，单位为像素。
   * 坐标相对「旋转后的外接矩形」——react-easy-crop 的 croppedAreaPixels 正是该坐标系，
   * 因此任意角度旋转后，输出尺寸恒等于 crop.width × crop.height（不再做 90° 的宽高互换）。
   */
  crop: CropArea;
  /** 旋转角度（度），支持 0.1° 精度 */
  rotation?: number;
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
 * 计算矩形绕中心旋转后的外接矩形尺寸
 * 与 react-easy-crop 内部的 rotateSize 保持一致
 */
export function getRotatedBoundingBox(
  width: number,
  height: number,
  rotation: number
): { width: number; height: number } {
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  return {
    width: Math.round(width * cos + height * sin),
    height: Math.round(width * sin + height * cos),
  };
}

/**
 * 裁剪图片（支持任意角度旋转 + 镜像）
 *
 * 分两步：
 * 1) 把「先镜像、后旋转」的结果绘制到与外接矩形等大的画布上；
 * 2) 按 crop 区域从该画布取像素输出。
 * 这样旋转、镜像、裁剪三者叠加后，输出与预览框内所见完全一致。
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

  // 1) 旋转 + 镜像后的整图
  const bbox = getRotatedBoundingBox(img.naturalWidth, img.naturalHeight, rotation);
  const rotatedCanvas = document.createElement("canvas");
  rotatedCanvas.width = bbox.width;
  rotatedCanvas.height = bbox.height;
  const rotatedCtx = rotatedCanvas.getContext("2d");
  if (!rotatedCtx) {
    throw new AppError("BROWSER_NOT_SUPPORTED", "当前浏览器不支持 Canvas");
  }

  rotatedCtx.translate(bbox.width / 2, bbox.height / 2);
  rotatedCtx.rotate((rotation * Math.PI) / 180);
  // 先镜像再旋转，与预览一致（变换按书写顺序反向作用于图像）
  rotatedCtx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  rotatedCtx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);

  // 2) 按裁剪框输出
  const outputWidth = Math.round(crop.width);
  const outputHeight = Math.round(crop.height);
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

  // 只取「裁剪框 ∩ 旋转后画布」的部分；越界区域留白（JPEG 已铺白底，PNG/WebP 为透明）。
  // 高倍缩放或极端自定义比例下裁剪框可能超出原图，这样处理可避免 drawImage 源矩形越界导致的拉伸变形。
  const srcX = Math.max(0, Math.round(crop.x));
  const srcY = Math.max(0, Math.round(crop.y));
  const srcWidth = Math.min(outputWidth, bbox.width - srcX);
  const srcHeight = Math.min(outputHeight, bbox.height - srcY);
  if (srcWidth > 0 && srcHeight > 0) {
    ctx.drawImage(
      rotatedCanvas,
      srcX,
      srcY,
      srcWidth,
      srcHeight,
      srcX - Math.round(crop.x),
      srcY - Math.round(crop.y),
      srcWidth,
      srcHeight
    );
  }

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
