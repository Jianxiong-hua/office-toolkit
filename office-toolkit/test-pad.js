// 测试图片扩展填充功能
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const errors = [];
  page.on('pageerror', e => errors.push('PAGE ERROR: ' + e.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push('CONSOLE ERROR: ' + msg.text());
  });

  console.log('1. Opening page...');
  await page.goto('http://localhost:3000/tools/image/pad/', { waitUntil: 'networkidle' });

  console.log('2. Uploading test.JPG...');
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles('G:/AgentWork/VibeCodingIdea/常用办公工具项目/OfficeToolkitPrj/office-toolkit/public/test.JPG');

  await page.waitForTimeout(1500);

  // === 模式 1: 按 4 边像素 ===
  console.log('\n=== 模式 1: 按 4 边像素 (默认 100/100/100/100) ===');
  await page.screenshot({ path: 'C:/Users/bakbik/AppData/Local/Temp/pad-1-pixels.png', fullPage: true });

  // 直接执行
  await page.click('button:has-text("开始扩展")');
  await page.waitForTimeout(3000);

  let hasResult = await page.evaluate(() =>
    Array.from(document.querySelectorAll('h3')).some(h => h.textContent.includes('扩展完成'))
  );
  console.log('Result after mode 1:', hasResult);
  await page.screenshot({ path: 'C:/Users/bakbik/AppData/Local/Temp/pad-1-result.png', fullPage: true });

  // === 模式 2: 画布 + 偏移 (用大尺寸) ===
  console.log('\n=== 模式 2: 画布 + 偏移 (7000×5000) ===');
  await page.click('button:has-text("按画布 + 偏移")');
  await page.waitForTimeout(500);

  // 手动输入大尺寸
  const widthInput = page.locator('input[type="number"]').nth(0);
  const heightInput = page.locator('input[type="number"]').nth(1);
  await widthInput.fill('7000');
  await heightInput.fill('5000');
  await page.waitForTimeout(500);

  await page.screenshot({ path: 'C:/Users/bakbik/AppData/Local/Temp/pad-2-canvas.png', fullPage: true });

  // 检查按钮是否可用
  const btnEnabled = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('开始扩展'));
    return btn ? !btn.disabled : false;
  });
  console.log('Button enabled with 7000x5000:', btnEnabled);

  if (btnEnabled) {
    await page.click('button:has-text("开始扩展")');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'C:/Users/bakbik/AppData/Local/Temp/pad-2-result.png', fullPage: true });
  }

  // === 测试 3: 偏移 dx=200 ===
  console.log('\n=== 测试偏移 dx=200, dy=100 ===');
  const dxInput = page.locator('input[type="number"]').nth(2);
  const dyInput = page.locator('input[type="number"]').nth(3);
  await dxInput.fill('200');
  await dyInput.fill('100');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'C:/Users/bakbik/AppData/Local/Temp/pad-3-offset.png', fullPage: true });

  // === 测试 4: 切回模式 1，改 padding ===
  console.log('\n=== 切回模式 1, 改 padding 为非对称 ===');
  await page.click('button:has-text("按 4 边像素")');
  await page.waitForTimeout(500);

  // 上 0, 下 200, 左 50, 右 50
  const inputs = page.locator('input[type="number"]');
  await inputs.nth(0).fill('0');   // 上
  await inputs.nth(1).fill('50');  // 右
  await inputs.nth(2).fill('200'); // 下
  await inputs.nth(3).fill('50');  // 左
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'C:/Users/bakbik/AppData/Local/Temp/pad-4-asymmetric.png', fullPage: true });

  if (errors.length > 0) {
    console.log('\n=== ERRORS ===');
    errors.forEach(e => console.log(e));
  } else {
    console.log('\n=== No errors ===');
  }

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
