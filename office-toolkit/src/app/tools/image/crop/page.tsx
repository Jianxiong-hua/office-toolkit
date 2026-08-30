"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import Cropper from "react-easy-crop";
import {
  Download,
  RotateCcw,
  FlipHorizontal,
  FlipVertical,
  AlertCircle,
  X,
} from "lucide-react";
import { ToolLayout } from "@/components/layout/ToolLayout";
import { FileDropZone } from "@/components/tools/FileDropZone";
import { FileList, type FileResult } from "@/components/tools/FileList";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ErrorAlert } from "@/components/common/ErrorAlert";
import { ProcessProgress } from "@/components/common/ProcessProgress";
import { cropImage, type CropOutputFormat } from "@/lib/image/crop";
import {
  downloadBlob,
  generateOutputFilename,
  loadImage,
  readFileAsDataURL,
} from "@/lib/file";
import { AppError, type AppErrorCode, type FileItem } from "@/types";
import type { Point, Area } from "react-easy-crop";

/** "original" = 保持原始宽高比；"custom" = 自定义宽高比；其余为固定数值比例 */
const aspectRatios: { value: number | "original" | "custom"; label: string }[] = [
  { value: "original", label: "原始宽高比" },
  { value: 1, label: "1:1" },
  { value: 4 / 3, label: "4:3" },
  { value: 16 / 9, label: "16:9" },
  { value: 3 / 4, label: "3:4" },
  { value: 9 / 16, label: "9:16" },
  { value: "custom", label: "自定义" },
];

const ZOOM_MIN = 1;
const ZOOM_MAX = 5;
/** 缩放步进 0.01，拖动更平滑 */
const ZOOM_STEP = 0.01;
const ROTATION_MIN = -180;
const ROTATION_MAX = 180;
/** 旋转最小分辨率 0.1° */
const ROTATION_STEP = 0.1;

/** 归一化到 (-180, 180] 并保留 0.1° 精度，使 ±90° 快捷键可循环旋转 */
function normalizeRotation(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const wrapped = ((((value + 180) % 360) + 360) % 360) - 180;
  return Math.round(wrapped * 10) / 10;
}

export default function ImageCropPage() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [dimensions, setDimensions] = useState<
    Map<string, { width: number; height: number }>
  >(new Map());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [displaySrc, setDisplaySrc] = useState<string | null>(null);
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [aspectMode, setAspectMode] = useState<number | "original" | "custom">(1);
  /** 自定义宽高比的原始文本，允许输入过程中的中间态 */
  const [customWidthText, setCustomWidthText] = useState("16");
  const [customHeightText, setCustomHeightText] = useState("9");
  const [rotation, setRotation] = useState(0);
  /** 旋转输入框的原始文本，允许输入过程中的中间态（如 "-"、"12."） */
  const [rotationText, setRotationText] = useState("0");
  const [flipX, setFlipX] = useState(false);
  const [flipY, setFlipY] = useState(false);
  const [format, setFormat] = useState<CropOutputFormat>("original");
  const [quality, setQuality] = useState(92);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<Map<string, FileResult>>(new Map());
  const [error, setError] = useState<{ code?: AppErrorCode; message: string } | null>(null);
  /** 批量添加时分辨率不一致的提示 */
  const [rejectMessage, setRejectMessage] = useState<string | null>(null);

  const currentFile = files[currentIndex];
  const imageSrc = currentFile?.preview ?? null;
  const currentDimensions = currentFile ? dimensions.get(currentFile.id) : undefined;
  /** 自定义比例：非法输入（空/0/负数）时退化为 1:1，避免 Cropper 计算出 NaN */
  const customAspect = useMemo(() => {
    const w = Number(customWidthText);
    const h = Number(customHeightText);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 1;
    return w / h;
  }, [customWidthText, customHeightText]);

  const aspect =
    aspectMode === "original"
      ? currentDimensions
        ? currentDimensions.width / currentDimensions.height
        : 1
      : aspectMode === "custom"
        ? customAspect
        : aspectMode;

  /**
   * 根据 flipX/flipY 实时生成翻转后的图片 src
   * 因为 <Cropper> 不支持 flipX/flipY props，需要预处理 image
   */
  useEffect(() => {
    if (!imageSrc) {
      setDisplaySrc(null);
      return;
    }
    if (!flipX && !flipY) {
      setDisplaySrc(imageSrc);
      return;
    }

    let cancelled = false;
    const applyFlip = async () => {
      try {
        const img = await loadImage(imageSrc);
        if (cancelled) return;
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.translate(flipX ? canvas.width : 0, flipY ? canvas.height : 0);
        ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
        ctx.drawImage(img, 0, 0);
        if (!cancelled) setDisplaySrc(canvas.toDataURL());
      } catch {
        if (!cancelled) setDisplaySrc(imageSrc);
      }
    };
    applyFlip();
    return () => {
      cancelled = true;
    };
  }, [imageSrc, flipX, flipY]);

  /**
   * 批量添加：所有图片分辨率必须与第一张一致，否则拒绝加入并提示
   */
  const handleFilesAdded = useCallback(
    async (newFiles: FileItem[]) => {
      const withPreviews = await Promise.all(
        newFiles.map(async (f) => {
          if (f.type.startsWith("image/")) {
            return { ...f, preview: await readFileAsDataURL(f.file) };
          }
          return f;
        })
      );

      const sizeEntries = await Promise.all(
        withPreviews.map(async (f) => {
          if (!f.preview) return null;
          try {
            const img = await loadImage(f.preview);
            return {
              id: f.id,
              name: f.name,
              width: img.naturalWidth,
              height: img.naturalHeight,
            };
          } catch {
            return null;
          }
        })
      );

      // 基准分辨率取「已有第一张」，没有则由本次第一张确定
      let base = files[0] ? dimensions.get(files[0].id) : undefined;
      const accepted: FileItem[] = [];
      const acceptedSizes = new Map<string, { width: number; height: number }>();
      const rejected: string[] = [];

      withPreviews.forEach((f, i) => {
        const size = sizeEntries[i];
        if (!size) {
          rejected.push(`${f.name}（无法读取分辨率）`);
          return;
        }
        if (!base) {
          base = { width: size.width, height: size.height };
        } else if (size.width !== base.width || size.height !== base.height) {
          rejected.push(`${f.name}（${size.width}×${size.height}）`);
          return;
        }
        accepted.push(f);
        acceptedSizes.set(f.id, { width: size.width, height: size.height });
      });

      if (accepted.length > 0) {
        setFiles((prev) => [...prev, ...accepted]);
        setDimensions((prev) => new Map([...prev, ...acceptedSizes]));
        setResults(new Map());
      }

      if (rejected.length > 0) {
        setRejectMessage(
          `已忽略 ${rejected.length} 张图片：${rejected.join("、")}。批量处理要求所有图片分辨率与第一张一致${
            base ? `（${base.width}×${base.height}）` : ""
          }`
        );
      } else {
        setRejectMessage(null);
      }
    },
    [files, dimensions]
  );

  const handleRemove = useCallback(
    (id: string) => {
      const removedIndex = files.findIndex((f) => f.id === id);
      if (removedIndex === -1) return;

      const next = files.filter((f) => f.id !== id);
      setFiles(next);
      setDimensions((prev) => {
        const map = new Map(prev);
        map.delete(id);
        return map;
      });
      setResults((prev) => {
        const map = new Map(prev);
        map.delete(id);
        return map;
      });

      if (removedIndex < currentIndex) {
        setCurrentIndex(currentIndex - 1);
      } else if (removedIndex === currentIndex) {
        setCurrentIndex(Math.max(0, Math.min(currentIndex, next.length - 1)));
      }
    },
    [files, currentIndex]
  );

  const handleReselect = useCallback(() => {
    setFiles([]);
    setDimensions(new Map());
    setResults(new Map());
    setCurrentIndex(0);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    setError(null);
    setRejectMessage(null);
  }, []);

  const handleSelectFile = useCallback(
    (id: string) => {
      const index = files.findIndex((f) => f.id === id);
      if (index >= 0) setCurrentIndex(index);
    },
    [files]
  );

  const handleCropComplete = useCallback((_: Area, croppedAreaPixels: Area) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const updateRotation = useCallback((value: number) => {
    const next = normalizeRotation(value);
    setRotation(next);
    setRotationText(String(next));
  }, []);

  const handleRotationInput = useCallback(
    (raw: string) => {
      setRotationText(raw);
      const parsed = Number(raw);
      if (raw.trim() !== "" && Number.isFinite(parsed)) {
        setRotation(normalizeRotation(parsed));
      }
    },
    []
  );

  /** 批量裁剪：同一套「裁剪框 + 旋转 + 镜像」参数应用到所有图片 */
  const handleProcess = useCallback(async () => {
    if (files.length === 0 || !croppedAreaPixels) return;
    setProcessing(true);
    setProgress(0);
    setError(null);
    setResults(new Map());

    try {
      const next = new Map<string, FileResult>();
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const { blob, width, height } = await cropImage(file.file, {
          crop: {
            x: croppedAreaPixels.x,
            y: croppedAreaPixels.y,
            width: croppedAreaPixels.width,
            height: croppedAreaPixels.height,
          },
          rotation,
          flipX,
          flipY,
          format,
          quality: quality / 100,
        });
        next.set(file.id, { blob, size: blob.size, info: `→ ${width}×${height}` });
        setProgress(Math.round(((i + 1) / files.length) * 100));
      }
      setResults(next);
    } catch (err) {
      if (err instanceof AppError) {
        setError({ code: err.code, message: err.message });
      } else {
        setError({ code: "PROCESS_FAILED", message: "图片裁剪失败，请重试" });
      }
    } finally {
      setProcessing(false);
    }
  }, [files, croppedAreaPixels, rotation, flipX, flipY, format, quality]);

  const handleDownload = useCallback(
    (id: string) => {
      const result = results.get(id);
      const file = files.find((f) => f.id === id);
      if (!result || !file) return;
      const ext = format === "original" ? undefined : format;
      downloadBlob(result.blob, generateOutputFilename(file.name, "cropped", ext));
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
        zip.file(generateOutputFilename(file.name, "cropped", ext), result.blob);
      }
    });
    const zipBlob = await zip.generateAsync({ type: "blob" });
    downloadBlob(zipBlob, "cropped_images.zip");
  }, [files, results, format]);

  return (
    <ToolLayout
      title="图像旋转、镜像、裁剪"
      description="任意角度旋转、镜像翻转、多比例裁剪，支持同分辨率图片批量处理"
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
          label="拖拽图片到此处，或点击选择（可继续添加，分辨率需一致）"
        />

        {rejectMessage && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{rejectMessage}</span>
            <button
              type="button"
              onClick={() => setRejectMessage(null)}
              className="shrink-0 rounded-md p-0.5 text-amber-500 hover:bg-amber-100"
              title="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

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
          onPreview={handlePreview}
          selectedId={currentFile?.id}
          onSelect={handleSelectFile}
        />

        {currentFile && (
          <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900">变换与裁剪</h3>
              <button
                onClick={handleReselect}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200 transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                重新选择
              </button>
            </div>

            <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 mb-3">
              <span className="font-medium text-gray-700">基准分辨率：</span>
              {currentDimensions
                ? `${currentDimensions.width} × ${currentDimensions.height} 像素`
                : "读取中..."}
              <span className="ml-2 text-gray-400">·</span>
              <span className="ml-2">共 {files.length} 张</span>
              <span className="ml-2 text-gray-400">·</span>
              <span className="ml-2">
                {croppedAreaPixels
                  ? `输出 ${croppedAreaPixels.width} × ${croppedAreaPixels.height} 像素`
                  : "未确定裁剪区域"}
              </span>
              {files.length > 1 && (
                <span className="ml-2 text-gray-400">· 点击文件名切换预览</span>
              )}
            </div>

            {imageSrc && (
              <>
                <div className="relative h-[320px] w-full rounded-xl bg-gray-900 overflow-hidden">
                  <Cropper
                    image={displaySrc ?? imageSrc}
                    crop={crop}
                    zoom={zoom}
                    aspect={aspect}
                    rotation={rotation}
                    minZoom={ZOOM_MIN}
                    maxZoom={ZOOM_MAX}
                    zoomSpeed={0.3}
                    onCropChange={setCrop}
                    onZoomChange={setZoom}
                    onCropComplete={handleCropComplete}
                  />
                </div>

                <div className="mt-4 space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-sm font-medium text-gray-700">
                        缩放
                      </label>
                      <span className="text-xs tabular-nums text-gray-500">
                        {zoom.toFixed(2)}×
                      </span>
                    </div>
                    <input
                      type="range"
                      min={ZOOM_MIN}
                      max={ZOOM_MAX}
                      step={ZOOM_STEP}
                      value={zoom}
                      onChange={(e) => setZoom(Number(e.target.value))}
                      className="w-full accent-brand-600"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      裁剪比例
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {aspectRatios.map((ratio) => (
                        <button
                          key={ratio.label}
                          onClick={() => setAspectMode(ratio.value)}
                          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                            aspectMode === ratio.value
                              ? "bg-brand-600 text-white"
                              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                          }`}
                        >
                          {ratio.label}
                        </button>
                      ))}
                    </div>
                    {aspectMode === "custom" && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="text-xs text-gray-500">宽</span>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={customWidthText}
                          onChange={(e) => setCustomWidthText(e.target.value)}
                          className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-right text-sm tabular-nums focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                        />
                        <span className="text-xs text-gray-500">:</span>
                        <span className="text-xs text-gray-500">高</span>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={customHeightText}
                          onChange={(e) => setCustomHeightText(e.target.value)}
                          className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-right text-sm tabular-nums focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                        />
                        <span className="text-xs text-gray-400">
                          ≈ {customAspect.toFixed(3)}
                        </span>
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-sm font-medium text-gray-700">
                        旋转角度
                      </label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={ROTATION_MIN}
                          max={ROTATION_MAX}
                          step={ROTATION_STEP}
                          value={rotationText}
                          onChange={(e) => handleRotationInput(e.target.value)}
                          onBlur={() => setRotationText(String(rotation))}
                          className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-right text-sm tabular-nums focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                        />
                        <span className="text-sm text-gray-500">°</span>
                      </div>
                    </div>
                    <input
                      type="range"
                      min={ROTATION_MIN}
                      max={ROTATION_MAX}
                      step={ROTATION_STEP}
                      value={rotation}
                      onChange={(e) => updateRotation(Number(e.target.value))}
                      className="w-full accent-brand-600"
                    />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        onClick={() => updateRotation(rotation - 90)}
                        className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200 transition-colors"
                      >
                        −90°
                      </button>
                      <button
                        onClick={() => updateRotation(rotation - ROTATION_STEP)}
                        className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200 transition-colors"
                      >
                        −{ROTATION_STEP}°
                      </button>
                      <button
                        onClick={() => updateRotation(rotation + ROTATION_STEP)}
                        className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200 transition-colors"
                      >
                        +{ROTATION_STEP}°
                      </button>
                      <button
                        onClick={() => updateRotation(rotation + 90)}
                        className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200 transition-colors"
                      >
                        +90°
                      </button>
                      <button
                        onClick={() => updateRotation(0)}
                        className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200 transition-colors"
                      >
                        归零
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      镜像
                    </label>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        onClick={() => setFlipX((prev) => !prev)}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                          flipX
                            ? "bg-brand-100 text-brand-700"
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        }`}
                      >
                        <FlipHorizontal className="h-4 w-4" />
                        水平翻转
                      </button>
                      <button
                        onClick={() => setFlipY((prev) => !prev)}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                          flipY
                            ? "bg-brand-100 text-brand-700"
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        }`}
                      >
                        <FlipVertical className="h-4 w-4" />
                        垂直翻转
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        输出格式
                      </label>
                      <select
                        value={format}
                        onChange={(e) => setFormat(e.target.value as CropOutputFormat)}
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

                  <div className="flex flex-wrap items-center gap-3">
                    <DownloadButton
                      onClick={handleProcess}
                      loading={processing}
                      disabled={!croppedAreaPixels}
                      label={
                        files.length > 1
                          ? `裁剪全部 ${files.length} 张`
                          : "裁剪当前图片"
                      }
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
              </>
            )}
          </div>
        )}

        {processing && (
          <ProcessProgress message="正在裁剪图片..." progress={progress} />
        )}
      </div>
    </ToolLayout>
  );
}
