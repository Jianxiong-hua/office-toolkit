"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Contrast, Settings2 } from "lucide-react";
import { ToolLayout } from "@/components/layout/ToolLayout";
import { usePersistedState } from "@/hooks/usePersistedState";
import {
  createDefaultLibraryV3,
  resolveLibraryV3,
  type ColorLibrary,
  type LibraryColor,
  type PairItem,
} from "@/lib/colorLibraryV3";
import type { Mode, CvdType, Filter } from "@/lib/color/contrast";
import { ColorLibraryPanel } from "./ColorLibraryPanel";
import { AddColorModal } from "./AddColorModal";
import { AddPairModal } from "./AddPairModal";
import { ImportModal } from "./ImportModal";
import { ResultGrid } from "./ResultGrid";
import { CvdFilter } from "./CvdFilter";

const LS_KEY = "colorcheck_state_v3";

interface ContrastStateV3 {
  library: ColorLibrary;
  pairs: PairItem[];
  mode: Mode;
  cvd: CvdType;
  sampleIdx: number;
  sortAsc: boolean;
  filter: Filter;
}

function isContrastState(v: unknown): v is ContrastStateV3 {
  const s = v as ContrastStateV3;
  return !!s && !!s.library && Array.isArray(s.library.colors);
}

function createDefaultState(): ContrastStateV3 {
  return {
    library: createDefaultLibraryV3(),
    pairs: [],
    mode: "normal",
    cvd: "none",
    sampleIdx: 0,
    sortAsc: true,
    filter: "all",
  };
}

export default function ColorContrastPage() {
  const [state, setState] = usePersistedState<ContrastStateV3>(
    LS_KEY,
    createDefaultState(),
    isContrastState
  );
  const configFileRef = useRef<HTMLInputElement>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<LibraryColor | null>(null);
  const [pairOpen, setPairOpen] = useState(false);
  const [editingPair, setEditingPair] = useState<PairItem | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const showToast = useCallback((msg: string) => setToast(msg), []);

  const patch = useCallback(
    (p: Partial<ContrastStateV3>) => setState((s) => ({ ...s, ...p })),
    [setState]
  );

  const resolved = useMemo(() => resolveLibraryV3(state.library), [state.library]);

  const handleAddPair = useCallback(
    (data: { textColorId: string; bgColorId: string; textOpacity: number }) => {
      if (editingPair) {
        // 编辑模式：更新现有对
        setState((s) => ({
          ...s,
          pairs: s.pairs.map((p) =>
            p.id === editingPair.id ? { ...p, ...data } : p
          ),
        }));
        showToast("已保存校验对");
        setEditingPair(null);
      } else {
        // 新建
        setState((s) => ({
          ...s,
          pairs: [
            ...s.pairs,
            { id: "pair" + Date.now(), ...data },
          ],
        }));
        showToast("已添加校验对");
      }
    },
    [editingPair, setState, showToast]
  );

  const handleEditPair = useCallback((pair: PairItem) => {
    setEditingPair(pair);
    setPairOpen(true);
  }, []);

  const handleOpenPair = useCallback(() => {
    setEditingPair(null);
    setPairOpen(true);
  }, []);

  /* ---------- 配置导入 / 导出（完整工作区备份） ---------- */
  const exportConfig = useCallback(() => {
    const payload = {
      app: "colorcheck",
      version: 3,
      exportedAt: new Date().toISOString(),
      ...state,
    };
    download(
      JSON.stringify(payload, null, 2),
      `colorcheck-config-${today()}.json`,
      "application/json"
    );
    showToast("已导出完整配置（颜色库 + 校验对 + 设置）");
  }, [state, showToast]);

  const importConfigFile = useCallback(
    (file: File) => {
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const data = JSON.parse(String(rd.result));
          if (!data || !data.library || !Array.isArray(data.library.colors)) {
            showToast("导入失败：不是有效的 ColorCheck 配置文件");
            return;
          }
          if (!window.confirm("导入配置将覆盖当前全部内容（颜色库、校验对与设置），确定继续？")) return;
          // 只取配置文件中的状态字段，忽略 app/version/exportedAt
          const next: Partial<ContrastStateV3> = {
            library: data.library,
            pairs: Array.isArray(data.pairs) ? data.pairs : [],
            mode: data.mode === "large" ? "large" : "normal",
            cvd: data.cvd ?? "none",
            sampleIdx: typeof data.sampleIdx === "number" ? data.sampleIdx : 0,
            sortAsc: typeof data.sortAsc === "boolean" ? data.sortAsc : true,
            filter: data.filter ?? "all",
          };
          setState((s) => ({ ...s, ...next }));
          showToast(`配置导入成功（${data.library.colors.length} 色）`);
        } catch {
          showToast("导入失败：文件格式不正确");
        }
      };
      rd.onerror = () => showToast("文件读取失败");
      rd.readAsText(file);
    },
    [setState, showToast]
  );

  return (
    <ToolLayout
      title="颜色对比度检查"
      description="颜色库驱动的 WCAG 对比度校验：HSV 比例派生、手动校验对、色卡预览"
    >
      <CvdFilter />

      {/* 顶栏 */}
      <div className="mb-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-100">
              <Contrast className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">ColorCheck</p>
              <p className="text-xs text-gray-400">
                颜色库 {resolved.length} 色 · 校验对 {state.pairs.length} 对
              </p>
            </div>
          </div>
          <div className="flex-1" />
          {/* 文字规格切换 */}
          <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-0.5">
            <button
              onClick={() => patch({ mode: "normal" })}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                state.mode === "normal"
                  ? "bg-white text-gray-800 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              正文 4.5
            </button>
            <button
              onClick={() => patch({ mode: "large" })}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                state.mode === "large"
                  ? "bg-white text-gray-800 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              大文本 3.0
            </button>
          </div>
          {/* 样例切换 */}
          <button
            onClick={() => patch({ sampleIdx: (state.sampleIdx + 1) % 3 })}
            className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200 transition-colors"
          >
            样例：{["中文", "英文", "数字"][state.sampleIdx] || "中文"}
          </button>
          {/* CVD 切换 */}
          <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-0.5">
            {(
              [
                ["none", "正常"],
                ["protanopia", "P"],
                ["deuteranopia", "D"],
                ["tritanopia", "T"],
              ] as [CvdType, string][]
            ).map(([val, label]) => (
              <button
                key={val}
                onClick={() => patch({ cvd: val })}
                title={val === "none" ? "正常" : `${label} 色弱模拟`}
                className={`rounded-md px-2 py-1 text-xs transition-colors ${
                  state.cvd === val
                    ? "bg-white text-gray-800 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {/* 配置导入 / 导出 */}
          <button
            onClick={() => configFileRef.current?.click()}
            className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200 transition-colors"
            title="导入完整配置（颜色库 + 校验对 + 设置）"
          >
            <Settings2 className="h-3.5 w-3.5" />
            导入配置
          </button>
          <button
            onClick={exportConfig}
            className="inline-flex items-center gap-1 rounded-lg bg-gray-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-gray-700 transition-colors"
            title="导出完整配置（颜色库 + 校验对 + 设置），换电脑可快速恢复"
          >
            <Settings2 className="h-3.5 w-3.5" />
            导出配置
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr] xl:grid-cols-[360px_1fr] 2xl:grid-cols-[400px_1fr]">
        {/* 左：颜色库 */}
        <aside className="space-y-4">
          <ColorLibraryPanel
            state={state}
            setState={setState}
            resolved={resolved}
            onOpenAdd={() => {
              setEditing(null);
              setAddOpen(true);
            }}
            onOpenImport={() => setImportOpen(true)}
            onEdit={(color) => {
              setEditing(color);
              setAddOpen(true);
            }}
            onToast={showToast}
          />
        </aside>

        {/* 右：校验结果 */}
        <main className="space-y-4">
          <ResultGrid
            state={state}
            setState={setState}
            resolved={resolved}
            onAddPair={handleOpenPair}
            onEditPair={handleEditPair}
            onToast={showToast}
          />
        </main>
      </div>

      {/* Modals */}
      <AddColorModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        setState={setState}
        resolved={resolved}
        editing={editing}
        onToast={showToast}
      />
      <AddPairModal
        open={pairOpen}
        onClose={() => setPairOpen(false)}
        resolved={resolved}
        editingPair={editingPair}
        onConfirm={handleAddPair}
      />
      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        setState={setState}
        onToast={showToast}
        currentLibrary={state.library}
      />

      {/* 配置导入隐藏 input */}
      <input
        ref={configFileRef}
        type="file"
        accept=".json,application/json"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importConfigFile(f);
          e.target.value = "";
        }}
        className="hidden"
      />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-lg bg-gray-900 px-5 py-2.5 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </ToolLayout>
  );
}

function download(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

function today(): string {
  const d = new Date();
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}
