import { AppError } from "@/types";

/**
 * File System Access API 的最小封装（目录选择 / 建子目录 / 逐文件写入）。
 *
 * 只有 Chromium（Chrome / Edge）实现，Safari 与 Firefox 没有 `showDirectoryPicker`，
 * 调用方必须先用 `supportsDirectoryPicker()` 判断，否则退化到 ZIP 或普通下载。
 *
 * TS 的 lib.dom 里没有这两个 picker 的声明（仍是 Chromium 专有），故在此局部补声明。
 */

interface DirectoryPickerWindow {
  showDirectoryPicker?: (options?: {
    mode?: "read" | "readwrite";
  }) => Promise<FileSystemDirectoryHandle>;
}

/** 当前浏览器是否支持选择文件夹 */
export function supportsDirectoryPicker(): boolean {
  if (typeof window === "undefined") return false;
  return (
    typeof (window as DirectoryPickerWindow).showDirectoryPicker === "function"
  );
}

/** 弹出目录选择框；用户取消时抛 CANCELLED */
export async function pickDirectory(): Promise<FileSystemDirectoryHandle> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) {
    throw new AppError(
      "BROWSER_NOT_SUPPORTED",
      "当前浏览器不支持选择文件夹，请使用 Chrome / Edge",
      "showDirectoryPicker 不存在"
    );
  }
  try {
    return await picker({ mode: "readwrite" });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new AppError("CANCELLED", "已取消选择文件夹");
    }
    throw new AppError(
      "PROCESS_FAILED",
      "无法打开文件夹选择框",
      e instanceof Error ? e.message : String(e)
    );
  }
}

/** 子目录是否存在（getDirectoryHandle 不带 create 时不存在会抛 NotFoundError） */
async function dirExists(
  parent: FileSystemDirectoryHandle,
  name: string
): Promise<boolean> {
  try {
    await parent.getDirectoryHandle(name);
    return true;
  } catch {
    return false;
  }
}

/**
 * 在 parent 下建子目录；同名目录已存在时自动加 -2 / -3 后缀，
 * 避免覆盖上一次导出的结果。
 */
export async function ensureUniqueSubdirectory(
  parent: FileSystemDirectoryHandle,
  baseName: string
): Promise<FileSystemDirectoryHandle> {
  for (let i = 1; i <= 50; i++) {
    const name = i === 1 ? baseName : `${baseName}-${i}`;
    if (!(await dirExists(parent, name))) {
      return parent.getDirectoryHandle(name, { create: true });
    }
  }
  throw new AppError(
    "PROCESS_FAILED",
    `输出位置已存在 ${baseName} 及其 49 个同名副本，请先清理`
  );
}

interface SaveFilePickerWindow {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
  }) => Promise<FileSystemFileHandle>;
}

/** 当前浏览器是否支持「另存为」文件选择框（流式写盘用） */
export function supportsSaveFilePicker(): boolean {
  if (typeof window === "undefined") return false;
  return (
    typeof (window as SaveFilePickerWindow).showSaveFilePicker === "function"
  );
}

/**
 * 弹出「另存为」并返回可写流；用户取消时抛 CANCELLED。
 * 调用方负责 write / close——异常时记得 abort，否则会留下半截文件。
 */
export async function pickSaveFileStream(
  suggestedName: string
): Promise<FileSystemWritableFileStream> {
  const picker = (window as SaveFilePickerWindow).showSaveFilePicker;
  if (!picker) {
    throw new AppError(
      "BROWSER_NOT_SUPPORTED",
      "当前浏览器不支持直接保存到指定位置，请使用 Chrome / Edge",
      "showSaveFilePicker 不存在"
    );
  }
  try {
    const handle = await picker({ suggestedName });
    return await handle.createWritable();
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new AppError("CANCELLED", "已取消保存");
    }
    throw new AppError(
      "PROCESS_FAILED",
      "无法打开保存位置选择框",
      e instanceof Error ? e.message : String(e)
    );
  }
}

/** 把 Blob 写入目录下的文件（同名覆盖） */
export async function writeBlobInto(
  dir: FileSystemDirectoryHandle,
  name: string,
  blob: Blob
): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(blob);
    await writable.close();
  } catch (e) {
    try {
      await writable.abort();
    } catch {
      /* 已中止或已关闭 */
    }
    throw new AppError(
      "PROCESS_FAILED",
      "写入文件失败，请确认输出文件夹仍有写入权限",
      e instanceof Error ? e.message : String(e)
    );
  }
}
