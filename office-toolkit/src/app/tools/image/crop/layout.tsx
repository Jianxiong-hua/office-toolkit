import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "图片裁剪",
  description:
    "免费在线裁剪图片，支持自由裁剪、固定比例、旋转和翻转。所有处理在浏览器本地完成，保护隐私。",
  keywords: ["图片裁剪", "在线裁剪", "裁剪图片", "证件照裁剪", "固定比例裁剪"],
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
