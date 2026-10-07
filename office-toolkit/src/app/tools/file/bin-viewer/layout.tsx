import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "二进制查看器",
  description:
    "在线查看二进制文件内容：Hex 字节与 ASCII 字符双栏显示，每行字节数 8/16/24/32 可调，支持偏移跳转、字节搜索与大小端数值解释。所有处理在浏览器本地完成，文件不会上传到服务器。",
  keywords: [
    "二进制查看",
    "Hex查看",
    "hexdump",
    "字节查看",
    "二进制文件",
    "在线二进制",
  ],
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
