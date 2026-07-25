import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "图片格式转换",
  description:
    "免费在线图片格式互转，支持 JPG、PNG、WebP、BMP 格式转换。所有处理在浏览器本地完成，保护隐私。",
  keywords: ["图片格式转换", "JPG转PNG", "PNG转WebP", "BMP转换", "在线转换"],
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
