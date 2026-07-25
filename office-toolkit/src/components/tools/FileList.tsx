"use client";

import { X, FileImage, Download, CheckCircle2, AlertCircle } from "lucide-react";
import { formatFileSize } from "@/lib/file";
import type { FileItem } from "@/types";

export interface FileResult {
  blob: Blob;
  size: number;
  ratio?: number;
  info?: string;
}

interface FileListProps {
  files: FileItem[];
  onRemove: (id: string) => void;
  showPreview?: boolean;
  results?: Map<string, FileResult>;
  onDownload?: (id: string) => void;
  processingIds?: Set<string>;
  errorIds?: Map<string, string>;
}

export function FileList({
  files,
  onRemove,
  showPreview = false,
  results,
  onDownload,
  processingIds,
  errorIds,
}: FileListProps) {
  if (files.length === 0) return null;

  return (
    <ul className="space-y-2">
      {files.map((file) => {
        const result = results?.get(file.id);
        const isProcessing = processingIds?.has(file.id);
        const error = errorIds?.get(file.id);

        return (
          <li
            key={file.id}
            className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-3 shadow-sm"
          >
            {showPreview && file.preview ? (
              <img
                src={file.preview}
                alt={file.name}
                className="h-10 w-10 rounded-lg object-cover"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
                <FileImage className="h-5 w-5 text-gray-400" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-medium text-gray-900">{file.name}</p>
              <p className="text-xs text-gray-400">
                {formatFileSize(file.size)}
                {result && (
                  <>
                    {" → "}
                    <span className="text-green-600">{formatFileSize(result.size)}</span>
                    {result.ratio !== undefined && result.ratio > 0 && (
                      <span className="ml-1 text-green-600">
                        (-{result.ratio}%)
                      </span>
                    )}
                    {result.info && (
                      <span className="ml-1 text-gray-500">{result.info}</span>
                    )}
                  </>
                )}
                {isProcessing && (
                  <span className="ml-1 text-brand-600">处理中...</span>
                )}
                {error && (
                  <span className="ml-1 inline-flex items-center gap-0.5 text-red-500">
                    <AlertCircle className="h-3 w-3" />
                    {error}
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {result && onDownload && (
                <button
                  onClick={() => onDownload(file.id)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-green-600 hover:bg-green-50 transition-colors"
                  title="下载"
                >
                  <Download className="h-4 w-4" />
                </button>
              )}
              {result && !onDownload && (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              )}
              <button
                onClick={() => onRemove(file.id)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                title="删除"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
