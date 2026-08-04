"use client";

import { useState, useCallback } from "react";
import { Download } from "lucide-react";
import { ToolLayout } from "@/components/layout/ToolLayout";
import { FileDropZone } from "@/components/tools/FileDropZone";
import { FileList, type FileResult } from "@/components/tools/FileList";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { compressImage, getCompressionRatio } from "@/lib/image/compress";
import type { GifColorCount } from "@/lib/image/compress-gif";
import {
  formatFileSize,
  downloadBlob,
  readFileAsDataURL,
  generateOutputFilename,
} from "@/lib/file";
import { AppError, type FileItem, type ImageCompressOptions } from "@/types";

const GIF_COLOR_OPTIONS: { value: GifColorCount; label: string }[] = [
  { value: 8, label: "8 色（最小）" },
  { value: 16, label: "16 色" },
  { value: 32, label: "32 色" },
  { value: 64, label: "64 色" },
  { value: 128, label: "128 色（推荐）" },
  { value: 256, label: "256 色（最佳）" },
];

export default function ImageCompressPage() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const [options, setOptions] = useState<ImageCompressOptions>({
    quality: 80,
    format: "original",
    gifColors: 128,
  });
  const [results, setResults] = useState<Map<string, FileResult>>(new Map());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());

  const handleFilesAdded = useCallback(async (newFiles: FileItem[]) => {
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
    setErrors((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // 单一文件处理：返回结果或抛错
  const processOne = useCallback(
    async (file: File) => {
      const { blob, compressedSize, originalSize, info } = await compressImage(
        file,
        options
      );
      return { blob, compressedSize, originalSize, info };
    },
    [options]
  );

  const handleCompress = useCallback(async () => {
    if (files.length === 0) return;
    setProcessing(true);
    setResults(new Map());
    setErrors(new Map());

    const newResults = new Map<string, FileResult>();
    const newErrors = new Map<string, string>();

    // 用 allSettled 保证一个文件失败不影响其他
    await Promise.all(
      files.map(async (fileItem) => {
        try {
          const r = await processOne(fileItem.file);
          newResults.set(fileItem.id, {
            blob: r.blob,
            size: r.compressedSize,
            ratio: getCompressionRatio(r.originalSize, r.compressedSize),
            info: r.info,
          });
        } catch (e) {
          const msg =
            e instanceof AppError
              ? e.message
              : e instanceof Error
                ? e.message
                : "处理失败";
          newErrors.set(fileItem.id, msg);
        }
      })
    );

    setResults(newResults);
    setErrors(newErrors);
    setProcessing(false);
  }, [files, processOne]);

  const handleDownload = useCallback(
    (id: string) => {
      const result = results.get(id);
      if (!result) return;
      const fileItem = files.find((f) => f.id === id);
      if (!fileItem) return;

      const ext =
        options.format === "original"
          ? fileItem.file.type === "image/gif"
            ? "gif"
            : undefined
          : options.format;
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
        const ext =
          options.format === "original"
            ? fileItem.file.type === "image/gif"
              ? "gif"
              : undefined
            : options.format;
        const name = generateOutputFilename(fileItem.name, "compressed", ext);
        zip.file(name, result.blob);
      }
    }

    const zipBlob = await zip.generateAsync({ type: "blob" });
    downloadBlob(zipBlob, "compressed_images.zip");
  }, [files, results, options.format]);

  const hasResults = results.size > 0;
  const hasErrors = errors.size > 0;
  const totalOriginal = files.reduce((sum, f) => sum + f.size, 0);
  const totalCompressed = Array.from(results.values()).reduce(
    (sum, r) => sum + r.size,
    0
  );

  // 是否启用 GIF 路径（颜色数 UI）：
  // 1) 用户显式选了 "gif" 输出
  // 2) 输出 "original" 但所有文件都是 GIF（保持原格式 = 保持 GIF → 走 GIF 路径）
  const gifFilesOnly =
    files.length > 0 && files.every((f) => f.file.type === "image/gif");
  const hasAnyGif = files.some((f) => f.file.type === "image/gif");
  const useGifControls =
    options.format === "gif" ||
    (options.format === "original" && gifFilesOnly);

  // 质量滑块何时显示：非 GIF 路径都显示
  // - 输出是 jpeg/webp/png
  // - 输出 original + 至少一个非 GIF 文件（混合或全非 GIF）
  const showQualitySlider =
    options.format !== "gif" && (!hasAnyGif || !gifFilesOnly);

  return (
    <ToolLayout
      title="图片压缩"
      description="在线压缩 PNG/JPG/WebP/GIF 图片，支持保留 GIF 动画，所有处理在浏览器本地完成"
    >
      <div className="space-y-6">
        {/* 上传区域 */}
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

        {/* 文件列表 */}
        <FileList
          files={files}
          onRemove={handleRemove}
          showPreview
          results={results}
          errorIds={errors}
          onDownload={handleDownload}
          onPreview={handlePreview}
        />

        {/* 压缩选项 */}
        {files.length > 0 && (
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm space-y-4">
            <h3 className="font-semibold text-gray-900">压缩选项</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {/* 左侧：根据是否走 GIF 路径，显示颜色数 / 质量 */}
              {useGifControls ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    GIF 颜色数: {options.gifColors ?? 128}
                  </label>
                  <select
                    value={String(options.gifColors ?? 128)}
                    onChange={(e) =>
                      setOptions({
                        ...options,
                        gifColors: Number(e.target.value) as GifColorCount,
                      })
                    }
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                  >
                    {GIF_COLOR_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-400">
                    颜色数越小，文件越小，视觉质量越低（适合表情包 / 贴图）
                  </p>
                </div>
              ) : showQualitySlider ? (
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
              ) : null}

              {/* 右侧：输出格式 */}
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
                  <option value="gif">GIF（动画）</option>
                </select>
                {options.format === "gif" && (
                  <p className="mt-1 text-xs text-amber-600">
                    仅当输入为 GIF 时才会输出；其他格式的文件将被跳过
                  </p>
                )}
                {options.format === "original" && hasAnyGif && !gifFilesOnly && (
                  <p className="mt-1 text-xs text-amber-600">
                    混合批次：GIF 文件将使用默认 128 色压缩（不受质量滑块影响），其他文件按此质量压缩
                  </p>
                )}
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

        {/* 错误汇总 */}
        {hasErrors && (
          <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">
            共 {errors.size} 个文件处理失败（已在上方列表标红）。常见原因：选择输出 GIF 但文件不是 GIF。
          </div>
        )}
      </div>
    </ToolLayout>
  );
}
