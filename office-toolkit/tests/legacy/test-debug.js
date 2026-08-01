// 调试预览区
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  await page.goto('http://localhost:3000/tools/image/pad/', { waitUntil: 'networkidle' });
  await page.locator('input[type="file"]').setInputFiles('G:/AgentWork/VibeCodingIdea/常用办公工具项目/OfficeToolkitPrj/office-toolkit/public/test.JPG');
  await page.waitForTimeout(2000);

  // 检查预览区 DOM 状态
  const debug = await page.evaluate(() => {
    const outer = document.querySelector('.relative.w-full.h-\\[320px\\]');
    if (!outer) return { error: 'outer not found' };
    const inner = outer.firstElementChild;
    const img = inner?.firstElementChild;
    return {
      outer: { width: outer.clientWidth, height: outer.clientHeight, style: outer.getAttribute('style') },
      inner: inner ? { width: inner.clientWidth, height: inner.clientHeight, style: inner.getAttribute('style'), aspectRatio: getComputedStyle(inner).aspectRatio } : null,
      img: img ? { width: img.clientWidth, height: img.clientHeight, naturalW: img.naturalWidth, naturalH: img.naturalHeight, complete: img.complete } : null,
    };
  });
  console.log(JSON.stringify(debug, null, 2));

  await browser.close();
})();
