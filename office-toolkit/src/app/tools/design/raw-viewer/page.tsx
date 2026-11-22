"use client";

import type JSZip from "jszip";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, Minus, Plus, Maximize2, Trash2, X } from "lucide-react";
import { ToolLayout } from "@/components/layout/ToolLayout";
import { AppError } from "@/types";
import { downloadBlob, generateOutputFilename } from "@/lib/file";
import {
  ensureUniqueSubdirectory,
  pickDirectory,
  supportsDirectoryPicker,
  writeBlobInto,
} from "@/lib/fs/save";
import {
  BIT_DEPTHS,
  MAX_FILE_BYTES,
  MAX_PIXELS,
  bytesPerPixel,
  expectedByteLength,
  parseRawBuffer,
  type BitAlignment,
  type BitDepth,
  type Endianness,
} from "@/lib/raw/parse";
import { BAYER_PATTERNS, demosaicMhcToRgba, type BayerPattern } from "@/lib/raw/demosaic";
import { GAMMA_OPTIONS, buildLut, type GammaMode } from "@/lib/raw/tonemap";
import { RawDropZone } from "./RawDropZone";

const CONTROL_CLASS =
  "w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-400 focus:outline-none disabled:bg-gray-100 disabled:text-gray-400";

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 16;

/** 走内存 ZIP 的条件：张数 ≤ 50 且预估成品 ≤ 200 MB（两个都要满足） */
const MEMORY_MAX_FILES = 50;
const MEMORY_MAX_BYTES = 200 * 1024 * 1024;

interface Entry {
  id: string;
  file: File;
}

interface PreviewMeta {
  width: number;
  height: number;
  elapsedMs: number;
}

interface BatchState {
  running: boolean;
  done: number;
  total: number;
  startedAt: number;
  elapsedMs: number;
  succeeded: number;
  failures: { name: string; reason: string }[];
  /** 内存模式的结果 */
  zipBlob: Blob | null;
  /** 目录模式的落地位置描述 */
  dirLabel: string | null;
  cancelled: boolean;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-gray-500">
        {label}
        {hint && <span className="ml-1.5 font-normal text-gray-400">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function SectionCard({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {aside && <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

function toPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

/** 同名时加 -2 / -3 后缀 */
function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 2; i < 10000; i += 1) {
    const candidate = `${base}-${i}${ext}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  used.add(name);
  return name;
}

export default function RawViewerPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [width, setWidth] = useState("1920");
  const [height, setHeight] = useState("1080");
  const [depth, setDepth] = useState<BitDepth>(12);
  const [endianness, setEndianness] = useState<Endianness>("little");
  const [alignment, setAlignment] = useState<BitAlignment>("lsb");
  const [pattern, setPattern] = useState<BayerPattern>("RGGB");
  const [gamma, setGamma] = useState<GammaMode>("linear");

  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [batch, setBatch] = useState<BatchState | null>(null);
  const [zoom, setZoom] = useState(1);
  const [fitMode, setFitMode] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const exportCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const cancelRef = useRef(false);

  const w = Number(width);
  const h = Number(height);
  const sizeValid = Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0;
  const expected = sizeValid ? expectedByteLength({ width: w, height: h, depth }) : 0;

  const selected = entries.find((entry) => entry.id === selectedId) ?? null;
  const running = batch?.running ?? false;

  const mismatchedCount = entries.filter((entry) => entry.file.size !== expected).length;

  const estimateBytes = sizeValid ? entries.length * w * h : 0;
  const overMemory = entries.length > MEMORY_MAX_FILES || estimateBytes > MEMORY_MAX_BYTES;
  const needsDirectory = entries.length > 0 && overMemory;
  const directorySupported = useMemo(() => supportsDirectoryPicker(), []);
  const blocked = needsDirectory && !directorySupported;

  const fitToViewport = useCallback((imageWidth: number, imageHeight: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const scale = Math.min(
      (viewport.clientWidth - 16) / imageWidth,
      (viewport.clientHeight - 16) / imageHeight,
      1
    );
    setZoom(Math.max(MIN_ZOOM, scale));
  }, []);

  /** 单张转换：解析 + 去马赛克，返回 RGBA */
  const convertOne = useCallback(
    async (file: File) => {
      if (!sizeValid) return { ok: false as const, error: "请填写正确的宽和高" };
      if (w * h > MAX_PIXELS) {
        return { ok: false as const, error: `${((w * h) / 1e6).toFixed(1)} MP 超过上限 ${MAX_PIXELS / 1e6} MP` };
      }
      if (file.size > MAX_FILE_BYTES) {
        return { ok: false as const, error: `文件超过 ${MAX_FILE_BYTES / 1024 / 1024} MB 上限` };
      }
      const buffer = await file.arrayBuffer();
      const parsed = parseRawBuffer(buffer, { width: w, height: h, depth, endianness, alignment });
      if (!parsed.ok) return { ok: false as const, error: parsed.error };
      const started = performance.now();
      const lut = buildLut(depth, gamma);
      const rgba = demosaicMhcToRgba(parsed.data, w, h, pattern, lut);
      return { ok: true as const, rgba, elapsedMs: Math.round(performance.now() - started) };
    },
    [w, h, sizeValid, depth, endianness, alignment, gamma, pattern]
  );

  /** 把 RGBA 画到页面里的预览 canvas */
  const drawPreview = useCallback((rgba: Uint8ClampedArray, elapsedMs: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return false;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    const imageData = ctx.createImageData(w, h);
    imageData.data.set(rgba);
    ctx.putImageData(imageData, 0, 0);
    setPreview({ width: w, height: h, elapsedMs });
    fitToViewport(w, h);
    setFitMode(true);
    return true;
  }, [w, h, fitToViewport]);

  const renderPreview = useCallback(
    async (file: File) => {
      setPreviewing(true);
      setError(null);
      setPreview(null);
      try {
        const result = await convertOne(file);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if (!drawPreview(result.rgba, result.elapsedMs)) {
          setError("当前浏览器无法创建 canvas 上下文");
        }
      } catch {
        setError("处理失败，可能是内存不足");
      } finally {
        setPreviewing(false);
      }
    },
    [convertOne, drawPreview]
  );

  const selectEntry = (entry: Entry) => {
    setSelectedId(entry.id);
    void renderPreview(entry.file);
  };

  const handleFiles = (incoming: File[]) => {
    if (!incoming.length) return;
    const added = incoming.map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
      file,
    }));
    setEntries((prev) => [...prev, ...added]);
    setError(null);
    setBatch(null);
    if (!selectedId) {
      setSelectedId(added[0].id);
      void renderPreview(added[0].file);
    }
  };

  const removeEntry = (id: string) => {
    setEntries((prev) => {
      const next = prev.filter((entry) => entry.id !== id);
      if (selectedId === id) {
        setSelectedId(next[0]?.id ?? null);
        setPreview(null);
      }
      return next;
    });
  };

  const clearEntries = () => {
    setEntries([]);
    setSelectedId(null);
    setPreview(null);
    setBatch(null);
    setError(null);
  };

  const handleBatch = async () => {
    if (!entries.length || running || blocked) return;
    setError(null);
    setPreview(null);

    let dir: FileSystemDirectoryHandle | null = null;
    let dirLabel: string | null = null;
    if (needsDirectory) {
      try {
        const parent = await pickDirectory();
        const subName = `raw-demosaic-${entries.length}张`;
        dir = await ensureUniqueSubdirectory(parent, subName);
        dirLabel = `${parent.name}/${subName}`;
      } catch (e) {
        if (e instanceof AppError && e.code === "CANCELLED") return;
        setError(e instanceof Error ? e.message : "无法创建输出目录");
        return;
      }
    }

    const zip: JSZip | null = needsDirectory ? null : new (await import("jszip")).default();
    const canvas = exportCanvasRef.current ?? document.createElement("canvas");
    exportCanvasRef.current = canvas;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError("当前浏览器无法创建 canvas 上下文");
      return;
    }

    const startedAt = Date.now();
    const failures: BatchState["failures"] = [];
    const usedNames = new Set<string>();
    let succeeded = 0;
    cancelRef.current = false;
    setBatch({
      running: true,
      done: 0,
      total: entries.length,
      startedAt,
      elapsedMs: 0,
      succeeded: 0,
      failures,
      zipBlob: null,
      dirLabel,
      cancelled: false,
    });

    for (let index = 0; index < entries.length; index += 1) {
      if (cancelRef.current) break;
      const entry = entries[index];
      try {
        const result = await convertOne(entry.file);
        if (!result.ok) {
          failures.push({ name: entry.file.name, reason: result.error });
        } else {
          const imageData = ctx.createImageData(w, h);
          imageData.data.set(result.rgba);
          ctx.putImageData(imageData, 0, 0);
          const blob = await toPngBlob(canvas);
          if (!blob) {
            failures.push({ name: entry.file.name, reason: "PNG 编码失败（图像尺寸可能超出浏览器限制）" });
          } else {
            const name = uniqueName(
              generateOutputFilename(entry.file.name, "demosaic", "png"),
              usedNames
            );
            if (dir) await writeBlobInto(dir, name, blob);
            else zip?.file(name, blob);
            succeeded += 1;
          }
        }
      } catch (e) {
        failures.push({
          name: entry.file.name,
          reason: e instanceof Error ? e.message : "处理失败",
        });
      }
      setBatch((prev) =>
        prev
          ? {
              ...prev,
              done: index + 1,
              succeeded,
              elapsedMs: Date.now() - startedAt,
              failures: [...failures],
            }
          : prev
      );
      // 让出主线程，进度与「取消」按钮才能响应
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    let zipBlob: Blob | null = null;
    if (zip && succeeded > 0) {
      zipBlob = await zip.generateAsync({ type: "blob", compression: "STORE" });
    }

    setBatch((prev) =>
      prev
        ? {
            ...prev,
            running: false,
            elapsedMs: Date.now() - startedAt,
            succeeded,
            failures: [...failures],
            zipBlob,
            cancelled: cancelRef.current,
          }
        : prev
    );
  };

  const handleDownloadSingle = () => {
    const canvas = canvasRef.current;
    if (!canvas || !preview || !selected) return;
    canvas.toBlob((blob) => {
      if (!blob) {
        setError("导出 PNG 失败（图像尺寸可能超出当前浏览器限制）");
        return;
      }
      downloadBlob(blob, generateOutputFilename(selected.file.name, "demosaic", "png"));
    }, "image/png");
  };

  const handleDownloadZip = () => {
    if (!batch?.zipBlob) return;
    downloadBlob(batch.zipBlob, `raw-demosaic-${batch.succeeded}张.zip`);
  };

  const zoomBy = (factor: number) => {
    setFitMode(false);
    setZoom((current) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current * factor)));
  };

  useEffect(() => {
    // 参数变化后旧预览已失效
    setPreview(null);
  }, [w, h, depth, endianness, alignment, gamma, pattern]);

  const showAlignment = depth === 10 || depth === 12 || depth === 14;
  const estimateLabel = `${(estimateBytes / 1024 / 1024).toFixed(0)} MB`;
  const memoryLabel = entries.length > 0
    ? overMemory
      ? `本批 ${entries.length} 张，预估 ${estimateLabel}，超出内存打包阈值 → 需选择输出目录`
      : `本批 ${entries.length} 张，预估 ${estimateLabel} → 内存打包成 ZIP`
    : "";

  return (
    <ToolLayout
      title="RAW 图查看"
      description="把裸像素（Bayer RAW）数据按指定 gamma 映射到 8 位，用 Malvar-He-Cutler 去马赛克插值后以 PNG 显示与下载，支持批量转换，全部在浏览器本地计算。"
    >
      <div className="space-y-5">
        <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
          <RawDropZone count={entries.length} onFiles={handleFiles} disabled={running} />

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="宽">
              <input
                value={width}
                disabled={running}
                onChange={(event) => setWidth(event.target.value.replace(/[^\d]/g, ""))}
                inputMode="numeric"
                placeholder="如 1920"
                className={CONTROL_CLASS}
              />
            </Field>
            <Field label="高">
              <input
                value={height}
                disabled={running}
                onChange={(event) => setHeight(event.target.value.replace(/[^\d]/g, ""))}
                inputMode="numeric"
                placeholder="如 1080"
                className={CONTROL_CLASS}
              />
            </Field>
            <Field label="位深">
              <select
                value={depth}
                disabled={running}
                onChange={(event) => setDepth(Number(event.target.value) as BitDepth)}
                className={CONTROL_CLASS}
              >
                {BIT_DEPTHS.map((item) => (
                  <option key={item} value={item}>
                    {item} bit（{bytesPerPixel(item)} 字节/像素）
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Bayer 排列" hint="按左上角起算">
              <select
                value={pattern}
                disabled={running}
                onChange={(event) => setPattern(event.target.value as BayerPattern)}
                className={CONTROL_CLASS}
              >
                {BAYER_PATTERNS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="字节序" hint="仅 16 bit 存储时有意义">
              <div className={`inline-flex w-full rounded-lg border border-gray-200 p-0.5 ${running ? "opacity-50" : ""}`}>
                {(["little", "big"] as Endianness[]).map((item) => (
                  <button
                    key={item}
                    type="button"
                    disabled={running}
                    onClick={() => setEndianness(item)}
                    className={`flex-1 rounded-md px-3 py-1.5 text-sm transition-colors ${
                      endianness === item ? "bg-brand-600 text-white" : "text-gray-600 hover:bg-gray-50"
                    } ${running ? "cursor-not-allowed" : ""}`}
                  >
                    {item === "little" ? "小端" : "大端"}
                  </button>
                ))}
              </div>
            </Field>
            {showAlignment && (
              <Field label="数值对齐" hint={`${depth} bit 在 16 bit 字里`}>
                <div className={`inline-flex w-full rounded-lg border border-gray-200 p-0.5 ${running ? "opacity-50" : ""}`}>
                  {(["lsb", "msb"] as BitAlignment[]).map((item) => (
                    <button
                      key={item}
                      type="button"
                      disabled={running}
                      onClick={() => setAlignment(item)}
                      className={`flex-1 rounded-md px-3 py-1.5 text-sm transition-colors ${
                        alignment === item ? "bg-brand-600 text-white" : "text-gray-600 hover:bg-gray-50"
                      } ${running ? "cursor-not-allowed" : ""}`}
                    >
                      {item === "lsb" ? "低位" : "高位"}
                    </button>
                  ))}
                </div>
              </Field>
            )}
            <Field label="映射曲线">
              <select
                value={gamma}
                disabled={running}
                onChange={(event) => setGamma(event.target.value as GammaMode)}
                className={CONTROL_CLASS}
              >
                {GAMMA_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <p className="mt-4 text-sm text-gray-500">
            {sizeValid
              ? `期望每张 ${expected.toLocaleString()} 字节（${w}×${h}×${bytesPerPixel(depth)}）`
              : "请填写宽和高"}
            {mismatchedCount > 0 && (
              <span className="ml-2 text-amber-600">· {mismatchedCount} 个文件字节数不匹配</span>
            )}
          </p>

          {memoryLabel && (
            <p className={`mt-1 text-sm ${overMemory ? "text-amber-600" : "text-gray-500"}`}>
              {memoryLabel}
            </p>
          )}
          {blocked && (
            <p className="mt-1 text-sm text-red-600">
              本批次超出内存打包阈值，且当前浏览器不支持选择文件夹（需要 Chrome / Edge）。
              请分批处理（每批 ≤ {MEMORY_MAX_FILES} 张），或换用 Chrome / Edge。
            </p>
          )}

          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleBatch}
              disabled={running || !entries.length || blocked}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {running && <Loader2 className="h-4 w-4 animate-spin" />}
              {running ? "转换中…" : entries.length > 1 ? "全部转换" : "生成预览"}
            </button>
            {running && (
              <button
                type="button"
                onClick={() => {
                  cancelRef.current = true;
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <X className="h-4 w-4" />
                取消
              </button>
            )}
            {entries.length > 0 && !running && (
              <button
                type="button"
                onClick={clearEntries}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50"
              >
                <Trash2 className="h-4 w-4" />
                清空列表
              </button>
            )}
            {preview && !running && (
              <button
                type="button"
                onClick={handleDownloadSingle}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <Download className="h-4 w-4" />
                下载这张 PNG
              </button>
            )}
          </div>

          {batch && (
            <div className="mt-4 rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-600">
              <p>
                第 {batch.done} / {batch.total} 张 · 已用 {(batch.elapsedMs / 1000).toFixed(1)} s · 成功{" "}
                {batch.succeeded} 张
                {batch.failures.length > 0 && ` · 失败 ${batch.failures.length} 张`}
                {batch.cancelled && " · 已取消"}
              </p>
              {batch.failures.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-amber-700">
                  {batch.failures.slice(0, 20).map((item) => (
                    <li key={item.name} className="break-all">
                      {item.name}：{item.reason}
                    </li>
                  ))}
                  {batch.failures.length > 20 && <li>…… 另有 {batch.failures.length - 20} 条</li>}
                </ul>
              )}
              {batch.zipBlob && (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <span>
                    ZIP {(batch.zipBlob.size / 1024 / 1024).toFixed(1)} MB（{batch.succeeded} 张）
                  </span>
                  <button
                    type="button"
                    onClick={handleDownloadZip}
                    className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
                  >
                    <Download className="h-4 w-4" />
                    下载 ZIP
                  </button>
                </div>
              )}
              {!batch.running && batch.dirLabel && (
                <p className="mt-3 text-xs text-green-700">
                  已写入文件夹 {batch.dirLabel}（{batch.succeeded} 张）
                </p>
              )}
            </div>
          )}
        </section>

        {entries.length > 0 && (
          <SectionCard
            title={`文件列表（${entries.length}）`}
            aside={selected ? `当前：${selected.file.name}` : "点击某项预览"}
          >
            <ul className="max-h-64 divide-y divide-gray-100 overflow-auto">
              {entries.map((entry) => {
                const matched = entry.file.size === expected;
                return (
                  <li
                    key={entry.id}
                    className={`flex items-center gap-3 px-1 py-2 text-sm ${
                      entry.id === selectedId ? "bg-brand-50" : ""
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => selectEntry(entry)}
                      disabled={running}
                      className="min-w-0 flex-1 truncate text-left font-mono text-xs text-gray-700 hover:text-brand-600 disabled:cursor-not-allowed"
                    >
                      {entry.file.name}
                    </button>
                    <span className={`shrink-0 text-xs ${matched ? "text-gray-400" : "text-amber-600"}`}>
                      {(entry.file.size / 1024).toFixed(0)} KB{matched ? "" : " · 尺寸不符"}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeEntry(entry.id)}
                      disabled={running}
                      title="移除"
                      className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </SectionCard>
        )}

        <SectionCard
          title="预览"
          aside={
            preview && (
              <>
                <span>
                  {Math.round(zoom * 100)}% · 原始 {preview.width}×{preview.height} · {preview.elapsedMs} ms
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => zoomBy(1 / 1.25)}
                    title="缩小"
                    className="rounded-md border border-gray-200 p-1 text-gray-600 hover:bg-gray-50"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => zoomBy(1.25)}
                    title="放大"
                    className="rounded-md border border-gray-200 p-1 text-gray-600 hover:bg-gray-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      fitToViewport(preview.width, preview.height);
                      setFitMode(true);
                    }}
                    className={`rounded-md border border-gray-200 px-2 py-1 hover:bg-gray-50 ${
                      fitMode ? "text-brand-600" : "text-gray-600"
                    }`}
                  >
                    适应窗口
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setZoom(1);
                      setFitMode(false);
                    }}
                    className={`rounded-md border border-gray-200 px-2 py-1 hover:bg-gray-50 ${
                      zoom === 1 && !fitMode ? "text-brand-600" : "text-gray-600"
                    }`}
                  >
                    1:1
                  </button>
                  <Maximize2 className="ml-1 h-3.5 w-3.5" />
                </div>
              </>
            )
          }
        >
          <div
            ref={viewportRef}
            onPointerDown={(event) => {
              const viewport = viewportRef.current;
              if (!viewport || !preview) return;
              dragRef.current = {
                x: event.clientX,
                y: event.clientY,
                left: viewport.scrollLeft,
                top: viewport.scrollTop,
              };
            }}
            onPointerMove={(event) => {
              const viewport = viewportRef.current;
              const drag = dragRef.current;
              if (!viewport || !drag) return;
              viewport.scrollLeft = drag.left - (event.clientX - drag.x);
              viewport.scrollTop = drag.top - (event.clientY - drag.y);
            }}
            onPointerUp={() => {
              dragRef.current = null;
            }}
            onPointerLeave={() => {
              dragRef.current = null;
            }}
            className="h-[60vh] overflow-auto rounded-xl bg-gray-50 p-2"
          >
            {/* canvas 常驻挂载：转换时先写像素，再由 setPreview 触发展示 */}
            <canvas
              ref={canvasRef}
              style={
                preview
                  ? {
                      width: `${preview.width * zoom}px`,
                      height: `${preview.height * zoom}px`,
                      imageRendering: zoom >= 1 ? "pixelated" : "auto",
                    }
                  : undefined
              }
              className={preview ? "cursor-grab" : "hidden"}
            />
            {!preview && (
              <div className="flex h-full items-center justify-center text-sm text-gray-400">
                {previewing ? "正在生成预览…" : "拖入文件后点列表项即可预览"}
              </div>
            )}
          </div>
          <p className="mt-2 text-xs text-gray-400">
            未校正黑电平（BLC），暗部亮度以传感器裸数据为准。
          </p>
        </SectionCard>
      </div>
    </ToolLayout>
  );
}
