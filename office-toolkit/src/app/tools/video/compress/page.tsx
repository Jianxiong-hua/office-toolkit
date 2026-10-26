"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Download, Loader2, RotateCcw, X } from "lucide-react";
import { ToolLayout } from "@/components/layout/ToolLayout";
import { FileDropZone } from "@/components/tools/FileDropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ErrorAlert } from "@/components/common/ErrorAlert";
import { VideoTrimEditor } from "@/components/tools/VideoTrimEditor";
import { compressVideo, buildCompressCommand } from "@/lib/video/compress";
import { readVideoMeta } from "@/lib/video/probe";
import {
  cancelConversion,
  ensureLoaded,
  getFfmpegCoreMode,
} from "@/lib/video/ffmpeg";
import { downloadBlob, formatFileSize } from "@/lib/file";
import { AppError } from "@/types";
import type {
  VideoCompressOptions,
  VideoCompressResult,
  VideoEncodePreset,
  VideoMeta,
  VideoOutputFormat,
  VideoQualityPreset,
  VideoResolution,
} from "@/types/video";

/** 超过 200MB 的输入走 WORKERFS 挂载（不进 wasm 内存），上限受输出体积约束 */
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;

/** 「视频极速压缩」能接受的输入容器（按扩展名粗筛，编码是否为 H.264 由该工具自行判断） */
const FAST_INPUT_EXTS = ["mp4", "m4v", "mov"];

function isFastCandidate(f: File): boolean {
  if (typeof VideoEncoder === "undefined") return false;
  const ext = f.name.slice(f.name.lastIndexOf(".") + 1).toLowerCase();
  return FAST_INPUT_EXTS.includes(ext);
}

const QUALITY_LABELS: Record<VideoQualityPreset, string> = {
  high: "高质量（CRF 20，接近原画）",
  standard: "标准（CRF 23，推荐）",
  strong: "强压缩（CRF 28，体积最小）",
};

const RESOLUTION_OPTIONS: { value: VideoResolution; label: string }[] = [
  { value: "original", label: "保持原始" },
  { value: "1080p", label: "1080p" },
  { value: "720p", label: "720p" },
  { value: "480p", label: "480p" },
];

const PRESET_LABELS: Record<VideoEncodePreset, string> = {
  ultrafast: "极快（推荐）",
  veryfast: "很快",
  fast: "快",
  medium: "标准",
  slow: "慢（体积更小）",
  veryslow: "极慢（体积最小，耗时很长）",
};

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

type Status = "idle" | "loading" | "converting" | "done" | "error";

export default function VideoCompressPage() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [meta, setMeta] = useState<VideoMeta | null>(null);

  const [options, setOptions] = useState<VideoCompressOptions>({
    quality: "standard",
    resolution: "original",
    format: "mp4",
    speed: 1,
    // wasm 版 x264 没有任何汇编优化，fast 在 1080p 上慢到不可用（实测 50 秒片段约 75 分钟），
    // 默认给 ultrafast；体积由 maxrate 封顶，不会因 preset 变大
    preset: "ultrafast",
    trimStart: 0,
    trimEnd: null,
  });

  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<VideoCompressResult | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 当前文件是否可能适用「视频极速压缩」 */
  const [canFast, setCanFast] = useState(false);
  /** 转换已用时（秒）：ffmpeg 在出第一帧前不给进度，用它证明任务在走 */
  const [elapsedSec, setElapsedSec] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);

  // 切换文件 / 卸载时释放 object URL
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

  const handleFile = useCallback(async (f: File) => {
    setError(null);
    setResult(null);
    setStatus("idle");
    setProgress(0);
    setMeta(null);
    setOptions((prev) => ({ ...prev, trimStart: 0, trimEnd: null }));
    setFile(f);
    setCanFast(isFastCandidate(f));
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
    setCanFast(false);
  }, []);

  const handleConvert = useCallback(async () => {
    if (!file) return;
    setStatus("loading");
    setError(null);
    setProgress(0);
    try {
      // 首次使用先加载 ffmpeg 引擎（约 30MB，走 CDN）。
      // 必须与 runConversion 里的选择一致（单线程），否则会先加载多线程再重载一遍
      await ensureLoaded({ multiThread: false });
      setStatus("converting");
      const r = await compressVideo(file, options, setProgress);
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

  /** 截取过片段时，拿「完整文件」和「片段输出」比较没有意义，按片段时长折算基准 */
  const trimmed =
    result?.segmentRatio !== undefined && result.segmentRatio < 0.999;
  const baselineSize =
    result && trimmed
      ? result.originalSize * result.segmentRatio!
      : (result?.originalSize ?? 0);
  const savedRatio =
    result && baselineSize > 0
      ? Math.max(0, 1 - result.outputSize / baselineSize) * 100
      : 0;

  return (
    <ToolLayout
      title="视频压缩"
      description="在线压缩 MP4/WebM 等视频，支持截取片段，自定义质量档位、分辨率与输出格式，所有处理在浏览器本地完成"
    >
      <div className="space-y-6">
        {!file && (
          <>
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
              maxSizeLabel="单文件最大 2GB"
              onFilesAdded={async (files) => {
                if (files[0]) await handleFile(files[0].file);
              }}
              label="拖拽视频到此处，或点击选择（MP4 / WebM / MOV / MKV / AVI，≤2GB）"
            />
            <p className="text-xs text-gray-400">
              视频是 MP4(H.264) 且想更快？可试试
              <Link
                href="/tools/video/compress-fast/"
                className="mx-1 text-brand-600 hover:underline"
              >
                视频极速压缩
              </Link>
              （硬件加速，支持 4GB，但仅支持 MP4/H.264 输入与 MP4 输出）
            </p>
          </>
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
              {canFast && (
                <p className="text-xs text-brand-600">
                  若为 H.264 编码，改用
                  <Link
                    href="/tools/video/compress-fast/"
                    className="mx-1 font-medium underline"
                  >
                    视频极速压缩
                  </Link>
                  通常快数十倍（硬件加速，仅支持 MP4 输入与 MP4 输出）。
                </p>
              )}
              {file.size > 100 * 1024 * 1024 && (
                <p className="text-xs text-amber-600">
                  文件较大（&gt;100MB），转换可能需要数分钟，请耐心等待。
                </p>
              )}
            </div>

            {/* 参数面板 */}
            <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm space-y-4">
              <h3 className="font-semibold text-gray-900">压缩选项</h3>

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
                    质量档位
                  </label>
                  <select
                    value={options.quality}
                    onChange={(e) =>
                      setOptions((prev) => ({
                        ...prev,
                        quality: e.target.value as VideoQualityPreset,
                      }))
                    }
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                  >
                    {(Object.keys(QUALITY_LABELS) as VideoQualityPreset[]).map(
                      (q) => (
                        <option key={q} value={q}>
                          {QUALITY_LABELS[q]}
                        </option>
                      )
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    分辨率缩放
                  </label>
                  <select
                    value={options.resolution}
                    onChange={(e) =>
                      setOptions((prev) => ({
                        ...prev,
                        resolution: e.target.value as VideoResolution,
                      }))
                    }
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                  >
                    {RESOLUTION_OPTIONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-400">
                    高于所选档位时才缩小，不放大
                    {meta ? `（原始 ${meta.height}p）` : ""}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    输出格式
                  </label>
                  <select
                    value={options.format}
                    onChange={(e) =>
                      setOptions((prev) => ({
                        ...prev,
                        format: e.target.value as VideoOutputFormat,
                      }))
                    }
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                  >
                    <option value="mp4">MP4（H.264，兼容性最好）</option>
                    <option value="webm">WebM（VP9，同画质体积更小）</option>
                  </select>
                  {options.format === "webm" && (
                    <p className="mt-1 text-xs text-amber-600">
                      WebM 在 Safari 等浏览器可能无法播放
                    </p>
                  )}
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
                    加速可缩短时长、进一步减小体积
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    编码速度
                  </label>
                  <select
                    value={options.preset}
                    onChange={(e) =>
                      setOptions((prev) => ({
                        ...prev,
                        preset: e.target.value as VideoEncodePreset,
                      }))
                    }
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                  >
                    {(Object.keys(PRESET_LABELS) as VideoEncodePreset[]).map(
                      (p) => (
                        <option key={p} value={p}>
                          {PRESET_LABELS[p]}
                        </option>
                      )
                    )}
                  </select>
                </div>
              </div>

              {/* 实际执行的命令：与实际转换共用 buildCompressCommand，保证展示即所跑 */}
              {meta && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">
                    实际执行的命令（随参数实时生成）
                  </p>
                  <p className="rounded-md bg-gray-50 px-3 py-2 font-mono text-[11px] leading-relaxed text-gray-500 break-all">
                    ffmpeg -nostdin -y{" "}
                    {buildCompressCommand(file, meta, options).args.join(" ")}
                  </p>
                </div>
              )}

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

        {/* 进度 */}
        {(status === "loading" || status === "converting") && (
          <div className="rounded-2xl border border-blue-100 bg-blue-50 p-6 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-blue-800">
              <Loader2 className="h-4 w-4 animate-spin" />
              {status === "loading"
                ? "首次使用需加载转换引擎（约 30MB），请稍候…"
                : progress >= 0.99
                  ? `正在收尾（写入文件），已用 ${elapsedSec} 秒…`
                  : progress > 0
                    ? `转换中 ${Math.round(progress * 100)}% · 已用 ${elapsedSec} 秒`
                    : `正在解码并编码，已用 ${elapsedSec} 秒…`}
            </div>
            {status === "converting" && (
              <div className="h-2 w-full overflow-hidden rounded-full bg-blue-100">
                <div
                  className="h-full rounded-full bg-brand-600 transition-all"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            )}
            <p className="text-xs text-blue-600">
              转换在浏览器本地进行，请勿刷新或关闭页面
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
              <video
                src={resultUrl}
                controls
                className="w-full rounded-lg bg-black max-h-80"
              />
            )}
            <div className="text-sm text-green-700 space-y-1">
              {trimmed ? (
                <>
                  <p>
                    原始文件: {formatFileSize(result.originalSize)}（完整）
                  </p>
                  <p>
                    本次片段原始约: <strong>{formatFileSize(baselineSize)}</strong>
                  </p>
                </>
              ) : (
                <p>
                  原始大小: <strong>{formatFileSize(result.originalSize)}</strong>
                </p>
              )}
              <p>
                输出大小: <strong>{formatFileSize(result.outputSize)}</strong>
              </p>
              <p>
                节省空间: <strong>{savedRatio.toFixed(1)}%</strong>
                {trimmed && <span className="text-xs">（按同长度对比）</span>}
              </p>
              {result.elapsedMs !== undefined && (
                <p className="text-xs text-green-600">
                  耗时 {(result.elapsedMs / 1000).toFixed(1)} 秒（
                  {getFfmpegCoreMode() === "multi" ? "多线程" : "单线程"}）
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
