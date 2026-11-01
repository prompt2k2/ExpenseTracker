// Parser unit tests. Run: node test/parse.test.js
'use strict';
const assert = require('assert');
const { parseReceipt, amounts } = require('../parse.js');

const TODAY = '2026-11-01';
let passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('ok  ' + name); }
  catch (e) { console.error('FAIL ' + name + '\n     ' + e.message); process.exitCode = 1; }
}

t('total to pay beats subtotal and savings', () => {
  const r = parseReceipt(`TESCO EXTRA
Liverpool
MILK 2L          1.65
BREAD            1.10
SUBTOTAL        12.75
TOTAL SAVINGS   -1.20
TOTAL TO PAY    11.55
VISA CONTACTLESS 11.55
31/10/2026 14:22`, TODAY);
  assert.strictEqual(r.pence, 1155);
  assert.strictEqual(r.merchant, 'Tesco');
  assert.strictEqual(r.date, '2026-10-31');
});

t('thousands separator', () => {
  assert.strictEqual(parseReceipt('COSTCO\nTOTAL £1,204.50\n', TODAY).pence, 120450);
});

t('comma decimals', () => {
  assert.deepStrictEqual(amounts('Brot 2,49  Summe 12,30'), [249, 1230]);
});

t('day-first dates', () => {
  assert.strictEqual(parseReceipt('ALDI\n05/10/26\nTOTAL 3.00', TODAY).date, '2026-10-05');
});

t('text-month dates', () => {
  assert.strictEqual(parseReceipt('BOOTS\n28 Oct 2026\nTOTAL 6.49', TODAY).date, '2026-10-28');
  assert.strictEqual(parseReceipt('Shop\nOct 3, 2026\nTOTAL 6.49', TODAY).date, '2026-10-03');
});

t('rejects future and very old dates', () => {
  assert.strictEqual(parseReceipt('X\n12/12/2026\nTOTAL 1.00', TODAY).date, null);
  assert.strictEqual(parseReceipt('X\n01/01/2019\nTOTAL 1.00', TODAY).date, null);
});

t('cash with change uses total, flags cash', () => {
  const r = parseReceipt('GREGGS\nSAUSAGE ROLL 1.25\nTOTAL 3.40\nCASH 10.00\nCHANGE 6.60', TODAY);
  assert.strictEqual(r.pence, 340);
  assert.strictEqual(r.methodHint, 'Cash');
});

t('amex detected', () => {
  assert.strictEqual(parseReceipt('SAINSBURYS\nAMERICAN EXPRESS\nAMOUNT DUE 22.10', TODAY).methodHint, 'Amex');
});

t('ignores total items count', () => {
  assert.strictEqual(parseReceipt('LIDL\nTOTAL ITEMS 4\nTOTAL 9.87', TODAY).pence, 987);
});

t('falls back to card line, then largest amount', () => {
  assert.strictEqual(parseReceipt('Corner Shop\nCrisps 0.99\nDrink 1.20\nDEBIT CARD 2.19', TODAY).pence, 219);
  assert.strictEqual(parseReceipt('Corner Shop\nCrisps 0.99\nDrink 1.20', TODAY).pence, 120);
});

t('price on the line after TOTAL', () => {
  assert.strictEqual(parseReceipt('MORRISONS\nTOTAL\n£14.20', TODAY).pence, 1420);
});

t('unknown shop uses first clean line', () => {
  assert.strictEqual(parseReceipt("joe's hardware\n12 High St\nTOTAL 5.00", TODAY).merchant, "Joe's Hardware");
});

t('empty text', () => {
  assert.deepStrictEqual(parseReceipt('', TODAY), { pence: null, date: null, merchant: null, methodHint: null });
});

console.log(`\n${passed} passed`);
