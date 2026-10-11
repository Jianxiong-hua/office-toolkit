"use client";

import { RotateCcw } from "lucide-react";
import { DEFAULT_ADJUST, type AdjustParams } from "@/lib/image/adjust";

interface SliderSpec {
  key: keyof AdjustParams;
  label: string;
  min: number;
  max: number;
  step?: number;
  /** 数值后缀显示 */
  unit: (v: number) => string;
}

const SLIDERS: SliderSpec[] = [
  { key: "brightness", label: "亮度", min: 0, max: 200, unit: (v) => `${v}%` },
  { key: "contrast", label: "对比度", min: 0, max: 200, unit: (v) => `${v}%` },
  { key: "saturation", label: "饱和度", min: -100, max: 100, unit: (v) => (v > 0 ? `+${v} 鲜艳` : v < 0 ? `${v} 灰` : "0") },
  { key: "temperature", label: "色温", min: -100, max: 100, unit: (v) => (v > 0 ? `+${v} 暖` : v < 0 ? `${v} 冷` : "0") },
  { key: "tint", label: "色调", min: -100, max: 100, unit: (v) => (v > 0 ? `+${v} 品红` : v < 0 ? `${v} 绿` : "0") },
];

interface AdjustPanelProps {
  params: AdjustParams;
  onChange: (params: AdjustParams) => void;
}

/** 亮度 / 对比度 / 色温 / 色调 四个滑块与重置按钮 */
export function AdjustPanel({ params, onChange }: AdjustPanelProps) {
  const changed =
    params.brightness !== 100 ||
    params.contrast !== 100 ||
    params.saturation !== 0 ||
    params.temperature !== 0 ||
    params.tint !== 0;

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-medium text-gray-500">图像调整</p>
        <button
          onClick={() => onChange({ ...DEFAULT_ADJUST })}
          disabled={!changed}
          className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RotateCcw className="h-3 w-3" />
          重置
        </button>
      </div>
      <div className="space-y-4">
        {SLIDERS.map(({ key, label, min, max, unit }) => (
          <div key={key}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-gray-600">{label}</span>
              <span className="font-mono text-gray-400">{unit(params[key])}</span>
            </div>
            <input
              type="range"
              min={min}
              max={max}
              value={params[key]}
              onChange={(e) => onChange({ ...params, [key]: Number(e.target.value) })}
              className="w-full accent-brand-600"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
