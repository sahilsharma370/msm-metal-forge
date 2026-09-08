import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', err => errors.push(err.message));
await page.goto('http://localhost:8080/', { waitUntil: 'networkidle' });
const info = await page.evaluate(() => {
  const el = document.querySelector('#materials');
  const rect = el.getBoundingClientRect();
  return { top: rect.top + window.scrollY, vh: window.innerHeight };
});
const chapters = ['copper', 'aluminium', 'steel', 'lead'];
for (let i = 0; i < chapters.length; i++) {
  const label = chapters[i];
  await page.evaluate((y) => window.scrollTo(0, y), info.top + info.vh * i);
  await page.waitForTimeout(900);
  const card = page.locator('#materials .group').first();
  const box = await card.boundingBox();

  await page.mouse.move(20, 20);
  await page.waitForTimeout(600);
  await card.screenshot({ path: `/tmp/img_${label}_rest.png` });

  await page.mouse.move(box.x + box.width * 0.05, box.y + box.height * 0.5, { steps: 15 });
  await page.waitForTimeout(500);
  await card.screenshot({ path: `/tmp/img_${label}_hoverLEFT.png` });

  await page.mouse.move(box.x + box.width * 0.95, box.y + box.height * 0.5, { steps: 15 });
  await page.waitForTimeout(500);
  await card.screenshot({ path: `/tmp/img_${label}_hoverRIGHT.png` });
}
console.log('console errors:', errors.length ? errors : 'none');
await browser.close();
