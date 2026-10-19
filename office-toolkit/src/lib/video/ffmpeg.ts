import { AppError } from "@/types";
import type { VideoConvertPhase } from "@/types/video";

/**
 * ffmpeg.wasm 全局单例。
 * - wasm 核心（@ffmpeg/core UMD 单线程版）运行时从 unpkg 经 toBlobURL 加载，不入仓库
 * - 单线程版不需要 COOP/COEP 跨域隔离头
 * - classWorkerURL 不传：让 webpack 打包 @ffmpeg/ffmpeg 的 worker.js（ESM worker，
 *   其内部相对导入只有走 webpack 打包才能解析；传 blob URL 反而会断）
 */

type FFmpegInstance = import("@ffmpeg/ffmpeg").FFmpeg;

const CORE_VERSION = "0.12.10";
const CORE_JS_URL = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd/ffmpeg-core.js`;
const CORE_WASM_URL = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd/ffmpeg-core.wasm`;

/** exec 兜底超时：30 分钟（ffmpeg.wasm 无内置超时概念，防死等） */
const EXEC_TIMEOUT_MS = 30 * 60 * 1000;

let instance: FFmpegInstance | null = null;
let loading: Promise<FFmpegInstance> | null = null;

/** 取消用：reject 当前 exec 的 race；terminate 后 exec 永不 resolve，只能这样打断 */
let cancelReject: ((reason: unknown) => void) | null = null;

/** 加载（幂等）：并发调用复用同一个 Promise，已加载直接返回 */
export function ensureLoaded(): Promise<FFmpegInstance> {
  if (instance?.loaded) return Promise.resolve(instance);
  if (!loading) {
    loading = (async () => {
      const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
        import("@ffmpeg/ffmpeg"),
        import("@ffmpeg/util"),
      ]);
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({
        coreURL: await toBlobURL(CORE_JS_URL, "text/javascript"),
        wasmURL: await toBlobURL(CORE_WASM_URL, "application/wasm"),
      });
      instance = ffmpeg;
      return ffmpeg;
    })();
    // 加载失败时清理，允许下次重试
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

export interface RunConversionOptions {
  inputName: string;
  inputData: Uint8Array;
  args: string[];
  outputName: string;
  /**
   * 进度回调：ratio 0~1，phase 见 VideoConvertPhase。
   * ffmpeg 的进度按输出时间戳计算，某些滤镜（如 GIF 的 palettegen）
   * 在统计完全片前不产出任何帧，此阶段 ratio 恒为 0 且 phase 为 analyzing
   */
  onProgress?: (ratio: number, phase: VideoConvertPhase) => void;
}

/** 写文件 → exec → 读输出 → 清理临时文件 */
export async function runConversion(
  opts: RunConversionOptions
): Promise<Uint8Array> {
  const ffmpeg = await ensureLoaded();

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
}

/** 生成 ffmpeg 输入文件名：保留原扩展名供选择 demuxer，异常时回退 mp4 */
export function ffmpegInputName(originalName: string): string {
  const dot = originalName.lastIndexOf(".");
  const ext = dot > 0 ? originalName.slice(dot + 1).toLowerCase() : "";
  return `input.${/^[a-z0-9]{1,5}$/.test(ext) ? ext : "mp4"}`;
}
