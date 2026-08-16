"use client";

import { useMemo } from "react";
import { ArrowUpDown, ArrowUpRight, Plus } from "lucide-react";
import {
  contrastRatio,
  wcagLevel,
  type Filter,
  type Mode,
  type CvdType,
} from "@/lib/color/contrast";
import { colorToHex, type PairItem, type ResolvedColor } from "@/lib/colorLibraryV3";
import { ResultCard } from "./ResultCard";

interface ResultGridProps {
  state: {
    mode: Mode;
    cvd: CvdType;
    sortAsc: boolean;
    filter: Filter;
    sampleIdx: number;
    pairs: PairItem[];
  };
  setState: React.Dispatch<React.SetStateAction<any>>;
  resolved: ResolvedColor[];
  onAddPair: () => void;
  onEditPair: (pair: PairItem) => void;
  onToast: (msg: string) => void;
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "risk", label: "有风险" },
];

/**
 * 校验色彩对网格：渲染 PairItem 列表，含筛选/排序/导出。
 */
export function ResultGrid({ state, setState, resolved, onAddPair, onEditPair, onToast }: ResultGridProps) {
  const byId = useMemo(() => new Map(resolved.map((c) => [c.id, c])), [resolved]);

  // 解析每对：找到文字色/背景色，计算对比度
  const rows = useMemo(() => {
    const list: {
      pair: PairItem;
      textColor: ResolvedColor | undefined;
      bgColor: ResolvedColor | undefined;
      ratio: number;
      risk: boolean;
    }[] = [];
    for (const p of state.pairs) {
      const tc = byId.get(p.textColorId);
      const bc = byId.get(p.bgColorId);
      if (!tc || !bc) continue; // 颜色被删，跳过
      const ratio = contrastRatio(tc.rgb, bc.rgb);
      const lvl = wcagLevel(ratio, state.mode);
      const risk = lvl === "FAIL" || (lvl === "LARGE" && state.mode === "normal");
      list.push({ pair: p, textColor: tc, bgColor: bc, ratio, risk });
    }
    if (state.filter === "risk") {
      return list.filter((r) => r.risk);
    }
    list.sort((a, b) => (state.sortAsc ? a.ratio - b.ratio : b.ratio - a.ratio));
    return list;
  }, [state.pairs, byId, state.mode, state.filter, state.sortAsc]);

  const nRisk = useMemo(() => {
    let n = 0;
    for (const p of state.pairs) {
      const tc = byId.get(p.textColorId);
      const bc = byId.get(p.bgColorId);
      if (!tc || !bc) continue;
      const lvl = wcagLevel(contrastRatio(tc.rgb, bc.rgb), state.mode);
      if (lvl === "FAIL" || (lvl === "LARGE" && state.mode === "normal")) n++;
    }
    return n;
  }, [state.pairs, byId, state.mode]);

  const deletePair = (id: string) =>
    setState((s: any) => ({ ...s, pairs: s.pairs.filter((p: PairItem) => p.id !== id) }));

  const exportCsv = () => {
    const head = ["文字色", "文字HEX", "背景色", "背景HEX", "对比度", "评级"];
    const data = state.pairs.map((p) => {
      const tc = byId.get(p.textColorId);
      const bc = byId.get(p.bgColorId);
      if (!tc || !bc) return [];
      const ratio = contrastRatio(tc.rgb, bc.rgb);
      return [
        tc.name, colorToHex(tc.rgb), bc.name, colorToHex(bc.rgb),
        ratio.toFixed(2), wcagLevel(ratio, state.mode),
      ];
    });
    const csv = [head, ...data]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    download("\ufeff" + csv, `colorcheck-report-${today()}.csv`, "text/csv;charset=utf-8");
    onToast("报告已导出");
  };

  return (
    <div className="space-y-4">
      {/* 工具栏 */}
      <div className="rounded-2xl border border-gray-100 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-semibold text-gray-900">校验结果</span>
          <span className="text-xs text-gray-400">
            {state.pairs.length} 对
            {nRisk > 0 && <span className="ml-1 text-red-500">{nRisk} 对风险</span>}
          </span>
          <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-0.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setState((s: any) => ({ ...s, filter: f.key }))}
                className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                  state.filter === f.key
                    ? "bg-white text-gray-800 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <span className="flex-1" />
          <button
            onClick={() => setState((s: any) => ({ ...s, sortAsc: !s.sortAsc }))}
            className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200 transition-colors"
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
            对比度 {state.sortAsc ? "升序" : "降序"}
          </button>
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200 transition-colors"
            title="导出校验结果报告（CSV）"
          >
            <ArrowUpRight className="h-3.5 w-3.5" style={{ color: "#0e9488" }} />
            导出校验结果
          </button>
          <button
            onClick={onAddPair}
            className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            添加校验对
          </button>
        </div>
      </div>

      {/* 结果网格 */}
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-10 text-center">
          <p className="font-medium text-gray-600">
            {state.pairs.length === 0 ? "还没有校验色彩对" : "此筛选下没有结果"}
          </p>
          <p className="mt-2 text-sm text-gray-400">
            {state.pairs.length === 0
              ? "点击「添加校验对」，从颜色库中选择一个文字色和一个背景色，生成对比度色卡。"
              : "尝试切换筛选条件。"}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
          {rows.map((r) => (
            <ResultCard
              key={r.pair.id}
              pair={r.pair}
              textColor={r.textColor!}
              bgColor={r.bgColor!}
              mode={state.mode}
              cvd={state.cvd}
              sampleIdx={state.sampleIdx}
              onDelete={deletePair}
              onEdit={onEditPair}
            />
          ))}
        </div>
      )}
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
