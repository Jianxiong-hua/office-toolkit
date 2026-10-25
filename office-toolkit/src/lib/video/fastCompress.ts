import { AppError } from "@/types";
import type {
  FastQualityPreset,
  VideoConvertPhase,
  VideoFastCompressOptions,
  VideoFastCompressResult,
  VideoResolution,
} from "@/types/video";
import { generateOutputFilename } from "@/lib/file";
import {
  createFile,
  DataStream,
  Endianness,
  MP4BoxBuffer,
  type ISOFile,
  type Sample,
} from "mp4box";
import { Muxer, ArrayBufferTarget } from "mp4-muxer";

/**
 * 视频极速压缩：WebCodecs 硬件加速流水线
 * mp4box 流式解封装（+ releaseUsedSamples 及时释放，支持大文件）
 *   → VideoDecoder 解码 → canvas 缩放/旋转烘焙 → VideoEncoder 编码
 *   → mp4-muxer 封装（音频轨 AAC 原样 remux，不重编）
 *
 * 约束（不满足时抛错，由页面引导用户使用「视频压缩」ffmpeg 兜底工具）：
 * - 输入：MP4/MOV(ISO-BMFF) 容器 + H.264(avc1) 视频轨
 * - 输出：MP4(H.264)
 * - 倍速 ≠ 1 时 remux 音频无法变速，输出无音轨
 * - 浏览器需支持 WebCodecs（Chrome/Edge 94+、Safari 16.4+、Firefox 130+）
 */

/** 解码队列背压阈值：防止把整个文件灌进 VideoDecoder */
const DECODE_QUEUE_LIMIT = 20;
/** 编码器内部队列的软上限：太浅会让送帧线程频繁等待，太深会吃掉显存 */
const ENCODE_QUEUE_LIMIT = 24;
/** 自建编码队列的长度上限：硬解快于硬编，不设限会把整片帧压在内存里 */
const ENCODE_QUEUE_FRAMES = 30;
/** 单批读取/解码的样本数上限（批越大 IO 次数越少，批间停顿也越少） */
const SAMPLE_BATCH = 128;

/** bpp（bits per pixel per frame）→ 码率：high≈CRF20 / standard≈CRF23 / strong≈CRF28 */
const BPP_BY_QUALITY: Record<FastQualityPreset, number> = {
  high: 0.14,
  standard: 0.09,
  strong: 0.05,
};

/**
 * 源码率折扣上限。WebCodecs 是固定码率编码（用到目标为止，非 CRF 的够用就好），
 * 对已高度压缩的片源（流媒体 rip 等）若只按 bpp 定码率会越压越大，
 * 因此目标码率取「bpp 反推值」与「源视频码率 × 本档折扣」的较小者。
 */
const SOURCE_CAP_RATIO: Record<FastQualityPreset, number> = {
  high: 0.85,
  standard: 0.6,
  strong: 0.4,
};

const RESOLUTION_HEIGHT: Record<VideoResolution, number | null> = {
  original: null,
  "1080p": 1080,
  "720p": 720,
  "480p": 480,
};

/** 按输出高度选 H.264 profile/level */
function pickAvcCodec(outHeight: number): string {
  if (outHeight <= 576) return "avc1.42001f"; // Baseline 3.0，兼容性最好
  if (outHeight <= 1080) return "avc1.640028"; // High 4.0
  return "avc1.640033"; // High 5.1
}

const hex = (u8: Uint8Array, n = 16) =>
  Array.from(u8.slice(0, n))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");

/* ---------------- 取消机制 ---------------- */

let cancelReject: ((reason: unknown) => void) | null = null;

/** 取消当前极速压缩：置取消位，流水线各 await 点检查并中止 */
export function cancelFastCompress(): void {
  cancelReject?.(new AppError("CANCELLED", "已取消转换"));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 主流程 ---------------- */

export async function fastCompressVideo(
  file: File,
  options: VideoFastCompressOptions,
  onProgress?: (ratio: number, phase: VideoConvertPhase) => void,
  /** 源视频时长（秒，来自页面 readVideoMeta；0/undefined = 未知，此时不做源码率封顶） */
  sourceDurationSec?: number
): Promise<VideoFastCompressResult> {
  if (
    typeof VideoEncoder === "undefined" ||
    typeof VideoDecoder === "undefined"
  ) {
    throw new AppError(
      "BROWSER_NOT_SUPPORTED",
      "当前浏览器不支持 WebCodecs，请使用「视频压缩」工具",
      "需要 Chrome/Edge 94+、Safari 16.4+ 或 Firefox 130+"
    );
  }

  /** 硬件解码是否报过错（用于一次性软件重试判断） */
  let sawDecodeError = false;
  /** 处理起始时间（耗时统计用，含失败重试的总时长） */
  const startedAt = performance.now();

  /** 后台文件读取的控制句柄：管道提前退出（格式不支持等）时用于中止读取 */
  type FeedCtl = {
    aborted: boolean;
  };

  const run = async (
    hardwareAcceleration: HardwareAcceleration
  ): Promise<Omit<VideoFastCompressResult, "elapsedMs">> => {
    const feedCtl: FeedCtl = { aborted: false };
    try {
      return await runPipeline(hardwareAcceleration, feedCtl);
    } finally {
      // 无论成功还是中途抛错，后台读取都该停下
      feedCtl.aborted = true;
    }
  };

  const runPipeline = async (
    hardwareAcceleration: HardwareAcceleration,
    feedCtl: FeedCtl
  ): Promise<Omit<VideoFastCompressResult, "elapsedMs">> => {
    const pipelineStart = performance.now();
    let cancelled = false;
    const cancelPromise = new Promise<never>((_, reject) => {
      cancelReject = (reason: unknown) => {
        cancelled = true;
        closeCodecs();
        reject(reason);
      };
    });
    const guard = <T>(p: Promise<T>): Promise<T> =>
      Promise.race([p, cancelPromise]) as Promise<T>;

    const startSec = Math.max(0, options.trimStart);
    const endSec =
      options.trimEnd !== null ? Math.max(options.trimEnd, startSec) : null;
    const speed = options.speed;
    const keepAudio = speed === 1;

    /** 已读取的字节数（只用于诊断日志） */
    let bytesRead = 0;

    // encoder / muxer 在 configureAll 闭包内赋值，TS 控制流窄化追踪不到，
    // 使用处已用 `as` 取回联合类型；decoder 在顶层赋值，可直接窄化
    let decoder: VideoDecoder | null = null;
    let encoder: VideoEncoder | null = null;
    let muxer: Muxer<ArrayBufferTarget> | null = null;

    /**
     * 释放编解码器。取消也要走这里——只 throw 不 close 的话，
     * configured 的 VideoDecoder/VideoEncoder 会一直占着硬件实例直到 GC
     */
    function closeCodecs() {
      try {
        decoder?.close();
      } catch {
        /* 已关闭 */
      }
      try {
        encoder?.close();
      } catch {
        /* 已关闭 */
      }
    }

    let srcWidth = 0;
    let srcHeight = 0;
    let srcFps = 30;
    let outFps = 30;
    let trackMatrix: number[] | null = null;
    let outWidth = 0;
    let outHeight = 0;
    let hasAudioTrack = false;
    let failed: Error | null = null;
    let configPromise: Promise<void> | null = null;
    /** 诊断信息（解码失败时随错误详情展示，便于截图定位） */
    let diagCodec = "";
    let diagDesc = "";

    /** 视频/音频样本表（来自 moov，带 offset/size/cts/is_sync） */
    let videoSamples: Sample[] = [];
    let audioSamples: Sample[] = [];
    /** 源音频的 AudioSpecificConfig（PCE 片源必须原样带给封装器） */
    let audioDecoderDesc: Uint8Array | null = null;
    /** 是否已把解码配置交给封装器（只需第一块带） */
    let audioMetaSent = false;
    /** 要送入解码的视频样本区间 [videoFromIdx, videoToIdx) */
    let videoFromIdx = 0;
    let videoToIdx = 0;
    /** 输出端抽帧累加器（按 1/speed 的比例精确抽帧，见 decoder.output） */
    let keepAcc = 0;
    /** 输出末帧时间戳上限（us）：截取终点之后的帧丢弃 */
    let endTsUs = Number.POSITIVE_INFINITY;
    /** 估算总输出帧数（时长已知时用于帧数制进度，更平滑）；0 = 用读取字节制 */
    let estimatedTotalFrames = 0;
    let encodedFrames = 0;
    /** 最终采用的视频码率（bps，结果里回显） */
    let outBitrate = 0;
    /** 视频/音频泵状态（收尾要等它们结束） */
    let videoPumping = false;
    let audioPumping = false;

    const fail = (e: unknown, opts?: { decode?: boolean }) => {
      if (failed) return;
      // 保留原始错误到 console，便于定位（UI 只展示通用文案）
      console.error("[fastCompress] 转换失败:", e);
      if (opts?.decode) sawDecodeError = true;
      failed =
        e instanceof AppError
          ? e
          : e instanceof Error
            ? new AppError("PROCESS_FAILED", "极速压缩失败", e.message)
            : new AppError("PROCESS_FAILED", "极速压缩失败", String(e));
      closeCodecs();
    };

    // keepMdatData=false：mp4box 只当元数据解析器用，mdat 不留在内存里。
    // 样本数据稍后按 sample.offset 从 File 随机读取（Blob 支持 range）
    const mp4file: ISOFile = createFile(false);
    /** moov 已解析（此时样本表已完整，无需继续读文件） */
    let readyFired = false;

    /* ---------- 后台泵：持续读文件喂 mp4box（onReady 前后不间断） ---------- */

    let rejectInfo: ((e: unknown) => void) | null = null;
    let resolveFeedDone: (() => void) | null = null;
    const feedDone = new Promise<void>((r) => {
      resolveFeedDone = r;
    });

    const info = await new Promise<
      Parameters<NonNullable<ISOFile["onReady"]>>[0]
    >((resolve, reject) => {
      rejectInfo = reject;
      mp4file.onError = (e) =>
        reject(
          new AppError(
            "PROCESS_FAILED",
            "视频文件解析失败，请使用「视频压缩」工具",
            String(e)
          )
        );
      mp4file.onReady = (i) => {
        readyFired = true;
        resolve(i);
      };

      void (async () => {
        try {
          // 1) 先喂文件头：moov 在前的片源几十 KB 就够解析出样本表
          const HEAD_BYTES = Math.min(256 * 1024, file.size);
          const head = await guard(file.slice(0, HEAD_BYTES).arrayBuffer());
          bytesRead += HEAD_BYTES;
          onProgress?.(0.01, "analyzing");
          mp4file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(head, 0));

          // 2) 还没解析出来就按顶层 box 顺序跳读：mdat（动辄几个 GB）直接跳过，
          //    只把 moov 喂进去。样本表全在 moov 里，解析出来就不用再读文件了
          let pos = 0;
          while (!readyFired && !cancelled && !feedCtl.aborted && pos < file.size) {
            const hdrBuf = await guard(file.slice(pos, pos + 16).arrayBuffer());
            if (hdrBuf.byteLength < 8) break;
            const dv = new DataView(hdrBuf);
            let boxSize = dv.getUint32(0);
            const type = String.fromCharCode(
              ...new Uint8Array(hdrBuf, 4, 4)
            );
            if (boxSize === 1) {
              if (hdrBuf.byteLength < 16) break;
              boxSize = Number(dv.getBigUint64(8));
            } else if (boxSize === 0) {
              boxSize = file.size - pos;
            }
            if (boxSize < 8) break;
            // moov 已被文件头完整覆盖时不必重读
            if (type === "moov" && pos + boxSize > HEAD_BYTES) {
              const moovBytes = await guard(
                file.slice(pos, pos + boxSize).arrayBuffer()
              );
              bytesRead += boxSize;
              mp4file.appendBuffer(
                MP4BoxBuffer.fromArrayBuffer(moovBytes, pos)
              );
            }
            pos += boxSize;
          }
          if (!readyFired) mp4file.flush();
        } catch (e) {
          if (cancelled || (e instanceof AppError && e.code === "CANCELLED")) {
            rejectInfo?.(new AppError("CANCELLED", "已取消转换"));
          } else {
            rejectInfo?.(
              e instanceof AppError
                ? e
                : new AppError("PROCESS_FAILED", "文件读取失败", String(e))
            );
          }
        } finally {
          resolveFeedDone?.();
        }
      })();
    });

    if (cancelled) throw new AppError("CANCELLED", "已取消转换");

    // 诊断用：解析耗时与读取量，便于判断是索引解析还是编解码拖慢
    console.info(
      `[fastCompress] moov 解析完成 ${Math.round(performance.now() - pipelineStart)}ms，` +
        `读取 ${(bytesRead / 1048576).toFixed(1)}MB（${
          file.size > 0 ? ((bytesRead / file.size) * 100).toFixed(2) : "0"
        }%）`
    );

    /* ---------- 校验输入契约 ---------- */

    const videoTrack = info.videoTracks[0];
    if (!videoTrack) {
      throw new AppError(
        "UNSUPPORTED_FORMAT",
        "未找到视频轨，请使用「视频压缩」工具"
      );
    }
    if (!videoTrack.codec.startsWith("avc1")) {
      throw new AppError(
        "UNSUPPORTED_FORMAT",
        `仅支持 H.264 编码的视频（检测到 ${videoTrack.codec}），请使用「视频压缩」工具`
      );
    }
    const videoTrackId = videoTrack.id;
    if (!videoTrack.video) {
      throw new AppError(
        "PROCESS_FAILED",
        "无法读取视频尺寸，请使用「视频压缩」工具"
      );
    }
    srcWidth = videoTrack.video.width;
    srcHeight = videoTrack.video.height;
    trackMatrix = videoTrack.matrix ? Array.from(videoTrack.matrix) : null;

    const audioTrack = info.audioTracks[0];
    const audioInfo = audioTrack?.audio;
    const audioTrackId = audioTrack?.id ?? -1;
    const audioUsable =
      keepAudio && !!audioInfo && audioTrack.codec.startsWith("mp4a");

    /* ---------- 取样本表 + 规划读取区间 ---------- */

    videoSamples = mp4file.getTrackSamplesInfo(videoTrackId) ?? [];
    if (videoSamples.length === 0) {
      throw new AppError(
        "PROCESS_FAILED",
        "未能读取视频样本表，请使用「视频压缩」工具"
      );
    }
    console.info(`[fastCompress] 样本表已就绪：视频 ${videoSamples.length} 个`);

    {
      // 解码起点必须是关键帧；终点多解一个 GOP，保证截取末端 B 帧的参考链完整
      // （多余的帧在 decoder.output 里按时间戳丢弃）
      if (startSec > 0) {
        // 必须整表扫完，不能「遇到第一个 cts >= startSec 就 break」：
        // 样本按解码序排列，B 帧的 cts 会跳到后面，提前 break 会把起点
        // 误判到片头，等于白解一大段
        let lastKey = 0;
        for (let i = 0; i < videoSamples.length; i++) {
          const s = videoSamples[i];
          if (s.is_sync && s.cts / s.timescale <= startSec) lastKey = i;
        }
        videoFromIdx = lastKey;
      }
      videoToIdx = videoSamples.length;
      let lastCtsSec = 0;
      for (const s of videoSamples) {
        const t = s.cts / s.timescale;
        if (t > lastCtsSec) lastCtsSec = t;
      }
      if (startSec > 0 && lastCtsSec < startSec) {
        throw new AppError(
          "INVALID_INPUT",
          `截取起点（${startSec.toFixed(1)} 秒）已超出视频长度（${lastCtsSec.toFixed(1)} 秒），请调整时间`
        );
      }
      if (endSec !== null) {
        let last = -1;
        for (let i = 0; i < videoSamples.length; i++) {
          if (videoSamples[i].cts / videoSamples[i].timescale <= endSec) last = i;
        }
        if (last < 0) {
          videoToIdx = 0; // 截取区间落在片尾之外
        } else {
          videoToIdx = last + 1;
          for (let i = last + 1; i < videoSamples.length; i++) {
            videoToIdx = i + 1;
            if (videoSamples[i].is_sync) break;
          }
        }
      }
      endTsUs =
        endSec !== null
          ? Math.round(((endSec - startSec) / speed) * 1e6)
          : Number.POSITIVE_INFINITY;
      console.info(
        `[fastCompress] 解码区间 [idx ${videoFromIdx}, ${videoToIdx})，共 ${
          videoToIdx - videoFromIdx
        } 个样本`
      );
    }

    if (audioUsable) {
      audioSamples = (mp4file.getTrackSamplesInfo(audioTrackId) ?? []).filter(
        (s) => {
          const t = s.cts / s.timescale;
          return t >= startSec && (endSec === null || t <= endSec);
        }
      );
      // 源音频的 AudioSpecificConfig 必须原样带走：改用 PCE 描述声道
      // （channelConfiguration=0）的片源，若让封装器按 numberOfChannels 生成
      // 默认的 stereo 配置，解码器会报 channel element not allocated
      audioDecoderDesc = extractAudioSpecificConfig(
        mp4file.getTrackById(audioTrackId)
      );
      console.info(
        `[fastCompress] 音频样本 ${audioSamples.length} 个，ASC ${
          audioDecoderDesc ? `${audioDecoderDesc.byteLength} 字节` : "缺失"
        }`
      );
    }

    /* ---------- 解码器 ---------- */

    const canvas = new OffscreenCanvas(2, 2);
    const ctx = canvas.getContext("2d", { alpha: false })!;

    /** 源是否为旋转视频（轨道矩阵不变，算一次即可，别每帧都解包矩阵） */
    const sourceRotated = isRotated(trackMatrix);
    /** 强制关键帧间隔（帧），配置后算一次 */
    let keyFrameInterval = 1;

    /** 单帧处理：缩放/旋转烘焙 → 送编码（在编码泵里串行执行，canvas 无竞争） */
    const processFrame = (frame: VideoFrame) => {
      // 用可见区域尺寸（已应用裁切），与 ensureEncoded 的尺寸推导保持同一口径
      const codedW = frame.displayWidth || frame.codedWidth;
      const codedH = frame.displayHeight || frame.codedHeight;
      const needResize = codedW !== outWidth || codedH !== outHeight;
      const needRotate = sourceRotated;

      // 每约 2.5 秒强制一个关键帧：拖动进度条时无需从很远的关键帧解起
      const forceKey = encodedFrames > 0 && encodedFrames % keyFrameInterval === 0;
      const encodeOpts = forceKey ? { keyFrame: true } : undefined;

      if (!needResize && !needRotate) {
        encoder?.encode(frame, encodeOpts); // 无需处理：直接送编码（最快路径）
        return;
      }

      if (canvas.width !== outWidth || canvas.height !== outHeight) {
        canvas.width = outWidth;
        canvas.height = outHeight;
      }
      ctx.save();
      if (needRotate) {
        // 旋转矩阵同时完成旋转与缩放（内部按输出尺寸推导 scale）
        const t = rotationTransform(
          trackMatrix!,
          codedW,
          codedH,
          outWidth,
          outHeight
        );
        ctx.setTransform(t[0], t[1], t[2], t[3], t[4], t[5]);
        ctx.drawImage(frame, 0, 0, codedW, codedH);
      } else {
        // 纯缩放：九参数 drawImage 直接把源矩形映射到目标矩形
        ctx.drawImage(frame, 0, 0, codedW, codedH, 0, 0, outWidth, outHeight);
      }
      ctx.restore();

      const bitmap = canvas.transferToImageBitmap();
      const out = new VideoFrame(bitmap, {
        timestamp: frame.timestamp,
        duration: frame.duration ?? undefined,
      });
      encoder?.encode(out, encodeOpts);
      out.close();
    };

    /**
     * 编码队列 + 泵。decoder.output 是同步回调，若在回调里直接 encode，
     * 整部片子的帧会瞬间堆进 VideoEncoder 内部队列，编码工作量全部攒到
     * 最后 flush 才计费（表现为「解码飞快、收尾卡死」且内存暴涨）。
     * 这里输出回调只入队，由本泵按 encodeQueueSize 做背压。
     */
    const encodeQueue: VideoFrame[] = [];
    let encodePumping = false;

    /** 编码器腾出槽位时的唤醒器（见 waitEncodeSlot） */
    let encodeSlotWaiter: (() => void) | null = null;
    /** 看门狗定时器：整段等待期只挂一个，避免每帧创建 timer */
    let encodeSlotWatchdog: ReturnType<typeof setTimeout> | null = null;

    /** 唤醒等待者并清掉看门狗 */
    const wakeEncodeSlot = () => {
      const wake = encodeSlotWaiter;
      encodeSlotWaiter = null;
      if (encodeSlotWatchdog !== null) {
        clearTimeout(encodeSlotWatchdog);
        encodeSlotWatchdog = null;
      }
      wake?.();
    };

    /**
     * 等编码器腾出一个槽位。
     * 用 encoder.output 回调唤醒，而不是 setTimeout 轮询：后者的实际抖动有
     * 2~4ms，每帧都赔一次就足以把 160fps 的硬件编码器拖到 100fps 左右。
     * 看门狗只做兜底（编码器异常不吐帧时避免死等）
     */
    const waitEncodeSlot = () =>
      new Promise<void>((resolve) => {
        encodeSlotWaiter = resolve;
        if (encodeSlotWatchdog === null) {
          encodeSlotWatchdog = setTimeout(() => {
            encodeSlotWatchdog = null;
            const wake = encodeSlotWaiter;
            encodeSlotWaiter = null;
            wake?.();
          }, 50);
        }
      });

    const pumpEncode = async () => {
      if (encodePumping) return;
      encodePumping = true;
      try {
        while (encodeQueue.length > 0 && !cancelled && !failed) {
          // 首帧：确定输出尺寸并创建编码器/封装器。
          // 必须在下面的编码器状态检查之前——首帧时 encoder 还是 null，
          // 若先 break，finally 会把队列里所有帧关闭丢弃，导致零输出
          if (!encoder) {
            try {
              await ensureEncoded(encodeQueue[0]);
            } catch (e) {
              fail(e);
              break;
            }
            if (failed || cancelled) break;
          }
          const enc = encoder as VideoEncoder | null;
          if (!enc || enc.state !== "configured") break;
          // 队列满时等编码器回调唤醒（无轮询抖动）
          while (enc.encodeQueueSize > ENCODE_QUEUE_LIMIT) {
            await waitEncodeSlot();
            if (cancelled || failed) break;
          }
          if (cancelled || failed) break;
          const frame = encodeQueue.shift()!;
          try {
            processFrame(frame);
            encodedFrames++;
            // 帧数制进度（时长已知时比读取字节制更平滑、更贴近真实剩余时间）
            if (estimatedTotalFrames > 0) {
              onProgress?.(
                Math.min(0.95, encodedFrames / estimatedTotalFrames),
                "analyzing"
              );
            }
            // 每 200 帧报一次吞吐：4K 硬编通常 60~150fps，软编只有 10~20fps，
            // 一眼就能看出是不是编码器退化成软件编码
            if (encodedFrames % 200 === 0) {
              const sec = (performance.now() - pipelineStart) / 1000;
              console.info(
                `[fastCompress] ${encodedFrames}/${
                  estimatedTotalFrames || "?"
                } 帧，${(encodedFrames / Math.max(0.001, sec)).toFixed(1)} fps`
              );
            }
          } catch (e) {
            fail(e);
          } finally {
            frame.close();
          }
        }
      } finally {
        encodePumping = false;
        for (const f of encodeQueue.splice(0)) f.close();
      }
    };

    decoder = new VideoDecoder({
      output: (frame) => {
        if (failed) {
          frame.close();
          return;
        }
        // 截取起点关键帧到起点之间的帧（时间戳为负）不进输出，也不占抽帧配额
        if (frame.timestamp < 0) {
          frame.close();
          return;
        }
        // 截取终点之后多解的那个 GOP 也不进输出
        if (frame.timestamp > endTsUs) {
          frame.close();
          return;
        }
        // 倍速抽帧在输出端做：输出帧按展示序到达、时间戳单调，丢帧安全。
        // 绝不能在解码前按解码序丢帧——B 帧金字塔下被丢的帧是后续 B 帧的
        // 参考帧，会导致后续帧解码失败（x264 压制片源常见）。
        // 用累加器而不是时间阈值：1.25x/1.5x 这类非整数倍速下，时间戳取整会
        // 抖动，按阈值判断会忽丢忽留，输出节奏不稳
        keepAcc += 1 / speed;
        if (keepAcc < 1) {
          frame.close();
          return;
        }
        keepAcc -= 1;
        encodeQueue.push(frame);
        void pumpEncode();
      },
      error: (e) => {
        // 硬件解码偶发失败（异常 profile/10bit 等）：标记后由外层软件重试
        console.error("[fastCompress] 解码器错误:", e, "| state:", decoder?.state);
        fail(
          new AppError(
            "PROCESS_FAILED",
            "极速压缩失败",
            `解码失败: ${e instanceof Error ? e.message : String(e)} ` +
              `codec=${diagCodec} hw=${hardwareAcceleration}`
          ),
          { decode: true }
        );
      },
    });

    /* ---------- 解码器配置（样本表已就绪，进入流程即执行一次） ---------- */

    const configureAll = async () => {
      // 用样本表前 200 个估算源帧率：样本按解码序（B 帧导致 cts 乱序），
      // 必须排序后取中位间隔，直接用首尾差会被重排带偏
      const head = videoSamples.slice(0, 200);
      if (head.length >= 4) {
        const timescale = head[0].timescale;
        const cts = head.map((s) => s.cts).sort((a, b) => a - b);
        const gaps: number[] = [];
        for (let i = 1; i < cts.length; i++) {
          const g = cts[i] - cts[i - 1];
          if (g > 0) gaps.push(g);
        }
        if (gaps.length > 0) {
          gaps.sort((a, b) => a - b);
          const medianGap = gaps[Math.floor(gaps.length / 2)];
          if (medianGap > 0) {
            srcFps = Math.min(60, Math.max(5, timescale / medianGap));
          }
        }
      }
      // 输出帧率 = srcFps × min(1, speed)。
      // 倍速是「抽帧 + 时间轴压缩」：时长和帧数同比例减少，帧率不变；
      // 慢放是全帧保留 + 时间轴拉长，帧率 = srcFps × speed。
      // 写成 srcFps/speed 会让 2x 的码率、关键帧间隔、总帧数估算全按一半算，
      // 2x 实际 25fps 却当成 12.5fps（每帧时长兜底翻倍 → 轨道时长翻倍）
      outFps = Math.min(60, Math.max(1, srcFps * Math.min(1, speed)));
      // 每约 2.5 秒强制一个关键帧（帧间隔预计算，避免每帧再算）
      keyFrameInterval = Math.max(1, Math.round(outFps * 2.5));

      // 估算总输出帧数（帧数制进度用）：输出时长 × 输出帧率
      const trimDuration =
        endSec !== null
          ? endSec - startSec
          : sourceDurationSec && sourceDurationSec > startSec
            ? sourceDurationSec - startSec
            : 0;
      estimatedTotalFrames =
        trimDuration > 0
          ? Math.max(1, Math.round((trimDuration / speed) * outFps))
          : 0;

      // decoder：codec 直接用 mp4box 给出的完整串（如 avc1.640028），
      // description 取 stsd 中 avcC 盒内容。
      // 注意：不传 codedWidth/codedHeight——sample entry 的宽高可能是「显示尺寸」，
      // 与 SPS 的编码尺寸（含 crop）不一致时会解码失败，省略后由解码器从 SPS 推导。
      // 输出尺寸同样不在这里定：首帧的 coded 尺寸才是唯一真相（见 ensureEncoded）
      const description = extractAvcCDescription(
        mp4file.getTrackById(videoTrackId)
      );
      diagCodec = videoTrack.codec;
      diagDesc = description ? `${description.byteLength}B:${hex(description)}` : "";
      console.info(
        `[fastCompress] decoder 配置: codec=${videoTrack.codec} ` +
          `track=${srcWidth}x${srcHeight} hw=${hardwareAcceleration} ` +
          `description=${diagDesc || "无"}`
      );

      // 解码侧预检：部分环境（无专有编解码器的 Chromium/Firefox）configure 不报错
      // 但每次 decode 都失败，预检给出明确错误，避免用户看到莫名的 Decoding error。
      // 同时优先硬件解码：4K 软解只有 30~60fps，会把整条流水线（含硬件编码器）
      // 拖到半速，表现为 GPU 占用上不去
      const decCfg = {
        codec: videoTrack.codec,
        ...(description ? { description } : {}),
      };
      let decHw = hardwareAcceleration;
      let decSupport = await VideoDecoder.isConfigSupported({
        ...decCfg,
        hardwareAcceleration: decHw,
      });
      if (!decSupport.supported && decHw === "prefer-hardware") {
        decHw = "no-preference";
        decSupport = await VideoDecoder.isConfigSupported({
          ...decCfg,
          hardwareAcceleration: decHw,
        });
      }
      if (!decSupport.supported) {
        throw new AppError(
          "BROWSER_NOT_SUPPORTED",
          `当前浏览器无法解码该视频轨（${videoTrack.codec}），请使用「视频压缩」工具`
        );
      }

      console.info(
        `[fastCompress] decoder 实际配置: codec=${videoTrack.codec} hw=${decHw}`
      );
      await decoder!.configure({ ...decCfg, hardwareAcceleration: decHw });
    };

    /**
     * 首帧到达时确定输出尺寸并配置编码器 + 封装器（只执行一次）。
     * 用帧的 coded 尺寸而非容器元数据：sample entry/tkhd 的宽高在旋转视频上
     * 可能是显示尺寸，与实际编码尺寸不一致，曾导致输出比例错误。
     */
    const ensureEncoded = async (frame: VideoFrame) => {
      if (encoder) return;

      // 用可见区域尺寸（displayWidth/Height，已应用 SPS 裁切），而非 coded 尺寸：
      // 1920x816 coded 的视频实际画面常为 1920x804
      const frameW = frame.displayWidth || frame.codedWidth;
      const frameH = frame.displayHeight || frame.codedHeight;
      srcWidth = frameW;
      srcHeight = frameH;
      const rotated = sourceRotated;
      // 旋转烘焙后按显示宽高；只缩不放、取偶数
      const dispW = rotated ? frameH : frameW;
      const dispH = rotated ? frameW : frameH;
      const maxH = RESOLUTION_HEIGHT[options.resolution];
      if (maxH !== null && dispH > maxH) {
        const ratio = maxH / dispH;
        outWidth = Math.max(2, Math.round((dispW * ratio) / 2) * 2);
        outHeight = Math.max(2, Math.round((dispH * ratio) / 2) * 2);
      } else {
        outWidth = Math.max(2, Math.round(dispW / 2) * 2);
        outHeight = Math.max(2, Math.round(dispH / 2) * 2);
      }
      console.info(
        `[fastCompress] 首帧: 画面=${frameW}x${frameH} rotated=${rotated} ` +
          `输出=${outWidth}x${outHeight} fps=${outFps.toFixed(1)}`
      );

      const bpp = BPP_BY_QUALITY[options.quality];
      const bppTarget = Math.round(bpp * outWidth * outHeight * outFps);
      // 源视频码率：文件大小含音频，按 128kbps 扣除音频余量后除以时长。
      // WebCodecs 是固定码率编码（用到目标为止），对已压缩片源必须封顶，
      // 否则会出现「压缩后比源文件还大」
      const sourceVideoBitrate =
        sourceDurationSec && sourceDurationSec > 0
          ? Math.max(200_000, (file.size * 8) / sourceDurationSec - 128_000)
          : Number.POSITIVE_INFINITY;
      outBitrate = Math.min(
        24_000_000,
        Math.max(
          300_000,
          Math.min(
            bppTarget,
            sourceVideoBitrate * SOURCE_CAP_RATIO[options.quality]
          )
        )
      );
      const codec = pickAvcCodec(outHeight);

      // muxer：视频轨 + （可选）音频轨。fastStart=false 让 moov 置尾最省内存，
      // 浏览器本地播放无差异（大文件场景内存优先）。
      // firstTimestampBehavior=cross-track-offset：视频轨常带 edit list（首帧 cts≠0），
      // 且两条轨时间戳同源，用跨轨公共基准偏移，既满足「首块为 0」又不破坏音画相对对齐
      muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: {
          codec: "avc",
          width: outWidth,
          height: outHeight,
          // 不要传 frameRate：mp4-muxer 要求它是正整数（倍速后 outFps 常为 12.5
          // 这类小数，直接抛 "Must be a positive integer"），且它只被当作 track
          // timescale 用，用整数帧率反而降低时间戳精度。省略后用默认 57600
        },
        audio:
          audioUsable && audioInfo
            ? {
                codec: "aac",
                numberOfChannels: audioInfo.channel_count || 2,
                sampleRate: audioInfo.sample_rate,
              }
            : undefined,
        fastStart: false,
        firstTimestampBehavior: "cross-track-offset",
      });
      hasAudioTrack = audioUsable;

      // encoder：优先硬件编码。
      // no-preference 下浏览器遇到硬编不支持的配置（如 4K 需要的 High 5.1）会
      // 静默退回软件编码，4K 只剩 20~30fps；显式 prefer-hardware 才能在
      // isConfigSupported 阶段判断出有没有硬件实现
      const baseConfig: VideoEncoderConfig = {
        codec,
        width: outWidth,
        height: outHeight,
        bitrate: outBitrate,
        framerate: Math.round(outFps * 100) / 100,
        latencyMode: "quality",
      };
      let encoderHw: HardwareAcceleration = "prefer-hardware";
      let support = await VideoEncoder.isConfigSupported({
        ...baseConfig,
        hardwareAcceleration: encoderHw,
      });
      if (!support.supported) {
        encoderHw = "no-preference";
        support = await VideoEncoder.isConfigSupported({
          ...baseConfig,
          hardwareAcceleration: encoderHw,
        });
      }
      if (!support.supported) {
        throw new AppError(
          "BROWSER_NOT_SUPPORTED",
          `当前浏览器不支持 H.264 编码（${codec}），请使用「视频压缩」工具`
        );
      }
      const config: VideoEncoderConfig = {
        ...baseConfig,
        hardwareAcceleration: encoderHw,
      };
      console.info(
        `[fastCompress] encoder: ${codec} ${outWidth}x${outHeight} ` +
          `${(outBitrate / 1e6).toFixed(2)}Mbps hw=${encoderHw}`
      );

      // 视频解码时钟：编码器按解码序吐块且带的是展示时间戳（B 帧下非单调），
      // 需自估 DTS 并传 compositionTimeOffset，否则 mp4-muxer 报「DTS 必须单调递增」
      let videoDecodeClock: number | null = null;
      /** 上一块的展示时间戳（用于推算缺省 duration） */
      let prevPts: number | null = null;
      const frameDurationUs = Math.max(1, Math.round(1e6 / outFps));

      encoder = new VideoEncoder({
        output: (chunk, meta) => {
          // 编码器腾出一个槽位，立刻唤醒等着的送帧循环
          wakeEncodeSlot();
          try {
            const pts = chunk.timestamp;
            if (videoDecodeClock === null) videoDecodeClock = pts;
            const dts = videoDecodeClock;
            // duration 决定 DTS 步进与轨道时长，只有「与上一块的 pts 差」才和
            // 实际输出的帧间隔同源。chunk.duration 来自输入帧（我们传的是
            // 源帧时长 / speed），抽帧后与真实间隔不是一套时间轴：
            // 2x 时它是 20000us，而保留下来的帧间隔是 40000us —— 采信它会让
            // DTS 每帧落后 PTS 20000us 并持续累积，ctts 越来越大，播放器按
            // DTS 建索引后拖动进度条就找不到对应帧（speed=1 时两者恰好相等，
            // 所以只有倍速档出问题）
            const ptsDelta = prevPts === null ? 0 : pts - prevPts;
            const duration = ptsDelta > 0 ? ptsDelta : frameDurationUs;
            prevPts = pts;
            videoDecodeClock += duration;
            const data = new Uint8Array(chunk.byteLength);
            chunk.copyTo(data);
            // 用 Raw 版以完全控制 duration；compositionTimeOffset = pts - dts
            muxer?.addVideoChunkRaw(
              data,
              chunk.type,
              pts,
              duration,
              meta,
              pts - dts
            );
          } catch (e) {
            fail(e);
          }
        },
        error: (e) => {
          console.error("[fastCompress] 编码器错误:", e);
          fail(e);
        },
      });
      // 用自己构造的 config 而非 support.config：后者由浏览器规范化，
      // 实测可能导致 bitrate 不生效、输出远超目标码率
      await encoder.configure(config);
    };

    /* ---------- 样本读取泵（按 sample.offset 从文件随机读） ---------- */

    /** 单次随机读取的字节上限：合并相邻样本减少 IO，过大则会连别的轨的数据一起读进来 */
    const READ_CHUNK_BYTES = 4 * 1024 * 1024;

    /**
     * 取下一批样本并一次性读完它们的字节。
     * 同一条轨的样本在容器里通常连续存放，合并成一次 slice 远比逐样本读快
     */
    const readSampleBatch = async (
      table: Sample[],
      fromIdx: number,
      toIdx: number,
      byteBudget: number
    ): Promise<{
      samples: Sample[];
      bytes: Uint8Array | null;
      start: number;
      nextIdx: number;
    }> => {
      const batch: Sample[] = [];
      let start = Number.POSITIVE_INFINITY;
      let end = 0;
      let idx = fromIdx;
      while (idx < toIdx && idx < table.length && batch.length < SAMPLE_BATCH) {
        const s = table[idx];
        const newStart = Math.min(start, s.offset);
        const newEnd = Math.max(end, s.offset + s.size);
        if (batch.length > 0 && newEnd - newStart > byteBudget) break;
        batch.push(s);
        start = newStart;
        end = newEnd;
        idx++;
      }
      if (batch.length === 0) {
        return { samples: batch, bytes: null, start, nextIdx: idx };
      }
      const bytes = new Uint8Array(
        await guard(file.slice(start, end).arrayBuffer())
      );
      return { samples: batch, bytes, start, nextIdx: idx };
    };

    const pumpVideo = async () => {
      if (videoPumping) return;
      videoPumping = true;
      /**
       * 预读下一批：让文件 IO 与解码/编码重叠。
       * 不预读的话每批之间编码器会空转等一次磁盘读，帧率越高损失越明显
       */
      const startRead = (from: number) => {
        const p = readSampleBatch(videoSamples, from, videoToIdx, READ_CHUNK_BYTES);
        p.catch(() => {
          /* 中断时提前消费掉 rejection */
        });
        return p;
      };
      try {
        let idx = videoFromIdx;
        let logged = false;
        let pending: ReturnType<typeof startRead> | null =
          idx < videoToIdx ? startRead(idx) : null;
        while (pending && !cancelled && !failed) {
          const got = await pending;
          if (!got.bytes || got.samples.length === 0) break;
          idx = got.nextIdx;
          // 立刻发起下一批的读取，与下面的解码并行
          pending = idx < videoToIdx ? startRead(idx) : null;

          // 背压：解码队列 / 编码队列超限时等一等。硬解普遍快于硬编，
          // 不限住读取会把整片帧压在内存里
          while (
            (decoder &&
              decoder.state === "configured" &&
              decoder.decodeQueueSize > DECODE_QUEUE_LIMIT) ||
            encodeQueue.length > ENCODE_QUEUE_FRAMES
          ) {
            await guard(sleep(4));
            if (cancelled || failed) break;
          }
          if (cancelled || failed) break;
          const dec = decoder;
          if (!dec || dec.state !== "configured") break;

          // 时长未知时没有帧数制进度，用样本进度兜底，避免进度条一直不动
          if (estimatedTotalFrames === 0) {
            onProgress?.(
              Math.min(
                0.95,
                (idx - videoFromIdx) / Math.max(1, videoToIdx - videoFromIdx)
              ),
              "analyzing"
            );
          }

          for (const s of got.samples) {
            // 起点关键帧通常 cts < startSec（时间戳为负），必须照喂，
            // 否则解码器收到的第一个 chunk 是 delta 帧 → Decoding error
            const outTsUs = Math.round(
              ((s.cts / s.timescale - startSec) / speed) * 1e6
            );
            if (!logged) {
              logged = true;
              console.info(
                `[fastCompress] 首批送入解码: #${s.number} type=${
                  s.is_sync ? "key" : "delta"
                } ts=${outTsUs} size=${s.size} head=${hex(
                  got.bytes.subarray(s.offset - got.start, s.offset - got.start + s.size),
                  12
                )}`
              );
            }
            dec.decode(
              new EncodedVideoChunk({
                type: s.is_sync ? "key" : "delta",
                timestamp: outTsUs,
                duration: Math.max(
                  1,
                  Math.round(((s.duration || 0) / s.timescale / speed) * 1e6)
                ),
                data: got.bytes.subarray(
                  s.offset - got.start,
                  s.offset - got.start + s.size
                ),
              })
            );
          }
        }
      } catch (e) {
        fail(e);
      } finally {
        videoPumping = false;
      }
    };

    const pumpAudio = async () => {
      if (!audioUsable || audioSamples.length === 0) return;
      if (audioPumping) return;
      audioPumping = true;
      try {
        let idx = 0;
        while (idx < audioSamples.length && !cancelled && !failed) {
          // muxer 在首帧时才创建；视频泵在同时推进，这里等不会死锁。
          // 但视频泵已经结束仍没有 muxer（没有任何输出帧）时必须退出，否则死等
          while (!muxer && !cancelled && !failed && videoPumping) {
            await guard(sleep(10));
          }
          const mx = muxer as Muxer<ArrayBufferTarget> | null;
          if (!mx || cancelled || failed) break;

          const got = await readSampleBatch(
            audioSamples,
            idx,
            audioSamples.length,
            READ_CHUNK_BYTES
          );
          if (!got.bytes || got.samples.length === 0) break;
          idx = got.nextIdx;

          for (const s of got.samples) {
            const off = s.offset - got.start;
            // 复制一份：muxer 会持有引用到 finalize，不能指向批缓冲
            const data = got.bytes.slice(off, off + s.size);
            mx.addAudioChunkRaw(
              data,
              s.is_sync ? "key" : "delta",
              Math.max(
                0,
                Math.round((s.cts / s.timescale - startSec) * 1e6)
              ),
              Math.max(1, Math.round(((s.duration || 0) / s.timescale) * 1e6)),
              // 第一块把源的 AudioSpecificConfig 交给封装器；漏了它，
              // 用 PCE 描述声道的片源会整条音轨解码失败
              audioDecoderDesc && !audioMetaSent
                ? {
                    decoderConfig: {
                      codec: audioTrack.codec,
                      description: audioDecoderDesc,
                      sampleRate: audioInfo?.sample_rate,
                      numberOfChannels: audioInfo?.channel_count || 2,
                    },
                  }
                : undefined
            );
            audioMetaSent = true;
          }
        }
      } catch (e) {
        fail(e);
      } finally {
        audioPumping = false;
      }
    };


    /* ---------- 配置解码器 → 启动两个泵 ---------- */

    if (videoToIdx <= videoFromIdx) {
      throw new AppError(
        "INVALID_INPUT",
        "截取区间内没有可用的视频帧，请调整起止时间"
      );
    }

    await configureAll();
    if (failed) throw failed;

    void pumpVideo();
    void pumpAudio();

    // 读取循环在 onReady 后已停止，这里收拢它的收尾
    await guard(feedDone);
    if (cancelled) throw new AppError("CANCELLED", "已取消转换");
    if (failed) throw failed;

    /* ---------- 收尾：样本排空 → 解码 flush → 编码排空 → 编码 flush → 封装 ---------- */

    // encoder 在 ensureEncoded 闭包内赋值，TS 窄化失效；以下各处实时读取
    const getEncoder = (): VideoEncoder | null =>
      encoder as VideoEncoder | null;

    onProgress?.(1, "encoding");
    // 1) 等视频/音频泵跑完、解码队列清空
    while (
      !cancelled &&
      !failed &&
      (videoPumping ||
        audioPumping ||
        (decoder &&
          decoder.state === "configured" &&
          decoder.decodeQueueSize > 0))
    ) {
      await guard(sleep(30));
    }
    if (cancelled) throw new AppError("CANCELLED", "已取消转换");
    if (failed) throw failed;

    // 2) flush 解码器：把所有帧交给我们（进入编码队列）
    if (decoder && decoder.state === "configured") await decoder.flush();
    if (failed) throw failed;

    // 编码侧是否还有未完的工作（队列 / 泵 / 编码器内部队列）
    const encodePending = () => {
      const e2 = getEncoder();
      return (
        encodeQueue.length > 0 ||
        encodePumping ||
        !!(e2 && e2.state === "configured" && e2.encodeQueueSize > 0)
      );
    };

    // 3) 等编码队列排空（含编码泵与 VideoEncoder 内部队列）
    while (!cancelled && !failed && encodePending()) {
      await guard(sleep(30));
    }
    if (cancelled) throw new AppError("CANCELLED", "已取消转换");
    if (failed) throw failed;

    // 4) flush 编码器：吐出最后几帧
    const enc = getEncoder();
    if (enc && enc.state === "configured") await enc.flush();
    if (failed) throw failed;

    // 5) 封装 + 组装 Blob（此阶段应很快，纯内存操作）
    onProgress?.(1, "writing");
    const mx = muxer as Muxer<ArrayBufferTarget> | null;
    mx?.finalize();
    const buffer = mx?.target.buffer;
    if (!buffer || buffer.byteLength === 0) {
      throw new AppError("PROCESS_FAILED", "封装失败：输出为空");
    }

    return {
      blob: new Blob([buffer], { type: "video/mp4" }),
      originalSize: file.size,
      outputSize: buffer.byteLength,
      filename: generateOutputFilename(file.name, "compressed", "mp4"),
      width: outWidth,
      height: outHeight,
      fps: Math.round(outFps * 10) / 10,
      hasAudio: hasAudioTrack,
      bitrate: outBitrate,
    };
  };

  try {
    // 首选硬件解码：4K 软解 30~60fps 会卡住整条流水线（硬编只能在旁边半速空转）
    const r = await run("prefer-hardware");
    return { ...r, elapsedMs: performance.now() - startedAt };
  } catch (e) {
    // 硬件解码失败（异常 profile / 10bit / 驱动兼容问题）时，软件解码重试一次
    if (sawDecodeError) {
      console.info("[fastCompress] 硬件解码失败，改用软件解码重试");
      onProgress?.(0, "analyzing");
      const r = await run("prefer-software");
      return { ...r, elapsedMs: performance.now() - startedAt };
    }
    throw e;
  }
}

/* ---------------- 工具函数 ---------------- */

/**
 * 矩阵是否为非单位矩阵（携带旋转/翻转）。
 * MP4 tkhd 矩阵为 9 元行主序 [a,b,u,c,d,v,x,y,w]，16.16 定点。
 * 必须按 [a,c,e,b,d,f] 解包（与 rotationTransform 一致）——按 [a,b,c,d,e,f]
 * 直接解包会把单位矩阵误判为旋转矩阵，导致输出宽高对调
 */
export function isRotated(matrix: number[] | null): boolean {
  if (!matrix || matrix.length < 6) return false;
  const [m0, m1, m2, m3, m4, m5] = matrix.map((x) => x / 65536);
  const [a, c, e, b, d, f] = [m0, m1, m2, m3, m4, m5];
  return !(a === 1 && b === 0 && c === 0 && d === 1 && e === 0 && f === 0);
}

/**
 * 由 MP4 轨道矩阵推导 canvas 变换（把旋转/翻转烘焙进像素，输出为显示方向）。
 * 参考实现：lyonbot/video-to-gif 的 frameGrabber.ts
 */
export function rotationTransform(
  matrix: number[],
  trackW: number,
  trackH: number,
  outW: number,
  outH: number
): [number, number, number, number, number, number] {
  // MP4 矩阵为 16.16 定点数，取前 6 个有效元素
  const [m0, m1, m2, m3, m4, m5] = matrix.slice(0, 6).map((x) => x / 65536);
  // 重排为 canvas 2D 矩阵 [a, b, c, d, e, f]
  const [a, c, e, b, d, f] = [m0, m1, m2, m3, m4, m5];
  const m = new DOMMatrix([a, b, c, d, e, f]);
  const scaleX = outW / Math.abs(a * trackW + c * trackH);
  const scaleY = outH / Math.abs(b * trackW + d * trackH);
  const t = new DOMMatrix()
    .translate(outW / 2, outH / 2)
    .scale(scaleX, scaleY)
    .multiply(m.inverse())
    .translate(-trackW / 2, -trackH / 2);
  return [t.a, t.b, t.c, t.d, t.e, t.f];
}

/**
 * 从 stsd 的 esds 里提取 AAC 的 AudioSpecificConfig。
 * 必须原样转交给封装器：部分片源用 PCE（channelConfiguration=0）描述声道布局，
 * 按 numberOfChannels 生成的默认配置会让解码器整条音轨报
 * "channel element not allocated"
 */
export function extractAudioSpecificConfig(trak: unknown): Uint8Array | null {
  try {
    const t = trak as {
      mdia?: {
        minf?: {
          stbl?: {
            stsd?: {
              entries?: {
                esds?: {
                  esd?: {
                    descs?: {
                      descs?: { data?: Uint8Array }[];
                    }[];
                  };
                };
              }[];
            };
          };
        };
      };
    };
    const dsi =
      t.mdia?.minf?.stbl?.stsd?.entries?.[0]?.esds?.esd?.descs?.[0]?.descs?.[0]
        ?.data;
    return dsi && dsi.byteLength > 0 ? new Uint8Array(dsi) : null;
  } catch {
    return null;
  }
}

/** 从 stsd 的 avcC 盒提取 H.264 解码配置（VideoDecoder 的 description） */
export function extractAvcCDescription(trak: unknown): Uint8Array | null {
  try {
    const t = trak as {
      mdia?: {
        minf?: {
          stbl?: {
            stsd?: {
              entries?: { avcC?: { write: (s: DataStream) => void } }[];
            };
          };
        };
      };
    };
    const entry = t.mdia?.minf?.stbl?.stsd?.entries?.[0];
    if (!entry?.avcC) return null;
    const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
    entry.avcC.write(stream);
    return new Uint8Array(
      stream.buffer,
      8,
      Math.max(0, stream.getPosition() - 8)
    );
  } catch {
    return null;
  }
}
