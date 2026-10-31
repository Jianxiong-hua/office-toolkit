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
  /** 处理耗时（毫秒，从读取元信息到产出） */
  elapsedMs?: number;
  /** 本次处理的片段占完整时长的比例（1 或缺失 = 全片）：用于按同长度比较体积 */
  segmentRatio?: number;
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
  /** 处理耗时（毫秒，从点击转换到产出） */
  elapsedMs?: number;
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

/* ---------------- 视频提取图片 ---------------- */

/** 导出图片格式（WebP 不做：Safari 上 convertToBlob 会静默回退成 PNG） */
export type FrameImageFormat = "jpeg" | "png";

export interface ExtractFramesOptions {
  /** 截取起点（秒） */
  trimStart: number;
  /** 截取终点（秒），null = 到片尾 */
  trimEnd: number | null;
  /** 每隔 N 帧取 1 张；跨步 = N+1，0 = 每帧 */
  everyNFrames: number;
  format: FrameImageFormat;
  /** JPEG 质量 0.5~1，仅 format=jpeg 生效 */
  quality: number;
}

/** 单张图片的落地方式：目录写入或塞进 ZIP，由页面决定 */
export interface FrameSink {
  /** 保存第 index 张（从 1 开始，连续编号） */
  save: (index: number, blob: Blob) => Promise<void>;
}

export interface ExtractFramesResult {
  /** 实际导出张数 */
  count: number;
  /** 所有图片的字节数之和 */
  totalBytes: number;
  /** 引擎：WebCodecs 快路径 / ffmpeg 兼容路径 */
  engine: ExtractEngine;
  /** 输出文件夹名（`{视频名}_frames` 或带 -2 后缀的实际名） */
  folderName: string;
  elapsedMs: number;
}

export type ExtractEngine = "fast" | "compat";

/** 快路径的视频帧统计（用于导出前精确预估张数） */
export interface VideoFrameStats {
  /** 视频轨总帧数 */
  totalFrames: number;
  /** 平均帧率（帧/秒），用于按截取区间估算；0 = 无法推算 */
  fps: number;
}

/* ---------------- 图片合成视频 ---------------- */

/**
 * 节奏模式：
 * - duration：每张图停留 N 秒（幻灯片）
 * - frame：每张图正好占 1 帧（与「视频提取图片」互为逆运算）
 */
export type ImagesVideoMode = "duration" | "frame";

/** 单张图与画布的适配方式：contain = 等比缩放留黑边，cover = 等比缩放居中裁切 */
export type ImagesFitMode = "contain" | "cover";

/** 输出尺寸档位：original = 以第一张图的尺寸为准 */
export type ImagesOutputSize = "original" | "1080p" | "720p" | "480p";

/**
 * 画质档位（映射到目标码率）。
 * H.264 只能有损编码，静态画面若按视频的低码率给，细节会糊成一片，
 * 所以默认给「高」：1080p30 约 7.5 Mbps。
 */
export type ImagesVideoQuality = "veryhigh" | "high" | "standard" | "small";

export interface ImagesToVideoOptions {
  mode: ImagesVideoMode;
  /** 模式一：每张停几秒 */
  secondsPerImage: number;
  fps: number;
  size: ImagesOutputSize;
  fit: ImagesFitMode;
  quality: ImagesVideoQuality;
}

export interface ImagesToVideoResult {
  /** 流式写盘时为空（文件已在磁盘上） */
  blob?: Blob;
  filename: string;
  width: number;
  height: number;
  frameCount: number;
  durationSec: number;
  elapsedMs: number;
  /** 实际使用的视频码率（bps），便于判断画质档位是否生效 */
  bitrate: number;
  /** 是否直接写入了用户选择的文件 */
  savedToDisk: boolean;
}

/* ---------------- 视频极速压缩（WebCodecs） ---------------- */

/** 极速压缩质量档位（WebCodecs 无 CRF，按 bpp 反推码率） */
export type FastQualityPreset = "high" | "standard" | "strong";

export interface VideoFastCompressOptions {
  quality: FastQualityPreset;
  resolution: VideoResolution;
  trimStart: number;
  /** null = 到片尾 */
  trimEnd: number | null;
  /** 倍速：0.5 ~ 2，1 = 原速。≠1 时输出无音轨（remux 无法变速） */
  speed: number;
}

export interface VideoFastCompressResult {
  blob: Blob;
  originalSize: number;
  outputSize: number;
  filename: string;
  /** 输出宽高（已烘焙旋转） */
  width: number;
  height: number;
  fps: number;
  /** 是否保留音轨 */
  hasAudio: boolean;
  /** 实际使用的视频码率（bps） */
  bitrate: number;
  /** 处理耗时（毫秒，从进入到产出，含失败重试） */
  elapsedMs: number;
}
