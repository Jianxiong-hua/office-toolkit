"use client";

import { useState, useCallback } from "react";
import { Download } from "lucide-react";
import { ToolLayout } from "@/components/layout/ToolLayout";
import { FileDropZone } from "@/components/tools/FileDropZone";
import { FileList, type FileResult } from "@/components/tools/FileList";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ErrorAlert } from "@/components/common/ErrorAlert";
import { ProcessProgress } from "@/components/common/ProcessProgress";
import { padImage, padPresets, type PadMode, type PadOutputFormat } from "@/lib/image/pad";
import {
  downloadBlob,
  formatFileSize,
  generateOutputFilename,
  readFileAsDataURL,
} from "@/lib/file";
import { AppError, type AppErrorCode, type FileItem } from "@/types";

export default function ImagePadPage() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [width, setWidth] = useState<string>("1200");
  const [height, setHeight] = useState<string>("1200");
  const [mode, setMode] = useState<PadMode>("fit-center");
  const [bgColor, setBgColor] = useState<string>("#FFFFFF");
  const [transparent, setTransparent] = useState(false);
  const [format, setFormat] = useState<PadOutputFormat>("original");
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

  const applyPreset = useCallback((preset: (typeof padPresets)[0]) => {
    setWidth(String(preset.width));
    setHeight(String(preset.height));
  }, []);

  const handlePad = useCallback(async () => {
    if (files.length === 0) return;
    setProcessing(true);
    setProgress(0);
    setError(null);
    setResults(new Map());

    try {
      const newResults = new Map<string, FileResult>();
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const { blob, width: outW, height: outH } = await padImage(file.file, {
          width: Number(width),
          height: Number(height),
          mode,
          backgroundColor: transparent ? "transparent" : bgColor,
          format,
          quality: quality / 100,
        });
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
        setError({ code: "PROCESS_FAILED", message: "图片填充失败，请重试" });
      }
    } finally {
      setProcessing(false);
    }
  }, [files, width, height, mode, bgColor, transparent, format, quality]);

  const handleDownload = useCallback(
    (id: string) => {
      const result = results.get(id);
      const file = files.find((f) => f.id === id);
      if (!result || !file) return;
      const ext = transparent ? "png" : format === "original" ? undefined : format;
      const name = generateOutputFilename(file.name, "padded", ext);
      downloadBlob(result.blob, name);
    },
    [results, files, format, transparent]
  );

  const handleDownloadAll = useCallback(async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    files.forEach((file) => {
      const result = results.get(file.id);
      if (result) {
        const ext = transparent ? "png" : format === "original" ? undefined : format;
        const name = generateOutputFilename(file.name, "padded", ext);
        zip.file(name, result.blob);
      }
    });
    const zipBlob = await zip.generateAsync({ type: "blob" });
    downloadBlob(zipBlob, "padded_images.zip");
  }, [files, results, format, transparent]);

  return (
    <ToolLayout
      title="图片背景填充"
      description="将图片等比居中或拉伸填充到目标画布尺寸，支持自定义背景色"
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
            onRetry={handlePad}
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
            <h3 className="font-semibold text-gray-900">填充选项</h3>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                常用尺寸预设
              </label>
              <div className="flex flex-wrap gap-2">
                {padPresets.map((preset) => (
                  <button
                    key={preset.name}
                    onClick={() => applyPreset(preset)}
                    className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 transition-colors"
                  >
                    {preset.name} ({preset.width}×{preset.height})
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  画布宽度
                </label>
                <input
                  type="number"
                  min={1}
                  value={width}
                  onChange={(e) => setWidth(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  画布高度
                </label>
                <input
                  type="number"
                  min={1}
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  填充模式
                </label>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as PadMode)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                >
                  <option value="fit-center">等比缩放居中</option>
                  <option value="stretch">拉伸填充</option>
                  <option value="original-center">原始尺寸居中</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  输出格式
                </label>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value as PadOutputFormat)}
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
                  checked={transparent}
                  onChange={(e) => setTransparent(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                />
                透明背景
              </label>
              {!transparent && (
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={bgColor}
                    onChange={(e) => setBgColor(e.target.value)}
                    className="h-8 w-8 rounded-lg border border-gray-200"
                  />
                  <span className="text-sm text-gray-600">背景颜色</span>
                </div>
              )}
              {(format === "jpeg" || format === "webp") && !transparent && (
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

            <div className="flex flex-wrap items-center gap-3">
              <DownloadButton
                onClick={handlePad}
                loading={processing}
                disabled={!width || !height}
                label="开始填充"
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

        {processing && <ProcessProgress message="正在填充图片..." progress={progress} />}
      </div>
    </ToolLayout>
  );
}
