# 大文件支持设计（WORKERFS 挂载输入）

日期：2026-10-25
范围：视频压缩、视频转 GIF 兼容模式

## 目标

解除「输入文件必须先整个读进 wasm 内存」的限制，使 GB 级的非 MP4 视频（MKV/AVI/MOV 等）
也能用 ffmpeg 路径处理。

## 现状

| 工具 | 当前限制 | 原因 |
| --- | --- | --- |
| 视频压缩 | 200MB | `ffmpeg.writeFile` 把整份文件写入 MEMFS（wasm 内存） |
| 视频转 GIF · 兼容模式 | 200MB | 同上 |
| 视频转 GIF · 极速模式 | 4GB，但仅 MP4/MOV + H.264 | mp4box 只解析 ISO-BMFF |
| 视频极速压缩 | 4GB，但仅 MP4/MOV + H.264 | 同上 |

结果：一个 1GB 的 MKV，四个工具全都处理不了。

## 方案

`@ffmpeg/ffmpeg` 暴露 `mount(fsType, options, mountPoint)`，`@ffmpeg/core` 与 `core-mt`
都编译了 **WORKERFS**（各 21 处引用，已静态确认）。它把浏览器 `File` 挂成只读文件系统，
ffmpeg 通过 `Blob.slice` 按需同步读取，**文件内容不进 wasm 内存**。

```ts
await ffmpeg.mount(FFFSType.WORKERFS, { files: [wrappedFile] }, "/mnt");
// args 里用 "input.mkv"（挂载后路径为 /mnt/input.mkv）
```

实现要点：

1. **文件名对齐**：args 里写的是 `input.<ext>`，而挂载后路径由 `File.name` 决定。
   用 `new File([file], ffmpegInputName(file.name))` 包装——`File` 构造器接受 Blob 作为 part，
   只新建元数据、不复制内容，所以文件仍是原样按需读
2. **按大小分流**：`> 200MB` 走 WORKERFS 挂载，`≤ 200MB` 仍走原来的 MEMFS 写入
   （小文件在内存里更快，且已验证的路径不引入新风险）
3. **清理**：`finally` 里 `unmount` + `deleteDir`；取消路径下 worker 已终止，跳过
4. `RunConversionOptions` 改为 `inputData?: Uint8Array` 与 `inputFile?: File` 二选一

## 约束（必须让用户知道）

1. **输出仍写 MEMFS**：截图/裁剪后的 GIF 或压缩后的 MP4 都要先落到 wasm 内存里再读回。
   所以「输入能读」不等于「输出无上限」，输出体积仍受内存约束（保守估计 ≤ 1GB）
2. **GIF 兼容模式的长片段问题与文件大小无关**：单遍法要把整段帧缓冲在滤镜链里
   （480×270 RGB24 ≈ 389KB/帧，750 帧 ≈ 292MB），大文件也必须截取短片段
3. **MKV/AVI 只能走 wasm 软解**，速度显著慢于极速模式（后者是浏览器原生解码）

## 提速分析（回答「单线程处理大文件太慢」）

### 已具备但未验证的提速项

| 项 | 预期 | 状态 |
| --- | --- | --- |
| 视频压缩已默认启用多线程 core（`core-mt`） | x264 与解码都能多线程，2~4x | **从未与单线程做过对照**，需实测 |
| `preset` 可调 ultrafast | 比 fast 快约 2 倍（体积变大） | 已存在，用户可选 |
| 分辨率降到 720p/480p | 线性降低编解码量 | 已存在，用户可选 |

关键点：core-mt 在 **GIF 的重滤镜链**上会卡死（palettegen/paletteuse 是单线程滤镜，
且内存翻倍），但视频压缩的滤镜链只有 scale/setpts，主要开销是 x264 编码——多线程对它是真收益。
因此两个工具对 core 的选择是分开的（GIF 强制单线程、压缩默认多线程）。

### 结构性提速（未实施，需单独立项）

1. **MKV/WebM 走 WebCodecs 快路径**：这两个容器里装的经常就是 H.264/VP9。
   写一个 EBML/MKV 解封装器，把样本与 avcC 提取出来喂 `VideoDecoder`，
   即可复用极速压缩/极速 GIF 的流水线，速度提升一个量级。
   代价：约 300~500 行解析代码，且只能覆盖 H.264 的 MKV。**不建议现在做**
2. **先 remux 再走快路径**（`-c copy` 把 MKV 里的 H.264 转封装成 MP4，不解码）：
   思路轻，但输出 MP4 仍要落 MEMFS，1GB 输出直接顶到内存墙，实际不可行

## 验收标准

1. 视频压缩：≤200MB 文件行为与现在完全一致（MEMFS 路径不回归）
2. 视频压缩：>200MB 的 MKV/AVI 能读出索引并完成压缩（用真实大文件验证）
3. GIF 兼容模式：>200MB 文件在截取短片段（<20 秒）时能出图
4. 取消、重新选择、连续转换不残留挂载点
5. `npm run validate` / `npm run build` 通过

## 风险

| 风险 | 处理 |
| --- | --- |
| 某些浏览器 WORKERFS 挂载失败或读取异常 | `mount` 返回 false 时抛明确错误；保留 MEMFS 路径给 ≤200MB 文件 |
| MKV/AVI 的解封装或解码在 wasm 里失败 | 错误信息里提示「该容器/编码可能不受支持」 |
| 大文件读取慢（每次 seek 都是 Blob 读取） | 只能靠 WORKERFS 的分块机制，若过慢则提示用户改用极速模式（仅 MP4） |
| 输出体积撞内存墙 | 页面提示：只处理截取后的片段 |
| **core-mt（pthread）与 WORKERFS 不兼容（已实测确认）** | 见下方「实测结论」：挂载路径一律强制单线程 |

## 实施记录（2026-10-25）

| 文件 | 改动 |
| --- | --- |
| `src/lib/video/ffmpeg.ts` | 新增 `MOUNT_THRESHOLD_BYTES`；`RunConversionOptions` 改为 `inputData?` / `inputFile?` 二选一；`runConversion` 增加 WORKERFS 挂载分支（`createDir` → `mount(FFFSType.WORKERFS)` → args 里输入路径替换为 `/mnt/<name>`），`finally` 里 `unmount` + `deleteDir` |
| `src/lib/video/compress.ts` | 按 `file.size > MOUNT_THRESHOLD_BYTES` 选择挂载或内存路径 |
| `src/lib/video/gif.ts` | 同上（仍 `forceSingleThread: true`） |
| `src/app/tools/video/compress/page.tsx` | 文件上限 200MB → **2GB**；拖拽区副标题改「单文件最大 2GB」 |
| `src/app/tools/video/gif/page.tsx` | `COMPAT_MAX_FILE_SIZE` 200MB → **2GB**（挂载解锁）；超过 2GB 才强制极速模式；新增「>200MB 且未勾极速模式」的 amber 提示（软解更慢，建议勾选） |

验证：`npm run validate` / `npm run build` 通过。

**未验证**（需真实大文件 + 浏览器）：

1. WORKERFS 挂载能否成功，MKV/AVI 的 seek 性能如何
2. 视频压缩「多线程 core + 挂载」组合是否正常（pthread 环境下每个线程访问 FS 的兼容性）
3. 1GB 级文件的端到端耗时

## 实测结论（2026-10-26，用 debug-mount 诊断页）

素材：`剑来第二季_第9集_25011.mp4`，1920×804 H.264 High，25fps，4:41.60。

| 步骤 | 单线程 `core` | 多线程 `core-mt` |
| --- | --- | --- |
| core 加载 | 168 ms | 248 ms |
| 挂载文件 | 1 ms | 2 ms |
| 探测 `-i` | 94 ms | 71 ms |
| **解码 1 秒**（`-f null -`） | **353 ms（speed 3.18x）** | **卡死，无响应** |
| 转码 1 秒（x264 ultrafast） | 1096 ms（speed 0.91x） | — |

结论：

1. **WORKERFS 本身完全可用**：挂载 1~2 ms，ffmpeg 能读到文件并解析出 Duration/Stream
2. **core-mt 在「解码阶段」卡死**，而探测阶段（只读文件头）正常——所以只看索引发现不了问题，
   必须真正解一段码才能暴露
3. 转码速度参考：1080p（1920×804）x264 ultrafast 约 **0.9x 实时**（wasm 无 SIMD/汇编，
   `[libx264] using cpu capabilities: none!`）

### 修复

`runConversion` 里挂载路径一律 `multiThread: false`（`useMount ? false : !forceSingleThread`）。
代价：>200MB 的大文件只能单线程，无法享受多线程加速。

## core-mt 全面停用（2026-10-26）

追加实测：106MB 的 MP4（走 MEMFS，非挂载）、截取 50 秒压缩，多线程下 **66 秒仍 0%**，
控制台显示 `[ffmpeg] core: 多线程（16 核可用）`。

结合此前两轮证据，`core-mt`（pthread 版）在本环境的**解码阶段**普遍卡死：

| 场景 | 单线程 | 多线程 |
| --- | --- | --- |
| GIF 750 帧 | 155.7 秒完成 | 295 秒仍停第一阶段 |
| WORKERFS 解码 1 秒 | 353 ms | 无响应（探测却正常） |
| MP4 压缩 50 秒 | 未测 | 66 秒仍 0% |

因此 `compress.ts` 也加上 `forceSingleThread: true`——**A 方案（多线程提速）在本环境无法兑现**，
两条 ffmpeg 路径全部退回单线程。`public/_headers`（COOP/COEP）保留但当前无实际用途，
等 `@ffmpeg/core-mt` 后续版本再验证。

代价：视频压缩的耗时就是 ffmpeg 单线程的真实速度（1080p x264 ultrafast 约 0.9x 实时）。
