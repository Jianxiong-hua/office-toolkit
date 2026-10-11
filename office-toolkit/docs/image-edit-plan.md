# 图片编辑器（image-edit）实现计划

> 对应需求：`docs/04-doc-binary-image-tools-requirements.md` 第 4 节（决策已确认，本文不重复论证）。
> 执行方式：主会话按任务顺序实现，全程一个 commit（message 待用户确认）。

**Goal**：单图编辑——画线/画框标注 + 亮度/对比度/色温/色调调整；预览与导出共用同一份像素处理函数；导出保持原始像素尺寸。

**Tech Stack**：React 19 + Canvas 2D + SVG overlay，无新依赖。

---

## Task 1：`src/lib/image/adjust.ts` 像素处理纯函数

**Step 1（先写断言脚本，预期失败）**：脚本放 `.git/tmp-adjusttest/`，用项目自带 `.\node_modules\.bin\tsc.cmd` 编译后 node 运行（同批次 1 模式）。断言用例：

- 全默认参数（100/100/0/0）→ 返回**同一引用**（跳过重算的约定）
- brightness 200 → 通道 ×2 且 clamp 255；brightness 50 → ×0.5
- contrast 0 → 全部 128；contrast 200 → (v−128)×2+128
- temperature +100 → R×1.3 / B×0.7，G 不变；−100 → R×0.7 / B×1.3
- tint +100 → R×1.2 / G×0.6，B 不变；−100 → R×0.8 / G×1.4
- 组合用例验证固定顺序：亮度 → 对比度 → 色温 → 色调（2×2 像素手算期望值）
- 所有输出 clamp 到 [0, 255]

**Step 2（实现）**：核心公式（每通道，顺序固定不可调换）：

```ts
export interface AdjustParams { brightness: number; contrast: number; temperature: number; tint: number; }
export const DEFAULT_ADJUST: AdjustParams = { brightness: 100, contrast: 100, temperature: 0, tint: 0 };

export function adjustPixels(imageData: ImageData, p: AdjustParams): ImageData;
// 四参数全默认 → 直接 return 入参（省一次全图循环）
// 否则原地改写 data 并返回同一 ImageData
```

`v = v*(b/100)` → `v = (v−128)*(c/100)+128` → 色温 `r*=1+0.3t; b*=1−0.3t` → 色调 `r*=1+0.2u; g*=1−0.4u`，每步 `clamp(round(v), 0, 255)`。

**验证**：断言全部通过后**立即删除** `.git/tmp-adjusttest/`。

## Task 2：页面骨架（加载 + 预览 + 换图）

**Files**：Create `app/tools/image/edit/layout.tsx`、`page.tsx`

- `layout.tsx` 照抄 `pdf/merge/layout.tsx` 模式（title「图片编辑」+ keywords）
- `FileDropZone`：accept 含 png/jpg/webp/bmp，**不含 gif**（canvas 只取第一帧，会造成「编辑了但导出不动」的困惑），`maxFiles={1}`
- 加载流程照抄 `pad/page.tsx`：`readFileAsDataURL` → `loadImage` → 存 `HTMLImageElement` + dataUrl + 原始宽高
- 预览区：`relative` 容器内 `<img>` `object-contain` + `max-h-[60vh]`；「换图片」按钮回初始态

**验证**：页面 200；拖图后预览出现。

## Task 3：AdjustPanel（四个滑块 + 预览渲染）

**Files**：Create `AdjustPanel.tsx`；Modify `page.tsx`

- 预览用**降采样离屏 canvas**：长边 ≤ 1200px，加载时 `drawImage` 缩放生成一次，缓存其 `ImageData` 作为「原始预览像素」
- 渲染管线：原始预览 ImageData → `adjustPixels()`（rAF 节流，dirty 标记每帧最多算一次）→ `putImageData` 到显示 canvas
- 滑块：亮度 0–200 / 对比度 0–200 / 色温 −100~+100 / 色调 −100~+100，实时显示数值；「重置调整」按钮
- SVG 标注层坐标基准始终是原图 naturalWidth/Height，不受预览降采样影响

**验证**：拖滑块预览实时变化；全默认时预览与原图观感一致。

## Task 4：AnnotationCanvas（SVG 标注层 + 撤销重做）

**Files**：Create `AnnotationCanvas.tsx`；Modify `page.tsx`

- `<svg viewBox="0 0 naturalW naturalH" preserveAspectRatio="xMidYMid meet">` 叠于 img 上，坐标即原图像素；meet 模式下与 object-contain 的留白方式一致，天然对齐
- 指针坐标换算：

```ts
const rect = svg.getBoundingClientRect();
const scale = Math.min(rect.width / naturalW, rect.height / naturalH);
const x = (e.clientX - rect.left - (rect.width - naturalW * scale) / 2) / scale;
const y = (e.clientY - rect.top - (rect.height - naturalH * scale) / 2) / scale;
```

- Pointer Events + `setPointerCapture`（鼠标/触摸统一）；工具：直线 / 矩形；颜色 6 选（红黄绿蓝白黑）；线宽 1/2/3/4/6px
- 数据：`{ type: "line"|"rect"; x1; y1; x2; y2; color; strokeWidth }[]`
- 撤销/重做：`past[]` / `future[]` 存**整个数组快照**（标注量小，不做增量）；`Ctrl+Z` / `Ctrl+Shift+Z` 在 page 层挂 window keydown；「清空标注」= push 快照后置空
- 绘制中的图形存独立 `draft` state，pointerup 才入栈

**验证**：鼠标与触摸均可画；样式即时生效；撤销/重做/清空正确。

## Task 5：导出

**Files**：Modify `page.tsx`（若 page 超过 250 行则抽 `lib/image/exportEdit.ts`）

流程（顺序不可调换——标注必须在调整**之后**绘制，否则标注本身会被调色）：

```
canvas(原始 W×H) → drawImage(原图) → getImageData → adjustPixels → putImageData
→ 按 strokeWidth 原值绘制全部标注（导出尺寸=原始尺寸，scale 恒为 1）
→ JPEG 先 fillRect 白底再 drawImage（避免透明像素变黑）→ toBlob → downloadBlob(generateOutputFilename)
```

- PNG / JPEG（quality 0.9）两个按钮；导出中 loading 态
- 参数全默认且无标注时跳过像素循环直接 toBlob

**验证**：默认参数 + 无标注导出 PNG 与原图观感一致；调参后导出与预览一致。

## Task 6：注册 + changelog + 全量验证

**Files**：Modify `config/tools.ts`（image 分类内追加，id `image-edit`，path `/tools/image/edit/`，icon `SlidersHorizontal`）、`app/changelog/page.tsx`

- tools.ts 的 name/description/tags 属对外文案，**候选文案先给用户确认**
- changelog 版本号与条目文案**先给用户确认**（候选 1.8.0）
- 全量验证：`npm run validate` 退出码 0 → `npm run build` 成功 → dev server 页面 200 → 手动交互验证（拖滑块、画标注、撤销、导出）
- 测试/验证用的临时脚本与产物全部清理

## 完成后

写 commit message（待用户确认）→ 单次提交（含当日 memory 日志）→ 不 push。
