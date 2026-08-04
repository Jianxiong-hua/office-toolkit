# 计划：图片压缩功能添加 GIF 格式支持（完整动画）

## Context

当前 `office-toolkit/src/app/tools/image/compress/` 工具只支持 PNG/JPG/WebP 三种格式。GIF 格式因为浏览器 Canvas 无法原生编码（`canvas.toBlob('image/gif')` 不可用），且 `browser-image-compression` 库不支持 GIF 路径，所以一直没有接入。

用户需要在图片压缩工具中**完整支持 GIF 格式**（静态 + 动画），用纯前端方案实现：
- 接受 GIF 作为输入
- 重新编码输出 GIF 时可调**颜色数**（8/16/32/64/128/256）作为压缩杠杆
- 保留原始动画（帧、延迟、透明度）
- **仅当输入是 GIF 时才输出 GIF**（其他格式不能转 GIF，避免一处工具承担过多职责）

> **用户工作流要求**：先改需求文档（`docs/02-phase1-requirements.md`），再改代码，最后测试。

---

## 用户决策（已确认）

| 决策 | 选择 |
|---|---|
| 动画支持 | 完整支持（解码所有帧、保留动画重新编码） |
| 质量滑块映射 | **额外加颜色数选择器**（不依赖 quality 滑块） |
| 输出 GIF 范围 | 仅当输入是 GIF 时才能输出 GIF（其他格式转 GIF → 拒绝） |

---

## 实施步骤（按 doc-first 顺序）

### 步骤 1：更新需求文档（先做）

**文件**：`docs/02-phase1-requirements.md`

定位到现有的 `### 3.4 图片压缩` 章节，整体重写。需要补充：

- 格式列表添加 GIF（静态 + 动画，保留动画）
- 压缩质量参数的有效性范围：仅对 JPG/PNG/WebP 有效
- 新增"颜色数"参数（8/16/32/64/128/256），仅对 GIF 有效
- 输出格式加 GIF，并说明限制
- 关键限制清单：
  - 仅 GIF → GIF（其他 → GIF 拒绝）
  - GIF → 其他格式拒绝（避免职责重叠，引导用「格式转换」）
  - 重压缩可能比原文件大（因为重编码为全帧 + dispose=2，丢失原 GIF 帧间优化）
  - 颜色数越小文件越小但视觉越差
  - 8 色 + 透明时实际可视颜色仅 7 色
- 新增技术实现说明：
  - 依赖：gifenc@^1.0.3、gifuct-js@^2.1.2
  - 解码：必须手动应用 disposal method（0/1/2/3）合成每帧全屏 RGBA
  - 编码：per-frame palette，有透明时 palette 预留索引 0 为透明
  - dispose: 2（restore to background），repeat: 0（无限循环），delay clamp ≥20ms
  - 框架：dispatcher 在 `compressImage()`，按 input MIME 分发到 `compress-gif.ts` 或 `browser-image-compression`
  - bundle 影响：压缩页 +15 KB gzipped

### 步骤 2：安装依赖

```bash
cd office-toolkit
npm install gifenc@^1.0.3 gifuct-js@^2.1.2
```

`package.json` 自动更新。`gifuct-js` 自带 `js-binary-schema-parser` 依赖。

### 步骤 3：扩展类型定义

**文件**：`office-toolkit/src/types/index.ts`

修改 `ImageCompressOptions`：

```ts
export interface ImageCompressOptions {
  quality: number;       // 10-100
  maxWidth?: number;
  maxHeight?: number;
  format: "original" | "jpeg" | "webp" | "png" | "gif";  // 新增 "gif"
  gifColors?: 8 | 16 | 32 | 64 | 128 | 256;              // 新增
}
```

### 步骤 4：新建 GIF 处理模块

**新建**：`office-toolkit/src/lib/image/compress-gif.ts`

包含三个函数：
- `parseGifFrames(file)` — 用 `gifuct-js` 解析，**手动应用 disposal method**（关键）
- `encodeGif(frames, options)` — 用 `gifenc` 重新编码
- `compressGif(file, options)` — 入口函数，返回 `{ blob, originalSize, compressedSize, frameCount, width, height }`

**关键技术点**（已在 Plan agent 分析中验证）：
- `getContext("2d", { willReadFrequently: true })` 避免 Chrome 警告
- disposal=2 时清除上一帧 patch 矩形；disposal=3 时从备份 ImageData 恢复
- 有透明度的帧：`format: "rgba4444"` + `oneBitAlpha: true`，palette 预留索引 0
- delay clamp 到 ≥20ms（避免浏览器跳过超快帧）
- per-frame palette（每帧独立调色板，质量更好）
- 可选 `maxWidth/maxHeight` 缩放（canvas 重采样 + 永不放大）
- `dispose: 2`、`repeat: 0` 硬编码为最常见动画 GIF 行为

### 步骤 5：改造 dispatcher

**修改**：`office-toolkit/src/lib/image/compress.ts`

`compressImage()` 改为按 input MIME 分发：
- input 是 GIF + output 是 `original` 或 `gif` → 调 `compressGif()`
- input 是 GIF + output 是其他 → 抛 `UNSUPPORTED_FORMAT`（避免职责重叠）
- input 非 GIF + output 是 `gif` → 抛 `UNSUPPORTED_FORMAT`
- 其他情况 → 原有 `browser-image-compression` 路径（不变）

返回结构增加 `info?: string`（GIF 用：`${width}×${height} · ${frameCount}帧 · ${colors}色`）

### 步骤 6：UI 改造

**修改**：`office-toolkit/src/app/tools/image/compress/page.tsx`

- `accept` 加 `"image/gif": [".gif"]`
- 输出格式 select 加 `<option value="gif">GIF (动画)</option>`
- 当 `format === "gif"` 时：
  - **隐藏**质量滑块
  - **显示**颜色数 select（8/16/32/64/128/256，默认 128）
  - 提示文字：「颜色数越小，文件越小，视觉质量越低（适合表情包 / 贴图）」
- 当 `format === "gif"` 但用户上传了非 GIF 文件 → 走 `FileList` 已有的 `errorIds` 模式，**逐文件报错**（一个文件失败不影响其他文件）
- ToolLayout `description` 改为「在线压缩 PNG/JPG/WebP/GIF 图片，支持保留 GIF 动画」
- `handleCompress` 用 `Promise.allSettled`（或 try/catch per file）实现单文件失败容错

**修改**：`office-toolkit/src/app/tools/image/compress/layout.tsx`

- `description` 同步
- `keywords` 加 `gif`, `动画`, `表情包`

### 步骤 7：测试（按 03-phase1-test-plan.md 现有 8 类目扩展）

| 场景 | 验证方法 |
|---|---|
| 静态 GIF → 更小 GIF | 用 `public/test.JPG` 同目录的 `.gif` 测试 |
| 动画 GIF → 仍动画 | 用任意动画 GIF（搜索一个 5 帧的表情包） |
| 颜色数 256 vs 8 | 同一文件对比压缩率 |
| 帧延迟保留 | 浏览器看动画播放速度 |
| 透明度保留 | 带透明背景的动画 GIF |
| disposal=2 / =3 | 浏览器看动画正确性 |
| 非 GIF + 输出 GIF | 上传 PNG + 选 GIF → 该文件报错，其他 GIF 正常 |
| 混合批次 | 1 PNG + 1 GIF 同批次 |
| maxWidth 缩放 | 800×600 GIF，maxWidth=400 → 输出 400×300 仍动画 |
| 重新压缩变大 | 已高度优化的 GIF，可能变大但 UI 正常 |
| 预览动画 | 压缩完成后点预览 → 新窗口看动画 |
| `npm run build` | 11 + 1 页面全部静态导出成功，无 TS 错误 |

**测试图片**：
- 静态 GIF：项目内任一图片转成 GIF 即可
- 动画 GIF：用户需提供一个；或从网上下载一个 2-3 帧的简单动画

---

## 关键文件改动清单

| 文件 | 改动 |
|---|---|
| `docs/02-phase1-requirements.md` | 重写 §3.4 图片压缩 |
| `office-toolkit/package.json` | 加 `gifenc`、`gifuct-js` |
| `office-toolkit/src/types/index.ts` | `ImageCompressOptions.format` 加 `gif`；加 `gifColors` |
| `office-toolkit/src/lib/image/compress-gif.ts` | **新建** — 3 个函数 |
| `office-toolkit/src/lib/image/compress.ts` | `compressImage` 改为 dispatcher |
| `office-toolkit/src/app/tools/image/compress/page.tsx` | UI 改：accept / select / 错误处理 / info 显示 |
| `office-toolkit/src/app/tools/image/compress/layout.tsx` | description + keywords |

**未改动**（确认已有能力）：
- `FileDropZone` — 已有 `image/gif` 标签
- `FileList` — 已有 `errorIds` prop 支持逐文件错误
- `lib/file.ts` — `readFileAsArrayBuffer` 已有
- `PreviewButton` — 浏览器自动渲染动画 GIF，零改动

---

## 验证步骤（端到端）

1. `cd office-toolkit && npm install gifenc gifuct-js`
2. 重启 dev server（如还在跑）
3. 访问 `http://localhost:3000/tools/image/compress/`
4. 上传一个动画 GIF（5-10 帧，1-2MB）
5. 输出格式选「GIF (动画)」
6. 颜色数选 64
7. 点「开始压缩」
8. 验证：列表显示新文件大小 + `info: "320×240 · 8帧 · 64色"`
9. 点预览 → 新窗口看动画正常播放
10. 下载后用第三方工具（Photoshop / 系统图片查看器）确认动画
11. 上传 PNG + 选 GIF → 该文件标红错误，其他正常
12. `cd office-toolkit && npm run build` → 全部页面静态导出成功

---

## 风险与回退

| 风险 | 缓解 |
|---|---|
| `gifuct-js` 5 年没更新，潜在兼容问题 | 已验证现代浏览器支持；如有问题 fallback 用 `omggif` |
| disposal method 处理错误 → 动画错乱 | 已在 plan agent 分析中给出正确实现；测试 I-37/I-38 必跑 |
| bundle 增加 ~15 KB gzipped | 接受：影响仅压缩页（其他路由不加载） |
| 重压缩比原文件大 | 用户已接受；UI 正常显示"压缩率 -X%"即可 |
| 移动端 Safari 慢 | gifenc 优化目标 V8，但 Safari 仍可工作；首次实现不优化 |
| 大型动画 GIF 内存爆 | 20MB 单文件限制 + 顺序处理已足以应对大多数场景 |

**回退方案**：如出现严重问题，删 `compress-gif.ts` + 撤回 `compress.ts` dispatcher 修改，UI 的 GIF 选项删除即可（5 分钟回退）。
