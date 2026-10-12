"use client";

import { FileText, Loader2, RefreshCcw } from "lucide-react";
import { FileDropZone } from "@/components/tools/FileDropZone";
import { ENCODING_LABELS, type DocEncoding } from "@/lib/document/extract";
import type { DocSlotState } from "./page";

interface DocSlotProps {
  label: string;
  state: DocSlotState | null;
  onFile: (file: File) => void;
  onEncodingChange: (encoding: DocEncoding) => void;
  onClear: () => void;
}

/** 单个文档槽：未加载时是拖拽区，加载后是信息条（文件名/格式/行数/编码切换） */
export function DocSlot({ label, state, onFile, onEncodingChange, onClear }: DocSlotProps) {
  return (
    <div className="min-w-0 rounded-xl border border-gray-100 bg-white p-4">
      <p className="mb-2 text-xs font-medium text-gray-500">{label}</p>
      {!state && (
        <FileDropZone
          accept={{
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
            "text/plain": [".txt"],
            "text/markdown": [".md"],
          }}
          maxFiles={1}
          onFilesAdded={(items) => {
            const item = items[0];
            if (item) onFile(item.file);
          }}
          label="拖拽文档到此处，或点击选择"
        />
      )}
      {state?.loading && (
        <div className="flex items-center gap-2 rounded-xl bg-gray-50 p-4 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在读取…
        </div>
      )}
      {state && !state.loading && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-gray-400" />
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
              {state.name}
            </p>
            <button
              onClick={onClear}
              className="shrink-0 rounded-lg border border-gray-200 p-1.5 text-gray-500 transition-colors hover:bg-gray-50"
              title="移除文档"
            >
              <RefreshCcw className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
            <span>
              {state.format?.toUpperCase()} · {state.lines.length.toLocaleString()} 行
            </span>
            {state.error && <span className="text-red-600">{state.error}</span>}
            {state.format !== "docx" && (
              <label className="flex items-center gap-1">
                编码
                <select
                  value={state.encoding}
                  onChange={(e) => onEncodingChange(e.target.value as DocEncoding)}
                  className="rounded-lg border border-gray-200 bg-white px-1.5 py-1 text-xs text-gray-800 focus:border-brand-400 focus:outline-none"
                >
                  {(Object.keys(ENCODING_LABELS) as DocEncoding[]).map((enc) => (
                    <option key={enc} value={enc}>
                      {ENCODING_LABELS[enc]}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {state.needsFallback && (
            <p className="text-xs text-amber-600">
              该文件不是有效 UTF-8，已自动按 GBK 重新解码；若仍有乱码请手动切换编码。
            </p>
          )}
        </div>
      )}
    </div>
  );
}
