"use client";

import { useState, useCallback } from "react";
import Cropper from "react-easy-crop";
import { Download, RotateCcw, FlipHorizontal, FlipVertical } from "lucide-react";
import { ToolLayout } from "@/components/layout/ToolLayout";
import { FileDropZone } from "@/components/tools/FileDropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ErrorAlert } from "@/components/common/ErrorAlert";
import { ProcessProgress } from "@/components/common/ProcessProgress";
import { cropImage, type CropOutputFormat } from "@/lib/image/crop";
import {
  downloadBlob,
  formatFileSize,
  generateOutputFilename,
  readFileAsDataURL,
} from "@/lib/file";
import { AppError, type AppErrorCode, type FileItem } from "@/types";
import type { Point, Area } from "react-easy-crop";

const aspectRatios = [
  { value: undefined, label: "自由" },
  { value: 1, label: "1:1" },
  { value: 4 / 3, label: "4:3" },
  { value: 16 / 9, label: "16:9" },
  { value: 3 / 4, label: "3:4" },
  { value: 9 / 16, label: "9:16" },
];

export default function ImageCropPage() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [aspect, setAspect] = useState<number | undefined>(undefined);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [flipX, setFlipX] = useState(false);
  const [flipY, setFlipY] = useState(false);
  const [format, setFormat] = useState<CropOutputFormat>("original");
  const [quality, setQuality] = useState(92);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{ blob: Blob; width: number; height: number } | null>(null);
  const [error, setError] = useState<{ code?: AppErrorCode; message: string } | null>(null);

  const currentFile = files[currentIndex];

  const handleFilesAdded = useCallback(async (newFiles: FileItem[]) => {
    const withPreviews = await Promise.all(
      newFiles.map(async (f) => {
        if (f.type.startsWith("image/")) {
          return { ...f, preview: await readFileAsDataURL(f.file) };
        }
        return f;
      })
    );
    setFiles((prev) => [...prev, ...withPreviews]);
    if (files.length === 0 && withPreviews.length > 0) {
      setCurrentIndex(0);
      setImageSrc(withPreviews[0].preview ?? null);
    }
    setResult(null);
    setError(null);
  }, [files.length]);

  const handleRemove = useCallback((id: string) => {
    setFiles((prev) => {
      const next = prev.filter((f) => f.id !== id);
      if (next.length === 0) {
        setImageSrc(null);
        setCurrentIndex(0);
      } else if (currentIndex >= next.length) {
        setCurrentIndex(next.length - 1);
        setImageSrc(next[next.length - 1].preview ?? null);
      } else {
        setImageSrc(next[currentIndex]?.preview ?? null);
      }
      return next;
    });
    setResult(null);
  }, [currentIndex]);

  const handleSelectFile = useCallback((index: number) => {
    setCurrentIndex(index);
    setImageSrc(files[index]?.preview ?? null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    setRotation(0);
    setFlipX(false);
    setFlipY(false);
    setResult(null);
  }, [files]);

  const handleCropComplete = useCallback((_: Area, croppedAreaPixels: Area) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const handleProcess = useCallback(async () => {
    if (!currentFile || !croppedAreaPixels) return;
    setProcessing(true);
    setError(null);
    setResult(null);

    try {
      const { blob, width, height } = await cropImage(currentFile.file, {
        crop: {
          x: croppedAreaPixels.x,
          y: croppedAreaPixels.y,
          width: croppedAreaPixels.width,
          height: croppedAreaPixels.height,
        },
        rotation,
        flipX,
        flipY,
        format,
        quality: quality / 100,
      });
      setResult({ blob, width, height });
    } catch (err) {
      if (err instanceof AppError) {
        setError({ code: err.code, message: err.message });
      } else {
        setError({ code: "PROCESS_FAILED", message: "图片裁剪失败，请重试" });
      }
    } finally {
      setProcessing(false);
    }
  }, [currentFile, croppedAreaPixels, rotation, flipX, flipY, format, quality]);

  const handleDownload = useCallback(() => {
    if (!result || !currentFile) return;
    const ext = format === "original" ? undefined : format;
    const name = generateOutputFilename(currentFile.name, "cropped", ext);
    downloadBlob(result.blob, name);
  }, [result, currentFile, format]);

  return (
    <ToolLayout
      title="图片裁剪"
      description="自由裁剪图片，支持固定比例、旋转、翻转"
    >
      <div className="space-y-6">
        <FileDropZone
          accept={{
            "image/png": [".png"],
            "image/jpeg": [".jpg", ".jpeg"],
            "image/webp": [".webp"],
            "image/bmp": [".bmp"],
            "image/gif": [".gif"],
          }}
          onFilesAdded={handleFilesAdded}
          label="拖拽图片到此处，或点击选择"
        />

        {error && (
          <ErrorAlert
            code={error.code}
            message={error.message}
            onRetry={handleProcess}
            onClose={() => setError(null)}
          />
        )}

        {files.length > 0 && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {files.map((file, index) => (
                <button
                  key={file.id}
                  onClick={() => handleSelectFile(index)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    index === currentIndex
                      ? "bg-brand-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {file.name}
                </button>
              ))}
            </div>

            {currentFile && (
              <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{currentFile.name}</p>
                    <p className="text-xs text-gray-400">{formatFileSize(currentFile.size)}</p>
                  </div>
                  <button
                    onClick={() => handleRemove(currentFile.id)}
                    className="text-xs text-red-500 hover:underline"
                  >
                    删除
                  </button>
                </div>

                {imageSrc && (
                  <>
                    <div className="relative h-[320px] w-full rounded-xl bg-gray-900 overflow-hidden">
                      <Cropper
                        image={imageSrc}
                        crop={crop}
                        zoom={zoom}
                        aspect={aspect}
                        rotation={rotation}
                        onCropChange={setCrop}
                        onZoomChange={setZoom}
                        onCropComplete={handleCropComplete}
                      />
                    </div>

                    <div className="mt-4 space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">
                          缩放
                        </label>
                        <input
                          type="range"
                          min={1}
                          max={3}
                          step={0.1}
                          value={zoom}
                          onChange={(e) => setZoom(Number(e.target.value))}
                          className="w-full accent-brand-600"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">
                          固定比例
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {aspectRatios.map((ratio) => (
                            <button
                              key={ratio.label}
                              onClick={() => setAspect(ratio.value)}
                              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                                aspect === ratio.value
                                  ? "bg-brand-600 text-white"
                                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                              }`}
                            >
                              {ratio.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          onClick={() =>
                            setRotation((prev) => ((prev + 90) % 360) as 0 | 90 | 180 | 270)
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
                        >
                          <RotateCcw className="h-4 w-4" />
                          旋转 90°
                        </button>
                        <button
                          onClick={() => setFlipX((prev) => !prev)}
                          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                            flipX ? "bg-brand-100 text-brand-700" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                          }`}
                        >
                          <FlipHorizontal className="h-4 w-4" />
                          水平翻转
                        </button>
                        <button
                          onClick={() => setFlipY((prev) => !prev)}
                          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                            flipY ? "bg-brand-100 text-brand-700" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                          }`}
                        >
                          <FlipVertical className="h-4 w-4" />
                          垂直翻转
                        </button>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1.5">
                            输出格式
                          </label>
                          <select
                            value={format}
                            onChange={(e) => setFormat(e.target.value as CropOutputFormat)}
                            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                          >
                            <option value="original">保持原格式</option>
                            <option value="jpeg">JPEG</option>
                            <option value="png">PNG</option>
                            <option value="webp">WebP</option>
                          </select>
                        </div>
                        {(format === "jpeg" || format === "webp") && (
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1.5">
                              质量: {quality}%
                            </label>
                            <input
                              type="range"
                              min={10}
                              max={100}
                              value={quality}
                              onChange={(e) => setQuality(Number(e.target.value))}
                              className="w-full accent-brand-600"
                            />
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <DownloadButton
                          onClick={handleProcess}
                          loading={processing}
                          label="裁剪当前图片"
                        />
                        {result && (
                          <button
                            onClick={handleDownload}
                            className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-6 py-3 text-sm font-medium text-white hover:bg-green-700 transition-colors shadow-lg shadow-green-200"
                          >
                            <Download className="h-5 w-5" />
                            下载 ({result.width}×{result.height})
                          </button>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {processing && <ProcessProgress message="正在裁剪图片..." />}
      </div>
    </ToolLayout>
  );
}
