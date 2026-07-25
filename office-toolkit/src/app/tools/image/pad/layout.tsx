import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "图片背景填充",
  description:
    "免费在线将图片等比居中或拉伸填充到目标画布尺寸，支持自定义背景色和证件照尺寸预设。",
  keywords: ["图片背景填充", "证件照", "图片填充", "背景色", "画布尺寸"],
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
