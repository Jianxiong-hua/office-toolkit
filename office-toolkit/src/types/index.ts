export interface ProcessState {
  status: "idle" | "uploading" | "processing" | "done" | "error";
  progress: number; // 0-100
  message: string;
}

export interface FileItem {
  id: string;
  name: string;
  size: number;
  type: string;
  file: File;
  preview?: string; // object URL
  result?: Blob;
  resultSize?: number;
}

export interface ImageCompressOptions {
  quality: number; // 10-100
  maxWidth?: number;
  maxHeight?: number;
  format: "original" | "jpeg" | "webp" | "png" | "gif";
  /**
   * GIF 输出颜色数（仅当 format 为 "gif" 时生效）
   * 8 / 16 / 32 / 64 / 128 / 256
   */
  gifColors?: 8 | 16 | 32 | 64 | 128 | 256;
}

export interface PdfWatermarkOptions {
  text: string;
  fontSize: number;
  opacity: number; // 0-1
  rotation: number; // degrees
  color: string; // hex
  position: "center" | "topleft" | "topright" | "bottomleft" | "bottomright";
}

export interface PdfSplitRange {
  start: number;
  end: number;
}

export type AppErrorCode =
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FORMAT"
  | "PROCESS_FAILED"
  | "BROWSER_NOT_SUPPORTED"
  | "ENCRYPTED_PDF"
  | "INVALID_INPUT"
  | "CANCELLED";

export class AppError extends Error {
  constructor(
    public code: AppErrorCode,
    message: string,
    public details?: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const errorMessages: Record<AppErrorCode, string> = {
  FILE_TOO_LARGE: "文件大小超过限制，请尝试更小的文件",
  UNSUPPORTED_FORMAT: "不支持的文件格式，请检查文件类型",
  PROCESS_FAILED: "处理失败，请重试或更换文件",
  BROWSER_NOT_SUPPORTED: "当前浏览器不支持该功能，请更换浏览器",
  ENCRYPTED_PDF: "该 PDF 已加密或受保护，无法处理",
  INVALID_INPUT: "输入参数无效，请检查后重试",
  CANCELLED: "操作已取消",
};
