"use client";

import { formatFileSize } from "@/lib/file";
import { FORMAT_OPTIONS } from "@/lib/bin/magic";

/** 超过该值只提示，不阻止 */
const SOFT_SIZE_LIMIT = 20 * 1024 * 1024;

interface FileInfoBarProps {
  file: File;
  byteLength: number;
  formatName: string;
  mismatch: string | null;
  onFormatChange: (value: string) => void;
  onReset: () => void;
}

/** 文件名、大小、类型识别（可手动覆盖）与换文件入口 */
export function FileInfoBar({
  file,
  byteLength,
  formatName,
  mismatch,
  onFormatChange,
  onReset,
}: FileInfoBarProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-gray-100 bg-white p-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-gray-900">{file.name}</p>
          <p className="mt-0.5 text-xs text-gray-500">
            {formatFileSize(byteLength)} · {byteLength.toLocaleString()} 字节
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-500">
          类型
          <select
            value={formatName}
            onChange={(e) => onFormatChange(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-800 focus:border-brand-400 focus:outline-none"
          >
            {!FORMAT_OPTIONS.includes(formatName) && (
              <option value={formatName}>{formatName}</option>
            )}
            {FORMAT_OPTIONS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={onReset}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-50"
        >
          换文件
        </button>
      </div>

      {file.size > SOFT_SIZE_LIMIT && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
          文件较大（{formatFileSize(file.size)}），浏览与搜索可能变慢，建议先按需截取后再查看。
        </div>
      )}

      {mismatch && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">{mismatch}</div>
      )}
    </div>
  );
}
