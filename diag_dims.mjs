import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:8080/', { waitUntil: 'networkidle' });
const info = await page.evaluate(() => {
  const el = document.querySelector('#materials');
  const rect = el.getBoundingClientRect();
  return { top: rect.top + window.scrollY };
});
await page.evaluate((y) => window.scrollTo(0, y), info.top);
await page.waitForTimeout(900);
const card = page.locator('#materials .group').first();
const box = await card.boundingBox();

await page.mouse.move(box.x + box.width * 0.05, box.y + box.height * 0.5, { steps: 15 });
await page.waitForTimeout(600);

const dims = await page.evaluate(() => {
  const cardEl = document.querySelector('#materials .group');
  const frame = cardEl.children[0];
  const object = frame.children[0];
  const edgeRight = object.children[0];
  const edgeLeft = object.children[1];
  const rectFrame = frame.getBoundingClientRect();
  const rectRight = edgeRight.getBoundingClientRect();
  const rectLeft = edgeLeft.getBoundingClientRect();
  return {
    frame: { w: rectFrame.width, h: rectFrame.height, left: rectFrame.left, right: rectFrame.right },
    edgeRight: { w: rectRight.width, h: rectRight.height, left: rectRight.left, right: rectRight.right, transform: edgeRight.style.transform, computedTransform: getComputedStyle(edgeRight).transform },
    edgeLeft: { w: rectLeft.width, h: rectLeft.height, left: rectLeft.left, right: rectLeft.right, transform: edgeLeft.style.transform },
  };
});
console.log(JSON.stringify(dims, null, 2));
await browser.close();
