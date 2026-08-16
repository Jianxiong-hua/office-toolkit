import type { Metadata } from "next";
import { ToolLayout } from "@/components/layout/ToolLayout";
import { siteConfig } from "@/config/site";
import { Shield, Zap, Heart } from "lucide-react";

export const metadata: Metadata = {
  title: "关于",
  description:
    `${siteConfig.name}（${siteConfig.shortName}）是一款免费在线 PDF、图片与设计工具，所有处理均在浏览器本地完成，无需上传文件，保护你的隐私。`,
};

export default function AboutPage() {
  return (
    <ToolLayout
      title="关于我们"
      description={`${siteConfig.name} · ${siteConfig.shortName} Office Toolkit`}
    >
      <div className="space-y-10">
        {/* 项目介绍 */}
        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">项目介绍</h2>
          <p className="text-gray-600 leading-relaxed">
            {siteConfig.name}（{siteConfig.shortName}）是一个免费、无广告的在线办公工具集，
            专注提供日常最常用的 PDF、图片与设计处理能力：
            PDF 合并、拆分、水印；图片压缩、格式转换、裁剪、缩放、扩展填充；
            以及取色器、颜色对比度检查等图像设计/计算工具。
            所有功能完全在浏览器中本地运行，文件不会上传到任何服务器。
          </p>
        </section>

        {/* 设计原则 */}
        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-3">设计原则</h2>
          <ul className="grid gap-3 sm:grid-cols-3">
            <li className="rounded-xl border border-gray-100 bg-white p-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-100 mb-2">
                <Shield className="h-5 w-5 text-green-600" />
              </div>
              <p className="font-medium text-gray-900 text-sm">本地处理</p>
              <p className="mt-1 text-xs text-gray-500">文件不出浏览器，关页即清空</p>
            </li>
            <li className="rounded-xl border border-gray-100 bg-white p-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-yellow-100 mb-2">
                <Zap className="h-5 w-5 text-yellow-600" />
              </div>
              <p className="font-medium text-gray-900 text-sm">打开即用</p>
              <p className="mt-1 text-xs text-gray-500">无需注册、登录、付费</p>
            </li>
            <li className="rounded-xl border border-gray-100 bg-white p-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-pink-100 mb-2">
                <Heart className="h-5 w-5 text-pink-600" />
              </div>
              <p className="font-medium text-gray-900 text-sm">永久免费</p>
              <p className="mt-1 text-xs text-gray-500">无水印、无次数限制</p>
            </li>
          </ul>
        </section>

        {/* 联系方式 */}
        <section id="contact" className="scroll-mt-20">
          <h2 className="text-xl font-semibold text-gray-900 mb-3">联系我们</h2>
          <p className="text-gray-600 leading-relaxed">
            有功能建议、遇到问题、或者只想打个招呼？欢迎通过以下邮箱与我们联系：
          </p>
          <p className="mt-4 text-lg font-medium text-gray-900 select-all">
            hjx0827@foxmail.com
          </p>
          <p className="mt-3 text-xs text-gray-400">
            请复制上面的邮箱地址，发邮件与我们联系。
          </p>
        </section>
      </div>
    </ToolLayout>
  );
}
