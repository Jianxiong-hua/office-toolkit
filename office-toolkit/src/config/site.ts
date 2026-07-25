export const siteConfig = {
  name: "OfficeToolkit",
  title: "OfficeToolkit - 免费在线办公工具箱",
  description:
    "免费在线 PDF 处理、图片处理工具集。所有处理均在浏览器本地完成，无需上传文件到服务器，保护您的隐私安全。",
  url: "https://officetoolkit.pro",
  ogImage: "https://officetoolkit.pro/og-image.png",
  links: {
    github: "https://github.com/officetoolkit",
  },
};

export type ToolCategory = "image" | "pdf";

export interface ToolMeta {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  path: string;
  icon: string; // lucide icon name
  tags: string[];
  featured?: boolean;
  paid?: boolean;
}
