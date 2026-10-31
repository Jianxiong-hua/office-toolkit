"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Download,
  FolderOpen,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react";
import type JSZip from "jszip";
import { ToolLayout } from "@/components/layout/ToolLayout";
import { FileDropZone } from "@/components/tools/FileDropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ErrorAlert } from "@/components/common/ErrorAlert";
import { VideoTrimEditor } from "@/components/tools/VideoTrimEditor";
import {
  cancelExtractFrames,
  countFramesInRange,
  extractFramesFast,
  isFastExtractCandidate,
  readFastVideoInfo,
  type FastVideoInfo,
} from "@/lib/video/extractFrames";
import {
  COMPAT_MAX_CLIP_SEC,
  COMPAT_MAX_FILE_SIZE,
  COMPAT_MAX_FRAMES,
  FRAME_PREFIX,
  extractFramesCompat,
} from "@/lib/video/extractFramesCompat";
import { cancelImageSequence } from "@/lib/video/ffmpegSequence";
import { readVideoMeta } from "@/lib/video/probe";
import { getFfmpegCoreMode } from "@/lib/video/ffmpeg";
import { downloadBlob, formatFileSize } from "@/lib/file";
import {
  ensureUniqueSubdirectory,
  pickDirectory,
  supportsDirectoryPicker,
  writeBlobInto,
} from "@/lib/fs/save";
import { AppError } from "@/types";
import type {
  ExtractEngine,
  ExtractFramesOptions,
  FrameSink,
  VideoMeta,
} from "@/types/video";

/** 快路径上限：mp4box 只跳读索引、样本按需随机读（与「视频极速压缩」同口径） */
const FAST_MAX_FILE_SIZE = 4 * 1024 * 1024 * 1024;
/** ZIP 兜底模式的张数上限：JSZip 全内存打包 */
const ZIP_MAX_FRAMES = 300;
/** 软预警阈值：超过这个张数给出张数/体积/耗时提示，但不阻断 */
const WARN_FRAMES = 500;
/** 软预警：兼容模式下截取时长超过这个秒数就提示会非常慢 */
const COMPAT_WARN_CLIP_SEC = 120;

const inputClass =
  "w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none";

type Status = "idle" | "loading" | "running" | "done" | "error";

/** 时长展示（秒 → 「X 分 Y 秒」） */
function formatDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  if (total < 60) return `${total} 秒`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s === 0 ? `${m} 分` : `${m} 分 ${s} 秒`;
}

/** 单张体积粗估（字节）：PNG 约 w*h，JPEG(q0.92) 约 w*h*0.15 */
function estimateBytesPerFrame(
  meta: VideoMeta | null,
  format: ExtractFramesOptions["format"]
): number {
  if (!meta || meta.width <= 0) return 0;
  const px = meta.width * meta.height;
  return format === "png" ? px : px * 0.15;
}

export default function VideoToFramesPage() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  /** 快路径的帧统计（null = 该文件走兼容路径） */
  const [fastInfo, setFastInfo] = useState<FastVideoInfo | null>(null);
  /** 浏览器是否支持目录写入（放到 effect 里判断，避免静态导出的 hydration 不一致） */
  const [dirSupported, setDirSupported] = useState(false);
  /**
   * 用户在目录选择框里选中的文件夹名。
   * 注意：File System Access API 只暴露目录名，拿不到绝对路径（浏览器隐私限制），
   * 所以这里最多显示「父目录名 / 子目录名」。
   */
  const [parentDirName, setParentDirName] = useState<string | null>(null);
  /** 实际创建出来的子目录名（重名时带 -2 后缀，创建后才知道） */
  const [outputDirName, setOutputDirName] = useState<string | null>(null);

  const [options, setOptions] = useState<ExtractFramesOptions>({
    trimStart: 0,
    trimEnd: null,
    everyNFrames: 0,
    format: "jpeg",
    quality: 0.92,
  });

  const [status, setStatus] = useState<Status>("idle");
  const [saved, setSaved] = useState(0);
  /** 兼容路径的解码进度 0~1：exec 期间唯一的进度来源 */
  const [decodeRatio, setDecodeRatio] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [engine, setEngine] = useState<ExtractEngine>("fast");
  const [result, setResult] = useState<{
    count: number;
    totalBytes: number;
    elapsedMs: number;
    folderName: string;
    zip?: Blob;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 错误详情（ffmpeg 退出码 + stderr 尾部），排障时直接看得到 */
  const [errorDetails, setErrorDetails] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    setDirSupported(supportsDirectoryPicker());
  }, []);

  // 处理期间的秒表：兼容路径 exec 期间拿不到中间进度，至少让用户看到任务在走
  useEffect(() => {
    if (status !== "running" && status !== "loading") return;
    const t0 = performance.now();
    setElapsedSec(0);
    const id = setInterval(
      () => setElapsedSec(Math.floor((performance.now() - t0) / 1000)),
      500
    );
    return () => clearInterval(id);
  }, [status]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const step = Math.max(1, Math.floor(options.everyNFrames) + 1);
  const folderBase = useMemo(() => {
    if (!file) return "frames";
    const dot = file.name.lastIndexOf(".");
    const stem = dot > 0 ? file.name.slice(0, dot) : file.name;
    return `${stem}_frames`;
  }, [file]);

  const handleFile = useCallback(async (f: File) => {
    if (f.size > FAST_MAX_FILE_SIZE) {
      setError("文件超过 4GB，浏览器内无法处理，请先压缩或裁剪");
      return;
    }
    setError(null);
    setResult(null);
    setStatus("idle");
    setSaved(0);
    setFastInfo(null);
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
      return;
    }

    // 快路径候选：解析 moov 拿精确帧数（顺带校验 H.264）
    let info: FastVideoInfo | null = null;
    /** 快路径走不通的具体原因（用于大文件被拒时告诉用户真实理由） */
    let fastReason: string | null = null;
    if (!isFastExtractCandidate(f)) {
      fastReason = "当前浏览器不支持 WebCodecs，或文件不是 MP4/MOV 容器";
    } else {
      try {
        info = await readFastVideoInfo(f);
        setFastInfo(info);
      } catch (e) {
        fastReason = e instanceof AppError ? e.message : String(e);
        console.info("[frames] 快路径不可用：", fastReason);
      }
    }

    // 兼容模式（ffmpeg）只接 200MB 以内：再大必须走极速模式，否则直接拒绝
    if (!info && f.size > COMPAT_MAX_FILE_SIZE) {
      setError(
        `文件 ${formatFileSize(f.size)} 超过兼容模式上限（200MB），且无法走极速模式：${fastReason ?? "未知原因"}。请把视频转成 H.264 编码的 MP4 后重试。`
      );
      setFile(null);
      setMeta(null);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    }
  }, []);

  const handleReselect = useCallback(() => {
    setFile(null);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setFastInfo(null);
    setMeta(null);
    setResult(null);
    setError(null);
    setStatus("idle");
    setSaved(0);
    setParentDirName(null);
    setOutputDirName(null);
  }, []);

  /** 预估张数：快路径精确（样本表），兼容路径按 30fps 粗算 */
  const estimatedCount = useMemo(() => {
    if (!file) return null;
    if (fastInfo) {
      const frames = countFramesInRange(
        fastInfo,
        options.trimStart,
        options.trimEnd
      );
      return Math.ceil(frames / step);
    }
    if (!meta || meta.duration <= 0) return null;
    const end = options.trimEnd ?? meta.duration;
    const seconds = Math.max(0, end - options.trimStart);
    return Math.ceil((seconds * 30) / step);
  }, [file, fastInfo, meta, options.trimStart, options.trimEnd, step]);

  const estimateExact = !!fastInfo;
  const estimatedBytes =
    (estimatedCount ?? 0) * estimateBytesPerFrame(meta, options.format);
  /**
   * 剩余时间只能按「实测速率」外推：编码（尤其 PNG）与逐张写盘的开销
   * 跟磁盘/CPU 强相关，事先给定秒数必然误导。取够样本才显示。
   */
  const etaSec =
    saved >= 20 && elapsedSec >= 3 && estimatedCount && estimatedCount > saved
      ? Math.max(
          0,
          Math.round((elapsedSec / saved) * (estimatedCount - saved))
        )
      : null;

  /** 进度条比例：兼容路径先用解码进度，进入写盘阶段后取两者较大值 */
  const runRatio = Math.max(
    decodeRatio,
    estimatedCount ? saved / Math.max(1, estimatedCount) : 0
  );

  /** 本轮截取的时长（秒）：兼容模式的真实成本由它决定，而不是导出张数 */
  const clipSec = useMemo(() => {
    if (!meta || meta.duration <= 0) return null;
    const end = options.trimEnd ?? meta.duration;
    return Math.max(0, end - options.trimStart);
  }, [meta, options.trimStart, options.trimEnd]);

  /**
   * 解码阶段实测速率（视频秒 / 实际秒）与剩余时间。
   * 解码进度只能来自 ffmpeg 的 progress 事件（按输出帧更新，稀疏抽帧时会一跳一跳），
   * 所以用「已解码时长 / 已用时间」折算倍率再外推，界面才不会看起来卡死。
   */
  const decodeRealtime =
    !fastInfo && decodeRatio > 0.02 && elapsedSec >= 5 && clipSec
      ? (decodeRatio * clipSec) / elapsedSec
      : null;
  const decodeEtaSec =
    decodeRealtime && decodeRatio > 0
      ? Math.max(0, Math.round((elapsedSec * (1 - decodeRatio)) / decodeRatio))
      : null;

  const zipBlocked = !dirSupported && (estimatedCount ?? 0) > ZIP_MAX_FRAMES;
  const compatBlocked = !fastInfo && (estimatedCount ?? 0) > COMPAT_MAX_FRAMES;
  // 兼容模式必须逐帧解码整段，1 小时级别的片段在浏览器里跑不完，直接挡住
  const compatTooLong = !fastInfo && clipSec !== null && clipSec > COMPAT_MAX_CLIP_SEC;
  const blocked = zipBlocked || compatBlocked || compatTooLong;

  const handleStart = useCallback(async () => {
    if (!file || blocked) return;

    // 目录模式：必须先弹选择框（用户手势），且在任何长耗时动作之前
    let parent: FileSystemDirectoryHandle | null = null;
    if (dirSupported) {
      try {
        parent = await pickDirectory();
        setParentDirName(parent.name);
      } catch (e) {
        if (e instanceof AppError && e.code === "CANCELLED") return;
        setError(e instanceof AppError ? e.message : "无法打开文件夹选择框");
        return;
      }
    }

    const startedAt = performance.now();
    setStatus("loading");
    setError(null);
    setErrorDetails(null);
    setSaved(0);
    setDecodeRatio(0);
    setOutputDirName(null);
    setResult(null);

    let dirHandle: FileSystemDirectoryHandle | null = null;
    let actualFolderName = folderBase;
    let zip: JSZip | null = null;
    let sink: FrameSink;
    // 用本次启动时的参数定格扩展名：运行中改选项不影响已开始的任务
    const runExt = options.format === "png" ? "png" : "jpg";
    const runFrameName = (index: number) =>
      `${FRAME_PREFIX}${String(index).padStart(6, "0")}.${runExt}`;

    if (parent) {
      // 目录在第一次保存时才创建：失败回退时不会留下空文件夹
      const parentHandle = parent;
      sink = {
        save: async (index, blob) => {
          if (!dirHandle) {
            dirHandle = await ensureUniqueSubdirectory(
              parentHandle,
              folderBase
            );
            actualFolderName = dirHandle.name;
            setOutputDirName(actualFolderName);
          }
          await writeBlobInto(dirHandle, runFrameName(index), blob);
        },
      };
    } else {
      const JSZipCtor = (await import("jszip")).default;
      zip = new JSZipCtor();
      const target = zip;
      sink = {
        save: async (index, blob) => {
          target.file(`${folderBase}/${runFrameName(index)}`, blob);
        },
      };
    }

    try {
      let count = 0;
      let totalBytes = 0;
      /** 本次已导出的张数（本地变量：catch 里判断能否回退时不能用 React state） */
      let savedLocal = 0;
      let usedFast = !!fastInfo;

      if (usedFast) {
        setStatus("running");
        setEngine("fast");
        try {
          const r = await extractFramesFast(
            file,
            options,
            sink,
            (n) => {
              savedLocal = n;
              setSaved(n);
            },
            estimatedCount ?? 0
          );
          count = r.count;
          totalBytes = r.totalBytes;
          setEngine("fast");
        } catch (e) {
          if (e instanceof AppError && e.code === "CANCELLED") throw e;
          // 一张都没写出去才能回退（否则会重复写入）；回退后 sink 新建目录、
          // ZIP 也是空的，不存在残留。>200MB 的文件也不能回退：兼容路径不接
          if (savedLocal > 0 || file.size > COMPAT_MAX_FILE_SIZE) throw e;
          console.warn("[frames] 快路径失败，回退兼容模式：", e);
          usedFast = false;
        }
      }

      if (!usedFast) {
        // 先落引擎标记：取消按钮要按当前引擎决定打断哪条流水线
        setEngine("compat");
        // 兼容路径首帧前要加载 wasm 引擎（约 30MB）
        const r = await extractFramesCompat(
          file,
          options,
          sink,
          estimatedCount ?? 0,
          {
            clipDurationSec: clipSec ?? undefined,
            onDecodeProgress: (ratio) => {
              setStatus("running");
              setDecodeRatio(ratio);
            },
            onProgress: (n) => {
              setStatus("running");
              setSaved(n);
            },
          }
        );
        count = r.count;
        totalBytes = r.totalBytes;
      }

      let zipBlob: Blob | undefined;
      if (zip) {
        setStatus("loading");
        zipBlob = await zip.generateAsync({
          type: "blob",
          // 图片已是压缩格式，deflate 只费 CPU 不减体积
          compression: "STORE",
        });
        actualFolderName = folderBase;
      }

      setResult({
        count,
        totalBytes,
        elapsedMs: performance.now() - startedAt,
        folderName: actualFolderName,
        zip: zipBlob,
      });
      setStatus("done");
    } catch (e) {
      if (e instanceof AppError && e.code === "CANCELLED") {
        setStatus("idle");
        return;
      }
      setError(e instanceof AppError ? e.message : "提取失败，请重试或更换文件");
      setErrorDetails(
        e instanceof AppError
          ? (e.details ?? null)
          : e instanceof Error
            ? e.message
            : String(e)
      );
      setStatus("error");
    }
  }, [
    file,
    options,
    blocked,
    dirSupported,
    folderBase,
    fastInfo,
    estimatedCount,
    clipSec,
  ]);

  const handleCancel = useCallback(() => {
    // 兼容路径的取消内部会终止 worker；快路径只需打断解码
    if (engine === "compat") cancelImageSequence();
    else cancelExtractFrames();
  }, [engine]);

  const getCurrentTime = useCallback(
    () => videoRef.current?.currentTime ?? 0,
    []
  );

  return (
    <ToolLayout
      title="视频提取图片"
      description="按起止时间与帧间隔把视频拆成图片序列，可直接写入指定文件夹或打包 ZIP，本地处理不上传"
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
            maxSize={FAST_MAX_FILE_SIZE}
            maxSizeLabel="极速模式最大 4GB，兼容模式最大 200MB"
            onFilesAdded={(files) => {
              if (files[0]) void handleFile(files[0].file);
            }}
            label="拖拽视频到此处，或点击选择（MP4 / WebM / MOV / MKV / AVI）"
          />
        )}

        {file && (
          <>
            <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">原视频</h3>
                <button
                  onClick={handleReselect}
                  disabled={status === "running" || status === "loading"}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200 disabled:opacity-40 transition-colors"
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
                <span>
                  引擎：
                  {fastInfo
                    ? "WebCodecs 快速解码"
                    : "兼容模式（ffmpeg，较慢，最大 200MB）"}
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm space-y-4">
              <h3 className="font-semibold text-gray-900">提取选项</h3>

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

              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    每隔 N 帧取 1 张
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={options.everyNFrames}
                    onChange={(e) =>
                      setOptions((prev) => ({
                        ...prev,
                        everyNFrames: Math.max(
                          0,
                          Math.floor(Number(e.target.value) || 0)
                        ),
                      }))
                    }
                    className={inputClass}
                  />
                  <p className="mt-1 text-xs text-gray-400">
                    0 = 每帧都取；1 = 每 2 帧取 1 张
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    图片格式
                  </label>
                  <select
                    value={options.format}
                    onChange={(e) =>
                      setOptions((prev) => ({
                        ...prev,
                        format: e.target.value as ExtractFramesOptions["format"],
                      }))
                    }
                    className={inputClass}
                  >
                    <option value="jpeg">JPEG（体积小）</option>
                    <option value="png">PNG（无损）</option>
                  </select>
                  <p className="mt-1 text-xs text-gray-400">
                    {options.format === "png"
                      ? "无损，但编码与写盘明显更慢；分辨率与源视频一致"
                      : "分辨率与源视频一致，比 PNG 快数倍"}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    JPEG 质量
                  </label>
                  <input
                    type="number"
                    min={0.5}
                    max={1}
                    step={0.02}
                    disabled={options.format !== "jpeg"}
                    value={options.quality}
                    onChange={(e) =>
                      setOptions((prev) => ({
                        ...prev,
                        quality: Math.min(
                          1,
                          Math.max(0.5, Number(e.target.value) || 0.92)
                        ),
                      }))
                    }
                    className={`${inputClass} disabled:opacity-40`}
                  />
                  <p className="mt-1 text-xs text-gray-400">
                    {options.format === "jpeg" ? "0.5 ~ 1.0" : "PNG 无此参数"}
                  </p>
                </div>
              </div>

              <div className="rounded-xl bg-gray-50 p-4 space-y-1">
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <FolderOpen className="h-4 w-4 text-gray-500" />
                  {dirSupported
                    ? `将在你选择的文件夹下创建「${folderBase}」`
                    : `将下载「${folderBase}.zip」（解压即得同名文件夹）`}
                </div>
                <p className="pl-6 text-xs text-gray-500">
                  {dirSupported
                    ? "逐张写入磁盘，不受张数限制"
                    : `当前浏览器不支持直接写入文件夹（Chrome / Edge 支持），ZIP 模式最多 ${ZIP_MAX_FRAMES} 张`}
                </p>
              </div>

              {estimatedCount !== null && !blocked && (
                <p className="text-sm text-gray-600">
                  预计导出
                  <strong className="mx-1 text-gray-900">
                    {estimateExact ? "" : "约 "}
                    {estimatedCount} 张
                  </strong>
                  {estimatedBytes > 0 && <>· 约 {formatFileSize(estimatedBytes)}</>}
                  <span className="text-gray-400">
                    {estimateExact
                      ? "（耗时主要取决于片段时长：整段视频都要解码一遍，导出张数影响很小）"
                      : "（张数按 30fps 粗估；耗时取决于解码整段的时长）"}
                  </span>
                </p>
              )}

              {estimatedCount !== null && estimatedCount > WARN_FRAMES && !blocked && (
                <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>
                    张数较多（{estimateExact ? "" : "约 "}
                    {estimatedCount} 张），会占用约{" "}
                    {formatFileSize(estimatedBytes)} 磁盘空间。注意：增大「每隔 N 帧」
                    只减少张数，不会减少耗时——整段视频仍要解码一遍，耗时主要由片段
                    时长决定，需要更快请缩短截取范围。
                  </span>
                </div>
              )}

              {zipBlocked && (
                <p className="text-sm text-red-600">
                  约 {estimatedCount} 张超出 ZIP 模式上限（{ZIP_MAX_FRAMES} 张）。
                  请增大「每隔 N 帧」、缩短截取范围，或改用 Chrome / Edge
                  直接写入文件夹。
                </p>
              )}
              {compatBlocked && (
                <p className="text-sm text-red-600">
                  约 {estimatedCount} 张超出兼容模式上限（{COMPAT_MAX_FRAMES} 张）。
                  请缩短截取范围、增大「每隔 N 帧」，或改用 H.264 编码的
                  MP4/MOV（可走快速解码）。
                </p>
              )}
              {compatTooLong && (
                <p className="text-sm text-red-600">
                  截取时长 {Math.round(clipSec ?? 0)} 秒，超过兼容模式上限（
                  {COMPAT_MAX_CLIP_SEC / 60} 分钟）。兼容模式要逐帧解码整段视频，
                  浏览器内跑不完这个长度。请缩短截取范围；若源文件是 H.264 编码的
                  MP4/MOV，把扩展名对应的容器换成 MP4 后可走快速解码（不受此限制）。
                </p>
              )}
              {!fastInfo &&
                !compatTooLong &&
                clipSec !== null &&
                clipSec > COMPAT_WARN_CLIP_SEC && (
                  <p className="text-sm text-amber-700">
                    兼容模式需逐帧解码整段视频，{Math.round(clipSec)} 秒的片段会比较慢，
                    建议先截取一小段（如 30~60 秒）确认效果。
                  </p>
                )}

              <div className="flex items-center gap-3">
                <DownloadButton
                  onClick={() => void handleStart()}
                  loading={status === "loading" || status === "running"}
                  disabled={blocked}
                  label={
                    dirSupported ? "选择文件夹并开始提取" : "开始提取并下载 ZIP"
                  }
                />
                {(status === "running" || status === "loading") && (
                  <button
                    onClick={handleCancel}
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

        {(status === "loading" || status === "running") && (
          <div className="rounded-2xl border border-blue-100 bg-blue-50 p-6 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-blue-800">
              <Loader2 className="h-4 w-4 animate-spin" />
              {status === "loading"
                ? `正在准备… 已用 ${elapsedSec} 秒`
                : saved > 0
                  ? `已导出 ${saved}${estimatedCount ? ` / ${estimatedCount}` : ""} 张${
                      estimatedCount
                        ? `（${Math.min(100, Math.round((saved / Math.max(1, estimatedCount)) * 100))}%）`
                        : ""
                    } · 已用 ${elapsedSec} 秒${
                      etaSec !== null ? ` · 预计还需 ${etaSec} 秒` : ""
                    }`
                  : fastInfo
                    ? "正在解析视频…"
                    : `正在解码并抽帧 ${Math.round(decodeRatio * 100)}% · 已用 ${elapsedSec} 秒${
                        decodeRealtime
                          ? ` · 约 ${decodeRealtime.toFixed(1)}× 实时`
                          : ""
                      }${
                        decodeEtaSec !== null
                          ? ` · 预计还需 ${formatDuration(decodeEtaSec)}`
                          : ""
                      }`}
            </div>
            {runRatio > 0 ? (
              <div className="h-2 w-full overflow-hidden rounded-full bg-blue-100">
                <div
                  className="h-full rounded-full bg-brand-600 transition-all"
                  style={{ width: `${Math.min(100, Math.round(runRatio * 100))}%` }}
                />
              </div>
            ) : (
              <div className="h-2 w-full overflow-hidden rounded-full bg-blue-100">
                <div className="h-full w-full animate-pulse rounded-full bg-brand-600/40" />
              </div>
            )}
            <p className="text-xs text-blue-600">
              {!fastInfo && saved === 0
                ? "兼容模式需要逐帧解码整段视频，这一阶段最慢；解码完成后才开始写文件，请勿刷新或关闭页面"
                : dirSupported
                  ? "正在逐张写入你选择的文件夹：速度受磁盘写入与图片编码限制，请勿刷新或关闭页面"
                  : "提取在浏览器本地进行，请勿刷新或关闭页面"}
            </p>
            {dirSupported && (
              <p className="flex items-start gap-1.5 border-t border-blue-100 pt-2 text-xs text-blue-700">
                <FolderOpen className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  写入位置：
                  <strong className="mx-1">
                    {parentDirName ?? "（所选文件夹）"} /{" "}
                    {outputDirName ?? folderBase}
                  </strong>
                  <span className="text-blue-500">
                    （浏览器只暴露文件夹名，不显示盘符与完整路径）
                  </span>
                </span>
              </p>
            )}
            {!fastInfo && saved === 0 && decodeEtaSec !== null && decodeEtaSec > 120 && (
              <p className="text-xs text-amber-700">
                按当前速度还要约 {formatDuration(decodeEtaSec)}。想快一个数量级：在桌面用
                ffmpeg 把源文件 remux 成 MP4（<code>ffmpeg -i 输入.mkv -map 0:v:0 -c:v copy -an 输出.mp4</code>，几秒完成、画质无损），
                再拖回本页就能走 WebCodecs 快速解码。
              </p>
            )}
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
            <h3 className="font-semibold text-green-800">提取完成</h3>
            <div className="text-sm text-green-700 space-y-1">
              <p>
                共 <strong>{result.count}</strong> 张，合计{" "}
                <strong>{formatFileSize(result.totalBytes)}</strong>
              </p>
              <p>
                输出位置：
                <strong>
                  {result.zip
                    ? `${result.folderName}.zip`
                    : `${parentDirName ? `${parentDirName} / ` : ""}${result.folderName}`}
                </strong>
                {!result.zip && <span className="text-green-600">（已写入所选文件夹）</span>}
              </p>
              <p className="text-xs text-green-600">
                耗时 {(result.elapsedMs / 1000).toFixed(1)} 秒 ·{" "}
                {engine === "fast"
                  ? "WebCodecs 快速解码"
                  : `兼容模式 · ${getFfmpegCoreMode() === "multi" ? "多线程" : "单线程"}`}
              </p>
            </div>
            <p className="text-xs text-green-700">
              想把图片序列再合回视频？试试{" "}
              <Link
                href="/tools/video/from-images/"
                className="underline hover:text-green-900"
              >
                图片合成视频
              </Link>
            </p>
            {result.zip && (
              <button
                onClick={() =>
                  result.zip &&
                  downloadBlob(result.zip, `${result.folderName}.zip`)
                }
                className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-sm font-medium text-white hover:bg-brand-700 transition-colors shadow-lg shadow-brand-200"
              >
                <Download className="h-4 w-4" />
                下载 {result.folderName}.zip
              </button>
            )}
          </div>
        )}
      </div>
    </ToolLayout>
  );
}
