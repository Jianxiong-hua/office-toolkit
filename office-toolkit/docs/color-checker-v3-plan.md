# Color Checker v3 — 实施计划

> 基于 `color-checker-v3-design.md` · 2026-08-16
> 与 v1/v2 需求完全区分，本文档只描述 v3 实施。

## 任务清单

### 阶段一：核心逻辑（HSV 公式 + 颜色库 v3）
- [ ] **任务 1** `src/lib/color/hsvFormula.ts`
  - `evalHsvChannel(expr, srcHsv)`：H/S/V 变量 + 四则/括号，安全求值；H mod 360，S/V clamp [0,100]
  - `generateHsvFormula(srcHsv, targetHsv)`：自动生成 `H+Δ` / `S*比例` / `V*比例`，含 0 值防护
  - `evalHsvLinked(formula, srcHsv)`：求值完整 HSV → 返回
- [ ] **任务 2** `src/lib/colorLibraryV3.ts`（v3 模型）
  - `LibraryColor`（无 asText/asBg）、`ColorLibrary`、`PairItem`
  - `createDefaultLibraryV3()`：6 色
  - `resolveLibraryV3(library)`：链接色按 HSV 公式联动（DFS 防循环，error 回退 baseRgb）
  - `rgbToHsv` / `hsvToRgb`（从 convert.ts 补充或复用）
  - CSV 模板/解析/导出（链接目标用 name）

### 阶段二：颜色库 UI（左侧）
- [ ] **任务 3** `ColorLibraryPanel.tsx` 改造：
  - 去角色勾选，去经验相关
  - 每行：色块+名称+HEX+编辑/删除
  - 链接色展开：源色 HSV 行 + 当前色 HSV 行（H/S/V 调节控件 + 公式文本）
  - 拖拽排序（原生 DnD）
- [ ] **任务 4** `AddColorModal.tsx` 改造：
  - 去 asText/asBg 勾选
  - 链接配置：选源色 + 手动输入 H/S/V 目标 → 自动生成公式（替代手填 R/G/B 公式）

### 阶段三：校验对 UI（右侧）
- [ ] **任务 5** `AddPairModal.tsx`：弹窗选文字色 + 背景色（颜色库下拉）
- [ ] **任务 6** `ResultCard.tsx` 改造：去掉反馈/经验预警，只留预览 + 对比度 + 评级 + 删除
- [ ] **任务 7** `ResultGrid.tsx` 改造：渲染 PairItem 列表，含筛选/排序（可保留），删除 ChartTabs 逻辑

### 阶段四：页面组装与收尾
- [ ] **任务 8** `page.tsx`：v3 状态（library + pairs + mode/cvd/sampleIdx），storage key `colorcheck_state_v3`
- [ ] **任务 9** 删除：ChartTabs.tsx、经验相关代码（bucketExperience/SCORE_META/FeedbackMap）
- [ ] **任务 10** changelog v1.5.0、README 更新
- [ ] **任务 11** `tsc --noEmit` + dev 验证

## 关键文件
- 基础算法复用：`src/lib/color/convert.ts`（hexToRgb/rgbToHex）、`src/lib/color/contrast.ts`（contrastRatio/wcagLevel，保留，删经验）
- 颜色库 v3：`src/lib/colorLibraryV3.ts`（新建，替代 colorLibrary.ts）
- HSV 公式：`src/lib/color/hsvFormula.ts`（新建，替代 formula.ts 的 RGB 用途）

## 注意
- 不引入 dnd 库，用原生 HTML5 DnD
- 旧 storage key `colorcheck_state_v2` 不迁移，忽略
