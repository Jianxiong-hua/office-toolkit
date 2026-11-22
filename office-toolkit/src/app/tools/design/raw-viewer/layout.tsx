import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "RAW 图查看",
  description:
    "在线查看裸像素 Bayer RAW 数据：指定宽高、位深、字节序与排列，按线性 / gamma 2.2 / sRGB 映射到 8 位后用 Malvar-He-Cutler 去马赛克，支持单张预览与批量导出 PNG。全部在浏览器本地完成，数据不上传。",
  keywords: [
    "RAW 查看",
    "Bayer",
    "RAW 转 PNG",
    "去马赛克",
    "demosaic",
    "10bit RAW",
    "ISP 调试",
  ],
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
