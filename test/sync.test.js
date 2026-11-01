// Drive merge unit tests. Run: node test/sync.test.js
'use strict';
const assert = require('assert');
const { mergeData } = require('../sync.js');

const NOW = Date.UTC(2026, 10, 1);
const item = (id, updated, pence = 100) => ({ id, pence, date: '2026-11-01', category: 'Groceries', updated, created: updated });
const cfgA = { categories: [{ n: 'A', cap: 1 }] }, cfgB = { categories: [{ n: 'B', cap: 2 }] };
let passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('ok  ' + name); }
  catch (e) { console.error('FAIL ' + name + '\n     ' + e.message); process.exitCode = 1; }
}
const ids = d => d.items.map(x => x.id).sort().join(',');

t('no Drive file yet: upload local as is', () => {
  const m = mergeData({ items: [item('a', 1)], deleted: {}, config: cfgA, configUpdated: 5 }, null, NOW);
  assert.strictEqual(ids(m.data), 'a');
  assert.ok(m.changedRemote && !m.changedLocal);
});

t('entries from both sides are kept', () => {
  const m = mergeData({ items: [item('a', 1)], deleted: {} }, { items: [item('b', 2)], deleted: {} }, NOW);
  assert.strictEqual(ids(m.data), 'a,b');
  assert.ok(m.changedLocal && m.changedRemote);
});

t('newer edit wins in both directions', () => {
  let m = mergeData({ items: [item('a', 5, 999)] }, { items: [item('a', 3, 100)] }, NOW);
  assert.strictEqual(m.data.items[0].pence, 999);
  assert.ok(!m.changedLocal && m.changedRemote);
  m = mergeData({ items: [item('a', 3, 100)] }, { items: [item('a', 5, 999)] }, NOW);
  assert.strictEqual(m.data.items[0].pence, 999);
  assert.ok(m.changedLocal && !m.changedRemote);
});

t('deletion on one device removes it on the other', () => {
  const m = mergeData({ items: [item('a', NOW - 300)], deleted: {} }, { items: [], deleted: { a: NOW - 200 } }, NOW);
  assert.strictEqual(m.data.items.length, 0);
  assert.strictEqual(m.data.deleted.a, NOW - 200);
});

t('an edit made after a deletion brings the entry back', () => {
  const m = mergeData({ items: [item('a', NOW - 100)], deleted: {} }, { items: [], deleted: { a: NOW - 200 } }, NOW);
  assert.strictEqual(ids(m.data), 'a');
});

t('old deletion records are dropped after a year', () => {
  const m = mergeData({ items: [], deleted: { old: NOW - 400 * 86400000, recent: NOW - 86400000 } }, { items: [], deleted: {} }, NOW);
  assert.deepStrictEqual(Object.keys(m.data.deleted), ['recent']);
});

t('setup: the newer one wins, a never-saved one never overwrites', () => {
  let m = mergeData({ items: [], config: cfgA, configUpdated: 0 }, { items: [], config: cfgB, configUpdated: 7 }, NOW);
  assert.deepStrictEqual(m.data.config, cfgB);
  m = mergeData({ items: [], config: cfgA, configUpdated: 9 }, { items: [], config: cfgB, configUpdated: 7 }, NOW);
  assert.deepStrictEqual(m.data.config, cfgA);
});

t('nothing to do when both sides match', () => {
  const side = () => ({ items: [item('a', 1)], deleted: { z: NOW - 1000 }, config: cfgA, configUpdated: 3 });
  const m = mergeData(side(), side(), NOW);
  assert.ok(!m.changedLocal && !m.changedRemote);
});

console.log(`\n${passed} passed`);
