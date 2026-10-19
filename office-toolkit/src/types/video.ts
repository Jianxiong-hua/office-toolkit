/** 视频压缩质量档位（映射到 x264/VP9 的 CRF 值） */
export type VideoQualityPreset = "high" | "standard" | "strong";

/** 压缩输出容器/编码 */
export type VideoOutputFormat = "mp4" | "webm";

/** x264 编码速度 preset */
export type VideoEncodePreset =
  | "ultrafast"
  | "veryfast"
  | "fast"
  | "medium"
  | "slow"
  | "veryslow";

/** 分辨率缩放档位 */
export type VideoResolution = "original" | "1080p" | "720p" | "480p";

export interface VideoCompressOptions {
  quality: VideoQualityPreset;
  resolution: VideoResolution;
  format: VideoOutputFormat;
  /** 倍速：0.5 ~ 2，1 = 原速 */
  speed: number;
  preset: VideoEncodePreset;
  /** 截取开始时间（秒），0 = 片头 */
  trimStart: number;
  /** 截取结束时间（秒），null = 到片尾 */
  trimEnd: number | null;
}

export interface VideoCompressResult {
  blob: Blob;
  originalSize: number;
  outputSize: number;
  filename: string;
}

/** GIF 循环方式 */
export type GifLoopMode = "infinite" | "once";

export interface VideoGifOptions {
  trimStart: number;
  trimEnd: number | null;
  /** 帧率 fps */
  fps: number;
  /** 输出宽度（px），高度等比 */
  width: number;
  /** 最大颜色数 */
  maxColors: 32 | 64 | 128 | 255;
  loop: GifLoopMode;
  /** 倍速：0.5 ~ 2，1 = 原速 */
  speed: number;
}

export interface VideoGifResult {
  blob: Blob;
  originalSize: number;
  outputSize: number;
  filename: string;
  width: number;
  height: number;
  frameCount: number;
}

/** 视频元信息（由 <video> 元素读取） */
export interface VideoMeta {
  /** 时长（秒）；无法解析时为 0 */
  duration: number;
  width: number;
  height: number;
}

/**
 * 转换阶段（用于进度展示）：
 * - analyzing：尚无输出帧（如 GIF 的 palettegen 需统计全片后才出第一帧）
 * - encoding：帧正在量化编码，progress 持续推进
 * - writing：ffmpeg 已执行完，正在写文件/读回结果
 */
export type VideoConvertPhase = "analyzing" | "encoding" | "writing";
