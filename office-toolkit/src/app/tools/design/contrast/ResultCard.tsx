"use client";

import { Pencil, Trash2 } from "lucide-react";
import {
  contrastRatio,
  wcagLevel,
  type Level,
  type Mode,
  type CvdType,
} from "@/lib/color/contrast";
import { colorToHex, type PairItem, type ResolvedColor } from "@/lib/colorLibraryV3";

interface ResultCardProps {
  pair: PairItem;
  textColor: ResolvedColor;
  bgColor: ResolvedColor;
  mode: Mode;
  cvd: CvdType;
  sampleIdx: number;
  onDelete: (id: string) => void;
  onEdit: (pair: PairItem) => void;
}

function levelBadge(lvl: Level): { text: string; cls: string; color: string } {
  if (lvl === "AAA") return { text: "AAA", cls: "bg-green-100 text-green-700", color: "#16a34a" };
  if (lvl === "AA") return { text: "AA", cls: "bg-green-100 text-green-700", color: "#16a34a" };
  if (lvl === "LARGE") return { text: "仅大文本", cls: "bg-amber-100 text-amber-700", color: "#d97706" };
  return { text: "不达标", cls: "bg-red-100 text-red-700", color: "#dc2626" };
}

const SAMPLE_SETS_V3 = [
  { main: "中文字样可见性", sub: "说明文字 · secondary 14px" },
  { main: "Aa Bb 可见性 Check", sub: "Body copy · 14px" },
  { main: "0123456789 4.5:1", sub: "统计数字 · tabular-nums" },
];

/**
 * 校验色彩对结果卡片：预览 + 对比度 + 评级 + CVD + 编辑/删除。
 */
export function ResultCard({
  pair,
  textColor,
  bgColor,
  mode,
  cvd,
  sampleIdx,
  onDelete,
  onEdit,
}: ResultCardProps) {
  const ratio = contrastRatio(textColor.rgb, bgColor.rgb);
  const lvl = wcagLevel(ratio, mode);
  const badge = levelBadge(lvl);
  const sample = SAMPLE_SETS_V3[sampleIdx % SAMPLE_SETS_V3.length];
  const sampleSize = mode === "large" ? "24px" : "17px";
  const sampleWeight = mode === "large" ? 700 : 600;
  const subOpacity = (ratio < 3 ? 0.55 : ratio < 4.5 ? 0.8 : 1) * (pair.textOpacity / 100);
  const textOpacity = pair.textOpacity / 100;
  const cvdFilter = cvd === "none" ? undefined : `url(#cvd-${cvd})`;

  return (
    <article
      className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-shadow hover:shadow-md"
      style={{ borderLeft: `4px solid ${badge.color}` }}
    >
      {/* 预览区（CVD 滤镜） */}
      <div
        className="px-4 py-4"
        style={{ backgroundColor: colorToHex(bgColor.rgb), filter: cvdFilter }}
      >
        <div className="mb-3 flex items-center justify-between">
          <span
            className="rounded-full px-2 py-0.5 text-[11px]"
            style={{
              backgroundColor: "rgba(0,0,0,.08)",
              color: "rgba(30,33,38,.7)",
            }}
          >
            背景 · {bgColor.name}
          </span>
          <span className="text-[11px]" style={{ color: "rgba(30,33,38,.55)" }}>
            {colorToHex(bgColor.rgb)}
          </span>
        </div>
        <div>
          <div
            className="leading-tight"
            style={{
              fontSize: sampleSize,
              fontWeight: sampleWeight,
              color: colorToHex(textColor.rgb),
              opacity: textOpacity,
            }}
          >
            {sample.main}
          </div>
          <div
            className="mt-1 text-sm leading-tight"
            style={{
              color: colorToHex(textColor.rgb),
              opacity: subOpacity,
            }}
          >
            {sample.sub}
          </div>
        </div>
        <div className="mt-3 text-[11px]" style={{ color: "rgba(30,33,38,.55)" }}>
          文字 · {textColor.name}
          {textColor.status === "error" && (
            <span className="ml-1 text-red-500">（{textColor.error}）</span>
          )}
        </div>
      </div>

      {/* 元数据区 */}
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div className="text-2xl font-bold text-gray-900">
            {ratio.toFixed(2)}
            <small className="text-sm font-normal text-gray-400">:1</small>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${badge.cls}`}>
              {badge.text}
            </span>
            <button
              onClick={() => onEdit(pair)}
              className="rounded p-1 text-gray-300 hover:bg-blue-50 hover:text-blue-500 transition-colors"
              title="编辑校验对"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => onDelete(pair.id)}
              className="rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-500 transition-colors"
              title="删除校验对"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <p className="mt-1 text-xs text-gray-400">
          文字色 {textColor.name} · 背景色 {bgColor.name}
          {pair.textOpacity < 100 && (
            <span className="ml-1 text-amber-600">· 文字 {pair.textOpacity}%</span>
          )}
        </p>
      </div>
    </article>
  );
}
