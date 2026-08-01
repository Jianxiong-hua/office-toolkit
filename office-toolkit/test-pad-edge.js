// 用更大的 padding 测试
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  await page.goto('http://localhost:3000/tools/image/pad/', { waitUntil: 'networkidle' });
  await page.locator('input[type="file"]').setInputFiles('G:/AgentWork/VibeCodingIdea/常用办公工具项目/OfficeToolkitPrj/office-toolkit/public/test.JPG');
  await page.waitForTimeout(1500);

  // 改 padding 为 300/300/300/300
  const inputs = page.locator('input[type="number"]');
  await inputs.nth(0).fill('300');
  await inputs.nth(1).fill('300');
  await inputs.nth(2).fill('300');
  await inputs.nth(3).fill('300');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'C:/Users/bakbik/AppData/Local/Temp/pad-300.png', fullPage: true });

  // 切到画布 + 偏移模式，7000x5000, dx=200, dy=100
  await page.click('button:has-text("按画布 + 偏移")');
  await page.waitForTimeout(500);
  await inputs.nth(0).fill('7000');
  await inputs.nth(1).fill('5000');
  await inputs.nth(2).fill('200');
  await inputs.nth(3).fill('100');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'C:/Users/bakbik/AppData/Local/Temp/pad-canvas-offset.png', fullPage: true });

  // 选个红色背景测试
  await page.evaluate(() => {
    const colorInput = document.querySelector('input[type="color"]');
    if (colorInput) {
      colorInput.value = '#ff0000';
      colorInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'C:/Users/bakbik/AppData/Local/Temp/pad-red-bg.png', fullPage: true });

  // 执行扩展 + 看结果
  await page.click('button:has-text("开始扩展")');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'C:/Users/bakbik/AppData/Local/Temp/pad-final-result.png', fullPage: true });

  await browser.close();
})();
