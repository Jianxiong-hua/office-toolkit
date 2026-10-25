# 视频工具提速设计（视频压缩 / 视频转 GIF）

日期：2026-10-25
范围：A 多线程 core（两工具共用）+ B GIF WebCodecs 快路径 + C GIF 滤镜微调 + D 压缩页反向引导

## 目标

| 工具 | 现状瓶颈 | 目标 |
| --- | --- | --- |
| 视频压缩（ffmpeg.wasm） | 单线程 x264，1080p 约 2~6 fps | A 之后 2~3x |
| 视频转 GIF | 单线程软解 + lanczos + 全片 palettegen + LZW | A 之后 2~3x；B 之后 10x 以上 |

不改动：`compress-fast`（WebCodecs 极速压缩）现有实现，A 生效后它也顺带用上多线程 core（取消/重载路径一致）。

## A. 多线程 ffmpeg core

### 原理

`@ffmpeg/core-mt` 是多线程构建，需要 `crossOriginIsolated === true`（即 `SharedArrayBuffer` 可用），否则加载即失败。跨域隔离由两个响应头开启：

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

### 落地方式

1. 新建 `public/_headers`（Next `output: export` 会把 `public/` 原样复制到 `out/`，Cloudflare Pages 读取根目录 `_headers`）：

```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

2. `src/lib/video/ffmpeg.ts` 改造 `ensureLoaded()`：

- 用 `self.crossOriginIsolated === true && typeof SharedArrayBuffer !== "undefined"` 检测是否可用多线程
- 可用 → core-mt 三件套（`ffmpeg-core.js` / `.wasm` / `.worker.js`，全部 `toBlobURL`）
- 不可用 → 现有单线程 core（保持不变）
- core-mt 加载失败（含 `crossOriginIsolated` 已开但 core 拉取失败）→ `terminate()` 后回退单线程重试一次
- `console.info` 打印实际使用的 core 类型与线程数，便于实测确认

3. 单例语义不变：仍然一个全局实例，取消后 `terminate()` 并置空。

### 风险与代价

| 风险 | 处理 |
| --- | --- |
| `COEP: require-corp` 拦截跨域资源 | 站点当前无 Google Fonts 等第三方资源；唯一跨域依赖 unpkg 已返回 `Cross-Origin-Resource-Policy: cross-origin` + CORS，实测可加载 |
| 本地 `next dev` 不应用 `_headers`（CF Pages 特性） | 本地开发自动走单线程 fallback，功能不受影响；多线程效果需在预览环境验证 |
| 部署平台不支持自定义响应头 | 自动 fallback 单线程，不报错 |
| 多线程 core 在低核数设备收益变小 | 无额外代价，仅收益递减 |

### 验收

- 控制台出现 `[ffmpeg] core: 多线程 / 单线程` 日志
- 同一 720p/10s 素材，压缩与 GIF 各跑一次，记录耗时对比
- 取消 → 重新转换仍正常（重载路径）
- `npm run validate` 通过

## B. GIF WebCodecs 快路径

### 定位

`src/lib/video/gif.ts`（ffmpeg 路径）保留为通用兜底；新增 `src/lib/video/fastGif.ts` 走 WebCodecs 硬解 + JS 编码：

```
mp4box 跳读 moov/样本表 → VideoDecoder（硬解优先）→ OffscreenCanvas 缩放/旋转
  → 按 fps 与 speed 抽帧 → gifenc quantize/applyPalette → GIFEncoder 流式写入
```

### 约束（与 compress-fast 同源）

- 输入：MP4/MOV（ISO-BMFF）+ H.264
- 不满足（含 WebCodecs 不可用、解码失败）→ 自动回退 ffmpeg 路径，用户无感

### 关键设计决策

1. **调色板策略 — 待确认**
   - B1（推荐）：每帧独立调色板 + 流式写入。单遍解码，内存 O(1)，最快；代价是体积可能略大、极端画面可能轻微帧间色闪。
   - B2：全局调色板（贴近现有 ffmpeg 输出）。需先采样再编码 = 两遍解码或缓存全部帧 RGB，慢 20%~40% 且宽尺寸下有内存风险。
2. **代码组织**：`fastGif.ts` 独立实现，不回抽 `fastCompress.ts` 的公共模块。刻意接受约 200 行重复（moov 跳读、样本区间、avcC 提取），避免改动已稳定跑通的压缩流水线。可直接复用的导出：`extractAvcCDescription`、`generateOutputFilename`、`readVideoMeta`。
3. **入口 — 待确认**
   - 自动：MP4 + H.264 + WebCodecs 可用时走快路径，结果卡片标注「引擎：硬件加速 / 兼容模式」
   - 显式开关：新增「极速模式」勾选框
4. **进度**：按已编码帧数 / 估算总帧数上报，沿用 `VideoConvertPhase`，不再出现「analyse 阶段无进度」。

### 验收

- 480px / 15fps / 5s 素材：与 ffmpeg 路径对比耗时、体积、播放观感（对齐、循环、速度）
- 非 H.264 或非 MP4（WebM/MKV/AVI）自动回退且结果正确
- 倍速 2x / 0.5x 抽帧节奏正确（帧数 = 时长 / speed × fps）
- 取消可用

## C. GIF 滤镜微调（ffmpeg 路径）

`src/lib/video/gif.ts`：

| 改动 | 理由 | 代价 |
| --- | --- | --- |
| `flags=lanczos` → `bicubic` | wasm 里 lanczos 缩小成本高，GIF 仅 256 色，锐度收益近乎不可见 | 画面略软 |
| `palettegen` 加 `stats_mode=diff` | 只统计变化像素，静态画面多的素材显著更快 | 全静止片段可能丢少量颜色 |
| 加 `-an` | 丢弃音频流，少解析一路 | 无 |

不改：`dither=bayer`（已比 sierra2_4a 快）、滤镜顺序（先缩后调色板，已最优）。

验收：同素材对比改动前后耗时与体积，肉眼检查色带/抖动是否可接受。

## D. 压缩页反向引导

`src/app/tools/video/compress/page.tsx`：选中文件后，若扩展名为 `.mp4/.m4v/.mov` 且 `VideoEncoder` 可用，显示提示条：

> 提示文案待确认（对外可见内容，提交前需逐字过目）

点击跳转 `/tools/video/compress-fast/`，并说明「仅支持 H.264 编码的 MP4/MOV；其他格式请继续使用本工具」。

## 实施顺序

1. A：`public/_headers` + `ffmpeg.ts` 多线程加载与 fallback → 验证 `npm run validate`、dev 页面加载、单线程路径不回归
2. C：gif.ts 滤镜微调 → 验证转换可用
3. D：compress 页提示条 → 验证跳转与条件判断
4. B：`fastGif.ts` + gif 页接入 → 逐条走查（快路径 / 回退 / 倍速 / 取消 / 下载）

## 已确认决策（2026-10-25）

1. B 采用 **B1 每帧独立调色板 + 流式写入**（单遍解码、内存 O(1)）
2. B 采用 **显式「极速模式」开关**：勾选后走 WebCodecs，不满足条件时开关禁用并说明原因，不做静默回退
3. A/B/C/D 全部实施

## 实施记录（2026-10-25）

| 项 | 文件 | 说明 |
| --- | --- | --- |
| A | `public/_headers` | 新增：COOP/COEP 开启跨域隔离（已确认进入 `out/_headers`） |
| A | `src/lib/video/ffmpeg.ts` | `canUseMultiThread()` + `loadCore()`：隔离生效时用 core-mt 三件套，失败或未隔离回退单线程；日志标明实际 core |
| C | `src/lib/video/gif.ts` | `flags=bicubic`、`palettegen stats_mode=diff`、`-an`；返回 `elapsedMs` |
| D | `src/app/tools/video/compress/page.tsx` | 选中 MP4/M4V/MOV 且 WebCodecs 可用时，展示「改用视频极速压缩」提示条 |
| B | `src/lib/video/fastGif.ts` | 新增：mp4box 跳读 → 硬解 → canvas 缩放/旋转 → 按 fps 网格抽帧 → 每帧量化 → gifenc 流式写入；`isFastGifCandidate` 做入口粗筛 |
| B | `src/lib/video/fastCompress.ts` | 仅导出 `isRotated` / `rotationTransform` 供 GIF 复用，逻辑未改 |
| B | `src/types/video.ts` | `VideoGifResult` 加可选 `elapsedMs` |
| B | `src/app/tools/video/gif/page.tsx` | 极速模式开关（不支持时禁用并说明原因）、进度文案分路径、取消分支、结果显示耗时与实际引擎 |

### 验证情况

- `npm run validate`：通过
- `npm run build`（静态导出）：通过，`out/_headers` 内容正确
- dev server：`/tools/video/gif/`、`/tools/video/compress/`、`/tools/video/compress-fast/` 均 200
- **未验证**：真实视频的耗时对比与多线程是否生效。`_headers` 只在 Cloudflare Pages 生效，本地 `next dev` 必然走单线程 fallback，需在部署预览环境用控制台日志 `[ffmpeg] core: 多线程` 确认

### 提交前待确认（对外可见内容）

- D 的提示条文案
- 版本号与 changelog 条目

## 追加修复：analyzing 阶段无进度（2026-10-25 第二轮）

### 现象

兼容模式转 GIF 时长时间停在「第一阶段：分析视频帧，生成全局调色板…」，无百分比，看起来像卡死。

### 根因

1. `palettegen` 必须统计完整个截取段才产出调色板，此阶段 GIF muxer 没有输出帧，ffmpeg 的 progress 事件不给值（恒 0）
2. 更关键的是内存：单条命令 `split[a][b];[a]palettegen[p];[b][p]paletteuse` 中，paletteuse 要等 palette 就绪，期间整段帧会缓冲在滤镜链里。281 秒 × 15fps ≈ 4217 帧 × 480×270 RGB24 ≈ 1.6GB，在 wasm 里会造成剧烈变慢甚至失败

### 已实施

- `ffmpeg.ts`：`RunConversionOptions` 新增 `durationSec`；在无输出帧阶段解析 ffmpeg 日志 `time=HH:MM:SS.ss` 折算进度（200ms 节流），有输出帧后交回 progress 事件（不覆盖 0）
- `gif.ts` / `compress.ts`：传入截取段时长
- GIF 页：analyzing 阶段有百分比后改用确定进度条 + 百分比文案

### 未实施（待确认）

长片段改**两遍法**根治内存问题：

1. 第一遍只 `palettegen` 输出 `palette.png`（内存 O(1)，有真实进度）
2. 第二遍 `-i input -i palette.png -lavfi "...paletteuse"` 输出 GIF

代价：多解码一遍（总耗时约 +30%~40%），换来内存恒定、不再卡死；短视频仍用单遍（更快）。

触发阈值建议按帧数而非时长（与分辨率相关），初值 500 帧。

### 验证

- `npm run validate`：通过
- 本地两个服务：`http://127.0.0.1:3000`（dev，验证进度改进；无隔离头，ffmpeg 走单线程）；`http://127.0.0.1:4000`（临时脚本 `%TEMP%\serve-coi.js` 托管 `out/`，带 COOP/COEP，用于验证多线程）
- **未验证**：真实视频下的多线程耗时与 analyzing 进度是否按预期推进（需在浏览器实际跑一次）

## 极速模式性能诊断（2026-10-25 第三轮）

### 实测

用户素材：480×202、2112 帧、128 色、极速模式，**102.1 秒**（48.3 ms/帧），GIF 73.1 MB。

### Node 基准（gifenc 1.0.3，480×202，合成复杂画面）

| 阶段 | 耗时 |
| --- | --- |
| `quantize(128, rgb444)` 全尺寸 | 121.0 ms/帧 |
| `applyPalette` 全尺寸 | 3.0 ms/帧 |
| `GIFEncoder.writeFrame`（LZW） | 2.5 ms/帧 |
| `quantize` 1/2 尺寸 | 115.6 ms/帧 |
| `quantize` 1/4 尺寸 | 40.6 ms/帧 |

结论：

1. **`quantize` 是绝对瓶颈**（占 90%+），`applyPalette` 与 LZW 都是 3ms 量级
2. 降采样对量化几乎无效（1/2 尺寸耗时不变）：`pnnquant2` 的成本取决于颜色分布而非像素数，此路排除
3. 每帧都重算调色板是纯浪费——相邻帧的调色板高度相似

### 拟定方案（待确认）

每 N 帧（默认 8 帧，15fps 下约 0.53 秒）复用一次调色板，其余帧只做 `applyPalette` + LZW：

- 预期：48.3 → 约 15 ms/帧，2112 帧由 102 秒降到约 30 秒
- 附带收益：帧间颜色一致，LZW 压缩率提高，GIF 体积下降
- 代价：场景/色调剧变处（每约 0.5 秒一个边界）可能出现轻微颜色偏差

待定的两个次要问题：

- `quantize` 在主线程执行，转换期间页面基本不可交互（搬进 Worker 可不减耗时但页面不卡）
- 极速模式不支持「全局调色板」，与本次方案不冲突

## 视频压缩耗时与引擎标注（2026-10-25 第四轮）

- `VideoCompressResult` 新增可选 `elapsedMs`；`compress.ts` 从读取元信息开始计时
- `ffmpeg.ts` 新增 `getFfmpegCoreMode()`，记录实际加载的 core（`multi` / `single`），取消转换后重置
- 视频压缩结果面板新增一行：`耗时 X 秒（多线程 | 单线程）`，无需翻控制台即可确认 A 是否生效

验证：

- `npm run validate` 通过；`npm run build` 通过
- `http://127.0.0.1:4000/tools/video/compress/`（COI 静态服务器，重新构建后的产物）→ 应显示「多线程」
- `http://127.0.0.1:3000/tools/video/compress/`（dev，无隔离头）→ 显示「单线程」，属预期

## 极速 GIF 调色板复用间隔（2026-10-25 第五轮）

### 决策：每 16 帧复用一次（方案 B）

用户在 A(8) / B(16) / C(两遍全局) 中选定 B。依据是成本曲线：8 帧之后收益饱和。

| 复用间隔 | 每帧耗时 | 2112 帧总耗时 |
| --- | --- | --- |
| 1（原始） | 48.3 ms | 102 秒 |
| 8 | 15.3 ms | 32 秒 |
| **16（采用）** | **12.9 ms** | **27 秒** |
| 30 | 11.8 ms | 25 秒 |
| 整片共用 | 10.5 ms | 22 秒 |

`applyPalette` + LZW + canvas 是每帧固定成本（约 10.5 ms），压不掉；间隔从 16 拉到 60 只再省约 4 秒，但调色板时间跨度从 1.07 秒涨到 4 秒，跨镜头色偏风险陡增。

实现：`fastGif.ts` 新增常量 `PALETTE_REUSE_FRAMES = 16`，`encodeFrame` 内按 `frameCount % 16 === 0` 重算调色板，其余帧复用。

## 兼容模式进度诊断（进行中）

### 问题

非极速模式仍长时间停在「第一阶段：分析视频帧，生成全局调色板」，无百分比；极速模式因按已编码帧数计算，直接有百分比。

### 技术限制

- ffmpeg 的 `progress` 事件按**输出时间戳**上报，palettegen 阶段没有输出帧 → 恒为 0，这是 ffmpeg.wasm 的行为，改不了
- `-progress <file>` 方案不可行：`ffmpeg.exec()` 期间整个 worker 被同步阻塞，`readFile` 消息排队到 exec 结束才处理
- 因此**日志解析是唯一可行通道**（logger 由 wasm 内部直接 postMessage，不经 worker 消息队列）

### 诊断结论（2026-10-25 第六轮实测）

实测日志显示 `[ffmpeg] 进度解析：日志 28 行，time= 命中 0 次`，即：

**ffmpeg 的统计行用 `\r` 刷新、从不形成完整行，因此不会作为日志事件送达**。原解析方向作废。

### 最终方案：`-progress pipe:1`

在 `runConversion` 内部注入 `-progress pipe:1`（插在输出文件名之前），它每 `stats_period` 输出一批
以 `\n` 结尾的 `key=value`，可以从 stdout 的日志回调逐个收到，取 `out_time_us` 折算进度。

- 注入位置在 `runConversion` 而非 `build*`，避免「实际执行命令」的展示带上 `pipe:1`
- 保留前后 20 条 stderr 日志采样（`[ffmpeg][log] ...`）便于后续排查

## 极速模式逐阶段实测（2026-10-25 第六轮）

480×202、源 1920×804、128 色、15fps：

| 阶段 | 均值 |
| --- | --- |
| `drawImage`（缩放并绘到 canvas） | **约 15 ms** |
| `getImageData`（像素回读） | 0.2 ms |
| `quantize`（16 帧复用） | 0.4 ~ 1.6 ms |
| `applyPalette` | 2 ~ 6 ms |
| LZW 编码 | **10 ~ 11.7 ms** |

结论：

1. 16 帧复用生效：`quantize` 从约 38 ms 降到 1 ms 量级
2. `willReadFrequently` 有效：回读成本 0.2 ms
3. 剩余开销几乎全是 `drawImage`（源帧 GPU→CPU 并缩放）与 LZW，两者都与**输出像素数 × 帧数**成正比，属于必要工作
4. 继续提速只能减小输出尺寸/帧率或缩短时长，而不是优化单帧算法

### 最终实测（2 倍速全片，2112 帧，480×202，128 色）

| 阶段 | 均值 |
| --- | --- |
| `drawImage` | **16.5 ms（占 67%）** |
| LZW | 1.1 ~ 1.7 ms |
| `applyPalette` | 0.7 ~ 1.0 ms |
| `quantize` | 0.1 ~ 0.2 ms |
| `getImageData` | 0.1 ~ 0.2 ms |

总耗时 **52.1 秒 / 2112 帧 = 24.7 ms/帧**，产出 GIF 68.7 MB。

同帧数（2112）对比首版 **102.1 秒 → 52.1 秒，提速 1.96 倍**。

单帧算法已榨干：除 `drawImage` 外的全部阶段合计约 2.5 ms。`drawImage` 的成本来自
「1920×804 硬解帧 → CPU 位图 → 缩放至 480×202」，是硬解帧回读的固有开销。

### 若还要继续优化（待确认，未实施）

| 选项 | 预期 | 风险 |
| --- | --- | --- |
| 改用 `createImageBitmap(frame, { resizeWidth, resizeHeight })` 做缩放 | draw 16.5 → 8~10 ms，总耗时约 36 秒 | 需把同步的 output 回调改成异步队列（含背压），改动中等 |
| 改用软件解码（`prefer-software`）避免 GPU 回读 | 不确定，可能省 0~4 ms | 软解 1080p 可能更慢，需实测 |
| 降输出尺寸 / fps / 时长 | 线性收益（480→320 约省 50%） | 无，但属参数选择而非算法优化 |

## A/B 实测：软件解码胜出（2026-10-25 定案）

同一素材（2 倍速全片、2112 帧、480×202、128 色、15fps）：

| 阶段 | 硬解 `prefer-hardware` | 软解 `prefer-software` |
| --- | --- | --- |
| `drawImage` | 16.5 ms | **0.4 ms** |
| `getImageData` | 0.15 ms | 7.4 ms |
| LZW | 1.4 ms | 1.6 ms |
| `applyPalette` | 0.9 ms | 0.9 ms |
| `quantize` | 0.15 ms | 0.2 ms |
| **总耗时** | **52.1 秒** | **34.4 秒** |
| 产物体积 | 68.7 MB | 68.7 MB |

结论：软解是净收益，**-34%（52.1 → 34.4 秒）**。

- 硬解帧是 GPU 纹理，`drawImage` 到 CPU 位图要额外回读，成本全压在 draw（16.5 ms）
- 软解帧本就在内存里，draw 降到 0.4 ms；回读成本转移到 `getImageData`（7.4 ms），合计仍比硬解少约 8.9 ms/帧
- 软解本身多耗约 1.2 ms/帧，被上述收益覆盖

已定案：`fastGif.ts` 的 `DECODE_ACCELERATION = "prefer-software"`。

至此极速 GIF 相对首版：**102.1 秒 → 34.4 秒，3 倍**。

剩余可挖项（收益递减，未实施）：`getImageData` 的 7.4 ms。可尝试 `alpha: true` /
关闭 `willReadFrequently` 等变体做 A/B，预计 -1~3 ms/帧（34 → 30 秒左右）。

## canvas 上下文 A/B（2026-10-25 定案）

同一素材 750 帧，软件解码，128 色、480×202：

| 组合 | 平均 | 750 帧总耗时 | `read` |
| --- | --- | --- | --- |
| `alpha:false` + `wrf:true`（原） | 18.1 ms | 13.6 秒 | 7.5 ms |
| `alpha:true` + `wrf:true` | 17.7 ms | 13.3 秒 | 7.0 ms |
| **`alpha:false` + `wrf:false`（采用）** | **13.7 ms** | **10.3 秒** | **3.3 ms** |
| `alpha:true` + `wrf:false` | 14.0 ms | 10.5 秒 | 3.6 ms |

结论：**关闭 `willReadFrequently` 反而更快**（`read` 7.5 → 3.3 ms），`alpha` 影响在 2% 内。

原因：配合软件解码后帧本就在内存里，`willReadFrequently` 把画布切到 skia 的 CPU 后端，
`getImageData` 要额外做一次 CPU 位图拷贝；走默认 GPU 后端时上传/回读的数据量只有输出尺寸量级（389 KB），更快。

已定案：`getContext("2d", { alpha: false })`（不开 `willReadFrequently`）。

### 极速 GIF 最终成绩（480×202 / 128 色 / 15fps / 2112 帧）

| 版本 | 总耗时 | 每帧 |
| --- | --- | --- |
| 首版（每帧量化 + 硬解 + wrf） | 102.1 秒 | 48.3 ms |
| 16 帧复用调色板 | 52.1 秒 | 24.7 ms |
| + 软件解码 | 34.4 秒 | 16.3 ms |
| + 关闭 willReadFrequently（本次） | **约 28.9 秒（按 750 帧实测外推）** | **13.7 ms** |

累计提速 **约 3.5 倍**。剩余开销分布（750 帧实测）：read 3.3、lzw 1.6、apply 0.9、
quantize 0.2、draw 0.4，其余约 7 ms 为软件解码本身的耗时。

## 兼容模式两遍法 + 帧数上限（2026-10-25 第七轮）

### 实测故障

2112 帧的兼容模式转换跑到 **918 秒仍未产出第一帧**（多线程 core 已生效，非线程问题）。

根因：单条命令 `split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse` 中，paletteuse
必须等 palettegen 统计完所有帧才输出第一帧，期间整段帧缓冲在滤镜链里：
480×270 RGB24 × 2112 帧 ≈ **610 MB**，叠加输入文件 106 MB、输出 GIF 累积与堆碎片，
逼近 wasm32 的 2 GB 上限，进入极慢状态。多线程救不了——palettegen/paletteuse 都是单线程滤镜。

### 决策（用户确认 A + B）

| 阈值 | 行为 |
| --- | --- |
| ≤ 200 帧 | 单遍法（`split` 单命令，只解一遍码，最快） |
| 200 ~ 600 帧 | **两遍法**：第一遍 `palettegen` 输出 `palette.png`，第二遍 `-i input -i palette.png` 跑 `paletteuse` |
| > 600 帧 | 禁用兼容模式，提示缩短截取或改用极速模式 |

数字关系说明：两遍法门槛（200）必须低于禁用门槛（600），否则 200~600 区间仍走单遍法、
>600 被禁用，两遍法永远不会被执行。200 帧约 78 MB 帧缓冲，是单遍法的安全上限。

实现要点：

- `runConversion` 新增 `extraInputs`（两遍法第二遍要读入 palette.png），并在 finally 一并清理
- `writeFile` 会 **transfer** ArrayBuffer 所有权（源 buffer 被 detach），因此两遍法第二次必须重新 `fetchFile(file)`
- 第一遍不报进度：它的输出只有结尾一张 png，ratio 会在末尾跳到 1 再回落，交给页面秒表兜底
- `SINGLE_PASS_MAX_FRAMES = 200`（`gif.ts`）、`COMPAT_MAX_FRAMES = 600`（`gif/page.tsx`）

### 文案定案

- 开关标签：「极速模式（WebCodecs 解码）」（原「硬件加速」与实际相反——实测软件解码更快）
- 开关说明：「浏览器原生解码 + 直接编码，通常快数倍；仅支持 H.264 编码的 MP4/MOV，转换期间页面可能短暂卡顿」
- 超限提示：「兼容模式最多处理约 600 帧（当前约 N 帧）。请缩短截取范围，或勾选「极速模式（WebCodecs 解码）」」

### 验证

- `npm run validate` / `npm run build` 通过
- **未验证**：200~600 帧区间走两遍法的实际耗时与产物正确性（需真实视频实测）

## 文件大小上限按模式分流（2026-10-25 第九轮，1.11.1 之后）

原实现统一限制 200MB，但极速模式（WebCodecs）只按需随机读样本，不需要把整份文件载入内存，
与「视频极速压缩」的 4GB 能力不一致。

### 决策

| 模式 | 上限 | 依据 |
| --- | --- | --- |
| 极速模式 | 4GB | mp4box 只跳读 moov、样本按 `file.slice` 随机读 |
| 兼容模式 | 200MB | 整个文件要写进 wasm 内存（`ffmpeg.writeFile`） |

行为：

- 拖拽区上限放宽到 4GB，副标题改为「极速模式最大 4GB，兼容模式最大 200MB」
  （`FileDropZone` 新增可选 `maxSizeLabel`，避免默认显示「最大 4096MB」）
- 文件 > 200MB 且是 MP4/MOV：强制极速模式，开关锁定为勾选、不可取消
- 文件 > 200MB 且非 MP4/MOV：直接拒绝并说明（要极速模式得是 H.264 MP4/MOV）
- `handleConvert` 再加一道防御：`!fastMode && file.size > 200MB` 直接报错，
  确保超大文件绝不会进 ffmpeg（否则整份写进 MEMFS 会把页面卡死）

未验证：4GB 级别文件的端到端实测（需真实大文件）。

## 回滚：兼容模式恢复单遍法（2026-10-25 第八轮）

用户反馈：兼容模式在「优化日志显示」之前还能正常工作，之后完全无法工作，要求回滚。

### 已回滚

| 项 | 状态 |
| --- | --- |
| 两遍法（`palettegen` → `palette.png` → `paletteuse`） | 移除，恢复单遍 `split` 单命令 |
| 兼容模式帧数上限（600 帧禁用） | 移除 |
| `-progress pipe:1` 注入 | 移除（已确认 stdout 不经日志回调） |
| `[ffmpeg][log]` 日志采样打印 | 移除 |
| `RunConversionOptions.extraInputs` | 移除（两遍法专用） |
| `progressHandler` 的 `ratio <= 0` 提前返回 | 恢复原始逻辑 |

### 保留（与兼容模式可用性无关）

- C 方案滤镜微调：`flags=bicubic`、`palettegen stats_mode=diff`、`-an`
- analyzing 阶段「已用 N 秒」秒表
- 极速模式全部优化（16 帧调色板复用、软件解码、canvas 配置）
- 文案定案（极速模式（WebCodecs 解码）等）
- 耗时与引擎标注（视频压缩结果面板）

### 待定位的嫌疑项

用户「之前能正常工作」时实际运行在 `next dev`（无跨域隔离 → **单线程 core**），
而 918 秒未完成的那次是 `crossOriginIsolated=true` → **多线程 core-mt**。

因此 core-mt 本身也可能是兼容模式异常的原因（palettegen/paletteuse 是单线程滤镜，
多线程版额外承担 SharedArrayBuffer 同步与更高内存占用）。

已提供对照环境（同一份 `out/` 产物）：

- `http://127.0.0.1:4000/` 带 COOP/COEP → 多线程
- `http://127.0.0.1:4001/` 不带 → 单线程

需在同一素材、同一参数下分别跑一次兼容模式，对比日志中的 `[ffmpeg] core:` 与实际耗时/是否成功。

### 对照结论（2026-10-25 实测）

同一素材（480×202、750 帧），同一份 `out/` 产物，仅响应头不同：

| 环境 | core | 结果 |
| --- | --- | --- |
| `:4001`（无 COOP/COEP） | 单线程 | **成功**：750 帧、49.1 MB、**155.7 秒** |
| `:4000`（带 COOP/COEP） | 多线程（16 核） | **卡死**：295 秒仍停在「第一阶段 分析视频帧」 |

**根因确认：core-mt 在 GIF 的 split+palettegen+paletteuse 重滤镜链上不可用。**
推断：多线程 core 的内存占用显著更高（每个 worker 一份堆），而单遍法本身要缓冲
整段帧（750 帧 × 389KB ≈ 292MB），两者叠加导致内存吃紧；加上 SharedArrayBuffer
同步开销，而 palettegen/paletteuse 本身就是单线程滤镜，多核帮不上忙。

### 修复

- `RunConversionOptions` 新增 `forceSingleThread`；`gif.ts` 传 `true`
- `ensureLoaded({ multiThread: false })`：按调用方要求选择 core，类型不符时先终止旧实例再重载
- GIF 页在兼容模式下显式 `await ensureLoaded({ multiThread: false })`，避免先加载多线程再重载
- **视频压缩（compress）保持多线程**：它的滤镜链只有 scale/setpts，主要开销是 x264 编码，
  多线程有实际收益；尚未与单线程做正式对比

## 极速模式逐阶段计时（2026-10-25 第六轮）

### 实测对比

| 轮次 | 帧数 | 总耗时 | 每帧 |
| --- | --- | --- | --- |
| 512 帧复用前 | 2112 | 102.1 秒 | 48.3 ms |
| 16 帧复用后（全片） | 4225 | 111.4 秒 | **26.4 ms** |

16 帧复用确实生效：单帧耗时降 45%。总时长没有下降是因为这次转的是全片（4225 帧，帧数是上次 2 倍）。

但仍高于测算值 12.9 ms，说明 `drawImage` + `getImageData` 占了预算之外的开销。

### 已实施

1. `getContext("2d", { alpha: false, willReadFrequently: true })`：每帧都要回读像素，让浏览器走 CPU 后端，避免每帧一次 GPU→CPU 同步回读
2. 每 200 帧打印各阶段均值：
   `[fastGif] 近 200 帧均值(ms)：draw=… read=… quantize=… apply=… lzw=…`
   用于确认 `willReadFrequently` 是净收益（若 read 降低但 draw 升高更多，则回退该项）

### 结论性判断

GIF 不适合长视频：本次输出 **141.3 MB / 4225 帧**。即使每帧优化到理论下限（约 10.5 ms），仍需约 44 秒。
需要改进的是产品侧引导（限制/建议时长），而不是继续压榨每帧成本。
