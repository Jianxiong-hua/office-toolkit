import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "图片编辑",
  description:
    "在线编辑图片：在图片上画线、画框做标注，调节亮度、对比度、色温、色调，导出保持原始像素尺寸。所有处理在浏览器本地完成，文件不会上传到服务器。",
  keywords: [
    "图片编辑",
    "图片标注",
    "画框",
    "亮度调整",
    "对比度",
    "色温",
    "在线修图",
  ],
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
