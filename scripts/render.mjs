import { chromium } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.mkdirSync(path.join(root, 'qa', 'screens'), { recursive: true });

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.svg', 'image/svg+xml'],
  ['.pdf', 'application/pdf']
]);

const server = http.createServer((request, response) => {
  try {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
    let pathname = decodeURIComponent(requestUrl.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const relativePath = pathname.replace(/^\/+/, '');
    const resolvedPath = path.resolve(root, relativePath);
    const relativeToRoot = path.relative(root, resolvedPath);

    if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
      response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Forbidden');
      return;
    }

    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    const contentType = mimeTypes.get(path.extname(resolvedPath).toLowerCase()) || 'application/octet-stream';
    response.writeHead(200, {
      'content-type': contentType,
      'cache-control': 'no-store'
    });
    fs.createReadStream(resolvedPath).pipe(response);
  } catch (error) {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(error instanceof Error ? error.message : String(error));
  }
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

const address = server.address();
if (!address || typeof address === 'string') throw new Error('Could not resolve local QA server address.');
const baseUrl = `http://127.0.0.1:${address.port}`;
const urlFor = (file) => `${baseUrl}/${file}`;
const browser = await chromium.launch({ headless: true });
const findings = [];

const localFailure = (url) => url.startsWith(baseUrl);
const attachRuntimeChecks = (page, runtimeErrors) => {
  page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`));
  page.on('response', (response) => {
    if (localFailure(response.url()) && response.status() >= 400) {
      runtimeErrors.push(`HTTP ${response.status()}: ${response.url()}`);
    }
  });
  page.on('requestfailed', (request) => {
    const url = request.url();
    if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) return;
    runtimeErrors.push(`requestfailed: ${url} (${request.failure()?.errorText || 'unknown'})`);
  });
};

try {
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
  const slug = (route) => route.replace('.html', '').replace(/[^a-z0-9]+/gi, '-');

  for (const [viewportName, width, height] of viewports) {
    const context = await browser.newContext({ viewport: { width, height } });
    for (const route of routes) {
      const page = await context.newPage();
      const runtimeErrors = [];
      attachRuntimeChecks(page, runtimeErrors);

      await page.goto(urlFor(route), { waitUntil: 'load' });
      if (route === 'index.html') await page.waitForTimeout(4200);

      const audit = await page.evaluate(() => {
        const visible = (element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.05 && rect.width > 0 && rect.height > 0;
        };
        const parseRgb = (value) => {
          const values = value.match(/[\d.]+/g)?.map(Number);
          if (!values || values.length < 3) return null;
          return { r: values[0], g: values[1], b: values[2], a: values[3] ?? 1 };
        };
        const composite = (foreground, background) => ({
          r: foreground.r * foreground.a + background.r * (1 - foreground.a),
          g: foreground.g * foreground.a + background.g * (1 - foreground.a),
          b: foreground.b * foreground.a + background.b * (1 - foreground.a),
          a: 1
        });
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
        const contextualBase = (element) => {
          if (element.closest('.hero, .section.navy, .section.blue, .airlock-board, .site-footer')) {
            return { r: 0, g: 20, b: 85, a: 1 };
          }
          if (element.closest('.document-page')) return { r: 223, g: 229, b: 236, a: 1 };
          return { r: 255, g: 255, b: 255, a: 1 };
        };
        const effectiveBackground = (element) => {
          const layers = [];
          let current = element;
          while (current) {
            const color = parseRgb(getComputedStyle(current).backgroundColor);
            if (color && color.a > 0) layers.push(color);
            current = current.parentElement;
          }
          let result = contextualBase(element);
          for (let index = layers.length - 1; index >= 0; index -= 1) {
            result = composite(layers[index], result);
          }
          return result;
        };
        const rect = (element) => {
          const box = element.getBoundingClientRect();
          return { top: box.top, right: box.right, bottom: box.bottom, left: box.left, width: box.width, height: box.height };
        };
        const horizontalIntersection = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const verticalIntersection = (a, b) => Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        const overlaps = (a, b, tolerance = 1) => horizontalIntersection(a, b) > tolerance && verticalIntersection(a, b) > tolerance;

        const controls = [...document.querySelectorAll('a, button')]
          .filter(visible)
          .map((element) => {
            const style = getComputedStyle(element);
            const foreground = parseRgb(style.color);
            const background = effectiveBackground(element);
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

        const gateLayoutIssues = [...document.querySelectorAll('.gate')]
          .filter(visible)
          .flatMap((gate, index) => {
            const ring = gate.querySelector('.gate-ring');
            const heading = gate.querySelector('h4');
            const description = gate.querySelector('p');
            const state = gate.querySelector('.gate-state');
            if (!ring || !heading || !description || !state) return [`gate ${index + 1}: missing expected child`];

            const gateBox = rect(gate);
            const ringBox = rect(ring);
            const headingBox = rect(heading);
            const descriptionBox = rect(description);
            const stateBox = rect(state);
            const issues = [];

            if (overlaps(ringBox, headingBox) || ringBox.bottom + 8 > headingBox.top) {
              issues.push(`gate ${index + 1}: ring intrudes into heading (${Math.round(ringBox.bottom)} > ${Math.round(headingBox.top)})`);
            }
            if (overlaps(headingBox, descriptionBox) || headingBox.bottom + 4 > descriptionBox.top) {
              issues.push(`gate ${index + 1}: heading intrudes into description`);
            }
            if (overlaps(descriptionBox, stateBox) || descriptionBox.bottom + 6 > stateBox.top) {
              issues.push(`gate ${index + 1}: description intrudes into state`);
            }
            for (const [name, box] of [['ring', ringBox], ['heading', headingBox], ['description', descriptionBox], ['state', stateBox]]) {
              if (box.left < gateBox.left - 2 || box.right > gateBox.right + 2 || box.top < gateBox.top - 2 || box.bottom > gateBox.bottom + 2) {
                issues.push(`gate ${index + 1}: ${name} escapes gate bounds`);
              }
            }
            return issues;
          });

        const componentLayoutIssues = [...document.querySelectorAll('.phase, .mechanism, .document-link, .brief-card, .worksheet-cell, .evidence-body')]
          .filter(visible)
          .flatMap((component, componentIndex) => {
            const parentBox = rect(component);
            const textChildren = [...component.querySelectorAll(':scope > h3, :scope > h4, :scope > p, :scope > ul, :scope > strong, :scope > span, :scope > .phase-days')]
              .filter(visible)
              .map((element) => ({ element, box: rect(element), text: element.textContent.trim().slice(0, 50) }))
              .sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left);
            const issues = [];

            for (const child of textChildren) {
              if (child.box.left < parentBox.left - 2 || child.box.right > parentBox.right + 2 || child.box.top < parentBox.top - 2 || child.box.bottom > parentBox.bottom + 2) {
                issues.push(`${component.className || component.tagName} ${componentIndex + 1}: text escapes bounds (${child.text})`);
              }
            }
            for (let index = 0; index < textChildren.length - 1; index += 1) {
              const current = textChildren[index];
              const next = textChildren[index + 1];
              if (overlaps(current.box, next.box)) {
                issues.push(`${component.className || component.tagName} ${componentIndex + 1}: text overlap (${current.text}) / (${next.text})`);
              }
            }
            return issues;
          });

        const track = document.querySelector('.airlock-track');
        const trackConnector = track ? getComputedStyle(track, '::before') : null;
        const wrappedConnectorVisible = Boolean(
          track &&
          window.innerWidth <= 980 &&
          trackConnector &&
          trackConnector.display !== 'none' &&
          Number.parseFloat(trackConnector.height) > 0
        );

        return {
          title: document.title,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          emptyControls: controls.filter((item) => !item.text),
          clippedControls: controls.filter((item) => item.clipped),
          lowContrastControls: controls.filter((item) => item.contrast < 4.5),
          tinyControls: controls.filter((item) => item.fontSize < 12),
          tinySiteText: siteText.filter((item) => item.fontSize < 12),
          gateLayoutIssues,
          componentLayoutIssues,
          wrappedConnectorVisible,
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
      if (route === 'index.html' && audit.gateLayoutIssues.length) findings.push(`${route} ${viewportName}: gate geometry ${JSON.stringify(audit.gateLayoutIssues)}`);
      if (audit.componentLayoutIssues.length) findings.push(`${route} ${viewportName}: component geometry ${JSON.stringify(audit.componentLayoutIssues)}`);
      if (route === 'index.html' && audit.wrappedConnectorVisible) findings.push(`${route} ${viewportName}: connector line remains visible after gate grid wraps`);
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
        await page.locator('#airlock').screenshot({
          path: path.join(root, 'qa', 'screens', `airlock-${viewportName}.png`)
        });
      }
      await page.close();
    }
    await context.close();
  }

  const reducedContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const reducedPage = await reducedContext.newPage();
  const reducedErrors = [];
  attachRuntimeChecks(reducedPage, reducedErrors);
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
  if (reducedErrors.length) findings.push(`reduced motion runtime: ${reducedErrors.join(' | ')}`);
  if (reducedState.gateCount !== 6 || !reducedState.gatesVisible || !reducedState.animationsDisabled || !reducedState.outcomeVisible || !reducedState.outcomeText.includes('Ready with controls')) {
    findings.push(`reduced motion failed: ${JSON.stringify(reducedState)}`);
  }
  await reducedPage.screenshot({ path: path.join(root, 'qa', 'screens', 'reduced-motion-1280x800.png'), fullPage: true });
  await reducedContext.close();

  const interactionContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const interactionPage = await interactionContext.newPage();
  const interactionErrors = [];
  attachRuntimeChecks(interactionPage, interactionErrors);
  await interactionPage.goto(urlFor('index.html'), { waitUntil: 'load' });
  const baseline = await interactionPage.locator('#readiness-result').innerText();
  await interactionPage.getByRole('button', { name: 'Device + service bundle' }).click();
  const changed = await interactionPage.locator('#readiness-result').innerText();
  await interactionPage.getByRole('button', { name: 'Reset to baseline' }).click();
  const reset = await interactionPage.locator('#readiness-result').innerText();
  if (interactionErrors.length) findings.push(`interaction runtime: ${interactionErrors.join(' | ')}`);
  if (baseline !== 'READY WITH CONTROLS' || changed !== 'HOLD FOR REWORK' || reset !== baseline) {
    findings.push(`interaction failed: ${JSON.stringify({ baseline, changed, reset })}`);
  }
  await interactionContext.close();
} finally {
  fs.writeFileSync(path.join(root, 'qa', 'readability-findings.json'), JSON.stringify({ findings }, null, 2));
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

if (findings.length) {
  throw new Error(`Readability QA failed with ${findings.length} finding(s):\n${findings.join('\n')}`);
}

console.log('Rendered 5 PDFs and 37 screenshots; all seven routes passed readability, contrast, geometry, overflow, reduced-motion, and interaction checks.');
