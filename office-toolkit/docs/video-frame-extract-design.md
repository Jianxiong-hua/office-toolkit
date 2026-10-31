# 视频提取图片（设计）

日期：2026-10-26
状态：设计已确认，未开工
入口：`/tools/video/frames/`

## 目标

把视频按「起止时间 + 每隔 N 帧取 1 张」导出成图片序列，直接落在用户选择的目录里。

| 项 | 取值 |
| --- | --- |
| 提取规则 | 起点 / 终点（秒）+ 每隔 N 帧取 1 张 |
| 图片格式 | PNG 或 JPEG（质量可调，默认 JPEG 0.92） |
| 落盘 | 目录写入（Chromium）/ ZIP 下载（其他浏览器） |
| 分辨率 | 保持源分辨率，不缩放 |
| 处理位置 | 全部在浏览器本地，不上传 |

## 已确认决策（2026-10-26）

| # | 决策 | 选择 | 被否方案与理由 |
| --- | --- | --- | --- |
| 1 | 提取规则 | 起止时间 + 每隔 N 帧（N=0 每帧）；**跨步 = N+1**（N=1 表示每 2 帧取 1 张） | 目标帧率（fps）输入：与「每隔 N 帧」是同一件事的两种说法，只保留一种；指定时间点列表：需按时间 seek 到关键帧再解码到目标帧，精度受 GOP 影响，UI 多一块输入区 |
| 2 | 落盘 | FS Access 目录写入为主 + ZIP 兜底 | 仅 ZIP：JSZip 全内存打包，2000 张 1080p 必炸；仅目录写入：Safari/Firefox 完全不支持该 API |
| 3 | ZIP 模式上限 | 300 张 | 不设限：全内存打包，体积与帧数线性叠加 |
| 4 | 图片格式 | PNG / JPEG 下拉，默认 JPEG 0.92 | WebP：Safari 上 `canvas.convertToBlob({type:"image/webp"})` 会静默回退成 PNG，用户以为选到实际没有 |
| 5 | 帧数预警 | 软预警：预估 > 500 张时显示张数/体积/耗时，不阻断、不设硬上限 | 强制勾选确认：多一步交互；5000 帧硬上限：替用户做决定，误操作的根源是「N=0 每帧」这个显式选择本身 |
| 6 | 命名 | 目录 `{视频名}_frames/`，文件 `frame_000001.ext`（6 位，从导出第 1 张连续编号） | 用源帧序号命名（跳步后会不连续，排序看着别扭） |
| 7 | 兼容路径帧数上限 | 1000 张 | 不设限：ffmpeg 一次 exec 期间整段帧堆在 MEMFS，1000 张 1080p PNG ≈ 2.5 GB |
| 8 | 引擎选择 | 能力够就走快路径，否则自动回退兼容路径（结果卡片标注引擎） | 显式开关（GIF 工具的做法）：GIF 的快/慢路径产物不同（调色板策略），提取的产物逐像素一致，让用户开关没有意义 |
| 9 | 兼容模式的源文件上限 | **200MB 硬上限**，超过一律不支持（提示先转 MP4 走极速模式）；极速模式无此限制（4GB） | 沿用 2GB + WORKERFS 挂载：实测 2.13GB/3635 秒的 MKV 逐帧解码在 wasm 里要几十分钟且必然被 30 分钟 exec 超时打断，等于给了个跑不完的入口 |
| 10 | 只解关键帧（I 帧）加速 | **不做**（用户 2026-10-31 明确否决） | 只解 I 帧可把解码量降到 1/50~1/250，但取样点由 GOP 决定、不再是精确的「每隔 N 帧」，用户要求严格保留精确帧序 |

## 技术方案

### 页面结构

`src/app/tools/video/frames/page.tsx`，复用现有组件：

- `ToolLayout` + `FileDropZone`（单文件，`accept="video/*"`）
- `VideoTrimEditor`（起止时间，与压缩/GIF 页一致）
- 参数区：每隔 N 帧（数字输入，0 = 每帧）、格式（PNG/JPEG）、JPEG 质量（0.5~1.0，仅 JPEG 时显示）
- 输出位置：Chromium 显示「选择输出文件夹」，其他浏览器显示「下载 ZIP」
- 进度：已导出 N 张 / 预计 M 张；转换中显示秒表（兼容路径拿不到中间进度）
- 结果卡片：张数、总体积、耗时、引擎（WebCodecs / 兼容模式）、输出位置或下载按钮

### 快路径（Chromium + MP4/MOV + H.264）

新增 `src/lib/video/extractFrames.ts`，复用 `fastGif.ts` 已验证的解码骨架：

```
parseMp4（mp4box 跳读 moov，按顶层 box 跳过 mdat）
  → 样本表 + 关键帧对齐 fromIdx
  → VideoDecoder（prefer-software，理由同 fastGif：软解帧本就在内存里）
  → output 回调：按展示序计数 i，i % (N+1) === 0 才处理
  → canvas 缩放/旋转烘焙（复用 fastCompress 的 isRotated / rotationTransform）
  → convertToBlob({ type, quality })
  → 写盘或塞进 ZIP
  → frame.close()
```

- 帧数预估：统计样本表中 `cts/timescale ∈ [start, end]` 的数量 total，导出数 = `ceil(total / (N+1))`，**精确**
- 内存 O(1)：一次只有一张图在内存里（ZIP 模式除外）
- 取消：`decoder.close()` + reject，与 `fastGif` 同一套 `cancelReject`

### 兼容路径（WebM / MKV / AVI / 非 H.264）

在 `ffmpeg.ts` 新增 `runImageSequence()`（新函数，不动已跑通的 `runConversion`）：

```
ffmpeg -ss {start} -to {end} -i input.ext \
  -vf "select=not(mod(n\,{N+1}))" -fps_mode passthrough \
  [-q:v 2] frame_%06d.{jpg|png}
```

- N=0 时省略 `select` 与 `fps_mode`（全帧 passthrough）
- `-q:v` 仅 JPEG 传（2 ≈ 高质量）；PNG 不传
- 强制单线程 core（`multiThread: false`）：`core-mt` 在解码阶段实测卡死，见 `ffmpeg.ts` 注释
- 执行完用 `listDir` 逐张 `readFile` → 写盘 → `deleteFile` 清理
- 帧数上限 1000：超限时禁用开始按钮并提示「请用 Chrome/Edge，或缩短截取范围」

**已知限制**：一次 exec 期间所有帧都堆在 MEMFS（进程内无法读取），所以内存峰值 = 帧数 × 单张体积。这是兼容路径设上限的唯一原因。

### 落盘

新增 `src/lib/fs/save.ts`（两个工具共用）：

- `supportsDirectoryPicker()`：`typeof window !== "undefined" && "showDirectoryPicker" in window`
- `pickDirectory()` → `showDirectoryPicker({ mode: "readwrite" })`
- `ensureSubdirectory(parent, name)` → `getDirectoryHandle(name, { create: true })`
- `writeInto(dir, name, blob)` → `createWritable()` → `write` → `close`
- 目录已存在时自动加序号（`{stem}_frames-2`），避免覆盖上次结果

ZIP 兜底：`jszip`，`compression: "STORE"`（图片已是压缩格式，deflate 只费 CPU 不减体积），内部路径 `{stem}_frames/frame_000001.jpg`，解压即得同名文件夹。

### 帧数预警

| 依据 | 精确度 |
| --- | --- |
| 快路径 | 样本表精确计算 |
| 兼容路径 | ffmpeg 流信息里的 `xx fps × 截取时长 / (N+1)`，标注「约」 |

黄条文案（草稿，提交前需逐字过目）：「预计导出约 1800 张，约 2.1 GB，约 90 秒。文件较多时会占用磁盘空间，可增大「每隔 N 帧」减少数量。」

### 错误处理

| 场景 | 行为 |
| --- | --- |
| 起止时间非法 / 区间内无帧 | `INVALID_INPUT`，提示调整时间 |
| 快路径解析/解码失败（非 MP4、非 H.264、解码器报错） | 自动回退兼容路径，结果卡片标注「兼容模式」 |
| 兼容路径 exec 失败 | `PROCESS_FAILED`，保留「改用 Chrome/Edge 走快路径」提示 |
| 目录授权被撤销 / 写入失败 | 明确报错，并说明已写入的张数（不静默丢图） |
| 导出中取消 | `CANCELLED`，已写入的图片保留（提示用户可删除该文件夹） |

## 风险与代价

| 风险 | 处理 |
| --- | --- |
| 快路径与 `fastGif.ts` 约 150 行重复（moov 跳读、样本批读、解码器配置） | 刻意接受：`fastCompress.ts` 已有一次同样的重复，抽公共模块要动三条已跑通的流水线，风险大于收益 |
| 兼容路径 1000 张上限 | 提示走 Chrome；根治要分段 exec（按时间切块，每块跑完读回并 delete），涉及块边界关键帧与序号连续，未实施 |
| ZIP 300 张上限 | 提示走 Chrome/Edge 用目录写入 |
| 目录写入每张一次 `createWritable` | 单张写入开销约 1 ms 量级，相对 JPEG 编码（5~10 ms）可忽略 |
| Safari/Firefox 目录选择不可用 | 自动切 ZIP 模式，UI 上提前说明 |

## 验收标准

1. 1080p / 30fps / 10 秒素材，N=0 / N=1 / N=29 → 导出 300 / 150 / 10 张
2. 旋转手机视频（matrix 90°）导出图片方向正确
3. 起止边界：首张 = 起点之后的第一个命中帧，末张不超过终点
4. N=0 大素材：导出期间内存平稳（无持续上涨）
5. 非 H.264（WebM/MKV）→ 自动走兼容路径，产物正确
6. ZIP 模式 300 张上限、兼容路径 1000 张上限均生效
7. 目录已存在时自动加后缀，不覆盖旧文件
8. 取消可用；`npm run validate` 通过；dev 页面 200

## 实施记录（2026-10-27）

| 项 | 文件 | 说明 |
| --- | --- | --- |
| 新增 | `src/lib/fs/save.ts` | FS Access 封装：`supportsDirectoryPicker` / `pickDirectory` / `ensureUniqueSubdirectory`（重名自动 `-2` 后缀）/ `writeBlobInto`；另含 `supportsSaveFilePicker` / `pickSaveFileStream` 供「图片合成视频」用 |
| 新增 | `src/lib/video/extractFrames.ts` | 快路径：mp4box 跳读 → `VideoDecoder`(prefer-software) → 按展示序计数取模步进 → canvas 旋转烘焙 → `convertToBlob` → sink；导出 `readFastVideoInfo` / `countFramesInRange` |
| 新增 | `src/lib/video/ffmpegSequence.ts` | 兼容路径执行器：WORKERFS 挂载或 MEMFS 写入 → exec → `listDir` 逐个 `readFile` 并删除 → 交给 `onFile`；取消走 `terminate` + race |
| 新增 | `src/lib/video/extractFramesCompat.ts` | 组装 ffmpeg 参数（`-ss`/`-t` 前置、`select=not(mod(n\,N+1))`、`-fps_mode passthrough`、`-q:v`），上限 `COMPAT_MAX_FRAMES=1000` / 2GB |
| 新增 | `src/app/tools/video/frames/page.tsx` | 页面：拖入 / 预览 / 截取 / 每隔 N 帧 / 格式与质量 / 张数预警 / 目录写入或 ZIP / 进度 / 取消 / 结果 |
| 修改 | `src/types/video.ts` | 新增 `FrameImageFormat` / `ExtractFramesOptions` / `FrameSink` / `ExtractFramesResult` / `ExtractEngine` / `VideoFrameStats` |
| 修改 | `src/config/tools.ts` | 新增 `video-extract-frames` 条目（文案经用户确认） |

### 实现期补充的决策（原方案之外）

1. **子目录懒创建**：在第一次保存时才建 `{视频名}_frames`，因此快路径整体失败回退时不会留下空文件夹
2. **张数预估**：快路径按样本表精确计算；兼容路径按「30fps × 截取时长」粗估，UI 上标注「约」并说明依据
3. **扩展名定格**：启动时用局部变量固定 `jpg/png`，运行中改选项不会让同一批文件扩展名不一致
4. **取消分发**：按「当前实际引擎」决定打断哪条流水线（回退到兼容路径后仍能正确取消）
5. **失败回退条件**：仅当「快路径一张都没写出去」时自动回退兼容路径，避免重复写入

### 验证

- `npm run validate`（tsc --noEmit）：通过
- `npm run build`（含静态导出）：通过；`out/tools/video/frames/index.html` 生成，`out/sitemap.xml` 含该路径，首页出现该工具卡片
- dev server：`/tools/video/frames/` 200
- **未验证**：真实视频下的导出张数与命名、旋转手机视频方向、磁盘落盘、ZIP 兜底、目录重名后缀、取消 —— 需浏览器实测（Node 环境没有 `VideoDecoder` 与 FS Access）

### 修正：去掉事前的「耗时」预估（2026-10-27）

实测反馈：248 张 PNG、720p 素材，界面写「约 7 秒」，实际明显更久——瓶颈是**逐张写盘的磁盘速度**与 PNG 编码，不是解码。

- 已删除导出前的固定秒数（原实现按「PNG 30ms / JPEG 8ms / 兼容 60ms 每张」硬估，必然误导）
- 导出前只保留「张数与体积」预估，并注明「耗时取决于图片编码与磁盘写入速度」
- 运行中改按**实测速率**外推剩余时间：已导出 ≥ 20 张且已用 ≥ 3 秒后才显示「预计还需 N 秒」
- 进度文案补上「已导出 X / Y 张（Z%）· 已用 N 秒」
- 每 50 张打一次 `[extractFrames] 已导出 N 张，均 X ms/张`，用于判断瓶颈在编码还是写盘
- 等待文案改为「正在逐张写入你选择的文件夹：速度受磁盘写入与图片编码限制」

### 修正：兼容模式按解码成本限流 + 解码进度（2026-10-31）

实测复现（2.13GB / 3635 秒 / H.264 Main / MKV，core 为 FFmpeg 5.1，`libavcodec 59.37.100`）：
兼容模式在 exec 期间**没有任何进度上报**（进度回调只挂在读回阶段），界面长期停在「正在准备…」，
看起来等同于卡死；而 1 小时片段逐帧解码在 wasm 里本就要几十分钟以上。

| 改动 | 说明 |
| --- | --- |
| `COMPAT_MAX_CLIP_SEC = 600` | 兼容模式按**截取时长**硬限流（原先只按导出张数限 1000，抓不住「张数少但解码极长」的情况）；超过则禁用并说明原因 |
| `> 120 秒` 软提示 | 建议先截 30~60 秒确认效果 |
| 解码进度 | `runImageSequence` 挂 `ffmpeg.on("progress")`，用 `time / clipDurationSec` 折算比例；`extractFramesCompat` 通过 `CompatHooks.onDecodeProgress` 上报，页面显示「正在解码并抽帧 X% · 已用 N 秒」 |
| 日志不再截断 | 原先只打印前 30 条 stderr，恰好把错误行吞掉；现改为全量打印（单行截断 300 字符），环形缓冲保留 60 条供错误详情 |
| 错误兜底 | 非 `AppError`（worker 用字符串 reject）也统一转成带 `stderr 尾部` 的错误 |

结论：`-fps_mode` 在 5.1 上确实不该用（换 `-vsync 0` 正确）；但这一轮的真正问题是长片段解码在浏览器里不可行 +
进度不可见，而不是参数错误。MKV(H.264) 的正确路径是桌面 `ffmpeg -c:v copy` remux 成 MP4 后走快路径。

### 修正：兼容模式 200MB 硬上限（2026-10-31，用户决定）

| 项 | 行为 |
| --- | --- |
| 兼容模式 | 源文件 > 200MB 一律不支持：选文件时直接拒绝并提示「大文件只能用极速模式，需 H.264 的 MP4/MOV，先转 MP4」；`extractFramesCompat` 内再加一道 `FILE_TOO_LARGE` 防御 |
| 极速模式 | 无此限制（维持 4GB；mp4box 跳读索引、样本按需随机读） |
| 快路径失败回退 | > 200MB 的文件**不再回退**兼容模式（否则会绕过上面的限制） |
| `runImageSequence` | 删除 WORKERFS 挂载分支（兼容模式已不可能处理 > 200MB），输入一律 `writeFile` 进 MEMFS |

验证：`tsc --noEmit` 通过；`/tools/video/frames/` 200。
**未验证**：>200MB 非 MP4 文件的拒绝提示、>200MB MP4 快路径失败时不回退 —— 需浏览器实测。

### 性能实测与结论（2026-10-31）

素材：1080p / 25fps / 截取 1248 秒 / 每隔 300 帧取 1 张（步进 301）/ PNG，导出 371 张、105.5 MB、**357 秒**。
加阶段计时后（每 50 张打印一次）实测：

| 环节 | 每张耗时 |
| --- | --- |
| draw | 1 ms |
| encode（PNG 编码） | 28 ms |
| write（createWritable + write + close） | 136 ms |
| 以上合计 | 165 ms |
| 墙钟均速 | 1028 ms |
| 差额 = 解码 | ≈ 860 ms（301 帧 × 2.9 ms） |

结论：

1. **瓶颈是解码整段，不是写盘**（此前按「写盘主导」判断，实测推翻：写盘只占 13%）
2. 快路径耗时 ≈ 片段总帧数 × 解码成本，**与导出张数几乎无关**；增大「每隔 N 帧」只省磁盘，不省时间
3. 保持精确帧序的前提下没有量级级优化空间：exact-N 必须从关键帧起解到目标帧，省不掉
4. 已按实测改写界面文案：预估行与张数预警都改为「耗时由片段时长决定」，不再暗示「张数多所以慢」
5. **只解关键帧方案已被用户否决**（见决策 10），不再考虑

补充：`均速递增`（388 → 946 ms/张）在本次实测中被证明主要是解码帧数累积所致，不是写盘劣化。

### 第二组实测：步进 11（2026-10-31）

同一素材，每隔 10 帧取 1 张（步进 11），导出 228 张 / 46.4 MB / **29.6 秒**：

| 环节 | 每张 |
| --- | --- |
| draw | 1 ms |
| encode（PNG） | 33 ms |
| write | 92 ~ 98 ms（首批 180 ms，后续稳定） |
| 合计（出口侧） | ≈ 129 ms |
| 墙钟均速 | 130 ms |
| 解码（11 帧 × 2.9 ms ≈ 32 ms） | **被出口侧隐藏，未额外增加耗时** |

与第一组（步进 301）合起来得到的模型：

```
单张耗时 ≈ max(出口侧 ~130 ms, 需解码帧数 × 2.9 ms)
```

- 步进 ≤ ~44 帧（1080p/25fps 约 1.8 秒）时，**张数是唯一成本**，约 7.7 张/秒
- 步进 > 44 帧后，**解码开始主导**（每多解 44 帧 ≈ 增加 130 ms/张）
- 出口侧内部：写盘占 73%（95 ms）、PNG 编码占 25%（33 ms）——想更快只能从这两项里挤
