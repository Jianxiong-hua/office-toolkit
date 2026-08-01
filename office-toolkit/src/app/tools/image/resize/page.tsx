"use client";

import { useState, useCallback } from "react";
import { Download, RotateCcw } from "lucide-react";
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
  loadImage,
  readFileAsDataURL,
} from "@/lib/file";
import { AppError, type AppErrorCode, type FileItem } from "@/types";

/** 基准尺寸：来自第一张图片，用于"锁定宽高比"时自动计算 */
function getBaseDimension(
  dims: Map<string, { width: number; height: number }>
): { width: number; height: number } | null {
  const first = dims.values().next().value;
  return first ?? null;
}

export default function ImageResizePage() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [width, setWidth] = useState<string>("");
  const [height, setHeight] = useState<string>("");
  const [percent, setPercent] = useState<string>("");
  const [keepRatio, setKeepRatio] = useState(true);
  const [format, setFormat] = useState<ResizeOptions["format"]>("original");
  const [quality, setQuality] = useState(92);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<Map<string, FileResult>>(new Map());
  const [originalDimensions, setOriginalDimensions] = useState<
    Map<string, { width: number; height: number }>
  >(new Map());
  const [error, setError] = useState<{ code?: AppErrorCode; message: string } | null>(null);

  /**
   * 修改宽度。
   * 锁定宽高比时，根据基准图自动计算 height / percent。
   */
  const handleWidthChange = useCallback(
    (value: string) => {
      setWidth(value);
      if (!keepRatio) return;
      const base = getBaseDimension(originalDimensions);
      if (!base) return;
      const w = Number(value);
      if (!isNaN(w) && w > 0) {
        const ratio = w / base.width;
        const newH = Math.round(base.height * ratio);
        setHeight(String(newH));
        setPercent(String(Math.round(ratio * 100)));
      }
    },
    [keepRatio, originalDimensions]
  );

  /**
   * 修改高度。
   * 锁定宽高比时，根据基准图自动计算 width / percent。
   */
  const handleHeightChange = useCallback(
    (value: string) => {
      setHeight(value);
      if (!keepRatio) return;
      const base = getBaseDimension(originalDimensions);
      if (!base) return;
      const h = Number(value);
      if (!isNaN(h) && h > 0) {
        const ratio = h / base.height;
        const newW = Math.round(base.width * ratio);
        setWidth(String(newW));
        setPercent(String(Math.round(ratio * 100)));
      }
    },
    [keepRatio, originalDimensions]
  );

  /**
   * 修改百分比。
   * 锁定宽高比时，根据基准图自动计算 width / height。
   */
  const handlePercentChange = useCallback(
    (value: string) => {
      setPercent(value);
      if (!keepRatio) return;
      const base = getBaseDimension(originalDimensions);
      if (!base) return;
      const p = Number(value);
      if (!isNaN(p) && p > 0) {
        const ratio = p / 100;
        setWidth(String(Math.round(base.width * ratio)));
        setHeight(String(Math.round(base.height * ratio)));
      }
    },
    [keepRatio, originalDimensions]
  );

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

    // 读取每张图片的原始尺寸
    const dimEntries = await Promise.all(
      withPreviews.map(async (f) => {
        if (!f.preview) return null;
        try {
          const img = await loadImage(f.preview);
          return [f.id, { width: img.naturalWidth, height: img.naturalHeight }] as const;
        } catch {
          return null;
        }
      })
    );
    setOriginalDimensions((prev) => {
      const next = new Map(prev);
      dimEntries.forEach((entry) => {
        if (entry) next.set(entry[0], entry[1]);
      });
      return next;
    });

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
    setOriginalDimensions((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const handleReselect = useCallback(() => {
    setFiles([]);
    setResults(new Map());
    setOriginalDimensions(new Map());
    setError(null);
  }, []);

  const handleResize = useCallback(async () => {
    if (files.length === 0) return;

    // 锁定宽高比：width/height/percent 任一即可
    // 不锁定：必须同时填入 width 和 height
    if (keepRatio) {
      if (!width && !height && !percent) return;
    } else {
      if (!width || !height) {
        setError({
          code: "INVALID_INPUT",
          message: "未锁定宽高比时，必须同时填入宽度和高度",
        });
        return;
      }
    }

    setProcessing(true);
    setProgress(0);
    setError(null);
    setResults(new Map());

    const options: ResizeOptions = {
      width: width ? Number(width) : undefined,
      height: height ? Number(height) : undefined,
      percent: keepRatio && percent ? Number(percent) : undefined,
      keepRatio,
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
  }, [files, width, height, percent, keepRatio, format, quality]);

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

  const handlePreview = useCallback(
    (id: string) => {
      const result = results.get(id);
      const file = files.find((f) => f.id === id);
      if (!result || !file) return;
      const url = URL.createObjectURL(result.blob);
      const w = window.open("", "_blank");
      if (w) {
        w.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><title>${file.name}</title><style>html,body{margin:0;height:100%}body{background:#f3f4f6;display:flex;align-items:center;justify-content:center}img{max-width:96%;max-height:96vh;box-shadow:0 4px 24px rgba(0,0,0,.15);background:white}</style></head><body><img src="${url}"/></body></html>`);
        w.document.close();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    [results, files]
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
          onPreview={handlePreview}
        />

        {files.length > 0 && (
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">缩放选项</h3>
              <button
                onClick={handleReselect}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200 transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                重新选择
              </button>
            </div>

            {originalDimensions.size > 0 && (
              <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                <span className="font-medium text-gray-700">原图分辨率：</span>
                {Array.from(originalDimensions.values()).map((dim, idx, arr) => (
                  <span key={idx}>
                    {dim.width} × {dim.height}
                    {idx < arr.length - 1 ? "、" : ""}
                  </span>
                ))}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  宽度（像素）
                </label>
                <input
                  type="number"
                  min={1}
                  value={width}
                  onChange={(e) => handleWidthChange(e.target.value)}
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
                  onChange={(e) => handleHeightChange(e.target.value)}
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
                  onChange={(e) => handlePercentChange(e.target.value)}
                  placeholder="如 50"
                  disabled={!keepRatio}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
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

            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={keepRatio}
                onChange={(e) => setKeepRatio(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
              />
              锁定宽高比
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <DownloadButton
                onClick={handleResize}
                loading={processing}
                disabled={
                  keepRatio
                    ? !width && !height && !percent
                    : !width || !height
                }
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
