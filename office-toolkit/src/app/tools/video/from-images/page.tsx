"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  Download,
  Loader2,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { ToolLayout } from "@/components/layout/ToolLayout";
import { FileDropZone } from "@/components/tools/FileDropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ErrorAlert } from "@/components/common/ErrorAlert";
import {
  cancelImagesToVideo,
  framesPerImage,
  imagesToVideo,
  isImagesToVideoSupported,
  targetBitrate,
} from "@/lib/video/imagesToVideo";
import {
  pickSaveFileStream,
  supportsSaveFilePicker,
} from "@/lib/fs/save";
import { downloadBlob, formatFileSize } from "@/lib/file";
import { AppError, type FileItem } from "@/types";
import type {
  ImagesOutputSize,
  ImagesToVideoOptions,
  ImagesToVideoResult,
} from "@/types/video";

/** 内存模式（非 Chromium）的总时长上限：成品全在内存里，5 分钟 1080p 约 100MB 量级 */
const MEMORY_MAX_DURATION_SEC = 300;
/** 超过这个张数改用紧凑列表（不渲染缩略图） */
const COMPACT_LIST_THRESHOLD = 200;

const inputClass =
  "w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none";

const SIZE_OPTIONS: { value: ImagesOutputSize; label: string }[] = [
  { value: "original", label: "原始（以第一张为准）" },
  { value: "1080p", label: "1080p（高 1080）" },
  { value: "720p", label: "720p（高 720）" },
  { value: "480p", label: "480p（高 480）" },
];

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);

/** 列表缩略图：只在张数不多时渲染，卸载时释放 objectURL */
function Thumb({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <div className="h-9 w-12 shrink-0 overflow-hidden rounded bg-gray-100">
      {url && (
        <img src={url} alt="" className="h-full w-full object-cover" />
      )}
    </div>
  );
}

export default function ImagesToVideoPage() {
  const [items, setItems] = useState<FileItem[]>([]);
  const [firstDims, setFirstDims] = useState<{
    width: number;
    height: number;
  } | null>(null);
  /** 浏览器是否支持流式写盘（Chromium） */
  const [canStream, setCanStream] = useState(false);
  const [supported, setSupported] = useState(false);

  const [options, setOptions] = useState<ImagesToVideoOptions>({
    mode: "duration",
    secondsPerImage: 2,
    fps: 30,
    size: "original",
    fit: "contain",
    quality: "high",
  });

  const [status, setStatus] = useState<
    "idle" | "loading" | "running" | "done" | "error"
  >("idle");
  const [doneFrames, setDoneFrames] = useState(0);
  const [result, setResult] = useState<ImagesToVideoResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 错误详情（编码器配置、分辨率等），排障时直接看得到 */
  const [errorDetails, setErrorDetails] = useState<string | null>(null);

  const elapsedTimer = useRef<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    setSupported(isImagesToVideoSupported());
    setCanStream(supportsSaveFilePicker());
  }, []);

  // 处理期间秒表
  useEffect(() => {
    if (status !== "running" && status !== "loading") {
      if (elapsedTimer.current) window.clearInterval(elapsedTimer.current);
      return;
    }
    const t0 = performance.now();
    setElapsedSec(0);
    elapsedTimer.current = window.setInterval(
      () => setElapsedSec(Math.floor((performance.now() - t0) / 1000)),
      500
    );
    return () => {
      if (elapsedTimer.current) window.clearInterval(elapsedTimer.current);
    };
  }, [status]);

  const perImage = framesPerImage(options);
  const totalFrames = items.length * perImage;
  const durationSec = options.fps > 0 ? totalFrames / options.fps : 0;

  /** 最大一张的基准尺寸：原始 = 第一张；否则按高度档位换算 */
  const outSize = useMemo(() => {
    if (!firstDims) return null;
    const targetH =
      options.size === "original"
        ? null
        : Number(options.size.replace("p", ""));
    const w = even(
      targetH ? (firstDims.width * targetH) / firstDims.height : firstDims.width
    );
    const h = even(targetH ?? firstDims.height);
    return { width: w, height: h };
  }, [firstDims, options.size]);

  /**
   * 成片体积估算下限 = 目标码率 × 时长 / 8。
   * 实际常高于它：每张图占 1 帧时每帧都是场景切换，编码器基本全出关键帧，
   * 实测超出约 20~40%（228 张 / 22.8 秒 / 2.5 Mbps：估 6.8 MB，实际 8.05 MB），
   * 因此界面给的是「下限 ~ 1.4 倍」的区间。
   */
  const predictedBytes = useMemo(() => {
    if (!outSize) return 0;
    const bitrate = targetBitrate(
      outSize.width,
      outSize.height,
      options.fps,
      options.quality
    );
    return (bitrate * durationSec) / 8;
  }, [outSize, options.fps, options.quality, durationSec]);

  const memoryModeTooLong = !canStream && durationSec > MEMORY_MAX_DURATION_SEC;
  const blocked = !supported || memoryModeTooLong;

  /* ---------- 添加 / 排序 / 删除 ---------- */

  const handleFilesAdded = useCallback(async (added: FileItem[]) => {
    setError(null);
    setResult(null);
    setStatus("idle");
    setDoneFrames(0);
    setItems((prev) => [...prev, ...added].sort((a, b) =>
      collator.compare(a.name, b.name)
    ));
  }, []);

  // 第一张图的真实尺寸（决定输出分辨率）
  useEffect(() => {
    const first = items[0];
    if (!first) {
      setFirstDims(null);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const bmp = await createImageBitmap(first.file);
        if (alive) setFirstDims({ width: bmp.width, height: bmp.height });
        bmp.close();
      } catch {
        if (alive) setFirstDims(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [items]);

  const move = useCallback((index: number, delta: number) => {
    setItems((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const handleReset = useCallback(() => {
    setItems([]);
    setResult(null);
    setError(null);
    setStatus("idle");
    setDoneFrames(0);
  }, []);

  /* ---------- 合成 ---------- */

  const handleStart = useCallback(async () => {
    if (items.length === 0 || blocked) return;

    const dot = items[0].name.lastIndexOf(".");
    const stem = dot > 0 ? items[0].name.slice(0, dot) : items[0].name;
    const suggested = `${stem}.mp4`;

    // 流式写盘：必须先弹「另存为」（用户手势），且在任何长耗时动作之前
    let stream: FileSystemWritableFileStream | undefined;
    if (canStream) {
      try {
        stream = await pickSaveFileStream(suggested);
      } catch (e) {
        if (e instanceof AppError && e.code === "CANCELLED") return;
        setError(e instanceof AppError ? e.message : "无法打开保存位置选择框");
        return;
      }
    }

    setStatus("running");
    setError(null);
    setErrorDetails(null);
    setDoneFrames(0);
    setResult(null);

    try {
      const r = await imagesToVideo(
        items.map((f) => f.file),
        options,
        (n) => setDoneFrames(n),
        stream
      );
      if (stream) {
        await stream.close();
        stream = undefined;
      }
      setResult(r);
      setStatus("done");
    } catch (e) {
      if (stream) {
        try {
          await stream.abort();
        } catch {
          /* 已关闭 */
        }
      }
      if (e instanceof AppError && e.code === "CANCELLED") {
        setStatus("idle");
        return;
      }
      setError(e instanceof AppError ? e.message : "合成失败，请重试或减少图片");
      setErrorDetails(
        e instanceof AppError
          ? (e.details ?? null)
          : e instanceof Error
            ? e.message
            : String(e)
      );
      setStatus("error");
    }
  }, [items, options, blocked, canStream]);

  const progressPct =
    totalFrames > 0
      ? Math.min(100, Math.round((doneFrames / totalFrames) * 100))
      : 0;

  return (
    <ToolLayout
      title="图片合成视频"
      description="把一批图片按顺序合成 MP4 视频，支持每张停留时长或每张一帧，本地编码不上传"
    >
      <div className="space-y-6">
        <p className="text-xs text-gray-500">
          需要先从视频拆图片？用{" "}
          <Link
            href="/tools/video/frames/"
            className="text-brand-600 underline hover:text-brand-700"
          >
            视频提取图片
          </Link>
          ，导出的「frame_000001…」序列可以直接拖进来按原帧率合回视频。
        </p>

        <FileDropZone
          accept={{
            "image/png": [".png"],
            "image/jpeg": [".jpg", ".jpeg"],
            "image/webp": [".webp"],
            "image/bmp": [".bmp"],
          }}
          maxFiles={5000}
          maxSize={50 * 1024 * 1024}
          onFilesAdded={(files) => void handleFilesAdded(files)}
          label="拖拽图片到此处，或点击选择（可多选，按文件名自然排序）"
        />

        {!supported && (
          <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
            当前浏览器不支持 WebCodecs 视频编码（需要 Chrome / Edge 94+、Safari
            16.4+、Firefox 130+），无法使用本工具。
          </div>
        )}

        {items.length > 0 && (
          <>
            <div className="rounded-2xl border border-gray-100 bg-white shadow-sm">
              <div className="flex items-center justify-between p-4 border-b border-gray-100">
                <h3 className="font-semibold text-gray-900">
                  图片序列（{items.length} 张）
                </h3>
                <button
                  onClick={handleReset}
                  disabled={status === "running" || status === "loading"}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200 disabled:opacity-40 transition-colors"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  清空
                </button>
              </div>
              <ul className="max-h-80 overflow-y-auto divide-y divide-gray-50">
                {items.map((item, index) => (
                  <li
                    key={item.id}
                    className={`flex items-center gap-3 px-4 ${
                      items.length > COMPACT_LIST_THRESHOLD ? "py-1.5" : "py-2"
                    }`}
                  >
                    <span className="w-10 shrink-0 text-right text-xs tabular-nums text-gray-400">
                      {index + 1}
                    </span>
                    {items.length <= COMPACT_LIST_THRESHOLD && (
                      <Thumb file={item.file} />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm text-gray-700">
                      {item.name}
                    </span>
                    <span className="hidden shrink-0 text-xs text-gray-400 sm:block">
                      {formatFileSize(item.size)}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => move(index, -1)}
                        disabled={index === 0 || status === "running"}
                        title="上移"
                        className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => move(index, 1)}
                        disabled={
                          index === items.length - 1 || status === "running"
                        }
                        title="下移"
                        className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => remove(item.id)}
                        disabled={status === "running"}
                        title="移除"
                        className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm space-y-4">
              <h3 className="font-semibold text-gray-900">视频选项</h3>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    节奏模式
                  </label>
                  <select
                    value={options.mode}
                    onChange={(e) =>
                      setOptions((prev) => ({
                        ...prev,
                        mode: e.target.value as ImagesToVideoOptions["mode"],
                      }))
                    }
                    className={inputClass}
                  >
                    <option value="duration">每张图停留固定时长</option>
                    <option value="frame">每张图占 1 帧</option>
                  </select>
                  <p className="mt-1 text-xs text-gray-400">
                    {options.mode === "duration"
                      ? "幻灯片效果；张数 × 时长 = 视频时长"
                      : `1 帧 = 1/${options.fps} 秒；与「视频提取图片」互为逆运算`}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    每张停留（秒）
                  </label>
                  <input
                    type="number"
                    min={0.05}
                    step={0.1}
                    disabled={options.mode === "frame"}
                    value={options.secondsPerImage}
                    onChange={(e) =>
                      setOptions((prev) => ({
                        ...prev,
                        secondsPerImage: Math.max(
                          0.05,
                          Number(e.target.value) || 2
                        ),
                      }))
                    }
                    className={`${inputClass} disabled:opacity-40`}
                  />
                  <p className="mt-1 text-xs text-gray-400">
                    {options.mode === "frame"
                      ? "模式二下由 fps 决定时长"
                      : `每张 ${perImage} 帧`}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    输出帧率 (fps)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    step={1}
                    value={options.fps}
                    onChange={(e) =>
                      setOptions((prev) => ({
                        ...prev,
                        fps: Math.min(60, Math.max(1, Number(e.target.value) || 30)),
                      }))
                    }
                    className={inputClass}
                  />
                  <p className="mt-1 text-xs text-gray-400">
                    常见 24 / 25 / 30 / 60
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    输出尺寸
                  </label>
                  <select
                    value={options.size}
                    onChange={(e) =>
                      setOptions((prev) => ({
                        ...prev,
                        size: e.target.value as ImagesOutputSize,
                      }))
                    }
                    className={inputClass}
                  >
                    {SIZE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-400">
                    宽度按第一张图的比例换算，宽高取偶数
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    图片适配
                  </label>
                  <select
                    value={options.fit}
                    onChange={(e) =>
                      setOptions((prev) => ({
                        ...prev,
                        fit: e.target.value as ImagesToVideoOptions["fit"],
                      }))
                    }
                    className={inputClass}
                  >
                    <option value="contain">等比缩放 + 居中黑边</option>
                    <option value="cover">等比缩放 + 居中裁切</option>
                  </select>
                  <p className="mt-1 text-xs text-gray-400">
                    {options.fit === "contain"
                      ? "画面完整不变形，比例不一致时留黑边"
                      : "画面铺满无黑边，可能裁掉边缘内容"}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    画质
                  </label>
                  <select
                    value={options.quality}
                    onChange={(e) =>
                      setOptions((prev) => ({
                        ...prev,
                        quality: e.target.value as ImagesToVideoOptions["quality"],
                      }))
                    }
                    className={inputClass}
                  >
                    <option value="veryhigh">极高（接近无损，体积大）</option>
                    <option value="high">高（推荐）</option>
                    <option value="standard">标准</option>
                    <option value="small">小体积</option>
                  </select>
                  <p className="mt-1 text-xs text-gray-400">
                    H.264 只能有损编码，档位越低细节越糊
                  </p>
                </div>
              </div>

              <div className="rounded-xl bg-gray-50 p-4 space-y-1 text-sm text-gray-700">
                <p>
                  共 <strong>{items.length}</strong> 张 · 输出{" "}
                  <strong>{totalFrames}</strong> 帧 ·{" "}
                  <strong>{durationSec.toFixed(1)}</strong> 秒
                  {outSize && (
                    <>
                      {" "}
                      · <strong>{outSize.width}×{outSize.height}</strong>
                      {" · "}
                      <strong>
                        {(targetBitrate(
                          outSize.width,
                          outSize.height,
                          options.fps,
                          options.quality
                        ) / 1e6).toFixed(1)}{" "}
                        Mbps
                      </strong>
                      {" · 成片约 "}
                      <strong>
                        {formatFileSize(predictedBytes)}
                        {" ~ "}
                        {formatFileSize(predictedBytes * 1.4)}
                      </strong>
                    </>
                  )}
                </p>
                <p className="text-xs text-gray-400">
                  体积按「目标码率 ×
                  时长」估算，给的是区间：重复同一张图时会明显偏小，每张一帧（每帧都是
                  场景切换）时容易偏大；h264/MP4、无音轨
                </p>
                <p className="text-xs text-gray-500">
                  {canStream
                    ? "点击开始后会先让你选择保存位置，边编码边写盘，不受视频大小限制"
                    : `当前浏览器不支持直接写入文件，成品在内存中生成，最长 ${MEMORY_MAX_DURATION_SEC / 60} 分钟`}
                </p>
              </div>

              {memoryModeTooLong && (
                <p className="text-sm text-red-600">
                  时长 {durationSec.toFixed(1)} 秒超过内存模式上限（
                  {MEMORY_MAX_DURATION_SEC / 60} 分钟）。请减少图片、缩短每张时长或降低
                  fps，或改用 Chrome / Edge（可边编码边写盘，无时长限制）。
                </p>
              )}

              <div className="flex items-center gap-3">
                <DownloadButton
                  onClick={() => void handleStart()}
                  loading={status === "running" || status === "loading"}
                  disabled={blocked}
                  label="开始合成"
                />
                {(status === "running" || status === "loading") && (
                  <button
                    onClick={cancelImagesToVideo}
                    className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <X className="h-4 w-4" />
                    取消
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {(status === "running" || status === "loading") && (
          <div className="rounded-2xl border border-blue-100 bg-blue-50 p-6 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-blue-800">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在编码 {doneFrames} / {totalFrames} 帧（{progressPct}%）
              {elapsedSec > 0 && <span>· 已用 {elapsedSec} 秒</span>}
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-blue-100">
              <div
                className="h-full rounded-full bg-brand-600 transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="text-xs text-blue-600">
              编码在浏览器本地进行，请勿刷新或关闭页面
            </p>
          </div>
        )}

        {error && (
          <ErrorAlert
            code="PROCESS_FAILED"
            message={error}
            details={errorDetails ?? undefined}
            onClose={() => {
              setError(null);
              setErrorDetails(null);
            }}
            onRetry={() => void handleStart()}
          />
        )}

        {result && status === "done" && (
          <div className="rounded-2xl border border-green-100 bg-green-50 p-6 space-y-3">
            <h3 className="font-semibold text-green-800">合成完成</h3>
            <div className="text-sm text-green-700 space-y-1">
              <p>
                {result.width}×{result.height} · {result.frameCount} 帧 ·{" "}
                <strong>{result.durationSec.toFixed(1)}</strong> 秒
              </p>
              <p>
                {result.savedToDisk ? (
                  <>已保存为 <strong>{result.filename}</strong></>
                ) : (
                  <>
                    成片大小：
                    <strong>
                      {result.blob ? formatFileSize(result.blob.size) : "-"}
                    </strong>
                  </>
                )}
              </p>
              <p className="text-xs text-green-600">
                耗时 {(result.elapsedMs / 1000).toFixed(1)} 秒 ·{" "}
                {(result.bitrate / 1e6).toFixed(1)} Mbps · 无音轨
              </p>
            </div>
            {result.blob && (
              <button
                onClick={() =>
                  result.blob &&
                  downloadBlob(result.blob, result.filename)
                }
                className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-sm font-medium text-white hover:bg-brand-700 transition-colors shadow-lg shadow-brand-200"
              >
                <Download className="h-4 w-4" />
                下载 {result.filename}
              </button>
            )}
          </div>
        )}
      </div>
    </ToolLayout>
  );
}
