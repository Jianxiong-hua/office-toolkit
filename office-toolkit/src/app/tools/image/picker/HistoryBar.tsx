"use client";

import { Trash2 } from "lucide-react";
import type { ColorHistory } from "@/hooks/useColorHistory";

interface HistoryBarProps {
  history: ColorHistory;
  /** 点击色块：第一个参数是所属区域，第二个是色值 */
  onApply: (side: "left" | "right", hex: string) => void;
  onClear: () => void;
}

/**
 * 历史取色记录：区分左右两区，各自展示色块网格。
 * 点击色块应用到对应区域，可清空。
 */
export function HistoryBar({ history, onApply, onClear }: HistoryBarProps) {
  const empty =
    history.left.length === 0 && history.right.length === 0;

  const renderSide = (side: "left" | "right", label: string, list: string[]) => {
    if (list.length === 0) {
      return (
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-3 text-center text-xs text-gray-400">
          {label}暂无历史
        </div>
      );
    }
    return (
      <div>
        <p className="mb-1.5 text-xs font-medium text-gray-500">{label}</p>
        <div className="flex flex-wrap gap-2">
          {list.map((hex) => (
            <button
              key={hex}
              onClick={() => onApply(side, hex)}
              title={`${hex}（点击应用到${label}）`}
              className="h-9 w-9 rounded-lg border border-black/10 shadow-sm transition-transform hover:scale-110 hover:shadow"
              style={{ backgroundColor: hex }}
            />
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-gray-700">
          取色历史
        </span>
        <button
          onClick={onClear}
          disabled={empty}
          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
          清空
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          {renderSide("left", "左区", history.left)}
        </div>
        <div className="space-y-1.5">
          {renderSide("right", "右区", history.right)}
        </div>
      </div>
    </div>
  );
}
