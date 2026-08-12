"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pipette, RotateCcw, X } from "lucide-react";
import { FileDropZone } from "@/components/tools/FileDropZone";
import { loadImage, readFileAsDataURL } from "@/lib/file";
import type { FileItem } from "@/types";
import { rgbToHex } from "@/lib/color/convert";

interface ImagePickerProps {
  /** 取色成功回调：回传 RGBA 和对应 HEX */
  onPick: (rgb: { r: number; g: number; b: number }, hex: string) => void;
  /** 提示当前激活的取色目标（如"左区"/"右区"） */
  targetHint: string;
}

/**
 * 图片取色：上传图片 → 原图绘制到离线 Canvas → 点击图片像素取色。
 * 显示用 <img object-contain>（所见即所得），坐标通过显示区域与自然尺寸换算，
 * 从离线原图 Canvas 中精确取色（保持原图分辨率）。
 */
export function ImagePicker({ onPick, targetHint }: ImagePickerProps) {
  const [file, setFile] = useState<FileItem | null>(null);
  const [dataUrl, setDataUrl] = useState<string>("");
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [hovered, setHovered] = useState<{
    x: number;
    y: number;
    color: string;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!file) return;
    let url: string | null = null;
    (async () => {
      url = URL.createObjectURL(file.file);
      const dl = await readFileAsDataURL(file.file);
      const img = await loadImage(dl);
      setDataUrl(dl);
      setNatural({ w: img.naturalWidth, h: img.naturalHeight });
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    })();
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [file]);

  /** 将客户端坐标换算为原图像素坐标 */
  const toNaturalCoord = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const container = containerRef.current;
      if (!container || !natural) return null;
      const rect = container.getBoundingClientRect();
      const cw = rect.width;
      const ch = rect.height;
      const scale = Math.min(cw / natural.w, ch / natural.h);
      const displayedW = natural.w * scale;
      const displayedH = natural.h * scale;
      const offsetX = (cw - displayedW) / 2;
      const offsetY = (ch - displayedH) / 2;
      const relX = clientX - rect.left - offsetX;
      const relY = clientY - rect.top - offsetY;
      if (relX < 0 || relY < 0 || relX > displayedW || relY > displayedH) {
        return null;
      }
      return {
        x: Math.floor(relX / scale),
        y: Math.floor(relY / scale),
      };
    },
    [natural]
  );

  const getPixel = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      const coord = toNaturalCoord(clientX, clientY);
      if (!canvas || !coord) return null;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      const data = ctx.getImageData(coord.x, coord.y, 1, 1).data;
      if (data[3] === 0) return null;
      return { r: data[0], g: data[1], b: data[2], x: coord.x, y: coord.y };
    },
    [toNaturalCoord]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const px = getPixel(e.clientX, e.clientY);
      if (!px) return;
      const hex = rgbToHex(px.r, px.g, px.b);
      onPick({ r: px.r, g: px.g, b: px.b }, hex);
    },
    [getPixel, onPick]
  );

  const handleMove = useCallback(
    (e: React.MouseEvent) => {
      const px = getPixel(e.clientX, e.clientY);
      if (!px) {
        setHovered(null);
        return;
      }
      setHovered({ x: px.x, y: px.y, color: rgbToHex(px.r, px.g, px.b) });
    },
    [getPixel]
  );

  const reset = useCallback(() => {
    setFile(null);
    setDataUrl("");
    setNatural(null);
    setHovered(null);
  }, []);

  return (
    <div className="space-y-4">
      {!file ? (
        <FileDropZone
          accept={{
            "image/png": [".png"],
            "image/jpeg": [".jpg", ".jpeg"],
            "image/webp": [".webp"],
            "image/bmp": [".bmp"],
            "image/gif": [".gif"],
          }}
          maxFiles={1}
          onFilesAdded={(items) => setFile(items[0])}
          label="拖拽图片到此处，或点击选择"
        />
      ) : (
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm space-y-3">
          <div className="flex items-center gap-3">
            <Pipette className="h-5 w-5 text-brand-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-medium text-gray-900">
                {file.name}
              </p>
              <p className="text-xs text-gray-400">
                点击图片取色 → {targetHint}
              </p>
            </div>
            <button
              onClick={reset}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
              移除
            </button>
          </div>

          <div
            ref={containerRef}
            className="relative w-full overflow-hidden rounded-xl border border-gray-200 cursor-crosshair select-none"
            style={{ height: 400 }}
            onClick={handleClick}
            onMouseMove={handleMove}
            onMouseLeave={() => setHovered(null)}
          >
            {dataUrl && (
              <img
                src={dataUrl}
                alt="取色预览"
                draggable={false}
                className="h-full w-full object-contain"
              />
            )}
            {hovered && (
              <div
                className="pointer-events-none absolute left-3 top-3 rounded-md border border-white/60 bg-black/60 px-2 py-1 text-xs font-medium text-white shadow"
                style={{ backgroundColor: hovered.color }}
              >
                <span className="drop-shadow">
                  {hovered.color} · {hovered.x},{hovered.y}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <button
              onClick={reset}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200 transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              重新选择
            </button>
            <p className="text-xs text-gray-400">点击图片任意位置即可取色</p>
          </div>

          {/* 离线原图 Canvas：不可见，仅用于精确取色 */}
          <canvas ref={canvasRef} className="hidden" />
        </div>
      )}
    </div>
  );
}
