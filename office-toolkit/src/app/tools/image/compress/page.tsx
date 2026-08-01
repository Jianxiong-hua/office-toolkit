"use client";

import { useState, useCallback } from "react";
import { Download, Image as ImageIcon } from "lucide-react";
import { ToolLayout } from "@/components/layout/ToolLayout";
import { FileDropZone } from "@/components/tools/FileDropZone";
import { FileList, type FileResult } from "@/components/tools/FileList";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { compressImage, getCompressionRatio } from "@/lib/image/compress";
import {
  formatFileSize,
  downloadBlob,
  readFileAsDataURL,
  generateOutputFilename,
} from "@/lib/file";
import type { FileItem, ImageCompressOptions } from "@/types";

export default function ImageCompressPage() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const [options, setOptions] = useState<ImageCompressOptions>({
    quality: 80,
    format: "original",
  });
  const [results, setResults] = useState<Map<string, FileResult>>(new Map());

  const handleFilesAdded = useCallback(async (newFiles: FileItem[]) => {
    // Generate previews
    const withPreviews = await Promise.all(
      newFiles.map(async (f) => {
        if (f.type.startsWith("image/")) {
          const preview = await readFileAsDataURL(f.file);
          return { ...f, preview };
        }
        return f;
      })
    );
    setFiles((prev) => [...prev, ...withPreviews]);
  }, []);

  const handleRemove = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    setResults((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const handleCompress = useCallback(async () => {
    if (files.length === 0) return;
    setProcessing(true);

    const newResults = new Map<string, FileResult>();
    for (const fileItem of files) {
      const { blob, compressedSize, originalSize } = await compressImage(
        fileItem.file,
        options
      );
      newResults.set(fileItem.id, {
        blob,
        size: compressedSize,
        ratio: getCompressionRatio(originalSize, compressedSize),
      });
    }

    setResults(newResults);
    setProcessing(false);
  }, [files, options]);

  const handleDownload = useCallback(
    (id: string) => {
      const result = results.get(id);
      if (!result) return;
      const fileItem = files.find((f) => f.id === id);
      if (!fileItem) return;

      const ext = options.format === "original" ? undefined : options.format;
      const name = generateOutputFilename(fileItem.name, "compressed", ext);
      downloadBlob(result.blob, name);
    },
    [results, files, options.format]
  );

  const handlePreview = useCallback(
    (id: string) => {
      const result = results.get(id);
      const fileItem = files.find((f) => f.id === id);
      if (!result || !fileItem) return;
      const url = URL.createObjectURL(result.blob);
      const w = window.open("", "_blank");
      if (w) {
        w.document.write(`
          <!doctype html>
          <html lang="zh-CN">
            <head>
              <meta charset="utf-8" />
              <title>${fileItem.name}</title>
              <style>
                html,body{margin:0;height:100%}
                body{background:#f3f4f6;display:flex;align-items:center;justify-content:center}
                img{max-width:96%;max-height:96vh;box-shadow:0 4px 24px rgba(0,0,0,.15);background:white}
              </style>
            </head>
            <body><img src="${url}"/></body>
          </html>
        `);
        w.document.close();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    [results, files]
  );

  const handleDownloadAll = useCallback(async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();

    for (const fileItem of files) {
      const result = results.get(fileItem.id);
      if (result) {
        const ext = options.format === "original" ? undefined : options.format;
        const name = generateOutputFilename(fileItem.name, "compressed", ext);
        zip.file(name, result.blob);
      }
    }

    const zipBlob = await zip.generateAsync({ type: "blob" });
    downloadBlob(zipBlob, "compressed_images.zip");
  }, [files, results, options.format]);

  const hasResults = results.size > 0;
  const totalOriginal = files.reduce((sum, f) => sum + f.size, 0);
  const totalCompressed = Array.from(results.values()).reduce(
    (sum, r) => sum + r.size,
    0
  );

  return (
    <ToolLayout
      title="图片压缩"
      description="在线压缩 PNG/JPG/WebP 图片，所有处理在浏览器本地完成"
    >
      <div className="space-y-6">
        {/* 上传区域 */}
        <FileDropZone
          accept={{
            "image/png": [".png"],
            "image/jpeg": [".jpg", ".jpeg"],
            "image/webp": [".webp"],
          }}
          onFilesAdded={handleFilesAdded}
          label="拖拽图片到此处，或点击选择"
        />

        {/* 文件列表 */}
        <FileList
          files={files}
          onRemove={handleRemove}
          showPreview
          results={results}
          onDownload={handleDownload}
          onPreview={handlePreview}
        />

        {/* 压缩选项 */}
        {files.length > 0 && (
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm space-y-4">
            <h3 className="font-semibold text-gray-900">压缩选项</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  压缩质量: {options.quality}%
                </label>
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={options.quality}
                  onChange={(e) =>
                    setOptions({ ...options, quality: Number(e.target.value) })
                  }
                  className="w-full accent-brand-600"
                />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>高压缩</span>
                  <span>高质量</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  输出格式
                </label>
                <select
                  value={options.format}
                  onChange={(e) =>
                    setOptions({
                      ...options,
                      format: e.target.value as ImageCompressOptions["format"],
                    })
                  }
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                >
                  <option value="original">保持原格式</option>
                  <option value="jpeg">JPEG</option>
                  <option value="webp">WebP</option>
                  <option value="png">PNG</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <DownloadButton
                onClick={handleCompress}
                loading={processing}
                label="开始压缩"
              />
              {hasResults && (
                <button
                  onClick={handleDownloadAll}
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <Download className="h-4 w-4" />
                  打包下载全部
                </button>
              )}
            </div>
          </div>
        )}

        {/* 结果对比 */}
        {hasResults && (
          <div className="rounded-2xl border border-green-100 bg-green-50 p-6">
            <h3 className="font-semibold text-green-800 mb-3">压缩结果</h3>
            <div className="text-sm text-green-700 space-y-1">
              <p>
                原始总大小: <strong>{formatFileSize(totalOriginal)}</strong>
              </p>
              <p>
                压缩后总大小:{" "}
                <strong>{formatFileSize(totalCompressed)}</strong>
              </p>
              <p>
                节省空间:{" "}
                <strong>
                  {getCompressionRatio(totalOriginal, totalCompressed)}%
                </strong>
              </p>
            </div>

          </div>
        )}
      </div>
    </ToolLayout>
  );
}
