// 验证：删除常用尺寸预设 + canvas 初始 = 原图尺寸
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

  await page.goto('http://localhost:3000/tools/image/pad/', { waitUntil: 'networkidle' });
  await page.locator('input[type="file"]').setInputFiles('G:/AgentWork/VibeCodingIdea/常用办公工具项目/OfficeToolkitPrj/office-toolkit/public/test.JPG');
  await page.waitForTimeout(1500);

  // 切到 canvas-offset 模式
  await page.click('button:has-text("按画布 + 偏移")');
  await page.waitForTimeout(500);

  // 检查输入框值
  const inputs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input[type="number"]')).map(i => ({
      label: i.previousElementSibling?.textContent || '',
      value: i.value,
    }));
  });
  console.log('=== canvas-offset inputs ===');
  console.log(JSON.stringify(inputs, null, 2));

  // 验证没有"常用尺寸预设"标签
  const hasPreset = await page.evaluate(() =>
    Array.from(document.querySelectorAll('label')).some(l => l.textContent.includes('常用尺寸预设'))
  );
  console.log('"常用尺寸预设" 标签存在:', hasPreset);

  // 验证原图是 6000x4000，所以 canvas 初始值应该也是 6000x4000
  const expectedInit = inputs.find(i => i.label.includes('画布宽度'))?.value === '6000' &&
                       inputs.find(i => i.label.includes('画布高度'))?.value === '4000';
  console.log('Canvas 初始值 = 原图尺寸 (6000x4000):', expectedInit);

  // 截图
  await page.screenshot({ path: 'C:/Users/bakbik/AppData/Local/Temp/pad-after-change.png', fullPage: true });

  // 测试 1：默认状态直接开始扩展（画布 = 原图，应该等价于原图 1:1 输出）
  console.log('\n=== 测试 1: 默认 (画布=原图) 扩展 ===');
  const btnEnabled = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('开始扩展'));
    return btn ? !btn.disabled : false;
  });
  console.log('按钮启用:', btnEnabled);

  if (btnEnabled) {
    await page.click('button:has-text("开始扩展")');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'C:/Users/bakbik/AppData/Local/Temp/pad-default-result.png', fullPage: true });
  }

  // 测试 2：把画布改大 200px
  console.log('\n=== 测试 2: 画布宽度 6200，画布高度 4200 ===');
  const allInputs = page.locator('input[type="number"]');
  await allInputs.nth(0).fill('6200');
  await allInputs.nth(1).fill('4200');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'C:/Users/bakbik/AppData/Local/Temp/pad-6200x4200.png', fullPage: true });

  if (errors.length > 0) {
    console.log('\n=== ERRORS ===');
    errors.forEach(e => console.log(e));
  } else {
    console.log('\n=== No errors ===');
  }

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
