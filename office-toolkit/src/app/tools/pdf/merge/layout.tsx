import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "PDF 合并",
  description:
    "免费在线合并多个 PDF 文件为一个，支持调整页面顺序。所有处理在浏览器本地完成，文件不会上传到服务器。",
  keywords: ["PDF合并", "合并PDF", "PDF组合", "在线PDF合并", "免费PDF合并"],
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
