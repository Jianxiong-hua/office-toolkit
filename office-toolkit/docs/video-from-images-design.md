# 图片合成视频（设计）

日期：2026-10-26
状态：设计已确认，未开工
入口：`/tools/video/from-images/`

## 目标

把一批图片按顺序合成一个 MP4（H.264）视频，支持两种节奏模式，全部在浏览器本地完成。

| 项 | 取值 |
| --- | --- |
| 输入 | 多张图片（PNG / JPEG / WebP / BMP，浏览器能解码的即可） |
| 输出 | MP4 / H.264，无音轨 |
| 节奏 | 模式一：每张停留 N 秒；模式二：每张占 1 帧 |
| 画面 | 输出尺寸可选，等比黑边或等比裁切 |
| 处理位置 | 全部在浏览器本地，不上传 |

## 已确认决策（2026-10-26）

| # | 决策 | 选择 | 被否方案与理由 |
| --- | --- | --- | --- |
| 1 | 引擎 | 仅 `VideoEncoder`(avc) + `mp4-muxer`（两个依赖都已在用） | WebCodecs 主 + ffmpeg 兜底：等于维护两条编码路径，要把所有图先写进 wasm 内存，调试成本等同 GIF 工具；仅 ffmpeg：1080p 软编 2~6 fps，300 张要一两分钟 |
| 2 | 输出尺寸 | 下拉：原始（= 第一张）/ 1080p / 720p / 480p，默认原始 | 固定第一张尺寸：混尺寸素材要么大片黑边要么被迫裁切 |
| 3 | 适配方式 | 单选：等比缩放居中黑边（默认）/ 等比缩放居中裁切 | 拉伸填满：画面变形，直接排除 |
| 4 | 节奏模式 | 模式一「每张停留 N 秒」（默认 2 秒）与模式二「每张 1 帧」并存，fps 共用（默认 30） | 仅模式一：模式二正是「视频提取图片」的逆运算，提取的序列按原帧率合回去才能还原时长；仅模式二：没有停留时长概念，做不了幻灯片 |
| 5 | 排序 | 文件名自然排序（数字感知）+ 上移/下移按钮；>200 张自动切紧凑列表 | 拖拽排序：实现与移动端适配成本明显高于按钮；仅按选择顺序：不同系统/浏览器的 `FileList` 顺序不保证 |
| 6 | 大规模输出 | Chromium 流式写盘（`StreamTarget` + FS Access，内存 O(1)）；其他浏览器 `ArrayBufferTarget` + 总时长 5 分钟硬上限 | 统一内存模式：模式一 1000 张 × 2 秒 ≈ 33 分钟、成品 250~500 MB，直接逼近单页 2 GB 上限 |
| 7 | 音轨 / 转场 | 都不做 | 音轨要处理 AAC 解码与时间戳对齐，工作量远超图像编码本身；转场需要额外帧合成逻辑 |
| 8 | 逐张单独设时长 | 不做 | 每行一个输入框 + 数据模型，典型过度设计 |

## 技术方案

### 页面结构

`src/app/tools/video/from-images/page.tsx`：

- `FileDropZone`（multiple，`accept="image/*"`）
- 图片列表：自然排序后的序号 + 文件名 + 缩略图（>200 张时不加载缩略图，只显示文件名），每项「上移 / 下移 / 删除」
- 参数区：节奏模式（模式一时显示「每张秒数」，模式二时显示说明「张数即帧数」）、fps、输出尺寸、适配方式
- 摘要行：`600 帧 / 20.0 秒 / 1920×1080`
- 输出位置（Chromium 显示「选择保存位置」，其他浏览器常规下载）
- 进度：已编码帧 / 总帧数；结果卡片：文件名、时长、帧数、体积、耗时

不做成片预览：预览等于先整段编码一遍，收益不抵成本。

### 编码流水线

新增 `src/lib/video/imagesToVideo.ts`：

```
按文件名自然排序的 File 列表
  → 首张 createImageBitmap 定输出尺寸（尺寸百分比换算；宽高强制偶数）
  → 逐张：createImageBitmap(file) → OffscreenCanvas 绘制（黑边 or 裁切）
      → new VideoFrame(canvas, { timestamp, duration }) → encoder.encode
      → bitmap.close() / frame.close()
  → encoder.flush() → muxer.finalize()
```

- 帧时间戳：`i * frameDurUs`，`frameDurUs = mode1 ? 1e6 / (secondsPerImage * fps) : 1e6 / fps`
- 背压：`encoder.encodeQueueSize > 8` 时 await，避免整段帧压进内存（4K 位图约 33 MB/张）
- 编码器：`codec = pickAvcCodec(outHeight)`（从 `fastCompress.ts` 导出该纯函数，不改其行为）；`hardwareAcceleration: "prefer-hardware"`，`isConfigSupported` 不支持时降级 `no-preference`；`latencyMode: "quality"`；不传 `frameRate` 给 muxer（`fastCompress` 已踩过「必须正整数」的坑）
- 码率：沿用 bpp 思路但按静态画面下调——`0.04 / 0.025 / 0.015` bpp（高质量/标准/小体积三档不影响 UI，先固定一档，需实测校准），clamp 到 `[300 kbps, 24 Mbps]`
- 进度与计时：每 200 帧打印一次累计耗时（沿用 `fastGif` 的排查习惯）

### 输出与写盘

- **Chromium**：`showSaveFilePicker({ suggestedName: "{首张图名}.mp4" })` → `createWritable()` → `new StreamTarget({ onData: (data, position) => write({ type: "write", position, data }) })`，`fastStart: false`（moov 置尾，写入顺序才能保持流式）
- **其他浏览器**：`ArrayBufferTarget` → `new Blob` → 现有 `downloadBlob` 下载
- 中途取消：`encoder.close()`，已写出的半个 MP4 不可播放，需在提示里说明「文件已生成但不完整，可删除」

### 编辑交互细节

- 自然排序：`Intl.Collator(undefined, { numeric: true, sensitivity: "base" })`
- 上移/下移：交换数组相邻元素；>200 张时列表改为紧凑行（高度 ~32px、无缩略图）
- 秒数 < 1/fps 时按 1 帧处理，并在摘要行提示「每张至少 1 帧」

## 风险与代价

| 风险 | 处理 |
| --- | --- |
| 流式写入依赖 FS Access，仅 Chromium | 其他浏览器走内存模式 + 5 分钟上限，UI 上提前说明上限来源 |
| 5 分钟上限是估算值（1080p30 约 100 MB 量级） | 需实测校准；上限值集中为常量，便于调整 |
| 4K 图片序列内存峰值高 | 背压队列 8 帧 + 逐张 `close()`；必要时在拖入时对 4K×大量给出提示 |
| H.264 要求偶数宽高 | 输出尺寸强制偶数（±1 px 缩放），与 `fastGif` 的 `even()` 同口径 |
| 大尺寸图片解码慢 | `createImageBitmap` 已带缩放参数能力，但先按「解码原图再 canvas 缩放」实现，实测慢再优化 |
| 静态画面用 CBR 码率可能偏大 | bpp 取低档，实测后校准（写入「待实测校准」） |

## 画质修正（2026-10-31，用户实测反馈「压缩得没法看」）

### 根因

初版把 bpp 固定为 **0.025 且没有画质选项**：1080p30 → 仅 **1.55 Mbps**，
静态幻灯片在有细节的画面（文字、线稿、渐变）上直接糊成色块。设计初稿以为「画面基本静止，
低码率够用」，实测证伪：观众看的是**每一帧的细节**，不是帧间差异。

### 修正

| 项 | 值 |
| --- | --- |
| 画质档位 | **极高** / 高（默认）/ 标准 / 小体积 |
| bpp | 0.25 / 0.12 / 0.06 / 0.03（1080p30 → 15.5 / 7.5 / 3.7 / 1.9 Mbps） |
| 码率上下限 | 0.8 ~ **80 Mbps**（4K30 在极高档需约 62 Mbps，上限不留足会被悄悄截断） |
| 透明度 | 参数区摘要行显示「预计码率 + 成片体积区间」，结果卡显示「实际码率」 |
| 计算复用 | 新增 `targetBitrate(width, height, fps, quality)`，页面预估与实际编码共用 |

体积估算给区间（下限 = 目标码率 × 时长 / 8，上限 = 下限 × 1.4）：实测 228 张 / 每张
1 帧 / fps 10 / 2.49 Mbps，估 6.8 MB、实际 8.05 MB（+18%）。原因是每张一帧时**每帧都是
场景切换**，编码器基本全出 I 帧，硬件编码压不到目标码率。

**未验证**：高/标准/小体积三档的实际观感与体积；若高档仍不够，下一步可加「软件编码」
（`hardwareAcceleration: "prefer-software"`，x264 软编同码率下质量更高，但慢数倍）。

## 待实测校准参数

| 参数 | 初值 | 校准依据 |
| --- | --- | --- |
| 每帧 bpp | 0.12 / 0.06 / 0.03 | 100 张 1080p、模式一 2 秒，看体积与画质 |
| 非 Chromium 总时长上限 | 5 分钟 | 内存峰值实测 |
| 编码队列长度 | 8 帧 | 4K 素材内存峰值 |

## 验收标准

1. 模式一：10 张 × 2 秒 @30fps → 600 帧 / 20.0 秒，可正常播放、无音轨
2. 模式二：300 张 @30fps → 10.0 秒；张数即帧数
3. 混尺寸（横 1920×1080 + 竖 1080×1920）：黑边模式画面完整不变形；裁切模式无黑边
4. 自然排序：`frame_2` 排在 `frame_10` 之前
5. >200 张时切紧凑列表，滚动不卡
6. Chromium 流式写盘：6000 帧任务内存平稳，产出文件可播放、时长正确
7. 非 Chromium：5 分钟上限生效并给出提示
8. 取消可用；`npm run validate` 通过；dev 页面 200

## 实施记录（2026-10-27）

| 项 | 文件 | 说明 |
| --- | --- | --- |
| 新增 | `src/lib/video/imagesToVideo.ts` | `VideoEncoder`(avc) + `mp4-muxer`：逐张 `createImageBitmap` → canvas 按适配方式绘制 → `VideoFrame` 编码；`FileSystemWritableFileStreamTarget` 流式写盘或 `ArrayBufferTarget` 内存；背压队列 8 帧 |
| 新增 | `src/app/tools/video/from-images/page.tsx` | 页面：多选拖入 / 自然排序列表（≤200 张带缩略图，超出转紧凑行）/ 上移下移删除 / 节奏模式 / fps / 输出尺寸 / 适配 / 内存模式时长上限 / 进度 / 取消 / 结果 |
| 修改 | `src/lib/fs/save.ts` | 新增 `supportsSaveFilePicker` / `pickSaveFileStream`（「另存为」+ 可写流，取消抛 CANCELLED） |
| 修改 | `src/lib/video/fastCompress.ts` | 仅把 `pickAvcCodec` 改为 `export`（复用 H.264 profile/level 选型，函数体未动） |
| 修改 | `src/types/video.ts` | 新增 `ImagesVideoMode` / `ImagesFitMode` / `ImagesOutputSize` / `ImagesToVideoOptions` / `ImagesToVideoResult` |
| 修改 | `src/config/tools.ts` | 新增 `video-from-images` 条目（文案经用户确认） |

### 实现期补充的决策（原方案之外）

1. **适配用「画布裁切」而非源矩形计算**：`cover` 模式下等比放大后直接绘制越界部分，由 canvas 自动裁剪，省掉一套源矩形/偏移公式
2. **可写流由页面持有并负责 close / abort**：`imagesToVideo` 只写数据不关流，避免库层替调用方决定文件是否落定
3. **取消按编码器关闭 + 拒绝 race**：与 GIF/提取工具同一套模式；取消后已写出的 MP4 不完整，UI 提示由用户自行删除
4. **关键帧交给编码器自决**：不传 `keyFrame`，由 WebCodecs 按 `latencyMode: "quality"` 自行决定 I 帧间隔
5. **第一张位图复用**：首张 `ImageBitmap` 在定尺寸后直接用于绘制，循环结束统一 `close()`

### 验证

- `npm run validate`（tsc --noEmit）：通过
- `npm run build`（含静态导出）：通过；`out/tools/video/from-images/index.html` 生成，`out/sitemap.xml` 含该路径，首页出现该工具卡片
- dev server：`/tools/video/from-images/` 200
- **未验证**：成片能否正常播放、时长/帧数是否与「张数 × 每张帧数」一致、黑边与裁切两种适配的实际观感、流式写盘产物、内存模式 5 分钟上限、取消 —— 需浏览器实测（Node 环境没有 `VideoEncoder` 与 FS Access）
- **待实测校准**：bpp（当前 0.025）、内存模式时长上限（5 分钟）、编码队列长度（8）
