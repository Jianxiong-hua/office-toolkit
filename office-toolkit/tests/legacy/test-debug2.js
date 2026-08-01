const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  await page.goto('http://localhost:3000/tools/image/pad/', { waitUntil: 'networkidle' });
  await page.locator('input[type="file"]').setInputFiles('G:/AgentWork/VibeCodingIdea/常用办公工具项目/OfficeToolkitPrj/office-toolkit/public/test.JPG');
  await page.waitForTimeout(1500);

  // 改 color picker 为红色
  const colorInput = page.locator('input[type="color"]');
  await colorInput.evaluate((el) => {
    el.value = '#ff0000';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(500);

  const debug = await page.evaluate(() => {
    const outer = document.querySelector('.relative.w-full.h-\\[320px\\]');
    const inner = outer?.firstElementChild;
    return {
      outer: outer ? { bg: getComputedStyle(outer).background.substring(0, 100) } : null,
      inner: inner ? { bg: getComputedStyle(inner).background.substring(0, 100), w: inner.clientWidth, h: inner.clientHeight } : null,
    };
  });
  console.log(JSON.stringify(debug, null, 2));

  await page.screenshot({ path: 'C:/Users/bakbik/AppData/Local/Temp/pad-debug.png', fullPage: true });
  await browser.close();
})();
