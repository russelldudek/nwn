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
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const findings = [];

try {
  await page.goto(`http://127.0.0.1:${address.port}/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(4200);

  const result = await page.evaluate(() => {
    const table = document.querySelector('.kpi-table');
    if (!table) return { missing: true };

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

    return {
      missing: false,
      viewportWidth: document.documentElement.clientWidth,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      tableWidth: tableRect.width,
      headerDisplay: header ? getComputedStyle(header).display : 'missing',
      rowChecks
    };
  });

  if (result.missing) {
    findings.push('KPI table is missing.');
  } else {
    if (result.documentOverflow > 2) findings.push(`Document has ${result.documentOverflow}px horizontal overflow.`);
    if (result.headerDisplay !== 'none') findings.push(`Mobile KPI header remains visible (${result.headerDisplay}).`);
    if (result.tableWidth < result.viewportWidth * 0.82) findings.push(`Mobile KPI table uses only ${Math.round(result.tableWidth)}px of ${result.viewportWidth}px viewport.`);

    for (const row of result.rowChecks) {
      if (row.display !== 'block') findings.push(`KPI row ${row.row} is ${row.display}, expected block.`);
      for (const cell of row.cellChecks) {
        if (cell.display !== 'block') findings.push(`KPI row ${row.row} cell ${cell.cell} is ${cell.display}, expected block.`);
        if (cell.width < cell.contentWidth * 0.98) findings.push(`KPI row ${row.row} cell ${cell.cell} is not full content width.`);
        if (cell.cell === 2 && !cell.beforeContent.includes('What it reveals')) findings.push(`KPI row ${row.row} lacks the “What it reveals” label.`);
        if (cell.cell === 3 && !cell.beforeContent.includes('Decision it should trigger')) findings.push(`KPI row ${row.row} lacks the decision label.`);
      }
    }
  }

  await page.addStyleTag({ content: '.site-header,.skip-link{display:none!important}' });
  await page.locator('.kpi-table').screenshot({ path: path.join(screens, 'kpi-mobile-390x844.png') });
} finally {
  await page.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

if (findings.length) {
  throw new Error(`Mobile KPI layout audit failed:\n${findings.join('\n')}`);
}

console.log('Mobile KPI table passed full-width stacked-row geometry and label checks.');
