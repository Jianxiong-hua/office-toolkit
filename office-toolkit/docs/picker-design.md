# 取色器工具 — 设计文档

> 状态：设计确认中 · 2026-08-11
> 关联项目：浩匣 / HaoXia Office Toolkit（纯前端 Next.js 工具站）

## 1. 背景与目标

在图片工具分类下新增一个**取色器（Color Picker / Pipette）**，让用户可以从图片、屏幕、调色板三种来源取色，并在一组"左右双区"调色板中直观对比颜色差异，同时查看多种色值格式（HEX / RGB / HSL / HSV）。

**核心目标**：打开即用、本地处理、直观对比、支持复制。

**非目标**（YAGNI）：
- 不做图片编辑（不保存取色后的图片）
- 不做颜色方案生成 / 色轮高级调节
- 不做跨会话历史持久化（history 仅存于 sessionStorage）

## 2. 功能需求

### 2.1 三种取色来源
| 来源 | 说明 | 浏览器兼容 |
|------|------|-----------|
| **图片取色** | 上传图片，鼠标点击图片任意像素取色 | 全浏览器（Canvas） |
| **屏幕取色** | 点击后出现系统放大镜吸管，取屏幕任意位置 | 仅 Chromium（Chrome/Edge），Safari/Firefox 标识不可用 |
| **调色板** | 原生 `<input type="color">` 手动选色 | 全浏览器 |

### 2.2 双区对比面板（核心交互）
- 页面提供**左区 / 右区**两个取色结果区，各自独立。
- 采用**"激活侧"模式**：通过两个 tab（或点击区域）切换当前激活的是左区还是右区。
- 所有取色动作（图片点击、屏幕取色、调色板选色）的结果写入**当前激活区**。
- 两个区域紧挨显示，方便用户直观对比两色的差异。
- 每个区域展示：
  - 颜色块（大色块预览）
  - HEX / RGB / HSL / HSV 四种色值
  - 每个色值可**点击复制**，复制成功给提示

### 2.3 历史取色记录
- 记录用户本标签页内取过的所有颜色（每次取色写入历史）。
- 存储于 **sessionStorage**：
  - 刷新页面 → 历史保留
  - 关闭标签页 / 浏览器 → 自动清空
- 历史以色块网格展示，点击历史色块可**应用到当前激活区**（方便回看/复用）。
- 提供"清空历史"按钮。

### 2.4 屏幕取色交互（方案 A）
- 点击"屏幕取色"按钮 → 调用 `window.EyeDropper`。
- 依赖原生行为：触发后浏览器显示全屏放大镜，用户移动鼠标到屏幕任意位置点击即取色（无需手动最小化窗口）。
- 取色完成后，色值进入当前激活区，并写入历史。
- **不支持的浏览器**（Safari/Firefox）：屏幕取色按钮**禁用并显示"当前浏览器不支持屏幕取色"提示**，不强行兼容。

## 3. 技术方案

### 3.1 路由与配置
- 新增页面：`src/app/tools/image/picker/page.tsx`
- 在 `src/config/tools.ts` 的 `tools` 数组（image 分类）中新增：
  ```ts
  {
    id: "image-picker",
    name: "取色器",
    description: "从图片、屏幕或调色板取色，左右双区对比 RGB / HSL / HSV",
    category: "image",
    path: "/tools/image/picker/",
    icon: "Pipette",
    tags: ["取色", "颜色", "色值", "RGB", "HSL"],
  }
  ```

### 3.2 色值转换（纯函数，可单测）
新建 `src/lib/color/convert.ts`，提供纯函数：
- `hexToRgb(hex): { r, g, b } | null`（解析 `#RGB` / `#RRGGBB`）
- `rgbToHsl(r, g, b): { h, s, l }`（h: 0-360, s/l: 0-100）
- `rgbToHsv(r, g, b): { h, s, v }`（h: 0-360, s/v: 0-100）
- `rgbToHex(r, g, b): string`
- `parseEyeDropperHex(srgbHex): string`（归一化 EyeDropper 返回的 HEX）

这些函数是纯逻辑，便于用 TDD 写单测。

### 3.3 图片取色实现
- 复用 `FileDropZone` 上传图片，`readFileAsDataURL` + `loadImage`（`src/lib/file.ts` 已有）。
- 将图片绘制到 Canvas，监听 `click` 事件，用 `getImageData(x, y, 1, 1)` 读取点击像素的 RGBA。
- 需要解决**图片缩放后的坐标映射**：预览图用 CSS 缩放显示，需将点击的屏幕坐标换算回原始图片像素坐标（`scaleX = naturalWidth / displayedWidth`）。
- 取到 RGBA → `rgbToHex` / `rgbToHsl` / `rgbToHsv`。

### 3.4 屏幕取色实现
```ts
function pickFromScreen(): Promise<{ hex: string } | null> {
  if (!("EyeDropper" in window)) {
    // 不支持，抛出或返回 null
    return Promise.reject(...);
  }
  const ed = new (window as any).EyeDropper();
  return ed.open().then((res: { sRGBHex: string }) => ({ hex: res.sRGBHex }));
}
```
- TS 需要 `window.EyeDropper` 类型声明：在 `src/types/` 或组件内用 `(window as any)` 规避（项目已有 `gifenc.d.ts`、`pdfjs-worker.d.ts` 先例，可加 `eyedropper.d.ts`）。

### 3.5 状态管理
- 组件内 `useState` 管理：`activeSide: "left" | "right"`、`left: Color | null`、`right: Color | null`。
- 历史用 `useState<string[]>` + 读写 `sessionStorage`。
- 可封装 `useColorHistory` hook（`src/hooks/useColorHistory.ts`），从 sessionStorage 初始化、取色时追加、刷新保留。

### 3.6 UI 组件结构
```
src/app/tools/image/picker/
├── page.tsx            # 主页面（组装）
├── ColorSwatch.tsx     # 单区展示（颜色块 + 4 种色值 + 复制按钮）
├── HistoryBar.tsx      # 历史色块网格 + 清空按钮
└── (可能复用 FileDropZone)
```

## 4. 验收标准
1. 上传图片后可点击取色，左/右区正确显示 HEX/RGB/HSL/HSV。
2. 切换激活区后，图片点击取到的色进入对应区。
3. Chrome/Edge 点击"屏幕取色"可取出屏幕任意位置颜色；Safari/Firefox 按钮禁用且有提示。
4. 调色板选色进入激活区。
5. 点击任意色值可复制，出现成功提示。
6. 历史记录刷新保留、关闭标签页清空；点击历史色块应用到激活区；可清空。
7. 取色器在图片工具分类下正常显示，路由可访问，响应式布局正常。
8. `tsc --noEmit` 通过，无阻塞性 bug。

## 5. 待确认/已确认
- [x] 工具名：取色器；分类：图片工具；图标：Pipette
- [x] 历史存储：sessionStorage（方案 X）
- [x] 屏幕取色：EyeDropper 原生（方案 A），不支持浏览器仅标识
- [x] 三种取色源：图片 / 屏幕 / 调色板
- [x] 双区对比 + 激活侧模式
- [x] 四种色值展示 + 点击复制
