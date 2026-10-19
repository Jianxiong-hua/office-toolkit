# 视频工具设计：视频压缩 + 视频转 GIF

日期：2026-10-18 ｜ 状态：已与用户确认，待实现

## 背景与目标

用户需求：新增「视频压缩」与「视频转 GIF」两个工具。video2gif 的参考实现：https://lyonbot.github.io/video-to-gif/ （仓库 lyonbot/video-to-gif）。

## 参考实现调研结论（2026-10-18 通过 GitHub API 抓源码分析）

- 技术栈：SolidJS + Vite + UnoCSS；`@ffmpeg/ffmpeg` 0.12 + `@ffmpeg/core` + `@ffmpeg/util` + `modern-gif` + `mp4box`
- 三层抽帧降级（`src/processors/frameGrabber.ts`）：
  1. `grabFramesWithMP4Box`：mp4box.js 解封装 + WebCodecs `VideoDecoder` 解码，逐帧画 canvas（含旋转矩阵处理）——首选，最快
  2. `grabFramesWithVideoTag`：`<video>` 设 `currentTime` + `createImageBitmap` 逐帧截图——兜底
  3. `grabFramesWithFFMpeg`：ffmpeg.wasm `select` 滤镜按时间戳抽 rawvideo RGBA 帧，轮询读文件 `putImageData`——最终兜底
- GIF 编码用 `modern-gif`（WASM 编码器）
- 参数（`src/components/OptionEditor.tsx`）：起止时间、倍速 Speed 0~10、帧率 1~60、输出宽高（-1 自动）、最大颜色数、抖动算法、文字水印（含 JSON5 高级配置）
- 参考实现的取舍：为「快」付出了 mp4box + WebCodecs + modern-gif 三块额外复杂度

## 我们的方案（用户 2026-10-18 逐项确认）

1. **压缩与 GIF 均采用 ffmpeg.wasm 单一技术栈**，两个工具共享全局单例，零新增编码/解封装依赖（不引 mp4box、modern-gif、WebCodecs）。
2. wasm 核心 `@ffmpeg/core@0.12.10` UMD **单线程**版运行时从 unpkg CDN 经 `toBlobURL` 加载成 Blob——二进制不入仓库、不进 Next.js 打包；单线程版不需要 COOP/COEP 跨域隔离响应头，Cloudflare Pages 可直接部署。
3. **GIF 用 ffmpeg `palettegen`/`paletteuse` 一条滤镜链直接产出**：全局调色板，色彩质量与体积优于逐帧独立量化；循环次数、颜色数、抖动均为 ffmpeg 原生参数，开箱即用；帧精确无 seek 抖动。
4. 取消转换 = `ffmpeg.terminate()` 后重置状态，下次转换自动重新 `load()`（wasm 已被浏览器缓存，二次初始化约数秒）。
5. 元信息（时长、宽高）用 `<video>` 元素读取，不引入 ffprobe。
6. **截取功能并入「视频压缩」工具**（用户 2026-10-18 确认，而非独立工具）：截取与压缩在同一次 ffmpeg 调用中完成；UI 与 GIF 工具的起止时间交互一致（可复用组件）。代价：纯截取用户也要走一次重编码（高质量档 CRF 20 接近视觉无损）。

## 架构

新增依赖：`@ffmpeg/ffmpeg@^0.12.15`、`@ffmpeg/util@^0.12.2`（仅 JS 加载器）。

```
src/lib/video/
  ffmpeg.ts     # 全局单例：ensureLoaded() 幂等；run() 封装 写文件→exec→读文件→清理；progress 透传
  compress.ts   # compressVideo(file, options)
  gif.ts        # videoToGif(file, options)
src/types/video.ts          # VideoCompressOptions / VideoGifOptions / 结果类型
src/app/tools/video/compress/page.tsx
src/app/tools/video/gif/page.tsx
```

新增 `video` 分类需改 4 处硬编码（见 MEMORY.md「结构性陷阱」）：`config/site.ts` 的 `ToolCategory` → `config/tools.ts` 的 `tools` 与 `toolsByCategory` → 首页 `app/page.tsx` 手写 `<section>` → `components/tools/ToolCard.tsx` 的 `categoryColors` 与 `categoryIconBg`。

## 参数（用户确认）

**视频压缩**（含截取）：
- 质量档位：高质量 CRF 20 / 标准 CRF 23 / 压缩 CRF 28
- 分辨率缩放：保持原始 / 1080p / 720p / 480p（等比，取偶数）
- 输出格式：MP4 (H.264) / WebM (VP9)
- 倍速播放：0.5x ~ 2x
- 编码速度 preset：默认 medium
- 起止时间截取：数字输入 + 播放器打点
- 音频：固定保留并重编码 AAC 128k（不进 UI）

**视频转 GIF**：
- 起止时间、帧率（默认 15）、输出宽度（默认 480，高度等比）
- 最大颜色数（默认 128）：255/128/64/32
- 循环次数：无限循环（默认）/ 播放一次
- 倍速播放：0.5x ~ 2x
- 抖动：固定 bayer（不进 UI）

## ffmpeg 命令草图

压缩（截取/缩放/倍速合并进同一滤镜链；`-ss/-t` 放 `-i` 之后保证帧精确）：

```
-i in -ss {start} -t {duration} -c:v libx264|libvpx-vp9 -crf {20|23|28} -preset {p} -pix_fmt yuv420p
  [-vf "scale=-2:{H},setpts=PTS/{rate}"] [-c:a aac -b:a 128k]
  out.mp4 | out.webm
```

GIF：

```
-vf "fps={fps},scale={w}:-2:flags=lanczos,setpts=PTS/{rate},split[s0][s1];[s0]palettegen=max_colors={n}[p];[s1][p]paletteuse=dither=bayer"
-loop {0|-1}   # 0=无限循环（默认），-1=播放一次
```

约束：`scale=-2` 保证偶数宽高（yuv420p 硬要求）；倍速需视频 `setpts` 与音频 `atempo` 同步以保持音调。

## 页面交互与数据流

两个工具均为**单文件**流程（视频转换耗时且需独占进度反馈，不做批量）：

```
DropZone(accept: video/*, maxSize 200MB)
  → <video> 预览 + 元信息条（时长/宽高/大小）
  → 参数面板（首次点「开始转换」才 ensureLoaded()，独立加载进度）
  → 转换中：进度条 + 百分比 + 「取消」按钮
  → 结果区：GIF 用 <img> 预览；压缩结果用 <video> 预览 + 前后体积对比 + 下载
```

- 起止时间：数字输入框 + 预览播放器内「设开始/设结束」取 `currentTime`，默认全段
- 错误处理：CDN 加载失败、编码器报错、内存不足（超大视频）统一捕获为中文 `AppError`
- 视觉沿用现有工具风格（Tailwind + lucide）

## 站点元信息（用户 2026-10-18 确认）

- 新分类：`video`，首页区块「视频工具 / 压缩、转 GIF」
- `video-compress`：视频压缩，`Video`（lucide 无 FileVideo，写错会静默回退成扳手图标），featured，tags：压缩、视频、MP4、WebM
  description：在线压缩 MP4/WebM 等视频，支持截取片段，自定义质量档位、分辨率与输出格式，本地转换不上传
- `video-to-gif`：视频转 GIF，`Film`，tags：GIF、动图、视频、转换
  description：将视频片段转为 GIF 动图，支持起止时间、帧率、尺寸、颜色数与循环设置
- changelog 新增 1.10.0（2026-10）条目；`package.json` version 同步 1.10.0（原值 0.1.0 已脱节）
- 首页 Hero 文案与 `site.ts` description 追加视频能力

## 验证计划

1. `npm run validate`（tsc --noEmit）通过 → 验证：类型
2. `npm run build` 通过 → 验证：构建（注意 dev server 运行中禁跑 build，见 MEMORY.md）
3. ffmpeg.wasm 转换需真实浏览器环境：起 dev server 后用 10 秒左右测试视频实测两个工具 → 验证：功能（由用户执行）
