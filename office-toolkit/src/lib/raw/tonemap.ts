/** DN → 8bit 的映射曲线（纯函数，无依赖） */

export type GammaMode = "linear" | "gamma22" | "srgb";

export const GAMMA_OPTIONS: { value: GammaMode; label: string }[] = [
  { value: "linear", label: "线性" },
  { value: "gamma22", label: "gamma 2.2" },
  { value: "srgb", label: "sRGB" },
];

/** 归一化值（0~1）经 gamma 编码后仍是 0~1 */
export function gammaEncode(x: number, mode: GammaMode): number {
  switch (mode) {
    case "gamma22":
      return Math.pow(x, 1 / 2.2);
    case "srgb":
      return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
    default:
      return x;
  }
}

/**
 * 建 DN → 8bit 查表，长度 2^depth。
 * 调用方负责先把越界 DN clamp 到 [0, 2^depth - 1]——MH-C 会插出负值和超量程值。
 */
export function buildLut(depth: number, mode: GammaMode): Uint8Array {
  const max = (1 << depth) - 1;
  const lut = new Uint8Array(max + 1);
  for (let dn = 0; dn <= max; dn += 1) {
    lut[dn] = Math.round(gammaEncode(dn / max, mode) * 255);
  }
  return lut;
}
