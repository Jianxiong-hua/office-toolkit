"use client";

import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { MAX_LISTED_HITS, type SearchHits } from "@/lib/bin/search";

interface SearchBarProps {
  value: string;
  onValueChange: (value: string) => void;
  onSearch: () => void;
  onGotoHit: (delta: number) => void;
  onClear: () => void;
  error: string | null;
  mode: "hex" | "ascii" | null;
  hits: SearchHits | null;
  hitCursor: number;
}

/** 字节搜索：输入 + 搜索/上一处/下一处/清除 + 命中统计 */
export function SearchBar({
  value,
  onValueChange,
  onSearch,
  onGotoHit,
  onClear,
  error,
  mode,
  hits,
  hitCursor,
}: SearchBarProps) {
  const hasQuery = value.trim().length > 0;
  const disabled = !hits || hits.offsets.length === 0;

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-gray-400" />
          <input
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) onSearch();
            }}
            placeholder="十六进制字节串 FF 00 或文本 hello"
            className={`w-full rounded-lg border py-2 pr-3 pl-9 font-mono text-sm focus:outline-none ${
              error
                ? "border-red-300 focus:border-red-400"
                : "border-gray-200 focus:border-brand-400"
            }`}
          />
        </div>
        <button
          onClick={onSearch}
          disabled={!hasQuery}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          搜索
        </button>
        {hits && (
          <>
            <button
              onClick={() => onGotoHit(-1)}
              disabled={disabled}
              className="rounded-lg border border-gray-200 p-2 text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40"
              title="上一处"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
            <button
              onClick={() => onGotoHit(1)}
              disabled={disabled}
              className="rounded-lg border border-gray-200 p-2 text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40"
              title="下一处"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
            <button
              onClick={onClear}
              className="rounded-lg border border-gray-200 p-2 text-gray-600 transition-colors hover:bg-gray-50"
              title="清除搜索"
            >
              <X className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      <p className="mt-1.5 text-xs text-gray-400">
        含空格按字节串匹配（FF 00）；纯数字按文本匹配。歧义输入可用前缀强制：
        <code className="mx-1 font-mono">h:cafe</code> 搜字节 CA FE，
        <code className="mx-1 font-mono">t:cafe</code> 搜文本「cafe」
      </p>

      {error && <p className="mt-2 text-sm text-amber-700">{error}</p>}

      {hits && (
        <div className="mt-2 space-y-1 text-xs">
          <p className="text-gray-500">
            {mode === "hex"
              ? "按十六进制字节串匹配"
              : "按文本匹配（区分大小写）"}
            ，共命中 {hits.total.toLocaleString()} 处
            {hits.offsets.length > 0 && (
              <span className="text-gray-400"> · 当前第 {hitCursor + 1} 处</span>
            )}
          </p>
          {hits.truncated && (
            <p className="text-amber-600">
              结果超过 {MAX_LISTED_HITS} 处，仅列出前 {MAX_LISTED_HITS} 处，上一处/下一处只能在这
              {MAX_LISTED_HITS} 处内跳转。
            </p>
          )}
        </div>
      )}
    </div>
  );
}
