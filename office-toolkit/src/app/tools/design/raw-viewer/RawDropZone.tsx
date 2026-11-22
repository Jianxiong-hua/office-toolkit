"use client";

import { useRef, useState } from "react";
import { FileUp } from "lucide-react";

/**
 * 任意类型文件的多选/拖入。
 * 通用 FileDropZone 基于 react-dropzone，accept 传空数组时 attr-accept 恒 false（会拒绝所有文件），
 * 这里 raw 文件没有可靠扩展名，只能自研。
 */
export function RawDropZone({
  count,
  disabled,
  onFiles,
}: {
  count?: number;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      onDragOver={(event) => {
        if (disabled) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (disabled) return;
        const files = Array.from(event.dataTransfer.files ?? []);
        if (files.length) onFiles(files);
      }}
      onClick={() => {
        if (!disabled) inputRef.current?.click();
      }}
      className={`flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-10 text-center transition-colors ${
        disabled
          ? "cursor-not-allowed border-gray-100 bg-gray-50 opacity-60"
          : dragging
            ? "cursor-pointer border-brand-400 bg-brand-50"
            : "cursor-pointer border-gray-200 bg-white hover:border-brand-300"
      }`}
    >
      <FileUp className="h-7 w-7 text-brand-500" />
      <p className="text-sm font-medium text-gray-900">拖入二进制文件（可多选），或点击选择</p>
      <p className="text-xs text-gray-400">
        .raw / .bin / 无扩展名均可，不做格式猜测；尺寸与位深需手动指定
      </p>
      {count !== undefined && count > 0 && (
        <p className="mt-1 font-mono text-xs text-gray-500">已加入 {count} 个文件</p>
      )}
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
    </div>
  );
}
