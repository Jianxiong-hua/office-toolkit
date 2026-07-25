import { saveAs } from "file-saver";

/** 读取文件为 ArrayBuffer */
export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

/** 读取文件为 Data URL */
export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** 下载 Blob */
export function downloadBlob(blob: Blob, filename: string): void {
  saveAs(blob, filename);
}

/** 格式化文件大小 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

/** 获取文件扩展名 */
export function getFileExtension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() || "";
}

/** 生成唯一 ID */
export function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** 生成带后缀的文件名 */
export function generateOutputFilename(
  originalName: string,
  suffix: string,
  newExt?: string
): string {
  const lastDotIndex = originalName.lastIndexOf(".");
  const baseName =
    lastDotIndex > 0 ? originalName.slice(0, lastDotIndex) : originalName;
  const ext = newExt
    ? newExt.startsWith(".")
      ? newExt.slice(1)
      : newExt
    : originalName.slice(lastDotIndex + 1);
  return `${baseName}_${suffix}.${ext}`;
}

/** 读取图片文件为 Image 对象 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** 将 Blob 转换为 Data URL */
export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
