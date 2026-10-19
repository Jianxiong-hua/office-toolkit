import { AppError } from "@/types";
import type { VideoMeta } from "@/types/video";

/**
 * 用 <video> 元素读取视频元信息（时长 / 宽高）。
 * 时长无法解析时（如部分 webm）返回 0，由调用方按「未知」处理。
 */
export function readVideoMeta(file: File): Promise<VideoMeta> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;

    const cleanup = () => URL.revokeObjectURL(url);

    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      cleanup();
      resolve({
        duration,
        width: video.videoWidth,
        height: video.videoHeight,
      });
    };
    video.onerror = () => {
      cleanup();
      reject(
        new AppError(
          "UNSUPPORTED_FORMAT",
          "无法读取该视频文件",
          "请确认文件未损坏，且为 MP4 / WebM / MOV / MKV 等常见格式"
        )
      );
    };

    video.src = url;
  });
}
