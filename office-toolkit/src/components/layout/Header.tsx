import Link from "next/link";
import { Wrench } from "lucide-react";
import { siteConfig } from "@/config/site";

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-gray-100 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-bold text-xl text-brand-600">
          <Wrench className="h-6 w-6" />
          浩匣工具/HaoXia Toolkit
        </Link>
        <nav className="hidden sm:flex items-center gap-6 text-sm">
          <Link href="#image-tools" className="text-gray-600 hover:text-brand-600 transition-colors">
            图片工具
          </Link>
          <Link href="#pdf-tools" className="text-gray-600 hover:text-brand-600 transition-colors">
            PDF 工具
          </Link>
        </nav>
      </div>
    </header>
  );
}
