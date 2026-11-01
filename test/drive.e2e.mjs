// Google Drive sync test with a fake Google sign-in and a fake Drive. Two browser contexts act as two phones.
// Run: npm run e2e:drive
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
  '.webmanifest': 'application/manifest+json', '.gz': 'application/gzip' };
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

const SETUP = {
  categories: [{ n: 'Rent', cap: 700, fixed: true }, { n: 'Groceries', cap: 400 }, { n: 'Takeaways', cap: 60 }, { n: 'Unplanned', cap: 140 }],
  methods: ['Debit', 'Cash'], cardRule: null
};

// Fake Drive: one file, kept in memory.
const drive = { id: null, content: null, calls: 0 };
const GIS = `window.google = { accounts: { oauth2: {
  initTokenClient: function (c) { return { requestAccessToken: function () { setTimeout(function () { c.callback({ access_token: 'tok', expires_in: 3600 }); }, 30); } }; },
  revoke: function (t, cb) { if (cb) cb(); } } } };`;

async function fakeGoogle(ctx) {
  await ctx.route('https://accounts.google.com/gsi/client', r => r.fulfill({ contentType: 'text/javascript', body: GIS }));
  await ctx.route('https://www.googleapis.com/**', async route => {
    const req = route.request(), url = new URL(req.url());
    drive.calls++;
    if (process.env.TRACE) console.log("  >", req.method(), url.pathname);
    if (req.headers().authorization !== 'Bearer tok') return route.fulfill({ status: 401, body: '{}' });
    const json = b => route.fulfill({ contentType: 'application/json', body: JSON.stringify(b) });
    if (req.method() === 'GET' && url.pathname === '/drive/v3/files') return json({ files: drive.id ? [{ id: drive.id }] : [] });
    if (req.method() === 'GET' && url.pathname.startsWith('/drive/v3/files/')) {
      return drive.content ? route.fulfill({ contentType: 'application/json', body: drive.content }) : route.fulfill({ status: 404, body: '{}' });
    }
    if (req.method() === 'POST' && url.pathname === '/upload/drive/v3/files') {
      const parts = req.postData().split(/--spendlog\d+/);
      drive.id = 'file1';
      drive.content = parts[2].replace(/^\r\nContent-Type: application\/json\r\n\r\n/, '').replace(/\r\n$/, '');
      return json({ id: drive.id });
    }
    if (req.method() === 'PATCH' && url.pathname === '/upload/drive/v3/files/file1') { drive.content = req.postData(); return json({ id: 'file1' }); }
    return route.fulfill({ status: 400, body: '{}' });
  });
}
const onDrive = () => (drive.content ? JSON.parse(drive.content) : null);
async function waitDrive(pred, msg) {
  for (let i = 0; i < 100; i++) { const d = onDrive(); if (d && pred(d)) return d; await new Promise(r => setTimeout(r, 100)); }
  throw new Error('Drive never got: ' + msg);
}

const channel = process.env.BROWSER_CHANNEL ?? 'msedge';
const browser = await chromium.launch(channel ? { channel } : {});
const errors = [];
async function phone() {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, serviceWorkers: 'block' });
  await ctx.addInitScript(() => { window.SPENDLOG_CLIENT_ID = 'test-client'; });
  await fakeGoogle(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  if (process.env.TRACE) page.on('console', m => console.log('  console:', m.text()));
  page.on('dialog', d => d.accept());
  await page.goto(base);
  return { ctx, page };
}
const synced = page => page.waitForFunction(() => /Saved to Google Drive/.test(document.getElementById('syncText').textContent));
async function add(page, amount, merchant, category) {
  await page.fill('#fAmount', amount);
  await page.fill('#fMerchant', merchant);
  await page.selectOption('#fCategory', category);
  await page.click('#saveBtn');
}

let step = 0, A, B;
async function check(name, fn) {
  step++;
  try { await fn(); console.log(`ok  ${step}. ${name}`); }
  catch (e) {
    console.error(`FAIL ${step}. ${name}\n     ${e.message}`);
    for (const d of [A, B]) if (d) console.error('     sync status: ' + await d.page.locator('#syncText').innerText().catch(() => '?'));
    for (const [n, d] of [['a', A], ['b', B]]) if (d) await d.page.screenshot({ path: path.join(outDir, `drive-fail-${step}-${n}.png`), fullPage: true }).catch(() => {});
    process.exitCode = 1;
  }
}

try {
  A = await phone();

  await check('phone A: Connect uploads setup and entries to Drive', async () => {
    await A.page.fill('#sPaste', JSON.stringify(SETUP));
    await A.page.click('#applyPaste');
    await add(A.page, '12', 'Tesco', 'Groceries');
    await A.page.click('#openSetup');
    assert.ok(await A.page.locator('#driveSetup').isVisible());
    await A.page.click('#driveConnect');
    await synced(A.page);
    const d = await waitDrive(d => d.items.length === 1, 'first upload');
    assert.strictEqual(d.config.categories.length, 4);
  });

  await check('phone A: a new entry goes up on its own', async () => {
    await A.page.click('#closeSetup');
    await add(A.page, '20', 'Asda', 'Groceries');
    await waitDrive(d => d.items.length === 2, 'second entry');
    await synced(A.page);
  });

  await check('phone B (empty): Connect brings back the setup and entries', async () => {
    B = await phone();
    assert.ok(await B.page.locator('#setup').isVisible());
    await B.page.click('#driveConnect');
    await synced(B.page);
    await B.page.waitForFunction(() => document.getElementById('leftBig').textContent === '£568.00');
    assert.ok(!(await B.page.locator('#setup').isVisible()), 'setup should close once data arrives');
  });

  await check('an entry added on B appears on A when A is opened', async () => {
    await add(B.page, '5', 'Greggs', 'Takeaways');
    await waitDrive(d => d.items.length === 3, 'entry from B');
    await A.page.reload();
    await A.page.waitForFunction(() => document.getElementById('leftBig').textContent === '£563.00');
  });

  await check('a deletion on A reaches B', async () => {
    await A.page.locator('#log .entry', { hasText: 'Greggs' }).click();
    await A.page.click('#deleteBtn');
    await waitDrive(d => d.items.length === 2 && Object.keys(d.deleted).length === 1, 'deletion');
    await B.page.reload();
    await B.page.waitForFunction(() => document.getElementById('leftBig').textContent === '£568.00');
  });

  await check('expired sign-in: entries still save, Reconnect sends them', async () => {
    await A.page.evaluate(() => {
      const t = JSON.parse(localStorage.getItem('spendlog.drive.token')); t.exp = 1;
      localStorage.setItem('spendlog.drive.token', JSON.stringify(t));
    });
    await A.page.reload();
    assert.ok(await A.page.locator('#syncReconnect').isVisible());
    await add(A.page, '7.50', 'Lidl', 'Groceries');
    assert.strictEqual(await A.page.locator('#leftBig').innerText(), '£560.50');
    assert.strictEqual(onDrive().items.length, 2);
    await A.page.click('#syncReconnect');
    await synced(A.page);
    await waitDrive(d => d.items.length === 3, 'entry saved while signed out');
  });

  await check('offline: entries wait, then go up when back online', async () => {
    await A.ctx.setOffline(true);
    await A.page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await add(A.page, '3', 'Spar', 'Unplanned');
    await A.page.waitForFunction(() => /Offline/.test(document.getElementById('syncText').textContent));
    assert.strictEqual(onDrive().items.length, 3);
    await A.ctx.setOffline(false);
    await A.page.evaluate(() => window.dispatchEvent(new Event('online')));
    await waitDrive(d => d.items.length === 4, 'entry saved offline');
  });

  await check('a setup change on A reaches B', async () => {
    await A.page.click('#openSetup');
    await A.page.locator('#catEdit li').nth(1).locator('.cc').fill('500');
    await A.page.click('#saveSetup');
    await waitDrive(d => d.config.categories[1].cap === 500, 'setup change');
    await B.page.reload();
    await B.page.waitForFunction(() => document.getElementById('statBudget').textContent === '£700');
  });

  await check('Disconnect stops syncing and keeps the data on the phone', async () => {
    await B.page.click('#openSetup');
    await B.page.click('#driveDisconnect');
    assert.ok(await B.page.locator('#driveConnect').isVisible());
    assert.ok(!(await B.page.locator('#syncLine').isVisible()));
    const before = drive.calls;
    await B.page.click('#closeSetup');
    await add(B.page, '1', 'Shop', 'Unplanned');
    await new Promise(r => setTimeout(r, 2500));
    assert.strictEqual(drive.calls, before);
    await B.page.screenshot({ path: path.join(outDir, 'drive-phone.png') });
  });

  await check('no page errors', async () => assert.deepStrictEqual(errors, []));
} finally {
  await browser.close();
  server.close();
}
