"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wrench } from "lucide-react";
import { siteConfig } from "@/config/site";

/**
 * 首页分类区块锚点。
 * 必须用绝对路径 `/#id`：写成 `#id` 时，从工具详情页（如 /tools/video/gif/）
 * 点击会被浏览器解析成「当前页 + 无效锚点」，根本不会回到首页
 */
const NAV_ITEMS = [
  { id: "image-tools", label: "图片工具" },
  { id: "pdf-tools", label: "PDF 工具" },
  { id: "design-tools", label: "设计/计算" },
  { id: "file-tools", label: "文档与文件" },
  { id: "video-tools", label: "视频工具" },
];

export function Header() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-gray-100 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-bold text-xl text-brand-600">
          <Wrench className="h-6 w-6" />
          浩匣工具/HaoXia Toolkit
        </Link>
        <nav className="hidden sm:flex items-center gap-6 text-sm">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.id}
              href={`/#${item.id}`}
              onClick={(e) => {
                // 已在首页：直接平滑滚到分类区块；
                // 在其他页面：交给浏览器整页导航，落地后由原生锚点定位
                if (pathname !== "/") return;
                e.preventDefault();
                document
                  .getElementById(item.id)
                  ?.scrollIntoView({ behavior: "smooth" });
                window.history.replaceState(null, "", `#${item.id}`);
              }}
              className="text-gray-600 hover:text-brand-600 transition-colors"
            >
              {item.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
