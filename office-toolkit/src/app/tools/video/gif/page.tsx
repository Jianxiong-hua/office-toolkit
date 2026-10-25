"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Loader2, RotateCcw, X } from "lucide-react";
import { ToolLayout } from "@/components/layout/ToolLayout";
import { FileDropZone } from "@/components/tools/FileDropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ErrorAlert } from "@/components/common/ErrorAlert";
import { VideoTrimEditor } from "@/components/tools/VideoTrimEditor";
import { videoToGif } from "@/lib/video/gif";
import {
  cancelFastGif,
  fastGifVideo,
  isFastGifCandidate,
} from "@/lib/video/fastGif";
import { readVideoMeta } from "@/lib/video/probe";
import {
  cancelConversion,
  ensureLoaded,
  getFfmpegCoreMode,
} from "@/lib/video/ffmpeg";
import { downloadBlob, formatFileSize } from "@/lib/file";
import { AppError } from "@/types";
import type {
  VideoConvertPhase,
  VideoGifOptions,
  VideoGifResult,
  VideoMeta,
} from "@/types/video";

const MAX_FILE_SIZE = 200 * 1024 * 1024;

const COLOR_OPTIONS: { value: VideoGifOptions["maxColors"]; label: string }[] = [
  { value: 255, label: "255 色（最佳）" },
  { value: 128, label: "128 色（推荐）" },
  { value: 64, label: "64 色" },
  { value: 32, label: "32 色（最小）" },
];

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

type Status = "idle" | "loading" | "converting" | "done" | "error";

export default function VideoToGifPage() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [meta, setMeta] = useState<VideoMeta | null>(null);

  const [options, setOptions] = useState<VideoGifOptions>({
    trimStart: 0,
    trimEnd: null,
    fps: 15,
    width: 480,
    maxColors: 128,
    loop: "infinite",
    speed: 1,
  });

  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<VideoConvertPhase>("analyzing");
  const [result, setResult] = useState<VideoGifResult | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 极速模式：走 WebCodecs 硬件解码，仅支持 MP4/MOV(H.264) */
  const [fastMode, setFastMode] = useState(false);
  /** 上一次成功转换实际走的路径（结果显示用，避免用户切开关后显示错乱） */
  const [resultEngine, setResultEngine] = useState<"fast" | "compat">("compat");
  /** 浏览器是否支持 WebCodecs（放到 effect 里判断，避免静态导出的 hydration 不一致） */
  const [fastSupported, setFastSupported] = useState(false);
  /** 转换已用时（秒）：ffmpeg 拿不到中间进度时，至少让用户看到任务在走 */
  const [elapsedSec, setElapsedSec] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    setFastSupported(typeof VideoDecoder !== "undefined");
  }, []);

  // 转换期间的秒表：引擎加载（loading）不计，真正开始处理才计时
  useEffect(() => {
    if (status !== "converting") return;
    const t0 = performance.now();
    setElapsedSec(0);
    const id = setInterval(
      () => setElapsedSec(Math.floor((performance.now() - t0) / 1000)),
      500
    );
    return () => clearInterval(id);
  }, [status]);

  /** 当前文件能否用极速模式（不能时开关禁用并说明原因） */
  const fastAvailable = fastSupported && !!file && isFastGifCandidate(file);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);
  useEffect(() => {
    return () => {
      if (resultUrl) URL.revokeObjectURL(resultUrl);
    };
  }, [resultUrl]);

  const handleFile = useCallback(async (f: File) => {
    setError(null);
    setResult(null);
    setStatus("idle");
    setProgress(0);
    setMeta(null);
    setOptions((prev) => ({ ...prev, trimStart: 0, trimEnd: null }));
    // 默认勾选极速模式：文件支持（MP4/MOV + WebCodecs）时才勾，否则保持关闭并显示禁用原因
    setFastMode(isFastGifCandidate(f));
    setFile(f);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(f);
    });
    try {
      setMeta(await readVideoMeta(f));
    } catch (e) {
      setError(e instanceof AppError ? e.message : "无法读取该视频，请更换文件");
    }
  }, []);

  const handleReselect = useCallback(() => {
    setFile(null);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setResultUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setResult(null);
    setMeta(null);
    setError(null);
    setStatus("idle");
    setProgress(0);
    setFastMode(false);
  }, []);

  const handleConvert = useCallback(async () => {
    if (!file) return;
    // 极速模式不需要加载 ffmpeg 引擎，直接进入转换
    setStatus(fastMode ? "converting" : "loading");
    setError(null);
    setProgress(0);
    setPhase("analyzing");
    try {
      const onProgress = (ratio: number, p: VideoConvertPhase) => {
        setProgress(ratio);
        setPhase(p);
      };
      let r: VideoGifResult;
      if (fastMode) {
        r = await fastGifVideo(file, options, onProgress, meta?.duration ?? 0);
      } else {
        // 兼容模式固定单线程（多线程 core 在这条滤镜链上会严重变慢）
        await ensureLoaded({ multiThread: false });
        setStatus("converting");
        r = await videoToGif(file, options, onProgress);
      }
      setResult(r);
      setResultEngine(fastMode ? "fast" : "compat");
      setResultUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(r.blob);
      });
      setStatus("done");
    } catch (e) {
      if (e instanceof AppError && e.code === "CANCELLED") {
        setStatus("idle");
        return;
      }
      setError(e instanceof AppError ? e.message : "转换失败，请重试或更换文件");
      setStatus("error");
    }
  }, [file, options, fastMode, meta]);

  const handleDownload = useCallback(() => {
    if (result) downloadBlob(result.blob, result.filename);
  }, [result]);

  const getCurrentTime = useCallback(() => videoRef.current?.currentTime ?? 0, []);

  /** 进度区主文案：极速模式与 ffmpeg 路径的阶段含义不同 */
  const phaseText = (() => {
    if (status === "loading") return "首次使用需加载转换引擎（约 30MB），请稍候…";
    if (fastMode) {
      if (phase === "analyzing") return "正在解析视频…";
      if (phase === "writing") return "正在写入 GIF 文件…";
      return `编码中 ${Math.round(progress * 100)}%`;
    }
    if (phase === "analyzing") {
      const pct = Math.round(progress * 100);
      if (pct > 0) return `第一阶段：分析视频帧，生成全局调色板… ${pct}%`;
      return `第一阶段：分析视频帧，生成全局调色板… 已用 ${elapsedSec} 秒`;
    }
    if (phase === "writing") return "正在写入 GIF 文件…";
    return `第二阶段：量化编码 ${Math.round(progress * 100)}%`;
  })();

  return (
    <ToolLayout
      title="视频转 GIF"
      description="将视频片段转为 GIF 动图，支持起止时间、帧率、尺寸、颜色数与循环设置，所有处理在浏览器本地完成"
    >
      <div className="space-y-6">
        {!file && (
          <FileDropZone
            accept={{
              "video/mp4": [".mp4"],
              "video/webm": [".webm"],
              "video/quicktime": [".mov"],
              "video/x-matroska": [".mkv"],
              "video/x-msvideo": [".avi"],
            }}
            maxFiles={1}
            maxSize={MAX_FILE_SIZE}
            onFilesAdded={async (files) => {
              if (files[0]) await handleFile(files[0].file);
            }}
            label="拖拽视频到此处，或点击选择（MP4 / WebM / MOV / MKV，≤200MB）"
          />
        )}

        {file && (
          <>
            {/* 预览与文件信息 */}
            <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">原视频</h3>
                <button
                  onClick={handleReselect}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200 transition-colors"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  重新选择
                </button>
              </div>
              <video
                ref={videoRef}
                src={previewUrl ?? undefined}
                controls
                className="w-full rounded-lg bg-black max-h-80"
              />
              <div className="text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
                <span className="truncate max-w-full">{file.name}</span>
                <span>{formatFileSize(file.size)}</span>
                {meta && (
                  <>
                    <span>
                      {meta.width}×{meta.height}
                    </span>
                    <span>
                      {meta.duration > 0
                        ? `${meta.duration.toFixed(1)} 秒`
                        : "时长未知"}
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* 参数面板 */}
            <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm space-y-4">
              <h3 className="font-semibold text-gray-900">GIF 选项</h3>

              <VideoTrimEditor
                duration={meta?.duration ?? 0}
                start={options.trimStart}
                end={options.trimEnd}
                onChange={(start, end) =>
                  setOptions((prev) => ({
                    ...prev,
                    trimStart: start,
                    trimEnd: end,
                  }))
                }
                getCurrentTime={getCurrentTime}
              />

              <div className="rounded-xl bg-gray-50 p-4 space-y-1.5">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fastMode}
                    disabled={!fastAvailable}
                    onChange={(e) => setFastMode(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 disabled:opacity-40"
                  />
                  <span className="text-sm font-medium text-gray-700">
                    极速模式（WebCodecs 解码）
                  </span>
                </label>
                <p className="pl-7 text-xs text-gray-500">
                  {!fastSupported
                    ? "当前浏览器不支持 WebCodecs，无法使用极速模式"
                    : !fastAvailable
                      ? "仅支持 MP4 / MOV 文件，其他格式请使用兼容模式"
                      : "浏览器原生解码 + 直接编码，通常快数倍；仅支持 H.264 编码的 MP4/MOV，转换期间页面可能短暂卡顿"}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    帧率 (fps)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    step={1}
                    value={options.fps}
                    onChange={(e) =>
                      setOptions((prev) => ({
                        ...prev,
                        fps: Math.min(30, Math.max(1, Number(e.target.value))),
                      }))
                    }
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                  />
                  <p className="mt-1 text-xs text-gray-400">调低可显著减小文件</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    输出宽度 (px)
                  </label>
                  <input
                    type="number"
                    min={16}
                    max={1920}
                    step={10}
                    value={options.width}
                    onChange={(e) =>
                      setOptions((prev) => ({
                        ...prev,
                        width: Math.min(1920, Math.max(16, Number(e.target.value))),
                      }))
                    }
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                  />
                  <p className="mt-1 text-xs text-gray-400">
                    高度等比；只缩不放
                    {meta ? `（原始 ${meta.width}px）` : ""}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    最大颜色数
                  </label>
                  <select
                    value={options.maxColors}
                    onChange={(e) =>
                      setOptions((prev) => ({
                        ...prev,
                        maxColors: Number(e.target
                        .value) as VideoGifOptions["maxColors"],
                      }))
                    }
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                  >
                    {COLOR_OPTIONS.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-400">
                    全局调色板；颜色越少文件越小
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    循环方式
                  </label>
                  <select
                    value={options.loop}
                    onChange={(e) =>
                      setOptions((prev) => ({
                        ...prev,
                        loop: e.target.value as VideoGifOptions["loop"],
                      }))
                    }
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                  >
                    <option value="infinite">无限循环</option>
                    <option value="once">播放一次</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    倍速播放
                  </label>
                  <select
                    value={options.speed}
                    onChange={(e) =>
                      setOptions((prev) => ({
                        ...prev,
                        speed: Number(e.target.value),
                      }))
                    }
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                  >
                    {SPEED_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}x{s === 1 ? "（原速）" : ""}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-400">
                    加速可缩短 GIF 时长、减小文件
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <DownloadButton
                  onClick={handleConvert}
                  loading={status === "loading" || status === "converting"}
                  label="开始转换"
                />
                {status === "converting" && (
                  <button
                    onClick={() => (fastMode ? cancelFastGif() : cancelConversion())}
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

        {/* 进度：分阶段展示。analyzing 期 palettegen 在统计全片、无输出帧，
            百分比会恒为 0，用不确定进度条 + 说明代替，避免看起来像卡死 */}
        {(status === "loading" || status === "converting") && (
          <div className="rounded-2xl border border-blue-100 bg-blue-50 p-6 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-blue-800">
              <Loader2 className="h-4 w-4 animate-spin" />
              {phaseText}
            </div>
            {status === "converting" && phase === "analyzing" && progress === 0 && (
              <div className="h-2 w-full overflow-hidden rounded-full bg-blue-100">
                <div className="h-full w-full animate-pulse rounded-full bg-brand-600/40" />
              </div>
            )}
            {progress > 0 && (
              <div className="h-2 w-full overflow-hidden rounded-full bg-blue-100">
                <div
                  className="h-full rounded-full bg-brand-600 transition-all"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            )}
            <p className="text-xs text-blue-600">
              {!fastMode && status === "converting" && phase === "analyzing"
                ? "全局调色板需要先统计完整段视频，长视频耗时较长，请耐心等待"
                : "转换在浏览器本地进行，请勿刷新或关闭页面"}
            </p>
          </div>
        )}

        {/* 错误 */}
        {error && (
          <ErrorAlert
            code="PROCESS_FAILED"
            message={error}
            onClose={() => setError(null)}
            onRetry={() => void handleConvert()}
          />
        )}

        {/* 结果 */}
        {result && status === "done" && (
          <div className="rounded-2xl border border-green-100 bg-green-50 p-6 space-y-4">
            <h3 className="font-semibold text-green-800">转换完成</h3>
            {resultUrl && (
              <img
                src={resultUrl}
                alt="GIF 预览"
                className="max-w-full rounded-lg border border-gray-200 bg-white"
              />
            )}
            <div className="text-sm text-green-700 space-y-1">
              <p>
                尺寸:{" "}
                <strong>
                  {result.width}×{result.height}
                </strong>
                {result.frameCount > 0 && <> · 约 {result.frameCount} 帧</>}
              </p>
              <p>
                原视频大小: <strong>{formatFileSize(result.originalSize)}</strong>
              </p>
              <p>
                GIF 大小: <strong>{formatFileSize(result.outputSize)}</strong>
              </p>
              {result.elapsedMs !== undefined && (
                <p className="text-xs text-green-600">
                  耗时 {(result.elapsedMs / 1000).toFixed(1)} 秒（
                  {resultEngine === "fast"
                    ? "极速模式"
                    : `兼容模式 · ${
                        getFfmpegCoreMode() === "multi" ? "多线程" : "单线程"
                      }`}
                  ）
                </p>
              )}
            </div>
            <button
              onClick={handleDownload}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-sm font-medium text-white hover:bg-brand-700 transition-colors shadow-lg shadow-brand-200"
            >
              <Download className="h-4 w-4" />
              下载 {result.filename}
            </button>
          </div>
        )}
      </div>
    </ToolLayout>
  );
}
