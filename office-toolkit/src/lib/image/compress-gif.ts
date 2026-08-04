import { GIFEncoder, quantize, applyPalette } from "gifenc";
import { parseGIF, decompressFrames } from "gifuct-js";
import { AppError } from "@/types";
import { readFileAsArrayBuffer } from "@/lib/file";

export type GifColorCount = 8 | 16 | 32 | 64 | 128 | 256;

export interface CompressGifOptions {
  colors: GifColorCount;
  maxWidth?: number;
  maxHeight?: number;
  /**
   * 目标帧率 (fps)。设置后按比例丢帧；保留的帧的 delay 调整到新帧率对应的值
   * 不设置或 <= 0 表示保持原速
   */
  targetFps?: number;
  /**
   * 是否合并连续重复帧（RGBA 字节完全相同则跳过，合并 delay 到前一个保留帧）
   * 默认 true
   */
  mergeDuplicates?: boolean;
}

/** 轻量级元信息：仅解析 GIF 结构不解码像素 */
export interface GifMetadata {
  width: number;
  height: number;
  frameCount: number;
  /** 平均帧延迟（毫秒） */
  avgDelayMs: number;
  /** 实际调色板大小（来自全局或首个本地调色板） */
  colorCount: number;
}

interface FullFrame {
  /** 全屏 RGBA（逻辑屏幕大小） */
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  /** 毫秒（gifuct-js 已 *10），写入时 clamp 到 ≥ 20ms */
  delay: number;
  /** 此帧是否包含透明像素 */
  hasTransparency: boolean;
}

/**
 * 轻量级 GIF 元信息读取（不解码像素）
 * - 用于在 UI 上展示原图「当前值」，避免完整解码所有帧
 */
export async function parseGifMetadata(file: File): Promise<GifMetadata> {
  const buffer = await readFileAsArrayBuffer(file);
  const gif = parseGIF(buffer);
  const width = gif.lsd.width;
  const height = gif.lsd.height;

  // 仅取真正的帧（排除 Application 扩展）
  const realFrames = gif.frames.filter(
    (f): f is Extract<typeof f, { gce: unknown }> => "gce" in f
  );
  const frameCount = realFrames.length;

  // 平均帧延迟
  let totalDelay = 0;
  for (const f of realFrames) {
    totalDelay += f.gce.delay || 100;
  }
  const avgDelayMs = frameCount > 0 ? totalDelay / frameCount : 0;

  // 调色板大小：优先用全局色表的实际条目数
  // （lct 的实际色值不在 parseGIF 返回的 Frame 类型里，只能给出大致数量）
  let colorCount = gif.gct.length || 256;

  return { width, height, frameCount, avgDelayMs, colorCount };
}

/**
 * 帧过滤：丢帧（按目标 FPS）+ 合并连续重复帧
 * - 丢帧策略：均匀抽样以匹配目标 FPS；保留的帧的 delay 调整为新帧率对应值
 * - 合并策略：相邻两帧 RGBA 字节完全相同则跳过，delay 累加到前一个保留帧
 * - 返回新帧数组（不修改原数组）
 */
function filterFrames(
  frames: FullFrame[],
  options: { targetFps?: number; mergeDuplicates?: boolean }
): FullFrame[] {
  const { targetFps, mergeDuplicates = true } = options;
  let result = frames;

  // 1. 丢帧（仅当 targetFps > 0 且原帧率高于目标时）
  if (targetFps && targetFps > 0 && result.length > 0) {
    const origAvgDelay = result.reduce((s, f) => s + f.delay, 0) / result.length;
    const origFps = origAvgDelay > 0 ? 1000 / origAvgDelay : 0;
    if (origFps > targetFps) {
      // 保留间隔 = origFps / targetFps，向上取整
      const keepEvery = Math.max(1, Math.ceil(origFps / targetFps));
      const newDelay = Math.max(20, Math.round(1000 / targetFps));
      const filtered: FullFrame[] = [];
      for (let i = 0; i < result.length; i++) {
        if (i % keepEvery === 0) {
          filtered.push({ ...result[i], delay: newDelay });
        }
      }
      result = filtered;
    }
  }

  // 2. 合并连续重复帧
  if (mergeDuplicates && result.length > 1) {
    const merged: FullFrame[] = [result[0]];
    for (let i = 1; i < result.length; i++) {
      const prev = merged[merged.length - 1];
      const cur = result[i];
      // 比较 RGBA 字节（尺寸必须相同，否则视为不同帧）
      if (
        prev.width === cur.width &&
        prev.height === cur.height &&
        prev.rgba.length === cur.rgba.length &&
        rgbaEqual(prev.rgba, cur.rgba)
      ) {
        // 累加 delay 到前一个保留帧
        prev.delay = Math.min(65535, prev.delay + cur.delay);
      } else {
        merged.push(cur);
      }
    }
    result = merged;
  }

  return result;
}

/** 快速字节数组相等比较（用于合并重复帧检测） */
function rgbaEqual(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  const len = a.length;
  if (b.length !== len) return false;
  // 抽样比较：每 256 字节比一次（O(n/256)）
  for (let i = 0; i < len; i += 256) {
    if (a[i] !== b[i]) return false;
  }
  // 抽样都通过后再完整比较
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * 解析 GIF 文件，把每帧手动合成全屏 RGBA（正确处理 disposal method）
 */
export async function parseGifFrames(file: File): Promise<{
  frames: FullFrame[];
  width: number;
  height: number;
}> {
  const buffer = await readFileAsArrayBuffer(file);
  const gif = parseGIF(buffer);
  const rawFrames = decompressFrames(gif, true);

  if (rawFrames.length === 0) {
    throw new AppError("PROCESS_FAILED", "GIF 文件无有效帧");
  }

  const width = gif.lsd.width;
  const height = gif.lsd.height;

  // 全屏画布（用于合成每帧）
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new AppError("BROWSER_NOT_SUPPORTED", "当前浏览器不支持 Canvas");
  }

  // 用于 disposal=3（restore to previous）的备份
  let savedArea: ImageData | null = null;
  let savedRect: { x: number; y: number; w: number; h: number } | null = null;

  const frames: FullFrame[] = [];

  for (let i = 0; i < rawFrames.length; i++) {
    const f = rawFrames[i];

    // 1. 在绘制本帧前，先按「上一帧」的 disposal 处理画布
    if (i > 0) {
      const prev = rawFrames[i - 1];
      const d = prev.disposalType;
      if (d === 2) {
        // restore to background: 清除上一帧的 patch 矩形
        ctx.clearRect(prev.dims.left, prev.dims.top, prev.dims.width, prev.dims.height);
      } else if (d === 3 && savedArea && savedRect) {
        // restore to previous
        ctx.putImageData(savedArea, savedRect.x, savedRect.y);
      }
      // d === 0/1: 不动
    }

    // 2. 如果本帧的 disposal=3，先备份 patch 区域（用于处理下一帧时恢复）
    if (f.disposalType === 3) {
      const { left, top, width: pw, height: ph } = f.dims;
      savedRect = { x: left, y: top, w: pw, h: ph };
      savedArea = ctx.getImageData(left, top, pw, ph);
    } else {
      savedArea = null;
      savedRect = null;
    }

    // 3. 绘制本帧 patch
    const patchData = new ImageData(
      new Uint8ClampedArray(f.patch),
      f.dims.width,
      f.dims.height
    );
    ctx.putImageData(patchData, f.dims.left, f.dims.top);

    // 4. 快照全屏 → RGBA
    const fullImageData = ctx.getImageData(0, 0, width, height);

    // 5. 检测透明度：transparentIndex 定义 OR 全屏有 alpha < 255 像素
    let hasTransparency = f.transparentIndex !== undefined;
    if (!hasTransparency) {
      const px = fullImageData.data;
      for (let k = 3; k < px.length; k += 4) {
        if (px[k] < 255) {
          hasTransparency = true;
          break;
        }
      }
    }

    frames.push({
      rgba: new Uint8ClampedArray(fullImageData.data),
      width,
      height,
      delay: f.delay || 100,
      hasTransparency,
    });
  }

  return { frames, width, height };
}

/**
 * 把每帧 RGBA 缩放到目标尺寸（永不放大）
 */
function maybeScaleFrames(
  frames: FullFrame[],
  maxWidth?: number,
  maxHeight?: number
): FullFrame[] {
  if (!maxWidth && !maxHeight) return frames;

  return frames.map((f) => {
    const scale = Math.min(
      maxWidth ? maxWidth / f.width : 1,
      maxHeight ? maxHeight / f.height : 1,
      1
    );
    if (scale >= 1) return f;

    const newW = Math.round(f.width * scale);
    const newH = Math.round(f.height * scale);

    // 先把原 RGBA 放进一个临时 canvas，再用 drawImage 缩放
    const src = document.createElement("canvas");
    src.width = f.width;
    src.height = f.height;
    const srcCtx = src.getContext("2d", { willReadFrequently: true });
    if (!srcCtx) {
      throw new AppError("BROWSER_NOT_SUPPORTED", "当前浏览器不支持 Canvas");
    }
    srcCtx.putImageData(new ImageData(new Uint8ClampedArray(f.rgba), f.width, f.height), 0, 0);

    const dst = document.createElement("canvas");
    dst.width = newW;
    dst.height = newH;
    const dstCtx = dst.getContext("2d");
    if (!dstCtx) {
      throw new AppError("BROWSER_NOT_SUPPORTED", "当前浏览器不支持 Canvas");
    }
    dstCtx.drawImage(src, 0, 0, newW, newH);
    const newData = dstCtx.getImageData(0, 0, newW, newH);

    return {
      rgba: newData.data,
      width: newW,
      height: newH,
      delay: f.delay,
      hasTransparency: f.hasTransparency,
    };
  });
}

/**
 * 把帧序列重新编码为 GIF
 */
export function encodeGif(
  frames: FullFrame[],
  options: CompressGifOptions
): Uint8Array {
  if (frames.length === 0) {
    throw new AppError("PROCESS_FAILED", "没有可编码的帧");
  }

  const scaled = maybeScaleFrames(frames, options.maxWidth, options.maxHeight);
  const encoder = GIFEncoder();

  scaled.forEach((f, i) => {
    // 有透明时，palette 索引 0 留给透明，所以实际颜色数 - 1
    const maxColors = f.hasTransparency ? Math.max(2, options.colors - 1) : options.colors;
    const useAlpha = f.hasTransparency;

    const palette = quantize(f.rgba, maxColors, {
      format: useAlpha ? "rgba4444" : "rgb565",
      oneBitAlpha: useAlpha,
    });
    const index = applyPalette(f.rgba, palette, useAlpha ? "rgba4444" : "rgb565");

    const frameOpts = {
      palette,
      transparent: useAlpha,
      transparentIndex: useAlpha ? 0 : undefined,
      delay: Math.max(20, f.delay),
      dispose: 2, // restore to background
    };

    if (i === 0) {
      // 第一帧：设置 repeat (loop forever)
      encoder.writeFrame(index, f.width, f.height, {
        ...frameOpts,
        repeat: 0,
      });
    } else {
      encoder.writeFrame(index, f.width, f.height, frameOpts);
    }
  });

  encoder.finish();
  return encoder.bytes();
}

/**
 * 压缩 GIF 入口
 */
export async function compressGif(
  file: File,
  options: CompressGifOptions
): Promise<{
  blob: Blob;
  originalSize: number;
  compressedSize: number;
  frameCount: number;
  width: number;
  height: number;
}> {
  if (file.type !== "image/gif") {
    throw new AppError("UNSUPPORTED_FORMAT", "仅支持 GIF 文件");
  }

  const { frames, width, height } = await parseGifFrames(file);
  // 帧过滤：丢帧（按目标 FPS）+ 合并连续重复帧
  const filtered = filterFrames(frames, {
    targetFps: options.targetFps,
    mergeDuplicates: options.mergeDuplicates,
  });
  const bytes = encodeGif(filtered, options);

  // bytes 是 Uint8Array<ArrayBufferLike>，与 BlobPart 的 Uint8Array<ArrayBuffer> 不兼容
  // 复制到新 buffer 确保类型严格匹配
  const buf = new Uint8Array(bytes);
  const blob = new Blob([buf], { type: "image/gif" });
  return {
    blob,
    originalSize: file.size,
    compressedSize: blob.size,
    frameCount: filtered.length,
    width,
    height,
  };
}
