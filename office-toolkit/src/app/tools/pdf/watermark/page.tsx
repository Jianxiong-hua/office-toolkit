"use client";

import { useState, useCallback } from "react";
import { Download, FileText, Type, Image as ImageIcon, Eye, RotateCcw } from "lucide-react";
import { ToolLayout } from "@/components/layout/ToolLayout";
import { FileDropZone } from "@/components/tools/FileDropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ErrorAlert } from "@/components/common/ErrorAlert";
import { ProcessProgress } from "@/components/common/ProcessProgress";
import { addWatermark, type WatermarkPosition } from "@/lib/pdf/watermark";
import { readFileAsArrayBuffer, downloadBlob, formatFileSize } from "@/lib/file";
import { AppError, type AppErrorCode } from "@/types";
import type { FileItem } from "@/types";

type WatermarkType = "text" | "image";

const positions: { value: WatermarkPosition; label: string }[] = [
  { value: "center", label: "居中" },
  { value: "topleft", label: "左上" },
  { value: "topright", label: "右上" },
  { value: "bottomleft", label: "左下" },
  { value: "bottomright", label: "右下" },
  { value: "tile", label: "多行平铺" },
];

// 平铺间距系数：保证文字永远不重叠
// 下限 1.0 = 刚好接边（最密集，每个水印独立）
// 上限 1.5 = 50% 间隙（稀疏）
// 默认 1.1 = 10% 间隙
const TILE_SPACING_MIN = 1.0;
const TILE_SPACING_MAX = 1.5;
const TILE_SPACING_DEFAULT = 1.1;

export default function PdfWatermarkPage() {
  const [file, setFile] = useState<FileItem | null>(null);
  const [type, setType] = useState<WatermarkType>("text");
  const [text, setText] = useState("Confidential");
  const [fontSize, setFontSize] = useState(48);
  const [color, setColor] = useState("#999999");
  const [opacity, setOpacity] = useState(0.3);
  const [rotation, setRotation] = useState(45);
  const [position, setPosition] = useState<WatermarkPosition>("center");
  const [tileSpacing, setTileSpacing] = useState(TILE_SPACING_DEFAULT);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageWidth, setImageWidth] = useState(150);
  const [processing, setProcessing] = useState(false);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<{ code?: AppErrorCode; message: string } | null>(null);

  const handlePdfAdded = useCallback((newFiles: FileItem[]) => {
    if (newFiles.length > 0) {
      setFile(newFiles[0]);
      setResultBlob(null);
      setError(null);
    }
  }, []);

  const handleImageAdded = useCallback((newFiles: FileItem[]) => {
    if (newFiles.length > 0) {
      setImageFile(newFiles[0].file);
    }
  }, []);

  const handleRemove = useCallback(() => {
    setFile(null);
    setResultBlob(null);
    setError(null);
  }, []);

  const handleProcess = useCallback(async () => {
    if (!file) return;
    setProcessing(true);
    setError(null);
    setResultBlob(null);

    try {
      const buffer = await readFileAsArrayBuffer(file.file);
      const options =
        type === "text"
          ? {
              type: "text" as const,
              text,
              fontSize,
              color,
              opacity,
              rotation,
              position,
              tileSpacing,
            }
          : {
              type: "image" as const,
              imageFile: imageFile!,
              width: imageWidth,
              opacity,
              rotation,
              position,
              tileSpacing,
            };

      if (type === "image" && !imageFile) {
        throw new AppError("INVALID_INPUT", "请先上传水印图片");
      }

      const bytes = await addWatermark(buffer, options);
      setResultBlob(new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" }));
    } catch (err) {
      if (err instanceof AppError) {
        setError({ code: err.code, message: err.message });
      } else {
        setError({
          code: "PROCESS_FAILED",
          message: "添加水印失败，请重试或更换文件",
        });
      }
    } finally {
      setProcessing(false);
    }
  }, [file, type, text, fontSize, color, opacity, rotation, position, imageFile, imageWidth, tileSpacing]);

  const handleDownload = useCallback(() => {
    if (!resultBlob || !file) return;
    const name = file.name.replace(/\.pdf$/i, "_watermarked.pdf");
    downloadBlob(resultBlob, name);
  }, [resultBlob, file]);

  const handlePreview = useCallback(() => {
    if (!resultBlob) return;
    const url = URL.createObjectURL(resultBlob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, [resultBlob]);

  return (
    <ToolLayout
      title="PDF 水印"
      description="为 PDF 添加文字或图片水印，支持自定义位置、透明度、旋转"
    >
      <div className="space-y-6">
        <FileDropZone
          accept={{ "application/pdf": [".pdf"] }}
          maxFiles={1}
          maxSize={100 * 1024 * 1024}
          onFilesAdded={handlePdfAdded}
          label="拖拽 PDF 文件到此处，或点击选择"
        />

        {error && (
          <ErrorAlert
            code={error.code}
            message={error.message}
            onRetry={handleProcess}
            onClose={() => setError(null)}
          />
        )}

        {file && (
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm space-y-5">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-red-500" />
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">{file.name}</p>
                <p className="text-xs text-gray-400">{formatFileSize(file.size)}</p>
              </div>
              <button
                onClick={handleRemove}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200 transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                重新选择
              </button>
            </div>

            <div className="space-y-3">
              <label className="block text-sm font-medium text-gray-700">水印类型</label>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setType("text")}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                    type === "text"
                      ? "bg-brand-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  <Type className="h-4 w-4" />
                  文字水印
                </button>
                <button
                  onClick={() => setType("image")}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                    type === "image"
                      ? "bg-brand-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  <ImageIcon className="h-4 w-4" />
                  图片水印
                </button>
              </div>
            </div>

            {type === "text" ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    水印文字
                  </label>
                  <input
                    type="text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="请输入水印文字"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      字体大小: {fontSize}px
                    </label>
                    <input
                      type="range"
                      min={12}
                      max={120}
                      value={fontSize}
                      onChange={(e) => setFontSize(Number(e.target.value))}
                      className="w-full accent-brand-600"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      颜色
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={color}
                        onChange={(e) => setColor(e.target.value)}
                        className="h-10 w-10 rounded-lg border border-gray-200"
                      />
                      <input
                        type="text"
                        value={color}
                        onChange={(e) => setColor(e.target.value)}
                        className="flex-1 rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
                      />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <FileDropZone
                  accept={{
                    "image/png": [".png"],
                    "image/jpeg": [".jpg", ".jpeg"],
                  }}
                  maxFiles={1}
                  maxSize={10 * 1024 * 1024}
                  onFilesAdded={handleImageAdded}
                  label="拖拽水印图片到此处，或点击选择（支持 PNG/JPG）"
                />
                {imageFile && (
                  <p className="text-sm text-gray-600">
                    已选择：{imageFile.name} · {formatFileSize(imageFile.size)}
                  </p>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    水印宽度: {imageWidth}px
                  </label>
                  <input
                    type="range"
                    min={20}
                    max={400}
                    value={imageWidth}
                    onChange={(e) => setImageWidth(Number(e.target.value))}
                    className="w-full accent-brand-600"
                  />
                </div>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  透明度: {Math.round(opacity * 100)}%
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(opacity * 100)}
                  onChange={(e) => setOpacity(Number(e.target.value) / 100)}
                  className="w-full accent-brand-600"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  旋转: {rotation}°
                </label>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  value={rotation}
                  onChange={(e) => setRotation(Number(e.target.value))}
                  className="w-full accent-brand-600"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  位置
                </label>
                <select
                  value={position}
                  onChange={(e) => setPosition(e.target.value as WatermarkPosition)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                >
                  {positions.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {position === "tile" && (
              <div>
                <div className="mb-1.5 flex items-center justify-between text-sm font-medium text-gray-700">
                  <span>行间距</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="shrink-0 text-xs text-gray-500">行间距小</span>
                  <input
                    type="range"
                    min={TILE_SPACING_MIN}
                    max={TILE_SPACING_MAX}
                    step={0.05}
                    value={tileSpacing}
                    onChange={(e) => setTileSpacing(Number(e.target.value))}
                    className="w-full accent-brand-600"
                  />
                  <span className="shrink-0 text-xs text-gray-500">行间距大</span>
                </div>
              </div>
            )}

            <DownloadButton
              onClick={handleProcess}
              loading={processing}
              disabled={!file || (type === "image" && !imageFile)}
              label="添加水印"
            />
          </div>
        )}

        {processing && <ProcessProgress message="正在添加水印，请稍候..." />}

        {resultBlob && (
          <div className="rounded-2xl border border-green-100 bg-green-50 p-6 animate-fade-in">
            <h3 className="font-semibold text-green-800 mb-3">水印添加完成</h3>
            <p className="text-sm text-green-700 mb-4">
              结果大小：{formatFileSize(resultBlob.size)}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handlePreview}
                className="inline-flex items-center gap-2 rounded-xl border-2 border-blue-500 bg-blue-50 px-5 py-3 text-sm font-medium text-blue-700 hover:bg-blue-100 transition-colors"
              >
                <Eye className="h-5 w-5" />
                预览文件
              </button>
              <button
                onClick={handleDownload}
                className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-6 py-3 text-white font-medium hover:bg-green-700 transition-colors shadow-lg shadow-green-200"
              >
                <Download className="h-5 w-5" />
                下载结果
              </button>
            </div>
          </div>
        )}
      </div>
    </ToolLayout>
  );
}
