"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Loader2, RotateCcw, X } from "lucide-react";
import { ToolLayout } from "@/components/layout/ToolLayout";
import { FileDropZone } from "@/components/tools/FileDropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ErrorAlert } from "@/components/common/ErrorAlert";
import { VideoTrimEditor } from "@/components/tools/VideoTrimEditor";
import { videoToGif } from "@/lib/video/gif";
import { readVideoMeta } from "@/lib/video/probe";
import { cancelConversion, ensureLoaded } from "@/lib/video/ffmpeg";
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

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

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

  const videoRef = useRef<HTMLVideoElement>(null);

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
  }, []);

  const handleConvert = useCallback(async () => {
    if (!file) return;
    setStatus("loading");
    setError(null);
    setProgress(0);
    setPhase("analyzing");
    try {
      await ensureLoaded();
      setStatus("converting");
      const r = await videoToGif(file, options, (ratio, p) => {
        setProgress(ratio);
        setPhase(p);
      });
      setResult(r);
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
  }, [file, options]);

  const handleDownload = useCallback(() => {
    if (result) downloadBlob(result.blob, result.filename);
  }, [result]);

  const getCurrentTime = useCallback(() => videoRef.current?.currentTime ?? 0, []);

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
                    onClick={() => cancelConversion()}
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
              {status === "loading"
                ? "首次使用需加载转换引擎（约 30MB），请稍候…"
                : phase === "analyzing"
                  ? "第一阶段：分析视频帧，生成全局调色板…"
                  : phase === "writing"
                    ? "正在写入 GIF 文件…"
                    : `第二阶段：量化编码 ${Math.round(progress * 100)}%`}
            </div>
            {status === "converting" && phase === "analyzing" && (
              <div className="h-2 w-full overflow-hidden rounded-full bg-blue-100">
                <div className="h-full w-full animate-pulse rounded-full bg-brand-600/40" />
              </div>
            )}
            {(phase === "encoding" || phase === "writing") && (
              <div className="h-2 w-full overflow-hidden rounded-full bg-blue-100">
                <div
                  className="h-full rounded-full bg-brand-600 transition-all"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            )}
            <p className="text-xs text-blue-600">
              {status === "converting" && phase === "analyzing"
                ? "全局调色板需要先统计完整段视频，此阶段无百分比进度，请耐心等待"
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
