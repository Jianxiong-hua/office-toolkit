import type { ToolMeta } from "./site";

export const tools: ToolMeta[] = [
  // --- 图片工具 ---
  {
    id: "image-compress",
    name: "图片压缩",
    description: "在线压缩 PNG/JPG/WebP 图片，支持批量处理，自定义压缩质量",
    category: "image",
    path: "/tools/image/compress/",
    icon: "ImageMinus",
    tags: ["压缩", "图片", "JPG", "PNG", "WebP"],
    featured: true,
  },
  {
    id: "image-convert",
    name: "格式转换",
    description: "图片格式互转，JPG ↔ PNG ↔ WebP ↔ BMP，一键转换",
    category: "image",
    path: "/tools/image/convert/",
    icon: "ArrowLeftRight",
    tags: ["转换", "格式", "图片"],
  },
  {
    id: "image-resize",
    name: "图片缩放",
    description: "按像素或百分比缩放图片，支持锁定宽高比和批量处理",
    category: "image",
    path: "/tools/image/resize/",
    icon: "Maximize",
    tags: ["缩放", "尺寸", "图片"],
  },
  {
    id: "image-crop",
    name: "图片快速裁剪",
    description: "5 种固定比例，支持旋转、翻转，快速选定裁剪区域",
    category: "image",
    path: "/tools/image/crop/",
    icon: "Crop",
    tags: ["裁剪", "图片", "尺寸"],
    featured: true,
  },
  {
    id: "image-pad",
    name: "图片扩展填充",
    description: "在原图四周扩展画布，支持按 4 边像素或画布尺寸 + 中心偏移两种模式",
    category: "image",
    path: "/tools/image/pad/",
    icon: "Image",
    tags: ["填充", "扩展", "Padding", "图片"],
  },

  // --- PDF 工具 ---
  {
    id: "pdf-merge",
    name: "PDF 合并",
    description: "将多个 PDF 文件合并为一个，支持拖拽排序，自由调整页面顺序",
    category: "pdf",
    path: "/tools/pdf/merge/",
    icon: "Combine",
    tags: ["合并", "PDF", "组合"],
    featured: true,
  },
  {
    id: "pdf-split",
    name: "PDF 拆分",
    description: "按页码范围、每 N 页或单页提取拆分 PDF 文件",
    category: "pdf",
    path: "/tools/pdf/split/",
    icon: "SplitSquareVertical",
    tags: ["拆分", "PDF", "提取"],
  },
  {
    id: "pdf-watermark",
    name: "PDF 水印",
    description: "为 PDF 添加文字或图片水印，支持自定义位置、透明度、旋转",
    category: "pdf",
    path: "/tools/pdf/watermark/",
    icon: "Stamp",
    tags: ["水印", "PDF", "文字", "图片"],
    featured: true,
  },
];

export const toolsByCategory = {
  image: tools.filter((t) => t.category === "image"),
  pdf: tools.filter((t) => t.category === "pdf"),
};

export const getToolById = (id: string) => tools.find((t) => t.id === id);
