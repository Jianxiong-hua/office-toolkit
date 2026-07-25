import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "PDF 水印",
  description:
    "免费在线为 PDF 添加文字或图片水印，支持自定义位置、透明度、旋转。所有处理在浏览器本地完成。",
  keywords: ["PDF水印", "添加水印", "PDF加水印", "文字水印", "图片水印"],
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
