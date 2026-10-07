"use client";

import { useRef, useState } from "react";
import { Upload, AlertCircle } from "lucide-react";

interface LoadZoneProps {
  /** 字节数上限 */
  maxSize: number;
  onFile: (file: File) => void;
}

/**
 * 任意类型二进制文件的加载区。
 *
 * 不用通用 `FileDropZone`：它基于 react-dropzone，而 react-dropzone 的 accept
 * 走 `attr-accept`，对空数组一律返回 false，无法表达「接受任意文件类型」。
 */
export function LoadZone({ maxSize, onFile }: LoadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = (file: File | undefined) => {
    if (!file) return;
    if (file.size > maxSize) {
      setError(
        `文件「${file.name}」超过 ${(maxSize / 1024 / 1024).toFixed(0)}MB 大小限制`
      );
      return;
    }
    setError(null);
    onFile(file);
  };

  const limitMB = (maxSize / 1024 / 1024).toFixed(0);

  return (
    <div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          accept(e.dataTransfer.files[0]);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 transition-all ${
          isDragOver
            ? "border-brand-400 bg-brand-50"
            : "border-gray-200 bg-gray-50 hover:border-brand-300 hover:bg-brand-50/50"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            accept(e.target.files?.[0]);
            // 重置以便再次选择同一文件时也能触发 change
            e.target.value = "";
          }}
        />
        <div
          className={`flex h-16 w-16 items-center justify-center rounded-2xl transition-colors ${
            isDragOver ? "bg-brand-100" : "bg-gray-100"
          }`}
        >
          <Upload
            className={`h-8 w-8 transition-colors ${
              isDragOver ? "text-brand-600" : "text-gray-400"
            }`}
          />
        </div>
        <p className="mt-4 text-sm text-gray-500">
          拖拽二进制文件到此处，或点击选择
        </p>
        <p className="mt-1 text-xs text-gray-400">
          支持任意文件类型，单文件最大 {limitMB}MB
        </p>
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
