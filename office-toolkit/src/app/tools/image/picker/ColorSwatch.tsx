"use client";

import { useCallback, useState } from "react";
import { Check, Copy } from "lucide-react";
import {
  rgbToHex,
  rgbToHsl,
  rgbToHsv,
  type Hsl,
  type Hsv,
  type Rgb,
} from "@/lib/color/convert";

interface ColorSwatchProps {
  label: string;
  active: boolean;
  color: { rgb: Rgb; hex: string } | null;
  onActivate: () => void;
}

/**
 * 单个取色结果区：大色块 + HEX/RGB/HSL/HSV 色值，点击色值复制。
 */
export function ColorSwatch({ label, active, color, onActivate }: ColorSwatchProps) {
  const [copied, setCopied] = useState<string | null>(null);

  const hsl: Hsl | null = color ? rgbToHsl(color.rgb.r, color.rgb.g, color.rgb.b) : null;
  const hsv: Hsv | null = color ? rgbToHsv(color.rgb.r, color.rgb.g, color.rgb.b) : null;

  const copy = useCallback(async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1200);
    } catch {
      /* 剪贴板不可用时静默 */
    }
  }, []);

  const rows: { key: string; label: string; value: string }[] = color
    ? [
        { key: "hex", label: "HEX", value: color.hex },
        {
          key: "rgb",
          label: "RGB",
          value: `rgb(${color.rgb.r}, ${color.rgb.g}, ${color.rgb.b})`,
        },
        { key: "hsl", label: "HSL", value: `hsl(${hsl?.h}, ${hsl?.s}%, ${hsl?.l}%)` },
        { key: "hsv", label: "HSV", value: `hsv(${hsv?.h}, ${hsv?.s}%, ${hsv?.v}%)` },
      ]
    : [];

  return (
    <div
      onClick={onActivate}
      className={`rounded-2xl border-2 p-4 transition-all cursor-pointer ${
        active
          ? "border-brand-500 bg-brand-50/40 shadow-sm"
          : "border-gray-200 bg-white hover:border-gray-300"
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <span
          className={`text-sm font-semibold ${
            active ? "text-brand-700" : "text-gray-700"
          }`}
        >
          {label}
        </span>
        {active && (
          <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-medium text-white">
            取色目标
          </span>
        )}
      </div>

      <div
        className="h-28 w-full rounded-xl border border-black/10 shadow-inner"
        style={{ backgroundColor: color?.hex || "#f3f4f6" }}
      >
        {!color && (
          <div className="flex h-full items-center justify-center text-xs text-gray-400">
            点击此处或从图片/屏幕/调色板取色
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-gray-400">尚未取色</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {rows.map((row) => (
            <li key={row.key}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  copy(row.value, row.key);
                }}
                className="group flex w-full items-center justify-between rounded-lg bg-gray-50 px-3 py-1.5 text-xs hover:bg-gray-100 transition-colors"
                title="点击复制"
              >
                <span className="text-gray-500">{row.label}</span>
                <span className="inline-flex items-center gap-1.5 font-medium text-gray-800">
                  {copied === row.key ? (
                    <Check className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 text-gray-400 group-hover:text-brand-500" />
                  )}
                  {row.value}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
