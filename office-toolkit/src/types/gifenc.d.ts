/**
 * gifenc 的最小类型声明（库本身不提供 .d.ts）
 * 文档：https://github.com/mattdesl/gifenc
 */

declare module "gifenc" {
  export type GifencFormat = "rgb565" | "rgb444" | "rgba4444";

  export interface QuantizeOptions {
    format?: GifencFormat;
    oneBitAlpha?: boolean | number;
    clearAlpha?: boolean;
    clearAlphaThreshold?: number;
    clearAlphaColor?: number;
  }

  /** 返回调色板：数组的数组 [r, g, b] 或 [r, g, b, a] */
  export type Palette = number[][];

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: QuantizeOptions
  ): Palette;

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: Palette,
    format?: GifencFormat
  ): Uint8Array;

  export interface FrameOptions {
    palette: Palette;
    transparent?: boolean;
    transparentIndex?: number;
    delay?: number; // ms
    repeat?: number; // 0 = forever
    dispose?: number; // 0..3
    first?: boolean;
  }

  export interface GIFEncoder {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options: FrameOptions
    ): void;
    finish(): void;
    bytes(): Uint8Array;
    /** Some versions also expose `reset()` and `read()` */
    reset?(): void;
    read?(): Uint8Array;
  }

  export function GIFEncoder(): GIFEncoder;
}
