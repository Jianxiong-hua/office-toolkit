// 验证 DPI 工具已删除
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

  // 1. 首页图片工具区应该只有 5 张卡
  console.log('=== 测试 1: 首页图片工具区 ===');
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const imageTools = await page.evaluate(() => {
    const section = document.querySelector('#image-tools');
    if (!section) return { error: 'image-tools section not found' };
    const cards = section.querySelectorAll('a[href*="/tools/image/"]');
    return {
      count: cards.length,
      hrefs: Array.from(cards).map(c => c.getAttribute('href')),
    };
  });
  console.log('Image tools count:', imageTools.count);
  console.log('Hrefs:', JSON.stringify(imageTools.hrefs, null, 2));

  const hasDpi = imageTools.hrefs?.some(h => h.includes('dpi'));
  console.log('Contains DPI link:', hasDpi);

  // 2. /tools/image/dpi/ 应该 404
  console.log('\n=== 测试 2: /tools/image/dpi/ 路由 ===');
  const response = await page.goto('http://localhost:3000/tools/image/dpi/', { waitUntil: 'networkidle' });
  console.log('Status:', response.status());
  const pageContent = await page.content();
  const hasDpiInPage = pageContent.includes('修改图片 DPI') || pageContent.includes('DPI 选项');
  console.log('Page contains DPI content:', hasDpiInPage);

  // 3. 截图首页
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'C:/Users/bakbik/AppData/Local/Temp/home-after-dpi-removed.png', fullPage: true });

  if (errors.length > 0) {
    console.log('\n=== ERRORS ===');
    errors.forEach(e => console.log(e));
  } else {
    console.log('\n=== No errors ===');
  }

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
