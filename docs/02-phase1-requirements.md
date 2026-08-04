# 浩匣 Phase 1 需求文档

> 第一阶段目标：零服务器、纯前端，完成基础 PDF 和图片工具，让自己和周围的人能顺手用起来。

---

## 1. 目标与范围

### 1.1 目标
- 完成 9 个核心工具的开发和上线；
- 建立统一的文件上传、处理、下载、错误提示体验；
- 部署到 Cloudflare Pages，支持自己和朋友的日常使用；
- 为后续阶段打好基础（组件复用、SEO 结构、埋点事件）。

### 1.2 范围边界

**包含**：
- 3 个 PDF 工具：合并、拆分、水印；
- 5 个图片工具：压缩、格式转换、缩放、快速裁剪、扩展填充（Padding）；
- 通用基础设施：上传组件、文件列表、处理状态、下载、SEO、错误处理。

**不包含**：
- AI 抠图、PDF 压缩、视频处理、OCR；
- 用户系统、登录、云存储；
- 多语言、付费功能；
- 后端服务。

---

## 2. 通用基础设施需求

### 2.1 文件上传与选择

#### 功能需求
- 支持点击选择文件和拖拽上传；
- 支持多文件批量上传；
- 拖拽时有视觉反馈（高亮边框/背景）；
- **超出大小、数量限制或格式不支持时，必须在上传区域给出明确的中文错误提示**（而不是静默忽略）；
- 上传后已选文件可通过"重新选择"按钮（灰底样式：`bg-gray-100` + `text-gray-600`）一键清空当前选择；
- 移动端点击上传区域能正常调起系统文件选择器。

#### 软件需求
- 封装 `FileDropZone` 组件，基于 `react-dropzone`；
- 文件大小限制：
  - 图片单文件 ≤ 20MB；
  - PDF 单文件 ≤ 100MB（PDF 合并、拆分、水印通用）；
  - PDF 合并批量总大小 ≤ 500MB；
- 使用 `crypto.randomUUID()` 生成唯一文件 ID；
- 图片文件生成 Data URL 预览；
- PDF 文件显示文件名和页数（页数通过 `pdf-lib` 读取）；
- 严格校验 MIME 类型，不接受隐藏后缀文件；
- 校验失败时通过 `react-dropzone` 的 `validator` 抛出 `AppError`，UI 在上传区下方用红字提示。

### 2.2 文件列表管理

#### 功能需求
- 显示文件名、大小、状态（待处理/处理中/完成/失败）；
- 支持单个删除和全部清空；
- 处理完成后显示结果大小、压缩率/页数变化；
- 支持单个下载和批量打包下载；
- **所有工具的处理结果必须支持"预览"功能**：在结果文件旁提供预览按钮（眼睛图标），点击后在新窗口中显示结果内容（图片用 `<img>` 居中展示，PDF 用浏览器内置 PDF 阅读器直接打开）；
- 文件删除按钮采用灰底样式（`text-gray-400` + hover `bg-gray-100`），视觉上比"重新选择"更轻量。

#### 软件需求
- 封装 `FileList` 组件；
- 封装 `PreviewButton` 通用预览按钮组件，接受 `blob` + `filename` + `format`（`auto` / `image` / `pdf`），统一处理 `URL.createObjectURL` 创建与延迟回收（`setTimeout` 60s 后 `revokeObjectURL`）；
- 结果用 `Map<fileId, result>` 存储；
- 批量下载使用 `jszip` 打包，动态导入减少首屏体积；
- 文件名生成规则统一：原文件名 + `_processed` / `_compressed` + 扩展名。

### 2.3 处理状态与进度

#### 功能需求
- 处理时显示进度条或转圈动画；
- 处理失败时显示具体原因和重试按钮；
- 提供取消处理按钮；
- 大文件处理前给出预估时间提示。

#### 软件需求
- 封装 `useProcessState` Hook，管理 `idle/uploading/processing/done/error` 状态；
- 支持取消处理；
- 错误信息统一映射为用户友好文案。

### 2.4 下载

#### 功能需求
- 处理完成后可立即下载；
- 批量处理完成后打包为 ZIP 下载；
- 下载文件名清晰可辨识。

#### 软件需求
- 封装 `DownloadButton` 组件；
- 使用 `file-saver` 触发下载；
- ZIP 打包使用 `jszip`。

### 2.5 SEO 与页面元数据

#### 功能需求
- 每个工具页有独立的标题、描述、关键词；
- 搜索引擎能正确索引所有工具页；
- 社交分享时显示正确标题和描述。

#### 软件需求
- 每个 `page.tsx` 导出 `metadata`；
- 生成 `sitemap.ts` 动态站点地图；
- 添加 `robots.txt` 允许索引；
- 添加 JSON-LD 结构化数据。

### 2.6 错误处理与边界

#### 功能需求
- 任何工具出错都不导致整个页面崩溃；
- 错误信息用中文明确说明原因和解决建议；
- 支持用户一键重试或重新上传。

#### 软件需求
- 添加 React Error Boundary；
- 每个工具处理函数都用 `try/catch` 包裹；
- 统一错误码：
  - `FILE_TOO_LARGE`：文件太大；
  - `UNSUPPORTED_FORMAT`：格式不支持；
  - `PROCESS_FAILED`：处理失败，建议重试；
  - `BROWSER_NOT_SUPPORTED`：当前浏览器不支持；
  - `ENCRYPTED_PDF`：PDF 已加密，无法处理。

---

## 3. 工具功能需求

### 3.1 PDF 合并

#### 功能需求
- 支持上传多个 PDF 文件；
- 支持上传图片文件（PNG、JPG、JPEG、WebP），图片自动转换为单页 PDF；
- 支持拖拽或按钮调整文件顺序；
- 支持删除已添加的文件；
- 点击"合并"生成按顺序排列的新 PDF；
- 下载文件名：`merged_首个文件名_等N个文件.pdf`；
- 合并后显示总页数和总大小；
- **预览功能**：
  - 合并前可预览每个文件的缩略图（PDF 显示第一页，图片显示原图）；
  - 合并成功后显示"预览文件"按钮，点击在新窗口打开合并后的 PDF。

#### 软件需求
- 使用 `pdf-lib`：`PDFDocument.create()` + `copyPages()` + `addPage()`；
- 读取文件为 `ArrayBuffer`；
- 设置 `ignoreEncryption: true`，但捕获加密异常并提示；
- 支持页码范围选择（可选高级功能）；
- 限制总文件大小 ≤ 500MB（避免合并后文档过大导致浏览器崩溃）；
- **图片转 PDF**：使用 `pdf-lib` 的 `embedPng()` / `embedJpg()` 将图片嵌入 PDF 页面；
- **预览功能实现**：
  - 使用 `URL.createObjectURL(blob)` 生成临时 URL；
  - 通过 `window.open(url, "_blank")` 在新窗口打开；
  - 60 秒后 `URL.revokeObjectURL(url)` 释放内存。

#### 「自动缩小过大的图片文件」选项（v1.1.2 新增）

**功能需求**：
- 在文件列表下方增加复选框「自动缩小过大的图片文件」；
- 勾选后展开 radio 组，提供「72 DPI」「96 DPI」两个目标 DPI 选项（默认 96）；
- 不勾选：图片按原始尺寸嵌入（保持现有行为）；
- 勾选：上传的图片文件按所选 DPI 缩小到与 A4 页面等宽（高度等比缩放）后再嵌入；
- 下方提示文字「⚠ 该模式仅适用于电子版查看，不适合打印（打印通常需要 300 DPI）」。

**作用范围**：
- 仅对 `type === "image"` 的文件生效；
- `type === "pdf"` 的文件**完全保留原始字节**，不做任何处理、重渲染或栅格化（与是否勾选无关）。

**缩放规则**：
- 目标宽度 = A4 宽 8.27 英寸 × DPI
  - 72 DPI → 595 px
  - 96 DPI → 794 px
- 高度按原图宽高比等比缩放；
- 原图已比目标宽度更窄时**不放大**，按原尺寸嵌入；
- 保持原始格式：PNG → PNG（像素减少但无损）、JPEG → JPEG（q=0.85 重编码）；不做跨格式转换，避免对噪声类 PNG 错误地改用 JPEG 反而变大。

**设计意图**：
- 解决「高清图直接嵌入 PDF 导致合并后体积巨大」的问题；
- 72/96 DPI 接近屏幕常用显示密度（Windows 96 DPI、macOS 100~200 DPI），舍弃打印场景的 300 DPI 精度以换取更小的文件体积；
- 显式标注「不适合打印」，避免用户在高 DPI 打印场景下误用导致清晰度不足。

**接口变更**：
- `mergeMixedFiles(files, options)` 接收 `options.shrinkImageFiles: boolean` 与 `options.targetDpi: 72 | 96`。

---

### 3.2 PDF 拆分

#### 功能需求
- 支持上传单个 PDF 文件；
- 显示 PDF 总页数；
- 支持三种拆分模式：
  - **按范围拆分**：输入如 `1-3, 5, 8-10`；
  - **按每 N 页拆分**：如每 5 页一个文件；
  - **提取单页**：每页单独生成一个 PDF；
  - **逐页提取为 PNG 图片**：在"提取单页"模式下，可勾选"输出 PNG 图片（高清晰度）"复选框，每页渲染为 2× 缩放（适合 Retina 屏或打印）的 PNG 图片；
- 显示每个拆分结果对应的页码范围；
- 每个拆分结果旁提供**预览**按钮（图片用 `<img>` 居中预览，PDF 用浏览器内置阅读器预览）；
- 支持批量下载 ZIP。

#### 软件需求
- 使用 `pdf-lib` 创建新文档并 `copyPages` 指定页面；
- 页码输入解析器支持：逗号分隔、范围、单页；
- 校验输入不超过总页数；
- 每个拆分结果独立保存；
- 打包为 ZIP 下载；
- 限制文件 ≤ 100MB（拆分前的源文件大小限制）；
- 拆分后文件肯定小于拆分前，因此不对拆分后的文件大小做限制；
- 限制拆分后总页数 ≤ 500 页；
- **PDF 转 PNG 实现**：
  - 使用 `pdfjs-dist` 渲染 PDF 每一页为 Canvas；
  - 设置 `pdfjsLib.GlobalWorkerOptions.workerSrc = false` **禁用 worker**，在主线程渲染（避免 Next.js 静态导出/开发环境下 worker 路径解析失败的问题）；
  - `scale = 2` 表示 2× 渲染（2× 分辨率，高清晰度 PNG，适合 Retina 屏或打印）；
  - PDF 点（pt）是 PDF 的逻辑尺寸单位（1pt = 1/72 英寸），`scale = 2` 实际是把 1pt 渲染为 2 个像素，渲染出的 PNG 分辨率是原 PDF 尺寸的 2 倍。

---

### 3.3 PDF 水印

#### 功能需求
- 支持上传单个 PDF 文件；
- 支持文字水印：输入文字、字体大小、颜色、透明度、旋转、位置；
- 支持图片水印：上传 PNG/JPG，调整大小、透明度、位置、旋转；
- 位置选项：居中、左上、右上、左下、右下、**多行平铺**；
- **多行平铺模式**：
  - 把同一个水印按网格铺满整个 PDF 页面；
  - 滑块控制行间距大小，左端"行间距小"（密集，水印刚好接边），右端"行间距大"（稀疏，水印之间 50% 间隙）；
  - **保证文字永远不重叠**：滑块范围 1.0 - 1.5，下限 1.0 = 刚好接边（最密集，每个水印独立），上限 1.5 = 50% 间隙（最稀疏）；
  - 默认值为 1.1（10% 间隙），A4 页面默认字号（48pt）+ 旋转 45° 时约生成 3×4 = 12 个水印；
  - 自动考虑旋转角度：旋转后水印在水平/垂直方向的实际占用空间 = `W·cosθ + H·sinθ`，按此计算网格间距，**任何 spacingRatio < 1.0 都会导致相邻水印的文字相互覆盖**（因为 effectiveW 已经是旋转后水印水平方向的最大跨度）。
- 已选文件可通过"重新选择"按钮（灰底样式：`bg-gray-100` + `text-gray-600`）一键清空当前选择；
- 处理完成后提供"预览文件"按钮，点击在新窗口打开带水印的 PDF 预览；
- 下载带水印的 PDF。

#### 软件需求
- 使用 `pdf-lib` 的 `drawText()` 和 `drawImage()`；
- 文字水印使用标准字体（Helvetica），中文支持后续扩展；
- 图片水印需将图片嵌入 PDF；
- 每页都绘制水印；
- 透明度通过 `setOpacity` 实现；
- 旋转通过 `rotateDegrees` 实现；
- 限制上传 PDF ≤ 100MB；
- **位置类型定义**（`WatermarkPosition`）：
  - `center` / `topleft` / `topright` / `bottomleft` / `bottomright`：单点位置；
  - `tile`：多行平铺；
- **平铺位置算法**：
  - 根据旋转角度计算水印在水平/垂直方向的最大跨度 `W' = W·cosθ + H·sinθ`、`H' = W·sinθ + H·cosθ`；
  - 间距 = `effective × spacingRatio`，`spacingRatio` 由 UI 滑块控制（范围 **1.0 - 1.5**，步长 0.05）；
  - `spacingRatio = 1.0`：相邻水印刚好接边（最密集，文字互不重叠）；
  - `spacingRatio = 1.1`：相邻水印 10% 间隙（默认值）；
  - `spacingRatio = 1.5`：相邻水印 50% 间隙（最稀疏）；
  - **不允许 `spacingRatio < 1.0`**：因为 `effectiveW` 已经是旋转后水印水平方向的最大跨度，任何 `spacingRatio < 1.0` 都会导致相邻水印文字相互覆盖。

---

### 3.4 图片压缩

#### 功能需求
- 支持上传单张或多张图片；
- **支持格式**：JPG、PNG、WebP、BMP、GIF（**静态 + 动画，完整支持保留动画**）；
- **可调节压缩质量**（10%–100%）——**仅对 JPG / PNG / WebP 有效**；
- **GIF 颜色数控制**（8 / 16 / 32 / 64 / 128 / 256）——**仅对 GIF 有效**，默认 128；
- 可选择输出格式：保持原格式 / JPG / PNG / WebP / **GIF**；
- **输出 GIF 的限制**（重要边界条件）：
  - **仅当输入为 GIF 时才能输出 GIF**；其他格式（PNG/JPG/WebP/BMP）不能转换为 GIF，UI 在压缩时对该文件报 `UNSUPPORTED_FORMAT` 错误（其他文件继续处理，不中断整批）；
  - 输入为 GIF、输出选 `JPG/PNG/WebP` 时**也拒绝**（避免职责重叠，引导用户用「格式转换」工具做跨格式转换）；
  - 输出 GIF **保留原始动画**（帧数、帧延迟、透明度）；
  - 颜色数越小文件越小，但视觉质量越低（出现色块 / 噪点）；8 色 + 透明时实际可视颜色仅 7 色（1 个调色板槽位被透明度占用）；
  - **重新压缩可能比原文件大**：因为重编码为全帧 + dispose=2，会丢失原 GIF 的帧间优化（如「只更新变化像素」的 partial frame）。这是已知 trade-off，UI 正常显示「压缩率 -X%」即可；
- 可设置最大宽度 / 高度限制（按比例缩放，**永不放大**）；
- 显示原图大小、压缩后大小、压缩率；
- **GIF 结果额外显示**：原始尺寸（`width × height`）、帧数、使用的颜色数（`info: "320×240 · 24帧 · 128色"`）；
- 支持单张下载和批量 ZIP 下载。

#### 软件需求
- **架构**：`compressImage()` 在 `lib/image/compress.ts` 中作为**分发器（dispatcher）**，按输入 MIME 类型分发：
  - 输入 MIME 为 `image/gif` 且输出 `original` 或 `gif` → 调用 `lib/image/compress-gif.ts` 的 `compressGif()`；
  - 输入 MIME 为 `image/gif` 且输出 `jpeg/webp/png` → 抛出 `UNSUPPORTED_FORMAT` 错误（提示用户改用「格式转换」工具）；
  - 输入 MIME 非 `image/gif` 且输出 `gif` → 抛出 `UNSUPPORTED_FORMAT` 错误（提示用户先转换为 GIF 再压缩，但本工具不提供此转换）；
  - 其他情况 → 调用 `browser-image-compression` 原有路径（逻辑不变）；
- **GIF 解码**：使用 [`gifuct-js`](https://www.npmjs.com/package/gifuct-js) 的 `parseGIF()` + `decompressFrames(buildPatch=true)`：
  - `decompressFrames` 返回的是**patch 矩形**（位于 `(dims.left, dims.top)`、尺寸 `dims.width × dims.height`），不是全屏；
  - **必须手动应用 disposal method**（0/1/2/3）以正确合成每一帧的全屏 RGBA 缓冲：
    - 处理当前帧前，先按**上一帧**的 `disposalType` 处理画布：
      - 上一帧 `disposal=2`（restore to background）：`ctx.clearRect(prev.dims.left, prev.dims.top, prev.dims.width, prev.dims.height)`；
      - 上一帧 `disposal=3`（restore to previous）：用预先保存的 `ImageData` 调 `ctx.putImageData()` 恢复；
      - `disposal=0/1`：不动；
    - 如果**当前帧**的 `disposal=3`，需先备份 `ImageData`（用于处理下一帧时恢复）；
    - 绘制当前帧 patch：`ctx.putImageData(new ImageData(f.patch, f.dims.width, f.dims.height), f.dims.left, f.dims.top)`；
    - 快照全屏 `ctx.getImageData(0, 0, width, height)` → `Uint8ClampedArray`（每帧的完整 RGBA）；
  - 帧延迟 `delay` 从 `gifuct-js` 拿到的是毫秒（已乘 10）；编码时 clamp 到 `≥ 20ms`（避免浏览器跳过超快帧）；
  - 检测透明度：检查 `frame.transparentIndex !== undefined` 或扫描全屏 RGBA 中是否有 alpha < 255 的像素；
- **GIF 编码**：使用 [`gifenc`](https://github.com/mattdesl/gifenc) 的 `quantize()` + `applyPalette()` + `GIFEncoder().writeFrame()`：
  - **每帧独立调色板**（per-frame palette），质量更好（trade-off：比全局调色板文件略大）；
  - 有透明度的帧：`format: "rgba4444"` + `oneBitAlpha: true`，palette 预留索引 0 为透明（实际可视颜色 = `colors - 1`）；
  - 无透明度的帧：`format: "rgb565"`（默认）；
  - 写入时统一设置 `dispose: 2`（restore to background）+ `repeat: 0`（无限循环），与绝大多数动画 GIF 行为一致；
  - 可选 `maxWidth/maxHeight` 缩放：用 Canvas 重采样每帧 RGBA（**永不放大**：`scale = min(maxW/w, maxH/h, 1)`）；
- **依赖**：`gifenc@^1.0.3`、`gifuct-js@^2.1.2`：
  - 均为纯 JS，无 Web Worker / Node API / SharedArrayBuffer 依赖，与 Next.js 静态导出完全兼容；
  - bundle 影响：压缩页增加约 **15 KB gzipped**（其他路由不加载，因为是 route-level code splitting）；
- **Canvas context 优化**：所有频繁调用 `getImageData` 的 canvas 必须用 `getContext("2d", { willReadFrequently: true })`，避免 Chrome 性能警告；
- 限制单文件 ≤ 20MB，批量总大小 ≤ 100MB（与其他图片工具一致）；
- 错误码：
  - GIF 解码失败 / 帧数为 0 → `PROCESS_FAILED`；
  - 非 GIF 输入 + 输出 GIF → `UNSUPPORTED_FORMAT`；
  - GIF 输入 + 输出非 GIF → `UNSUPPORTED_FORMAT`（引导用「格式转换」）。

---

### 3.5 图片格式转换

#### 功能需求
- 支持上传单张或多张图片；
- 支持目标格式：JPG、PNG、WebP、BMP；
- 支持设置输出质量（JPG/WebP）；
- 透明背景处理：PNG/WebP 保留，JPG 自动填充白色；
- 显示转换前后格式和大小；
- 支持批量 ZIP 下载。

#### 软件需求
- 使用 Canvas `drawImage()` + `toBlob()`；
- 封装 `convertImage(file, targetFormat, quality)` 函数；
- 透明像素转 JPG 时填充白色背景；
- **BMP 输出自己实现编码**（浏览器 Canvas API 不支持 `canvas.toBlob("image/bmp")`）：用 `getImageData` 获取 RGBA 像素数据，手工组装 24-bit BMP 格式（BITMAPFILEHEADER 14 字节 + BITMAPINFOHEADER 40 字节 + BGR 像素数据，每行 4 字节对齐，倒序存储）；
- 文件名替换扩展名；
- 限制单文件 ≤ 20MB。

---

### 3.6 图片缩放 / Downsize

#### 功能需求
- 支持按指定宽度/高度缩放；
- 支持按百分比缩放（如 50%）；
- 支持锁定宽高比；
- 支持选择缩放算法：快速 / 高质量（Lanczos，可选）；
- 显示原尺寸和新尺寸；
- 支持批量处理。

#### 软件需求
- 使用 Canvas 或 `pica` 库；
- 如果只填宽度，按比例计算高度；
- 如果都填，按 fit 或 stretch 模式处理；
- 输出格式与原图一致或用户指定；
- 限制输出像素尺寸 ≤ 4096×4096。

---

### 3.7 图片快速裁剪 / Fast Crop

#### 功能需求
- 支持上传单张图片（PNG、JPG、JPEG、WebP、BMP、GIF）；
- 支持 5 种固定比例裁剪：1:1、4:3、16:9、3:4、9:16；
- 支持旋转图片（90° 增量：0°/90°/180°/270°）；
- 支持翻转图片（水平翻转、垂直翻转，**预览实时反映**）；
- 显示原始图像信息条（分辨率、文件类型、文件大小）；
- 已选文件可通过"重新选择"按钮（灰底样式：`bg-gray-100` + `text-gray-600`）一键清空当前选择；
- 裁剪完成后提供"预览"按钮（眼睛图标），点击在新窗口打开裁剪结果；
- 下载裁剪结果，文件名：`原文件名_cropped.扩展名`。

#### 软件需求
- 使用 `react-easy-crop` 实现裁剪框 UI；
- **不提供"自由"裁剪按钮**：react-easy-crop v5/v6 库基于 `aspect` prop 锁定比例，不支持真正的"自由"模式（作者也明确说过这是库的核心设计），因此只提供 5 种固定比例；
- **翻转功能**通过预处理 image src 实现：`<Cropper>` 不支持 `flipX/flipY` props，所以用 Canvas 临时翻转原图生成新的 dataURL 传给 Cropper；`translate(canvas.width, 0)` + `scale(-1, 1)` 实现水平翻转，垂直翻转同理；
- 读取原图分辨率用 `HTMLImageElement.naturalWidth / naturalHeight`；
- 裁剪结果用 Canvas `drawImage` 提取目标区域并 `toBlob()` 编码；
- 旋转后用 Canvas 变换矩阵（`translate` + `rotate` + `scale`）绘制；
- 限制单文件 ≤ 20MB。

---

### 3.8 图片扩展填充 / Padding

#### 功能需求
- 支持上传单张图片（PNG、JPG、JPEG、WebP、BMP、GIF）；
- **不缩放原图**，原图 1:1 放置在扩展后画布上；
- **两种扩展模式**（用户任选其一）：
  1. **按 4 边像素**：分别指定上/下/左/右 4 个方向各扩展多少像素；
  2. **按画布尺寸 + 中心偏移**：指定扩展后画布的总宽 × 总高，以及原图中心点相对画布中心的水平/垂直偏移（`dx`, `dy`，可正可负）；
- 支持背景颜色：白色、纯色、PNG 透明；
- 支持输出格式：保持原格式、JPEG、PNG、WebP；
- 实时显示扩展后的总尺寸 / 各边扩展量；
- 常用尺寸预设：1 寸证、2 寸证、小红书封面、微信公众号封面、Instagram 方形（点预设后自动填入画布宽高，dx/dy 归零）；
- 显示输出尺寸、预览、下载。

#### 软件需求

**模式 1：按 4 边像素**
```
outputWidth  = originalWidth  + paddingLeft + paddingRight
outputHeight = originalHeight + paddingTop  + paddingBottom
drawX = paddingLeft
drawY = paddingTop
```

**模式 2：按画布 + 中心偏移**
```
outputWidth  = canvasWidth
outputHeight = canvasHeight
baseX = (canvasWidth  - originalWidth)  / 2   // 居中
baseY = (canvasHeight - originalHeight) / 2
drawX = clamp(baseX + dx, 0, canvasWidth  - originalWidth)
drawY = clamp(baseY + dy, 0, canvasHeight - originalHeight)
```

**校验规则**
- 模式 1：4 边像素必须 ≥ 0；
- 模式 2：`canvasWidth ≥ originalWidth` 且 `canvasHeight ≥ originalHeight`；`dx`/`dy` 范围保证 `drawX ≥ 0` 且 `drawY ≥ 0`；
- 任一校验失败，给出明确中文错误提示。

**实现**
- 读取原图用 `HTMLImageElement`，从 `naturalWidth/Height` 获取原始像素尺寸；
- 用 Canvas `drawImage(img, drawX, drawY, originalWidth, originalHeight)` 1:1 绘制原图；
- 背景用 `ctx.fillRect` 填充；
- `canvas.toBlob()` 输出 Blob；
- 文件名：`原文件名_padded.扩展名`。

**移除旧模式**：
- ❌ 移除"等比缩放居中"模式（fit-center，原图被缩小，不属于 padding）；
- ❌ 移除"拉伸填充"模式（stretch，原图被拉伸变形，不属于 padding）；
- ❌ 移除"原始尺寸居中"模式（original-center，已被模式 2 覆盖）；
- ❌ 移除"常用尺寸预设"（1 寸证、2 寸证、小红书、公众号、Instagram）；
- ✅ 画布模式初始值 = 原图尺寸（上传图片后自动同步），用户可自由修改；
- ✅ 保留"背景颜色 / 透明背景 / 输出格式 / 质量"选项。

---

### 3.9 图片参数化裁剪 / Parameter Crop

参数化裁剪与"快速裁剪"的区别：快速裁剪是固定比例的 UI 拖动裁剪（适合社交媒体头像、封面等场景）；参数化裁剪是通过**精确坐标**或**自由拖动**指定任意位置的矩形区域（适合批量处理、自动化脚本、像素级精确提取）。

#### 功能需求
- 支持上传单张图片（PNG、JPG、JPEG、WebP、BMP、GIF）；
- 预览区域为**固定高度 320px**、全宽的容器，图片用 `object-fit: contain` 等比居中显示，容器背景为暗色（深灰 `#111827`）模拟 letterbox；
- **两种裁剪方式**（任选其一或结合使用）：
  1. **拖动裁剪框**：在预览区直接用鼠标 / 触屏拖动裁剪框平移，实时联动坐标输入框；
  2. **输入坐标**：表单输入左上 (x1, y1) 和右下 (x2, y2) 四个原图像素坐标，精确控制裁剪区域；
- 显示原始图像信息条：原始分辨率（`naturalWidth × naturalHeight`）、当前裁剪区域尺寸、文件大小；
- 上传图片后默认裁剪框为**中央 80% 区域**（四周各留 10% 边距）；
- 拖动裁剪框时自动 clamp 到原图边界内，不会拖出图片；
- 坐标输入支持非负整数，越界值在 `handleProcess` 时由 `cropImageByRegion` 校验；
- 已选文件可通过"重新选择"按钮（灰底样式：`bg-gray-100` + `text-gray-600`）一键清空当前选择；
- 裁剪完成后提供"预览"按钮（眼睛图标），点击在新窗口打开裁剪结果；
- 下载裁剪结果，文件名：`原文件名_cropped.扩展名`；
- 支持输出格式：保持原格式 / JPEG / PNG / WebP；JPEG 和 WebP 时显示质量滑块（10-100，默认 92）；
- **不支持**旋转、翻转（这两个特性由"快速裁剪"工具承担，避免功能重复）；
- 限制单文件 ≤ 20MB。

#### 软件需求
- **预览区域布局**：
  - 容器：`<div className="relative w-full overflow-hidden rounded-xl bg-gray-900" style={{ height: '320px' }}>`；
  - 图片：`<img className="absolute inset-0 h-full w-full object-contain" />`（关键：用 `object-contain` 让图片在容器内等比居中，超出部分留暗色 letterbox）；
  - 裁剪框：`<div className="absolute cursor-move border-2 border-brand-500 bg-brand-500/20" />`，位置由 `displayInfo.offsetX/Y` + `rect × displayInfo.scale` 算出。
- **`calcDisplayInfo` 函数**（实现 CSS `object-fit: contain` 的核心算法）：
  ```
  scale     = min(containerW / imageW, containerH / imageH)
  displayW  = imageW  * scale
  displayH  = imageH  * scale
  offsetX   = (containerW  - displayW) / 2
  offsetY   = (containerH - displayH) / 2
  ```
  裁剪框在容器中的坐标 = `offsetX + 原图坐标 × scale`；
- **尺寸变化监听**：用 `ResizeObserver` 监听容器尺寸变化 + `window.resize` 事件，任何一边变化就重算 `displayInfo`，裁剪框位置始终对齐图片实际显示位置（不依赖图片 `onLoad` 单次触发）；
- **拖动实现**：用 `pointerdown / pointermove / pointerup` 事件（同时支持鼠标和触屏），移动时根据 `dx / dy` 在原图坐标系下平移裁剪框，并 clamp 到 `[0, naturalW - cropW]` / `[0, naturalH - cropH]` 范围；
- **裁剪核心**：调用 `cropImageByRegion(file, { x, y, width, height, format, quality })`（已在 `src/lib/image/crop.ts` 实现），从原图直接 1:1 提取目标区域，不缩放不变形；
- **边界校验**：`cropImageByRegion` 内部检查 `x >= 0 && y >= 0 && x + width <= naturalWidth && y + height <= naturalHeight`，越界抛出 `INVALID_INPUT` 错误并附图片尺寸提示；
- **不缩放原则**：与"快速裁剪"不同，参数化裁剪不做任何缩放变换，输入坐标即输出坐标，`cropImageByRegion` 不接受 `rotation / flipX / flipY` 参数；
- 复用 `lib/file` 中的 `readFileAsDataURL`、`downloadBlob`、`generateOutputFilename`、`formatFileSize`；
- 复用 `components/common/ErrorAlert` 统一错误展示，复用 `components/common/ProcessProgress` 显示处理中状态。

---

## 4. 非功能需求

| 类别 | 需求 |
|------|------|
| 性能 | 大文件处理使用 Web Worker；避免同时处理过多文件；提供取消按钮 |
| 兼容性 | 支持 Chrome、Edge、Firefox、Safari 最新两个主版本；移动端基本可用 |
| 安全 | 不收集用户文件；不上传文件到服务器；分析脚本不读取文件内容 |
| 可访问性 | 按钮有明确 label；颜色对比度符合 WCAG 2.1 AA；支持键盘操作 |
| SEO | 每个页面独立 meta；生成 sitemap；添加 JSON-LD |
| 部署 | 静态导出到 `out/`；部署到 Cloudflare Pages；配置自定义域名（可选） |
| 反馈 | 每个工具页底部有反馈入口；首页有"关于我们"链接（`/about#contact`），联系邮箱 `hjx0827@foxmail.com` |

---

## 5. 第一阶段不做的事

- AI 抠图（模型大、加载慢、效果不稳定）；
- PDF 压缩（纯前端效果有限，容易让用户失望）；
- PDF 转 Word/Excel/PPT；
- OCR 文字识别；
- 视频处理；
- 用户系统/登录/云存储；
- 多语言；
- 高级付费功能。
