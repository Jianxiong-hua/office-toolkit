import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "文档对比",
  description:
    "打开查看 docx、txt、md 文档，或并排对比两份文档的行级差异，新增、删除、修改一目了然。所有处理在浏览器本地完成，文件不会上传到服务器。",
  keywords: ["文档对比","文档比较","diff","docx 对比","txt 对比","文本对比"],
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
