// 验证 GIF 压缩 4 个新接口（色深/宽高/帧率/合并重复帧）+ 当前值显示
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const URL = "http://localhost:3000/tools/image/compress/";
const OUT_DIR = path.resolve(__dirname, "..", "..", "public");

// 在浏览器侧生成一个 400x400 的 24 帧动画 GIF（天空色 + 移动的圆）
async function makeTestGif(page, frames, w, h) {
  return await page.evaluate(async (args) => {
    const { frames, w, h } = args;
    const { GIFEncoder, quantize, applyPalette } = await import("/_next/static/chunks/main-app.js").catch(() => ({}));
    // 直接在浏览器内用 gifenc（如果页面已加载），但更稳的方式：构造帧后传给页面
    // 简化：直接用 ImageData + canvas 模拟，不真生成 GIF 字节（避免引入更多依赖）
    // 这里返回空，由 Node 端生成
    return null;
  }, { frames, w, h }).catch(() => null);
}

(async () => {
  // 用 Node 端生成测试 GIF：3 帧纯色 + 1 帧重复
  const { createCanvas } = require("canvas");
  // 不一定可用，改用 Playwright 浏览器侧
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // 用浏览器 canvas 收集帧，然后调 gifenc 编码
  const frameDataUrls = [];
  for (let i = 0; i < 24; i++) {
    const dataUrl = await page.evaluate((i) => {
      const canvas = document.createElement("canvas");
      canvas.width = 400;
      canvas.height = 400;
      const ctx = canvas.getContext("2d");
      // 渐变天空
      const grad = ctx.createLinearGradient(0, 0, 0, 400);
      grad.addColorStop(0, `rgb(${100 + i * 3}, 150, 220)`);
      grad.addColorStop(1, `rgb(${200 + i * 2}, 220, 240)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 400, 400);
      // 移动的圆
      ctx.fillStyle = "orange";
      ctx.beginPath();
      ctx.arc(50 + i * 10, 200, 30, 0, Math.PI * 2);
      ctx.fill();
      // 文字
      ctx.fillStyle = "black";
      ctx.font = "20px sans-serif";
      ctx.fillText(`Frame ${i}`, 20, 380);
      return canvas.toDataURL("image/png");
    }, i);
    frameDataUrls.push(dataUrl);
  }

  // 用 gifenc 库编码（在 Node 端也可用）
  const { GIFEncoder, quantize, applyPalette } = require("office-toolkit/node_modules/gifenc");
  const encoder = GIFEncoder();
  for (let i = 0; i < frameDataUrls.length; i++) {
    // 解码 dataURL → RGBA
    const b64 = frameDataUrls[i].split(",")[1];
    const buf = Buffer.from(b64, "base64");
    // 简化：用 sharp 解码（如果可用），否则用 pngjs
    let rgba;
    try {
      const sharp = require("office-toolkit/node_modules/sharp");
      const { data } = await sharp(buf).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
      rgba = new Uint8ClampedArray(data);
    } catch {
      // 退回：用浏览器解析
      rgba = await page.evaluate(async (url) => {
        const img = new Image();
        await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = url; });
        const c = document.createElement("canvas");
        c.width = 400; c.height = 400;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0);
        return new Uint8ClampedArray(ctx.getImageData(0, 0, 400, 400).data);
      }, frameDataUrls[i]);
    }
    const palette = quantize(rgba, 128);
    const idx = applyPalette(rgba, palette);
    encoder.writeFrame(idx, 400, 400, { palette, delay: 50, dispose: 2, repeat: 0 });
  }
  encoder.finish();
  const gifBytes = Buffer.from(encoder.bytes());
  const gifPath = path.join(OUT_DIR, "test-gif-400x400-24f.gif");
  fs.writeFileSync(gifPath, gifBytes);
  console.log(`生成测试 GIF: ${gifPath}`);
  console.log(`  尺寸: 400x400, 帧数: 24, fps: 20 (delay=50ms), 调色板: 128 色`);

  // 用 Playwright 测试 4 个新功能
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.locator('input[type="file"]').first().setInputFiles([gifPath]);
  await page.waitForTimeout(500);

  // 等待元信息解析
  await page.waitForTimeout(2000);

  // 检查"当前："面板是否显示
  const metaText = await page.locator("text=当前：").first().textContent().catch(() => null);
  console.log(`\n[1] 元信息面板:`);
  console.log(`    显示: ${metaText ? "✓" : "✗"} ${metaText || "(无)"}`);

  // 勾选"自动"（保持原格式 = GIF）+ 配置选项
  // 实际上保持 original 就会走 GIF 路径
  // 测试各种参数
  const scenarios = [
    { label: "默认（128 色、不限尺寸/帧率、合并重复）", opts: {} },
    { label: "8 色 + 200px 宽", opts: { colors: "8", maxW: "200" } },
    { label: "32 色 + 5 fps（丢帧测试）", opts: { colors: "32", fps: "5" } },
    { label: "64 色 + 关闭合并", opts: { colors: "64", merge: false } },
  ];

  for (let i = 0; i < scenarios.length; i++) {
    const s = scenarios[i];
    // 清空之前的值
    const inputs = page.locator('input[type="number"]');
    const inputCount = await inputs.count();
    for (let j = 0; j < inputCount; j++) {
      await inputs.nth(j).fill("");
    }
    if (s.opts.colors) {
      await page.locator('select').first().selectOption(s.opts.colors);
    }
    if (s.opts.maxW) {
      await inputs.nth(0).fill(s.opts.maxW);
    }
    if (s.opts.fps) {
      await inputs.nth(2).fill(s.opts.fps);
    }
    if (s.opts.merge === false) {
      await page.locator('input[type="checkbox"]').first().uncheck();
    }
    await page.waitForTimeout(100);

    await page.getByRole("button", { name: /开始压缩/ }).click();
    await page.waitForTimeout(4000);

    const dlBtn = page.getByRole("button", { name: /下载/ }).first();
    const success = await dlBtn.isVisible().catch(() => false);
    const sizeText = success ? (await dlBtn.textContent()) : null;
    const sizeMatch = sizeText && sizeText.match(/\(([^)]+)\)/);
    console.log(`\n[${i + 2}] ${s.label}:`);
    console.log(`    ${success ? "✓" : "✗"} 输出: ${sizeMatch ? sizeMatch[1] : "(失败)"}`);

    // 读 info 文本
    const info = await page.locator("text=/\\d+×\\d+/").first().textContent().catch(() => null);
    if (info) console.log(`    信息: ${info}`);
  }

  await browser.close();
})();
