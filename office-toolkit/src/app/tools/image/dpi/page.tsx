"use client";

import { useState, useCallback } from "react";
import { Download } from "lucide-react";
import { ToolLayout } from "@/components/layout/ToolLayout";
import { FileDropZone } from "@/components/tools/FileDropZone";
import { FileList, type FileResult } from "@/components/tools/FileList";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ErrorAlert } from "@/components/common/ErrorAlert";
import { ProcessProgress } from "@/components/common/ProcessProgress";
import { changeImageDpi, type DpiOptions } from "@/lib/image/dpi";
import {
  downloadBlob,
  formatFileSize,
  generateOutputFilename,
  readFileAsDataURL,
} from "@/lib/file";
import { AppError, type AppErrorCode, type FileItem } from "@/types";

const dpiPresets = [72, 150, 300, 600];

export default function ImageDpiPage() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [dpi, setDpi] = useState<string>("300");
  const [keepPixels, setKeepPixels] = useState(false);
  const [format, setFormat] = useState<DpiOptions["format"]>("original");
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

  const handleProcess = useCallback(async () => {
    if (files.length === 0) return;
    setProcessing(true);
    setProgress(0);
    setError(null);
    setResults(new Map());

    try {
      const newResults = new Map<string, FileResult>();
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const { blob, width, height, printWidth, printHeight } = await changeImageDpi(
          file.file,
          {
            dpi: Number(dpi),
            keepPixels,
            format,
            quality: quality / 100,
          }
        );
        newResults.set(file.id, {
          blob,
          size: blob.size,
          info: `→ ${width}×${height} · ${printWidth.toFixed(2)}\"×${printHeight.toFixed(2)}\"`,
        });
        setProgress(Math.round(((i + 1) / files.length) * 100));
      }
      setResults(newResults);
    } catch (err) {
      if (err instanceof AppError) {
        setError({ code: err.code, message: err.message });
      } else {
        setError({ code: "PROCESS_FAILED", message: "DPI 调整失败，请重试" });
      }
    } finally {
      setProcessing(false);
    }
  }, [files, dpi, keepPixels, format, quality]);

  const handleDownload = useCallback(
    (id: string) => {
      const result = results.get(id);
      const file = files.find((f) => f.id === id);
      if (!result || !file) return;
      const ext = format === "original" ? undefined : format;
      const name = generateOutputFilename(file.name, "dpi", ext);
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
        const name = generateOutputFilename(file.name, "dpi", ext);
        zip.file(name, result.blob);
      }
    });
    const zipBlob = await zip.generateAsync({ type: "blob" });
    downloadBlob(zipBlob, "dpi_images.zip");
  }, [files, results, format]);

  return (
    <ToolLayout
      title="修改图片 DPI"
      description="按目标 DPI 等效调整图片像素尺寸，适用于打印和证件照场景"
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
            onRetry={handleProcess}
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
            <h3 className="font-semibold text-gray-900">DPI 选项</h3>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                DPI 预设
              </label>
              <div className="flex flex-wrap gap-2">
                {dpiPresets.map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setDpi(String(preset))}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                      Number(dpi) === preset
                        ? "bg-brand-600 text-white"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    {preset} DPI
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  目标 DPI
                </label>
                <input
                  type="number"
                  min={1}
                  max={2400}
                  value={dpi}
                  onChange={(e) => setDpi(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  输出格式
                </label>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value as DpiOptions["format"])}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                >
                  <option value="original">保持原格式</option>
                  <option value="jpeg">JPEG</option>
                  <option value="png">PNG</option>
                  <option value="webp">WebP</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={keepPixels}
                  onChange={(e) => setKeepPixels(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                />
                保持像素总数不变
              </label>
              {(format === "jpeg" || format === "webp") && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-700">质量: {quality}%</span>
                  <input
                    type="range"
                    min={10}
                    max={100}
                    value={quality}
                    onChange={(e) => setQuality(Number(e.target.value))}
                    className="w-24 accent-brand-600"
                  />
                </div>
              )}
            </div>

            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
              说明：Web 浏览器无法直接修改图片 EXIF 中的 DPI 信息。本工具按照
              "像素 = DPI × 英寸" 的公式，根据目标 DPI 和原始打印尺寸重新计算像素。
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <DownloadButton
                onClick={handleProcess}
                loading={processing}
                disabled={!dpi}
                label="开始调整"
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

        {processing && <ProcessProgress message="正在调整 DPI..." progress={progress} />}
      </div>
    </ToolLayout>
  );
}
