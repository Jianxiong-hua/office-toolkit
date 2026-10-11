/**
 * 图像调整的像素级处理（纯函数）。
 *
 * 预览与导出**必须共用本函数**，这是「所见即所得」的根基——
 * 不采用 CSS filter 预览 + canvas 导出的两套算法（CSS 无「色温」，且两套实现必然漂移）。
 *
 * 四个参数按固定顺序生效：亮度 → 对比度 → 色温 → 色调。
 * 顺序影响结果（如 contrast 与 temperature 不可交换），因此写死在此处，调用方无感知。
 */

export interface AdjustParams {
  /** 0–200，100 = 原图 */
  brightness: number;
  /** 0–200，100 = 原图 */
  contrast: number;
  /** −100（灰度）~ +100（2× 鲜艳），0 = 原图 */
  saturation: number;
  /** −100（冷）~ +100（暖），0 = 原图 */
  temperature: number;
  /** −100（绿）~ +100（品红），0 = 原图 */
  tint: number;
}

export const DEFAULT_ADJUST: AdjustParams = {
  brightness: 100,
  contrast: 100,
  saturation: 0,
  temperature: 0,
  tint: 0,
};

function isDefault(p: AdjustParams): boolean {
  return (
    p.brightness === 100 &&
    p.contrast === 100 &&
    p.saturation === 0 &&
    p.temperature === 0 &&
    p.tint === 0
  );
}

/** 显式 round + clamp。不能用 Uint8ClampedArray 的隐式行为：它按「四舍六入五取偶」舍入（10.5 → 10） */
function clamp255(v: number): number {
  const r = Math.round(v);
  return r < 0 ? 0 : r > 255 ? 255 : r;
}

/**
 * 对 ImageData 原地应用调整并返回同一引用。
 * 四参数全为默认值时直接返回入参，不做任何像素循环。
 */
export function adjustPixels(imageData: ImageData, p: AdjustParams): ImageData {
  if (isDefault(p)) return imageData;

  const data = imageData.data;
  const b = p.brightness / 100;
  const c = p.contrast / 100;
  const s = 1 + p.saturation / 100;
  const t = p.temperature / 100;
  const u = p.tint / 100;

  for (let i = 0; i < data.length; i += 4) {
    // 1. 亮度
    let r = clamp255(data[i] * b);
    let g = clamp255(data[i + 1] * b);
    let bl = clamp255(data[i + 2] * b);
    // 2. 对比度
    r = clamp255((r - 128) * c + 128);
    g = clamp255((g - 128) * c + 128);
    bl = clamp255((bl - 128) * c + 128);
    // 3. 饱和度：BT.601 加权灰度，向灰度/远离灰度双向拉伸（s=0 灰度，s=2 加倍鲜艳）
    const gray = 0.299 * r + 0.587 * g + 0.114 * bl;
    r = gray + (r - gray) * s;
    g = gray + (g - gray) * s;
    bl = gray + (bl - gray) * s;
    // 4. 色温：暖 = 红升蓝降（统一线性公式，t 为负即反向）
    r = clamp255(r * (1 + 0.3 * t));
    bl = clamp255(bl * (1 - 0.3 * t));
    // 5. 色调：品红 = 红升绿降
    r = clamp255(r * (1 + 0.2 * u));
    g = clamp255(g * (1 - 0.4 * u));
    // alpha 通道不参与调整
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = bl;
  }
  return imageData;
}
