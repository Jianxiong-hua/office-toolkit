"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Crop,
  Download,
  Loader2,
  Minus,
  MousePointer2,
  Redo2,
  Ruler,
  X,
  Square,
  Trash2,
  Type as TypeIcon,
  Undo2,
} from "lucide-react";
import { ImageWorkbench } from "@/components/tools/ImageWorkbench";
import { ToolLayout } from "@/components/layout/ToolLayout";
import { ErrorAlert } from "@/components/common/ErrorAlert";
import { FileDropZone } from "@/components/tools/FileDropZone";
import {
  downloadBlob,
  generateOutputFilename,
  loadImage,
  readFileAsDataURL,
} from "@/lib/file";
import { adjustPixels, DEFAULT_ADJUST, type AdjustParams } from "@/lib/image/adjust";
import { AdjustPanel } from "./AdjustPanel";
import { AnnotationCanvas, measureLabel } from "./AnnotationCanvas";
import {
  ANNOTATION_COLORS,
  DASH_ARRAYS,
  DEFAULT_COLOR,
  DEFAULT_FONT_SIZE,
  DEFAULT_STROKE_WIDTH,
  FONT_SIZE_OPTIONS,
  DEFAULT_FILL_OPACITY,
  MEASURE_COLOR,
  MEASURE_LABEL_SIZE,
  STROKE_WIDTH_OPTIONS,
  TEXT_LINE_HEIGHT,
  type Annotation,
  type AnnotationTool,
  type LineDash,
} from "./types";

/** 预览降采样的长边上限；1200x900 约 108 万像素，全像素循环一次约 10-20ms */
const PREVIEW_MAX_EDGE = 1200;

/** hex（#rrggbb）→ rgba() 字符串，供 canvas 绘制半透明填充用 */
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return "rgba(" + ((n >> 16) & 255) + ", " + ((n >> 8) & 255) + ", " + (n & 255) + ", " + alpha + ")";
}

/** 标注列表中的简要描述 */
function shapeLabel(a: Annotation): string {
  if (a.type === "line")
    return `(${Math.round(a.x1)}, ${Math.round(a.y1)}) → (${Math.round(a.x2)}, ${Math.round(a.y2)})`;
  if (a.type === "rect")
    return `(${Math.round(Math.min(a.x1, a.x2))}, ${Math.round(Math.min(a.y1, a.y2))}) ${Math.round(Math.abs(a.x2 - a.x1))}×${Math.round(Math.abs(a.y2 - a.y1))}`;
  if (a.type === "measure") return measureLabel(a);
  const first = a.text.split("\n")[0];
  return first.length > 12 ? first.slice(0, 12) + "…" : first;
}
const ZOOM_MIN = 0.05;
const ZOOM_MAX = 8;

const IMAGE_ACCEPT = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
  "image/bmp": [".bmp"],
};

interface TextEditing {
  /** null = 新建文本 */
  id: number | null;
  x: number;
  y: number;
  value: string;
  fontSize: number;
}

export default function ImageEditPage() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const [params, setParams] = useState<AdjustParams>({ ...DEFAULT_ADJUST });

  const [tool, setTool] = useState<AnnotationTool>(null);
  const [color, setColor] = useState<string>(DEFAULT_COLOR);
  const [strokeWidth, setStrokeWidth] = useState<number>(DEFAULT_STROKE_WIDTH);
  const [dash, setDash] = useState<LineDash>("solid");
  /** 画框填充：独立于描边色的填充色与不透明度（0-1）；新框默认值，选中画框时可改 */
  const [fillColor, setFillColor] = useState<string>(DEFAULT_COLOR);
  const [fillOpacity, setFillOpacity] = useState<number>(DEFAULT_FILL_OPACITY);
  const [fontSize, setFontSize] = useState<number>(DEFAULT_FONT_SIZE);
  /** 字号输入框的原始文本（允许中间态如空串、个位数），失焦时收敛 */
  const [fontSizeText, setFontSizeText] = useState<string>(String(DEFAULT_FONT_SIZE));
  const [fontSizeMenuOpen, setFontSizeMenuOpen] = useState(false);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [textEditing, setTextEditing] = useState<TextEditing | null>(null);
  /** 按住「查看原图」时为 true：预览直接绘制未调整的源像素（标注层保留） */
  const [showOriginal, setShowOriginal] = useState(false);
  const [past, setPast] = useState<Annotation[][]>([]);
  const [future, setFuture] = useState<Annotation[][]>([]);

  // 显示缩放（原图像素 -> 屏幕像素），由共享工作台 ImageWorkbench 回调
  const [displayScale, setDisplayScale] = useState(1);

  const imgRef = useRef<HTMLImageElement | null>(null);
  imgRef.current = img;
  const imgDataUrlRef = useRef<string>("");
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const sourcePixelsRef = useRef<ImageData | null>(null);
  const annotationsRef = useRef<Annotation[]>([]);
  annotationsRef.current = annotations;
  const dragSnapshotRef = useRef<Annotation[] | null>(null);
  const nextIdRef = useRef(1);

  /** 裁剪选区（原图坐标），由 AnnotationCanvas 在裁剪模式下拖出后提交 */
  const [cropRect, setCropRect] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);
  /** 图像级历史：撤销裁剪用。存 dataURL 快照（字符串引用，非位图拷贝），上限 5 层 */
  const [imageHistory, setImageHistory] = useState<
    { dataUrl: string; naturalW: number; naturalH: number; annotations: Annotation[] }[]
  >([]);

  // 预览渲染：源像素 -> adjustPixels -> 显示 canvas。rAF 节流，每帧最多重算一次
  useEffect(() => {
    const canvas = displayCanvasRef.current;
    const source = sourcePixelsRef.current;
    if (!canvas || !source) return;
    if (canvas.width !== source.width || canvas.height !== source.height) {
      canvas.width = source.width;
      canvas.height = source.height;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const id = requestAnimationFrame(() => {
      const ctx2 = canvas.getContext("2d");
      if (!ctx2) return;
      const copy = new ImageData(
        new Uint8ClampedArray(source.data),
        source.width,
        source.height
      );
      // 按住「查看原图」时跳过调整，直接显示源像素（标注层不受影响）
      if (!showOriginal) adjustPixels(copy, params);
      ctx2.putImageData(copy, 0, 0);
    });
    return () => cancelAnimationFrame(id);
  }, [params, img, showOriginal]);

  const handleFileAdded = useCallback(async (items: { file: File }[]) => {
    const item = items[0];
    if (!item) return;
    setLoading(true);
    setError(null);
    try {
      const dataUrl = await readFileAsDataURL(item.file);
      const image = await loadImage(dataUrl);
      const scale = Math.min(
        1,
        PREVIEW_MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight)
      );
      const w = Math.max(1, Math.round(image.naturalWidth * scale));
      const h = Math.max(1, Math.round(image.naturalHeight * scale));
      const offscreen = document.createElement("canvas");
      offscreen.width = w;
      offscreen.height = h;
      const ctx = offscreen.getContext("2d");
      if (!ctx) throw new Error();
      ctx.drawImage(image, 0, 0, w, h);
      sourcePixelsRef.current = ctx.getImageData(0, 0, w, h);
      imgRef.current = image;
      imgDataUrlRef.current = dataUrl;
      setImg(image);
      setFileName(item.file.name);
      setParams({ ...DEFAULT_ADJUST });
      setAnnotations([]);
      setSelectedId(null);
      setTextEditing(null);
      setPast([]);
      setFuture([]);
      setTool(null);
      setCropRect(null);
      setImageHistory([]);
      nextIdRef.current = 1;
    } catch {
      setError("图片加载失败，请重新选择");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleReset = useCallback(() => {
    setImg(null);
    setFileName(null);
    setParams({ ...DEFAULT_ADJUST });
    setAnnotations([]);
    setSelectedId(null);
    setTextEditing(null);
    setPast([]);
    setFuture([]);
    setTool(null);
    sourcePixelsRef.current = null;
  }, []);

  const pushSnapshot = useCallback((snapshot: Annotation[]) => {
    setPast((p) => [...p, snapshot]);
    setFuture([]);
  }, []);

  // 直接读闭包值而非在 setState updater 内嵌套 setState——
  // StrictMode 下 updater 会被双调用，嵌套的 setFuture 会被推入两次
  /** 根据当前 img 重建降采样预览的源像素（裁剪/撤销裁剪后画布变化时调用） */
  const rebuildSourcePixels = useCallback((image: HTMLImageElement) => {
    const scale = Math.min(
      1,
      PREVIEW_MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight)
    );
    const w = Math.max(1, Math.round(image.naturalWidth * scale));
    const h = Math.max(1, Math.round(image.naturalHeight * scale));
    const offscreen = document.createElement("canvas");
    offscreen.width = w;
    offscreen.height = h;
    const ctx = offscreen.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(image, 0, 0, w, h);
    sourcePixelsRef.current = ctx.getImageData(0, 0, w, h);
  }, []);

  /** 应用裁剪：裁剪原图替换画布，标注坐标平移到新坐标系，撤销栈清空（坐标系失效） */
  const applyCrop = useCallback(async () => {
    const image = imgRef.current;
    if (!cropRect || !image) return;
    const w = Math.round(cropRect.x2 - cropRect.x1);
    const h = Math.round(cropRect.y2 - cropRect.y1);
    if (w < 1 || h < 1) return;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(image, cropRect.x1, cropRect.y1, w, h, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/png");
    const cropped = await loadImage(dataUrl);
    setImageHistory((hist) => [
      {
        dataUrl: imgDataUrlRef.current,
        naturalW: image.naturalWidth,
        naturalH: image.naturalHeight,
        annotations: annotationsRef.current,
      },
      ...hist.slice(0, 4),
    ]);
    imgRef.current = cropped;
    setImg(cropped);
    imgDataUrlRef.current = dataUrl;
    rebuildSourcePixels(cropped);
    setAnnotations((list) =>
      list.map((a) =>
        a.type === "text"
          ? { ...a, x: a.x - cropRect.x1, y: a.y - cropRect.y1 }
          : {
              ...a,
              x1: a.x1 - cropRect.x1,
              y1: a.y1 - cropRect.y1,
              x2: a.x2 - cropRect.x1,
              y2: a.y2 - cropRect.y1,
            }
      )
    );
    setPast([]);
    setFuture([]);
    setSelectedId(null);
    setTool(null);
    setCropRect(null);
  }, [cropRect, rebuildSourcePixels]);

  /** 撤销裁剪：恢复上一份图像快照与当时的标注 */
  const undoCrop = useCallback(async () => {
    const prev = imageHistory[0];
    if (!prev) return;
    const image = await loadImage(prev.dataUrl);
    imgRef.current = image;
    setImg(image);
    imgDataUrlRef.current = prev.dataUrl;
    rebuildSourcePixels(image);
    setAnnotations(prev.annotations);
    setImageHistory((h) => h.slice(1));
    setPast([]);
    setFuture([]);
    setSelectedId(null);
    setCropRect(null);
  }, [imageHistory, rebuildSourcePixels]);


  const undo = useCallback(() => {
    if (past.length === 0) return;
    setFuture((f) => [annotations, ...f]);
    setAnnotations(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
    setSelectedId(null);
  }, [annotations, past]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    setPast((p) => [...p, annotations]);
    setAnnotations(future[0]);
    setFuture((f) => f.slice(1));
    setSelectedId(null);
  }, [annotations, future]);

  const clearAnnotations = useCallback(() => {
    if (annotations.length === 0) return;
    pushSnapshot(annotations);
    setAnnotations([]);
    setSelectedId(null);
  }, [annotations, pushSnapshot]);

  const deleteSelected = useCallback(() => {
    if (selectedId == null) return;
    pushSnapshot(annotationsRef.current);
    setAnnotations((list) => list.filter((a) => a.id !== selectedId));
    setSelectedId(null);
  }, [selectedId, pushSnapshot]);

  /** 拖拽过程中的实时更新（快照在 onDragStart 时记录，结束时若有效才入栈） */
  const updateAnnotation = useCallback((id: number, patch: object) => {
    setAnnotations((list) =>
      list.map((a) => (a.id === id ? ({ ...a, ...patch } as Annotation) : a))
    );
  }, []);

  const onDragStart = useCallback(() => {
    dragSnapshotRef.current = annotationsRef.current;
  }, []);

  const onDragEnd = useCallback(
    (changed: boolean) => {
      if (changed && dragSnapshotRef.current) {
        pushSnapshot(dragSnapshotRef.current);
      }
      dragSnapshotRef.current = null;
    },
    [pushSnapshot]
  );

  const commitAnnotation = useCallback(
    (a: Annotation) => {
      pushSnapshot(annotationsRef.current);
      setAnnotations((list) => [...list, a]);
    },
    [pushSnapshot]
  );

  /** 删除单个标注（测量结果列表的删除走同一函数，保证画布与列表同步） */
  const removeAnnotation = useCallback(
    (id: number) => {
      pushSnapshot(annotationsRef.current);
      setAnnotations((list) => list.filter((a) => a.id !== id));
      setSelectedId(null);
    },
    [pushSnapshot]
  );

  /**
   * 调整叠层顺序：annotations 数组顺序即 SVG 渲染顺序（后者盖前者）。
   * dir=1 上移一层（更靠顶层），dir=-1 下移一层；与相邻元素交换（相邻为测量线时同样越过）。
   */
  const moveAnnotation = useCallback(
    (id: number, dir: -1 | 1) => {
      const list = annotationsRef.current;
      const i = list.findIndex((a) => a.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return;
      pushSnapshot(list);
      setAnnotations((prev) => {
        const copy = [...prev];
        [copy[i], copy[j]] = [copy[j], copy[i]];
        return copy;
      });
    },
    [pushSnapshot]
  );

  /** 清空全部测量线 */
  const clearMeasures = useCallback(() => {
    if (!annotationsRef.current.some((a) => a.type === "measure")) return;
    pushSnapshot(annotationsRef.current);
    setAnnotations((list) => list.filter((a) => a.type !== "measure"));
    setSelectedId(null);
  }, [pushSnapshot]);
  /** 修改选中元素属性（颜色/线宽/线型/字号），每次离散操作入栈一次 */
  const patchSelected = useCallback(
    (patch: object) => {
      if (selectedId == null) return;
      pushSnapshot(annotationsRef.current);
      setAnnotations((list) =>
        list.map((a) => (a.id === selectedId ? ({ ...a, ...patch } as Annotation) : a))
      );
    },
    [selectedId, pushSnapshot]
  );

  /** 应用字号：同步输入框显示、新建默认值与选中元素 */
  const applyFontSize = useCallback(
    (v: number) => {
      setFontSizeText(String(v));
      setFontSize(v);
      const sel = annotationsRef.current.find((a) => a.id === selectedId);
      if (sel && sel.type === "text") patchSelected({ fontSize: v });
    },
    [selectedId, patchSelected]
  );

  // 文本编辑：打开时记快照，提交时若有内容才入栈
  const textSnapshotRef = useRef<Annotation[] | null>(null);
  /**
   * 创建输入框后、用户真正点进去之前，浏览器可能因 click 把焦点移回 body
   * 而触发一次 blur——此时内容为空，若提交会立即销毁输入框（表现为「用不了」）。
   * 因此创建/重编辑后先忽略 blur，用户 pointerdown 到 textarea 上才恢复提交。
   */
  const ignoreTextBlurRef = useRef(false);

  const openTextCreate = useCallback((x: number, y: number) => {
    textSnapshotRef.current = annotationsRef.current;
    ignoreTextBlurRef.current = true;
    setTextEditing({ id: null, x, y, value: "", fontSize });
  }, [fontSize]);

  const openTextEdit = useCallback((id: number) => {
    const a = annotationsRef.current.find((it) => it.id === id);
    if (!a || a.type !== "text") return;
    textSnapshotRef.current = annotationsRef.current;
    ignoreTextBlurRef.current = true;
    setTextEditing({ id, x: a.x, y: a.y, value: a.text, fontSize: a.fontSize });
  }, []);

  const commitTextEdit = useCallback(() => {
    const editing = textEditing;
    if (!editing) return;
    setTextEditing(null);
    ignoreTextBlurRef.current = false;
    const snapshot = textSnapshotRef.current;
    textSnapshotRef.current = null;
    const text = editing.value.replace(/\s+$/, "");
    if (text.length === 0) {
      // 空文本：新建即丢弃；重编辑则删除该元素
      if (editing.id != null) {
        if (snapshot) pushSnapshot(snapshot);
        setAnnotations((list) => list.filter((a) => a.id !== editing.id));
        setSelectedId(null);
      }
      return;
    }
    if (snapshot) pushSnapshot(snapshot);
    if (editing.id == null) {
      const a: Annotation = {
        id: nextIdRef.current++,
        type: "text",
        x: editing.x,
        y: editing.y,
        text: editing.value,
        fontSize: editing.fontSize,
        color,
        strokeWidth,
        dash,
      };
      setAnnotations((list) => [...list, a]);
    } else {
      setAnnotations((list) =>
        list.map((a) =>
          a.id === editing.id && a.type === "text" ? { ...a, text: editing.value, fontSize: editing.fontSize } : a
        )
      );
    }
  }, [textEditing, pushSnapshot, color, strokeWidth, dash]);

  // 快捷键：Ctrl+Z / Ctrl+Shift+Z / Delete（输入控件聚焦时不拦截）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedId != null) {
          e.preventDefault();
          deleteSelected();
        }
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, deleteSelected, selectedId]);

  const handleExport = useCallback(
    async (format: "png" | "jpeg") => {
      const image = imgRef.current;
      if (!image || !fileName || exporting) return;
      setExporting(true);
      try {
        const w = image.naturalWidth;
        const h = image.naturalHeight;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error();
        if (format === "jpeg") {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, w, h);
        }
        ctx.drawImage(image, 0, 0);
        // 调整只作用于原图像素；标注必须在调整之后绘制，否则标注本身会被调色
        const imageData = ctx.getImageData(0, 0, w, h);
        adjustPixels(imageData, params);
        ctx.putImageData(imageData, 0, 0);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        for (const a of annotations) {
          const dashArray = DASH_ARRAYS[a.dash];
          ctx.setLineDash(dashArray ?? []);
          if (a.type === "text") {
            // 与 SVG 同一基线/行高公式，保证预览与导出一致
            ctx.fillStyle = a.color;
            ctx.font = a.fontSize + "px sans-serif";
            ctx.textBaseline = "alphabetic";
            const lines = a.text.split(String.fromCharCode(10));
            lines.forEach((line, i) => {
              ctx.fillText(line, a.x, a.y + a.fontSize * 0.9 + i * a.fontSize * TEXT_LINE_HEIGHT);
            });
            continue;
          }
          if (a.type === "measure") {
            // 与 SVG 预览同一公式：灰色虚线 + 两端圆点 + 中点上方坐标/距离标签
            ctx.strokeStyle = MEASURE_COLOR;
            ctx.lineWidth = a.strokeWidth;
            ctx.setLineDash([8, 5]);
            ctx.beginPath();
            ctx.moveTo(a.x1, a.y1);
            ctx.lineTo(a.x2, a.y2);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = MEASURE_COLOR;
            for (const [cx, cy] of [
              [a.x1, a.y1],
              [a.x2, a.y2],
            ]) {
              ctx.beginPath();
              ctx.arc(cx, cy, 3, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.font = MEASURE_LABEL_SIZE + "px sans-serif";
            ctx.textAlign = "center";
            ctx.fillStyle = "#374151";
            ctx.fillText(measureLabel(a), (a.x1 + a.x2) / 2, (a.y1 + a.y2) / 2 - 6);
            ctx.textAlign = "start";
            continue;
          }
          ctx.strokeStyle = a.color;
          ctx.lineWidth = a.strokeWidth;
          ctx.beginPath();
          if (a.type === "line") {
            ctx.moveTo(a.x1, a.y1);
            ctx.lineTo(a.x2, a.y2);
          } else {
            ctx.rect(
              Math.min(a.x1, a.x2),
              Math.min(a.y1, a.y2),
              Math.abs(a.x2 - a.x1),
              Math.abs(a.y2 - a.y1)
            );
            // 先填充后描边：半透明填充不会洗淡描边（与 SVG 预览同参数）
            if (a.fillOpacity > 0) {
              ctx.fillStyle = hexToRgba(a.fillColor, a.fillOpacity);
              ctx.fill();
            }
          }
          ctx.stroke();
        }
        ctx.setLineDash([]);
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, format === "png" ? "image/png" : "image/jpeg", 0.9)
        );
        if (!blob) throw new Error();
        downloadBlob(
          blob,
          generateOutputFilename(fileName, "edited", format === "png" ? "png" : "jpg")
        );
      } catch {
        setError("导出失败，请重试");
      } finally {
        setExporting(false);
      }
    },
    [annotations, params, fileName, exporting]
  );

  const selected = selectedId != null ? annotations.find((a) => a.id === selectedId) ?? null : null;
  const measureList = annotations.filter((a) => a.type === "measure");
  /** 绘制图形列表（不含测量，测量走独立面板）：数组顺序即叠层顺序，列表倒序展示使顶部 = 最上层 */
  const shapeList = annotations.filter((a) => a.type !== "measure");
  const isSelect = tool === "select";
  const btn = (active: boolean) =>
    `flex h-8 w-8 items-center justify-center rounded-lg transition-colors ` +
    (active ? "bg-brand-600 text-white" : "border border-gray-200 text-gray-600 hover:bg-gray-50");

  /** 填充透明度滑杆：拖动/按键过程中实时更新（不走撤销栈），结束后与手柄拖动同一规则判断是否入栈 */
  const commitFillOpacity = useCallback(() => {
    if (selected?.type !== "rect") {
      onDragEnd(false);
      return;
    }
    const before = dragSnapshotRef.current?.find((a) => a.id === selected.id);
    const after = annotationsRef.current.find((a) => a.id === selected.id);
    onDragEnd(!!before && !!after && JSON.stringify(before) !== JSON.stringify(after));
  }, [selected, onDragEnd]);

  return (
    <ToolLayout
      title="图片编辑"
      description="在图片上画线、画框、加文字做标注，调节亮度、对比度、饱和度、色温、色调，导出保持原始像素尺寸"
    >
      {error && <ErrorAlert message={error} onClose={() => setError(null)} />}

      {loading && (
        <div className="flex items-center gap-2 rounded-xl bg-gray-50 p-4 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在加载图片…
        </div>
      )}

      {!loading && !img && (
        <FileDropZone
          accept={IMAGE_ACCEPT}
          maxFiles={1}
          onFilesAdded={handleFileAdded}
          label="拖拽图片到此处，或点击选择（仅支持单张图片）"
        />
      )}

      {img && (
        <div className="space-y-3">
          {/* 工具栏：工具图标组｜描边色｜填充色+透明度（仅画框时）｜线宽｜线型｜字号 */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-gray-100 bg-white p-3">
            <div className="flex items-center gap-1.5">
              <button onClick={() => { setTool("select"); setSelectedId(null); }} className={btn(isSelect)} title="选择并编辑已有标注">
                <MousePointer2 className="h-4 w-4" />
              </button>
              <button onClick={() => setTool(tool === "line" ? null : "line")} className={btn(tool === "line")} title="画线">
                <Minus className="h-4 w-4" />
              </button>
              <button onClick={() => setTool(tool === "rect" ? null : "rect")} className={btn(tool === "rect")} title="画框">
                <Square className="h-4 w-4" />
              </button>
              <button onClick={() => setTool(tool === "text" ? null : "text")} className={btn(tool === "text")} title="文本">
                <TypeIcon className="h-4 w-4" />
              </button>
              <button onClick={() => { setTool(tool === "crop" ? null : "crop"); setCropRect(null); }} className={btn(tool === "crop")} title="裁剪">
                <Crop className="h-4 w-4" />
              </button>
              <button onClick={() => { setTool(tool === "measure" ? null : "measure"); setSelectedId(null); }} className={btn(tool === "measure")} title="距离测量：绘制直线显示两端坐标与距离">
                <Ruler className="h-4 w-4" />
              </button>
            </div>

            <div className="h-6 w-px bg-gray-200" />

            {/* 描边色 */}
            <div className="flex items-center gap-1.5">
              {ANNOTATION_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => { setColor(c); if (selected && selected.type !== "measure") patchSelected({ color: c }); }}
                  style={{ backgroundColor: c }}
                  className={`h-6 w-6 rounded-full border-2 transition-transform ${
                    color === c ? "scale-110 border-brand-600" : "border-gray-200 hover:scale-105"
                  }`}
                  title={`描边色 ${c}`}
                />
              ))}
            </div>

            {/* 填充色与透明度：仅在画框工具或选中画框时显示 */}
            {(tool === "rect" || selected?.type === "rect") && (
              <>
                <div className="h-6 w-px bg-gray-200" />
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-400">填充</span>
                  {ANNOTATION_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => { setFillColor(c); if (selected?.type === "rect") patchSelected({ fillColor: c }); }}
                      style={{ backgroundColor: c }}
                      className={`h-6 w-6 rounded-full border-2 transition-transform ${
                        (selected?.type === "rect" ? selected.fillColor : fillColor) === c ? "scale-110 border-brand-600" : "border-gray-200 hover:scale-105"
                      }`}
                      title={`填充色 ${c}`}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-400">透明</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round((selected?.type === "rect" ? selected.fillOpacity : fillOpacity) * 100)}
                    onPointerDown={onDragStart}
                    onKeyDown={onDragStart}
                    onChange={(e) => {
                      const v = Number(e.target.value) / 100;
                      setFillOpacity(v);
                      if (selected?.type === "rect") updateAnnotation(selected.id, { fillOpacity: v });
                    }}
                    onPointerUp={commitFillOpacity}
                    onKeyUp={commitFillOpacity}
                    className="h-1 w-16 cursor-pointer accent-brand-600"
                    title="填充透明度"
                  />
                  <span className="w-9 text-xs text-gray-500">
                    {Math.round((selected?.type === "rect" ? selected.fillOpacity : fillOpacity) * 100)}%
                  </span>
                </div>
              </>
            )}

            <div className="h-6 w-px bg-gray-200" />

            <div className="flex overflow-hidden rounded-lg border border-gray-200">
              {STROKE_WIDTH_OPTIONS.map((w) => (
                <button
                  key={w}
                  onClick={() => { setStrokeWidth(w); if (selected && selected.type !== "text" && selected.type !== "measure") patchSelected({ strokeWidth: w }); }}
                  className={`px-2.5 py-1.5 text-sm transition-colors ${
                    strokeWidth === w ? "bg-brand-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>

            {/* 线型 */}
            <div className="flex overflow-hidden rounded-lg border border-gray-200">
              {(["solid", "dashed", "dashdot"] as LineDash[]).map((d) => (
                <button
                  key={d}
                  onClick={() => { setDash(d); if (selected && selected.type !== "text" && selected.type !== "measure") patchSelected({ dash: d }); }}
                  className={`px-2.5 py-1.5 text-sm transition-colors ${
                    dash === d ? "bg-brand-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {d === "solid" ? "实线" : d === "dashed" ? "虚线" : "点划"}
                </button>
              ))}
            </div>

            {/* 字号：文本工具或选中文本时显示；可输入任意值，也可从预设档位下拉选择 */}
            {(tool === "text" || selected?.type === "text") && (
              <div
                className="relative flex items-center gap-1"
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFontSizeMenuOpen(false);
                }}
              >
                <input
                  type="number"
                  min={8}
                  max={500}
                  value={fontSizeText}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setFontSizeText(raw);
                    const v = Number(raw);
                    if (raw !== "" && Number.isFinite(v) && v >= 8 && v <= 500) {
                      setFontSize(v);
                      if (selected?.type === "text") patchSelected({ fontSize: v });
                    }
                  }}
                  onBlur={() => {
                    const v = Number(fontSizeText);
                    const clamped = Number.isFinite(v) ? Math.min(500, Math.max(8, Math.round(v))) : DEFAULT_FONT_SIZE;
                    applyFontSize(clamped);
                  }}
                  className="w-20 rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:border-brand-400 focus:outline-none"
                  title="字号（原图像素，8-500）"
                />
                <button
                  type="button"
                  onClick={() => setFontSizeMenuOpen((o) => !o)}
                  className="rounded-lg border border-gray-200 p-1.5 text-gray-500 transition-colors hover:bg-gray-50"
                  title="选择预设字号"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
                {fontSizeMenuOpen && (
                  <div className="absolute top-full left-0 z-20 mt-1 w-24 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                    {FONT_SIZE_OPTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => {
                          applyFontSize(s);
                          setFontSizeMenuOpen(false);
                        }}
                        className={`block w-full px-3 py-1.5 text-left text-sm transition-colors ${
                          fontSize === s ? "bg-brand-50 text-brand-700" : "text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        {s} px
                      </button>
                    ))}
                  </div>
                )}
                <span className="text-xs text-gray-400">字号</span>
              </div>
            )}

            <div className="flex items-center gap-1.5">
              <button onClick={undo} disabled={past.length === 0} className="rounded-lg border border-gray-200 p-2 text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40" title="撤销 (Ctrl+Z)">
                <Undo2 className="h-4 w-4" />
              </button>
              <button onClick={redo} disabled={future.length === 0} className="rounded-lg border border-gray-200 p-2 text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40" title="重做 (Ctrl+Shift+Z)">
                <Redo2 className="h-4 w-4" />
              </button>
              {imageHistory.length > 0 && (
                <button onClick={undoCrop} className="rounded-lg border border-amber-300 px-2.5 py-1.5 text-xs text-amber-700 transition-colors hover:bg-amber-50" title="撤销上一次裁剪">
                  撤销裁剪
                </button>
              )}
              <button onClick={clearAnnotations} disabled={annotations.length === 0} className="rounded-lg border border-gray-200 p-2 text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40" title="清空标注">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            <button onClick={handleReset} className="ml-auto rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-50">
              换图片
            </button>
          </div>

          {cropRect && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 p-3">
              <span className="text-sm text-brand-800">
                裁剪区域 {Math.round(cropRect.x2 - cropRect.x1)} x {Math.round(cropRect.y2 - cropRect.y1)} 像素，区域外内容将被裁掉，标注坐标随之平移。
              </span>
              <button onClick={applyCrop} className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700">应用裁剪</button>
              <button onClick={() => setCropRect(null)} className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm text-gray-600 hover:bg-white">取消</button>
            </div>
          )}
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
            {/* 工作台（共享组件：fit + 滚轮锚点缩放） */}
            <ImageWorkbench
              naturalWidth={img.naturalWidth}
              naturalHeight={img.naturalHeight}
              onScaleChange={setDisplayScale}
            >
              <canvas ref={displayCanvasRef} className="absolute inset-0 h-full w-full" />
              <AnnotationCanvas
                naturalWidth={img.naturalWidth}
                naturalHeight={img.naturalHeight}
                annotations={annotations}
                tool={tool}
                color={color}
                strokeWidth={strokeWidth}
                dash={dash}
                fontSize={fontSize}
                fillColor={fillColor}
                fillOpacity={fillOpacity}
                displayScale={displayScale}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onCreate={commitAnnotation}
                onUpdate={updateAnnotation}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onTextCreate={openTextCreate}
                onTextEdit={openTextEdit}
                cropRect={cropRect}
                onCropSelect={setCropRect}
              />
              {textEditing && (
                <textarea
                  autoFocus
                  value={textEditing.value}
                  onChange={(e) => setTextEditing({ ...textEditing, value: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") { setTextEditing(null); textSnapshotRef.current = null; ignoreTextBlurRef.current = false; }
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) commitTextEdit();
                  }}
                  onPointerDown={() => { ignoreTextBlurRef.current = false; }}
                  onBlur={() => { if (!ignoreTextBlurRef.current) commitTextEdit(); }}
                  className="absolute resize border-2 border-dashed border-brand-500 bg-white/80 p-1 font-sans leading-[1.4] outline-none"
                  style={{
                    left: textEditing.x * displayScale,
                    top: textEditing.y * displayScale,
                    fontSize: textEditing.fontSize * displayScale,
                    color,
                    minWidth: 160 * displayScale,
                  }}
                  placeholder="输入文字，Ctrl+Enter 完成，Esc 取消"
                />
              )}
            </ImageWorkbench>

            {/* 测量结果面板：与画布上的测量线同步（删除任一处，另一处同步消失） */}
            {measureList.length > 0 && (
              <div className="rounded-xl border border-gray-100 bg-white p-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-medium text-gray-500">
                    测量结果（{measureList.length}）
                  </p>
                  <button
                    onClick={clearMeasures}
                    className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-50"
                  >
                    清空
                  </button>
                </div>
                <ul className="max-h-64 space-y-1 overflow-y-auto">
                  {measureList.map((m, i) => (
                    <li
                      key={m.id}
                      className={`flex items-center gap-2 rounded-lg px-2 py-1 text-xs ${
                        selectedId === m.id ? "bg-brand-50" : ""
                      }`}
                    >
                      <span className="font-mono text-gray-700">
                        #{i + 1} ({Math.round(m.x1)}, {Math.round(m.y1)}) → ({Math.round(m.x2)}, {Math.round(m.y2)})
                      </span>
                      <span className="ml-auto shrink-0 font-medium text-gray-900">
                        {Math.round(Math.hypot(m.x2 - m.x1, m.y2 - m.y1))} px
                      </span>
                      <button
                        onClick={() => removeAnnotation(m.id)}
                        className="shrink-0 rounded-md p-1 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                        title="删除此测量"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* 右栏 */}
            <div className="min-w-0 space-y-3">
              {/* 标注图层：倒序展示，列表顶部 = 画布最上层；可调叠层、删除 */}
              {shapeList.length > 0 && (
                <div className="rounded-xl border border-gray-100 bg-white p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-medium text-gray-500">标注图层（{shapeList.length}）</p>
                    <span className="text-xs text-gray-400">顶部 = 最上层</span>
                  </div>
                  <ul className="max-h-64 space-y-1 overflow-y-auto">
                    {[...shapeList].reverse().map((a, di) => {
                      const oi = shapeList.length - 1 - di;
                      return (
                        <li
                          key={a.id}
                          className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs ${
                            selectedId === a.id ? "bg-brand-50" : ""
                          }`}
                        >
                          <button
                            onClick={() => setSelectedId(a.id)}
                            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                            title="点击选中"
                          >
                            {a.type === "line" ? (
                              <Minus className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                            ) : a.type === "rect" ? (
                              <Square className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                            ) : (
                              <TypeIcon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                            )}
                            <span className="truncate text-gray-700">{shapeLabel(a)}</span>
                          </button>
                          <button
                            onClick={() => moveAnnotation(a.id, 1)}
                            disabled={oi >= shapeList.length - 1}
                            className="shrink-0 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-30 disabled:hover:bg-transparent"
                            title="上移一层"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => moveAnnotation(a.id, -1)}
                            disabled={oi <= 0}
                            className="shrink-0 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-30 disabled:hover:bg-transparent"
                            title="下移一层"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => removeAnnotation(a.id)}
                            className="shrink-0 rounded-md p-1 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                            title="删除此标注"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {selected && (
                <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-medium text-brand-700">
                      已选中{selected.type === "line" ? "直线" : selected.type === "rect" ? "矩形" : selected.type === "measure" ? "测量线" : "文本"}
                    </p>
                    <button
                      onClick={deleteSelected}
                      className="flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1 text-xs text-red-600 transition-colors hover:bg-red-50"
                    >
                      <Trash2 className="h-3 w-3" />
                      删除 (Delete)
                    </button>
                  </div>
                  <p className="text-xs text-gray-500">
                    拖动可移动位置
                    {selected.type === "line" || selected.type === "measure" ? "，拖动两端圆点可改方向与长度" : selected.type === "rect" ? "，拖动四角圆点可改大小" : ""}
                    {selected.type === "text" ? "，双击文字可重新输入" : ""}
                  </p>
                  {selected.type === "text" && (
                    <button
                      onClick={() => openTextEdit(selected.id)}
                      className="mt-2 rounded-lg border border-brand-300 px-2 py-1 text-xs text-brand-700 transition-colors hover:bg-brand-100"
                    >
                      编辑文字
                    </button>
                  )}
                </div>
              )}

              <AdjustPanel params={params} onChange={setParams} />

              <div className="rounded-xl border border-gray-100 bg-white p-4">
                <p className="mb-3 text-xs font-medium text-gray-500">导出</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleExport("png")}
                    disabled={exporting}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    PNG
                  </button>
                  <button
                    onClick={() => handleExport("jpeg")}
                    disabled={exporting}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-brand-600 px-3 py-2 text-sm font-medium text-brand-600 transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    JPEG
                  </button>
                </div>
                <p className="mt-2 text-xs text-gray-400">输出保持原始像素尺寸，JPEG 质量 90%</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </ToolLayout>
  );
}
