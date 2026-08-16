/**
 * WCAG 2.1 对比度计算与颜色分析纯函数库
 * 移植自独立工具 ColorCheck（Color_visibility_checker.html）
 */

import {
  hexToRgb as _hexToRgb,
  rgbToHex as _rgbToHex,
  type Rgb,
} from "./convert";

/* ============ 基础颜色转换（复用 convert.ts，内部封装） ============ */

/** HEX → RGB（返回 [r,g,b] 或 null），兼容原工具语义 */
export function hexToRgb(hex: string): [number, number, number] | null {
  const rgb = _hexToRgb(hex);
  return rgb ? [rgb.r, rgb.g, rgb.b] : null;
}

/** RGB → HEX（#rrggbb 小写） */
export function rgbToHex(r: number, g: number, b: number): string {
  return _rgbToHex(r, g, b).toLowerCase();
}

/* ============ WCAG 相对亮度与对比度 ============ */

/** sRGB 通道线性化（WCAG 2.1 标准） */
export function channelLinear(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** 相对亮度 L ∈ [0,1]，按人眼感知灵敏度加权 */
export function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb;
  return (
    0.2126 * channelLinear(r) +
    0.7152 * channelLinear(g) +
    0.0722 * channelLinear(b)
  );
}

/** WCAG 对比度，只按亮度大小区分前后景，结果 ∈ [1,21] */
export function contrastRatio(
  fgRgb: [number, number, number],
  bgRgb: [number, number, number]
): number {
  const l1 = luminance(fgRgb);
  const l2 = luminance(bgRgb);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/* ============ 色相分桶 ============ */

export interface Bucket {
  key: string;
  name: string;
  hue: [number, number];
  hue2?: [number, number];
  special?: boolean;
}

export const BUCKETS: Bucket[] = [
  { key: "red", name: "红", hue: [340, 360], hue2: [0, 15] },
  { key: "orange", name: "橙", hue: [15, 45] },
  { key: "yellow", name: "黄", hue: [45, 75] },
  { key: "green", name: "绿", hue: [75, 165] },
  { key: "cyan", name: "青", hue: [165, 200] },
  { key: "blue", name: "蓝", hue: [200, 265] },
  { key: "purple", name: "紫", hue: [265, 340] },
  { key: "neutral", name: "中性", hue: [0, 360], special: true },
];

export const BUCKET_MAP: Record<string, string> = Object.fromEntries(
  BUCKETS.map((b) => [b.key, b.name])
);

/** 简单 RGB→HSL（返回 [h,s,l]），供分桶使用 */
export function rgbToHslRaw([r, g, b]: [number, number, number]): [
  number,
  number,
  number
] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
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
  return [h, s, l];
}

/** 色相分桶：饱和度 < 0.12 归中性，否则按色相范围归类 */
export function hueBucket(rgb: [number, number, number]): string {
  const [h, s] = rgbToHslRaw(rgb);
  if (s < 0.12) return "neutral";
  for (const b of BUCKETS) {
    if (b.special) continue;
    if (b.hue2 && (h >= b.hue[0] || h < b.hue2[1])) return b.key;
    if (h >= b.hue[0] && h < b.hue[1]) return b.key;
  }
  return "neutral";
}

/* ============ WCAG 评级 ============ */

export type Mode = "normal" | "large";

export type Filter = "all" | "risk" | "pending" | "done";

/** 所需对比度阈值 */
export const WCAG_NEED = (mode: Mode): number => (mode === "large" ? 3 : 4.5);

export type Level = "AAA" | "AA" | "LARGE" | "FAIL";

export function wcagLevel(ratio: number, mode: Mode): Level {
  if (mode === "large")
    return ratio >= 4.5 ? "AAA" : ratio >= 3 ? "AA" : "FAIL";
  return ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : ratio >= 3 ? "LARGE" : "FAIL";
}

/* ============ 经验学习引擎 ============ */

export interface FeedbackItem {
  score: number; // 1-4
  ratio: number;
  ts: number;
}
export type FeedbackMap = Record<string, FeedbackItem[]>;

export interface BucketExperience {
  thresh: number | null;
  n: number;
  failN: number;
  worstFailRatio: number;
  samples?: number;
}

export const SCORE_META: Record<number, { label: string; short: string }> = {
  4: { label: "清晰", short: "清晰" },
  3: { label: "可读", short: "可读" },
  2: { label: "勉强", short: "勉强" },
  1: { label: "不可读", short: "失败" },
};

/** 反馈 key：fg|bg（全小写） */
export const fbKey = (fg: string, bg: string): string =>
  fg.toLowerCase() + "|" + bg.toLowerCase();

/** 背景色分桶 */
export function bucketOfBg(hex: string): string {
  const rgb = hexToRgb(hex);
  return rgb ? hueBucket(rgb) : "neutral";
}

/**
 * 每桶经验安全阈值：
 * 收集桶内所有「感知不达标」(score<=2) 的核验点，取最大对比度 + 0.25 缓冲 作为安全线。
 * 至少 1 次失败即学习；否则样本 >=3 且有失败也学习；否则回退 WCAG 阈值（thresh=null）。
 *
 * v2 中 feedback key 为 `fgId|bgId`（颜色 id），背景部分不是 hex，
 * 需通过 resolveBgRgb 回调将 bg 标识解析为 RGB；未提供时按 hex 兼容 v1。
 */
export function bucketExperience(
  feedback: FeedbackMap,
  resolveBgRgb?: (bgKey: string) => [number, number, number] | null
): Record<string, BucketExperience> {
  const out: Record<string, BucketExperience> = {};
  for (const b of BUCKETS) {
    out[b.key] = { thresh: null, n: 0, failN: 0, worstFailRatio: 0 };
  }
  for (const [key, arr] of Object.entries(feedback)) {
    const [, bgKey] = key.split("|");
    let bgRgb: [number, number, number] | null = null;
    if (resolveBgRgb) {
      bgRgb = resolveBgRgb(bgKey);
    } else {
      bgRgb = hexToRgb(bgKey);
    }
    if (!bgRgb) continue;
    const bk = hueBucket(bgRgb);
    for (const fb of arr) {
      out[bk].n++;
      if (fb.score <= 2) {
        out[bk].failN++;
        out[bk].worstFailRatio = Math.max(out[bk].worstFailRatio, fb.ratio || 0);
      }
    }
  }
  for (const b of BUCKETS) {
    const o = out[b.key];
    if (o.failN >= 1) {
      o.thresh = o.worstFailRatio + 0.25;
      o.samples = o.failN;
    } else if (o.n >= 3 && o.worstFailRatio > 0) {
      o.thresh = o.worstFailRatio + 0.25;
    }
  }
  return out;
}

/* ============ 数据模型 ============ */

export interface BgItem {
  id: string;
  name: string;
  hex: string;
  group: "light" | "mid" | "dark";
}

export type CvdType = "none" | "protanopia" | "deuteranopia" | "tritanopia";

export interface ColorCheckState {
  fgHex: string;
  mode: Mode;
  sampleIdx: number;
  cvd: CvdType;
  sortAsc: boolean;
  filter: "all" | "risk" | "pending" | "done";
  bgs: BgItem[];
  feedback: FeedbackMap;
}

/* ============ 预置数据 ============ */

export const PRESET_BGS: Omit<BgItem, "id">[] = [
  { name: "纯白", hex: "#FFFFFF", group: "light" },
  { name: "暖米白", hex: "#FAF7F2", group: "light" },
  { name: "冷灰白", hex: "#F2F4F7", group: "light" },
  { name: "浅灰", hex: "#E5E7EB", group: "light" },
  { name: "浅黄", hex: "#FFF3C4", group: "light" },
  { name: "浅橙", hex: "#FFE6CF", group: "light" },
  { name: "浅粉", hex: "#FDE2E4", group: "light" },
  { name: "浅红", hex: "#F9D9D9", group: "light" },
  { name: "浅紫", hex: "#EBE0F6", group: "light" },
  { name: "浅蓝", hex: "#DCEAF7", group: "light" },
  { name: "浅青", hex: "#D8F0EE", group: "light" },
  { name: "浅绿", hex: "#DFF1E1", group: "light" },
  { name: "中灰", hex: "#9AA0A8", group: "mid" },
  { name: "石板蓝", hex: "#5B6B7F", group: "mid" },
  { name: "棕褐", hex: "#8B6F57", group: "mid" },
  { name: "橄榄", hex: "#7A7A52", group: "mid" },
  { name: "砖红", hex: "#B5493A", group: "mid" },
  { name: "酒红", hex: "#A94442", group: "mid" },
  { name: "靛蓝", hex: "#3E5C8A", group: "mid" },
  { name: "森林绿", hex: "#3E7A54", group: "mid" },
  { name: "紫罗兰", hex: "#6B4F8A", group: "mid" },
  { name: "赭石", hex: "#C45A22", group: "mid" },
  { name: "青蓝", hex: "#2F6F7A", group: "mid" },
  { name: "炭黑", hex: "#1E2126", group: "dark" },
  { name: "深灰", hex: "#3A3F47", group: "dark" },
  { name: "藏蓝", hex: "#24344D", group: "dark" },
  { name: "墨绿", hex: "#1F3D2E", group: "dark" },
  { name: "深紫红", hex: "#3D1F2B", group: "dark" },
  { name: "深棕", hex: "#33241A", group: "dark" },
];

export const FG_PRESETS: { name: string; hex: string }[] = [
  { name: "墨黑", hex: "#20242C" },
  { name: "深灰", hex: "#555B66" },
  { name: "中灰", hex: "#767C87" },
  { name: "纯白", hex: "#FFFFFF" },
  { name: "浅灰", hex: "#D6D9DF" },
  { name: "品牌蓝", hex: "#2E4FA3" },
  { name: "警示红", hex: "#C02B2B" },
];

export const SAMPLE_SETS: { label: string; main: string; sub: string }[] = [
  { label: "示例", main: "中文字样可见性", sub: "说明文字 · secondary 14px" },
  { label: "英文", main: "Aa Bb 可见性 Check", sub: "Body copy · 14px" },
  { label: "数字", main: "0123456789 4.5:1", sub: "统计数字 · tabular-nums" },
];

export const COLOR_TEMPLATES: { name: string; colors: [string, string][] }[] = [
  {
    name: "基础色板",
    colors: [
      ["纯红", "#E53935"], ["朱橙", "#FB8C00"], ["金黄", "#FDD835"], ["橄榄", "#9E9D24"],
      ["草绿", "#43A047"], ["青绿", "#00897B"], ["天蓝", "#1E88E5"], ["靛蓝", "#3949AB"],
      ["紫罗兰", "#8E24AA"], ["品红", "#D81B60"], ["棕褐", "#6D4C41"], ["蓝灰", "#546E7A"],
    ],
  },
  {
    name: "品牌常用",
    colors: [
      ["微信绿", "#07C160"], ["飞书蓝", "#3370FF"], ["天猫红", "#FF5000"], ["京东红", "#E1251B"],
      ["淘宝橙", "#FF4400"], ["B站粉", "#FB7299"], ["知乎蓝", "#0084FF"], ["豆瓣绿", "#007722"],
      ["墨黑", "#20242C"], ["炭灰", "#555B66"], ["纸白", "#FAF7F2"], ["雾灰", "#E5E7EB"],
    ],
  },
  {
    name: "中性色阶",
    colors: [
      ["白", "#FFFFFF"], ["灰50", "#FAFAFA"], ["灰100", "#F5F5F5"], ["灰200", "#EEEEEE"],
      ["灰300", "#E0E0E0"], ["灰400", "#BDBDBD"], ["灰500", "#9E9E9E"], ["灰600", "#757575"],
      ["灰700", "#616161"], ["灰800", "#424242"], ["灰900", "#212121"], ["黑", "#000000"],
    ],
  },
];

/* ============ 默认状态 ============ */

export function createDefaultState(): ColorCheckState {
  return {
    fgHex: "#20242C",
    mode: "normal",
    sampleIdx: 0,
    cvd: "none",
    sortAsc: true,
    filter: "all",
    bgs: PRESET_BGS.map((b, i) => ({ id: "bg" + (i + 1), ...b })),
    feedback: {},
  };
}
