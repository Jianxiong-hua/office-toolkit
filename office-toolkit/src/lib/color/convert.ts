/**
 * 色值转换纯函数库
 *
 * 提供 HEX / RGB / HSL / HSV 之间的换算，供取色器工具使用。
 * 所有函数均为纯函数，便于测试。
 */

export interface Rgb {
  r: number; // 0-255
  g: number; // 0-255
  b: number; // 0-255
}

export interface Hsl {
  h: number; // 0-360
  s: number; // 0-100
  l: number; // 0-100
}

export interface Hsv {
  h: number; // 0-360
  s: number; // 0-100
  v: number; // 0-100
}

/** 将 0-255 的数字值四舍五入为整数 */
function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

/**
 * 解析 HEX 颜色字符串（支持 #RGB / #RRGGBB，可带或不带 #）
 * 非法输入返回 null。
 */
export function hexToRgb(hex: string): Rgb | null {
  if (typeof hex !== "string") return null;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const num = parseInt(h, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

/** RGB → HEX（输出 #RRGGBB，大写） */
export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) =>
    clampChannel(v).toString(16).padStart(2, "0").toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * RGB → HSL。
 * h: 0-360（四舍五入到 1 位小数），s/l: 0-100（四舍五入到 1 位小数）。
 */
export function rgbToHsl(r: number, g: number, b: number): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
        break;
    }
    h *= 60;
  }

  return {
    h: round1(h),
    s: round1(s * 100),
    l: round1(l * 100),
  };
}

/**
 * RGB → HSV。
 * h: 0-360（四舍五入到 1 位小数），s/v: 0-100（四舍五入到 1 位小数）。
 */
export function rgbToHsv(r: number, g: number, b: number): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  const v = max;

  let h = 0;
  let s = 0;

  if (d !== 0) {
    s = d / max;
    switch (max) {
      case rn:
        h = ((gn - bn) / d) % 6;
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
        break;
    }
    h *= 60;
    if (h < 0) h += 360;
  }

  return {
    h: round1(h),
    s: round1(s * 100),
    v: round1(v * 100),
  };
}

/**
 * HSV → RGB。
 * h: 0-360，s/v: 0-100。结果四舍五入到 0-255 整数。
 */
export function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const hn = normalizeHue(h) / 60;
  const sn = clamp01(s / 100);
  const vn = clamp01(v / 100);
  const c = vn * sn;
  const x = c * (1 - Math.abs((hn % 2) - 1));
  const m = vn - c;

  let r = 0;
  let g = 0;
  let b = 0;
  if (hn < 1) [r, g, b] = [c, x, 0];
  else if (hn < 2) [r, g, b] = [x, c, 0];
  else if (hn < 3) [r, g, b] = [0, c, x];
  else if (hn < 4) [r, g, b] = [0, x, c];
  else if (hn < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

/** 色相归一化到 [0,360) */
function normalizeHue(h: number): number {
  const m = h % 360;
  return m < 0 ? m + 360 : m;
}

/** clamp 到 [0,1] */
function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * 归一化 EyeDropper 返回的 HEX 字符串。
 * EyeDropper 返回 `#rrggbb`（小写），此处统一为小写 `#rrggbb` 输出。
 * 非法输入返回 null。
 */
export function parseSrgbHex(input: string): string | null {
  const rgb = hexToRgb(input);
  if (!rgb) return null;
  return `#${[rgb.r, rgb.g, rgb.b]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** 四舍五入到 1 位小数 */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
