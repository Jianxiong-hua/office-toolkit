# RAW 图查看（设计）

日期：2026-11-22
状态：设计待确认，未开工
入口：`/tools/design/raw-viewer/`（归类「图像设计/计算工具」）

## 目标

把一份裸像素（Bayer RAW）数据，按指定 gamma 映射到 8 bit，再用 Malvar-He-Cutler 去马赛克插值，以 PNG 形式显示与下载。全部在浏览器本地完成，不上传。

| 项 | 取值 |
| --- | --- |
| 输入 | 任意二进制文件（`.raw` / `.bin` / 无扩展名），用户手动给解析参数 |
| 位深 | 8 / 10 / 12 / 14 / 16 bit，**只做未打包（unpacked）** |
| 字节序 | 大端 / 小端（仅 16 bit 存储时有意义） |
| 映射 | 线性 / gamma 2.2 / sRGB |
| 去马赛克 | Malvar-He-Cutler 5×5 |
| 输出 | 页面预览 + 下载 PNG（原始分辨率） |

## 已确认决策（用户 2026-11-22）

| # | 决策 | 取舍说明 |
| --- | --- | --- |
| 1 | 只做**裸像素数据**，不解析相机 RAW 容器（CR2/NEF/ARW/DNG） | 容器解码要 libraw-wasm（数 MB wasm，首屏变慢、异常格式易崩）。裸数据零依赖，符合传感器 / ISP 调试场景 |
| 2 | 位深只做**未打包**形式（8 bit 每像素 1 字节，10/12/14/16 bit 每像素 2 字节） | packed（如 10 bit 5 字节 4 像素）解析分支多、易错，先不做；需要时再加 |
| 3 | 字节序可选择 | 同一份 dump 在不同平台/工具链下可能大端小端都有 |
| 4 | **不做黑电平校正（BLC）** | 用户明确不需要；映射直接用满量程归一化。代价：传感器黑电平（如 64 DN）会让画面整体偏亮、暗部发灰，需要时后续加 |
| 5 | gamma 三档：**线性 / 2.2 / sRGB** | 线性用于算法比对（与 baseline-denoise 的线性直出同口径）；2.2 是最常见的显示近似；sRGB 分段曲线暗部更亮、最贴近浏览器显示 |
| 6 | 去马赛克先用 **Malvar-He-Cutler**（ICASSP 2004 的 5×5 线性插值） | 比双线性明显少伪彩、边缘更干净；纯整数/浮点卷积，无依赖。代价是多 8 遍邻域采样，约为双线性的 2~3 倍耗时 |
| 7 | ~~先映射 8 bit 再去马赛克~~ → **改为：先在原始位深域（DN）去马赛克，再映射到 8 bit** | 用户看过代价说明后改为后者。原因：8 bit 量化发生在插值之前会让插值少一半以上精度，暗部出现 banding 且伪彩更明显。代价：卷积在 Uint16/Int32 域算，中间值不能提前压到 0~255；MH-C 会产生负值/超量程，映射前必须 clamp，否则 LUT 越界 |
| 8 | 预览**支持缩放**：−/+ 按钮、适应窗口、1:1、拖动平移 | 用户要求。40 MP 图缩到窗口里看不清细节，没有 1:1 就看不出插值质量与伪彩。实现上只改 canvas 的 CSS 尺寸（`image-rendering: pixelated` 让放大后是可数的像素块），PNG 导出仍按原始分辨率 |
| 8b | **不做 Ctrl + 滚轮缩放**（2026-11-22 用户实测后删掉） | Ctrl+滚轮在浏览器里是整页缩放，页面自己接管它会让人以为「整个网页被缩了」。初版实现了该手势且在提示里写了，用户实测反馈误导，已连同提示一起删除；缩放只走三个按钮 |

## 处理流水线

```
File → ArrayBuffer
  → 读像素：bpp = depth <= 8 ? 1 : 2；按字节序取值；校验 byteLength === w*h*bpp
  → DN 域（Uint16Array，原值不归一化）
  → Malvar-He-Cutler 去马赛克（DN 域卷积，Int32 累加）→ 每像素 R/G/B 三个 DN 值
  → 映射 8 bit：clamp(DN, 0, max) → lut[DN]
       lut[dn] = round(gamma(dn / max) * 255)
       gamma：线性 x；2.2 → x^(1/2.2)；sRGB → x<=0.0031308 ? 12.92x : 1.055x^(1/2.4)-0.055
  → RGBA Uint8ClampedArray → putImageData 到 canvas 预览 + toBlob('image/png') 下载
```

- **映射用查表**：LUT 长度 = `2^depth`（16 bit 时 65536 字节），一次构建、逐像素索引，避免 4000 万次 `Math.pow`
- **不建中间平面**：MH-C 的三个核都作用在同一张 CFA mosaic 上，所以逐像素算出 R/G/B 后直接 clamp + 查表写进 RGBA，内存只需 `mosaic(2 B/px) + out(4 B/px)`
- 卷积系数**全部乘 2 转整数**（核系数含 0.5 / 1.5），分母 16，最后 `Math.round(sum / 16)`，不用浮点
- 按 **4 个 CFA 相位分别循环**（而不是每像素判断颜色），既省分支也让每个循环内套固定核

### Malvar-He-Cutler 实现要点

- 对 CFA 上每个位置按其颜色套用对应核（G at R/B、R at G 的两个方位变体、R at B 的对角核，B 对称）
- **方位判定**：给定 Bayer 排列（2×2 瓦片）后，对每个 G 位置要先算出「R 在同行还是同列」，选水平/垂直变体。这里最容易写错，且错了不会报错，只会出现规则的红绿条纹
- **边界**：镜像反射索引（`x < 0 → -x-1`，`x >= w → 2w-x-1`），不用补零，否则一圈黑边 + 伪彩
- **验证手段（关键）**：合成往返测试——用一张已知 RGB 图按排列做 CFA 采样，再去马赛克，与原图比 PSNR；正确实现应在 30 dB 以上，核系数或方位写错会掉到 15 dB 以下。这条会在实现时用 node 脚本跑（临时产物用后即删）

## 页面结构

```
[ 拖入 / 选择文件 ]   任意二进制，不做扩展名限制（通用 FileDropZone 传空 accept 会拒绝所有文件，需自研）

解析参数
  宽 [1920]  高 [1080]  位深 [12 ▾]  字节序 [小端|大端]  Bayer [RGGB ▾]
  数值对齐 [低位|高位]（仅 10/12/14 bit 时显示）
  映射 [线性|2.2|sRGB]（默认线性）        [ 生成预览 ]

校验行：文件 47,185,920 字节 · 期望 6048×4024×2 = 48,674,304 字节 · ✗ 不匹配（差 1,488,384）

预览区（固定高度容器，可滚动）
  工具条：[−] [缩放 %] [+] [适应窗口] [1:1]        标注原始分辨率
  canvas：CSS 尺寸 = 原始尺寸 × 缩放；放大时 image-rendering: pixelated；拖动平移（改 scrollLeft/Top）
结果行：耗时、输出尺寸、[下载 PNG]
```

## 已确认的细化项（2026-11-22）

| # | 事项 | 结论 |
| --- | --- | --- |
| 1 | 10/12/14 bit 在 16 bit 字里的对齐 | **提供「低位 / 高位」开关，默认低位**。选错会得到「结构正常但整体偏暗/偏亮」的图，很难反推 |
| 2 | Bayer 起算点 | 按左上角起算，`RGGB` = 左上 R / 右上 G / 左下 G / 右下 B |
| 3 | 分类与命名 | `/tools/design/raw-viewer/`，工具名「RAW 图查看」，归「图像设计/计算工具」 |
| 4 | 尺寸上限 | 像素 ≤ 40 MP、文件 ≤ 200 MB，超出直接拒绝并提示 |
| 5 | 预览缩放 | **要**（见决策 8） |

## 文件清单

| 动作 | 文件 | 说明 |
| --- | --- | --- |
| 新增 | `src/lib/raw/parse.ts` | `parseRawBuffer(buffer, {width,height,depth,endianness,alignment})` → `Uint8Array` mosaic，含字节数校验与错误信息 |
| 新增 | `src/lib/raw/demosaic.ts` | `demosaicMhc(mosaic, width, height, pattern)` → RGBA；含镜像索引与方位判定 |
| 新增 | `src/lib/raw/tonemap.ts` | `buildLut(depth, gamma)`、`applyLut` |
| 新增 | `src/app/tools/design/raw-viewer/page.tsx` | 页面：自研拖拽/选择、参数面板、校验行、预览 canvas、下载 |
| 新增 | `src/app/tools/design/raw-viewer/RawDropZone.tsx` | 任意类型文件拖入（不复用通用 `FileDropZone`，原因见上） |
| 新增 | `src/app/tools/design/raw-viewer/layout.tsx` | metadata（文案待确认） |
| 修改 | `src/config/tools.ts` | 新增 `design-raw-viewer` 条目（文案待确认） |

`sitemap.ts`、首页卡片自动生效；分类已存在，`Header` 无需改。

## 风险与代价

| 风险 | 处理 |
| --- | --- |
| MH-C 核系数 / 方位判定写错 | 合成往返测试（PSNR ≥ 30 dB）；错误时表现为规则彩条，肉眼也可识别 |
| 40 MP 时主线程卡死 4~6 秒 | 按钮置「处理中」+ 计时；不引 worker（本次范围外）。若实测超出可接受范围，后续把去马赛克搬进 Worker |
| 参数填错时画面「看起来像图」但颜色/亮度不对 | 校验行显示文件字节数与期望字节数的差值；位深/对齐/Bayer 三项在文档与 UI 里都给出「错了会怎样」的提示 |
| 16 bit 大端 dump 被误按小端读 | 字节序开关 + 校验行（大端小端错时画面呈规则噪点，很容易看出来） |
| 8 bit 映射后再插值有量化损失 | 已记为决策 7 的代价；实测观感不行时把中间态换 Uint16，接口不变 |
| 不做 BLC 导致暗部发灰 | 已确认不要；文档记录，后续需要时作为独立开关加 |

## 验收标准

1. 16 bit 小端 RGGB、`w*h*2` 字节的 dump：预览正常、无彩条、无黑边，下载 PNG 尺寸与 `w×h` 一致
2. 同一份数据切大端：画面变为规则噪点（说明字节序真的生效），切回小端恢复正常
3. gamma 三档在同一份数据上依次切换：线性最暗、2.2 居中、sRGB 暗部最亮，且相对明暗关系不变
4. 位深 10/12/14 bit（低位对齐）配合对应满量程归一化，画面亮度与 16 bit 版本一致（不应出现整体偏暗）
5. 文件字节数与 `w*h*bpp` 不符时给出明确差值提示，不进入处理
6. 4 种 Bayer 排列下，只有正确的那一个画面无彩色网格；错误排列呈现明显红绿相间
7. 线性场解析解：常量 / x 渐变 / y 渐变误差 ≤ 1，对角渐变 ≤ 2（MH-C 在**线性**场上可被核精确还原，这条是核系数与 dx/dy 索引是否正确的硬判据，见实施记录）
8. 40 MP / 200 MB 之外直接拒绝并提示；12 MP 处理耗时有显示
9. `npm run validate` 通过；dev 下 `/tools/design/raw-viewer/` 200；首页「设计/计算」区出现卡片；`out/sitemap.xml` 含该路径

## 待确认的对外文案

工具名称、卡片描述、tags、icon、`layout.tsx` 的 title / description / keywords、`package.json` 版本号与 changelog 条目——按项目规矩，写入前逐项给你过目。

## 批量导出（2026-11-22 追加设计）

目标：一次拖入多个 raw，共用一套参数，逐张去马赛克后**全部缓存在浏览器内存**，最后打包成一个 ZIP 下载（不做「选目录直接落盘」）。

### 已确认决策

| # | 决策 | 取舍 |
| --- | --- | --- |
| B1 | 改造现有工具（不做第二个工具页） | 参数是同一套，两个页面等于让用户填两遍；`lib/fs/save.ts` 的输出手段这次用不上（见 B2） |
| B2 | **输出全部在浏览器内存里，最后一键下载 ZIP**；不调用目录选择器、不写磁盘 | 用户明确要求不直接落盘。代价：内存有上限，必须给张数与体积双闸门；好处：无需 File System Access，所有浏览器行为一致 |
| B3 | 所有文件共用一套参数 | 符合「同一传感器连拍」的实际场景 |
| B4 | 某张失败就跳过，继续下一张，最后列出失败文件与原因 | 一张数据坏掉不该毁掉整批 |
| B5 | 命名沿用 `generateOutputFilename(原名, "demosaic", "png")`，ZIP 内重名自动加序号 | 与站点其它工具一致 |

### 内存与上限（关键约束）

单张 1080p（2.07 MP）峰值：raw 4.1 MB + mosaic 4.1 MB + RGBA 8.3 MB ≈ **16 MB 瞬时**，PNG 成品按 1~4 MB 估算并**常驻**到打包结束。

| 张数 | 常驻 PNG 估算 | 打包时 ZIP 峰值 | 判断 |
| --- | --- | --- | --- |
| 20 | 20~80 MB | +同量 | 安全 |
| 100 | 100~400 MB | 翻倍 | 有风险 |
| 300 | 300 MB~1.2 GB | 翻倍 | 大概率 OOM |

因此设置双闸门（先到先停）：
- **张数上限 100**
- **累计 PNG 体积上限 200 MB**（`zip.file()` 前累加 blob.size，超了就停止并把已完成的打包下载，界面说明「已停止，共打包 N 张」）

### 流水线

```
多选文件 → 列表（名称 + 字节数 + 与期望字节数是否一致的标记）
  → [开始转换]
  → 逐张：File → ArrayBuffer → parseRawBuffer → buildLut（只建一次，参数不变）
       → demosaicMhcToRgba → OffscreenCanvas/普通 canvas → toBlob('image/png')
       → zip.file(name, blob) → 释放 buffer（blob 由 zip 持有）
  → 全部完成 → zip.generateAsync({ type: 'blob', compression: 'STORE' }) → 下载
```

- `compression: "STORE"`：PNG 已压缩，再 deflate 只白费 CPU
- LUT 按当前参数建一次，逐张复用
- 每张之间 `await` 一次宏任务，让进度条与「取消」按钮能响应
- canvas 复用同一个实例，避免每张新建

### 界面

```
[ 拖入 / 选择多个文件 ]  列表：文件名 · 字节数 · ✓/✗ 与 w*h*bpp 匹配
参数区（与单张共用）
[ 开始转换 ] [ 取消 ]   进度：第 N / M 张 · 已用 12.3 s
结果：成功 N 张 · 失败 K 张（列出文件名 + 原因）· [ 下载 ZIP (xx MB) ]
选中列表项 → 预览区显示该张（转换完成后可回看）
```

### 已确认（2026-11-22 用户拍板）

| # | 事项 | 结论 |
| --- | --- | --- |
| 1 | 输出是否落盘 | 默认**全部缓存在浏览器内存**，最后一次性下载一个 ZIP；**只有超过阈值时才要求用户选目录**，不默认落盘 |
| 2 | 阈值判据 | **张数 ≤ 50 且预估成品 ≤ 200 MB**（两个都要满足）才走内存；否则必须先选目录。只看张数不够——50 张 4K 的成品可达 300~500 MB，照样会爆。预估按 `张数 × 宽 × 高 × 1 B/px` |
| 3 | 非 Chromium 浏览器超阈值 | 直接提示「分批处理（每批 ≤ 50 张）或换 Chrome / Edge」，**不提供内存兜底**（会回到 OOM） |
| 4 | 列表选中项预览 | 保留，点列表项即渲染该张 |
| 5 | 转换中改参数 | 不允许，参数面板置灰 |
| 6 | 命名 | `原名_demosaic.png`；ZIP / 目录内重名自动加 `-2`、`-3` |

### 验收标准（批量）

1. 拖入 3 个同参数文件 → 逐张转换 → 一次下载到 1 个 ZIP，解压后文件名与顺序符合预期
2. 其中 1 个字节数不匹配 → 该张跳过并列入失败清单，其余 2 张正常出图
3. 张数超过 100 或累计 PNG 超 200 MB → 停止并提示已打包张数，已完成的 ZIP 仍可下载
4. 转换中「取消」可用，已完成的张数如实显示
5. 转换中参数面板置灰，进度与已用时间实时更新
6. 单张模式原有功能不受影响；`npm run validate` 通过；dev 页面 200

### 批量实现记录（2026-11-22）

| 动作 | 文件 | 说明 |
| --- | --- | --- |
| 改造 | `src/app/tools/design/raw-viewer/page.tsx` | 页面改成「文件列表 + 选中项预览 + 批量转换」：`entries[]` 列表、`convertOne` 单张转换复用、`handleBatch` 批处理（内存 ZIP / 目录写入两条输出路径）、进度、取消、失败清单；参数在转换中置灰 |
| 改造 | `src/app/tools/design/raw-viewer/RawDropZone.tsx` | 支持多选与整批拖入，新增 `disabled` |
| 复用 | `src/lib/fs/save.ts` | `supportsDirectoryPicker` / `pickDirectory` / `ensureUniqueSubdirectory` / `writeBlobInto` 原样使用，未改动 |
| 新增 | `src/config/tools.ts` 条目、`raw-viewer/layout.tsx` | 文案经用户确认后写入 |

实现要点：

- **单张与批量共用 `convertOne`**，两条路径只在输出环节分叉（`zip.file()` vs `writeBlobInto()`），避免两套解码逻辑漂移
- 批量用独立的隐藏 canvas 做 PNG 编码，不占用预览 canvas，因此转换完成后预览仍停在用户选中的那张
- 每张之间 `await setTimeout(0)` 让出主线程，否则进度与「取消」在同步卷积期间完全无响应
- `compression: "STORE"`（PNG 已压缩，不重复 deflate）
- 目录模式先在父目录下建 `raw-demosaic-{N}张` 子目录（`ensureUniqueSubdirectory` 自动加 `-2`/`-3` 防覆盖）

已验证：`npm run validate` 通过；`npm run build` 通过（`out/tools/design/raw-viewer/index.html` 生成、`out/sitemap.xml` 含该路径）；dev 下页面 200、首页「设计/计算」区出现「RAW 图查看」卡片。

**未验证**（需人工在浏览器点）：多选与整批拖入、逐张进度与取消是否即时响应、内存 ZIP 的实际体积与下载、超过 50 张时目录选择与写入、非 Chromium 下的拦截提示。

## 实施记录（2026-11-22）

| 动作 | 文件 | 说明 |
| --- | --- | --- |
| 新增 | `src/lib/raw/parse.ts` | 位深/字节序/对齐解析，字节数与 40 MP 校验 |
| 新增 | `src/lib/raw/tonemap.ts` | gamma 三档 + DN→8bit 查表 |
| 新增 | `src/lib/raw/demosaic.ts` | MH-C 4 个核 ×2 整数化，分母 16；按 4 个 CFA 相位分别遍历；镜像索引预计算 |
| 新增 | `src/app/tools/design/raw-viewer/page.tsx` | 参数面板、校验行、预览（缩放/平移/Ctrl+滚轮）、PNG 下载 |
| 新增 | `src/app/tools/design/raw-viewer/RawDropZone.tsx` | 任意类型文件拖入（自研，通用 `FileDropZone` 会拒绝所有文件） |
| 待补 | `src/app/tools/design/raw-viewer/layout.tsx`、`src/config/tools.ts` | metadata 与工具条目，文案待用户确认后写入 |

### 验证

- 纯函数断言 **28 条**全通过：4 种排列的往返 PSNR 24.7~25.3 dB、错误排列降到 9.47 dB、4 种排列的常量场逐像素相等、线性场（flat/x/y/diag）最大误差 0/0/0/1、解析的大小端与高低位对齐、字节数不符与非法宽高拒绝、gamma 三档单调且端点正确、gamma 暗部提亮
- 性能：`4000×3000`（12 MP）去马赛克 + 映射 **1830 ms**（Node 20，纯 JS 单线程）；按线性外推 40 MP 约 6 s
- `npm run validate`：通过
- dev：`/tools/design/raw-viewer/` 200，参数面板与文案正常渲染
- **未验证**：浏览器里的实际交互与观感——拖入文件、生成预览、缩放/平移、下载 PNG、大图是否触发 canvas 尺寸限制

### 实现期发现（重要）

1. **核系数与官方公式逐项核对**：对照 IPOL《Malvar-He-Cutler Linear Image Demosaicking》给出的整数公式（`R = [F(i,j-2)+F(i,j+2) - 2*(六个对角+上下±2) + 8*(左右±1) + 10*F(i,j)] / 16`），4 个核的每一个非零项都对得上
2. **线性场解析解是核正确性的硬判据**：MH-C 在线性渐变上可被核精确还原，实测 flat / x / y 渐变误差为 0，对角渐变最大误差 1（舍入）。若 `dx`/`dy` 索引写反或方位判定反了，x 或 y 渐变会立刻出现明显误差——这个测试比 PSNR 更容易定位错误
3. **合成图上 MH-C 的 PSNR 反而比双线性低约 2 dB**（24.7 vs 27.0）。排查结论：核没写错，原因是合成图通道不相关 + 高饱和，MH-C 的负瓣在饱和边缘过冲、被 clamp 后误差变大；IPOL 官方数据也显示 MH-C 对双线性在 Peppers 上只领先 0.19 dB（29.66 vs 29.47），它的真实优势是**伪彩与拉链纹更少**（视觉指标），不是 PSNR。因此验收门槛从「PSNR ≥ 30 dB」改为「线性场解析解精确 + 错误排列显著劣化」，另加人工观感检查
4. **canvas 必须常驻挂载**：初版把 `<canvas>` 放在 `meta ? ... : ...` 分支里，生成时 canvas 还没渲染、`ref.current` 为 null，像素写不进去。改为常驻挂载 + 无数据时 `hidden`
5. `new ImageData(rgba, w, h)` 在 TS 严格模式下不接受 `Uint8ClampedArray<ArrayBufferLike>`，改用 `ctx.createImageData()` + `data.set()`
