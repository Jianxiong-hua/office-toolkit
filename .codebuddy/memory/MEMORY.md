# 项目长期记忆：浩匣 / HaoXia Office Toolkit

## 项目定位
纯前端（浏览器本地处理、文件不上传）的 PDF + 图片 + 设计工具站。Next.js 15 App Router + React 19 + Tailwind v4 + TypeScript。
实际 Next 应用在子目录 `office-toolkit/`，仓库根目录另有 husky 的 `package.json`（会产生「多个 lockfile」的 Next 警告，无害）。

## 命令与环境（Windows / PowerShell）
- 依赖安装在 `office-toolkit/` 下：`cd 'd:/AI agent/AI coding/office-toolkit/office-toolkit'; npm install`
- 类型检查：`npm run validate`（tsc --noEmit）；构建：`npm run build`
- 起服务：`npx next dev --port 3000`。注意 `npm run dev -- -p 3000` 会把 `3000` 当成目录参数而失败。
- dev server 可能假死（端口监听但不响应）：`taskkill /PID <pid> /F /T` 后重启。
- `cd` 到含空格路径必须用单引号包裹。
- PowerShell 里不要用 `curl`（别名指向 Invoke-WebRequest），用 `Invoke-WebRequest -Uri ... -UseBasicParsing`。

## Git（SSH 已配好）
- 远端为 SSH：`git@github.com:Jianxiong-hua/office-toolkit.git`；key `C:\Users\hao\.ssh\id_ed25519`（无 passphrase），GitHub 账号 Jianxiong-hua，push/pull 免密。
- ⚠️ PowerShell 下 `git commit -m "中文"` 会因 GBK 控制台编码乱码。必须用 UTF-8 文件写 message 再 `git commit -F <file>`（临时文件放 `.git/` 内，用完删）。
- ⚠️ ssh-keygen 的 `-N ""` 在此环境不可靠，让用户手动交互生成、passphrase 回车留空。

## 用户确认红线（2026-08-30 用户明确要求，最高优先级）
以下操作**必须先给用户确认，不得擅自执行**（详见 `.codebuddy/rules/commit_rules.mdc`）：
1. **版本号**任何变更（package.json、changelog 版本条目）——新增条目还是并入现有条目，由用户选。
2. **changelog/history 文案**——标题、描述措辞要先展示原文等确认。
3. **commit message**——写好全文等用户确认后才能 commit（"提交吧"≠可以跳过确认）。
4. **push**——只在用户明确说 push/推送时执行；"提交"≠push。
5. 站点对外文案（tools.ts、ToolLayout 标题描述、对外承诺）同理。

## 开发约定
- **工具元信息单一来源**：`office-toolkit/src/config/tools.ts`（`name` / `description` / `tags` / `icon` / `featured`）。首页、导航、sitemap 都从这里读，改工具名必须同步它。
- **每次功能变更都要在 `office-toolkit/src/app/changelog/page.tsx` 顶部追加新版本条目**（数组最新在前，version 递增，changes 用中文一句一条）。
- 批量工具统一模式：`FileDropZone` 多文件 → `FileList`（展示 results / 单张下载预览 / 删除）→ `jszip` 动态 `import("jszip")` 打包下载。
- 文件名用 `generateOutputFilename(原文件名, 后缀, 新扩展名)`；下载用 `downloadBlob`（file-saver）。
- 错误分两类展示：处理失败用 `ErrorAlert`（带重试）；输入/校验类提示用琥珀色内联横幅。
- 纯函数逻辑放 `src/lib/{image,pdf,color}/*.ts`，页面只做状态与 UI。

## 技术要点
- **react-easy-crop**：`onCropComplete` 给的 `croppedAreaPixels` 是**旋转后外接矩形**（`rotateSize(naturalW, naturalH, rotation)`）坐标系的像素，不是原图坐标系。任意角度旋转必须先「镜像→旋转」绘制到外接矩形 canvas，再按 crop 区域取像素；输出尺寸恒等于 crop.width × crop.height。
- Cropper 组件不支持 flipX/flipY，镜像需预处理图片为 dataURL 再传给 `image`。
- `lucide-react` 提供图标；`tools.ts` 里 icon 是图标名字符串。
