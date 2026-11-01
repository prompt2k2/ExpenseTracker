/* Receipt text parser. Turns OCR text into {pence, date, merchant, methodHint}.
   Works in the browser (window.ReceiptParse) and in Node (require('./parse.js')). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReceiptParse = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

  var BRANDS = [
    ['tesco', 'Tesco'], ['sainsbury', "Sainsbury's"], ['asda', 'Asda'], ['aldi', 'Aldi'], ['lidl', 'Lidl'],
    ['morrisons', 'Morrisons'], ['co-op', 'Co-op'], ['coop', 'Co-op'], ['iceland', 'Iceland'], ['costco', 'Costco'],
    ['waitrose', 'Waitrose'], ['marks & spencer', 'M&S'], ['marks and spencer', 'M&S'], ['m&s', 'M&S'],
    ['home bargains', 'Home Bargains'], ['b&m', 'B&M'], ['primark', 'Primark'], ['matalan', 'Matalan'],
    ['boots', 'Boots'], ['superdrug', 'Superdrug'], ['greggs', 'Greggs'], ["mcdonald", "McDonald's"], ['kfc', 'KFC'],
    ['burger king', 'Burger King'], ['domino', "Domino's"], ['subway', 'Subway'], ['nando', "Nando's"],
    ['costa', 'Costa'], ['starbucks', 'Starbucks'], ['pret', 'Pret'], ['uber eats', 'Uber Eats'], ['uber', 'Uber'],
    ['bolt', 'Bolt'], ['arriva', 'Arriva'], ['stagecoach', 'Stagecoach'], ['merseyrail', 'Merseyrail'],
    ['post office', 'Post Office'], ['argos', 'Argos'], ['tk maxx', 'TK Maxx'], ['poundland', 'Poundland'],
    ['farmfoods', 'Farmfoods'], ['heron', 'Heron Foods'], ['card factory', 'Card Factory'], ['smyths', 'Smyths'],
    ['odeon', 'Odeon'], ['cineworld', 'Cineworld'], ['specsavers', 'Specsavers'], ['dunelm', 'Dunelm'],
    ['the range', 'The Range'], ['wilko', 'Wilko'], ['next', 'Next'], ['ikea', 'IKEA'], ['spar', 'Spar'],
    ['one stop', 'One Stop'], ['shell', 'Shell'], ['esso', 'Esso']
  ];

  var TOTAL_RE = /\b(total|to\s*pay|amount\s*due|balance\s*due|amount\s*payable|you\s*pay)\b/i;
  var NOT_TOTAL_RE = /sub\s*-?\s*total|total\s*(items|qty|quantity|savings?|discount|vat|tax)|\bitems?\b|\bvat\b|\btax\b|sav(ed|ing|ings)|\bchange\b|discount|points|clubcard\s*points|\bqty\b/i;
  var CARD_RE = /\b(visa|mastercard|master\s*card|maestro|amex|american\s*express|debit|credit|contactless|card\s*(payment|sale)?)\b/i;
  var SKIP_FALLBACK_RE = /\b(cash|tendered|change|vat|savings?|points)\b/i;

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // All money amounts on a line, as integer pence, left to right.
  function amounts(line) {
    var out = [];
    var re = /(-?)£?\s?(\d{1,3}(?:,\d{3})+\.\d{2}|\d+[.,]\d{2})(?!\d)/g;
    var m;
    while ((m = re.exec(line))) {
      var raw = m[2];
      if (/,\d{3}/.test(raw) && raw.indexOf('.') > -1) raw = raw.replace(/,/g, '');
      else raw = raw.replace(',', '.');
      var p = Math.round(parseFloat(raw) * 100);
      if (!isNaN(p)) out.push(m[1] ? -p : p);
    }
    return out;
  }

  function lastPositive(line) {
    var a = amounts(line).filter(function (p) { return p > 0; });
    return a.length ? a[a.length - 1] : null;
  }

  function findTotal(lines) {
    var best = null;
    lines.forEach(function (l, i) {
      if (!TOTAL_RE.test(l) || NOT_TOTAL_RE.test(l)) return;
      var p = lastPositive(l);
      // "TOTAL" on its own line with the price on the next line
      if (p === null && lines[i + 1] && !/[a-z]{3}/i.test(lines[i + 1])) p = lastPositive(lines[i + 1]);
      if (p !== null && (best === null || p > best)) best = p;
    });
    if (best !== null) return best;

    lines.forEach(function (l) {
      if (!CARD_RE.test(l) || /\bcash\b|change/i.test(l)) return;
      var p = lastPositive(l);
      if (p !== null && (best === null || p > best)) best = p;
    });
    if (best !== null) return best;

    lines.forEach(function (l) {
      if (SKIP_FALLBACK_RE.test(l)) return;
      amounts(l).forEach(function (p) { if (p > 0 && (best === null || p > best)) best = p; });
    });
    return best;
  }

  function validDate(y, m, d, today) {
    if (y < 100) y += 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    var dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1) return null;
    var iso = y + '-' + pad(m) + '-' + pad(d);
    if (today) {
      var t = new Date(today + 'T00:00:00Z');
      var age = (t - dt) / 86400000;
      if (age < -1 || age > 400) return null;
    }
    return iso;
  }

  function findDate(text, today) {
    var m, re, iso;
    re = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g;
    while ((m = re.exec(text))) if ((iso = validDate(+m[1], +m[2], +m[3], today))) return iso;
    // UK order: day first
    re = /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})\b/g;
    while ((m = re.exec(text))) if ((iso = validDate(+m[3], +m[2], +m[1], today))) return iso;
    re = /\b(\d{1,2})(?:st|nd|rd|th)?[\s\-\/]*(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*[\s\-\/,]*(\d{4}|\d{2})\b/gi;
    while ((m = re.exec(text))) if ((iso = validDate(+m[3], MONTHS[m[2].toLowerCase()], +m[1], today))) return iso;
    re = /\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi;
    while ((m = re.exec(text))) if ((iso = validDate(+m[3], MONTHS[m[1].toLowerCase()], +m[2], today))) return iso;
    return null;
  }

  function titleCase(s) {
    return s.toLowerCase().replace(/(^|[\s&\-])([a-z])/g, function (m, a, c) { return a + c.toUpperCase(); });
  }

  function findMerchant(lines) {
    var head = lines.slice(0, 8).join('\n').toLowerCase();
    var all = lines.join('\n').toLowerCase();
    var i, b;
    for (i = 0; i < BRANDS.length; i++) {
      b = BRANDS[i][0];
      var re = new RegExp('(^|[^a-z])' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)');
      if (re.test(head)) return BRANDS[i][1];
    }
    for (i = 0; i < BRANDS.length; i++) {
      b = BRANDS[i][0];
      if (b.length > 4 && all.indexOf(b) > -1) return BRANDS[i][1];
    }
    for (i = 0; i < Math.min(lines.length, 6); i++) {
      var l = lines[i].trim();
      var letters = (l.match(/[a-z]/gi) || []).length;
      if (letters < 3 || letters / l.replace(/\s/g, '').length < 0.7) continue;
      if (/receipt|welcome|vat|tel|www|invoice|thank/i.test(l)) continue;
      return titleCase(l.replace(/[^a-z0-9&' \-]/gi, '').replace(/\s+/g, ' ').trim()).slice(0, 40);
    }
    return null;
  }

  function findMethod(text) {
    if (/american\s*express|\bamex\b/i.test(text)) return 'Amex';
    if (/\bcash\b/i.test(text) && /\bchange\b/i.test(text)) return 'Cash';
    return null;
  }

  function parseReceipt(text, today) {
    var lines = String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    return {
      pence: findTotal(lines),
      date: findDate(lines.join('\n'), today),
      merchant: findMerchant(lines),
      methodHint: findMethod(text)
    };
  }

  return { parseReceipt: parseReceipt, amounts: amounts };
});
