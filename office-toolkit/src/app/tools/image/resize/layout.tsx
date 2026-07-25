import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "图片缩放",
  description:
    "免费在线按像素或百分比缩放图片，支持锁定宽高比和批量处理。所有处理在浏览器本地完成，保护隐私。",
  keywords: ["图片缩放", "在线缩放", "调整图片大小", "图片尺寸", "批量缩放"],
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
