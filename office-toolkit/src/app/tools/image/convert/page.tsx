"use client";

import { useState, useCallback } from "react";
import { Download } from "lucide-react";
import { ToolLayout } from "@/components/layout/ToolLayout";
import { FileDropZone } from "@/components/tools/FileDropZone";
import { FileList, type FileResult } from "@/components/tools/FileList";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ErrorAlert } from "@/components/common/ErrorAlert";
import { ProcessProgress } from "@/components/common/ProcessProgress";
import { convertImages, type ImageOutputFormat } from "@/lib/image/convert";
import {
  downloadBlob,
  formatFileSize,
  generateOutputFilename,
  readFileAsDataURL,
} from "@/lib/file";
import { AppError, type AppErrorCode, type FileItem } from "@/types";

export default function ImageConvertPage() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [format, setFormat] = useState<ImageOutputFormat>("png");
  const [quality, setQuality] = useState(92);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<Map<string, FileResult>>(new Map());
  const [error, setError] = useState<{ code?: AppErrorCode; message: string } | null>(null);

  const handleFilesAdded = useCallback(async (newFiles: FileItem[]) => {
    const withPreviews = await Promise.all(
      newFiles.map(async (f) => {
        if (f.type.startsWith("image/")) {
          return { ...f, preview: await readFileAsDataURL(f.file) };
        }
        return f;
      })
    );
    setFiles((prev) => [...prev, ...withPreviews]);
    setResults(new Map());
    setError(null);
  }, []);

  const handleRemove = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    setResults((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const handleConvert = useCallback(async () => {
    if (files.length === 0) return;
    setProcessing(true);
    setProgress(0);
    setError(null);
    setResults(new Map());

    try {
      const converted = await convertImages(
        files.map((f) => f.file),
        format,
        quality / 100,
        (current, total) => setProgress(Math.round((current / total) * 100))
      );

      const newResults = new Map<string, FileResult>();
      files.forEach((file, index) => {
        const { blob } = converted[index];
        const ratio = Math.round(((file.size - blob.size) / file.size) * 100);
        newResults.set(file.id, {
          blob,
          size: blob.size,
          ratio: ratio > 0 ? ratio : 0,
          info: `→ ${format.toUpperCase()}`,
        });
      });
      setResults(newResults);
    } catch (err) {
      if (err instanceof AppError) {
        setError({ code: err.code, message: err.message });
      } else {
        setError({ code: "PROCESS_FAILED", message: "图片转换失败，请重试" });
      }
    } finally {
      setProcessing(false);
    }
  }, [files, format, quality]);

  const handleDownload = useCallback(
    (id: string) => {
      const result = results.get(id);
      const file = files.find((f) => f.id === id);
      if (!result || !file) return;
      const name = generateOutputFilename(file.name, "converted", format);
      downloadBlob(result.blob, name);
    },
    [results, files, format]
  );

  const handleDownloadAll = useCallback(async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    files.forEach((file) => {
      const result = results.get(file.id);
      if (result) {
        const name = generateOutputFilename(file.name, "converted", format);
        zip.file(name, result.blob);
      }
    });
    const zipBlob = await zip.generateAsync({ type: "blob" });
    downloadBlob(zipBlob, "converted_images.zip");
  }, [files, results, format]);

  const totalOriginal = files.reduce((sum, f) => sum + f.size, 0);
  const totalConverted = Array.from(results.values()).reduce((sum, r) => sum + r.size, 0);

  return (
    <ToolLayout
      title="图片格式转换"
      description="JPG ↔ PNG ↔ WebP ↔ BMP 格式互转，支持批量处理"
    >
      <div className="space-y-6">
        <FileDropZone
          accept={{
            "image/png": [".png"],
            "image/jpeg": [".jpg", ".jpeg"],
            "image/webp": [".webp"],
            "image/bmp": [".bmp"],
            "image/gif": [".gif"],
          }}
          onFilesAdded={handleFilesAdded}
          label="拖拽图片到此处，或点击选择"
        />

        {error && (
          <ErrorAlert
            code={error.code}
            message={error.message}
            onRetry={handleConvert}
            onClose={() => setError(null)}
          />
        )}

        <FileList
          files={files}
          onRemove={handleRemove}
          showPreview
          results={results}
          onDownload={handleDownload}
        />

        {files.length > 0 && (
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm space-y-4">
            <h3 className="font-semibold text-gray-900">转换选项</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  目标格式
                </label>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value as ImageOutputFormat)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                >
                  <option value="png">PNG</option>
                  <option value="jpeg">JPG</option>
                  <option value="webp">WebP</option>
                  <option value="bmp">BMP</option>
                </select>
              </div>
              {(format === "jpeg" || format === "webp") && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    输出质量: {quality}%
                  </label>
                  <input
                    type="range"
                    min={10}
                    max={100}
                    value={quality}
                    onChange={(e) => setQuality(Number(e.target.value))}
                    className="w-full accent-brand-600"
                  />
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <DownloadButton
                onClick={handleConvert}
                loading={processing}
                label="开始转换"
              />
              {results.size > 0 && (
                <button
                  onClick={handleDownloadAll}
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <Download className="h-4 w-4" />
                  打包下载
                </button>
              )}
            </div>
          </div>
        )}

        {processing && <ProcessProgress message="正在转换图片..." progress={progress} />}

        {results.size > 0 && (
          <div className="rounded-2xl border border-green-100 bg-green-50 p-6">
            <h3 className="font-semibold text-green-800 mb-2">转换完成</h3>
            <p className="text-sm text-green-700">
              {formatFileSize(totalOriginal)} → {formatFileSize(totalConverted)}
              {totalOriginal > 0 && (
                <span className="ml-1">
                  (
                  {Math.round(((totalOriginal - totalConverted) / totalOriginal) * 100)}%
                  )
                </span>
              )}
            </p>
          </div>
        )}
      </div>
    </ToolLayout>
  );
}
