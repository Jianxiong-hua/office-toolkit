"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, File } from "lucide-react";
import type { FileItem } from "@/types";

interface FileDropZoneProps {
  accept: Record<string, string[]>;
  maxFiles?: number;
  maxSize?: number; // bytes
  onFilesAdded: (files: FileItem[]) => void;
  label?: string;
}

export function FileDropZone({
  accept,
  maxFiles = 20,
  maxSize = 100 * 1024 * 1024, // 100MB
  onFilesAdded,
  label = "拖拽文件到此处，或点击选择",
}: FileDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const items: FileItem[] = acceptedFiles.map((file) => ({
        id: `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: file.name,
        size: file.size,
        type: file.type,
        file,
      }));
      onFilesAdded(items);
    },
    [onFilesAdded]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept,
    maxFiles,
    maxSize,
    onDragEnter: () => setIsDragOver(true),
    onDragLeave: () => setIsDragOver(false),
  });

  return (
    <div
      {...getRootProps()}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 transition-all ${
        isDragActive || isDragOver
          ? "border-brand-400 bg-brand-50"
          : "border-gray-200 bg-gray-50 hover:border-brand-300 hover:bg-brand-50/50"
      }`}
    >
      <input {...getInputProps()} />
      <div
        className={`flex h-16 w-16 items-center justify-center rounded-2xl transition-colors ${
          isDragActive || isDragOver ? "bg-brand-100" : "bg-gray-100"
        }`}
      >
        <Upload
          className={`h-8 w-8 transition-colors ${
            isDragActive || isDragOver ? "text-brand-600" : "text-gray-400"
          }`}
        />
      </div>
      <p className="mt-4 text-sm text-gray-500">{label}</p>
      <p className="mt-1 text-xs text-gray-400">
        支持拖拽上传，单文件最大 {(maxSize / 1024 / 1024).toFixed(0)}MB
      </p>
    </div>
  );
}
