/**
 * EyeDropper API 类型声明（Chromium 系：Chrome / Edge）
 * 参考：https://developer.mozilla.org/en-US/docs/Web/API/EyeDropper
 * Safari / Firefox 不支持，需在运行时检测。
 */

interface EyeDropperResult {
  /** 取到的颜色，形如 #aabbcc（小写） */
  sRGBHex: string;
}

interface EyeDropper {
  open(options?: { signal?: AbortSignal }): Promise<EyeDropperResult>;
}

interface EyeDropperConstructor {
  new (): EyeDropper;
}

interface Window {
  EyeDropper?: EyeDropperConstructor;
}
