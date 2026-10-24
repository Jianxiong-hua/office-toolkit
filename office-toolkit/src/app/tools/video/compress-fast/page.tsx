"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Loader2, RotateCcw, X, Zap } from "lucide-react";
import Link from "next/link";
import { ToolLayout } from "@/components/layout/ToolLayout";
import { FileDropZone } from "@/components/tools/FileDropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ErrorAlert } from "@/components/common/ErrorAlert";
import { VideoTrimEditor } from "@/components/tools/VideoTrimEditor";
import { fastCompressVideo, cancelFastCompress } from "@/lib/video/fastCompress";
import { readVideoMeta } from "@/lib/video/probe";
import { downloadBlob, formatFileSize } from "@/lib/file";
import { AppError } from "@/types";
import type {
  FastQualityPreset,
  VideoConvertPhase,
  VideoFastCompressOptions,
  VideoFastCompressResult,
  VideoMeta,
  VideoResolution,
} from "@/types/video";

/** 上限 4GB：WebCodecs 流式解码不占整文件内存，瓶颈在输出体积与机器内存 */
const MAX_FILE_SIZE = 4 * 1024 * 1024 * 1024;

const QUALITY_LABELS: Record<FastQualityPreset, string> = {
  high: "高质量",
  standard: "标准（推荐）",
  strong: "强压缩（体积最小）",
};

const RESOLUTION_OPTIONS: { value: VideoResolution; label: string }[] = [
  { value: "original", label: "保持原始" },
  { value: "1080p", label: "1080p" },
  { value: "720p", label: "720p" },
  { value: "480p", label: "480p" },
];

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

/** 耗时格式化：1 分钟内显示秒，以上显示分+秒 */
function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  if (totalSec < 60) return `${totalSec} 秒`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec > 0 ? `${min} 分 ${sec} 秒` : `${min} 分钟`;
}

type Status = "idle" | "converting" | "done" | "error";

export default function VideoFastCompressPage() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [meta, setMeta] = useState<VideoMeta | null>(null);

  const [options, setOptions] = useState<VideoFastCompressOptions>({
    quality: "standard",
    resolution: "original",
    trimStart: 0,
    trimEnd: null,
    speed: 1,
  });

  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<VideoConvertPhase>("analyzing");
  const [result, setResult] = useState<VideoFastCompressResult | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);

  const webCodecsOk =
    typeof window !== "undefined" &&
    typeof VideoEncoder !== "undefined" &&
    typeof VideoDecoder !== "undefined";

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

  const handleFile = useCallback(async (f: File) => {
    setError(null);
    setErrorDetail(null);
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
    setStatus("converting");
    setError(null);
    setErrorDetail(null);
    setProgress(0);
    setPhase("analyzing");
    try {
      const r = await fastCompressVideo(
        file,
        options,
        (ratio, p) => {
          setProgress(ratio);
          setPhase(p);
        },
        meta?.duration ?? undefined
      );
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
      setErrorDetail(
        e instanceof AppError
          ? (e.details ?? null)
          : e instanceof Error
            ? e.message
            : null
      );
      setStatus("error");
    }
    // meta 必须入依赖：漏了会一直用首次渲染的 meta=null，
    // 导致 sourceDurationSec 缺失（源码率封顶与帧数制进度双双失效）
  }, [file, options, meta]);

  const handleDownload = useCallback(() => {
    if (result) downloadBlob(result.blob, result.filename);
  }, [result]);

  const getCurrentTime = useCallback(
    () => videoRef.current?.currentTime ?? 0,
    []
  );

  // 对比基准：截取/倍速时按「输出对应的原片片段」折算，否则拿整个原片
  // （可能几十分钟）和几十秒的输出比，节省比例会虚高到 99%
  const baselineSize = (() => {
    if (!result) return 0;
    const total = meta?.duration ?? 0;
    if (total <= 0) return result.originalSize;
    const cut = Math.max(
      0,
      (options.trimEnd ?? total) - Math.max(0, options.trimStart)
    );
    const outDuration = options.speed > 0 ? cut / options.speed : cut;
    const ratio = outDuration / total;
    return ratio > 0 && ratio < 1
      ? result.originalSize * ratio
      : result.originalSize;
  })();
  const isTrimmed = !!result && baselineSize < result.originalSize * 0.999;
  // 不向下钳制：输出变大时保留负值，由展示层显示「增大 X%」
  const savedRatio =
    result && baselineSize > 0
      ? (1 - result.outputSize / baselineSize) * 100
      : 0;

  return (
    <ToolLayout
      title="视频极速压缩"
      description="基于 WebCodecs 硬件加速的极速压缩，支持最大 4GB 的 MP4(H.264) 视频，所有处理在浏览器本地完成"
    >
      <div className="space-y-6">
        {/* 浏览器能力提示 */}
        {!webCodecsOk && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
            当前浏览器不支持 WebCodecs 硬件加速，请使用
            <Link href="/tools/video/compress/" className="mx-1 font-medium underline">
              视频压缩
            </Link>
            工具（需 Chrome/Edge 94+、Safari 16.4+ 或 Firefox 130+）。
          </div>
        )}

        {!file && (
          <>
            <FileDropZone
              accept={{
                "video/mp4": [".mp4"],
                "video/quicktime": [".mov"],
              }}
              maxFiles={1}
              maxSize={MAX_FILE_SIZE}
              onFilesAdded={async (files) => {
                if (files[0]) await handleFile(files[0].file);
              }}
              label="拖拽 MP4 视频到此处，或点击选择（≤4GB）"
            />
            <p className="text-xs text-gray-400">
              仅支持 MP4/MOV 容器 + H.264 编码（覆盖绝大多数手机/相机/录屏视频）。
              其他格式或需要 WebM 输出，请使用
              <Link href="/tools/video/compress/" className="mx-1 text-brand-600 hover:underline">
                视频压缩
              </Link>
              。
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
                  disabled={status === "converting"}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
                <span className="inline-flex items-center gap-1 text-blue-600">
                  <Zap className="h-3.5 w-3.5" />
                  硬件加速
                </span>
              </div>
              {file.size > 500 * 1024 * 1024 && (
                <p className="text-xs text-amber-600">
                  文件较大（&gt;500MB），转换耗时与内存占用都会明显增加，建议使用桌面端
                  Chrome/Edge，并保持页面前台可见。
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
                        quality: e.target.value as FastQualityPreset,
                      }))
                    }
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                  >
                    {(Object.keys(QUALITY_LABELS) as FastQualityPreset[]).map(
                      (q) => (
                        <option key={q} value={q}>
                          {QUALITY_LABELS[q]}
                        </option>
                      )
                    )}
                  </select>
                  <p className="mt-1 text-xs text-gray-400">
                    按码率自动压缩，无需手动调参数
                  </p>
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
                  {options.speed !== 1 && (
                    <p className="mt-1 text-xs text-amber-600">
                      倍速时输出不含音轨（硬件编码无法对原音频变速）
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <DownloadButton
                  onClick={handleConvert}
                  loading={status === "converting"}
                  label="开始转换"
                />
                {status === "converting" && (
                  <button
                    onClick={() => cancelFastCompress()}
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

        {/* 进度：analyzing=读取并解码（按已读字节），encoding=编码收尾，writing=写入 */}
        {status === "converting" && (
          <div className="rounded-2xl border border-blue-100 bg-blue-50 p-6 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-blue-800">
              <Loader2 className="h-4 w-4 animate-spin" />
              {phase === "analyzing"
                ? `第一阶段：硬件解码编码 ${Math.round(progress * 100)}%`
                : phase === "encoding"
                  ? "第二阶段：收尾处理…"
                  : "第三阶段：写入文件…"}
            </div>
            {phase === "analyzing" && (
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
            details={errorDetail ?? undefined}
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
              <p>
                输出:{" "}
                <strong>
                  {result.width}×{result.height} · {result.fps} fps ·{" "}
                  {(result.bitrate / 1_000_000).toFixed(2)} Mbps
                  {result.hasAudio ? " · 含音轨" : " · 无音轨"}
                </strong>
              </p>
              <p>
                原始大小: <strong>{formatFileSize(result.originalSize)}</strong>
                {isTrimmed && (
                  <span className="text-green-600">
                    （对应片段约 {formatFileSize(Math.round(baselineSize))}）
                  </span>
                )}
              </p>
              <p>
                输出大小: <strong>{formatFileSize(result.outputSize)}</strong>
                {savedRatio >= 0 ? (
                  <>（节省 {savedRatio.toFixed(1)}%）</>
                ) : (
                  <span className="text-amber-600">
                    （增大 {Math.abs(savedRatio).toFixed(1)}%，源文件已高度压缩时可尝试「强压缩」档）
                  </span>
                )}
              </p>
              <p>
                处理耗时: <strong>{formatDuration(result.elapsedMs)}</strong>
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
