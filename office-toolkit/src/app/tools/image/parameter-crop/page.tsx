"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, RotateCcw, AlertCircle, X } from "lucide-react";
import { ToolLayout } from "@/components/layout/ToolLayout";
import { FileDropZone } from "@/components/tools/FileDropZone";
import { FileList, type FileResult } from "@/components/tools/FileList";
import { ErrorAlert } from "@/components/common/ErrorAlert";
import { ProcessProgress } from "@/components/common/ProcessProgress";
import {
  cropImageByRegion,
  type CropByRegionOptions,
  type CropOutputFormat,
} from "@/lib/image/crop";
import {
  downloadBlob,
  formatFileSize,
  generateOutputFilename,
  loadImage,
  readFileAsDataURL,
} from "@/lib/file";
import { AppError, type AppErrorCode, type FileItem } from "@/types";

/** 预览容器固定高度（像素） */
const CONTAINER_HEIGHT = 320;

/** 原图坐标系下裁剪框的最小尺寸（像素），避免缩到看不见 */
const MIN_CROP_SIZE = 10;

interface DisplayInfo {
  scale: number;
  displayW: number;
  displayH: number;
  offsetX: number;
  offsetY: number;
}

interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

type HandlePos = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";

interface DragState {
  startX: number;
  startY: number;
  initRect: Rect;
  mode: "move" | HandlePos;
}

/**
 * 模仿 CSS object-fit: contain：
 * 图片在固定尺寸容器中等比缩放并居中。
 * 返回的 offsetX/Y 即图片在容器内的左上偏移量，裁剪框的容器坐标 = offset + 原图坐标 × scale。
 */
function calcDisplayInfo(
  containerW: number,
  containerH: number,
  imageW: number,
  imageH: number
): DisplayInfo {
  if (!containerW || !containerH || !imageW || !imageH) {
    return { scale: 0, displayW: 0, displayH: 0, offsetX: 0, offsetY: 0 };
  }
  const scale = Math.min(containerW / imageW, containerH / imageH);
  const displayW = imageW * scale;
  const displayH = imageH * scale;
  const offsetX = (containerW - displayW) / 2;
  const offsetY = (containerH - displayH) / 2;
  return { scale, displayW, displayH, offsetX, offsetY };
}

/** 移动裁剪框（保持原尺寸不变，仅平移） */
function applyMove(
  init: Rect,
  dx: number,
  dy: number,
  maxW: number,
  maxH: number
): Rect {
  const w = init.x2 - init.x1;
  const h = init.y2 - init.y1;
  let nx1 = init.x1 + dx;
  let ny1 = init.y1 + dy;
  nx1 = Math.max(0, Math.min(maxW - w, nx1));
  ny1 = Math.max(0, Math.min(maxH - h, ny1));
  return {
    x1: Math.round(nx1),
    y1: Math.round(ny1),
    x2: Math.round(nx1 + w),
    y2: Math.round(ny1 + h),
  };
}

/** 调整裁剪框大小（按 handle 决定哪些边动） */
function applyResize(
  init: Rect,
  handle: HandlePos,
  dx: number,
  dy: number,
  maxW: number,
  maxH: number
): Rect {
  let { x1, y1, x2, y2 } = init;

  // 1) 根据 handle 调整对应的边
  if (handle.includes("e")) x2 = init.x2 + dx;
  if (handle.includes("s")) y2 = init.y2 + dy;
  if (handle.includes("w")) x1 = init.x1 + dx;
  if (handle.includes("n")) y1 = init.y1 + dy;

  // 2) clamp 到原图边界
  x1 = Math.max(0, x1);
  y1 = Math.max(0, y1);
  x2 = Math.min(maxW, x2);
  y2 = Math.min(maxH, y2);

  // 3) 强制最小宽度
  if (x2 - x1 < MIN_CROP_SIZE) {
    if (handle.includes("w")) x1 = x2 - MIN_CROP_SIZE;
    else x2 = x1 + MIN_CROP_SIZE;
  }
  // 4) 强制最小高度
  if (y2 - y1 < MIN_CROP_SIZE) {
    if (handle.includes("n")) y1 = y2 - MIN_CROP_SIZE;
    else y2 = y1 + MIN_CROP_SIZE;
  }

  // 5) 边界与最小尺寸可能冲突，再次 clamp
  x1 = Math.max(0, x1);
  y1 = Math.max(0, y1);
  x2 = Math.min(maxW, x2);
  y2 = Math.min(maxH, y2);
  if (x2 - x1 < MIN_CROP_SIZE) {
    if (handle.includes("w")) x1 = Math.max(0, x2 - MIN_CROP_SIZE);
    else x2 = Math.min(maxW, x1 + MIN_CROP_SIZE);
  }
  if (y2 - y1 < MIN_CROP_SIZE) {
    if (handle.includes("n")) y1 = Math.max(0, y2 - MIN_CROP_SIZE);
    else y2 = Math.min(maxH, y1 + MIN_CROP_SIZE);
  }

  return {
    x1: Math.round(x1),
    y1: Math.round(y1),
    x2: Math.round(x2),
    y2: Math.round(y2),
  };
}

export default function ParameterCropPage() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [dimensions, setDimensions] = useState<
    Map<string, { width: number; height: number }>
  >(new Map());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [naturalW, setNaturalW] = useState(0);
  const [naturalH, setNaturalH] = useState(0);
  const [displayInfo, setDisplayInfo] = useState<DisplayInfo>({
    scale: 0,
    displayW: 0,
    displayH: 0,
    offsetX: 0,
    offsetY: 0,
  });
  const [rect, setRect] = useState<Rect>({ x1: 0, y1: 0, x2: 0, y2: 0 });
  const [format, setFormat] = useState<CropOutputFormat>("original");
  const [quality, setQuality] = useState(92);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<Map<string, FileResult>>(new Map());
  const [error, setError] = useState<{
    code?: AppErrorCode;
    message: string;
  } | null>(null);
  /** 批量添加时分辨率不一致的提示 */
  const [rejectMessage, setRejectMessage] = useState<string | null>(null);

  const currentFile = files[currentIndex];
  const imageSrc = currentFile?.preview ?? null;
  const currentDimensions = currentFile
    ? dimensions.get(currentFile.id)
    : undefined;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);

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

  /** 删除单个文件 */
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

  /** 清空全部，回到上传区 */
  const handleReselect = useCallback(() => {
    setFiles([]);
    setDimensions(new Map());
    setResults(new Map());
    setCurrentIndex(0);
    setNaturalW(0);
    setNaturalH(0);
    setDisplayInfo({
      scale: 0,
      displayW: 0,
      displayH: 0,
      offsetX: 0,
      offsetY: 0,
    });
    setRect({ x1: 0, y1: 0, x2: 0, y2: 0 });
    setError(null);
    setRejectMessage(null);
  }, []);

  /** 在文件列表中切换当前编辑的图片 */
  const handleSelectFile = useCallback(
    (id: string) => {
      const index = files.findIndex((f) => f.id === id);
      if (index >= 0) setCurrentIndex(index);
    },
    [files]
  );

  /** 读取原图原始像素尺寸 */
  useEffect(() => {
    if (!imageSrc) {
      setNaturalW(0);
      setNaturalH(0);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) {
        setNaturalW(img.naturalWidth);
        setNaturalH(img.naturalHeight);
      }
    };
    img.onerror = () => {
      if (!cancelled) {
        setError({ code: "PROCESS_FAILED", message: "无法读取图片尺寸" });
      }
    };
    img.src = imageSrc;
    return () => {
      cancelled = true;
    };
  }, [imageSrc]);

  /**
   * 监听容器尺寸 + 原图尺寸变化，重新计算 displayInfo
   * ResizeObserver 比单一 onLoad 触发更准确：窗口大小变化、容器宽度变化都会重算
   */
  useEffect(() => {
    if (!containerRef.current || !naturalW || !naturalH) return;
    const update = () => {
      const el = containerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setDisplayInfo(calcDisplayInfo(r.width, CONTAINER_HEIGHT, naturalW, naturalH));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(containerRef.current);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [naturalW, naturalH]);

  /** 原图尺寸确定后，初始化裁剪框为中央 80% 区域 */
  useEffect(() => {
    if (!naturalW || !naturalH) return;
    const marginX = Math.round(naturalW * 0.1);
    const marginY = Math.round(naturalH * 0.1);
    setRect({
      x1: marginX,
      y1: marginY,
      x2: naturalW - marginX,
      y2: naturalH - marginY,
    });
  }, [naturalW, naturalH]);

  /**
   * 拖动通用回调：mode 决定是 move（平移）还是某个 handle（调整大小）
   * 使用 pointer 事件统一处理鼠标和触屏
   */
  const handlePointerDown = useCallback(
    (mode: "move" | HandlePos) => (e: React.PointerEvent) => {
      if (!displayInfo.scale) return;
      e.preventDefault();
      e.stopPropagation();
      const initRect = { ...rect };
      dragStateRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        initRect,
        mode,
      };

      const handleMove = (ev: PointerEvent) => {
        const state = dragStateRef.current;
        if (!state || !displayInfo.scale) return;
        const dx = (ev.clientX - state.startX) / displayInfo.scale;
        const dy = (ev.clientY - state.startY) / displayInfo.scale;
        const next =
          state.mode === "move"
            ? applyMove(state.initRect, dx, dy, naturalW, naturalH)
            : applyResize(
                state.initRect,
                state.mode,
                dx,
                dy,
                naturalW,
                naturalH
              );
        setRect(next);
      };
      const handleUp = () => {
        dragStateRef.current = null;
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", handleUp);
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
      window.addEventListener("pointercancel", handleUp);
    },
    [displayInfo.scale, rect, naturalW, naturalH]
  );

  /** 坐标输入：限制范围 + 防止无效值 */
  const updateRectField = (field: keyof Rect, raw: number) => {
    if (isNaN(raw)) return;
    const v = Math.max(0, Math.floor(raw));
    setRect((prev) => ({ ...prev, [field]: v }));
  };

  /** 执行裁剪：同一套坐标应用到所有图片 */
  const handleProcess = useCallback(async () => {
    if (files.length === 0) return;
    const w = rect.x2 - rect.x1;
    const h = rect.y2 - rect.y1;
    if (w <= 0 || h <= 0) {
      setError({ code: "INVALID_INPUT", message: "裁剪区域无效，请检查坐标" });
      return;
    }
    setProcessing(true);
    setProgress(0);
    setError(null);
    setResults(new Map());
    try {
      const next = new Map<string, FileResult>();
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const opts: CropByRegionOptions = {
          x: rect.x1,
          y: rect.y1,
          width: w,
          height: h,
          format,
          quality: quality / 100,
        };
        const res = await cropImageByRegion(f.file, opts);
        next.set(f.id, {
          blob: res.blob,
          size: res.blob.size,
          info: `→ ${res.width}×${res.height}`,
        });
        setProgress(Math.round(((i + 1) / files.length) * 100));
      }
      setResults(next);
    } catch (err) {
      if (err instanceof AppError) {
        setError({ code: err.code, message: err.message });
      } else {
        setError({ code: "PROCESS_FAILED", message: "裁剪失败，请重试" });
      }
    } finally {
      setProcessing(false);
    }
  }, [files, rect, format, quality]);

  /** 单个下载 */
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

  /** 单个预览 */
  const handlePreview = useCallback(
    (id: string) => {
      const result = results.get(id);
      const file = files.find((f) => f.id === id);
      if (!result || !file) return;
      const url = URL.createObjectURL(result.blob);
      const w = window.open("", "_blank");
      if (w) {
        w.document.write(
          `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><title>${file.name}</title><style>html,body{margin:0;height:100%}body{background:#f3f4f6;display:flex;align-items:center;justify-content:center}img{max-width:96%;max-height:96vh;box-shadow:0 4px 24px rgba(0,0,0,.15);background:white}</style></head><body><img src="${url}"/></body></html>`
        );
        w.document.close();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    [results, files]
  );

  /** 打包下载全部结果 */
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

  // 当前裁剪框在容器中的几何参数（计算一次复用）
  const boxLeft = displayInfo.offsetX + rect.x1 * displayInfo.scale;
  const boxTop = displayInfo.offsetY + rect.y1 * displayInfo.scale;
  const boxW = (rect.x2 - rect.x1) * displayInfo.scale;
  const boxH = (rect.y2 - rect.y1) * displayInfo.scale;

  return (
    <ToolLayout
      title="图片参数化裁剪"
      description="通过拖动裁剪框或输入左上/右下坐标精确裁剪，支持同分辨率图片批量处理"
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

        {currentFile && imageSrc && naturalW > 0 && (
          <>
            {/* 文件信息条 */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-100 bg-white p-3">
              <div className="text-sm text-gray-600">
                原始图像：
                <span className="font-medium text-gray-900">
                  {naturalW} × {naturalH}
                </span>{" "}
                像素
                <span className="mx-2 text-gray-300">·</span>
                裁剪区域：
                <span className="font-medium text-gray-900">
                  {rect.x2 - rect.x1} × {rect.y2 - rect.y1}
                </span>{" "}
                像素
                <span className="mx-2 text-gray-300">·</span>
                {formatFileSize(currentFile.size)}
                {files.length > 1 && (
                  <>
                    <span className="mx-2 text-gray-300">·</span>
                    共 {files.length} 张，同一坐标应用到全部
                  </>
                )}
              </div>
              <button
                onClick={handleReselect}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200 transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                重新选择
              </button>
            </div>

            {/* 预览容器：固定高度 + 暗色 letterbox，图片 object-contain 居中 */}
            <div
              ref={containerRef}
              className="relative w-full select-none overflow-hidden rounded-xl bg-gray-900"
              style={{ height: `${CONTAINER_HEIGHT}px` }}
            >
              <img
                src={imageSrc}
                alt="原图"
                className="pointer-events-none absolute inset-0 h-full w-full object-contain"
                draggable={false}
              />

              {displayInfo.scale > 0 && (
                <>
                  {/* 暗色遮罩：覆盖裁剪框之外的区域（4 段拼接） */}
                  <div className="pointer-events-none absolute inset-0">
                    {/* 上 */}
                    <div
                      className="absolute left-0 right-0 top-0 bg-black/55"
                      style={{ height: boxTop }}
                    />
                    {/* 下 */}
                    <div
                      className="absolute bottom-0 left-0 right-0 bg-black/55"
                      style={{ height: CONTAINER_HEIGHT - (boxTop + boxH) }}
                    />
                    {/* 左 */}
                    <div
                      className="absolute left-0 bg-black/55"
                      style={{
                        top: boxTop,
                        height: boxH,
                        width: boxLeft,
                      }}
                    />
                    {/* 右 */}
                    <div
                      className="absolute right-0 bg-black/55"
                      style={{
                        top: boxTop,
                        height: boxH,
                        left: boxLeft + boxW,
                      }}
                    />
                  </div>

                  {/* 裁剪框 */}
                  <div
                    className="absolute"
                    style={{
                      left: boxLeft,
                      top: boxTop,
                      width: boxW,
                      height: boxH,
                    }}
                  >
                    {/* 白色边框 + 1/3 网格线 */}
                    <div className="pointer-events-none absolute inset-0 border-2 border-white">
                      <div className="absolute left-0 right-0 top-1/3 h-px bg-white/60" />
                      <div className="absolute left-0 right-0 top-2/3 h-px bg-white/60" />
                      <div className="absolute bottom-0 left-1/3 top-0 w-px bg-white/60" />
                      <div className="absolute bottom-0 left-2/3 top-0 w-px bg-white/60" />
                    </div>

                    {/* 中心：平移 */}
                    <div
                      onPointerDown={handlePointerDown("move")}
                      className="absolute inset-0 cursor-move"
                    />

                    {/* 四条边：调整大小（透明 hit area，hover 用 cursor 暗示） */}
                    <div
                      onPointerDown={handlePointerDown("n")}
                      className="absolute left-2 right-2 -top-1.5 h-3 cursor-n-resize"
                    />
                    <div
                      onPointerDown={handlePointerDown("s")}
                      className="absolute bottom-0 left-2 right-2 -bottom-1.5 h-3 cursor-s-resize"
                    />
                    <div
                      onPointerDown={handlePointerDown("w")}
                      className="absolute top-2 bottom-2 -left-1.5 w-3 cursor-w-resize"
                    />
                    <div
                      onPointerDown={handlePointerDown("e")}
                      className="absolute top-2 bottom-2 -right-1.5 right-0 w-3 cursor-e-resize"
                    />

                    {/* 四个角：调整大小（白色实心方块 + 蓝色细描边） */}
                    <div
                      onPointerDown={handlePointerDown("nw")}
                      className="absolute -left-1.5 -top-1.5 h-3.5 w-3.5 cursor-nw-resize rounded-sm border border-blue-500 bg-white shadow-sm"
                    />
                    <div
                      onPointerDown={handlePointerDown("ne")}
                      className="absolute -right-1.5 -top-1.5 h-3.5 w-3.5 cursor-ne-resize rounded-sm border border-blue-500 bg-white shadow-sm"
                    />
                    <div
                      onPointerDown={handlePointerDown("sw")}
                      className="absolute -bottom-1.5 -left-1.5 h-3.5 w-3.5 cursor-sw-resize rounded-sm border border-blue-500 bg-white shadow-sm"
                    />
                    <div
                      onPointerDown={handlePointerDown("se")}
                      className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-se-resize rounded-sm border border-blue-500 bg-white shadow-sm"
                    />
                  </div>
                </>
              )}
            </div>

            {/* 坐标输入（精确控制） */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <label className="text-xs text-gray-500">左上 X</label>
                <input
                  type="number"
                  min={0}
                  max={naturalW}
                  value={rect.x1}
                  onChange={(e) => updateRectField("x1", +e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">左上 Y</label>
                <input
                  type="number"
                  min={0}
                  max={naturalH}
                  value={rect.y1}
                  onChange={(e) => updateRectField("y1", +e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">右下 X</label>
                <input
                  type="number"
                  min={0}
                  max={naturalW}
                  value={rect.x2}
                  onChange={(e) => updateRectField("x2", +e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">右下 Y</label>
                <input
                  type="number"
                  min={0}
                  max={naturalH}
                  value={rect.y2}
                  onChange={(e) => updateRectField("y2", +e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
            </div>

            {/* 输出格式 + 质量 */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  输出格式
                </label>
                <select
                  value={format}
                  onChange={(e) =>
                    setFormat(e.target.value as CropOutputFormat)
                  }
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                >
                  <option value="original">保持原格式</option>
                  <option value="jpeg">JPEG</option>
                  <option value="png">PNG</option>
                  <option value="webp">WebP</option>
                </select>
              </div>
              {(format === "jpeg" || format === "webp") && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">
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

            {/* 操作按钮 */}
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handleProcess}
                disabled={processing}
                className="rounded-xl bg-brand-600 px-6 py-3 text-sm font-medium text-white hover:bg-brand-700 transition-colors disabled:opacity-50"
              >
                {processing
                  ? "处理中..."
                  : files.length > 1
                    ? `裁剪全部 ${files.length} 张`
                    : "裁剪"}
              </button>
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
          </>
        )}

        {processing && (
          <ProcessProgress message="正在裁剪图片..." progress={progress} />
        )}
      </div>
    </ToolLayout>
  );
}
