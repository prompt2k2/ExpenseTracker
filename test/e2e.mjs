// End-to-end test in a real browser. Run: npm install && npm run e2e
// Uses installed Edge by default; set BROWSER_CHANNEL=chrome (or "" for Playwright's Chromium) to change.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'test', 'output');
fs.mkdirSync(outDir, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.gz': 'application/gzip', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

// Generic test budget. Not anyone's real figures.
const SETUP = {
  income: 2000, savings: 400,
  categories: [
    { n: 'Rent', cap: 700, fixed: true }, { n: 'Energy', cap: 100, fixed: true },
    { n: 'Groceries', cap: 400 }, { n: 'Transport', cap: 50 },
    { n: 'Takeaways & eating out', cap: 60 }, { n: 'Unplanned', cap: 90 }
  ],
  methods: ['Debit', 'Amex', 'Cash'],
  cardRule: { card: 'Amex', allow: ['Groceries', 'Transport'], text: 'Amex is for groceries and rides only.' }
};

const pad = n => String(n).padStart(2, '0');
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const ukToday = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;

const channel = process.env.BROWSER_CHANNEL ?? 'msedge';
const browser = await chromium.launch(channel ? { channel } : {});
const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

let step = 0;
async function check(name, fn) {
  step++;
  try { await fn(); console.log(`ok  ${step}. ${name}`); }
  catch (e) {
    console.error(`FAIL ${step}. ${name}\n     ${e.message}`);
    await page.screenshot({ path: path.join(outDir, `fail-${step}.png`), fullPage: true });
    process.exitCode = 1;
  }
}
const text = sel => page.locator(sel).innerText();

async function add(amount, merchant, opts = {}) {
  await page.fill('#fAmount', amount);
  await page.fill('#fMerchant', merchant);
  await page.locator('#fMerchant').dispatchEvent('change');
  if (opts.category) await page.selectOption('#fCategory', opts.category);
  if (opts.method) await page.selectOption('#fMethod', opts.method);
  await page.click('#saveBtn');
}

try {
  await page.goto(base);

  await check('first run opens Setup with starter categories', async () => {
    assert.ok(await page.locator('#setup').isVisible());
    assert.ok(await page.locator('#firstRunMsg').isVisible());
  });

  await check('pasting a setup sets the day-to-day budget', async () => {
    await page.fill('#sPaste', JSON.stringify(SETUP));
    await page.click('#applyPaste');
    assert.strictEqual(await text('#leftBig'), '£600.00');
    assert.strictEqual(await text('#statMargin'), '£200.00');
    assert.ok(!(await page.locator('#setup').isVisible()));
  });

  await check('logging a shop guesses the category and lowers left to spend', async () => {
    await page.fill('#fMerchant', 'Tesco Extra');
    await page.locator('#fMerchant').dispatchEvent('change');
    assert.strictEqual(await page.inputValue('#fCategory'), 'Groceries');
    await add('48.30', 'Tesco Extra');
    assert.strictEqual(await text('#leftBig'), '£551.70');
    assert.match(await text('#dayCats'), /£351\.70 left/);
  });

  await check('card rule warns only for categories it does not allow', async () => {
    await page.selectOption('#fMethod', 'Amex');
    await page.selectOption('#fCategory', 'Groceries');
    assert.ok(!(await page.locator('#ruleWarn').isVisible()));
    await page.selectOption('#fCategory', 'Takeaways & eating out');
    assert.ok(await page.locator('#ruleWarn').isVisible());
    await page.click('#cancelEdit').catch(() => {});
    await page.reload();
  });

  await check('entries survive a reload', async () => {
    assert.strictEqual(await text('#leftBig'), '£551.70');
    assert.ok(!(await page.locator('#setup').isVisible()));
  });

  await check('marking a bill paid does not touch left to spend', async () => {
    await page.locator('#billCats li', { hasText: 'Rent' }).getByRole('button', { name: 'Mark paid' }).click();
    assert.strictEqual(await text('#statBills'), '£700 of £800');
    assert.strictEqual(await text('#leftBig'), '£551.70');
  });

  await check('overspending a category cuts the safety margin', async () => {
    await add('60', 'Uber');
    assert.strictEqual(await page.locator('#log .entry').first().locator('.what').innerText(), 'Transport · Debit');
    assert.match(await text('#dayCats'), /£10\.00 over/);
    assert.strictEqual(await text('#statMargin'), '£190.00');
    assert.ok(await page.locator('#summaryNote').isVisible());
  });

  await check('Copy totals gives one line per category in order', async () => {
    await page.click('#copyTotals');
    assert.strictEqual(await page.inputValue('#totalsOut'), '700\n100\n48.30\n60\n0\n0');
  });

  await check('editing and deleting an entry', async () => {
    await page.locator('#log .entry', { hasText: 'Uber' }).click();
    assert.strictEqual(await text('#formTitle'), 'Edit spending');
    await page.fill('#fAmount', '20');
    await page.click('#saveBtn');
    assert.strictEqual(await text('#leftBig'), '£531.70');
    await page.locator('#log .entry', { hasText: 'Uber' }).click();
    page.once('dialog', d => d.accept());
    await page.click('#deleteBtn');
    assert.strictEqual(await text('#leftBig'), '£551.70');
  });

  await check('tapping a category filters the log', async () => {
    await page.locator('#dayCats .cat-row', { hasText: 'Groceries' }).click();
    assert.strictEqual(await page.locator('#log .entry').count(), 1);
    await page.click('#filterChip');
    assert.strictEqual(await page.locator('#log .entry').count(), 2);
  });

  await check('renaming a category in Setup carries its spending across', async () => {
    await page.click('#openSetup');
    await page.locator('#catEdit li').nth(2).locator('.cn').fill('Food shopping');
    await page.click('#saveSetup');
    assert.match(await text('#dayCats'), /Food shopping[\s\S]*£351\.70 left/);
    assert.ok(!(await text('#dayCats')).includes('no longer in your budget'));
    await page.click('#openSetup');
    assert.ok(await page.locator('#sRuleAllow label', { hasText: 'Food shopping' }).locator('input').isChecked(), 'card rule tick lost on rename');
    await page.click('#closeSetup');
  });

  await check('scanning a receipt photo fills the form', async () => {
    const shot = await ctx.newPage();
    await shot.setViewportSize({ width: 380, height: 560 });
    await shot.setContent(`<body style="margin:0;background:#8a7f72;padding:20px">
      <div style="background:#fbfaf6;width:300px;padding:18px;font:15px/1.5 'Courier New',monospace;color:#222;transform:rotate(-2deg)">
      <div style="text-align:center;font-weight:bold;font-size:22px">ALDI</div>
      <div style="text-align:center">Store 123 Liverpool</div><br>
      <div style="display:flex;justify-content:space-between"><span>MILK 4 PINTS</span><span>1.45</span></div>
      <div style="display:flex;justify-content:space-between"><span>BANANAS</span><span>0.89</span></div>
      <div style="display:flex;justify-content:space-between"><span>CHICKEN THIGHS</span><span>4.29</span></div>
      <div style="display:flex;justify-content:space-between"><span>BREAD</span><span>4.35</span></div><br>
      <div style="display:flex;justify-content:space-between;font-weight:bold"><span>TOTAL</span><span>10.98</span></div>
      <div style="display:flex;justify-content:space-between"><span>CARD</span><span>10.98</span></div><br>
      <div>${ukToday} 14:02</div></div></body>`);
    const img = path.join(outDir, 'receipt.jpg');
    await shot.screenshot({ path: img, type: 'jpeg', quality: 60 });
    await shot.close();
    await page.setInputFiles('#scanInput', img);
    await page.waitForFunction(() => /Found|Could not|failed/.test(document.getElementById('scanStatus').textContent), null, { timeout: 90000 });
    assert.match(await text('#scanStatus'), /^Found/);
    assert.strictEqual(await page.inputValue('#fAmount'), '10.98');
    assert.strictEqual(await page.inputValue('#fMerchant'), 'Aldi');
    assert.strictEqual(await page.inputValue('#fDate'), today);
    assert.strictEqual(await page.inputValue('#fCategory'), 'Food shopping');
  });

  await check('backup and restore round trip', async () => {
    await page.click('#openSetup');
    const dl = page.waitForEvent('download');
    await page.click('#backupBtn');
    const file = path.join(outDir, 'backup.json');
    await (await dl).saveAs(file);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(data.items.length, 2);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.click('#openSetup').catch(() => {});
    page.once('dialog', d => d.accept());
    await page.setInputFiles('#restoreInput', file);
    await page.waitForFunction(() => document.getElementById('leftBig').textContent === '£551.70');
  });

  await check('service worker registers and the page fits a phone screen', async () => {
    await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true), null, { timeout: 15000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `page scrolls sideways by ${overflow}px`);
    await page.screenshot({ path: path.join(outDir, 'phone.png'), fullPage: true });
  });

  await check('no console errors', async () => {
    assert.deepStrictEqual(errors, []);
  });
} finally {
  await browser.close();
  server.close();
}
