"use client";

import { useState, useCallback, useMemo } from "react";
import { Download, Eye, FileText, RotateCcw, Upload as UploadIcon } from "lucide-react";
import { ToolLayout } from "@/components/layout/ToolLayout";
import { FileDropZone } from "@/components/tools/FileDropZone";
import { ErrorAlert } from "@/components/common/ErrorAlert";
import {
  padImage,
  type PadMode,
  type PadOutputFormat,
  type PaddingPixels,
  type CanvasOffset,
} from "@/lib/image/pad";
import {
  downloadBlob,
  formatFileSize,
  generateOutputFilename,
  loadImage,
  readFileAsDataURL,
} from "@/lib/file";
import { AppError, type AppErrorCode, type FileItem } from "@/types";

export default function ImagePadPage() {
  const [file, setFile] = useState<FileItem | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [imageNatural, setImageNatural] = useState<{ width: number; height: number } | null>(null);
  const [mode, setMode] = useState<PadMode>("pixels");

  // 模式 1：4 边像素
  const [padding, setPadding] = useState<PaddingPixels>({
    top: 100,
    right: 100,
    bottom: 100,
    left: 100,
  });

  // 模式 2：画布 + 偏移
  const [canvas, setCanvas] = useState<{ width: string; height: string; dx: string; dy: string }>({
    width: "1200",
    height: "1200",
    dx: "0",
    dy: "0",
  });

  const [bgColor, setBgColor] = useState<string>("#000000");
  const [transparent, setTransparent] = useState(false);
  const [format, setFormat] = useState<PadOutputFormat>("original");
  const [quality, setQuality] = useState(92);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{ blob: Blob; width: number; height: number } | null>(null);
  const [error, setError] = useState<{ code?: AppErrorCode; message: string } | null>(null);

  // ─── 文件处理 ────────────────────────────────────
  const handleFileAdded = useCallback(async (newFiles: FileItem[]) => {
    if (newFiles.length === 0) return;
    const f = newFiles[0];
    setFile(f);
    setResult(null);
    setError(null);

    let dataUrl: string;
    if (f.preview) {
      dataUrl = f.preview;
      setImageSrc(dataUrl);
    } else {
      dataUrl = await readFileAsDataURL(f.file);
      setImageSrc(dataUrl);
    }

    // 读取原图尺寸，并同步把画布模式的初始值设为原图尺寸（避免 < 原图校验失败）
    try {
      const img = await loadImage(dataUrl);
      setImageNatural({ width: img.naturalWidth, height: img.naturalHeight });
      setCanvas({
        width: String(img.naturalWidth),
        height: String(img.naturalHeight),
        dx: "0",
        dy: "0",
      });
    } catch {
      setImageNatural(null);
    }
  }, []);

  const handleRemove = useCallback(() => {
    setFile(null);
    setImageSrc(null);
    setImageNatural(null);
    setResult(null);
    setError(null);
  }, []);

  // ─── 实时计算预览尺寸 ─────────────────────────────
  const previewLayout = useMemo(() => {
    if (!imageNatural) return null;
    if (mode === "pixels") {
      return {
        canvasWidth: imageNatural.width + padding.left + padding.right,
        canvasHeight: imageNatural.height + padding.top + padding.bottom,
        drawX: padding.left,
        drawY: padding.top,
      };
    } else {
      const cW = parseInt(canvas.width, 10) || 0;
      const cH = parseInt(canvas.height, 10) || 0;
      const dx = parseInt(canvas.dx, 10) || 0;
      const dy = parseInt(canvas.dy, 10) || 0;
      const baseX = (cW - imageNatural.width) / 2;
      const baseY = (cH - imageNatural.height) / 2;
      return {
        canvasWidth: cW,
        canvasHeight: cH,
        drawX: Math.max(0, Math.min(cW - imageNatural.width, baseX + dx)),
        drawY: Math.max(0, Math.min(cH - imageNatural.height, baseY + dy)),
      };
    }
  }, [imageNatural, mode, padding, canvas]);

  // ─── 校验 ─────────────────────────────────────────
  const validate = useCallback((): string | null => {
    if (!imageNatural) return "请先上传图片";
    if (mode === "pixels") {
      if (padding.top < 0 || padding.right < 0 || padding.bottom < 0 || padding.left < 0) {
        return "4 边像素数必须 ≥ 0";
      }
    } else {
      const cW = parseInt(canvas.width, 10);
      const cH = parseInt(canvas.height, 10);
      if (!cW || !cH) return "请输入画布宽高";
      if (cW < imageNatural.width || cH < imageNatural.height) {
        return `画布尺寸（${cW}×${cH}）必须 ≥ 原图尺寸（${imageNatural.width}×${imageNatural.height}）`;
      }
    }
    return null;
  }, [imageNatural, mode, padding, canvas]);

  const validationError = validate();

  // ─── 处理与下载 ───────────────────────────────────
  const handleProcess = useCallback(async () => {
    if (!file || validationError) {
      if (validationError) setError({ code: "INVALID_INPUT", message: validationError });
      return;
    }
    setProcessing(true);
    setError(null);
    setResult(null);

    try {
      const options =
        mode === "pixels"
          ? {
              mode: "pixels" as const,
              pixels: padding,
              backgroundColor: transparent ? "transparent" : bgColor,
              format,
              quality: quality / 100,
            }
          : {
              mode: "canvas-offset" as const,
              canvasOffset: {
                width: parseInt(canvas.width, 10),
                height: parseInt(canvas.height, 10),
                dx: parseInt(canvas.dx, 10) || 0,
                dy: parseInt(canvas.dy, 10) || 0,
              } as CanvasOffset,
              backgroundColor: transparent ? "transparent" : bgColor,
              format,
              quality: quality / 100,
            };

      const { blob, width, height } = await padImage(file.file, options);
      setResult({ blob, width, height });
    } catch (err) {
      if (err instanceof AppError) {
        setError({ code: err.code, message: err.message });
      } else {
        setError({ code: "PROCESS_FAILED", message: "图片扩展失败，请重试" });
      }
    } finally {
      setProcessing(false);
    }
  }, [file, validationError, mode, padding, canvas, transparent, bgColor, format, quality]);

  const handleDownload = useCallback(() => {
    if (!result || !file) return;
    const ext = transparent ? "png" : format === "original" ? undefined : format;
    const name = generateOutputFilename(file.name, "padded", ext);
    downloadBlob(result.blob, name);
  }, [result, file, format, transparent]);

  const handlePreview = useCallback(() => {
    if (!result) return;
    const url = URL.createObjectURL(result.blob);
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(
        `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><title>预览</title><style>html,body{margin:0;height:100%}body{background:#f3f4f6;display:flex;align-items:center;justify-content:center}img{max-width:96%;max-height:96vh;box-shadow:0 4px 24px rgba(0,0,0,.15);background:white}</style></head><body><img src="${url}"/></body></html>`
      );
      w.document.close();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, [result]);

  return (
    <ToolLayout
      title="图片扩展填充"
      description="在原图四周扩展画布，原图 1:1 放置，支持按 4 边像素或画布尺寸 + 中心偏移"
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
          maxFiles={1}
          onFilesAdded={handleFileAdded}
          label="拖拽图片到此处，或点击选择（仅支持单张图片）"
        />

        {error && (
          <ErrorAlert
            code={error.code}
            message={error.message}
            onRetry={handleProcess}
            onClose={() => setError(null)}
          />
        )}

        {file && (
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm space-y-5">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-brand-500" />
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">{file.name}</p>
                <p className="text-xs text-gray-400">{formatFileSize(file.size)}</p>
              </div>
              <button
                onClick={handleRemove}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200 transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                重新选择
              </button>
            </div>

            {imageNatural && (
              <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                <span className="font-medium text-gray-700">原始图像：</span>
                {imageNatural.width} × {imageNatural.height} 像素
                <span className="ml-2 text-gray-400">·</span>
                <span className="ml-2">{file.type || "未知格式"}</span>
              </div>
            )}

            {/* 预览区（固定 320px 高，画布按 aspectRatio 自适应居中） */}
            {imageSrc && imageNatural && previewLayout && previewLayout.canvasWidth > 0 && (
              <div
                className="relative w-full h-[320px] overflow-hidden rounded-lg flex items-center justify-center"
                style={{
                  background:
                    "repeating-conic-gradient(#e5e7eb 0% 25%, #f3f4f6 0% 50%) 50% / 16px 16px",
                }}
              >
                <div
                  className="relative shadow-md"
                  style={{
                    // 高度撑满父容器 320px，宽度按 aspectRatio 自动计算
                    // 同时 maxWidth:100% 防止宽画布（横长画布）超出
                    height: "100%",
                    aspectRatio: `${previewLayout.canvasWidth} / ${previewLayout.canvasHeight}`,
                    maxWidth: "100%",
                    background: transparent ? "transparent" : bgColor,
                    boxShadow: "0 0 0 1px rgba(0,0,0,0.08)",
                  }}
                >
                  <img
                    src={imageSrc}
                    alt="原图预览"
                    className="absolute pointer-events-none"
                    style={{
                      left: `${(previewLayout.drawX / previewLayout.canvasWidth) * 100}%`,
                      top: `${(previewLayout.drawY / previewLayout.canvasHeight) * 100}%`,
                      width: `${(imageNatural.width / previewLayout.canvasWidth) * 100}%`,
                      height: `${(imageNatural.height / previewLayout.canvasHeight) * 100}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {/* 模式切换 + 实时摘要 */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">扩展选项</h3>
                {previewLayout && (
                  <span className="text-xs text-gray-500">
                    扩展后尺寸：
                    <span className="font-medium text-gray-700">
                      {previewLayout.canvasWidth} × {previewLayout.canvasHeight}
                    </span>
                  </span>
                )}
              </div>

              {/* 模式 tabs */}
              <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
                {([
                  { key: "pixels", label: "按 4 边像素" },
                  { key: "canvas-offset", label: "按画布 + 偏移" },
                ] as const).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setMode(key)}
                    className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                      mode === key
                        ? "bg-white text-brand-600 shadow-sm"
                        : "text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* 模式 1：4 边像素 */}
              {mode === "pixels" && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {(["top", "right", "bottom", "left"] as const).map((side) => (
                    <div key={side}>
                      <label className="block text-xs text-gray-500 mb-1">
                        {side === "top" ? "上边" : side === "bottom" ? "下边" : side === "left" ? "左边" : "右边"} (px)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={padding[side]}
                        onChange={(e) =>
                          setPadding((p) => ({ ...p, [side]: Math.max(0, parseInt(e.target.value, 10) || 0) }))
                        }
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* 模式 2：画布 + 偏移 */}
              {mode === "canvas-offset" && (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {([
                      { key: "width", label: "画布宽度" },
                      { key: "height", label: "画布高度" },
                      { key: "dx", label: "水平偏移" },
                      { key: "dy", label: "垂直偏移" },
                    ] as const).map(({ key, label }) => (
                      <div key={key}>
                        <label className="block text-xs text-gray-500 mb-1">
                          {label} (px)
                          {key === "dx" && <span className="ml-1 text-gray-400">·0 居中</span>}
                          {key === "dy" && <span className="ml-1 text-gray-400">·0 居中</span>}
                        </label>
                        <input
                          type="number"
                          value={canvas[key]}
                          min={key === "width" || key === "height" ? 1 : undefined}
                          onChange={(e) => {
                            const val = e.target.value;
                            setCanvas((c) => ({ ...c, [key]: val }));
                          }}
                          className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1 ${
                            validationError && (key === "width" || key === "height")
                              ? "border-red-300 focus:border-red-500 focus:ring-red-500"
                              : "border-gray-200 focus:border-brand-500 focus:ring-brand-500"
                          }`}
                        />
                      </div>
                    ))}
                  </div>

                  {validationError && (
                    <p className="text-xs text-red-600">{validationError}</p>
                  )}
                </>
              )}

              {/* 背景 + 格式 */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">输出格式</label>
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
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">背景颜色</label>
                  <div className="flex items-center gap-3">
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
                        <span className="text-xs text-gray-500">{bgColor}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {(format === "jpeg" || format === "webp") && !transparent && (
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

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  onClick={handleProcess}
                  disabled={processing || !!validationError || !file}
                  className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-3 text-sm font-medium text-white shadow-lg shadow-brand-200 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <UploadIcon className="h-5 w-5" />
                  {processing ? "处理中..." : "开始扩展"}
                </button>
              </div>
            </div>
          </div>
        )}

        {result && (
          <div className="rounded-2xl border border-green-100 bg-green-50 p-6 animate-fade-in">
            <h3 className="font-semibold text-green-800 mb-3">扩展完成</h3>
            <p className="text-sm text-green-700 mb-4">
              输出尺寸：<span className="font-medium">{result.width} × {result.height}</span> 像素
              <span className="mx-2 text-green-400">·</span>
              大小：{formatFileSize(result.blob.size)}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handlePreview}
                className="inline-flex items-center gap-2 rounded-xl border-2 border-blue-500 bg-blue-50 px-5 py-3 text-sm font-medium text-blue-700 hover:bg-blue-100 transition-colors"
              >
                <Eye className="h-5 w-5" />
                预览
              </button>
              <button
                onClick={handleDownload}
                className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-6 py-3 text-sm font-medium text-white hover:bg-green-700 transition-colors shadow-lg shadow-green-200"
              >
                <Download className="h-5 w-5" />
                下载
              </button>
            </div>
          </div>
        )}
      </div>
    </ToolLayout>
  );
}
