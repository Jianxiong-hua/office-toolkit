"use client";

import { useState, useCallback } from "react";
import { ArrowUp, ArrowDown, Trash2, FileText, Image as ImageIcon, Eye } from "lucide-react";
import { ToolLayout } from "@/components/layout/ToolLayout";
import { FileDropZone } from "@/components/tools/FileDropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { mergeMixedFiles } from "@/lib/pdf/merge";
import { downloadBlob, formatFileSize } from "@/lib/file";
import type { FileItem } from "@/types";

interface MergeFileItem extends FileItem {
  fileType: "pdf" | "image";
}

export default function PdfMergePage() {
  const [files, setFiles] = useState<MergeFileItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFilesAdded = useCallback(async (newFiles: FileItem[]) => {
    const mergeFiles: MergeFileItem[] = newFiles.map((f) => {
      const isPdf = f.file.type === "application/pdf";
      return {
        ...f,
        fileType: isPdf ? "pdf" : "image",
      };
    });
    
    setFiles((prev) => [...prev, ...mergeFiles]);
    setResultBlob(null);
    setError(null);
  }, []);

  const handleRemove = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    setResultBlob(null);
  }, []);

  const handleMoveUp = useCallback((index: number) => {
    if (index === 0) return;
    setFiles((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
    setResultBlob(null);
  }, []);

  const handleMoveDown = useCallback((index: number) => {
    setFiles((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
    setResultBlob(null);
  }, []);

  const handleMerge = useCallback(async () => {
    if (files.length < 1) return;
    setProcessing(true);
    setError(null);

    try {
      const mergeFiles = files.map((f) => ({
        file: f.file,
        type: f.fileType,
      }));
      
      const mergedBytes = await mergeMixedFiles(mergeFiles);
      const blob = new Blob([mergedBytes.buffer as ArrayBuffer], { type: "application/pdf" });
      setResultBlob(blob);
    } catch (err) {
      console.error("Merge failed:", err);
      setError("合并失败，请检查文件格式是否正确");
    } finally {
      setProcessing(false);
    }
  }, [files]);

  const handleDownload = useCallback(() => {
    if (!resultBlob) return;
    const name =
      files.length > 0
        ? `merged_${files[0].name.replace(/\.[^.]+$/, "")}_等${files.length}个文件.pdf`
        : "merged.pdf";
    downloadBlob(resultBlob, name);
  }, [resultBlob, files]);

  const handlePreview = useCallback(() => {
    if (!resultBlob) return;
    const url = URL.createObjectURL(resultBlob);
    window.open(url, "_blank");
  }, [resultBlob]);

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return (
    <ToolLayout
      title="PDF 合并"
      description="将多个 PDF 或图片文件合并为一个 PDF，支持通过按钮调整页面顺序"
    >
      <div className="space-y-6">
        <FileDropZone
          accept={{ 
            "application/pdf": [".pdf"],
            "image/png": [".png"],
            "image/jpeg": [".jpg", ".jpeg"],
            "image/webp": [".webp"]
          }}
          onFilesAdded={handleFilesAdded}
          label="拖拽 PDF 或图片文件到此处，或点击选择"
          maxSize={100 * 1024 * 1024}
        />

        {/* 文件排序列表 */}
        {files.length > 0 && (
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">
                文件列表 ({files.length} 个文件，共 {formatFileSize(totalSize)})
              </h3>
            </div>

            <ul className="space-y-2">
              {files.map((file, index) => (
                <li
                  key={file.id}
                  className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-100 text-xs font-bold text-red-600 shrink-0">
                    {index + 1}
                  </span>
                  
                  {/* 文件类型图标 */}
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100 overflow-hidden shrink-0">
                    {file.fileType === "pdf" ? (
                      <FileText className="h-6 w-6 text-red-500" />
                    ) : (
                      <ImageIcon className="h-6 w-6 text-gray-400" />
                    )}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {file.name}
                    </p>
                    <p className="text-xs text-gray-400">
                      {formatFileSize(file.size)} · {file.fileType === "pdf" ? "PDF" : "图片"}
                    </p>
                  </div>
                  
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={() => handleMoveUp(index)}
                      disabled={index === 0}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-gray-200 disabled:opacity-30 transition-colors"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleMoveDown(index)}
                      disabled={index === files.length - 1}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-gray-200 disabled:opacity-30 transition-colors"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleRemove(file.id)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors ml-1"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            {error && (
              <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">
                {error}
              </div>
            )}

            <div className="mt-6 flex items-center gap-3">
              <DownloadButton
                onClick={handleMerge}
                loading={processing}
                disabled={files.length < 1}
                label={files.length < 1 ? "请添加文件" : "开始合并"}
              />
              {resultBlob && (
                <>
                  <button
                    onClick={handlePreview}
                    className="inline-flex items-center gap-2 rounded-xl border-2 border-blue-500 bg-blue-50 px-5 py-3 text-sm font-medium text-blue-700 hover:bg-blue-100 transition-colors"
                  >
                    <Eye className="h-4 w-4" />
                    预览文件
                  </button>
                  <button
                    onClick={handleDownload}
                    className="inline-flex items-center gap-2 rounded-xl border-2 border-green-500 bg-green-50 px-5 py-3 text-sm font-medium text-green-700 hover:bg-green-100 transition-colors"
                  >
                    下载合并结果 ({formatFileSize(resultBlob.size)})
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* 使用提示 */}
        {files.length === 0 && (
          <div className="rounded-2xl border border-gray-100 bg-gray-50 p-6">
            <h3 className="font-semibold text-gray-700 mb-2">💡 使用提示</h3>
            <ul className="text-sm text-gray-500 space-y-1.5">
              <li>• 支持合并多个 PDF 和图片文件（PNG、JPG、WebP）</li>
              <li>• 图片会自动转换为单页 PDF</li>
              <li>• 单个文件最大 100MB</li>
              <li>• 通过箭头按钮调整文件合并顺序</li>
              <li>• 所有处理在浏览器本地完成，文件不会上传到服务器</li>
            </ul>
          </div>
        )}
      </div>
    </ToolLayout>
  );
}
