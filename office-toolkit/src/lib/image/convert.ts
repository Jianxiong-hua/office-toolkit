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
 * 把 Canvas 编码为 24-bit BMP Blob
 * 浏览器 Canvas API 不支持 canvas.toBlob("image/bmp")，所以自己实现：
 *   - BITMAPFILEHEADER (14 字节)
 *   - BITMAPINFOHEADER (40 字节)
 *   - 像素数据 (BGR 顺序，倒序存储，每行 4 字节对齐)
 */
function canvasToBmp(canvas: HTMLCanvasElement): Blob {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new AppError("BROWSER_NOT_SUPPORTED", "当前浏览器不支持 Canvas");
  }
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = imageData.data; // RGBA

  // 每行字节数（向上 4 字节对齐）
  const rowSize = Math.floor((width * 3 + 3) / 4) * 4;
  const pixelDataSize = rowSize * height;
  const fileSize = 14 + 40 + pixelDataSize;

  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // BITMAPFILEHEADER
  bytes[0] = 0x42; // 'B'
  bytes[1] = 0x4d; // 'M'
  view.setUint32(2, fileSize, true);
  view.setUint16(6, 0, true); // reserved1
  view.setUint16(8, 0, true); // reserved2
  view.setUint32(10, 54, true); // bfOffBits = 14 + 40

  // BITMAPINFOHEADER
  view.setUint32(14, 40, true); // biSize
  view.setInt32(18, width, true); // biWidth
  view.setInt32(22, height, true); // biHeight (正数 = 倒序，从最后一行开始)
  view.setUint16(26, 1, true); // biPlanes
  view.setUint16(28, 24, true); // biBitCount = 24
  view.setUint32(30, 0, true); // biCompression = BI_RGB
  view.setUint32(34, pixelDataSize, true); // biSizeImage
  view.setUint32(38, 0, true); // biXPelsPerMeter
  view.setUint32(42, 0, true); // biYPelsPerMeter
  view.setUint32(46, 0, true); // biClrUsed
  view.setUint32(50, 0, true); // biClrImportant

  // 像素数据：BGR 顺序，倒序存储（从最后一行开始）
  const padding = rowSize - width * 3;
  let offset = 54;
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      bytes[offset++] = pixels[i + 2]; // B
      bytes[offset++] = pixels[i + 1]; // G
      bytes[offset++] = pixels[i]; // R
    }
    for (let p = 0; p < padding; p++) {
      bytes[offset++] = 0;
    }
  }

  return new Blob([buffer], { type: "image/bmp" });
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

  // BMP 自己编码（浏览器 Canvas API 不支持）
  if (targetFormat === "bmp") {
    const blob = canvasToBmp(canvas);
    return { blob, ext: getExtension(targetFormat) };
  }

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
