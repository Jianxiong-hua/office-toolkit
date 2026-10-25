# 项目长期记忆：浩匣 / HaoXia Office Toolkit

## 项目定位
纯前端（浏览器本地处理、文件不上传）的 PDF + 图片 + 设计工具站。Next.js 15 App Router + React 19 + Tailwind v4 + TypeScript。
实际 Next 应用在子目录 `office-toolkit/`，仓库根目录另有 husky 的 `package.json`（会产生「多个 lockfile」的 Next 警告，无害）。

## 命令与环境（Windows / PowerShell）

> ⚠️ 本文档入库并随 `git pull` 同步到**多台电脑**。规则：**具体路径/用户名一律不写进正文**，只写探测方法与通用步骤；各机器实测值统一记在下方「各机器已确认值」表，新增机器**追加一行，禁止覆盖他行**。

### 通用规则（所有机器适用）
- **仓库路径不要记死**：用 `git rev-parse --show-toplevel` 取（应用在其子目录 `office-toolkit/`）。各机器实际值见下表。
- **Node 不在 PATH 时**：先 `where.exe node`；为空则到 IDE 自带运行时目录找 node.exe，注入 PATH 后即可执行：
  `$env:PATH = "<node 所在目录>;" + $env:PATH`（各机器实测路径见下表）
- 依赖安装：`cd '<仓库>/office-toolkit'; npm ci --no-audit --no-fund`（用 `ci` 而非 `install`，避免改动 `package-lock.json`）
- 类型检查：`npm run validate`（tsc --noEmit）；构建：`npm run build`
- 起服务（**用户 2026-09-08 确认的标准方式，以后都按此启动**）：在 `office-toolkit/` 子目录后台执行 `npm run dev`（默认端口 3000）。PowerShell 写法：
  `Set-Location '<项目>/office-toolkit'; Start-Process -FilePath "npm.cmd" -ArgumentList "run dev" -WindowStyle Hidden`
  然后用 `curl.exe http://localhost:3000` 验证 200。不要用 `npm run dev -- -p 3000`（追加参数会把 `3000` 当成目录参数而失败）。
- 备选启动写法（2026-09-28 实测可行，适用于 PATH 里没有 npm 时）：
  `Start-Process -FilePath "<node.exe 全路径>" -ArgumentList "node_modules/next/dist/bin/next","dev","-p","3000" -WorkingDirectory '<项目>\office-toolkit' -RedirectStandardOutput $out -RedirectStandardError $err`
- **禁止**把重定向拼进参数字符串：`Start-Process cmd.exe -ArgumentList '/c','npm run dev > "%TEMP%\x.log" 2>&1'` 会失败并只报「文件名、目录名或卷标语法不正确」。
- dev server 可能假死（端口监听但不响应）：`taskkill /PID <pid> /F /T` 后重启。
- `cd` 到含空格路径必须用单引号包裹。
- PowerShell 里不要用 `curl`（别名指向 Invoke-WebRequest），用 `Invoke-WebRequest -Uri ... -UseBasicParsing`。

### 各机器已确认值（新增机器追加一行，禁止覆盖他行）
用 `whoami` 确认当前是哪台，再取对应行；**除当前机器外的其他行一律视为「未验证」**。

| Windows 用户 | 记录日期 | 仓库根目录 | Node 运行时 | SSH key |
|---|---|---|---|---|
| `hao` | 2026-09-08 | `d:\AI agent\AI coding\office-toolkit` | 未记录（当时 `npm install` 可直接执行） | `C:\Users\hao\.ssh\id_ed25519` |
| `hjx` | 2026-09-28 | `e:\AI work\office_toolkit\office-toolkit` | **不在 PATH**，用 IDE 自带 `C:\Users\hjx\.workbuddy\binaries\node\versions\22.22.2-2\`（v22.22.2 / npm 10.9.7） | `C:\Users\hjx\.ssh\id_ed25519` |
| `bakbik` | 2026-10-18 | `g:\AgentWork\VibeCodingIdea\常用办公工具项目\office-toolkit` | **在 PATH**，`C:\Program Files\nodejs`（v20.11.0 / npm 10.2.4；注意 pdfjs-dist 要求 node ≥22.13，仅 EBADENGINE 警告，无害） | 未验证 |

## Git（SSH 已配好）
- 远端为 SSH：`git@github.com:Jianxiong-hua/office-toolkit.git`，GitHub 账号 Jianxiong-hua，push/pull 免密。
- key 路径随机器不同，**不要写死用户名**：用 `"$env:USERPROFILE\.ssh\id_ed25519"` 定位（无 passphrase）。各机器实际路径见「各机器已确认值」表。
- ⚠️ PowerShell 下 `git commit -m "中文"` 会因 GBK 控制台编码乱码。必须用 UTF-8 文件写 message 再 `git commit -F <file>`（临时文件放 `.git/` 内，用完删）。
- ⚠️ ssh-keygen 的 `-N ""` 在此环境不可靠，让用户手动交互生成、passphrase 回车留空。

## 用户确认红线（2026-08-30 用户明确要求，最高优先级）
以下操作**必须先给用户确认，不得擅自执行**（详见 `.codebuddy/rules/commit_rules.mdc`）：
1. **版本号**任何变更（package.json、changelog 版本条目）——新增条目还是并入现有条目，由用户选。
2. **changelog/history 文案**——标题、描述措辞要先展示原文等确认。
3. **commit message**——写好全文等用户确认后才能 commit（"提交吧"≠可以跳过确认）。
4. **push**——只在用户明确说 push/推送时执行；"提交"≠push。
5. 站点对外文案（tools.ts、ToolLayout 标题描述、对外承诺）同理。

## 测试卫生约定（2026-09-08 用户提出）
凡涉及测试的环节，测试完成后必须**清理测试脚本和中间产物**（临时文件、生成的样例文件等），保持工作区不被污染。

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
- `lucide-react` 提供图标；`tools.ts` 里 icon 是图标名字符串。**写错 icon 名不会报错**，`ToolCard` 会静默回退成 `Wrench` 扳手图标，新增工具时务必 grep 校验图标真实存在。

## 结构性陷阱（2026-10-08 踩坑后补充，2026-10-11 增补）
- **同一文件的多个编辑必须串行**（2026-10-20 踩坑）：并行批次里对同一文件发多个 `replace_in_file` 会互相覆盖，且**全部返回成功、无报错**——曾因此静默丢失首页视频区块，tsc 查不出，只能靠 curl 页面 HTML 内容核对发现。并行只允许不同文件
- **PowerShell 管道会把 curl 的 UTF-8 输出按 GBK 解码**：中文 grep 静默失败（匹配不到≠不存在）。验证页面中文内容必须 `curl -o 文件` 再用 node 读文件判断
- **通用 `FileDropZone` 无法接受任意文件类型**：它基于 react-dropzone，accept 最终走 npm 包 `attr-accept`，该包对空数组 `.some()` 恒为 false，即传 `accept={{}}` 会**拒绝所有文件**。需要「任意类型」时只能自研 input + 拖拽组件。
- **大文件文本视图必须虚拟滚动**：20MB / 16 字节每行 = 1,310,720 行，一次性渲染直接卡死。自研固定行高 windowing 约 40 行即可，无需引依赖；行高常量与 JSX 行内样式必须一致，否则像素换算错位。
- **新增工具分类要改 4 处硬编码**：`config/site.ts` 的 `ToolCategory` → `config/tools.ts` 的 `toolsByCategory` → 首页 `app/page.tsx` 的**手写** `<section>`（不是遍历渲染）→ `components/tools/ToolCard.tsx` 的 `categoryColors` 与 `categoryIconBg` 两张表。漏改不报错，只会静默回退成灰色卡片。
- **dev server 运行中严禁跑 `npm run build`**：build 重写 `.next`，dev 的 chunk 全部 404，页面变无样式裸 HTML。build 后必须重启 dev。
- **React StrictMode 下 setState 的 updater 会被双调用**：updater 内嵌套其他 setState 会被执行两次（撤销栈重复推入）。副作用移出 updater，改直接读闭包值。
- **canvas 查看器滚轮缩放**：尺寸与滚动必须在 wheel 事件内同步写 DOM（rAF 调 scroll 会跑在 React 提交前，产生闪烁中间帧）；ResizeObserver 只更新 fitScaleRef，不能重置当前缩放（否则放大被拉回 fit，表现为放大无效）。
- **dev 重启前跑过 build 会卡死 dev 启动**：.next 的 build 产物文件数超过 IDE node safe-delete 钩子的批量阈值（500），predev 的 rmSync 被拦而抛错，端口不监听。先手动 Remove-Item .next 再启动。
- **execute_command 写源码时转义序列会变形**：参数中的 `\r\n` 等经链路变成双反斜杠字面。TS 源码里的转义用 String.fromCharCode 拼接；纯函数断言脚本放 .git/ 下临时目录跑。

## 工作日志
- `2026-08-29.md` / `2026-08-30.md`（用户红线）/ `2026-09-08.md`（测试卫生）/ `2026-09-28.md`（PDF 拆分导出倍率）
- `2026-10-08.md`——三批新工具规划（bin 查看器 / 图片编辑 / 文档对比）、新增 `file` 分类、搜索模式消歧踩坑
- `2026-10-11.md`——图片编辑器 v1+v2（像素调整/标注/缩放/文本）、dev-build 冲突、StrictMode updater、缩放闪烁与放大失效、工具故障绕行
- `2026-10-12.md`——文档对比（Hirschberg diff、编码回退、并排双栏）、分割公式 bug、predev 被安全钩子拦截
- `2026-10-17.md`——图片编辑标注增强（测量根因修复/画框填充色/工具栏图标组/图层列表与叠层）、ImageWorkbench 共享组件、PDF 拆分提取合并、滑杆撤销栈与 PowerShell 无 head 等踩坑
- `2026-10-18.md`——视频工具设计与实现（ffmpeg.wasm 单例两工具复用、palettegen/paletteuse 出 GIF、截取并入压缩、lucide 无 FileVideo、AAC 不能进 WebM、ffmpeg ESM worker 须 webpack 打包）。设计文档：`docs/plans/2026-10-18-video-tools-design.md`
- `2026-10-25.md`——视频极速压缩闭环：架构重构（mp4box 只解析元数据 + 按 offset 随机读、跳过 mdat）、PCE 音轨解码失败、编解码显式 prefer-hardware、倍速时间轴与拖动卡死、事件驱动送帧、4GB 上限、截取时间钳制；**同日晚**：视频压缩/GIF 提速（core-mt 在 GIF 滤镜链不可用、WebCodecs 极速 GIF 的逐项实测、软解胜硬解、willReadFrequently 负优化、ffmpeg 阶段进度不可得、两遍法回滚）

## 视频工具技术要点（2026-10-18）
- 转换内核 `src/lib/video/ffmpeg.ts`：wasm 核心走 unpkg CDN（`toBlobURL`，约 30MB），不入库；**不要传 `classWorkerURL`**——ESM worker 的相对导入只有 webpack 打包才能解析（blob URL 会断），实测打包为独立 chunk 正常
- 音频编码按格式分流：MP4→`aac`，WebM→`libopus`（AAC 进 WebM 直接报错）
- `@ffmpeg/core@0.12.10` 实测含 libx264 / libvpx-vp9 / aac / libopus / palettegen / paletteuse
- ffmpeg `-loop`：0=无限循环，-1=播放一次
- **「视频极速压缩」（2026-10-20 新增，2026-10-25 重构）**：`src/lib/video/fastCompress.ts`，WebCodecs 硬件加速，仅 MP4/MOV+H.264 输入、MP4 输出、**≤4GB**；倍速≠1 无音轨；不自动回落，报错引导用「视频压缩」
  - **mp4box 只当元数据解析器**（`createFile(false)` 不保留 mdat）：喂文件头后按顶层 box 跳读，遇 mdat 直接跳过、只喂 moov，再用 `getTrackSamplesInfo` 拿样本表；样本数据按 `sample.offset` 用 `File.slice` 随机读。实测 2.75GB 片源 **349ms / 仅读 4.86MB** 拿到索引（旧实现要读完整个 mdat）
  - **编解码都要显式 `prefer-hardware`**：`no-preference` 下浏览器遇到硬编不支持的配置（如 4K 需 High 5.1）会**静默退软编**，而 `isConfigSupported` 仍返回 true。4K 实测 28fps → 42fps；1080p 两侧命中硬编后 160fps
  - **AAC 封装必须透传源 AudioSpecificConfig**（首块 `addAudioChunkRaw(..., { decoderConfig: { description } })`）：用 PCE 描述声道的片源（`channelConfiguration=0`），按 `numberOfChannels` 生成的默认配置会让整条音轨报 `channel element not allocated`
  - **时间轴**：`duration` 只能取相邻块的 pts 差——`chunk.duration` 是「源帧时长/speed」，与抽帧后的真实间隔不同源，采信会让 DTS 持续落后 PTS、ctts 累积、倍速输出拖动进度条卡死；输出帧率 = `srcFps × min(1, speed)`（倍速帧率不变，慢放才变小）
  - **等编码器槽位靠 `encoder.output` 回调唤醒**，不要 `sleep` 轮询：setTimeout 有 2~4ms 抖动，每帧赔一次就把 160fps 压到 ~100fps（表现为前期快、后期掉速）

### 视频工具提速（2026-10-25 第二轮，版本 1.11.1）
- **`@ffmpeg/core-mt` 不能用在 GIF 的 `split+palettegen+paletteuse` 链上**：同一 750 帧素材，单线程 155.7 秒完成，多线程（16 核）295 秒仍停在分析阶段（更早一次 918 秒未出帧）。重度滤镜链必须 `forceSingleThread`；视频压缩走多线程无碍
- COOP/COEP 由 `public/_headers` 提供（CF Pages 读取，`next build` 输出到 `out/_headers`），是 `SharedArrayBuffer`/core-mt 的前提；本地 `next dev` 不应用该文件 → 永远单线程
- **ffmpeg.wasm 拿不到「无输出帧阶段」的中间进度**，三条路都实测排除：progress 事件按输出时间戳；统计行用 `\r` 不成行；`-progress pipe:1` 的 stdout 不经日志回调。只能靠页面秒表兜底
- **WebCodecs GIF 路径：软件解码快于硬件解码**（硬解帧是 GPU 纹理，`drawImage` 到 CPU 位图要回读）：draw 16.5→0.4 ms、read 0.15→7.4 ms，合计省 8.9 ms/帧；且 `willReadFrequently: true` 在此是负优化（read 从 7.5 降到 3.3 ms 靠关掉它）
- `gifenc` 的 `quantize` 是 GIF 编码绝对瓶颈（约 applyPalette+LZW 的 7 倍）；降采样无收益（成本随颜色分布而非像素数变化），只能复用调色板，16 帧后收益饱和
- `ffmpeg.writeFile` 会 **transfer** `ArrayBuffer` 所有权，源 buffer 被 detach；同一份数据要写两次时必须重新 `fetchFile`
- 视频转 GIF 的文件上限按模式分流：**极速模式 4GB**（按需随机读样本）、**兼容模式 200MB**（整份写进 wasm 内存）；>200MB 时强制极速模式并锁定开关，非 MP4/MOV 直接拒绝
