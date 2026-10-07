"use client";

import { BYTES_PER_LINE_OPTIONS } from "@/lib/bin/hex";

interface ToolbarProps {
  bytesPerLine: number;
  onBytesPerLineChange: (value: number) => void;
  offsetInput: string;
  onOffsetInputChange: (value: string) => void;
  offsetError: string | null;
  onJump: () => void;
  lines: number;
}

/** 每行字节数切换 + 偏移跳转 */
export function Toolbar({
  bytesPerLine,
  onBytesPerLineChange,
  offsetInput,
  onOffsetInputChange,
  offsetError,
  onJump,
  lines,
}: ToolbarProps) {
  return (
    <div className="flex flex-wrap items-end gap-4 rounded-xl border border-gray-100 bg-white p-4">
      <div>
        <p className="mb-1.5 text-xs text-gray-500">每行字节数</p>
        <div className="flex overflow-hidden rounded-lg border border-gray-200">
          {BYTES_PER_LINE_OPTIONS.map((option) => (
            <button
              key={option}
              onClick={() => onBytesPerLineChange(option)}
              className={`px-3 py-1.5 text-sm transition-colors ${
                bytesPerLine === option
                  ? "bg-brand-600 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs text-gray-500">
          偏移跳转（十六进制，如 1F40 或 0x1F40）
        </p>
        <div className="flex items-center gap-2">
          <input
            value={offsetInput}
            onChange={(e) => onOffsetInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) onJump();
            }}
            placeholder="0"
            className={`w-32 rounded-lg border px-3 py-1.5 font-mono text-sm focus:outline-none ${
              offsetError
                ? "border-red-300 focus:border-red-400"
                : "border-gray-200 focus:border-brand-400"
            }`}
          />
          <button
            onClick={onJump}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700"
          >
            跳转
          </button>
        </div>
      </div>

      <p className="ml-auto text-xs text-gray-400">共 {lines.toLocaleString()} 行</p>
    </div>
  );
}
