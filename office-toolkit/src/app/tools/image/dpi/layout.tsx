import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "修改图片 DPI",
  description:
    "免费在线按目标 DPI 等效调整图片像素尺寸，适用于打印和证件照场景。所有处理在浏览器本地完成。",
  keywords: ["修改DPI", "图片DPI", "分辨率", "打印分辨率", "证件照DPI"],
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
