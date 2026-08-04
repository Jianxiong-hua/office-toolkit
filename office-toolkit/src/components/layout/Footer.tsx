import Link from "next/link";
import { Shield, Zap } from "lucide-react";
import { siteConfig } from "@/config/site";

export function Footer() {
  return (
    <footer className="border-t border-gray-100 bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-3">
          <div>
            <h3 className="font-semibold text-gray-900 mb-3">
              {siteConfig.name} <span className="text-gray-400 font-normal">/ {siteConfig.shortName}</span>
            </h3>
            <p className="text-sm text-gray-500 leading-relaxed">
              {siteConfig.description}
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 mb-3">特点</h3>
            <ul className="space-y-2 text-sm text-gray-500">
              <li className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-green-500" />
                数据不出浏览器
              </li>
              <li className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-yellow-500" />
                打开即用，无需注册
              </li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 mb-3">链接</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/" className="text-gray-500 hover:text-brand-600 transition-colors">
                  首页
                </Link>
              </li>
              <li>
                <Link href="/about" className="text-gray-500 hover:text-brand-600 transition-colors">
                  关于我们
                </Link>
              </li>
              <li>
                <Link href="/changelog" className="text-gray-500 hover:text-brand-600 transition-colors">
                  更新历史
                </Link>
              </li>
              <li>
                <Link href="/about#contact" className="text-gray-500 hover:text-brand-600 transition-colors">
                  联系我们
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-8 border-t border-gray-200 pt-6 text-center text-sm text-gray-400">
          © {new Date().getFullYear()} {siteConfig.name}. 保留所有权利。
        </div>
      </div>
    </footer>
  );
}
