"use client";

import { useCallback, useRef, useState } from "react";
import {
  Plus, Trash2, Link2, Pencil, ArrowUpRight, ArrowDownToLine, GripVertical, ChevronDown, ChevronRight,
} from "lucide-react";
import {
  buildLibraryCsvV3,
  colorToHex,
  rgbToHsvTuple,
  type LibraryColor,
  type ResolvedColor,
} from "@/lib/colorLibraryV3";
import { generateHsvFormula } from "@/lib/color/formula";

interface ColorLibraryPanelProps {
  state: { library: { colors: LibraryColor[] } };
  setState: React.Dispatch<React.SetStateAction<any>>;
  resolved: ResolvedColor[];
  onOpenAdd: () => void;
  onOpenImport: () => void;
  onEdit: (color: LibraryColor) => void;
  onToast: (msg: string) => void;
}

/**
 * 颜色库 v3 面板：增删改、拖拽排序、链接色 HSV 展开调节、导入导出。
 */
export function ColorLibraryPanel({
  state,
  setState,
  resolved,
  onOpenAdd,
  onOpenImport,
  onEdit,
  onToast,
}: ColorLibraryPanelProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const dragId = useRef<string | null>(null);

  const resolvedById = useCallback(
    () => new Map(resolved.map((c) => [c.id, c])),
    [resolved]
  );

  const patchColor = useCallback(
    (id: string, p: Partial<LibraryColor>) => {
      setState((s: any) => ({
        ...s,
        library: {
          ...s.library,
          colors: s.library.colors.map((c: LibraryColor) =>
            c.id === id ? { ...c, ...p } : c
          ),
        },
      }));
    },
    [setState]
  );

  const handleDelete = useCallback(
    (id: string) => {
      if (state.library.colors.length <= 1) {
        onToast("颜色库至少保留 1 个颜色");
        return;
      }
      if (!window.confirm("确定删除该颜色？链接到它的颜色将变为异常状态。")) return;
      setState((s: any) => ({
        ...s,
        library: {
          ...s.library,
          colors: s.library.colors.filter((c: LibraryColor) => c.id !== id),
        },
      }));
      onToast("已删除");
    },
    [state.library.colors.length, onToast, setState]
  );

  /* ---------- 拖拽排序 ---------- */
  const handleDragStart = (_index: number, id: string) => {
    dragId.current = id;
    setDragIndex(_index);
  };
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    if (dragIndex !== null && dragIndex !== index) setDragIndex(index);
  };
  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    const id = dragId.current;
    if (!id) {
      setDragIndex(null);
      dragId.current = null;
      return;
    }
    setState((s: any) => {
      const colors = [...s.library.colors];
      const fromIdx = colors.findIndex((c: LibraryColor) => c.id === id);
      if (fromIdx === -1 || fromIdx === toIndex) return s;
      const [moved] = colors.splice(fromIdx, 1);
      colors.splice(toIndex, 0, moved);
      return { ...s, library: { ...s.library, colors } };
    });
    setDragIndex(null);
    dragId.current = null;
  };

  const handleExportCsv = useCallback(() => {
    download(
      buildLibraryCsvV3(state.library),
      `color-library-${today()}.csv`,
      "text/csv;charset=utf-8"
    );
    onToast("颜色库已导出为 CSV");
  }, [state.library, onToast]);

  const map = resolvedById();
  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-green-500" />
          <h3 className="font-semibold text-gray-900">颜色库</h3>
          <span className="text-xs text-gray-400">
            {state.library.colors.length} 色
          </span>
        </div>
        <span
          className="cursor-ns-resize rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-400"
          title="拖动右下角手柄可调整高度"
        >
          ⤢ 可调高度
        </span>
      </div>

      {/* 工具栏 */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <button
          onClick={onOpenImport}
          className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200 transition-colors"
          title="按模板导入颜色"
        >
          <ArrowDownToLine className="h-3.5 w-3.5" />
          导入颜色
        </button>
        <button
          onClick={handleExportCsv}
          className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200 transition-colors"
          title="导出颜色清单（CSV）"
        >
          <ArrowUpRight className="h-3.5 w-3.5" style={{ color: "#0e9488" }} />
          导出颜色
        </button>
        <button
          onClick={onOpenAdd}
          className="ml-auto inline-flex items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          添加
        </button>
      </div>

      {/* 颜色列表：可拖拽排序 + 可垂直调整高度 */}
      <div
        className="h-[480px] resize-y space-y-1.5 overflow-auto pr-1"
        style={{ minHeight: 200, maxHeight: 960 }}
      >
        {resolved.map((c, idx) => {
          const src = c.linkTargetId ? map.get(c.linkTargetId) : null;
          const isExpanded = expanded.has(c.id);
          return (
            <div
              key={c.id}
              draggable
              onDragStart={() => handleDragStart(idx, c.id)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDrop={(e) => handleDrop(e, idx)}
              onDragEnd={() => {
                setDragIndex(null);
                dragId.current = null;
              }}
              className={`rounded-lg border px-2 py-1.5 transition-all ${
                dragIndex === idx
                  ? "border-brand-400 bg-brand-50 opacity-80"
                  : c.status === "error"
                  ? "border-red-200 bg-red-50/60"
                  : "border-gray-100 bg-gray-50/60"
              }`}
            >
              <div className="flex items-center gap-2">
                {/* 拖拽手柄 */}
                <span
                  className="shrink-0 cursor-grab text-gray-300 hover:text-gray-500"
                  title="拖动排序"
                >
                  <GripVertical className="h-3.5 w-3.5" />
                </span>
                <span
                  className="h-7 w-7 shrink-0 rounded-md border border-black/10"
                  style={{ backgroundColor: colorToHex(c.rgb) }}
                  title={colorToHex(c.rgb)}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-gray-800">
                    {c.name}
                    {c.linked && src && (
                      <span className="ml-1 inline-flex items-center gap-0.5 text-[10px] text-blue-600">
                        <Link2 className="h-2.5 w-2.5" />
                        → {src.name}
                      </span>
                    )}
                    {c.status === "error" && (
                      <span className="ml-1 text-[10px] text-red-600">{c.error}</span>
                    )}
                  </p>
                  <p className="text-[10px] text-gray-400">
                    {colorToHex(c.rgb)}
                    {c.linked ? " · 链接色" : ""}
                  </p>
                </div>
                {c.linked && (
                  <button
                    onClick={() => toggleExpand(c.id)}
                    className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 transition-colors"
                    title={isExpanded ? "收起" : "展开 HSV 调节"}
                  >
                    {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </button>
                )}
                <button
                  onClick={() => onEdit(c)}
                  className="shrink-0 rounded p-1 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                  title="编辑"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => handleDelete(c.id)}
                  className="shrink-0 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                  title="删除"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* 链接色展开区：源色 HSV + 当前 HSV + H/S/V 调节 */}
              {c.linked && isExpanded && src && (
                <LinkedColorRow
                  color={c}
                  src={src}
                  onFormulaChange={(formula) => patchColor(c.id, { linkFormula: formula })}
                  onToast={onToast}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ============ 链接色 HSV 调节行 ============ */

function LinkedColorRow({
  color,
  src,
  onFormulaChange,
  onToast,
}: {
  color: ResolvedColor;
  src: ResolvedColor;
  onFormulaChange: (f: { h: string; s: string; v: string }) => void;
  onToast: (msg: string) => void;
}) {
  // 当前 HSV（来自 resolved 的 hsv，或由公式实时算）
  const cur = color.hsv;
  const srcHsv = src.hsv;

  const handleAdjust = (channel: "h" | "s" | "v", value: number) => {
    // 以当前目标 HSV 为输入，反推公式
    const target = { ...cur, [channel]: value };
    const formula = generateHsvFormula(srcHsv, target);
    onFormulaChange(formula);
    onToast("已按调节值更新公式");
  };

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-blue-100 bg-blue-50/50 p-2">
      {/* 源色行 */}
      <div className="flex items-center gap-2">
        <span className="w-8 shrink-0 text-[10px] text-gray-400">源色</span>
        <span
          className="h-5 w-5 shrink-0 rounded border border-black/10"
          style={{ backgroundColor: colorToHex(src.rgb) }}
        />
        <span className="text-[11px] text-gray-600">{src.name}</span>
        <span className="ml-auto text-[10px] text-gray-400">
          H {Math.round(srcHsv.h)}° S {Math.round(srcHsv.s)} V {Math.round(srcHsv.v)}
        </span>
      </div>
      {/* 当前色行 + H/S/V 调节 */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="w-8 shrink-0 text-[10px] text-gray-400">当前</span>
          <span
            className="h-5 w-5 shrink-0 rounded border border-black/10"
            style={{ backgroundColor: colorToHex(color.rgb) }}
          />
          <span className="text-[11px] text-gray-600">{color.name}</span>
          <span className="ml-auto text-[10px] text-blue-600 font-mono">
            {color.linkFormula ? `${color.linkFormula.h} · ${color.linkFormula.s} · ${color.linkFormula.v}` : ""}
          </span>
        </div>
        {(
          [
            ["H", cur.h, 0, 360],
            ["S", cur.s, 0, 100],
            ["V", cur.v, 0, 100],
          ] as [string, number, number, number][]
        ).map(([label, val, min, max]) => (
          <div key={label} className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-gray-400">{label}</span>
            <input
              type="range"
              min={min}
              max={max}
              value={Math.round(val)}
              onChange={(e) => handleAdjust(label.toLowerCase() as "h" | "s" | "v", Number(e.target.value))}
              className="min-w-0 flex-1 accent-blue-600"
            />
            <input
              type="number"
              min={min}
              max={max}
              value={Math.round(val)}
              onChange={(e) =>
                handleAdjust(label.toLowerCase() as "h" | "s" | "v", Number(e.target.value))
              }
              className="w-14 rounded border border-gray-200 px-1 py-0.5 text-right text-[11px] focus:border-brand-400 focus:outline-none"
            />
          </div>
        ))}
        <p className="text-[10px] text-gray-400">
          拖动 H/S/V 自动生成比例公式；源色变化时本色联动，结果自动限制在合法范围。
        </p>
      </div>
    </div>
  );
}

function download(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

function today(): string {
  const d = new Date();
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}
