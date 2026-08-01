import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "图片参数化裁剪",
  description:
    "免费在线参数化裁剪图片，拖动裁剪框或输入左上/右下坐标精确裁剪。所有处理在浏览器本地完成，保护隐私。",
  keywords: [
    "参数化裁剪",
    "图片裁剪",
    "坐标裁剪",
    "精确裁剪",
    "在线裁剪",
    "按坐标裁剪",
  ],
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
