import { AppError } from "@/types";
import { cancelConversion, ensureLoaded } from "./ffmpeg";

/**
 * ffmpeg 图片序列输出（用于「视频提取图片」的兼容路径）。
 *
 * 与 `runConversion`（单文件输出）刻意分开实现：本函数需要按通配输出读回一批文件，
 * 逐张交给调用方落盘后立刻从 MEMFS 删除，避免内存里同时压着整批图片的副本。
 *
 * 注意：ffmpeg.wasm 的 exec 期间整个 worker 被同步阻塞，读回只能等 exec 结束后进行，
 * 因此**帧数上限是硬约束**（一次 exec 产出的全部帧都先堆在 MEMFS 里），由页面限制。
 */

/** exec 兜底超时：30 分钟 */
const EXEC_TIMEOUT_MS = 30 * 60 * 1000;

export interface RunImageSequenceOptions {
  inputName: string;
  /** 输入内容，直接写进 MEMFS（兼容模式只处理 ≤200MB，不需要 WORKERFS 挂载） */
  inputData: Uint8Array;
  /** 输出文件名前缀，如 `frame_` */
  outputPrefix: string;
  /** 输出扩展名（小写，不带点） */
  outputExt: string;
  /** 完整 ffmpeg 参数，输出参数里必须写 `${outputPrefix}%06d.${outputExt}` */
  args: string[];
  /** 预期张数（0 = 未知），仅用于进度分母 */
  expectedCount?: number;
  /** 每读回一张调用一次；返回后该文件即被删除 */
  onFile: (name: string, data: Uint8Array) => Promise<void>;
  /** 读回阶段的进度（已写入张数 / 总张数） */
  onProgress?: (done: number, total: number) => void;
  /** 截取段时长（秒）：用于把 ffmpeg 的 progress 折算成解码百分比 */
  clipDurationSec?: number;
  /**
   * exec 期间（解码 + 抽帧）的进度 0~1。
   * 抽帧由 select 滤镜完成，输出帧要等整段解码完才逐步产出，
   * 没有这个回调时页面在几十分钟里只能显示「正在准备」。
   */
  onDecodeProgress?: (ratio: number) => void;
}

let cancelReject: ((reason: unknown) => void) | null = null;

/** 取消当前序列提取：终止 worker（exec 永远不会 resolve，只能打断） */
export function cancelImageSequence(): void {
  cancelReject?.(new AppError("CANCELLED", "已取消提取"));
  cancelConversion();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 按文件名里的序号排序（frame_000123.jpg → 123） */
function sequenceIndex(name: string, prefix: string, ext: string): number {
  const inner = name.slice(prefix.length, name.length - ext.length - 1);
  const n = Number.parseInt(inner, 10);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

export async function runImageSequence(
  opts: RunImageSequenceOptions
): Promise<number> {
  // 兼容路径实测必须单线程（core-mt 在解码阶段会卡死，见 ffmpeg.ts 注释）
  const ffmpeg = await ensureLoaded({ multiThread: false });

  let cancelled = false;
  let cleaned = false;
  const cancelPromise = new Promise<never>((_, reject) => {
    cancelReject = (reason: unknown) => {
      cancelled = true;
      reject(reason);
    };
  });
  const guard = <T>(p: Promise<T>): Promise<T> =>
    Promise.race([p, cancelPromise]) as Promise<T>;

  const nameRe = new RegExp(
    `^${opts.outputPrefix.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    )}\\d+\\.${opts.outputExt}$`
  );

  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    await Promise.allSettled([ffmpeg.deleteFile(opts.inputName)]);
  };

  /* ---------- 诊断：保留 stderr 尾部，出错时带进错误详情 ---------- */

  /** 全部 stderr 都进环形缓冲；同时原样打到控制台，排障时不再被截断 */
  const logTail: string[] = [];
  const logHandler = ({ type, message }: { type: string; message: string }) => {
    if (type === "stdout") return;
    const line = message.trim();
    if (!line) return;
    logTail.push(line);
    if (logTail.length > 60) logTail.shift();
    console.info(`[ffmpeg][log] ${line.slice(0, 300)}`);
  };
  ffmpeg.on("log", logHandler);
  /** 把最后几条 stderr 拼成一段，作为错误的 details 展示给用户 */
  const tailDetail = (extra: string) =>
    [extra, logTail.slice(-8).join(" / ")].filter(Boolean).join("｜");

  /* ---------- 解码进度：ffmpeg 的 progress 事件按已处理时间上报 ---------- */

  const progressHandler = ({
    progress,
    time,
  }: {
    progress: number;
    time: number;
  }) => {
    const expected = opts.clipDurationSec ?? 0;
    // time 单位是微秒；有截取时长时自己折算，否则退回 ffmpeg 自估
    const raw = expected > 0 ? time / 1e6 / expected : progress;
    // 封顶 0.99：时间轴走完后还要写收尾帧、读回文件
    opts.onDecodeProgress?.(Math.min(0.99, Math.max(0, raw)));
  };
  ffmpeg.on("progress", progressHandler);

  try {
    const args = opts.args;
    await ffmpeg.writeFile(opts.inputName, opts.inputData);

    console.info(`[ffmpeg] 命令：ffmpeg ${args.join(" ")}`);
    const code = await Promise.race([
      ffmpeg.exec(args, EXEC_TIMEOUT_MS),
      cancelPromise,
    ]);
    if (code !== 0) {
      throw new AppError(
        "PROCESS_FAILED",
        "提取失败",
        tailDetail(`ffmpeg 退出码 ${code}`)
      );
    }
    if (cancelled) throw new AppError("CANCELLED", "已取消提取");

    const entries = await ffmpeg.listDir("/");
    const names = entries
      .filter((e) => !e.isDir && nameRe.test(e.name))
      .map((e) => e.name)
      .sort(
        (a, b) =>
          sequenceIndex(a, opts.outputPrefix, opts.outputExt) -
          sequenceIndex(b, opts.outputPrefix, opts.outputExt)
      );
    if (names.length === 0) {
      // 把目录里实际有什么带出来，便于判断是「没写出文件」还是「文件名不对」
      const seen = entries
        .filter((e) => !e.isDir)
        .slice(0, 6)
        .map((e) => e.name)
        .join(",");
      throw new AppError(
        "PROCESS_FAILED",
        "没有产出任何图片，请调整起止时间或检查文件",
        tailDetail(`输出目录未见匹配文件（现有：${seen || "空"}）`)
      );
    }

    const total = opts.expectedCount || names.length;
    let done = 0;
    for (const name of names) {
      const data = await guard(ffmpeg.readFile(name));
      if (typeof data === "string") {
        throw new AppError("PROCESS_FAILED", "读取图片失败", name);
      }
      await opts.onFile(name, data);
      await ffmpeg.deleteFile(name);
      done++;
      opts.onProgress?.(done, total);
      if (done % 20 === 0) await sleep(0); // 让出主线程，保持进度条与取消可响应
    }

    return done;
  } catch (e) {
    if (cancelled) throw e;
    if (e instanceof AppError) throw e;
    // 非 AppError（多半是 wasm 崩溃 / worker 拒绝的原始值）：也要把 stderr 尾部带出去，
    // 否则页面上只剩一句无信息量的「处理失败」
    const raw =
      e instanceof Error
        ? `${e.name}: ${e.message}`
        : typeof e === "object" && e
          ? JSON.stringify(e).slice(0, 300)
          : String(e);
    console.error("[ffmpeg] 序列提取异常:", e);
    throw new AppError("PROCESS_FAILED", "提取失败", tailDetail(raw));
  } finally {
    cancelReject = null;
    ffmpeg.off("log", logHandler);
    ffmpeg.off("progress", progressHandler);
    if (!cancelled) {
      // 成功/失败都清理输入与残留输出；取消路径 worker 已终止，MEMFS 随之释放
      await cleanup();
      await Promise.allSettled([
        (async () => {
          const entries = await ffmpeg.listDir("/");
          await Promise.allSettled(
            entries
              .filter((e) => !e.isDir && nameRe.test(e.name))
              .map((e) => ffmpeg.deleteFile(e.name))
          );
        })(),
      ]);
    }
  }
}
