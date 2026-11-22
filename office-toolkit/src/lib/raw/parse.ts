/** 裸像素（Bayer RAW）解析：ArrayBuffer → DN 数组 */

export type BitDepth = 8 | 10 | 12 | 14 | 16;
export type Endianness = "little" | "big";
/** 10/12/14 bit 存放在 16 bit 字里的对齐方式 */
export type BitAlignment = "lsb" | "msb";

export interface RawParams {
  width: number;
  height: number;
  depth: BitDepth;
  endianness: Endianness;
  alignment: BitAlignment;
}

export const BIT_DEPTHS: BitDepth[] = [8, 10, 12, 14, 16];

/** 像素上限：RGBA 输出 4 B/px，40 MP 时输出缓冲 160 MB */
export const MAX_PIXELS = 40_000_000;
/** 文件上限 */
export const MAX_FILE_BYTES = 200 * 1024 * 1024;

/** 8 bit 每像素 1 字节，其余每像素 2 字节（未打包形式） */
export function bytesPerPixel(depth: BitDepth): number {
  return depth <= 8 ? 1 : 2;
}

export function expectedByteLength(params: Pick<RawParams, "width" | "height" | "depth">): number {
  return params.width * params.height * bytesPerPixel(params.depth);
}

export type ParseRawResult = { ok: true; data: Uint16Array } | { ok: false; error: string };

/**
 * 解析裸像素缓冲。
 * 16 bit 字按字节序读，10/12/14 bit 再按对齐方式取有效位（16 bit 时对齐无意义）。
 */
export function parseRawBuffer(buffer: ArrayBuffer, params: RawParams): ParseRawResult {
  const { width, height, depth, endianness, alignment } = params;

  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return { ok: false, error: "宽和高必须是正整数" };
  }
  const pixels = width * height;
  if (pixels > MAX_PIXELS) {
    return {
      ok: false,
      error: `${(pixels / 1e6).toFixed(1)} MP 超过上限 ${MAX_PIXELS / 1e6} MP`,
    };
  }

  const bpp = bytesPerPixel(depth);
  const expected = pixels * bpp;
  if (buffer.byteLength !== expected) {
    const diff = buffer.byteLength - expected;
    return {
      ok: false,
      error: `文件 ${buffer.byteLength.toLocaleString()} 字节，期望 ${expected.toLocaleString()} 字节（${width}×${height}×${bpp}），${
        diff > 0 ? `多 ${diff.toLocaleString()}` : `少 ${(-diff).toLocaleString()}`
      } 字节`,
    };
  }

  const src = new Uint8Array(buffer);
  const data = new Uint16Array(pixels);

  if (bpp === 1) {
    for (let i = 0; i < pixels; i += 1) data[i] = src[i];
    return { ok: true, data };
  }

  const mask = (1 << depth) - 1;
  const shift = 16 - depth;
  const little = endianness === "little";
  for (let i = 0; i < pixels; i += 1) {
    const o = i * 2;
    const word = little ? src[o] | (src[o + 1] << 8) : (src[o] << 8) | src[o + 1];
    data[i] = alignment === "msb" ? (word >> shift) & mask : word & mask;
  }
  return { ok: true, data };
}
