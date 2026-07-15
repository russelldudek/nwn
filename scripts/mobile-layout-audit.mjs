import { chromium } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const screens = path.join(root, 'qa', 'screens');
fs.mkdirSync(screens, { recursive: true });

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.svg', 'image/svg+xml']
]);

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
  let pathname = decodeURIComponent(requestUrl.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';
  const resolved = path.resolve(root, pathname.replace(/^\/+/, ''));
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, {
    'content-type': mimeTypes.get(path.extname(resolved).toLowerCase()) || 'application/octet-stream',
    'cache-control': 'no-store'
  });
  fs.createReadStream(resolved).pipe(response);
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

const address = server.address();
if (!address || typeof address === 'string') throw new Error('Unable to start mobile layout audit server.');
const browser = await chromium.launch({ headless: true });
const findings = [];
const viewports = [
  ['mobile-390x844', 390, 844],
  ['narrow-320x568', 320, 568]
];

try {
  for (const [name, width, height] of viewports) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(`http://127.0.0.1:${address.port}/index.html`, { waitUntil: 'load' });
    await page.waitForTimeout(4200);

    const result = await page.evaluate(() => {
      const table = document.querySelector('.kpi-table');
      const airlock = document.querySelector('.airlock-board');
      if (!table || !airlock) return { missing: true, table: Boolean(table), airlock: Boolean(airlock) };

      const header = table.querySelector('thead');
      const rows = [...table.querySelectorAll('tbody tr')];
      const tableRect = table.getBoundingClientRect();
      const rowChecks = rows.map((row, rowIndex) => {
        const cells = [...row.querySelectorAll('td')];
        const rowStyle = getComputedStyle(row);
        const rowRect = row.getBoundingClientRect();
        const horizontalPadding = Number.parseFloat(rowStyle.paddingLeft) + Number.parseFloat(rowStyle.paddingRight);
        const contentWidth = rowRect.width - horizontalPadding;
        const cellChecks = cells.map((cell, cellIndex) => {
          const style = getComputedStyle(cell);
          const rect = cell.getBoundingClientRect();
          const before = getComputedStyle(cell, '::before');
          return {
            cell: cellIndex + 1,
            display: style.display,
            width: rect.width,
            contentWidth,
            beforeContent: before.content,
            text: cell.textContent.trim().slice(0, 70)
          };
        });
        return { row: rowIndex + 1, display: rowStyle.display, width: rowRect.width, contentWidth, cellChecks };
      });

      const gateChecks = [...airlock.querySelectorAll('.gate')].map((gate, gateIndex) => {
        const ring = gate.querySelector('.gate-ring')?.getBoundingClientRect();
        const heading = gate.querySelector('h4')?.getBoundingClientRect();
        const description = gate.querySelector('p')?.getBoundingClientRect();
        const state = gate.querySelector('.gate-state')?.getBoundingClientRect();
        if (!ring || !heading || !description || !state) return { gate: gateIndex + 1, missing: true };
        return {
          gate: gateIndex + 1,
          missing: false,
          ringHeadingGap: heading.top - ring.bottom,
          headingDescriptionGap: description.top - heading.bottom,
          descriptionStateGap: state.top - description.bottom
        };
      });
      const connector = getComputedStyle(document.querySelector('.airlock-track'), '::before');

      return {
        missing: false,
        viewportWidth: document.documentElement.clientWidth,
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        tableWidth: tableRect.width,
        headerDisplay: header ? getComputedStyle(header).display : 'missing',
        rowChecks,
        gateChecks,
        connectorDisplay: connector.display
      };
    });

    if (result.missing) {
      findings.push(`${name}: required component missing (${JSON.stringify(result)}).`);
    } else {
      if (result.documentOverflow > 2) findings.push(`${name}: document has ${result.documentOverflow}px horizontal overflow.`);
      if (result.headerDisplay !== 'none') findings.push(`${name}: mobile KPI header remains visible (${result.headerDisplay}).`);
      if (result.tableWidth < result.viewportWidth * 0.82) findings.push(`${name}: KPI table uses only ${Math.round(result.tableWidth)}px of ${result.viewportWidth}px viewport.`);
      if (result.connectorDisplay !== 'none') findings.push(`${name}: wrapped Airlock connector remains visible.`);

      for (const row of result.rowChecks) {
        if (row.display !== 'block') findings.push(`${name}: KPI row ${row.row} is ${row.display}, expected block.`);
        for (const cell of row.cellChecks) {
          if (cell.display !== 'block') findings.push(`${name}: KPI row ${row.row} cell ${cell.cell} is ${cell.display}, expected block.`);
          if (cell.width < cell.contentWidth * 0.98) findings.push(`${name}: KPI row ${row.row} cell ${cell.cell} is not full content width.`);
          if (cell.cell === 2 && !cell.beforeContent.includes('What it reveals')) findings.push(`${name}: KPI row ${row.row} lacks the “What it reveals” label.`);
          if (cell.cell === 3 && !cell.beforeContent.includes('Decision it should trigger')) findings.push(`${name}: KPI row ${row.row} lacks the decision label.`);
        }
      }

      for (const gate of result.gateChecks) {
        if (gate.missing) {
          findings.push(`${name}: Airlock gate ${gate.gate} is missing expected children.`);
          continue;
        }
        if (gate.ringHeadingGap < 8) findings.push(`${name}: Airlock gate ${gate.gate} ring-heading gap is ${gate.ringHeadingGap.toFixed(1)}px.`);
        if (gate.headingDescriptionGap < 4) findings.push(`${name}: Airlock gate ${gate.gate} heading-description gap is ${gate.headingDescriptionGap.toFixed(1)}px.`);
        if (gate.descriptionStateGap < 6) findings.push(`${name}: Airlock gate ${gate.gate} description-state gap is ${gate.descriptionStateGap.toFixed(1)}px.`);
      }
    }

    await page.addStyleTag({ content: '.site-header,.skip-link{display:none!important}' });
    await page.locator('.kpi-table').screenshot({ path: path.join(screens, `kpi-${name}.png`) });
    await page.locator('.airlock-board').screenshot({ path: path.join(screens, `airlock-clean-${name}.png`) });
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

if (findings.length) {
  throw new Error(`Mobile layout audit failed:\n${findings.join('\n')}`);
}

console.log('Mobile KPI table passed full-width stacked-row geometry and label checks. Airlock gate spacing passed at 390px and 320px.');
