# 小蓝盒免费在线办公工具箱 / Sky-Box Office Toolkit

纯前端 Web 办公工具站，所有文件处理均在浏览器本地完成，无需上传到服务器，保护隐私安全。

## ✨ 功能特性

### PDF 工具

- **PDF 合并** - 将多个 PDF 或图片文件合并为一个 PDF，支持通过按钮调整页面顺序，合并后可预览结果
- **PDF 拆分** - 按页码范围、每 N 页或单页提取拆分 PDF 文件
- **PDF 水印** - 为 PDF 添加文字或图片水印，支持自定义位置、透明度、旋转

### 图片工具

- **图片压缩** - 在线压缩 PNG/JPG/WebP 图片，支持批量处理和自定义压缩质量
- **格式转换** - 图片格式互转，支持 JPG ↔ PNG ↔ WebP ↔ BMP
- **图片缩放** - 按像素或百分比缩放图片，支持锁定宽高比和批量处理
- **图片裁剪** - 自由裁剪图片，支持固定比例（1:1、4:3、16:9）、旋转、翻转
- **背景填充** - 将图片等比居中或拉伸填充到目标画布尺寸，支持自定义背景色和证件照尺寸预设
- **修改 DPI** - 按目标 DPI 等效调整图片像素尺寸，适用于打印场景

### 核心优势

- 🔒 **隐私安全** - 所有文件处理在浏览器本地完成，文件不会上传到任何服务器
- 🚀 **无需注册** - 打开即用，无需登录或注册
- 💻 **纯前端** - 零服务器成本，可部署到 Vercel / Cloudflare Pages
- 📱 **响应式设计** - 支持桌面和移动设备访问

## 🛠️ 技术栈

- **框架**: Next.js 15 (App Router)
- **语言**: TypeScript
- **样式**: Tailwind CSS 4.x
- **图标**: Lucide React
- **状态管理**: Zustand

### 核心依赖库

- `pdf-lib` - PDF 创建、修改、合并、拆分、加水印
- `browser-image-compression` - 图片压缩
- `react-dropzone` - 拖拽上传
- `react-easy-crop` - 图片裁剪
- `jszip` - 批量下载打包
- `file-saver` - 触发浏览器下载

## 📦 安装依赖

```bash
# 进入项目目录
cd office-toolkit

# 安装依赖
npm install
```

## 🚀 运行项目

### 开发模式

```bash
npm run dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000) 查看应用。

### 生产构建

```bash
npm run build
```

构建完成后，静态文件会输出到 `out/` 目录。

### 启动生产服务

```bash
npm start
```

## 📁 项目结构

```
office-toolkit/
├── src/
│   ├── app/                    # Next.js 页面路由
│   │   ├── page.tsx            # 首页
│   │   ├── layout.tsx          # 根布局
│   │   └── tools/              # 工具页面
│   │       ├── pdf/            # PDF 工具
│   │       │   ├── merge/      # PDF 合并
│   │       │   ├── split/      # PDF 拆分
│   │       │   └── watermark/  # PDF 水印
│   │       └── image/          # 图片工具
│   │           ├── compress/   # 图片压缩
│   │           ├── convert/    # 格式转换
│   │           ├── resize/     # 图片缩放
│   │           ├── crop/       # 图片裁剪
│   │           ├── pad/        # 背景填充
│   │           └── dpi/        # 修改 DPI
│   ├── components/             # 通用组件
│   │   ├── layout/             # 布局组件
│   │   ├── tools/              # 工具组件
│   │   └── common/             # 通用组件
│   ├── lib/                    # 工具函数库
│   │   ├── pdf/                # PDF 处理逻辑
│   │   └── image/              # 图片处理逻辑
│   ├── config/                 # 配置文件
│   └── types/                  # 类型定义
├── public/                     # 静态资源
├── docs/                       # 项目文档
└── package.json
```

## 🌐 部署

### Vercel 部署（推荐）

1. 将项目推送到 GitHub
2. 在 [Vercel](https://vercel.com) 导入项目
3. 自动部署，获得自定义域名

### 静态部署

```bash
npm run build
```

将 `out/` 目录部署到任何静态文件服务器（Cloudflare Pages、Netlify、GitHub Pages 等）。

## 📋 已知限制

- **中文水印暂不支持** - PDF 文字水印使用 Helvetica 字体，中文会显示为方块
- **DPI 仅做像素等效调整** - Web 无法写入 EXIF DPI，仅按像素尺寸等效调整
- **大文件限制** - 单文件 ≤ 50MB，避免浏览器内存不足
- **BMP 输出依赖浏览器支持** - 部分浏览器可能不支持 BMP 格式输出

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📧 联系方式

如有问题或建议，请通过 GitHub Issues 反馈。
