"use client";

import { formatOffset } from "@/lib/bin/hex";
import type { SearchHits } from "@/lib/bin/search";
import type { InterpretResult } from "@/lib/bin/interpret";

interface SidePanelProps {
  hits: SearchHits | null;
  hitCursor: number;
  onSelectHit: (index: number) => void;
  interpret: InterpretResult | null;
}

/** 右栏：搜索命中列表 + 数值解释 */
export function SidePanel({ hits, hitCursor, onSelectHit, interpret }: SidePanelProps) {
  return (
    <div className="min-w-0 space-y-3">
      {hits && hits.offsets.length > 0 && (
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <p className="mb-2 text-xs font-medium text-gray-500">
            命中位置（{hits.total.toLocaleString()}）
          </p>
          <div className="max-h-48 overflow-y-auto">
            {hits.offsets.map((offset, i) => (
              <button
                key={offset}
                onClick={() => onSelectHit(i)}
                className={`block w-full rounded px-2 py-1 text-left font-mono text-xs transition-colors ${
                  i === hitCursor
                    ? "bg-brand-50 text-brand-700"
                    : "text-gray-600 hover:bg-gray-50"
                }`}
              >
                0x{formatOffset(offset)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-gray-100 bg-white p-4">
        <p className="mb-3 text-xs font-medium text-gray-500">数值解释</p>
        {interpret ? (
          <>
            <p className="mb-2 font-mono text-xs text-gray-500">
              从偏移 0x{formatOffset(interpret.offset)} 起
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400">
                    <th className="pb-1 text-left font-normal">类型</th>
                    <th className="pb-1 text-right font-normal">大端</th>
                    <th className="pb-1 text-right font-normal">小端</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {interpret.items.map((item) => (
                    <tr key={item.label} className="border-t border-gray-50">
                      <td className="py-1 text-gray-500">
                        {item.label}
                        <span className="ml-1 text-gray-300">/{item.size}</span>
                      </td>
                      <td className="py-1 text-right text-gray-800">{item.big}</td>
                      <td className="py-1 text-right text-gray-800">{item.little}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="text-xs text-gray-400">
            点击左侧任意字节，即可按大端/小端解释该位置起的数值。
          </p>
        )}
      </div>
    </div>
  );
}
