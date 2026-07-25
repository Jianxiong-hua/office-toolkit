import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "PDF 拆分",
  description:
    "免费在线按页码范围、每 N 页或单页提取拆分 PDF 文件。所有处理在浏览器本地完成，文件不会上传到服务器。",
  keywords: ["PDF拆分", "拆分PDF", "PDF提取", "PDF页面拆分", "在线PDF拆分"],
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
