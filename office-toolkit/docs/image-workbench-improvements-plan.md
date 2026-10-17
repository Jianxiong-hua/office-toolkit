# 三项改进实现计划：裁剪复用 / 工作台复用 / PDF 提取合并

> 决策已确认：裁剪后标注坐标平移保留；裁剪支持撤销（图像级历史，上限 5 层，dataURL 存储）；
> PDF 复选框仅「按页码范围」模式显示；合并结果用 iframe 内嵌浏览器预览。

## Task 1：PDF 拆分「提取到一个 PDF」（最小改动，先行）

- lib/pdf/split.ts 新增 extractPagesAsOnePdf(buffer, ranges)：
  按输入页码范围展开为页索引数组，一次 copyPages 到新文档（等价于先拆分再合并，单次操作更高效）。
- pdf/split/page.tsx：页码范围模式下显示复选框「将指定页面提取到一个 pdf 文档中」；
  勾选时执行提取合并，结果区改为单个文件卡片：iframe 内嵌预览（blob URL）+ 下载按钮；
  未勾选时行为与现状完全一致。

## Task 2：抽取共享工作台 ImageWorkbench（需求 2 的基础）

- 新建 components/tools/ImageWorkbench.tsx：
  把 image-edit 内联的 75vh 工作台抽出——fitScale 测量（ResizeObserver）、
  滚轮锚点缩放（同步 DOM，wheel passive:false）、fit/100%/zoom% 工具条、
  wrapper（natural x scale 尺寸）。children 渲染于 wrapper 内（调用方 absolute inset-0 填满）。
  props: naturalWidth/naturalHeight/children/heightClass/onScaleChange。
- image-edit/page.tsx 接入（删除内联实现，displayScale 来自 onScaleChange）。

## Task 3：parameter-crop 换用工作台（需求 2）

- 删除 CONTAINER_HEIGHT/calcDisplayInfo/displayInfo state 与其 ResizeObserver effect；
- 预览容器替换为 ImageWorkbench，img 填满 wrapper（无 letterbox，图片尽量大 + 滚轮缩放）；
- 裁剪框渲染坐标 = rect x displayScale（无 offset 项），遮罩 4 段基于 wrapper 尺寸；
- 拖动换算 dx/scale 改为 dx/displayScale（屏幕位移 -> 原图像素）；
- 批量逻辑/坐标输入/格式质量选择/结果列表全部不动。

## Task 4：编辑器增加裁剪（需求 1）

- AnnotationTool 增加 "crop"；AnnotationCanvas 支持 crop 工具：
  拖出选区（虚线框 + 选区外半透明遮罩），pointerup 提交 onCropSelect；
- page.tsx：cropRect state + 应用/取消浮层按钮；
  应用裁剪 = 新 canvas 裁剪原图 -> dataURL -> loadImage 替换 imgRef，
  sourcePixelsRef 重新降采样，标注坐标整体平移（区域外由 viewBox 自然裁掉），
  撤销/重做栈清空（坐标系失效），displayScale 重置 fit；
- 图像级撤销：imageHistory（dataUrl + naturalW/H + 标注快照，上限 5），
  「撤销裁剪」按钮仅在历史非空时显示，恢复时整体还原。

## Task 5：验证 + 提交流程

- validate/build/页面 200；手动验证清单：
  - 编辑器：裁剪选区、应用后标注平移与画布更新、撤销裁剪恢复；
- parameter-crop：大图显示、滚轮缩放、拖动/手柄/坐标输入行为与改造前一致；
  - PDF：勾选复选框提取合并、iframe 预览、下载；未勾选回归正常。
- changelog 候选 1.10.0（文案待用户确认）-> commit message 待确认 -> 单次提交（含 memory）-> 不 push。
