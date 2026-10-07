# 04 - 文档查看对比 / 二进制查看 / 图片编辑 需求与实现方案

> 状态：**待确认**（确认后才开工）
> 日期：2026-10-07
> 适用：三个新工具的设计基线，后续代码实现以此为准
> 应用目录：`office-toolkit/`（Next.js 15 App Router + React 19 + TS strict + Tailwind v4，纯前端静态导出）

---

## 1. 已确认决策记录

本节是全文的依据。任何一项若要变更，需先回改本节。

| # | 决策项 | 结论 |
|---|---|---|
| 1 | 推进节奏 | 分三批，按难度递增：bin 查看器 → 图片编辑器 → 文档查看对比。每批一个设计落地 + 一个 commit |
| 2 | 工具归属分类 | 新增单一分类 `file`，显示名「文档与文件」。三个工具中 bin 查看器、文档对比归入 `file`；图片编辑器归入已有的 `image` |
| 3 | 文档格式支持 | 仅 `docx` / `txt` / `md`。`.doc` 明确拒绝并提示另存为 docx，不做尽力解析 |
| 4 | 差异呈现 | 并排双栏 + **行级**高亮（不做字符级高亮） |
| 5 | 图像调整实现 | **统一 canvas 像素处理**（预览与导出共用同一份函数），不做 CSS filter |
| 6 | bin 视图每行字节数 | 可调：8 / 16 / 24 / 32，默认 16 |
| 7 | bin 偏移跳转 | 需要。**统一按十六进制解释**（与偏移列显示方式一致），支持 `0x` 前缀 |
| 8 | bin 字节搜索 | 需要。自动判别 hex / 文本，支持 `h:` / `t:` 前缀显式消歧，命中总数计数 + 列表上限 200 + 上/下一处跳转 |
| 9 | bin 整数/浮点解释 | 需要。大端/小端双列展示 uint8~float64 |
| 10 | bin 文件类型识别 | 约 28 条常见魔数；判定优先级：**扩展名 → 魔数 → 未知**；`.bin`/`.raw`/`.hex`/`.dat` 归为「原始二进制」 |
| 11 | bin 文件大小 | 软限制 20MB（超出提示但允许继续）；> 100MB 直接拒绝 |
| 12 | 虚拟滚动 | 自研固定行高，不引入 react-window |
| 13 | 搜索命中上限 | 必须。20MB 文件搜 `00` 可命中数十万处，列表只渲染前 200 条 |
| 14 | 魔数表范围 | 约 25 条常见格式，不做 200+ 全格式覆盖 |

---

## 2. 共性约束

### 2.1 技术底座（硬约束，不可违背）

- **纯前端静态导出**：`next.config.ts` 为 `output: "export"` + `trailingSlash: true`，部署 Cloudflare Pages。**没有服务端、没有 API Routes、不能用 Server Actions**。所有解析与处理必须跑在浏览器。
- 无测试框架。质量门禁只有 `npm run validate`（`tsc --noEmit`）与 `npm run build`。
- 处理逻辑一律外置到 `src/lib/**` 的纯函数，页面组件只管状态与 UI（项目既有约定）。

### 2.2 新增 `file` 分类需要改的 4 处硬编码

分类不只是加个枚举，项目里有 **4 个硬编码点**都会因新分类而漏改：

| # | 文件 | 改动 |
|---|---|---|
| 1 | `src/config/site.ts:14` | `ToolCategory` 联合类型加 `\| "file"` |
| 2 | `src/config/tools.ts:114-118` | `toolsByCategory` 加 `file: tools.filter(t => t.category === "file")` |
| 3 | `src/app/page.tsx:37-94` | 首页分类区块是**手写 `<section>`**，不是遍历渲染。需照 pdf/design 区块新增一个 `<section id="file-tools">` |
| 4 | `src/components/tools/ToolCard.tsx:6-16` | `categoryColors` 与 `categoryIconBg` 两张映射表要各加一个 `file` 键，否则配色静默回退成灰色 |

### 2.3 其他易踩的坑

- **路由 path 必须带结尾斜杠**（`trailingSlash: true`），即 `/tools/file/bin-viewer/`。
- **`tool.icon` 写错不会报错**，但 `ToolCard.tsx:26` 会在找不到时静默 fallback 到 `Wrench`（扳手图标）。实现时必须 grep 校验图标在 `lucide-react` 中真实存在。
  - 已校验可用：`Binary` `ScanLine` `FileSearch` `FileDiff` `Columns2` `Braces` `Paintbrush` `SlidersHorizontal` `BoxSelect` `PenLine` `ThermometerSun` `SunMedium` `Frame`
- 工具 `id` 建议沿用 `<category>-<tool>` 惯例（如 `image-compress`）。
- 错误展示分两类：处理失败用 `ErrorAlert`（带重试）；输入/校验类用琥珀色内联横幅。
- 下载统一用 `lib/file.ts` 的 `downloadBlob`，文件名统一用 `generateOutputFilename`。
- 批量工具模式（多文件 → jszip 打包）不适用于本次三个工具，本次均为**单文件**处理。

### 2.4 红线（需另行确认，不得擅自执行）

- `tools.ts` 中三个工具的 `name` / `description` / `tags` / `icon` / `featured` 属于**站点对外文案**，候选文案见第 7 节，须确认后才写入。
- `changelog/page.tsx` 的版本条目与文案须确认后才写。
- `package.json` 版本号是否变更、changelog 是新增条目还是并入现有条目，由你决定。
- commit message 写好全文待确认后才提交；默认只提交不 push。

---

## 3. 工具一：bin 文件查看器（第一批）

| 项 | 值 |
|---|---|
| 路由 | `/tools/file/bin-viewer/` |
| 工具 id | `file-bin-viewer` |
| 分类 | `file` |
| 预估规模 | 约 600–700 行 |

### 3.1 需求定义

**用户故事**：我手上有一个来源不明的二进制文件（固件片段、崩溃 dump、协议包、加密密钥），想在浏览器里直接看清它的字节内容和头部信息，不上传给任何服务器。

**功能点**

| # | 功能 | 细节 |
|---|---|---|
| F1 | 加载文件 | 单文件，接受任意扩展名。读为 `ArrayBuffer` |
| F2 | Hex 视图 | 三列布局：`偏移量`（8 位十六进制定宽） + `hex 字节`（大写两字符，空字节显示为淡色空格或 `.`） + `ASCII`（可打印字符原样，其余替换为 `.`） |
| F3 | 每行字节数 | 8 / 16 / 24 / 32，默认 16。切换后保留当前首个可见偏移 |
| F4 | 偏移跳转 | 顶部输入框，**统一按十六进制解释**（与偏移列显示一致），接受 `1F40` 或 `0x1F40`。越界时输入框标红并提示有效范围 |
| F5 | 字节搜索 | 自动判别模式：含空格/逗号且为合法偶数长度 hex 串 → 字节串；compact 全为数字 → 文本；其余合法偶数长度 hex 串 → 字节串；其余 → 文本。歧义输入（如 `cafe` 既是文本也是字节 CA FE）用 `h:` / `t:` 前缀显式指定。**精确字节匹配，区分大小写**。显示「共命中 N 处」，列表**最多 200 条**，超出提示「仅显示前 200 处，上一处/下一处只能在这 200 处内跳转」 |
| F6 | 数值解释 | 点击任意字节 → 右侧面板显示**从该字节起**的 `uint8/int8/uint16/int16/uint32/int32/float32/float64`，大端与小端两列并排。越界的项显示 `—` |
| F7 | 类型识别 | 顶部显示识别结果。按扩展名 → 魔数 → 「未知格式」三级判定。用户可在下拉框中手动覆盖识别结果（仅改标注，不影响 hex 渲染） |

**明确不做**

- 不做结构化解析（不解析 PE 头/ELF 段表/图片具体格式）
- 不做 16 位分组（`0000 0010 0020` 那种 xxd 风格）—— 只做标准 8/16/24/32 字节每行
- 不做只读保护 / 编辑 / 写回
- 不做拖拽多文件
- 不做文件分块流式加载（全量读入，100MB 拒绝）

### 3.2 实现方案

**为什么必须虚拟滚动（强制约束）**

20MB 上限 = 20,971,520 字节；16 字节/行 = **1,310,720 行**。一次性渲染会导致 DOM 节点破千万，页面直接卡死。10MB 时也有 65 万行，同样不可接受。因此 hex 视图**只渲染可视区约 40–60 行**。

**文件清单**

```
src/lib/bin/hex.ts         纯函数：行格式化、偏移解析     ~60 行
src/lib/bin/search.ts      纯函数：查询解析、命中查找     ~90 行
src/lib/bin/interpret.ts   纯函数：大小端数值解释         ~60 行
src/lib/bin/magic.ts       魔数表 + 扩展名/魔数识别      ~120 行
src/app/tools/file/bin-viewer/page.tsx        状态编排 + 面板   ~250 行
src/app/tools/file/bin-viewer/HexView.tsx     虚拟滚动视图      ~110 行
src/app/tools/file/bin-viewer/layout.tsx      SEO metadata      ~15 行
```

**关键设计**

1. **`lib/bin/hex.ts` — 行格式化**

   ```ts
   export const BYTES_PER_LINE_OPTIONS = [8, 16, 24, 32] as const;
   export const DEFAULT_BYTES_PER_LINE = 16;
   export const ROW_HEIGHT = 24; // px，必须与 HexView 中的样式常量一致

   export function totalLines(byteLength: number, bytesPerLine: number): number;
   export function formatRow(
     bytes: Uint8Array,
     lineIndex: number,
     bytesPerLine: number
   ): { offset: string; cells: { hex: string; ascii: string; index: number }[] };
   export function parseOffset(input: string, byteLength: number): number | null;
   // 接受 "0x1F" / "1f" / "31"，统一按十六进制解释；
   // 纯十进制无 0x 前缀时按十进制解释。返回 null 表示非法或越界。
   ```

   `formatRow` 只做纯计算，不碰 DOM，因此可在任意滚动位置按需调用，天然适配虚拟滚动。

2. **`HexView.tsx` — 自研固定行高虚拟滚动**

   - 结构：外层 `relative` 容器设 `height = totalLines * ROW_HEIGHT`；内层 `absolute inset-x-0` 容器监听 `onScroll`，维护 `scrollTop` state
   - 计算：`startLine = max(0, floor(scrollTop / ROW_HEIGHT) - OVERSCAN)`，`visibleCount = ceil(viewportH / ROW_HEIGHT) + 1`，`endLine = min(totalLines, startLine + visibleCount + OVERSCAN * 2)`，`OVERSCAN = 5`
   - 渲染：`<div style={{ transform: translateY(startLine * ROW_HEIGHT) }}>` 包裹实际行
   - 行样式必须写死高度以保证 `ROW_HEIGHT` 常量成立：`h-6 leading-6`（`h-6` = 24px = `ROW_HEIGHT`）
   - 跳转 / 搜索命中：设置容器 `scrollTop = line * ROW_HEIGHT`，并对该行加 1 秒高亮态
   - 容器高度用 `flex-1` + 固定最小高度，保证在窄屏下仍可用

3. **`lib/bin/search.ts` — 搜索**

   ```ts
   export const MAX_LISTED_HITS = 200;
   export function parseQuery(input: string): { bytes: number[]; mode: "hex" | "ascii" } | null;
   export function findHits(bytes, pattern): { total: number; offsets: number[]; truncated: boolean };
   ```

   判别规则（按顺序，命中即返回）：

   | 输入 | 判为 | 理由 |
   |---|---|---|
   | `h:cafe` / `hex:cafe` | hex | 前缀强制 |
   | `t:cafe` / `text:cafe` | ascii | 前缀强制 |
   | `FF 00` / `10 24` | hex | 含分隔符 + 合法偶数长度 hex |
   | `1024` | ascii | compact 全为数字，搜文本更常见 |
   | `ff00` / `deadbeef` | ascii→`ff00` 为 hex | 合法偶数长度 hex 串且含 a-f |
   | `hello` / `F` | ascii | 含非 hex 字符 / 奇数长度 |

   存在**无法自动消除的歧义**：`cafe` 既可能是文本、也可能是字节 CA FE。因此提供 `h:` / `t:` 前缀
   显式指定，不靠猜。除空输入外总是返回可用结果，不会因格式歧义而失败。

   - 两种模式都是**精确字节匹配**，因此**区分大小写**（字节层面不存在大小写不敏感）
   - `findHits` 用首字节预筛选 + 内层比对，20MB 全量扫描约 20–40ms，无需分片
   - 命中总数继续累加到扫描结束（不因达到 200 上限而提前退出），只截断 `offsets` 列表

4. **`lib/bin/interpret.ts` — 数值解释**

   ```ts
   export function interpretAt(bytes: Uint8Array, offset: number): InterpretResult;
   // items: [{ label, size, big, little }]，剩余字节不足时 big/little 为 "—"
   ```

   用 `DataView` + 显式 littleEndian 标志实现。`DataView` 构造时必须带 `byteOffset` / `byteLength` 限定范围，
   否则传入 subarray 会读错位置。`float32` / `float64` 用非有限值兜底显示（`NaN` / `Infinity`），
   并收敛到 7 位有效数字以去掉二进制表示长尾（0.1 → 0.1 而非 0.10000000149011612）。

5. **`lib/bin/magic.ts` — 类型识别**

   ```ts
   export function detectByMagic(bytes: Uint8Array): string | null;
   export function detectFormat(filename: string, bytes: Uint8Array): FormatInfo;
   // FormatInfo: { name; source; mismatch; magicName }
   export const FORMAT_OPTIONS: string[]; // 供手动指定下拉
   ```

   扩展名表约 60 项，含 `bin/raw/hex/dat/img/dump` → 原始二进制。
   魔数表约 28 条：PNG、JPEG、GIF、BMP、WebP(offset 8)、ICO、PSD、PDF、ZIP、ELF、PE/MZ、
   gzip、BZIP2、XZ、7z、RAR、MP3(ID3)、MP4(offset 4 `ftyp`)、WAV(offset 8)、OGG、FLAC、
   SQLite、DEX、Java class、WebAssembly、TrueType、OpenType、WOFF、WOFF2。
   `offset > 0` 的规则排在前面（随机数据在靠后偏移处命中概率低，先匹配可减少误判）。

   - 扩展名与魔名不一致时**以扩展名为准**（用户明确选的优先级），但置 `mismatch` 并在 UI 追加提示
     「扩展名与文件内容不一致」，因为这是最有价值的诊断信息
   - **不做 OOXML 细分**：docx/xlsx/pptx 内部首个 entry 是 `[Content_Types].xml` 且内容为 deflate
     压缩，从魔数可靠区分 docx/xlsx/pptx 的成本远高于收益。命中 ZIP 就显示「ZIP 压缩包」，
   - 扩展名映射表与魔数表的名称**刻意使用同一套字符串**，这样两者都命中时才能直接比对出 mismatch

6. **大小限制与文件加载**

   - `> 100MB`：直接拒绝，红色提示「文件超过 100MB 大小限制」
   - `> 20MB`：琥珀色横幅「文件较大，浏览与搜索可能变慢」，仍可继续
   - **不用通用 `FileDropZone`**：它基于 react-dropzone，而 react-dropzone 的 `accept` 走 `attr-accept`，
     对空数组一律返回 false，无法表达「接受任意文件类型」。本工具使用自研的 `LoadZone.tsx`
     （input[type=file] + 拖拽 + 100MB 校验），约 60 行

### 3.3 文件清单

```
src/lib/bin/hex.ts                    行格式化、偏移解析           约 60 行
src/lib/bin/search.ts                 查询解析、命中查找           约 90 行
src/lib/bin/interpret.ts              大小端数值解释               约 70 行
src/lib/bin/magic.ts                  魔数表、扩展名/魔数识别      约 170 行
src/app/tools/file/bin-viewer/page.tsx        状态编排            约 220 行
src/app/tools/file/bin-viewer/HexView.tsx     虚拟滚动视图        约 170 行
src/app/tools/file/bin-viewer/LoadZone.tsx    任意类型文件加载区   约 90 行
src/app/tools/file/bin-viewer/Toolbar.tsx     每行字节数+偏移跳转  约 80 行
src/app/tools/file/bin-viewer/SearchBar.tsx   搜索栏+命中统计     约 120 行
src/app/tools/file/bin-viewer/SidePanel.tsx   命中列表+数值解释   约 95 行
src/app/tools/file/bin-viewer/FileInfoBar.tsx 文件信息+类型下拉    约 75 行
src/app/tools/file/bin-viewer/layout.tsx      SEO metadata       约 18 行
```

主页面只做状态编排，UI 拆成 5 个职责单一的组件（与 `design/contrast` 工具的拆分风格一致）。

### 3.4 验收标准

- [ ] 加载 20MB 文件，页面首屏渲染不卡死，滚动流畅
- [ ] 每行字节数 8/16/24/32 均正确渲染，切换后偏移不错位
- [ ] 偏移跳转支持 `1F40` 与 `0x1F40`，越界有明确提示
- [ ] 搜 `hello`（含 a-f 字母的文本）能正常匹配，不被误判为 hex
- [ ] 搜 `FF 00`、`ff00`、`1024`、`h:cafe`、`t:cafe` 均按预期模式匹配
- [ ] 命中总数准确，列表不超过 200 条，上/下一处在列出的范围内循环
- [ ] 点击任意字节，8 种类型 × 大小端共 16 个数值正确，越界显示 `—`
- [ ] 浮点数显示为 `0.1` 而非 `0.10000000149011612`；`NaN` / `Infinity` 正确显示
- [ ] `.bin` 文件显示「原始二进制」；改名为 `.png` 的非 PNG 文件显示扩展名结果并给出一致性提示；纯随机字节显示「未知格式」
- [ ] 拖入 > 100MB 文件被拒绝且提示清晰
- [ ] `npm run validate` 退出码 0；`npm run build` 成功

---

## 4. 工具二：图片编辑器（第二批）

| 项 | 值 |
|---|---|
| 路由 | `/tools/image/edit/` |
| 工具 id | `image-edit` |
| 分类 | `image`（已有分类，不需新增） |
| 预估规模 | 约 500–600 行 |

### 4.1 需求定义

**用户故事**：我有一张截图/照片，想在上面画线或画框做标注，也想调一下亮度、对比度、色温、色调，然后导出成新图片，不想装 Photoshop。

**功能点**

| # | 功能 | 细节 |
|---|---|---|
| F1 | 加载图片 | 单图，支持已有工具支持的全部格式（走 `loadImage`） |
| F2 | 画直线 | 指针按下 → 拖动 → 松开。起点终点均为原图像素坐标 |
| F3 | 画矩形 | 同上，绘制矩形边框 |
| F4 | 标注样式 | 6 色（红/黄/绿/蓝/白/黑）+ 线宽 1/2/3/4/6 px |
| F5 | 撤销 / 重做 | 操作栈 + `Ctrl+Z` / `Ctrl+Shift+Z`；「清空标注」按钮 |
| F6 | 亮度 | 0–200%，默认 100% |
| F7 | 对比度 | 0–200%，默认 100% |
| F8 | 色温 | -100（冷）~ +100（暖），默认 0 |
| F9 | 色调 | -100（绿）~ +100（品红），默认 0 |
| F10 | 重置 | 一键把所有参数恢复默认并清空标注 |
| F11 | 导出 | PNG 或 JPEG（JPEG 质量 0.9）；输出保持**原始像素尺寸** |

**明确不做**

- 不做自由手绘曲线（用户只要「线」和「框」）
- 不做椭圆/箭头/文字标注
- 不做选区/局部调整
- 不做裁剪/旋转（已有 `image-crop` 工具，不重复实现）
- 不做批量处理
- 不做项目保存 / 撤销栈持久化（刷新即丢，符合 YAGNI）

### 4.2 实现方案

**核心：预览与导出共用同一份像素处理函数**

这是本方案最关键的设计约束。早期考虑过「预览用 CSS `filter`、导出用 `ctx.filter`」，但**已否决**——CSS filter 没有「色温」，且两套算法必然导致预览与导出结果不一致。

改为：一份 `adjustPixels()` 纯函数，预览和导出都调用它，从根上消除不一致。也不依赖 `ctx.filter` 的浏览器兼容性（Safari 17.4 前支持不完整）。

**`lib/image/adjust.ts` — 像素算法**

```ts
export interface AdjustParams {
  brightness: number;  // 0-200，100 = 原图
  contrast: number;    // 0-200，100 = 原图
  temperature: number; // -100 ~ +100，0 = 原图
  tint: number;        // -100 ~ +100，0 = 原图
}
export const DEFAULT_ADJUST: AdjustParams = { brightness: 100, contrast: 100, temperature: 0, tint: 0 };

// 顺序固定：先亮度/对比度（灰阶类），再色温/色调（通道增益类）。
// 顺序会影响结果，必须固定并写入文档。
export function adjustPixels(imageData: ImageData, p: AdjustParams): ImageData;
// 四个参数全部为默认值时直接返回入参引用（省掉一次全图重算）
```

算法（每通道 `v ∈ [0,255]`，`t` 为归一化到 `[-1,1]` 的滑块值）：

```
// 1. 亮度
v = v * (brightness / 100)

// 2. 对比度
v = (v - 128) * (contrast / 100) + 128

// 3. 色温：暖=红升蓝降，冷=红降蓝升（统一线性公式，无需分支）
r = r * (1 + 0.30 * tTemp)
b = b * (1 - 0.30 * tTemp)

// 4. 色调：品红=红升绿降，绿=红降绿升（与色温同向作用于红，区别在蓝/绿通道）
r = r * (1 + 0.20 * tTint)
g = g * (1 - 0.40 * tTint)

// 每步末尾 clamp 到 [0,255]，四舍五入取整
```

> 说明：色温与色调都使红通道同向变化，视觉区分由蓝通道（色温）与绿通道（色调）承担。这是线性可逆的近似，参数意义清晰、无分支，便于后续校准。

**预览性能（唯一的技术难点）**

- 预览 canvas 使用**降采样图**：长边缩到 ≤ 1200px。1200×900 ≈ 108 万像素，一次全像素循环实测约 10–20ms，拖动滑块可接受。
- 用 `requestAnimationFrame` 节流：滑块 `onChange` 只置 `dirty` 标记，rAF 回调中每帧最多执行一次全图重算，避免高频事件堆积。
- 原图 `ImageData` 只解析一次并缓存，重算时复用（`putImageData` 前先 `getImageData` 回读，因为 `putImageData` 会破坏原数据）。

**标注层：SVG overlay（不是 canvas）**

- 用 `<svg viewBox="0 0 naturalW naturalH">` 覆盖在预览图上，**坐标直接用原图像素坐标系**，显示尺寸变化时浏览器自动缩放，无需任何坐标换算
- 用 Pointer Events（`onPointerDown/Move/Up` + `setPointerCapture`）统一处理鼠标与触摸
- 标注数据结构：`{ type: "line" | "rect"; x1; y1; x2; y2; color; strokeWidth }[]`
- 撤销/重做：`past[]` / `future[]` 两个栈，每次成功绘制 push 到 `past` 并清空 `future`

**导出流程（顺序不可调换）**

```
1. 建 canvas，尺寸 = 原始 W × H
2. drawImage 原图
3. getImageData → adjustPixels() → putImageData     ← 调整只作用于原图像素
4. 按 scale = 导出宽 / 原图宽 缩放后，用 Path2D 绘制全部标注
   （strokeWidth 也需 × scale，保证导出不同尺寸时标注比例一致）
5. toBlob → downloadBlob（文件名用 generateOutputFilename）
```

标注**必须在调整之后**绘制，否则标注本身也会被色温/亮度影响。

**文件清单**

```
src/lib/image/adjust.ts                        像素算法          ~80 行
src/app/tools/image/edit/page.tsx              状态编排           ~220 行
src/app/tools/image/edit/AnnotationCanvas.tsx  SVG 标注层 + 交互 ~180 行
src/app/tools/image/edit/AdjustPanel.tsx       四个滑块 + 重置    ~110 行
src/app/tools/image/edit/layout.tsx            metadata          ~15 行
```

### 4.3 验收标准

- [ ] 画线、画框在鼠标与触摸下均正常；颜色与线宽切换即时生效
- [ ] 撤销/重做覆盖全部绘制操作；「清空标注」可用
- [ ] 四个滑块拖动流畅（108 万像素预览不出现可感卡顿）
- [ ] 亮度 100 / 对比度 100 / 色温 0 / 色调 0 时导出图与原图逐像素一致
- [ ] 导出 PNG 与 JPEG 均保持原始像素尺寸，标注比例正确（导出 2× 尺寸时线宽同步变粗）
- [ ] 标注颜色在调整之后绘制，不受亮度/色温影响
- [ ] 3 万像素以上的图片不卡死
- [ ] `npm run validate` 退出码 0；`npm run build` 成功

---

## 5. 工具三：文档查看与对比（第三批）

| 项 | 值 |
|---|---|
| 路由 | `/tools/file/doc-compare/` |
| 工具 id | `file-doc-compare` |
| 分类 | `file` |
| 预估规模 | 约 550–650 行 |

### 5.1 需求定义

**用户故事**：我改了一份文档，想知道跟上一版到底改了哪些地方；或者手上有一份文档只想直接打开看内容。

**两种模式**

- **单文档查看**：打开一个文档，纯文本等宽渲染
- **双文档对比**：打开两个文档，并排双栏，行级高亮差异

**功能点**

| # | 功能 | 细节 |
|---|---|---|
| F1 | 格式支持 | `docx` / `txt` / `md`。`.doc` **直接拒绝**，提示「暂不支持 .doc，请在 Word 中另存为 .docx」 |
| F2 | 文本编码 | `txt`/`md` 先按 UTF-8 解码；若结果含替换字符 `U+FFFD`（中文 txt 常为 GBK），自动回退 GBK 重解；仍异常时提供编码下拉（UTF-8 / GBK / Big5）手动切换 |
| F3 | 单文档查看 | 等宽字体、保留原始换行、显示行号；顶部显示文件名、格式、行数、字符数 |
| F4 | 并排对比 | 左右两栏，同一行号垂直对齐；可关闭对比模式回到单文档视图 |
| F5 | 行级高亮 | 新增行=绿色底、删除行=红色底、修改行=黄色底；每行左侧留 `+` / `-` / `~` 标记 |
| F6 | 差异统计 | 顶部显示「新增 N 行 · 删除 N 行 · 修改 N 行」 |
| F7 | 同步滚动 | 拖动任一栏，另一栏跟随。固定行高保证 1:1 精确对应 |
| F8 | 换行开关 | 默认「不换行」（超长行截断为省略号，保证两侧对齐）；可切换为「自动换行」阅读，此时对齐为近似 |

**明确不做**

- 不做字符级高亮（已决策）
- 不做「跳到下一处差异」按钮（可后续再加）
- 不做编辑 / 合并 / 导出差异报告
- 不做 `.doc`、`.rtf`、`.odt`、`.pdf` 支持
- 不保留 docx 的格式、表格结构、修订记录

**已知局限（须在 UI 上以提示条说明）**

- docx 解析会**丢失全部格式**：标题层级、加粗/颜色、列表符号、表格的行列对应关系（表格被展平为逐行文本）、图片、脚注、批注、页眉页脚、修订记录。
- 仅读取 `word/document.xml` 正文。
- 适合「文字内容是否改过」这一诉求，不适合「排版是否改过」。

### 5.2 实现方案

**文本提取**

| 格式 | 做法 |
|---|---|
| `txt` / `md` | `TextDecoder` 解码 → 按 `/\r\n\|\r\|\n/` 分割行。**md 保留原始语法不剥离**（对比的是文件内容，不是渲染结果） |
| `docx` | 动态 `import("jszip")`（项目已有依赖）→ `word/document.xml` → `DOMParser` 解析为 XML → 遍历所有 `<w:p>` 元素，每个元素内拼接其所有 `<w:t>` 的 `textContent` 得到一行 |

```ts
// src/lib/document/extract.ts
export interface ExtractedDoc { lines: string[]; format: "docx" | "txt" | "md"; }
export const SUPPORTED_EXT = ["docx", "txt", "md"] as const;
export function decodeText(buffer: ArrayBuffer, encoding: string): string;
export function needsGbkFallback(text: string): boolean;  // 是否含 U+FFFD
export async function extractDocx(arrayBuffer: ArrayBuffer): Promise<string[]>;
export function extractPlainText(text: string): string[];
```

注意事项写进代码注释：
- `DOMParser` 对 XML 用 `getElementsByTagName("w:p")` 前缀匹配可用，但必须检查 `parsererror` 节点
- 表格单元格内也是 `<w:p>`，遍历所有 `w:p` 天然覆盖表格，但**列对应关系丢失**
- `<w:br/>` 等行内换行符忽略不计
- 去掉首尾空白行，保留中间空行（空行是重要的差异信号）

**Diff 算法：Hirschberg 分治 LCS**

选它的理由（LCS 全量 DP 不可行的原因）：

- 全量 DP 需存 `N×M` 矩阵，5000×5000 = 2500 万格，即便压到 `Uint16Array` 也要 50MB
- Myers O(ND) 在「两文档几乎完全相同」时 D 很小、很快，但「几乎完全不同」时 D≈N+M，优势消失，且实现更复杂
- **Hirschberg**：时间 O(N×M) 与全量 DP 相同，但空间只要 O(min(N,M))，约 60 行可实现，行为可预测、无需设 D 上限

```ts
// src/lib/document/diff.ts
export type DiffOp = { type: "equal" | "removed" | "added"; line: string; leftNo: number | null; rightNo: number | null };
export const MAX_LINES = 5000;  // 超限提示并降级
export function diffLines(a: string[], b: string[]): DiffOp[];
```

- 行数上限 5000（每篇），超出时显示琥珀色横幅「文档较长，差异结果可能不精确」但仍可使用
- 单元格 ~2500 万次字符比较，JS 实测约 100–200ms，配合「解析中」状态提示可接受
- **修改行的配对推断**：LCS 结果中连续的 `removed` 段与紧随其后的 `added` 段按顺序两两配对为 `changed`（渲染为黄色 + `~` 标记），多出的一侧为纯删/纯增

**并排布局与滚动同步**

- 两侧各一个 `overflow-y: auto` 容器，**每行固定高度**（`h-6 leading-6` + `whitespace-pre` + `overflow-hidden` + `text-ellipsis`），确保两侧第 N 行垂直位置完全一致
- 同步：任一栏 `onScroll` 时 `rAF` 节流，把 `scrollTop` 直接赋给另一栏（因为两侧行数组一一对应，1:1 等值即可，无需按比例换算）
- 用 `isSyncing` ref 标志防止回环：程序化赋值时置 true，`requestAnimationFrame` 后复位
- 5000 行 × 2 栏 = 10000 个 div，浏览器可接受，**无需虚拟滚动**（这也是设 5000 行上限的原因之一）

**文件清单**

```
src/lib/document/extract.ts                    文本提取 + 编码检测   ~150 行
src/lib/document/diff.ts                       Hirschberg LCS      ~120 行
src/app/tools/file/doc-compare/page.tsx        模式编排             ~180 行
src/app/tools/file/doc-compare/DiffView.tsx    并排双栏 + 同步滚动 ~130 行
src/app/tools/file/doc-compare/SingleView.tsx  单文档视图           ~60 行
src/app/tools/file/doc-compare/layout.tsx      metadata            ~15 行
```

### 5.3 验收标准

- [ ] `docx`（含中文、含表格、含空行）能正确提取文字并分行
- [ ] `.doc` 被拒绝，提示文案明确指向「另存为 docx」
- [ ] GBK 编码的中文 txt 自动正确解码；必要时可手动切换编码
- [ ] md 保留原始语法标记
- [ ] 并排双栏行号垂直对齐，同步滚动无偏移
- [ ] 新增/删除/修改三类行高亮与侧边标记正确，统计数字与实际一致
- [ ] 两份完全相同的文档 → 全部为 `equal`，统计全 0
- [ ] 交换两文档顺序 → 差异方向正确翻转
- [ ] 5000 行文档出结果在 1 秒内，且有加载提示
- [ ] `npm run validate` 退出码 0；`npm run build` 成功

---

## 6. 批次与交付

| 批次 | 工具 | 前置 | 交付物 |
|---|---|---|---|
| 1 | bin 文件查看器 | 无 | `file` 分类落地（4 处硬编码）+ 工具页 + changelog 条目（文案待确认） |
| 2 | 图片编辑器 | 无（`image` 分类已存在） | 工具页 + changelog 条目（文案待确认） |
| 3 | 文档查看与对比 | 依赖批次 1 的 `file` 分类 | 工具页 + changelog 条目（文案待确认） |

每批结束跑 `npm run validate`（tsc）必须退出码 0、`npm run build` 必须成功、`/tools/<path>/` 返回 200。测试期间产生的临时脚本与样例文件在每批结束前清理（项目既有卫生约定）。

---

## 7. 对外文案候选（**红线：确认后才写入 `tools.ts`**）

| id | name | description | category | path | icon | tags | featured |
|---|---|---|---|---|---|---|---|
| `file-bin-viewer` | 二进制查看器 | 在线查看二进制文件内容，Hex 字节、ASCII 字符、偏移跳转与字节搜索 | `file` | `/tools/file/bin-viewer/` | `Binary` | `二进制`, `Hex`, `字节`, `查看`, `搜索` | 建议 `true` |
| `image-edit` | 图片编辑 | 在图片上画线画框，调节亮度、对比度、色温、色调，本地导出 | `image` | `/tools/image/edit/` | `SlidersHorizontal` | `图片编辑`, `标注`, `画框`, `亮度`, `对比度`, `色温` | 建议 `true` |
| `file-doc-compare` | 文档对比 | 打开查看 docx、txt、md 文档，并排对比两份文档的行级差异 | `file` | `/tools/file/doc-compare/` | `Columns2` | `文档对比`, `diff`, `docx`, `txt`, `md` | 建议 `false` |

`ToolLayout` 的页面标题与描述（`metadata`）建议与上表 `name` / `description` 保持一致，另可加一句「所有处理在浏览器本地完成，文件不会上传到服务器」。

另需确认：**是否新增 `file` 分类的首页区块**（含区块标题文案与副标题文案），以及 `featured` 取值。

---

## 8. 未采纳方案与理由

| 议题 | 未采纳方案 | 理由 |
|---|---|---|
| 图像调整 | CSS `filter` 预览 + `ctx.filter` 导出 | CSS filter 无「色温」；两套算法导致预览与导出不一致；`ctx.filter` 浏览器支持不齐 |
| 图像调整 | 只做亮度/对比度/色调，去掉色温 | 用户明确要色温，且 canvas 方案能忠实实现，无需删需求 |
| 文档格式 | 支持 `.doc` 尽力解析 | OLE2 二进制解析复杂、结果不可靠，违反「绝不给出错误结果」 |
| 文档格式 | 引入 mammoth.js 等第三方解析库 | 能拿到 HTML 但对「行级文本对比」是过度设计，还引入体积与兼容性成本 |
| diff 高亮 | 字符级高亮 | 复杂度翻倍，行级已满足「改了哪些行」的核心诉求 |
| diff 算法 | 全量 LCS 动态规划 | 5000 行需 50MB 矩阵，不可接受 |
| diff 算法 | Myers O(ND) | 文档「几乎完全不同」时退化为 O(N×M)，实现复杂度高于 Hirschberg，无收益 |
| 虚拟滚动 | 引入 react-window | 依赖「行高固定」这一已满足的前提，自研约 40 行即可，引入库不划算 |
| 类型识别 | 200+ 条完整魔数表 | 维护成本高、命中率低，25 条常见格式已覆盖绝大多数场景 |
| bin 视图 | 按扩展名 + 魔数 + 用户指定三层判定 | 用户选定「扩展名优先、魔数兜底」；手动指定作为**可覆盖的附加项**保留，成本极低 |
