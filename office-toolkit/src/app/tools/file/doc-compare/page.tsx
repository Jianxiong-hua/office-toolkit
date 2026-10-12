"use client";

import { useCallback, useMemo, useState } from "react";
import { ToolLayout } from "@/components/layout/ToolLayout";
import { ErrorAlert } from "@/components/common/ErrorAlert";
import { readFileAsArrayBuffer } from "@/lib/file";
import { MAX_LINES, diffLines, diffStats, type DiffRow } from "@/lib/document/diff";
import {
  ENCODING_LABELS,
  extractDocx,
  extractPlainText,
  decodeText,
  needsGbkFallback,
  type DocEncoding,
} from "@/lib/document/extract";
import { DiffView } from "./DiffView";
import { DocSlot } from "./DocSlot";
import { SingleView } from "./SingleView";

export interface DocSlotState {
  name: string;
  format: "docx" | "txt" | "md";
  buffer: ArrayBuffer;
  encoding: DocEncoding;
  lines: string[];
  needsFallback: boolean;
  loading: boolean;
  error: string | null;
}

const TEXT_EXT = ["txt", "md"];



export default function DocComparePage() {
  const [slotA, setSlotA] = useState<DocSlotState | null>(null);
  const [slotB, setSlotB] = useState<DocSlotState | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const loadFile = useCallback(
    async (file: File, encoding: DocEncoding): Promise<DocSlotState> => {
      const ext = (file.name.split(".").pop() ?? "").toLowerCase();
      const format = ext === "docx" ? "docx" : ext === "md" ? "md" : "txt";
      const base: DocSlotState = {
        name: file.name,
        format,
        buffer: new ArrayBuffer(0),
        encoding,
        lines: [],
        needsFallback: false,
        loading: true,
        error: null,
      };
      try {
        const buffer = await readFileAsArrayBuffer(file);
        let lines: string[] = [];
        let needsFallback = false;
        if (format === "docx") {
          lines = await extractDocx(buffer);
        } else {
          let text = decodeText(buffer, encoding);
          if (encoding === "utf-8" && needsGbkFallback(text)) {
            // 中文 txt 常为 GBK：UTF-8 解出替换字符时自动回退重解
            text = decodeText(buffer, "gbk");
            needsFallback = true;
          }
          lines = extractPlainText(text);
        }
        return { ...base, buffer, lines, needsFallback, loading: false };
      } catch (err) {
        return {
          ...base,
          buffer: new ArrayBuffer(0),
          loading: false,
          error: err instanceof Error ? err.message : "文档读取失败",
        };
      }
    },
    []
  );

  /** 从已保存的 buffer 重新解码（编码切换用；docx 与编码无关，不会走到这里） */
  async function loadFromBuffer(
    name: string,
    buffer: ArrayBuffer,
    format: "docx" | "txt" | "md",
    encoding: DocEncoding
  ): Promise<DocSlotState> {
    const base: DocSlotState = {
      name,
      format,
      buffer,
      encoding,
      lines: [],
      needsFallback: false,
      loading: true,
      error: null,
    };
    try {
      let lines: string[] = [];
      let needsFallback = false;
      if (format === "docx") {
        lines = await extractDocx(buffer);
      } else {
        let text = decodeText(buffer, encoding);
        if (encoding === "utf-8" && needsGbkFallback(text)) {
          text = decodeText(buffer, "gbk");
          needsFallback = true;
        }
        lines = extractPlainText(text);
      }
      return { ...base, lines, needsFallback, loading: false };
    } catch (err) {
      return {
        ...base,
        loading: false,
        error: err instanceof Error ? err.message : "文档读取失败",
      };
    }
  }

  const handleFile = useCallback(
    (slot: "a" | "b") => {
      return async (file: File) => {
        const setter = slot === "a" ? setSlotA : setSlotB;
        setter({ name: file.name, format: "txt", buffer: new ArrayBuffer(0), encoding: "utf-8", lines: [], needsFallback: false, loading: true, error: null });
        setter(await loadFile(file, "utf-8"));
      };
    },
    [loadFile]
  );

  const handleEncodingChange = useCallback(
    (slot: "a" | "b") => {
      return async (encoding: DocEncoding) => {
        const current = slot === "a" ? slotA : slotB;
        const setter = slot === "a" ? setSlotA : setSlotB;
        if (!current) return;
        if (current.encoding === encoding) return;
        setter({ ...current, encoding, loading: true, error: null });
        // 从保存的 buffer 重新解码（docx 不提供编码切换）
        const reloaded = await loadFromBuffer(current.name, current.buffer, current.format, encoding);
        setter(reloaded);
      };
    },
    [slotA, slotB, loadFromBuffer]
  );

  const handleClear = useCallback((slot: "a" | "b") => {
    if (slot === "a") setSlotA(null);
    else setSlotB(null);
  }, []);

  const isCompare = slotA !== null && slotB !== null;
  const diffRows: DiffRow[] = useMemo(() => {
    if (!isCompare) return [];
    return diffLines(slotA!.lines, slotB!.lines);
  }, [isCompare, slotA, slotB]);
  const stats = useMemo(() => diffStats(diffRows), [diffRows]);
  const overLimit =
    (slotA?.lines.length ?? 0) > MAX_LINES || (slotB?.lines.length ?? 0) > MAX_LINES;
  const showFormatNotice = slotA?.format === "docx" || slotB?.format === "docx";

  return (
    <ToolLayout
      title="文档对比"
      description="打开查看 docx、txt、md 文档，或并排对比两份文档的行级差异"
    >
      <p className="mb-3 rounded-lg bg-blue-50 p-3 text-xs text-blue-700">
        支持 .docx / .txt / .md；.doc 为旧版二进制格式暂不支持，请在 Word 中另存为 .docx 后使用。
        放入一个文档即查看模式，放入两个自动进入对比模式。
      </p>

      {globalError && <ErrorAlert message={globalError} onClose={() => setGlobalError(null)} />}

      <div className="grid gap-4 md:grid-cols-2">
        <DocSlot
          label="文档 A（左侧）"
          state={slotA}
          onFile={handleFile("a")}
          onEncodingChange={handleEncodingChange("a")}
          onClear={() => handleClear("a")}
        />
        <DocSlot
          label="文档 B（右侧）"
          state={slotB}
          onFile={handleFile("b")}
          onEncodingChange={handleEncodingChange("b")}
          onClear={() => handleClear("b")}
        />
      </div>

      {overLimit && (
        <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
          文档超过 {MAX_LINES.toLocaleString()} 行，差异结果可能不精确、滚动可能变慢。
        </p>
      )}

      <div className="mt-4">
        {isCompare && <DiffView rows={diffRows} stats={stats} showFormatNotice={showFormatNotice} />}
        {!isCompare && slotA && <SingleView lines={slotA.lines} />}
        {!isCompare && slotB && <SingleView lines={slotB.lines} />}
      </div>
    </ToolLayout>
  );
}
