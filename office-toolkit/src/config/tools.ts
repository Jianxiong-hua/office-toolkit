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
    name: "图像旋转、镜像、裁剪",
    description: "任意角度旋转、镜像翻转、多比例裁剪，支持同分辨率图片批量处理",
    category: "image",
    path: "/tools/image/crop/",
    icon: "Crop",
    tags: ["裁剪", "旋转", "镜像", "批量", "图片", "尺寸"],
    featured: true,
  },
  {
    id: "image-parameter-crop",
    name: "图片参数化裁剪",
    description: "通过拖动裁剪框或输入左上/右下坐标，精确指定裁剪区域",
    category: "image",
    path: "/tools/image/parameter-crop/",
    icon: "Crosshair",
    tags: ["参数化裁剪", "坐标裁剪", "精确裁剪", "图片"],
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
  {
    id: "image-edit",
    name: "图片编辑",
    description: "在图片上画线画框做标注，调节亮度、对比度、色温、色调，本地导出",
    category: "image",
    path: "/tools/image/edit/",
    icon: "SlidersHorizontal",
    tags: ["图片编辑", "标注", "画框", "亮度", "对比度", "色温"],
    featured: true,
  },
  {
    id: "image-picker",
    name: "取色器",
    description: "从图片、屏幕或调色板取色，左右双区对比 HEX / RGB / HSL / HSV",
    category: "design",
    path: "/tools/image/picker/",
    icon: "Pipette",
    tags: ["取色", "颜色", "色值", "RGB", "HSL"],
  },

  // --- 图像设计/计算工具 ---
  {
    id: "color-contrast",
    name: "颜色对比度检查",
    description: "WCAG 文字可见性预检：检查文字色与背景色的对比度、评级，支持经验学习与色觉模拟",
    category: "design",
    path: "/tools/design/contrast/",
    icon: "Contrast",
    tags: ["对比度", "WCAG", "可访问性", "颜色", "色觉模拟"],
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

  // --- 文档与文件工具 ---
  {
    id: "file-bin-viewer",
    name: "二进制查看器",
    description: "在线查看二进制文件内容，Hex 字节、ASCII 字符、偏移跳转与字节搜索",
    category: "file",
    path: "/tools/file/bin-viewer/",
    icon: "Binary",
    tags: ["二进制", "Hex", "字节", "查看", "搜索"],
    featured: true,
  },
  {
    id: "file-doc-compare",
    name: "文档对比",
    description: "打开查看 docx、txt、md 文档，并排对比两份文档的行级差异",
    category: "file",
    path: "/tools/file/doc-compare/",
    icon: "Columns2",
    tags: ["文档对比", "diff", "docx", "txt", "md"],
  },

  // --- 视频工具 ---
  {
    id: "video-compress",
    name: "视频压缩",
    description:
      "在线压缩 MP4/WebM 等视频，支持截取片段，自定义质量档位、分辨率与输出格式，本地转换不上传",
    category: "video",
    path: "/tools/video/compress/",
    icon: "Video",
    tags: ["压缩", "视频", "MP4", "WebM"],
    featured: true,
  },
  {
    id: "video-to-gif",
    name: "视频转 GIF",
    description:
      "将视频片段转为 GIF 动图，支持起止时间、帧率、尺寸、颜色数与循环设置",
    category: "video",
    path: "/tools/video/gif/",
    icon: "Film",
    tags: ["GIF", "动图", "视频", "转换"],
  },
  {
    id: "video-compress-fast",
    name: "视频极速压缩",
    description:
      "基于 WebCodecs 硬件加速的极速压缩，支持最大 4GB 的 MP4(H.264) 视频，本地转换不上传",
    category: "video",
    path: "/tools/video/compress-fast/",
    icon: "Zap",
    tags: ["压缩", "视频", "极速", "WebCodecs", "MP4"],
  },
];

export const toolsByCategory = {
  image: tools.filter((t) => t.category === "image"),
  pdf: tools.filter((t) => t.category === "pdf"),
  design: tools.filter((t) => t.category === "design"),
  file: tools.filter((t) => t.category === "file"),
  video: tools.filter((t) => t.category === "video"),
};

export const getToolById = (id: string) => tools.find((t) => t.id === id);
