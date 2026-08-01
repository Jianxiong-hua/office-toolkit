const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  await page.goto('http://localhost:3000/tools/image/pad/', { waitUntil: 'networkidle' });
  await page.locator('input[type="file"]').setInputFiles('G:/AgentWork/VibeCodingIdea/常用办公工具项目/OfficeToolkitPrj/office-toolkit/public/test.JPG');
  await page.waitForTimeout(1500);

  // 检查 color input 的当前值
  const color = await page.evaluate(() => {
    const colorInput = document.querySelector('input[type="color"]');
    return {
      value: colorInput?.value,
      defaultValue: colorInput?.defaultValue,
    };
  });
  console.log('Color input state:', JSON.stringify(color, null, 2));

  // 检查颜色文本显示
  const colorText = await page.evaluate(() => {
    const text = Array.from(document.querySelectorAll('span')).find(s => /^#[0-9a-f]{6}$/i.test(s.textContent?.trim() || ''));
    return text?.textContent;
  });
  console.log('Color text display:', colorText);

  await page.screenshot({ path: 'C:/Users/bakbik/AppData/Local/Temp/pad-bg-check.png', fullPage: true });

  await browser.close();
})();
