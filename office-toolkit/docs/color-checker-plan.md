# Color Checker v2（颜色库模型）— 实施计划

> 基于 `color-checker-design.md` v2 · 2026-08-15
> 测试策略：方案 C（tsc --noEmit + dev 手动验证）

## 背景
将现有"单前景×多背景"Color Checker 重构为 **颜色库 + 多角色 + 联动计算** 模型。保留 WCAG/经验/CVD/评级算法。

## 任务清单

### 阶段一：数据模型与公式引擎（纯逻辑）
- [ ] **任务 1** `src/lib/color/formula.ts`：四则运算表达式引擎
  - `evalChannel(expr, srcRgb)`：R/G/B 变量替换 + 受限 tokenizer 求值（不 eval）
  - 支持数字、R/G/B、+ - * /、括号、小数点；结果 clamp [0,255]；非法返回 null
- [ ] **任务 2** `src/lib/colorLibrary.ts`：颜色库模型
  - `LibraryColor` / `ColorLibrary` 类型、默认 6 色（红绿蓝白灰黑）
  - `resolveDerivedColors(library)`：派生色联动计算（源变→目标变，支持链式，防循环）
  - `parseColorCsv(text)`：CSV 解析 + 校验（名称重复/RGB越界/链接不存在/公式非法）

### 阶段二：UI 重构（页面 + 组件）
- [ ] **任务 3** `page.tsx`：状态改为颜色库模型，多文字色分组；持久化 key 改 `colorcheck_state_v2`
- [ ] **任务 4** `ColorLibraryPanel.tsx`：颜色库管理（列表、增删改、角色勾选、链接配置、导入导出、模板下载）
- [ ] **任务 5** `AddColorModal.tsx`：新建/编辑颜色（RGB/名称/角色勾选/链接源+公式）
- [ ] **任务 6** `ChartTabs.tsx`：文字色分组 Tab 切换（N 个文字色 → N 组）
- [ ] **任务 7** `ImportModal.tsx`：导入流程（备份询问 → 清空 → 解析 → 校验提示）
- [ ] **任务 8** `ResultGrid.tsx` / `ResultCard.tsx`：改造适配分组（按当前文字色渲染，复用对比度/评级/反馈/CVD）

### 阶段三：收尾
- [ ] **任务 9** changelog v1.4.0
- [ ] **任务 10** README 更新（颜色库能力）
- [ ] **任务 11** `tsc --noEmit` + dev 验证

## 关键保留
- `src/lib/color/contrast.ts` 的 WCAG 算法、经验学习、评级（不重构）
- `src/lib/color/convert.ts` 基础转换
- `CvdFilter.tsx` 色觉模拟

## 参考
- 旧状态：`ColorCheckState`（v1，feedback 结构沿用）
- 持久化：`usePersistedState` hook（key 版本隔离 v1→v2）
