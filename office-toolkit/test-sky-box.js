// 验证品牌名替换
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  const errors = [];
  page.on('pageerror', e => errors.push('PAGE ERROR: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push('CONSOLE ERROR: ' + msg.text()); });

  // 1. 首页
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const homeData = await page.evaluate(() => {
    return {
      title: document.title,
      h1: document.querySelector('h1')?.textContent?.trim(),
      h1En: document.querySelector('h1 + p')?.textContent?.trim(),
      headerLogo: document.querySelector('header a[href="/"]')?.textContent?.trim(),
      footerH3: document.querySelector('footer h3')?.textContent?.trim(),
      footerCopy: document.querySelector('footer > div > div:last-child')?.textContent?.trim(),
      feedbackHref: document.querySelector('a[href^="mailto:"]')?.getAttribute('href'),
    };
  });
  console.log('=== 首页数据 ===');
  console.log(JSON.stringify(homeData, null, 2));

  // 2. PDF 水印页验证 title template
  await page.goto('http://localhost:3000/tools/pdf/watermark/', { waitUntil: 'networkidle' });
  const pdfTitle = await page.title();
  console.log('\nPDF 水印页 title:', pdfTitle);

  // 3. 截图首页 Hero
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'C:/Users/bakbik/AppData/Local/Temp/sky-box-home.png', fullPage: false });

  // 4. 截图 Footer
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'C:/Users/bakbik/AppData/Local/Temp/sky-box-footer.png', fullPage: false });

  if (errors.length > 0) {
    console.log('\n=== ERRORS ===');
    errors.forEach(e => console.log(e));
  } else {
    console.log('\n=== No errors ===');
  }

  await browser.close();
})();
