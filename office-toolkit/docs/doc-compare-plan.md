# 文档查看与对比（doc-compare）实现计划

> 对应需求：docs/04-doc-binary-image-tools-requirements.md 第 5 节（决策已确认：docx/txt/md、
> Hirschberg diff、并排双栏行级高亮、.doc 拒绝、编码检测）。
> 执行方式：主会话按任务顺序实现，全程一个 commit（message 待用户确认）。

**Goal**：打开查看 docx/txt/md 文档，或并排对比两份文档的行级差异（新增绿/删除红/修改黄 + 侧边标记 + 同步滚动）。

**Architecture**：文本提取与 diff 全部为 src/lib/document/ 纯函数（node 断言可测）；
docx 解析用 DOMParser（仅浏览器可测，靠最小样例人工验证）；页面组件只管状态与渲染。

**Tech Stack**：React 19 + JSZip（已有依赖）+ DOMParser + TextDecoder，无新依赖。

---

## Task 1：src/lib/document/diff.ts — Hirschberg 分治 LCS

**Step 1（断言先行，红灯）**：.git/tmp-doctest/ 临时目录，模式同前两批。用例：

- 相同文档 → 全部 equal，统计（新增/删除/修改）全 0
- b = a + 尾部追加行 → 追加行全部 added 且行号正确
- b = a 去掉中间一段 → removed 正确
- a 中间改一行 → 恰好一个 changed 对（左右行号正确）
- 完全不同 → min(len) 个 changed + 差额侧单行
- 交换 a/b → added/removed 方向翻转
- 空文档 vs 有内容 → 全 added
- 中文与空行（空行是差异信号，不得被吞）
- 性能冒烟：5000 行相似文档 < 1s

**Step 2（实现）**：

```ts
export const MAX_LINES = 5000;

export interface DiffRow {
  type: "equal" | "changed";
  left: { no: number; text: string; status: "same" | "removed" | "changed" } | null;
  right: { no: number; text: string; status: "same" | "added" | "changed" } | null;
}

export interface DiffStats { added: number; removed: number; changed: number; }

export function diffLines(a: string[], b: string[]): DiffRow[];
export function diffStats(rows: DiffRow[]): DiffStats;
```

- Hirschberg：递归分治 + 两方向线性空间 DP 行（lcsRow / lcsRowRev），输出 matched 索引对
- 基例：任一侧空 -> 直接收尾；单行 -> 线性查找首个匹配
- 行生成：matched 之间夹的连续 removed/added 段按序 zip 成 changed 对，剩余单侧为纯删/纯增
- 并排渲染以 DiffRow 为单位，左栏 null -> 右栏独占（绿），反之亦然

**验证**：断言全过 + 5000 行 < 1s，随后删除临时目录。

## Task 2：src/lib/document/extract.ts — 提取与编码

**Step 1（断言）**：覆盖 decodeText（UTF-8 中文、GBK 字节按 GBK 解）、
needsGbkFallback（含 U+FFFD -> true）、extractPlainText（CR/LF/CRLF 三种换行；
去首尾空行；**保留中间空行**）、pickEncoding（按扩展名给默认编码）。
docx 解析依赖 DOMParser，node 不可测，留待浏览器验证。

**Step 2（实现）**：

```ts
export const SUPPORTED_EXT = ["docx", "txt", "md"] as const;
export type DocEncoding = "utf-8" | "gbk" | "big5";

export function decodeText(buffer: ArrayBuffer, encoding: DocEncoding): string;
export function needsGbkFallback(text: string): boolean;   // 含 U+FFFD
export function extractPlainText(text: string): string[];  // txt/md 通用
export async function extractDocx(buffer: ArrayBuffer): Promise<string[]>;
export function trimBlankLines(lines: string[]): string[];  // 去首尾空行，保留中间
```

docx：动态 import("jszip") -> word/document.xml -> DOMParser 检查 parsererror ->
遍历所有 w:p，拼接其内全部 w:t 的 textContent -> 每段一行。
表格天然被覆盖（单元格内也是 w:p），列对应关系丢失（已知局限，UI 提示）。

**验证**：断言全过后清理临时目录。

## Task 3：页面骨架 + 单文档视图

**Files**：Create app/tools/file/doc-compare/layout.tsx、page.tsx、DocSlot.tsx、SingleView.tsx

- 两个文件槽 A/B（FileDropZone maxFiles=1，accept：docx/txt/md 的 MIME）+ 已加载信息条
- 加载后自动判定：1 个文件 -> 查看模式；2 个 -> 对比模式（自动，无手动切换）
- 槽内信息：文件名、格式、行数；txt/md 显示编码下拉（UTF-8/GBK/Big5，切换即重新解码+diff）
.doc 拖入时给出明确文案：「暂不支持 .doc，请在 Word 中另存为 .docx」
- SingleView：等宽字体、行号列、固定行高 24px
- 超限保护：>5000 行琥珀色横幅「文档较长，差异结果可能不精确」

**验证**：页面 200；txt（UTF-8 与 GBK 各一）查看正常；docx 查看正常（最小样例）。

## Task 4：DiffView（并排双栏 + 同步滚动）

**Files**：Create DiffView.tsx；Modify page.tsx

- 布局：grid 两栏各 overflow-y-auto；行 = 左右两个单元格，**固定行高 24px** 保证 1:1 对齐；
  whitespace-pre overflow-hidden text-ellipsis（默认不换行，超长截断）
- 配色：新增=绿底（右栏）、删除=红底（左栏）、修改=黄底；行首 +/-/~ 标记
- 同步滚动：任一栏 onScroll -> rAF 节流 -> 另一栏 scrollTop 等值赋值；isSyncing ref 防回环
- 顶部统计条：新增 N - 删除 N - 修改 N
- 已知局限提示条（docx 丢格式）

**验证**：构造两份相似 txt 验证三类高亮、行号对齐、滚动同步无偏移、统计正确。

## Task 5：注册 + changelog + 全量验证

**Files**：Modify config/tools.ts（file-doc-compare，path /tools/file/doc-compare/，icon Columns2，
**文案先给用户确认**）、app/changelog/page.tsx（候选 1.9.0，**文案先确认**）

- 全量验证：validate 0 错 -> build 成功 -> 页面 200 -> 手动验证
  （最小 docx 样例 + GBK txt + 相似文档对比）
- 清理全部临时脚本与样例文件

## 完成后

按惯例：写 commit message 待确认 -> 单次提交（含 memory 日志）-> 不 push。
