"use client";

import { useCallback, useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { Upload, AlertCircle } from "lucide-react";
import type { FileItem } from "@/types";

interface FileDropZoneProps {
  accept: Record<string, string[]>;
  maxFiles?: number;
  maxSize?: number; // bytes
  onFilesAdded: (files: FileItem[]) => void;
  onRejected?: (message: string) => void;
  label?: string;
}

const FORMAT_LABELS: Record<string, string> = {
  "application/pdf": "PDF",
  "image/png": "PNG",
  "image/jpeg": "JPG",
  "image/jpg": "JPG",
  "image/webp": "WebP",
  "image/bmp": "BMP",
  "image/gif": "GIF",
};

export function FileDropZone({
  accept,
  maxFiles = 20,
  maxSize = 100 * 1024 * 1024,
  onFilesAdded,
  onRejected,
  label = "拖拽文件到此处，或点击选择",
}: FileDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [rejectionMessage, setRejectionMessage] = useState<string | null>(null);

  const buildRejectionMessage = (rejections: FileRejection[]): string => {
    const overSize: string[] = [];
    const wrongType: string[] = [];
    const tooMany: string[] = [];

    rejections.forEach((r) => {
      r.errors.forEach((err) => {
        if (err.code === "file-too-large") {
          overSize.push(r.file.name);
        } else if (err.code === "file-invalid-type") {
          wrongType.push(r.file.name);
        } else if (err.code === "too-many-files") {
          tooMany.push(r.file.name);
        }
      });
    });

    const messages: string[] = [];
    if (overSize.length > 0) {
      const limitMB = (maxSize / 1024 / 1024).toFixed(0);
      messages.push(
        overSize.length === 1
          ? `文件「${overSize[0]}」超过 ${limitMB}MB 大小限制`
          : `${overSize.length} 个文件超过 ${limitMB}MB 大小限制：${overSize.slice(0, 3).join("、")}${overSize.length > 3 ? " 等" : ""}`
      );
    }
    if (wrongType.length > 0) {
      const supported = Array.from(
        new Set(Object.keys(accept).flatMap((mime) => FORMAT_LABELS[mime] || mime))
      ).join("、");
      messages.push(
        wrongType.length === 1
          ? `文件「${wrongType[0]}」格式不支持，仅支持 ${supported}`
          : `${wrongType.length} 个文件格式不支持：${wrongType.slice(0, 3).join("、")}${wrongType.length > 3 ? " 等" : ""}，仅支持 ${supported}`
      );
    }
    if (tooMany.length > 0) {
      messages.push(`一次最多上传 ${maxFiles} 个文件`);
    }
    return messages.join("；");
  };

  const onDrop = useCallback(
    (acceptedFiles: File[], rejectedFiles: FileRejection[]) => {
      if (acceptedFiles.length > 0) {
        const items: FileItem[] = acceptedFiles.map((file) => ({
          id: `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: file.name,
          size: file.size,
          type: file.type,
          file,
        }));
        onFilesAdded(items);
        setRejectionMessage(null);
      }

      if (rejectedFiles.length > 0) {
        const msg = buildRejectionMessage(rejectedFiles);
        setRejectionMessage(msg);
        onRejected?.(msg);
      }
    },
    [onFilesAdded, onRejected, maxSize, maxFiles, accept]
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
    <div>
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

      {rejectionMessage && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{rejectionMessage}</span>
        </div>
      )}
    </div>
  );
}
