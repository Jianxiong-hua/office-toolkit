// 用 unpkg 直接拿 ESM 源
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("about:blank");
  await page.waitForTimeout(500);

  const result = await page.evaluate(async () => {
    const out = {};
    // 试 unpkg
    try {
      const m1 = await import("https://unpkg.com/gifenc@1.0.3/dist/gifenc.esm.js");
      out.unpkg = {
        keys: Object.keys(m1),
        hasGIFEncoder: typeof m1.GIFEncoder,
        hasQuantize: typeof m1.quantize,
        hasApplyPalette: typeof m1.applyPalette,
      };
    } catch (e) {
      out.unpkgError = e.message;
    }
    // 试 jsdelivr +esm
    try {
      const m2 = await import("https://cdn.jsdelivr.net/npm/gifenc@1.0.3/+esm");
      out.jsdelivr = {
        keys: Object.keys(m2),
        hasGIFEncoder: typeof m2.GIFEncoder,
        hasQuantize: typeof m2.quantize,
        hasApplyPalette: typeof m2.applyPalette,
      };
    } catch (e) {
      out.jsdelivrError = e.message;
    }
    return out;
  });
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
