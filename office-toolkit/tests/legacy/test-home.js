// 验证：删除"查看全部工具"按钮 + 平滑滚动
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // 检查 Hero 区只有一个按钮
  const heroButtons = await page.evaluate(() => {
    const hero = document.querySelector('section');
    const buttons = hero?.querySelectorAll('a');
    return Array.from(buttons || []).map(b => ({
      text: b.textContent?.trim(),
      href: b.getAttribute('href'),
    }));
  });
  console.log('Hero buttons:', JSON.stringify(heroButtons, null, 2));

  // 检查 smooth scroll CSS
  const css = await page.evaluate(() => {
    return {
      htmlScroll: getComputedStyle(document.documentElement).scrollBehavior,
      sectionScrollMargin: getComputedStyle(document.querySelector('#image-tools')).scrollMarginTop,
    };
  });
  console.log('CSS:', JSON.stringify(css, null, 2));

  // 点击"开始使用"测试平滑滚动
  await page.click('a[href="#image-tools"]');
  await page.waitForTimeout(1500);

  const scrollY = await page.evaluate(() => window.scrollY);
  console.log('After click "开始使用", scrollY:', scrollY);

  // 截图
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'C:/Users/bakbik/AppData/Local/Temp/home-after-opt.png', fullPage: false });

  await browser.close();
})();
