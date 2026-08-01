"use client";

import { useState, useCallback } from "react";
import { Download, FileText, Eye } from "lucide-react";
import { ToolLayout } from "@/components/layout/ToolLayout";
import { FileDropZone } from "@/components/tools/FileDropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ErrorAlert } from "@/components/common/ErrorAlert";
import { ProcessProgress } from "@/components/common/ProcessProgress";
import {
  getPDFPageCount,
  parsePageRanges,
  splitPDFByRanges,
  splitPDFByInterval,
  extractPDFPages,
  extractPDFPagesAsPng,
} from "@/lib/pdf/split";
import { readFileAsArrayBuffer, downloadBlob, formatFileSize } from "@/lib/file";
import { AppError, type AppErrorCode } from "@/types";
import type { FileItem } from "@/types";

type SplitMode = "range" | "interval" | "pages";
type PagesOutputFormat = "pdf" | "png";

interface SplitResult {
  blob: Blob;
  name: string;
  range: string;
  format: PagesOutputFormat;
}

export default function PdfSplitPage() {
  const [file, setFile] = useState<FileItem | null>(null);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [mode, setMode] = useState<SplitMode>("range");
  const [rangeInput, setRangeInput] = useState("");
  const [interval, setInterval] = useState(1);
  const [pagesFormat, setPagesFormat] = useState<PagesOutputFormat>("pdf");
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<SplitResult[]>([]);
  const [error, setError] = useState<{ code?: AppErrorCode; message: string } | null>(null);

  const handleFileAdded = useCallback(async (newFiles: FileItem[]) => {
    if (newFiles.length === 0) return;
    const target = newFiles[0];
    setFile(target);
    setResults([]);
    setError(null);

    try {
      const buffer = await readFileAsArrayBuffer(target.file);
      const count = await getPDFPageCount(buffer);
      setTotalPages(count);
    } catch (err) {
      setError({
        code: "PROCESS_FAILED",
        message: "无法读取 PDF 页数，请检查文件是否损坏或已加密",
      });
      setTotalPages(0);
    }
  }, []);

  const handleRemove = useCallback(() => {
    setFile(null);
    setTotalPages(0);
    setResults([]);
    setError(null);
    setRangeInput("");
  }, []);

  const handleSplit = useCallback(async () => {
    if (!file || totalPages === 0) return;
    setProcessing(true);
    setError(null);
    setResults([]);

    try {
      const buffer = await readFileAsArrayBuffer(file.file);
      let splitResults: { bytes: Uint8Array; range: { start: number; end: number } }[] = [];
      let format: PagesOutputFormat = "pdf";

      if (mode === "range") {
        const ranges = parsePageRanges(rangeInput, totalPages);
        splitResults = await splitPDFByRanges(buffer, ranges);
      } else if (mode === "interval") {
        splitResults = await splitPDFByInterval(buffer, interval);
      } else {
        format = pagesFormat;
        splitResults =
          pagesFormat === "png"
            ? await extractPDFPagesAsPng(buffer)
            : await extractPDFPages(buffer);
      }

      const baseName = file.name.replace(/\.pdf$/i, "");
      const mime = pagesFormat === "png" && mode === "pages" ? "image/png" : "application/pdf";
      const ext = pagesFormat === "png" && mode === "pages" ? "png" : "pdf";
      const newResults: SplitResult[] = splitResults.map(({ bytes, range }) => ({
        blob: new Blob([bytes.buffer as ArrayBuffer], { type: mime }),
        name: `${baseName}_p${range.start}-${range.end}.${ext}`,
        range: `第 ${range.start}-${range.end} 页`,
        format,
      }));

      setResults(newResults);
    } catch (err) {
      if (err instanceof AppError) {
        setError({ code: err.code, message: err.message });
      } else {
        setError({
          code: "PROCESS_FAILED",
          message: "PDF 拆分失败，请重试或更换文件",
        });
      }
    } finally {
      setProcessing(false);
    }
  }, [file, totalPages, mode, rangeInput, interval, pagesFormat]);

  const handleDownload = useCallback((blob: Blob, name: string) => {
    downloadBlob(blob, name);
  }, []);

  const handlePreview = useCallback((blob: Blob, format: PagesOutputFormat) => {
    const url = URL.createObjectURL(blob);
    if (format === "png") {
      // PNG 打开新窗口展示图片
      const w = window.open("", "_blank");
      if (w) {
        w.document.write(`
          <!doctype html>
          <html><head><title>预览</title>
          <style>body{margin:0;background:#f3f4f6;display:flex;align-items:center;justify-content:center;min-height:100vh}
          img{max-width:100%;max-height:100vh;box-shadow:0 4px 24px rgba(0,0,0,.15);background:white}</style>
          </head><body><img src="${url}"/></body></html>
        `);
      }
    } else {
      window.open(url, "_blank");
    }
  }, []);

  const handleDownloadAll = useCallback(async () => {
    if (results.length === 0) return;
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    results.forEach((r) => zip.file(r.name, r.blob));
    const zipBlob = await zip.generateAsync({ type: "blob" });
    const baseName = file?.name.replace(/\.pdf$/i, "") ?? "split";
    downloadBlob(zipBlob, `${baseName}_split.zip`);
  }, [results, file]);

  return (
    <ToolLayout
      title="PDF 拆分"
      description="按页码范围、每 N 页或单页提取拆分 PDF 文件"
    >
      <div className="space-y-6">
        <FileDropZone
          accept={{ "application/pdf": [".pdf"] }}
          maxFiles={1}
          maxSize={100 * 1024 * 1024}
          onFilesAdded={handleFileAdded}
          label="拖拽 PDF 文件到此处，或点击选择"
        />

        {error && (
          <ErrorAlert
            code={error.code}
            message={error.message}
            onRetry={handleSplit}
            onClose={() => setError(null)}
          />
        )}

        {file && (
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-red-500" />
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">{file.name}</p>
                <p className="text-xs text-gray-400">
                  {formatFileSize(file.size)} · 共 {totalPages} 页
                </p>
              </div>
              <button
                onClick={handleRemove}
                className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200 transition-colors"
              >
                重新选择
              </button>
            </div>

            <div className="space-y-3">
              <label className="block text-sm font-medium text-gray-700">拆分方式</label>
              <div className="flex flex-wrap gap-2">
                {[
                  { value: "range", label: "按页码范围" },
                  { value: "interval", label: "每 N 页拆分" },
                  { value: "pages", label: "逐页提取" },
                ].map((item) => (
                  <button
                    key={item.value}
                    onClick={() => setMode(item.value as SplitMode)}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                      mode === item.value
                        ? "bg-brand-600 text-white"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {mode === "range" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  页码范围
                </label>
                <input
                  type="text"
                  value={rangeInput}
                  onChange={(e) => setRangeInput(e.target.value)}
                  placeholder={`例如：1-3, 5, 8-${totalPages || 10}`}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                />
                <p className="mt-1 text-xs text-gray-400">
                  支持格式：1-3, 5, 8-10（使用英文逗号分隔）
                </p>
              </div>
            )}

            {mode === "interval" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  每几页拆分一个文件
                </label>
                <input
                  type="number"
                  min={1}
                  max={totalPages || 1}
                  value={interval}
                  onChange={(e) => setInterval(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                />
              </div>
            )}

            {mode === "pages" && (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">输出格式</label>
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="pagesFormat"
                      value="pdf"
                      checked={pagesFormat === "pdf"}
                      onChange={() => setPagesFormat("pdf")}
                      className="h-4 w-4 accent-brand-600"
                    />
                    <span className="text-sm text-gray-700">单页 PDF</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="pagesFormat"
                      value="png"
                      checked={pagesFormat === "png"}
                      onChange={() => setPagesFormat("png")}
                      className="h-4 w-4 accent-brand-600"
                    />
                    <span className="text-sm text-gray-700">单页 PNG 图片</span>
                  </label>
                </div>
                <p className="text-xs text-gray-400">
                  {pagesFormat === "png"
                    ? "提示：每页导出为一张高清晰度 PNG 图片（适合打印或编辑）"
                    : "提示：每页输出为独立的单页 PDF 文件"}
                </p>
              </div>
            )}

            <DownloadButton
              onClick={handleSplit}
              loading={processing}
              disabled={!file || totalPages === 0}
              label="开始拆分"
            />
          </div>
        )}

        {processing && (
          <ProcessProgress message="正在拆分 PDF，请稍候..." />
        )}

        {results.length > 0 && (
          <div className="rounded-2xl border border-green-100 bg-green-50 p-6 animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-green-800">
                拆分完成，共 {results.length} 个文件
              </h3>
              {results.length > 1 && (
                <button
                  onClick={handleDownloadAll}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors"
                >
                  <Download className="h-4 w-4" />
                  打包下载
                </button>
              )}
            </div>
            <ul className="space-y-2">
              {results.map((r, index) => (
                <li
                  key={index}
                  className="flex items-center justify-between rounded-lg bg-white px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">{r.name}</p>
                    <p className="text-xs text-gray-500">
                      {r.range} · {formatFileSize(r.blob.size)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handlePreview(r.blob, r.format)}
                      className="inline-flex items-center gap-1 rounded-lg bg-blue-100 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-200 transition-colors"
                    >
                      <Eye className="h-4 w-4" />
                      预览
                    </button>
                    <button
                      onClick={() => handleDownload(r.blob, r.name)}
                      className="inline-flex items-center gap-1 rounded-lg bg-green-100 px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-200 transition-colors"
                    >
                      <Download className="h-4 w-4" />
                      下载
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </ToolLayout>
  );
}
