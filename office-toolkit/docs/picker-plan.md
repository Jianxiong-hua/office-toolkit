# 取色器工具 — 实施计划

> 基于 `picker-design.md` · 2026-08-11
> 测试策略：方案 C（不引入测试框架，用 `tsc --noEmit` + dev 手动验证）

## 任务清单

### 任务 1：色值转换纯函数库
**文件**：`src/lib/color/convert.ts`（新建）
**实现**：
- `hexToRgb(hex): { r, g, b } | null` — 解析 `#RGB` / `#RRGGBB`，非法返回 null
- `rgbToHsl(r, g, b): { h, s, l }` — h: 0-360，s/l: 0-100（四舍五入到 1 位小数）
- `rgbToHsv(r, g, b): { h, s, v }` — h: 0-360，s/v: 0-100
- `rgbToHex(r, g, b): string` — 输出 `#RRGGBB`（大写）
- `parseSrgbHex(input): string` — 归一化 EyeDropper 返回的 `#rrggbb`，转小写统一输出 `#rrggbb`
**验证**：`tsc --noEmit` 通过

### 任务 2：EyeDropper 类型声明
**文件**：`src/types/eyedropper.d.ts`（新建）
**实现**：声明 `interface EyeDropper`、`EyeDropperResult`，扩展 `Window`（`EyeDropper` 构造器），避免全用 `as any`。
**验证**：`tsc --noEmit` 通过

### 任务 3：取色工具注册
**文件**：`src/config/tools.ts`（修改）
**实现**：在 image 分类数组追加：
```ts
{
  id: "image-picker",
  name: "取色器",
  description: "从图片、屏幕或调色板取色，左右双区对比 HEX / RGB / HSL / HSV",
  category: "image",
  path: "/tools/image/picker/",
  icon: "Pipette",
  tags: ["取色", "颜色", "色值", "RGB", "HSL"],
}
```
**验证**：首页图片工具分类出现"取色器"卡片

### 任务 4：图片取色组件（复用 FileDropZone + Canvas）
**文件**：`src/app/tools/image/picker/ImagePicker.tsx`（新建）
**实现**：
- 用 `FileDropZone` 上传图片 → `readFileAsDataURL` + `loadImage`
- Canvas 绘制图片，`click` 取像素：坐标换算（`displayed→natural`），`getImageData(x,y,1,1).data` 得 RGBA
- 取色结果通过 props 回调交给父组件
**验证**：图片上传后可点击取色

### 任务 5：双区对比面板 + 色值展示 + 复制
**文件**：`src/app/tools/image/picker/ColorSwatch.tsx`（新建）
**实现**：
- 单个区域：大色块 + HEX/RGB/HSL/HSV 列表
- 每个色值点击复制（`navigator.clipboard.writeText`），复制成功短暂提示"已复制"
- 激活态高亮（当前激活区有边框/背景标识）
**验证**：色值可复制，激活区视觉可区分

### 任务 6：历史记录（sessionStorage）
**文件**：`src/hooks/useColorHistory.ts`（新建）
**实现**：
- 从 `sessionStorage` 初始化历史（key 如 `picker_history`）
- `addColor(hex)` 追加去重、写入 sessionStorage
- `clear()` 清空
- 组件卸载/关闭标签页由浏览器自动清空（sessionStorage 语义）
**验证**：取色后刷新保留，关标签页后清空

### 任务 7：主页面组装 + 屏幕取色 + 调色板
**文件**：`src/app/tools/image/picker/page.tsx`（新建）
**实现**：
- `ToolLayout` 包装，标题"取色器"
- 状态：`activeSide`、`left`、`right`、`history`
- 三种取色源统一入口，结果写入激活区：
  - 图片取色（来自 ImagePicker）
  - 屏幕取色：`window.EyeDropper`，不支持则按钮禁用 + 提示
  - 调色板：`<input type="color">`
- 左右两个 `ColorSwatch` 紧挨展示，切换激活区
- 历史条：`HistoryBar` 色块网格 + 清空按钮，点击色块应用到激活区

### 任务 8：历史条组件
**文件**：`src/app/tools/image/picker/HistoryBar.tsx`（新建）
**实现**：历史色块网格、点击回调、清空按钮
**验证**：历史随取色累积，可点击复用

### 任务 9：changelog + 收尾
**文件**：`src/app/changelog/page.tsx`（修改）
**实现**：新增 v1.2.0 条目（取色器）
**验证**：changelog 页面显示新版本

## 质量保证
- 每任务后运行 `npx tsc --noEmit` 无错误
- 全部完成后 dev 服务器手动验证 8 项验收标准（见 design.md §4）
- 无阻塞性 bug，响应式布局正常

## 依赖
- 无新增 runtime 依赖（EyeDropper 为原生 API）
- 无新增 devDependency（方案 C）
