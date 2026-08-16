"use client";

import { useCallback, useRef, useState } from "react";
import { X, Download, Upload, FileSpreadsheet } from "lucide-react";
import {
  buildCsvTemplateV3,
  buildLibraryCsvV3,
  parseColorCsvV3,
  type ColorLibrary,
  type LibraryColor,
} from "@/lib/colorLibraryV3";

interface ImportModalProps {
  open: boolean;
  onClose: () => void;
  setState: React.Dispatch<React.SetStateAction<any>>;
  onToast: (msg: string) => void;
  currentLibrary: ColorLibrary;
}

/**
 * 导入颜色库：提供模板下载；导入前询问是否导出当前库备份；
 * 导入成功则清空现有颜色库并替换为文件内容。
 */
export function ImportModal({
  open,
  onClose,
  setState,
  onToast,
  currentLibrary,
}: ImportModalProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const downloadTemplate = useCallback(() => {
    download(
      buildCsvTemplateV3(),
      "color-library-template.csv",
      "text/csv;charset=utf-8"
    );
    onToast("模板已下载");
  }, [onToast]);

  const handleFile = useCallback(
    (file: File) => {
      setErrors([]);
      const rd = new FileReader();
      rd.onload = () => {
        const text = String(rd.result || "");
        const { colors, errors: parseErrors } = parseColorCsvV3(text);
        if (colors.length === 0) {
          setErrors(parseErrors);
          return;
        }
        // 追加导入：保留原色库颜色，将文件中的颜色追加到末尾
        // 若文件中名称与现有颜色重复，则为新导入颜色追加后缀避免混淆
        setState((s: any) => {
          const existing = s.library.colors as LibraryColor[];
          const existingNames = new Set(existing.map((c) => c.name));
          const merged = colors.map((c, idx) => {
            let finalName = c.name;
            let n = 2;
            while (existingNames.has(finalName)) {
              finalName = `${c.name} ${n}`;
              n++;
            }
            existingNames.add(finalName);
            return { ...c, id: "import_" + Date.now() + "_" + idx, name: finalName };
          });
          return {
            ...s,
            library: { colors: [...existing, ...merged] },
          };
        });
        const warnMsg =
          parseErrors.length > 0
            ? `已追加 ${colors.length} 个颜色（${parseErrors.length} 行被跳过）`
            : `已追加 ${colors.length} 个颜色`;
        onToast(warnMsg);
        if (parseErrors.length > 0) setErrors(parseErrors);
        onClose();
      };
      rd.onerror = () => {
        onToast("文件读取失败");
      };
      rd.readAsText(file);
    },
    [currentLibrary, setState, onToast, onClose]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) handleFile(f);
      e.target.value = "";
    },
    [handleFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files?.[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h3 className="font-semibold text-gray-900">导入颜色库</h3>
            <p className="text-xs text-gray-400">按模板导入，新颜色将追加到颜色库</p>
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
          {/* 模板说明 */}
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-xs text-gray-500 leading-relaxed">
            <p className="mb-1 font-medium text-gray-700">模板格式（CSV，可用 Excel 打开）</p>
            <p>表头：<code className="text-gray-800">名称, HEX</code></p>
            <ul className="mt-1 list-disc pl-4 space-y-0.5">
              <li>HEX 形如 <code className="text-gray-800">#FF0000</code>（支持 3 位短格式）</li>
              <li>导入的颜色将<b>追加</b>到现有颜色库，原有颜色保留</li>
              <li>名称与现有颜色重复时自动加序号（如"红 2"）</li>
            </ul>
          </div>

          <button
            onClick={downloadTemplate}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <FileSpreadsheet className="h-4 w-4 text-green-600" />
            下载模板 CSV
          </button>

          {/* 拖拽/选择上传 */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
              dragOver ? "border-brand-400 bg-brand-50" : "border-gray-200 hover:border-gray-300"
            }`}
          >
            <Upload className="mx-auto h-6 w-6 text-gray-400" />
            <p className="mt-2 text-sm text-gray-600">拖拽 CSV 文件到此处，或点击选择</p>
            <p className="mt-1 text-xs text-gray-400">导入的颜色将追加到现有颜色库，原有颜色保留</p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleChange}
            className="hidden"
          />

          {errors.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3">
              <p className="mb-1 text-xs font-semibold text-red-700">解析提示（{errors.length} 项）</p>
              <ul className="max-h-24 list-disc space-y-0.5 overflow-y-auto pl-4 text-xs text-red-600">
                {errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-200 transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
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
