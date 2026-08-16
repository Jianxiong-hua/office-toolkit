import Link from "next/link";
import { ArrowRight, Image, FileText, Palette, Shield } from "lucide-react";
import { toolsByCategory } from "@/config/tools";
import { ToolCard } from "@/components/tools/ToolCard";

export default function HomePage() {
  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-50 via-white to-blue-50">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28 text-center">
          <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
            <span className="text-gray-900">免费在线</span>
            <span className="bg-gradient-to-r from-brand-600 to-blue-600 bg-clip-text text-transparent">
              办公工具箱
            </span>
          </h1>
          <p className="mx-auto mt-3 text-sm font-medium text-gray-400 tracking-widest uppercase">
            HaoXia Office Toolkit
          </p>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-gray-500 leading-relaxed">
            PDF 合并拆分加水印、图片压缩转换裁剪 —— 全部在浏览器本地完成，
            文件不会上传到任何服务器，隐私安全、永久免费。
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="#image-tools"
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-3 text-white font-medium hover:bg-brand-700 transition-colors shadow-lg shadow-brand-200"
            >
              开始使用 <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
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
              <p className="text-sm text-gray-500">压缩、转换、裁剪、缩放、填充</p>
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
              <p className="text-sm text-gray-500">合并、拆分、水印</p>
            </div>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {toolsByCategory.pdf.map((tool) => (
              <ToolCard key={tool.id} tool={tool} />
            ))}
          </div>
        </div>
      </section>

      {/* 图像设计/计算工具 */}
      <section id="design-tools" className="bg-gray-50 py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex items-center gap-3 mb-8">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-100">
              <Palette className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900">图像设计/计算工具</h2>
              <p className="text-sm text-gray-500">取色、对比度检查、颜色分析</p>
            </div>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {toolsByCategory.design.map((tool) => (
              <ToolCard key={tool.id} tool={tool} />
            ))}
          </div>
        </div>
      </section>

      {/* 隐私安全 */}
      <section className="bg-gradient-to-br from-gray-50 to-white py-16">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-green-100">
            <Shield className="h-7 w-7 text-green-600" />
          </div>
          <h2 className="mt-6 text-2xl font-bold text-gray-900">隐私安全</h2>
          <p className="mt-3 text-gray-500 leading-relaxed">
            所有文件处理都在你的浏览器中完成，不会上传到任何服务器。
            <br />
            处理完成后立即释放内存，关闭页面即彻底清除数据。
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3 text-sm text-gray-500">
            <div className="rounded-xl bg-white p-4 border border-gray-100">
              <p className="font-medium text-gray-900">本地处理</p>
              <p className="mt-1">文件不出浏览器</p>
            </div>
            <div className="rounded-xl bg-white p-4 border border-gray-100">
              <p className="font-medium text-gray-900">无追踪</p>
              <p className="mt-1">不收集任何文件</p>
            </div>
            <div className="rounded-xl bg-white p-4 border border-gray-100">
              <p className="font-medium text-gray-900">完全免费</p>
              <p className="mt-1">无广告、无水印</p>
            </div>
          </div>
        </div>
      </section>

      {/* 反馈入口 */}
      <section className="py-12">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 text-center">
          <p className="text-gray-500">
            有功能建议或遇到问题？
            <Link href="/about#contact" className="ml-1 text-brand-600 hover:underline">
              联系我们
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
