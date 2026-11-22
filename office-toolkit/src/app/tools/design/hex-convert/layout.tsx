import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "进制与浮点转换",
  description:
    "在线十六进制、十进制、八进制、二进制互转，支持 IEEE 754 float32/float64 位域分解、位翻转与大小端字节串查看。所有计算在浏览器本地完成，数据不上传。",
  keywords: [
    "进制转换",
    "十六进制转十进制",
    "HEX 转换",
    "浮点数转换",
    "IEEE754",
    "float32",
    "大小端",
  ],
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
