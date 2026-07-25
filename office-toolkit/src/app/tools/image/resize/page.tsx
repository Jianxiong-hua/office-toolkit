"use client";

import { useState, useCallback } from "react";
import { Download } from "lucide-react";
import { ToolLayout } from "@/components/layout/ToolLayout";
import { FileDropZone } from "@/components/tools/FileDropZone";
import { FileList, type FileResult } from "@/components/tools/FileList";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ErrorAlert } from "@/components/common/ErrorAlert";
import { ProcessProgress } from "@/components/common/ProcessProgress";
import { resizeImage, type ResizeOptions } from "@/lib/image/resize";
import {
  downloadBlob,
  formatFileSize,
  generateOutputFilename,
  readFileAsDataURL,
} from "@/lib/file";
import { AppError, type AppErrorCode, type FileItem } from "@/types";

export default function ImageResizePage() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [width, setWidth] = useState<string>("");
  const [height, setHeight] = useState<string>("");
  const [percent, setPercent] = useState<string>("");
  const [keepRatio, setKeepRatio] = useState(true);
  const [mode, setMode] = useState<ResizeOptions["mode"]>("fit");
  const [format, setFormat] = useState<ResizeOptions["format"]>("original");
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

  const handleResize = useCallback(async () => {
    if (files.length === 0) return;
    setProcessing(true);
    setProgress(0);
    setError(null);
    setResults(new Map());

    const options: ResizeOptions = {
      width: width ? Number(width) : undefined,
      height: height ? Number(height) : undefined,
      percent: percent ? Number(percent) : undefined,
      keepRatio,
      mode,
      format,
      quality: quality / 100,
    };

    try {
      const newResults = new Map<string, FileResult>();
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const { blob, width: outW, height: outH } = await resizeImage(file.file, options);
        newResults.set(file.id, {
          blob,
          size: blob.size,
          info: `→ ${outW}×${outH}`,
        });
        setProgress(Math.round(((i + 1) / files.length) * 100));
      }
      setResults(newResults);
    } catch (err) {
      if (err instanceof AppError) {
        setError({ code: err.code, message: err.message });
      } else {
        setError({ code: "PROCESS_FAILED", message: "图片缩放失败，请重试" });
      }
    } finally {
      setProcessing(false);
    }
  }, [files, width, height, percent, keepRatio, mode, format, quality]);

  const handleDownload = useCallback(
    (id: string) => {
      const result = results.get(id);
      const file = files.find((f) => f.id === id);
      if (!result || !file) return;
      const ext = format === "original" ? undefined : format;
      const name = generateOutputFilename(file.name, "resized", ext);
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
        const ext = format === "original" ? undefined : format;
        const name = generateOutputFilename(file.name, "resized", ext);
        zip.file(name, result.blob);
      }
    });
    const zipBlob = await zip.generateAsync({ type: "blob" });
    downloadBlob(zipBlob, "resized_images.zip");
  }, [files, results, format]);

  return (
    <ToolLayout
      title="图片缩放"
      description="按像素尺寸或百分比缩放图片，支持锁定宽高比和批量处理"
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
            onRetry={handleResize}
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
            <h3 className="font-semibold text-gray-900">缩放选项</h3>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  宽度（像素）
                </label>
                <input
                  type="number"
                  min={1}
                  value={width}
                  onChange={(e) => setWidth(e.target.value)}
                  placeholder="自动"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  高度（像素）
                </label>
                <input
                  type="number"
                  min={1}
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                  placeholder="自动"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  百分比（%）
                </label>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={percent}
                  onChange={(e) => setPercent(e.target.value)}
                  placeholder="如 50"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  输出格式
                </label>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value as ResizeOptions["format"])}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                >
                  <option value="original">保持原格式</option>
                  <option value="jpeg">JPEG</option>
                  <option value="png">PNG</option>
                  <option value="webp">WebP</option>
                </select>
              </div>
              {(format === "jpeg" || format === "webp") && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    质量: {quality}%
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

            <div className="flex flex-wrap items-center gap-4">
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={keepRatio}
                  onChange={(e) => setKeepRatio(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                />
                锁定宽高比
              </label>
              {!keepRatio && (
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as ResizeOptions["mode"])}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm"
                >
                  <option value="fit">适配</option>
                  <option value="stretch">拉伸</option>
                  <option value="cover">覆盖</option>
                </select>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <DownloadButton
                onClick={handleResize}
                loading={processing}
                disabled={!width && !height && !percent}
                label="开始缩放"
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

        {processing && <ProcessProgress message="正在缩放图片..." progress={progress} />}
      </div>
    </ToolLayout>
  );
}
