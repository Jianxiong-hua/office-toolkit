"use client";

import { useCallback, useState } from "react";
import { MonitorUp, Palette } from "lucide-react";
import { ToolLayout } from "@/components/layout/ToolLayout";
import { ImagePicker } from "./ImagePicker";
import { ColorSwatch } from "./ColorSwatch";
import { HistoryBar } from "./HistoryBar";
import { useColorHistory } from "@/hooks/useColorHistory";
import {
  hexToRgb,
  parseSrgbHex,
  rgbToHex,
  type Rgb,
} from "@/lib/color/convert";

type Side = "left" | "right";

interface SideColor {
  rgb: Rgb;
  hex: string;
}

export default function ColorPickerPage() {
  const [activeSide, setActiveSide] = useState<Side>("left");
  const [left, setLeft] = useState<SideColor | null>(null);
  const [right, setRight] = useState<SideColor | null>(null);
  const { history, addColor, clear } = useColorHistory();
  const [screenError, setScreenError] = useState<string | null>(null);

  const supportsEyeDropper =
    typeof window !== "undefined" && "EyeDropper" in window;

  /** 将颜色写入指定区（history 参数控制是否同时记入历史） */
  const applyToSide = useCallback(
    (side: Side, hex: string, recordHistory: boolean) => {
      const rgb = hexToRgb(hex);
      if (!rgb) return;
      const c: SideColor = { rgb, hex: rgbToHex(rgb.r, rgb.g, rgb.b) };
      setLeft((prev) => (side === "left" ? c : prev));
      setRight((prev) => (side === "right" ? c : prev));
      if (recordHistory) addColor(side, c.hex);
    },
    [addColor]
  );

  /** 将取到的颜色写入激活区，并加入对应区的历史 */
  const applyToActive = useCallback(
    (hex: string) => {
      applyToSide(activeSide, hex, true);
    },
    [activeSide, applyToSide]
  );

  /** 图片取色回调 */
  const handleImagePick = useCallback(
    (_rgb: Rgb, hex: string) => {
      applyToActive(hex);
    },
    [applyToActive]
  );

  /** 屏幕取色：EyeDropper 原生 API */
  const handleScreenPick = useCallback(async () => {
    setScreenError(null);
    if (!supportsEyeDropper) {
      setScreenError("当前浏览器不支持屏幕取色，请使用 Chrome / Edge");
      return;
    }
    try {
      const ed = new window.EyeDropper!();
      const result = await ed.open();
      const hex = parseSrgbHex(result.sRGBHex);
      if (hex) applyToActive(hex);
    } catch (e) {
      // 用户按 Esc 取消取色，属正常行为，不提示错误
      if (e instanceof Error && e.name === "AbortError") return;
      setScreenError("屏幕取色失败，请重试");
    }
  }, [supportsEyeDropper, applyToActive]);

  /** 调色板选色 */
  const handlePaletteChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      applyToActive(e.target.value);
    },
    [applyToActive]
  );

  const targetHint = activeSide === "left" ? "左区" : "右区";
  const activeColor = activeSide === "left" ? left : right;

  return (
    <ToolLayout
      title="取色器"
      description="从图片、屏幕或调色板取色，左右双区直观对比 HEX / RGB / HSL / HSV"
    >
      <div className="space-y-6">
        {/* 取色来源工具栏 */}
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-gray-700">
            取色到：{targetHint}
          </span>
          <div className="flex-1" />
          <button
            onClick={handleScreenPick}
            disabled={!supportsEyeDropper}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500 transition-colors"
          >
            <MonitorUp className="h-4 w-4" />
            从屏幕取色
          </button>
          <label
            className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium ${
              activeColor ? "text-gray-700" : "text-gray-400"
            } hover:bg-gray-50 transition-colors`}
            title="从调色板选色"
          >
            <Palette className="h-4 w-4" />
            调色板
            <input
              type="color"
              value={activeColor?.hex ?? "#F3F4F6"}
              onChange={handlePaletteChange}
              className="h-6 w-6 cursor-pointer border-0 bg-transparent p-0"
            />
          </label>
        </div>

        {!supportsEyeDropper && (
          <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
            当前浏览器不支持「从屏幕取色」（需 Chrome / Edge）。仍可使用图片取色和调色板。
          </div>
        )}
        {screenError && (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {screenError}
          </div>
        )}

        {/* 图片取色 */}
        <ImagePicker onPick={handleImagePick} targetHint={targetHint} />

        {/* 左右双区对比 */}
        <div className="grid gap-4 sm:grid-cols-2">
          <ColorSwatch
            label="左区"
            active={activeSide === "left"}
            color={left}
            onActivate={() => setActiveSide("left")}
          />
          <ColorSwatch
            label="右区"
            active={activeSide === "right"}
            color={right}
            onActivate={() => setActiveSide("right")}
          />
        </div>

        {/* 历史记录 */}
        <HistoryBar
          history={history}
          onApply={(side, hex) => applyToSide(side, hex, false)}
          onClear={clear}
        />
      </div>
    </ToolLayout>
  );
}
