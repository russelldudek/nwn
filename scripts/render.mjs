import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const urlFor = (file) => pathToFileURL(path.join(root, file)).href;
fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.mkdirSync(path.join(root, 'qa', 'screens'), { recursive: true });

const printTargets = [
  ['resume.html', 'Russell-Dudek-NWN-Resume.pdf'],
  ['cover-letter.html', 'Russell-Dudek-NWN-Cover-Letter.pdf'],
  ['interview-brief.html', 'NWN-Interview-Thesis-Brief.pdf'],
  ['120-day-plan.html', 'NWN-120-Day-Entry-Plan.pdf'],
  ['o2c-readiness-airlock.html', 'O2C-Readiness-Airlock-Worksheet.pdf']
];
for (const [html, pdf] of printTargets) {
  await page.goto(urlFor(html), { waitUntil: 'load' });
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: path.join(root, 'docs', pdf), format: 'Letter', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' }, preferCSSPageSize: true });
}
await page.emulateMedia({ media: 'screen' });

const viewports = [
  ['desktop-1440x900', 1440, 900], ['laptop-1280x800', 1280, 800], ['tablet-768x1024', 768, 1024], ['mobile-390x844', 390, 844]
];
for (const [name, width, height] of viewports) {
  await page.setViewportSize({ width, height });
  await page.goto(urlFor('index.html'), { waitUntil: 'load' });
  await page.screenshot({ path: path.join(root, 'qa', 'screens', `${name}.png`), fullPage: true });
}

const reducedContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
const reducedPage = await reducedContext.newPage();
await reducedPage.goto(urlFor('index.html'), { waitUntil: 'load' });
await reducedPage.screenshot({ path: path.join(root, 'qa', 'screens', 'reduced-motion-1280x800.png'), fullPage: true });
await reducedContext.close();

await page.setViewportSize({ width: 1280, height: 800 });
await page.goto(urlFor('index.html'), { waitUntil: 'load' });
const baseline = await page.locator('#readiness-result').innerText();
await page.getByRole('button', { name: 'Device + service bundle' }).click();
const changed = await page.locator('#readiness-result').innerText();
await page.getByRole('button', { name: 'Reset to baseline' }).click();
const reset = await page.locator('#readiness-result').innerText();
if (baseline !== 'READY WITH CONTROLS' || changed !== 'HOLD FOR REWORK' || reset !== baseline) {
  throw new Error(`Interaction failed: ${JSON.stringify({ baseline, changed, reset })}`);
}

const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
if (overflow > 2) throw new Error(`Desktop horizontal overflow: ${overflow}px`);

await browser.close();
console.log('Rendered 5 PDFs, 5 responsive screenshots, and verified the core interaction.');
