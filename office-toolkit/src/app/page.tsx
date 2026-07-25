import Link from "next/link";
import { ArrowRight, Image, FileText, Sparkles, Shield } from "lucide-react";
import { toolsByCategory, featuredTools } from "@/config/tools";
import { ToolCard } from "@/components/tools/ToolCard";

export default function HomePage() {
  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-50 via-white to-blue-50">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28 text-center">
          <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
            你的在线
            <span className="bg-gradient-to-r from-brand-600 to-blue-600 bg-clip-text text-transparent">
              办公工具箱
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-gray-500 leading-relaxed">
            PDF 合并拆分、图片压缩转换、AI 智能抠图 —— 全部在浏览器本地完成，
            文件不会上传到任何服务器，隐私安全，永久免费。
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="#image-tools"
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-3 text-white font-medium hover:bg-brand-700 transition-colors shadow-lg shadow-brand-200"
            >
              开始使用 <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="#pdf-tools"
              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-6 py-3 font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              查看全部工具
            </Link>
          </div>
          <div className="mt-10 flex items-center justify-center gap-6 text-sm text-gray-400">
            <span className="flex items-center gap-1.5">
              <Shield className="h-4 w-4 text-green-500" />
              隐私安全
            </span>
            <span className="flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-yellow-500" />
              无需注册
            </span>
          </div>
        </div>
      </section>

      {/* 精选工具 */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="text-center mb-10">
          <h2 className="text-2xl font-bold text-gray-900">🔥 热门工具</h2>
          <p className="mt-2 text-gray-500">最受欢迎的工具，一键开始使用</p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {featuredTools.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      </section>

      {/* 图片工具 */}
      <section id="image-tools" className="bg-gray-50 py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex items-center gap-3 mb-8">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-100">
              <Image className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900">图片工具</h2>
              <p className="text-sm text-gray-500">压缩、转换、裁剪、抠图，一站式处理</p>
            </div>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {toolsByCategory.image.map((tool) => (
              <ToolCard key={tool.id} tool={tool} />
            ))}
          </div>
        </div>
      </section>

      {/* PDF 工具 */}
      <section id="pdf-tools" className="py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex items-center gap-3 mb-8">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-100">
              <FileText className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900">PDF 工具</h2>
              <p className="text-sm text-gray-500">合并、拆分、水印，轻松管理 PDF</p>
            </div>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {toolsByCategory.pdf.map((tool) => (
              <ToolCard key={tool.id} tool={tool} />
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-gradient-to-r from-brand-600 to-blue-600 py-16">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">
            准备好提升办公效率了吗？
          </h2>
          <p className="mt-3 text-brand-100">
            所有工具免费使用，无需下载安装，打开浏览器就能用。
          </p>
          <Link
            href="#"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 font-medium text-brand-600 hover:bg-brand-50 transition-colors shadow-lg"
          >
            升级 Pro 解锁更多功能
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
