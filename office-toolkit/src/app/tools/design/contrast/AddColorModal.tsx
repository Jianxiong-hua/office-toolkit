"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { X, Link2 } from "lucide-react";
import { generateHsvFormula } from "@/lib/color/formula";
import {
  colorToHex,
  hsvToRgbTuple,
  rgbToHsvTuple,
  type HsvFormula,
  type LibraryColor,
  type ResolvedColor,
} from "@/lib/colorLibraryV3";

interface AddColorModalProps {
  open: boolean;
  onClose: () => void;
  setState: React.Dispatch<React.SetStateAction<any>>;
  resolved: ResolvedColor[];
  onToast: (msg: string) => void;
  /** 编辑模式：传入要编辑的颜色；null 表示新建 */
  editing: LibraryColor | null;
}

/**
 * 新建/编辑颜色 v3：RGB + 名称 + 链接配置（选源色 + 调 HSV 目标 → 自动生成比例公式）。
 * editing 非空时为编辑模式（保留 id 更新），否则为新建。
 */
export function AddColorModal({
  open,
  onClose,
  setState,
  resolved,
  onToast,
  editing,
}: AddColorModalProps) {
  const [name, setName] = useState("");
  const [rgb, setRgb] = useState<[number, number, number]>([128, 128, 128]);
  const [linked, setLinked] = useState(false);
  const [linkTargetId, setLinkTargetId] = useState<string>("");
  const [targetHsv, setTargetHsv] = useState({ h: 0, s: 0, v: 0 });
  const [formula, setFormula] = useState<HsvFormula>({ h: "", s: "", v: "" });
  const [rgbInput, setRgbInput] = useState("");

  useEffect(() => {
    if (open) {
      if (editing) {
        setName(editing.name);
        setRgb([...editing.baseRgb] as [number, number, number]);
        setRgbInput(colorToHex(editing.baseRgb));
        setLinked(editing.linked);
        setLinkTargetId(editing.linkTargetId ?? "");
        setFormula(
          editing.linkFormula ? { ...editing.linkFormula } : { h: "", s: "", v: "" }
        );
        // 当前色 HSV（目标）
        const cur = editing.linked
          ? rgbToHsvTuple(editing.rgb)
          : rgbToHsvTuple(editing.baseRgb);
        setTargetHsv({ h: cur.h, s: cur.s, v: cur.v });
      } else {
        setName("");
        setRgb([128, 128, 128]);
        setRgbInput(colorToHex([128, 128, 128]));
        setLinked(false);
        setLinkTargetId("");
        setFormula({ h: "", s: "", v: "" });
        setTargetHsv({ h: 0, s: 0, v: 0 });
      }
    }
  }, [open, editing]);

  const linkCandidates = useMemo(
    () => resolved.filter((c) => c.id !== editing?.id),
    [resolved, editing]
  );

  const targetResolved = useMemo(
    () => resolved.find((c) => c.id === linkTargetId) || null,
    [resolved, linkTargetId]
  );

  const handleRgbInput = useCallback((value: string) => {
    setRgbInput(value.toUpperCase());
    const parsed = /^#?([0-9a-fA-F]{6})$/.exec(value.replace(/\s/g, ""));
    if (parsed) {
      const hex = parsed[1];
      const n = parseInt(hex, 16);
      setRgb([(n >> 16) & 255, (n >> 8) & 255, n & 255]);
    }
  }, []);

  const patchChannel = useCallback(
    (ch: "r" | "g" | "b", value: number) => {
      setRgb((prev) => {
        const next: [number, number, number] = [...prev] as [number, number, number];
        next[ch === "r" ? 0 : ch === "g" ? 1 : 2] = Math.max(0, Math.min(255, value || 0));
        setRgbInput(colorToHex(next));
        return next;
      });
    },
    []
  );

  /** 调节目标 HSV → 实时更新预览 + 自动生成比例公式 */
  const handleAdjustTarget = useCallback(
    (channel: "h" | "s" | "v", value: number) => {
      if (!targetResolved) return;
      const next = { ...targetHsv, [channel]: value };
      setTargetHsv(next);
      const src = targetResolved.hsv;
      const f = generateHsvFormula(src, next);
      setFormula(f);
      // 实时更新预览色（顶部色块 + HEX + RGB 输入同步）
      const previewRgb = hsvToRgbTuple(next);
      setRgb(previewRgb);
      setRgbInput(colorToHex(previewRgb));
    },
    [targetResolved, targetHsv]
  );

  const handleSelectTarget = useCallback(
    (id: string) => {
      setLinkTargetId(id);
      const t = resolved.find((c) => c.id === id);
      if (t) {
        const src = t.hsv;
        // 默认目标 = 源色（恒等公式）
        const f = generateHsvFormula(src, src);
        setFormula(f);
        setTargetHsv({ h: src.h, s: src.s, v: src.v });
        setRgb(hsvToRgbTuple(src));
        setRgbInput(colorToHex(hsvToRgbTuple(src)));
      }
    },
    [resolved]
  );

  const handleConfirm = () => {
    const n = name.trim();
    if (!n) {
      onToast("请填写颜色名称");
      return;
    }
    if (linked) {
      if (!linkTargetId) {
        onToast("请选择链接的目标颜色");
        return;
      }
      if (!formula.h || !formula.s || !formula.v) {
        onToast("请先通过调节 H/S/V 生成公式");
        return;
      }
    }
    // 编辑模式：保留原 id；新建：生成新 id
    const id = editing ? editing.id : "c" + Date.now();
    const finalRgb: [number, number, number] = linked
      ? hsvToRgbTuple({ h: targetHsv.h, s: targetHsv.s, v: targetHsv.v })
      : ([...rgb] as [number, number, number]);
    const c: LibraryColor = {
      id,
      name: n,
      rgb: finalRgb,
      baseRgb: linked ? (editing?.baseRgb ?? finalRgb) : finalRgb,
      linked,
      linkTargetId: linked ? linkTargetId : null,
      linkFormula: linked ? formula : null,
    };
    setState((s: any) => {
      const exists = s.library.colors.some((x: LibraryColor) => x.id === id);
      const colors = exists
        ? s.library.colors.map((x: LibraryColor) => (x.id === id ? c : x))
        : [...s.library.colors, c];
      return { ...s, library: { ...s.library, colors } };
    });
    onToast(editing ? `已保存「${n}」` : `已添加「${n}」${colorToHex(finalRgb)}`);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h3 className="font-semibold text-gray-900">
              {editing ? "编辑颜色" : "添加颜色"}
            </h3>
            <p className="text-xs text-gray-400">
              {editing ? "修改颜色信息" : "新建颜色到颜色库"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[58vh] space-y-4 overflow-y-auto px-5 py-4">
          {/* 名称 + 调色板 + HEX */}
          <div className="flex gap-3">
            <div className="relative flex h-16 w-16 shrink-0 flex-col items-center justify-center overflow-hidden rounded-xl border border-gray-200 shadow-sm">
              <input
                type="color"
                value={colorToHex(rgb)}
                onChange={(e) => {
                  const hex = e.target.value.replace("#", "");
                  const n = parseInt(hex, 16);
                  const next: [number, number, number] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
                  setRgb(next);
                  setRgbInput(colorToHex(next));
                }}
                disabled={linked}
                className="absolute inset-0 h-full w-full cursor-pointer border-0 bg-transparent p-0 opacity-0 disabled:cursor-not-allowed"
                aria-label="调色板选择颜色"
              />
              <span
                className="block h-full w-full"
                style={{ backgroundColor: colorToHex(rgb) }}
              />
              <span className="pointer-events-none absolute bottom-0 inset-x-0 bg-black/40 py-0.5 text-center text-[9px] text-white">
                调色板
              </span>
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <label className="w-10 shrink-0 text-[11px] text-gray-400">名称</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="如：品牌蓝"
                  spellCheck={false}
                  className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:border-brand-400 focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="w-10 shrink-0 text-[11px] text-gray-400">HEX</label>
                <input
                  type="text"
                  value={rgbInput}
                  onChange={(e) => handleRgbInput(e.target.value)}
                  disabled={linked}
                  spellCheck={false}
                  className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-sm disabled:bg-gray-100 disabled:text-gray-400 focus:border-brand-400 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* RGB 输入 */}
          <div className="flex items-center gap-2">
            {(["r", "g", "b"] as const).map((ch, idx) => (
              <div key={ch} className="flex items-center gap-1.5">
                <label className="text-[11px] text-gray-400">{ch.toUpperCase()}</label>
                <input
                  type="number"
                  min={0}
                  max={255}
                  value={rgb[idx]}
                  onChange={(e) => patchChannel(ch, Number(e.target.value))}
                  disabled={linked}
                  className="w-16 rounded-lg border border-gray-200 px-1.5 py-1.5 text-center text-sm disabled:bg-gray-100 disabled:text-gray-400 focus:border-brand-400 focus:outline-none"
                />
              </div>
            ))}
          </div>

          {/* 链接配置 */}
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={linked}
                onChange={(e) => setLinked(e.target.checked)}
                className="h-4 w-4 accent-blue-600"
              />
              <Link2 className="h-3.5 w-3.5 text-blue-600" />
              链接到其他颜色（派生色）
            </label>
            {linked && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-2">
                  <label className="w-10 shrink-0 text-[11px] text-gray-400">源色</label>
                  <select
                    value={linkTargetId}
                    onChange={(e) => handleSelectTarget(e.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm focus:border-brand-400 focus:outline-none"
                  >
                    <option value="">选择源颜色…</option>
                    {linkCandidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}（{colorToHex(c.rgb)}）
                      </option>
                    ))}
                  </select>
                </div>
                {targetResolved && (
                  <>
                    {/* 源色 vs 链接色 对比区（实时预览） */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg border border-gray-200 bg-white p-2">
                        <div
                          className="h-12 w-full rounded-md border border-black/10"
                          style={{ backgroundColor: colorToHex(targetResolved.rgb) }}
                        />
                        <p className="mt-1 text-[10px] font-medium text-gray-600">
                          源色 · {targetResolved.name}
                        </p>
                        <p className="text-[10px] text-gray-400">
                          H {Math.round(targetResolved.hsv.h)}° · S{" "}
                          {Math.round(targetResolved.hsv.s)} · V{" "}
                          {Math.round(targetResolved.hsv.v)}
                        </p>
                      </div>
                      <div className="rounded-lg border-2 border-blue-200 bg-blue-50/50 p-2">
                        <div
                          className="h-12 w-full rounded-md border border-black/10"
                          style={{ backgroundColor: colorToHex(rgb) }}
                        />
                        <p className="mt-1 text-[10px] font-medium text-blue-700">
                          链接色 · {name || "未命名"}
                        </p>
                        <p className="text-[10px] text-gray-500">
                          H {Math.round(targetHsv.h)}° · S {Math.round(targetHsv.s)} · V{" "}
                          {Math.round(targetHsv.v)}
                        </p>
                      </div>
                    </div>
                    {(["h", "s", "v"] as const).map((ch) => {
                      const cfg =
                        ch === "h"
                          ? { label: "H", min: 0, max: 360 }
                          : ch === "s"
                          ? { label: "S", min: 0, max: 100 }
                          : { label: "V", min: 0, max: 100 };
                      return (
                        <div key={ch} className="flex items-center gap-2">
                          <label className="w-10 shrink-0 text-[11px] text-gray-400">
                            目标{cfg.label}
                          </label>
                          <input
                            type="range"
                            min={cfg.min}
                            max={cfg.max}
                            value={Math.round(targetHsv[ch])}
                            onChange={(e) => handleAdjustTarget(ch, Number(e.target.value))}
                            className="min-w-0 flex-1 accent-blue-600"
                          />
                          <input
                            type="number"
                            min={cfg.min}
                            max={cfg.max}
                            value={Math.round(targetHsv[ch])}
                            onChange={(e) => handleAdjustTarget(ch, Number(e.target.value))}
                            className="w-14 rounded-lg border border-gray-200 px-1 py-1 text-center text-xs focus:border-brand-400 focus:outline-none"
                          />
                        </div>
                      );
                    })}
                    <p className="text-[11px] text-blue-600 font-mono">
                      公式：{formula.h} · {formula.s} · {formula.v}
                    </p>
                    <p className="text-[10px] text-gray-400">
                      调节目标 H/S/V 自动生成比例公式；源色变化时本色联动，结果自动限制在合法范围。
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
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
            disabled={linked && (!linkTargetId || !formula.h || !formula.s || !formula.v)}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40 transition-colors"
          >
            {editing ? "保存修改" : "添加到颜色库"}
          </button>
        </div>
      </div>
    </div>
  );
}
