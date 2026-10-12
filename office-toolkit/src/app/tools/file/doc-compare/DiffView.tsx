"use client";

import { useState } from "react";
import type { DiffRow, DiffStats } from "@/lib/document/diff";

interface DiffViewProps {
  rows: DiffRow[];
  stats: DiffStats;
  /** 丢格式局限提示（docx 参与 diff 时显示） */
  showFormatNotice: boolean;
}

const SIDE_STYLE: Record<string, string> = {
  same: "bg-white text-gray-800",
  removed: "bg-red-50 text-red-900",
  added: "bg-green-50 text-green-900",
  changed: "bg-amber-50 text-amber-900",
};

const MARK: Record<string, string> = {
  same: " ",
  removed: "-",
  added: "+",
  changed: "~",
};

/**
 * 并排双栏 diff。左右两格在同一个 flex 行内、共用一个滚动容器——
 * 天然 1:1 对齐与同步滚动，无需跨容器同步逻辑。
 */
export function DiffView({ rows, stats, showFormatNotice }: DiffViewProps) {
  const [wrap, setWrap] = useState(false);

  const cell = (side: DiffRow["left"], fallback: string) => (
    <div
      className={`flex h-6 min-w-0 flex-1 items-center ${
        side ? SIDE_STYLE[side.status] : fallback
      }`}
    >
      <span className="w-12 shrink-0 pr-2 text-right text-gray-400 select-none">
        {side ? side.no : ""}
      </span>
      <span className="w-4 shrink-0 text-center font-semibold text-gray-400 select-none">
        {side ? MARK[side.status] : ""}
      </span>
      <span
        className={`min-w-0 flex-1 pr-3 ${
          wrap ? "break-all whitespace-pre-wrap" : "truncate whitespace-pre"
        }`}
      >
        {side ? (side.text === "" ? " " : side.text) : " "}
      </span>
    </div>
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="text-green-700">新增 {stats.added.toLocaleString()} 行</span>
        <span className="text-red-700">删除 {stats.removed.toLocaleString()} 行</span>
        <span className="text-amber-700">修改 {stats.changed.toLocaleString()} 行</span>
        <button
          onClick={() => setWrap((w) => !w)}
          className="ml-auto rounded-lg border border-gray-200 px-2 py-1 text-gray-600 transition-colors hover:bg-gray-50"
        >
          {wrap ? "单行截断" : "自动换行"}
        </button>
      </div>

      {showFormatNotice && (
        <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
          docx 参与对比时仅提取文字内容（丢失标题层级、加粗、表格列对应等格式），适合核对文字改动。
        </p>
      )}

      <div className="h-[70vh] overflow-auto rounded-xl border border-gray-200 font-mono text-xs">
        <div className="py-2">
          {rows.map((row, i) => (
            <div key={i} className="flex">
              {cell(row.left, "bg-gray-50/60 text-gray-300")}
              {cell(row.right, "bg-gray-50/60 text-gray-300")}
            </div>
          ))}
          {rows.length === 0 && (
            <p className="px-4 py-6 text-center text-gray-400">没有可对比的内容</p>
          )}
        </div>
      </div>
    </div>
  );
}
