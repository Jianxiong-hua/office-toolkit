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
    version: "1.6.0",
    date: "2026-08",
    title: "「图片快速裁剪」升级为「图像旋转、镜像、裁剪」，参数化裁剪支持批量",
    changes: [
      "支持批量处理：可连续拖入多张图片，一套旋转/镜像/裁剪参数一次应用到全部，结果可单张下载或打包下载 ZIP",
      "批量要求所有图片分辨率与第一张一致，不一致的图片会被忽略并提示具体分辨率",
      "旋转支持任意角度，最小分辨率 0.1°：滑块 + 数值输入 + ±0.1° / ±90° 快捷按钮，角度可循环",
      "修复旋转 90°/270° 时裁剪区域取错的问题：现在按「旋转后外接矩形」坐标系取像素，任意角度下输出与预览框所见一致",
      "裁剪比例新增「原始比例」与「自定义」：自定义可输入宽:高数值并实时显示比值",
      "缩放步进由 0.1 调整为 0.01，最大倍率提升至 5×，并降低滚轮缩放速度，放大缩小更平滑",
      "修复高倍缩放或极端自定义比例下裁剪框超出原图时输出被拉伸变形的问题，越界区域改为留白",
      "「图片参数化裁剪」同步支持批量：多张同分辨率图片共用一套裁剪坐标，一次裁剪全部并支持打包下载",
    ],
  },
  {
    version: "1.5.0",
    date: "2026-08",
    title: "颜色对比度检查 v3：HSV 比例派生 + 手动校验对",
    changes: [
      "校验结果改为手动添加「校验色彩对」：选择文字色与背景色，每对生成一张对比度色卡，自动计算 WCAG 对比度与评级",
      "颜色库支持鼠标拖拽调整顺序",
    ],
  },
  {
    version: "1.4.0",
    date: "2026-08",
    title: "颜色对比度检查升级：颜色库 + 多文字色分组 + 颜色联动",
    changes: [
      "重构为「颜色库」模型：每个颜色可勾选「作为文字颜色 / 作为背景颜色」，未勾选角色的颜色不参与校核",
      "颜色联动计算：支持将颜色链接到其他颜色，为 R/G/B 通道输入四则运算公式（如 R*0.8），源色变化时自动联动，并可防范循环引用",
      "支持颜色库按模板 CSV 导入：导入前询问是否先导出备份",
    ],
  },
  {
    version: "1.3.0",
    date: "2026-08",
    title: "新增「颜色对比度检查」工具与设计/计算分类",
    changes: [
      "新增「颜色对比度检查」：基于 WCAG 2.1 标准计算文字色与背景色的对比度与评级（AA/AAA）",
      "内置 29 种预置背景色，支持增删改、导入导出 JSON、按浅/中/深自动分组",
      "支持筛选（全部/有风险/待核验/已核验）、对比度排序、导出 CSV 报告",

    ],
  },
  {
    version: "1.2.0",
    date: "2026-08",
    title: "新增「取色器」工具",
    changes: [
      "新增「取色器」：可从图片、屏幕（Chrome/Edge）、调色板三种来源取色",
      "左右双区对比面板：两区各自取色并紧挨展示，方便直观对比颜色差异",
      "实时显示 HEX / RGB / HSL / HSV 四种色值，点击即可复制",
      "自动保存取色历史（刷新保留，关闭浏览器后清空），可点击历史色块复用",
    ],
  },
  {
    version: "1.1.3",
    date: "2026-08",
    title: "体验优化与 Bug 修复",
    changes: [
      "修复图片缩放问题：锁定宽高比时输入精确宽高，会因联动百分比取整导致输出尺寸不准，现改为缩放一律以宽/高为准",
      "图片压缩新增「重新选择」按钮，可一键清空文件重新上传",
      "统一各图片工具及 PDF 工具的「重新选择」按钮样式，交互更一致",
    ],
  },
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
