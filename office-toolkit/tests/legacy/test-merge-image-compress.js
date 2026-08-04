// 验证「自动缩小过大的图片文件」新行为（72/96 DPI 二选一）
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const URL = "http://localhost:3000/tools/pdf/merge/";
const OUT_DIR = path.resolve(__dirname, "..", "..", "public");

// 在浏览器侧生成一张 4000x3000 的「类照片」JPEG
async function makeJpegViaBrowser(page, w, h) {
  const dataUrl = await page.evaluate(async (args) => {
    const { w, h } = args;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = x / w, v = y / h;
        const r = Math.floor(80 + 175 * v);
        const g = Math.floor(120 + 80 * (1 - u) * v);
        const b = Math.floor(200 - 160 * v);
        const cx = w / 2, cy = h / 2;
        const dx = x - cx, dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const sunRadius = Math.min(w, h) * 0.25;
        if (dist < sunRadius) {
          const t = 1 - dist / sunRadius;
          ctx.fillStyle = `rgb(${Math.min(255, r + 150 * t)}, ${Math.min(255, g + 120 * t)}, ${Math.min(255, b + 60 * t)})`;
        } else {
          ctx.fillStyle = `rgb(${Math.max(0, Math.min(255, r + (Math.random() - 0.5) * 8))}, ${Math.max(0, Math.min(255, g + (Math.random() - 0.5) * 8))}, ${Math.max(0, Math.min(255, b + (Math.random() - 0.5) * 8))})`;
        }
        ctx.fillRect(x, y, 1, 1);
      }
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.95));
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  }, { w, h });
  const b64 = dataUrl.split(",")[1];
  return Buffer.from(b64, "base64");
}

async function runScenario(label, filePath, shrinkChecked, dpi) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const logs = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning" || msg.text().includes("[merge]")) {
      logs.push(`[${msg.type()}] ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => logs.push(`[PAGEERROR] ${err.message}`));

  try {
    await page.goto(URL, { waitUntil: "networkidle" });
    await page.locator('input[type="file"]').first().setInputFiles([filePath]);
    await page.waitForTimeout(400);

    const cb = page.locator('input[type="checkbox"]');
    if (shrinkChecked) await cb.check();
    await page.waitForTimeout(100);

    if (shrinkChecked && dpi) {
      await page.locator(`input[type="radio"][value="${dpi}"]`).check();
      await page.waitForTimeout(100);
    }

    await page.getByRole("button", { name: /开始合并/ }).click();
    await page.waitForTimeout(6000);

    const errorVisible = await page.getByText(/合并失败/).isVisible().catch(() => false);
    const errorText = errorVisible ? await page.getByText(/合并失败/).textContent() : null;
    const dlBtn = page.getByRole("button", { name: /下载合并结果/ });
    const success = await dlBtn.isVisible().catch(() => false);
    const sizeText = success ? (await dlBtn.textContent()) : null;
    const sizeMatch = sizeText && sizeText.match(/\(([^)]+)\)/);
    return { label, error: errorText, size: sizeMatch ? sizeMatch[1] : "(失败)", logs };
  } finally {
    await browser.close();
  }
}

(async () => {
  // 在浏览器里生成一张 4000x3000 的「类照片」JPEG 并落盘
  const jpgPath = path.join(OUT_DIR, "test-photo-like.jpg");
  if (!fs.existsSync(jpgPath) || fs.statSync(jpgPath).size < 100000) {
    console.log("生成 4000x3000 类照片 JPEG（浏览器侧 canvas）...");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const jpgBuf = await makeJpegViaBrowser(page, 4000, 3000);
    fs.writeFileSync(jpgPath, jpgBuf);
    await browser.close();
  }
  const inputSize = fs.statSync(jpgPath).size;
  console.log(`\n========== 测试图片: ${jpgPath} ==========`);
  console.log(`图片尺寸: 4000x3000 px`);
  console.log(`图片大小: ${(inputSize / 1024).toFixed(1)} KB`);

  console.log(`\n[1] 不勾选：PDF ≈ 原始 JPEG 体积（不缩小）`);
  const noShrink = await runScenario("no-shrink", jpgPath, false, null);
  console.log(`    输出: ${noShrink.size}`);
  if (noShrink.error) console.log(`    错误: ${noShrink.error}`);

  console.log(`\n[2] 勾选 + 72 DPI：图片应缩到 595 px 宽（高 446 px）`);
  const dpi72 = await runScenario("dpi-72", jpgPath, true, 72);
  console.log(`    输出: ${dpi72.size}`);
  if (dpi72.error) console.log(`    错误: ${dpi72.error}`);

  console.log(`\n[3] 勾选 + 96 DPI：图片应缩到 794 px 宽（高 596 px）`);
  const dpi96 = await runScenario("dpi-96", jpgPath, true, 96);
  console.log(`    输出: ${dpi96.size}`);
  if (dpi96.error) console.log(`    错误: ${dpi96.error}`);

  function parseKB(s) {
    const m = s.match(/([\d.]+)\s*(KB|MB|B)/i);
    if (!m) return NaN;
    const n = parseFloat(m[1]);
    if (m[2].toUpperCase() === "MB") return n * 1024;
    if (m[2].toUpperCase() === "B") return n / 1024;
    return n;
  }

  const inputKB = inputSize / 1024;
  const noKB = parseKB(noShrink.size);
  const dpi72KB = parseKB(dpi72.size);
  const dpi96KB = parseKB(dpi96.size);

  console.log(`\n========== 总结 ==========`);
  console.log(`输入 JPEG:    ${inputKB.toFixed(1)} KB  (4000 x 3000)`);
  console.log(`不勾选:       ${noKB.toFixed(1)} KB  (期望 ≈ ${inputKB.toFixed(1)} KB, 不动)`);
  console.log(`勾选 72 DPI:  ${dpi72KB.toFixed(1)} KB  (期望 595 x 446, 应远小于不勾选)`);
  console.log(`勾选 96 DPI:  ${dpi96KB.toFixed(1)} KB  (期望 794 x 596, 介于 72 与不勾选之间)`);

  let pass = true;
  if (Math.abs(noKB - inputKB) > inputKB * 0.05) {
    console.log(`✗ 不勾选场景体积异常（变化 > 5%）`);
    pass = false;
  }
  if (dpi72KB >= noKB) {
    console.log(`✗ 72 DPI 场景未缩小`);
    pass = false;
  }
  if (dpi96KB <= dpi72KB) {
    console.log(`✗ 96 DPI 输出应大于 72 DPI`);
    pass = false;
  }
  if (pass) {
    console.log(`\n✓ 所有场景符合预期`);
  }
})();
