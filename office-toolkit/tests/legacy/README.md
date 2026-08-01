# Legacy Test Scripts

这里是开发过程中使用过的**一次性 Playwright 验证脚本**。每个脚本对应某次具体改动（如品牌名替换、删除某个按钮、图片扩展填充等），用完即弃，**不作为正式测试套件**。

## 用途

- **追溯**：如果某次改动怀疑回归，可以翻这些脚本找思路
- **不复用**：每个脚本硬编码了具体场景（文件路径、视口大小、断言点），不能直接 `npm test` 运行
- **不维护**：这些脚本不会被更新、不会修复坏掉的依赖。坏了就删除，新场景重写

## 文件清单

| 文件 | 验证内容 |
|---|---|
| `test-debug.js` / `test-debug2.js` | 早期调试脚本（背景色、UI 报错等） |
| `test-bg.js` | 验证背景填充/扩展填充的默认背景色 |
| `test-dpi-removed.js` | 验证删除 DPI 模块后的页面 404 状态 |
| `test-home.js` | 验证首页删除"查看全部工具"按钮 + 平滑滚动 |
| `test-pad.js` | 测试图片扩展填充功能（两种模式） |
| `test-pad-after.js` / `test-pad-edge.js` / `test-pad-final.js` | pad 功能迭代过程的中间版本 |
| `test-sky-box.js` | 验证品牌名从 Sky-Box 替换为 HaoXia/浩匣 |

## 正式测试目录

未来的正式测试套件（按场景划分）应放在 `tests/` 根目录下，建议子目录结构：

```
tests/
├── legacy/          # 本目录：历史一次性脚本（已停止维护）
├── e2e/             # Playwright 端到端测试
├── unit/            # 单元测试（Vitest / Jest）
└── fixtures/        # 测试用的样例文件（图片、PDF）
```

## 依赖说明

这些脚本使用 `playwright`，是项目开发依赖（`devDependencies`）。如果运行：

```bash
# 安装浏览器（首次需要）
npx playwright install chromium

# 直接运行某个脚本
node tests/legacy/test-home.js
```
