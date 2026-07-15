import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ headless: true });
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

const printContext = await browser.newContext();
const printPage = await printContext.newPage();
for (const [html, pdf] of printTargets) {
  await printPage.goto(urlFor(html), { waitUntil: 'load' });
  await printPage.emulateMedia({ media: 'print' });
  await printPage.pdf({
    path: path.join(root, 'docs', pdf),
    format: 'Letter',
    printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
    preferCSSPageSize: true
  });
}
await printContext.close();

const routes = [
  'index.html',
  'resume.html',
  'cover-letter.html',
  'interview-brief.html',
  '120-day-plan.html',
  'o2c-readiness-airlock.html',
  'source-notes.html'
];
const viewports = [
  ['desktop-1440x900', 1440, 900],
  ['laptop-1280x800', 1280, 800],
  ['tablet-768x1024', 768, 1024],
  ['mobile-390x844', 390, 844]
];

const findings = [];
const slug = (route) => route.replace('.html', '').replace(/[^a-z0-9]+/gi, '-');

for (const [viewportName, width, height] of viewports) {
  const context = await browser.newContext({ viewport: { width, height } });
  for (const route of routes) {
    const page = await context.newPage();
    const runtimeErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`));

    await page.goto(urlFor(route), { waitUntil: 'load' });
    if (route === 'index.html') await page.waitForTimeout(4200);

    const audit = await page.evaluate(() => {
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.05 && rect.width > 0 && rect.height > 0;
      };
      const parseRgb = (value) => {
        const match = value.match(/rgba?\(([^)]+)\)/);
        if (!match) return null;
        const values = match[1].split(',').map((part) => Number.parseFloat(part.trim()));
        return { r: values[0], g: values[1], b: values[2], a: values.length > 3 ? values[3] : 1 };
      };
      const luminance = ({ r, g, b }) => {
        const channel = (value) => {
          const normalized = value / 255;
          return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      };
      const contrast = (a, b) => {
        const l1 = luminance(a);
        const l2 = luminance(b);
        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      };
      const solidBackground = (element) => {
        let current = element;
        while (current) {
          const color = parseRgb(getComputedStyle(current).backgroundColor);
          if (color && color.a >= 0.96) return color;
          current = current.parentElement;
        }
        if (element.closest('.hero, .section.navy, .section.blue, .airlock-board, .site-footer')) {
          return { r: 0, g: 20, b: 85, a: 1 };
        }
        return { r: 255, g: 255, b: 255, a: 1 };
      };

      const controls = [...document.querySelectorAll('a, button')]
        .filter(visible)
        .map((element) => {
          const style = getComputedStyle(element);
          const foreground = parseRgb(style.color);
          const background = solidBackground(element);
          return {
            text: element.textContent.trim(),
            tag: element.tagName.toLowerCase(),
            fontSize: Number.parseFloat(style.fontSize),
            contrast: foreground ? contrast(foreground, background) : 99,
            clipped: element.scrollWidth > element.clientWidth + 2 || element.scrollHeight > element.clientHeight + 2
          };
        });

      const siteText = [...document.querySelectorAll('p, li, .candidate-label, .section-number, .readiness-scan span, .readiness-scan small, .gate-state, .readiness-status span, .document-link span, .transfer-tag, .footer-inner')]
        .filter(visible)
        .filter((element) => !element.closest('.paper'))
        .map((element) => ({
          text: element.textContent.trim().slice(0, 80),
          fontSize: Number.parseFloat(getComputedStyle(element).fontSize)
        }));

      return {
        title: document.title,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        emptyControls: controls.filter((item) => !item.text),
        clippedControls: controls.filter((item) => item.clipped),
        lowContrastControls: controls.filter((item) => item.contrast < 4.5),
        tinyControls: controls.filter((item) => item.fontSize < 12),
        tinySiteText: siteText.filter((item) => item.fontSize < 12),
        buttonTexts: controls.map((item) => item.text),
        bodyTextLength: document.body.innerText.trim().length
      };
    });

    if (audit.bodyTextLength < 200) findings.push(`${route} ${viewportName}: page appears blank`);
    if (audit.overflow > 2) findings.push(`${route} ${viewportName}: horizontal overflow ${audit.overflow}px`);
    if (runtimeErrors.length) findings.push(`${route} ${viewportName}: ${runtimeErrors.join(' | ')}`);
    if (audit.emptyControls.length) findings.push(`${route} ${viewportName}: empty visible control`);
    if (audit.clippedControls.length) findings.push(`${route} ${viewportName}: clipped controls ${JSON.stringify(audit.clippedControls)}`);
    if (audit.lowContrastControls.length) findings.push(`${route} ${viewportName}: low-contrast controls ${JSON.stringify(audit.lowContrastControls)}`);
    if (audit.tinyControls.length) findings.push(`${route} ${viewportName}: controls below 12px ${JSON.stringify(audit.tinyControls)}`);
    if (route === 'index.html' && audit.tinySiteText.length) findings.push(`${route} ${viewportName}: essential site text below 12px ${JSON.stringify(audit.tinySiteText)}`);
    if (route === 'index.html' && !audit.buttonTexts.includes('Run the readiness model')) findings.push(`${route} ${viewportName}: primary CTA label missing`);

    await page.screenshot({
      path: path.join(root, 'qa', 'screens', `${slug(route)}-${viewportName}.png`),
      fullPage: true
    });
    if (route === 'index.html') {
      await page.screenshot({
        path: path.join(root, 'qa', 'screens', `hero-${viewportName}.png`),
        fullPage: false
      });
    }
    await page.close();
  }
  await context.close();
}

const reducedContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
const reducedPage = await reducedContext.newPage();
await reducedPage.goto(urlFor('index.html'), { waitUntil: 'load' });
const reducedState = await reducedPage.evaluate(() => {
  const gates = [...document.querySelectorAll('.scan-gate')];
  const outcome = document.querySelector('.scan-outcome');
  return {
    gateCount: gates.length,
    gatesVisible: gates.every((gate) => Number(getComputedStyle(gate).opacity) === 1),
    animationsDisabled: gates.every((gate) => getComputedStyle(gate).animationName === 'none'),
    outcomeVisible: outcome && Number(getComputedStyle(outcome).opacity) === 1,
    outcomeText: outcome?.textContent || ''
  };
});
if (reducedState.gateCount !== 6 || !reducedState.gatesVisible || !reducedState.animationsDisabled || !reducedState.outcomeVisible || !reducedState.outcomeText.includes('Ready with controls')) {
  findings.push(`reduced motion failed: ${JSON.stringify(reducedState)}`);
}
await reducedPage.screenshot({ path: path.join(root, 'qa', 'screens', 'reduced-motion-1280x800.png'), fullPage: true });
await reducedContext.close();

const interactionContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const interactionPage = await interactionContext.newPage();
await interactionPage.goto(urlFor('index.html'), { waitUntil: 'load' });
const baseline = await interactionPage.locator('#readiness-result').innerText();
await interactionPage.getByRole('button', { name: 'Device + service bundle' }).click();
const changed = await interactionPage.locator('#readiness-result').innerText();
await interactionPage.getByRole('button', { name: 'Reset to baseline' }).click();
const reset = await interactionPage.locator('#readiness-result').innerText();
if (baseline !== 'READY WITH CONTROLS' || changed !== 'HOLD FOR REWORK' || reset !== baseline) {
  findings.push(`interaction failed: ${JSON.stringify({ baseline, changed, reset })}`);
}
await interactionContext.close();

fs.writeFileSync(path.join(root, 'qa', 'readability-findings.json'), JSON.stringify({ findings }, null, 2));
await browser.close();

if (findings.length) {
  throw new Error(`Readability QA failed with ${findings.length} finding(s):\n${findings.join('\n')}`);
}

console.log(`Rendered 5 PDFs and ${routes.length * viewports.length + viewports.length + 1} screenshots; all routes passed readability, contrast, overflow, reduced-motion, and interaction checks.`);
