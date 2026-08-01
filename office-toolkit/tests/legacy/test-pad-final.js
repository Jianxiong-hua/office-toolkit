const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  await page.goto('http://localhost:3000/tools/image/pad/', { waitUntil: 'networkidle' });
  await page.locator('input[type="file"]').setInputFiles('G:/AgentWork/VibeCodingIdea/常用办公工具项目/OfficeToolkitPrj/office-toolkit/public/test.JPG');
  await page.waitForTimeout(1500);

  // 改 padding: 300/300/300/300
  const inputs = page.locator('input[type="number"]');
  await inputs.nth(0).fill('300');
  await inputs.nth(1).fill('300');
  await inputs.nth(2).fill('300');
  await inputs.nth(3).fill('300');
  await page.waitForTimeout(500);

  // 改 color 用 React 兼容方式
  await page.locator('input[type="color"]').evaluate((el) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '#ff0000');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(500);

  await page.screenshot({ path: 'C:/Users/bakbik/AppData/Local/Temp/pad-300-red.png', fullPage: true });

  // 执行扩展
  await page.click('button:has-text("开始扩展")');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'C:/Users/bakbik/AppData/Local/Temp/pad-300-red-result.png', fullPage: true });

  await browser.close();
})();
