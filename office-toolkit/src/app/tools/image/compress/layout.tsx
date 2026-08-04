import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "图片压缩",
  description:
    "免费在线压缩 PNG/JPG/WebP/GIF 图片，支持批量处理和自定义压缩质量，完整支持保留 GIF 动画。所有处理在浏览器本地完成，保护隐私。",
  keywords: [
    "图片压缩",
    "在线压缩",
    "PNG压缩",
    "JPG压缩",
    "WebP压缩",
    "GIF压缩",
    "动画GIF",
    "表情包压缩",
    "批量压缩",
  ],
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
