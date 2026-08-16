"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { X, Type, Square } from "lucide-react";
import { colorToHex, type PairItem, type ResolvedColor } from "@/lib/colorLibraryV3";
import { contrastRatio, wcagLevel } from "@/lib/color/contrast";

interface AddPairModalProps {
  open: boolean;
  onClose: () => void;
  resolved: ResolvedColor[];
  /** 编辑模式：传入要编辑的校验对；null 表示新建 */
  editingPair: PairItem | null;
  onConfirm: (data: { textColorId: string; bgColorId: string; textOpacity: number }) => void;
}

/**
 * 添加/编辑校验色彩对：选择文字色、背景色，并指定文字不透明度。
 */
export function AddPairModal({
  open,
  onClose,
  resolved,
  editingPair,
  onConfirm,
}: AddPairModalProps) {
  const [textId, setTextId] = useState("");
  const [bgId, setBgId] = useState("");
  const [textOpacity, setTextOpacity] = useState(100);

  useEffect(() => {
    if (open) {
      setTextId(editingPair?.textColorId ?? "");
      setBgId(editingPair?.bgColorId ?? "");
      setTextOpacity(editingPair?.textOpacity ?? 100);
    }
  }, [open, editingPair]);

  const textColor = useMemo(
    () => resolved.find((c) => c.id === textId) || null,
    [resolved, textId]
  );
  const bgColor = useMemo(
    () => resolved.find((c) => c.id === bgId) || null,
    [resolved, bgId]
  );

  const previewRatio = useMemo(() => {
    if (!textColor || !bgColor) return null;
    return contrastRatio(textColor.rgb, bgColor.rgb);
  }, [textColor, bgColor]);

  const handleConfirm = useCallback(() => {
    if (!textId || !bgId) return;
    onConfirm({ textColorId: textId, bgColorId: bgId, textOpacity });
  }, [textId, bgId, textOpacity, onConfirm]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h3 className="font-semibold text-gray-900">
              {editingPair ? "编辑校验色彩对" : "添加校验色彩对"}
            </h3>
            <p className="text-xs text-gray-400">选择文字色、背景色与文字不透明度</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {/* 文字色选择 */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
              <Type className="h-4 w-4" />
              文字颜色
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {resolved.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setTextId(c.id)}
                  className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition-colors ${
                    textId === c.id
                      ? "border-brand-400 bg-brand-50"
                      : "border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <span
                    className="h-4 w-4 shrink-0 rounded border border-black/10"
                    style={{ backgroundColor: colorToHex(c.rgb) }}
                  />
                  <span className="truncate">{c.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 背景色选择 */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
              <Square className="h-4 w-4" />
              背景颜色
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {resolved.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setBgId(c.id)}
                  className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition-colors ${
                    bgId === c.id
                      ? "border-brand-400 bg-brand-50"
                      : "border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <span
                    className="h-4 w-4 shrink-0 rounded border border-black/10"
                    style={{ backgroundColor: colorToHex(c.rgb) }}
                  />
                  <span className="truncate">{c.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 文字不透明度 */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
              <span
                className="inline-block h-4 w-4 rounded border border-gray-300"
                style={{
                  backgroundColor: textColor
                    ? `rgba(${textColor.rgb[0]}, ${textColor.rgb[1]}, ${textColor.rgb[2]}, ${textOpacity / 100})`
                    : "transparent",
                }}
              />
              文字不透明度
              <span className="text-xs font-normal text-gray-400">{textOpacity}%</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={5}
                max={100}
                value={textOpacity}
                onChange={(e) => setTextOpacity(Number(e.target.value))}
                className="min-w-0 flex-1 accent-brand-600"
              />
              <input
                type="number"
                min={5}
                max={100}
                value={textOpacity}
                onChange={(e) => setTextOpacity(Math.max(5, Math.min(100, Number(e.target.value) || 100)))}
                className="w-16 rounded-lg border border-gray-200 px-1 py-1 text-center text-xs focus:border-brand-400 focus:outline-none"
              />
            </div>
          </div>

          {/* 预览 */}
          {textColor && bgColor && previewRatio !== null ? (
            <div
              className="rounded-xl border border-gray-100 p-4"
              style={{ backgroundColor: colorToHex(bgColor.rgb) }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: "rgba(30,33,38,.55)" }}>
                  预览
                </span>
                <span className="text-[10px]" style={{ color: "rgba(30,33,38,.45)" }}>
                  {colorToHex(bgColor.rgb)}
                </span>
              </div>
              <div
                className="text-lg font-semibold"
                style={{
                  color: colorToHex(textColor.rgb),
                  opacity: textOpacity / 100,
                }}
              >
                文字样例可见性
              </div>
              <div
                className="mt-1 text-sm"
                style={{
                  color: colorToHex(textColor.rgb),
                  opacity: (textOpacity / 100) * 0.75,
                }}
              >
                说明文字 · 14px
              </div>
              <div className="mt-3 flex items-center gap-3">
                <span
                  className="text-xl font-bold"
                  style={{ color: colorToHex(textColor.rgb) }}
                >
                  {previewRatio.toFixed(2)}:1
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                    wcagLevel(previewRatio, "normal") === "FAIL"
                      ? "bg-red-100 text-red-700"
                      : wcagLevel(previewRatio, "normal") === "LARGE"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-green-100 text-green-700"
                  }`}
                >
                  {wcagLevel(previewRatio, "normal")}
                </span>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-6 text-center text-xs text-gray-400">
              选择文字色与背景色后显示预览
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-200 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={!textId || !bgId}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40 transition-colors"
          >
            {editingPair ? "保存修改" : "添加校验对"}
          </button>
        </div>
      </div>
    </div>
  );
}
