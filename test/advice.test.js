// Advice rule tests. Run: node test/advice.test.js
'use strict';
const assert = require('assert');
const { advise, afterSave } = require('../advice.js');

const CONFIG = {
  income: 2000, savings: 400,
  categories: [
    { n: 'Rent', cap: 700, fixed: true }, { n: 'Groceries', cap: 400 }, { n: 'Takeaways', cap: 60 },
    { n: 'Health', cap: 40 }, { n: 'Transport', cap: 50 }, { n: 'Unplanned', cap: 150 }
  ]
};
let n = 0;
const it = (date, pounds, category, merchant = '') => ({ id: 'i' + (n++), date, pence: Math.round(pounds * 100), category, merchant });
const keys = list => list.map(a => a.key);
let passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('ok  ' + name); }
  catch (e) { console.error('FAIL ' + name + '\n     ' + e.message); process.exitCode = 1; }
}

t('nothing to say with no spending', () => {
  assert.deepStrictEqual(advise(CONFIG, [], '2026-11-15'), []);
});

t('over budget this month', () => {
  const a = advise(CONFIG, [it('2026-11-03', 72, 'Takeaways')], '2026-11-10');
  assert.deepStrictEqual(keys(a), ['over:Takeaways']);
  assert.match(a[0].title, /£12 over/);
  assert.strictEqual(a[0].label, 'Over budget');
});

t('heading over at the current pace', () => {
  // £45 of £60 by day 10 of 30: on pace for £135
  const a = advise(CONFIG, [it('2026-11-05', 45, 'Takeaways')], '2026-11-10');
  assert.deepStrictEqual(keys(a), ['pace:Takeaways']);
  assert.match(a[0].text, /about £135, £75 over/);
});

t('no pace warning in the first week (one big shop is normal)', () => {
  assert.deepStrictEqual(advise(CONFIG, [it('2026-11-02', 250, 'Groceries')], '2026-11-05'), []);
});

t('over two months running suggests raising the cap, with the margin effect', () => {
  const items = [it('2026-09-10', 80, 'Takeaways'), it('2026-10-10', 90, 'Takeaways')];
  const a = advise(CONFIG, items, '2026-11-02');
  const r = a.find(x => x.key === 'raise:Takeaways');
  assert.ok(r, keys(a).join());
  assert.strictEqual(r.action.cap, 85);
  assert.match(r.text, /Sep and Oct \(£80 and £90\)/);
  assert.match(r.text, /safety margin of £175/); // margin 2000-400-1400 = 200, less the £25 rise
});

t('a raise is based on the months that went over, never below the cap', () => {
  const items = [it('2026-08-05', 300, 'Groceries'), it('2026-09-05', 520, 'Groceries'), it('2026-10-05', 470, 'Groceries')];
  const r = advise(CONFIG, items, '2026-11-02').find(x => x.key === 'raise:Groceries');
  assert.strictEqual(r.action.cap, 495);
  const small = advise(CONFIG, [it('2026-09-05', 401, 'Groceries'), it('2026-10-05', 401, 'Groceries')], '2026-11-02').find(x => x.key === 'raise:Groceries');
  assert.ok(small.action.cap > 400, 'raise must be above the current cap');
});

t('raising past the margin is flagged', () => {
  const items = [it('2026-09-10', 400, 'Transport'), it('2026-10-10', 400, 'Transport')];
  const r = advise(CONFIG, items, '2026-11-02').find(x => x.key === 'raise:Transport');
  assert.match(r.text, /£150 past your safety margin/);
});

t('three months well under suggests lowering the cap', () => {
  const items = ['09', '10', '11'].map(m => it(`2026-${m}-05`, 10, 'Health'));
  const a = advise(CONFIG, items, '2026-12-02');
  const s = a.find(x => x.key === 'lower:Health');
  assert.ok(s, keys(a).join());
  assert.strictEqual(s.action.cap, 15);
  assert.match(s.text, /move £25 a month to savings/);
});

t('months before you started logging are not counted as underspends', () => {
  const a = advise(CONFIG, [it('2026-11-05', 10, 'Health')], '2026-12-02');
  assert.ok(!keys(a).some(k => k.startsWith('lower:')), keys(a).join());
});

t('rising three months running', () => {
  const items = [it('2026-08-05', 200, 'Groceries'), it('2026-09-05', 260, 'Groceries'), it('2026-10-05', 330, 'Groceries')];
  assert.ok(keys(advise(CONFIG, items, '2026-11-02')).includes('rise:Groceries'));
});

t('a shop well above its usual spend', () => {
  const items = [it('2026-09-05', 20, 'Transport', 'Uber'), it('2026-10-05', 20, 'Transport', 'Uber'), it('2026-11-05', 45, 'Transport', 'uber')];
  const s = advise(CONFIG, items, '2026-11-08').find(x => x.level === 'spike');
  assert.ok(s);
  assert.strictEqual(s.title, 'uber: £45 so far this month');
  assert.match(s.text, /usually spend about £20/);
});

t('fixed bills get no advice', () => {
  const items = [it('2026-09-05', 800, 'Rent'), it('2026-10-05', 800, 'Rent'), it('2026-11-05', 800, 'Rent')];
  assert.deepStrictEqual(advise(CONFIG, items, '2026-11-08'), []);
});

t('most urgent first', () => {
  const items = [it('2026-09-10', 80, 'Takeaways'), it('2026-10-10', 90, 'Takeaways'), it('2026-11-03', 70, 'Takeaways')];
  assert.deepStrictEqual(keys(advise(CONFIG, items, '2026-11-10')), ['over:Takeaways', 'raise:Takeaways']);
});

t('a regular big shop early in the month is not a false alarm', () => {
  // A Costco trip on the 2nd every month, then top-ups: £260 by the 14th is normal.
  const items = ['08', '09', '10'].flatMap(m => [it(`2026-${m}-02`, 260, 'Groceries'), it(`2026-${m}-20`, 130, 'Groceries')]);
  items.push(it('2026-11-02', 260, 'Groceries'));
  assert.ok(!keys(advise(CONFIG, items, '2026-11-14')).includes('pace:Groceries'));
});

t('with history, a real overspend by this point is still caught', () => {
  const items = ['08', '09', '10'].flatMap(m => [it(`2026-${m}-02`, 150, 'Groceries'), it(`2026-${m}-20`, 230, 'Groceries')]);
  items.push(it('2026-11-02', 260, 'Groceries'));
  const p = advise(CONFIG, items, '2026-11-14').find(a => a.key === 'pace:Groceries');
  assert.ok(p, 'expected a pace warning');
  assert.strictEqual(p.projected, 65900); // £260 against a usual £150 by now, on a usual £380 month
  assert.match(p.text, /usually spend about £150, so you are on course for about £659, £259 over/);
});

t('categories with empty months are never told to cut', () => {
  const items = [it('2026-09-05', 10, 'Health'), it('2026-11-05', 10, 'Health')];
  assert.ok(!keys(advise(CONFIG, items, '2026-12-02')).some(k => k.startsWith('lower:')));
});

t('message after saving', () => {
  assert.strictEqual(afterSave(6000, 2000, 0), ' £40 left.');
  assert.match(afterSave(6000, 5000, 0), /Only £10 left \(83% used\)/);
  assert.match(afterSave(6000, 4500, 13500), /on course to go about £75 over/);
  assert.match(afterSave(6000, 7000, 0), /now £10 over budget/);
});

console.log(`\n${passed} passed`);
