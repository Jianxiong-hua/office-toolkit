import { AppError } from "@/types";
import type { VideoConvertPhase } from "@/types/video";

/**
 * ffmpeg.wasm 全局单例。
 * - wasm 核心运行时从 unpkg 经 toBlobURL 加载，不入仓库
 * - 有跨域隔离（COOP/COEP 生效，见 public/_headers）时优先用多线程 core-mt，
 *   可并行吃满多核；否则回退单线程 core（功能一致，只是慢）
 * - classWorkerURL 不传：让 webpack 打包 @ffmpeg/ffmpeg 的 worker.js（ESM worker，
 *   其内部相对导入只有走 webpack 打包才能解析；传 blob URL 反而会断）
 */

type FFmpegInstance = import("@ffmpeg/ffmpeg").FFmpeg;

const CORE_VERSION = "0.12.10";
const coreBase = (pkg: string) =>
  `https://unpkg.com/${pkg}@${CORE_VERSION}/dist/umd`;

/** exec 兜底超时：30 分钟（ffmpeg.wasm 无内置超时概念，防死等） */
const EXEC_TIMEOUT_MS = 30 * 60 * 1000;

type CoreMode = "multi" | "single";

let instance: FFmpegInstance | null = null;
/** 已加载实例的 core 类型 */
let instanceMode: CoreMode | null = null;
let loading: Promise<FFmpegInstance> | null = null;
/** 正在加载的 core 类型（与 loading 配套） */
let loadingMode: CoreMode | null = null;

/** 取消用：reject 当前 exec 的 race；terminate 后 exec 永不 resolve，只能这样打断 */
let cancelReject: ((reason: unknown) => void) | null = null;

/** 当前实际使用的 core 类型（null = 尚未加载），供结果面板标注引擎 */
export function getFfmpegCoreMode(): CoreMode | null {
  return instanceMode;
}

/**
 * 多线程 core 依赖 SharedArrayBuffer，只有跨域隔离（COOP/COEP）生效时才有
 */
function canUseMultiThread(): boolean {
  return (
    typeof SharedArrayBuffer !== "undefined" &&
    typeof self !== "undefined" &&
    self.crossOriginIsolated === true
  );
}

/** 加载一次 core：multiThread 决定用 core-mt 还是 core（失败时已终止实例） */
async function loadCore(multiThread: boolean): Promise<FFmpegInstance> {
  const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
    import("@ffmpeg/ffmpeg"),
    import("@ffmpeg/util"),
  ]);
  const base = coreBase(multiThread ? "@ffmpeg/core-mt" : "@ffmpeg/core");
  const ffmpeg = new FFmpeg();
  // 三个文件一起拉：mt 版缺 workerURL 会被内部拼成不存在的 .worker.js
  const [coreURL, wasmURL, workerURL] = await Promise.all([
    toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
    toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
    multiThread
      ? toBlobURL(`${base}/ffmpeg-core.worker.js`, "text/javascript")
      : Promise.resolve(null),
  ]);
  try {
    await ffmpeg.load({
      coreURL,
      wasmURL,
      ...(workerURL ? { workerURL } : {}),
    });
  } catch (e) {
    try {
      ffmpeg.terminate();
    } catch {
      /* 未初始化成功，忽略 */
    }
    throw e;
  }
  return ffmpeg;
}

/**
 * 加载（幂等）：同一种 core 的并发调用复用同一个 Promise，已加载直接返回。
 * 请求的类型与当前实例不一致时会先终止旧实例再重载——切 core 需要几秒
 * （wasm 已在浏览器缓存里），但两个工具很少在同一次使用中交替。
 *
 * multiThread=false 用于必须走单线程的调用方：多线程 core 在 GIF 这类
 * 「split+palettegen+paletteuse」重滤镜链上会因内存与线程同步开销严重变慢，
 * 实测 750 帧素材单线程 155.7 秒完成，多线程 295 秒仍停在该阶段。
 */
export function ensureLoaded(
  options?: { multiThread?: boolean }
): Promise<FFmpegInstance> {
  const desired: CoreMode =
    (options?.multiThread ?? true) && canUseMultiThread() ? "multi" : "single";

  if (instance?.loaded && instanceMode === desired) {
    return Promise.resolve(instance);
  }
  if (loading && loadingMode === desired) return loading;

  // 类型不符（或旧实例还在加载）：先终止，避免两套 core 同时占内存
  if (instance) {
    try {
      instance.terminate();
    } catch {
      /* 已终止 */
    }
    instance = null;
  }
  instanceMode = null;
  loading = null;
  loadingMode = null;

  loadingMode = desired;
  loading = (async () => {
    if (desired === "multi") {
      try {
        const ffmpeg = await loadCore(true);
        console.info(
          `[ffmpeg] core: 多线程（${navigator.hardwareConcurrency} 核可用）`
        );
        instance = ffmpeg;
        instanceMode = "multi";
        return ffmpeg;
      } catch (e) {
        // 跨域隔离已开但 core-mt 拉取/初始化失败：退回单线程，不让用户卡死
        console.warn("[ffmpeg] 多线程 core 加载失败，回退单线程:", e);
      }
    }
    const ffmpeg = await loadCore(false);
    console.info(
      desired === "multi"
        ? "[ffmpeg] core: 单线程（多线程回退）"
        : "[ffmpeg] core: 单线程（调用方要求单线程或无跨域隔离）"
    );
    instance = ffmpeg;
    instanceMode = "single";
    return ffmpeg;
  })();
  // 加载失败时清理，允许下次重试
  const pending = loading;
  loading.catch(() => {
    if (loading === pending) {
      loading = null;
      loadingMode = null;
    }
  });
  return loading;
}

export interface RunConversionOptions {
  inputName: string;
  inputData: Uint8Array;
  args: string[];
  outputName: string;
  /**
   * 强制单线程 core。重度滤镜链（GIF 的 split+palettegen+paletteuse）必须用它：
   * 多线程版在该链上因内存与同步开销严重变慢（实测 750 帧：单线程 155.7 秒完成，
   * 多线程 295 秒仍停在同一阶段）
   */
  forceSingleThread?: boolean;
  /**
   * 进度回调：ratio 0~1，phase 见 VideoConvertPhase。
   * ffmpeg 的进度按输出时间戳计算，某些滤镜（如 GIF 的 palettegen）
   * 在统计完全片前不产出任何帧，此阶段 progress 事件不给值，phase 为 analyzing
   */
  onProgress?: (ratio: number, phase: VideoConvertPhase) => void;
}

/** 写文件 → exec → 读输出 → 清理临时文件 */
export async function runConversion(
  opts: RunConversionOptions
): Promise<Uint8Array> {
  const ffmpeg = await ensureLoaded({
    multiThread: !opts.forceSingleThread,
  });

  let cancelled = false;
  let sawOutput = false;
  const cancelPromise = new Promise<never>((_, reject) => {
    cancelReject = (reason: unknown) => {
      cancelled = true;
      reject(reason);
    };
  });

  const progressHandler = ({ progress }: { progress: number }) => {
    const ratio = Math.min(1, Math.max(0, progress));
    if (ratio > 0) sawOutput = true;
    // 尚无输出帧 → analyzing（如 palettegen 统计期）；有输出帧 → encoding
    opts.onProgress?.(ratio, sawOutput ? "encoding" : "analyzing");
  };
  ffmpeg.on("progress", progressHandler);

  try {
    await ffmpeg.writeFile(opts.inputName, opts.inputData);
    const code = await Promise.race([
      ffmpeg.exec(opts.args, EXEC_TIMEOUT_MS),
      cancelPromise,
    ]);
    if (code !== 0) {
      throw new AppError("PROCESS_FAILED", "视频转换失败", `ffmpeg 退出码 ${code}`);
    }
    // exec 已完成，但读回文件（可能数 MB）仍需时间，明确告知「写入中」
    opts.onProgress?.(1, "writing");
    const data = await ffmpeg.readFile(opts.outputName);
    if (typeof data === "string") {
      throw new AppError("PROCESS_FAILED", "视频转换失败", "输出结果异常");
    }
    return data;
  } finally {
    cancelReject = null;
    ffmpeg.off("progress", progressHandler);
    if (!cancelled) {
      // 取消路径下 worker 已终止，MEMFS 随之释放，无需（也无法）清理
      await Promise.allSettled([
        ffmpeg.deleteFile(opts.inputName),
        ffmpeg.deleteFile(opts.outputName),
      ]);
    }
  }
}

/**
 * 取消当前转换：终止 worker 并重置单例，下次转换自动重新加载
 * （wasm 已被浏览器缓存，二次初始化约数秒）
 */
export function cancelConversion(): void {
  cancelReject?.(new AppError("CANCELLED", "已取消转换"));
  if (instance) {
    instance.terminate();
    instance = null;
  }
  loading = null;
  loadingMode = null;
  instanceMode = null;
}

/** 生成 ffmpeg 输入文件名：保留原扩展名供选择 demuxer，异常时回退 mp4 */
export function ffmpegInputName(originalName: string): string {
  const dot = originalName.lastIndexOf(".");
  const ext = dot > 0 ? originalName.slice(dot + 1).toLowerCase() : "";
  return `input.${/^[a-z0-9]{1,5}$/.test(ext) ? ext : "mp4"}`;
}
