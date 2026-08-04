import type { Metadata } from "next";
import { ToolLayout } from "@/components/layout/ToolLayout";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: "更新历史",
  description: `${siteConfig.name}（${siteConfig.shortName}）的功能更新与变更记录。`,
};

interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  changes: string[];
}

const changelog: ChangelogEntry[] = [
  {
    version: "1.1.2",
    date: "2026-08",
    title: "PDF 合并「自动缩小图片文件」",
    changes: [
      "PDF 合并新增「自动缩小过大的图片文件」选项：勾选后图片会按所选 DPI 缩小到与 A4 页面等宽（高度等比缩放），再与 PDF 合并；不勾选则按原始尺寸嵌入",
      "目标 DPI 提供 72（595 px 宽）与 96（794 px 宽）二选一，专为电子版查看优化，标注不适合打印（打印通常需要 300 DPI）",
      "PDF 文件本身完全保留原样，不做任何处理",
    ],
  },
  {
    version: "1.1.1",
    date: "2026-08",
    title: "图片压缩支持 GIF 动态图",
    changes: [
      "图片压缩新增 GIF 格式支持，完整保留动画，可调节颜色数（8 / 16 / 32 / 64 / 128 / 256）",
      "增加「更新历史」页面，追溯工具更新历史",
    ],
  },
  {
    version: "1.1.0",
    date: "2026-08",
    title: "视觉布局优化和功能优化",
    changes: [
      "首页布局与视觉优化",
      "工具箱更名为「浩匣 / HaoXia」",
      "移除「修改 DPI」功能模块",
      "新增「图片扩展填充」：在原图四周扩展画布，支持按 4 边像素和画布尺寸 + 中心偏移两种模式",
      "「裁剪」更名为「图片快速裁剪」，并新增「图片参数化裁剪」：支持拖拽裁剪框或输入左上/右下坐标精确裁剪",
      "增加「关于我们」和「联系我们」页面",
    ],
  },
  {
    version: "1.0",
    date: "首发",
    title: "首发版本",
    changes: [
      "图片工具：图片压缩、格式转换、缩放、裁剪",
      "PDF 工具：PDF 合并、PDF 拆分、PDF 水印",
      "所有处理均在浏览器本地完成，文件不上传服务器",
      "无注册、无广告、无水印、永久免费",
    ],
  },
];

export default function ChangelogPage() {
  return (
    <ToolLayout
      title="更新历史"
      description="记录每一版的功能变化，方便你了解新增能力与改进点"
    >
      <div className="space-y-8">
        {changelog.map((entry) => (
          <section
            key={entry.version}
            className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-4">
              <span className="inline-flex items-center rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
                v{entry.version}
              </span>
              <h2 className="text-lg font-semibold text-gray-900">
                {entry.title}
              </h2>
              <span className="text-sm text-gray-400">{entry.date}</span>
            </div>
            <ul className="space-y-2 text-sm text-gray-600 leading-relaxed">
              {entry.changes.map((line, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-brand-500 mt-1.5 shrink-0">•</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </ToolLayout>
  );
}
