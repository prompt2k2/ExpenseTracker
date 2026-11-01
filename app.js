/* Spend Log: log spending against monthly budget caps and see what is left.
   Everything is stored in localStorage on this device. Money is integer pence. */
(function () {
  'use strict';

  var KEY_ITEMS = 'spendlog.items.v1';
  var KEY_CONFIG = 'spendlog.config.v1';
  var KEY_METHOD = 'spendlog.method';
  var KEY_PERSIST = 'spendlog.persistAsked';
  var KEY_DELETED = 'spendlog.deleted.v1';
  var KEY_CFGTIME = 'spendlog.configUpdated';

  // Generic starter budget. Personal figures are pasted in through Setup, never stored in the code.
  var STARTER = {
    income: null,
    savings: null,
    categories: [
      { n: 'Housing', cap: 800, fixed: true },
      { n: 'Energy', cap: 120, fixed: true },
      { n: 'Phone & internet', cap: 40, fixed: true },
      { n: 'Subscriptions', cap: 20, fixed: true },
      { n: 'Groceries', cap: 400 },
      { n: 'Transport', cap: 60 },
      { n: 'Takeaways & eating out', cap: 60 },
      { n: 'Clothing & household', cap: 80 },
      { n: 'Health & personal care', cap: 20 },
      { n: 'Leisure', cap: 60 },
      { n: 'Unplanned', cap: 100 }
    ],
    methods: ['Debit card', 'Credit card', 'Cash'],
    cardRule: null
  };

  // Shop name pattern -> category name pattern. The first category whose name matches wins.
  var CLASSES = [
    [/uber\s?eats|deliveroo|just\s?eat|mcdonald|kfc|burger king|greggs|domino|pizza|nando|subway|costa|starbucks|pret\b|restaurant|caf[eé]|chippy|kebab|wagamama|five guys|takeaway/i, /takeaway|eating out|restaurant|dining/i],
    [/tesco|sainsbury|asda|aldi|lidl|morrison|co-?op|iceland|costco|waitrose|m&s|farmfoods|heron|spar\b|one stop|nisa|budgens|ocado|grocer|supermarket|butcher/i, /grocer|food shop|supermarket/i],
    [/\buber\b|\bbolt\b|arriva|stagecoach|merseyrail|trainline|northern rail|avanti|national express|taxi|\bbus\b|railway|petrol|\bshell\b|\bbp\b|esso|texaco|parking/i, /transport|travel|ride/i],
    [/primark|matalan|\bnext\b|tk\s?maxx|h&m|zara|b&m|home bargains|poundland|wilko|argos|ikea|dunelm|the range|clothing|asos|shein|shoe/i, /cloth|household|home/i],
    [/boots|superdrug|pharmacy|chemist|specsavers|dentist|optician|barber|hair/i, /health|personal care|pharmacy/i],
    [/netflix|spotify|prime video|disney|apple\.com|youtube|claude|anthropic|paramount|now tv/i, /subscri/i],
    [/\bee\b|lebara|vodafone|\bo2\b|giffgaff|\bthree\b|sky mobile/i, /phone|mobile/i],
    [/odeon|cineworld|\bvue\b|cinema|museum|\bzoo\b|theatre|ticketmaster|bowling|soft play|trampoline/i, /leisure|holiday|entertainment|fun/i],
    [/card factory|clintons|hobbycraft|smyths|toy|gift/i, /gift|christmas/i],
    [/lemfi|western union|remitly|wise\b|worldremit/i, /family|support|remit/i],
    [/school|lunch|parentpay/i, /school|lunch/i],
    [/post office|cash machine|atm/i, /buffer|unplanned|other|misc/i]
  ];

  // ---------- helpers ----------
  function $(id) { return document.getElementById(id); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function todayISO() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function monthOf(iso) { return iso.slice(0, 7); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  var GBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
  var GBP0 = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0, minimumFractionDigits: 0 });
  function money(p) { return GBP.format(p / 100); }
  function moneyShort(p) { return p % 100 === 0 ? GBP0.format(p / 100) : GBP.format(p / 100); }
  function toPence(s) {
    if (s === null || s === undefined) return null;
    s = String(s).replace(/[£\s]/g, '');
    if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
    s = s.replace(/,/g, '');
    if (!/^-?\d*\.?\d+$/.test(s)) return null;
    return Math.round(parseFloat(s) * 100);
  }
  function capPence(c) { return Math.round((+c.cap || 0) * 100); }
  function monthLabel(m) {
    var p = m.split('-');
    return new Date(+p[0], +p[1] - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }
  function shiftMonth(m, by) {
    var p = m.split('-'), d = new Date(+p[0], +p[1] - 1 + by, 1);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1);
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function store(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { toast('Could not save. Storage may be full or blocked.'); return false; }
  }
  var toastTimer;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2800);
  }

  // ---------- state ----------
  var savedConfig = load(KEY_CONFIG, null);
  var config = normaliseConfig(savedConfig || STARTER);
  var items = load(KEY_ITEMS, []);
  if (!Array.isArray(items)) items = [];
  var deleted = load(KEY_DELETED, {}); // id -> time deleted, so Drive sync can pass deletions on
  var viewMonth = monthOf(todayISO());
  var editingId = null;
  var filterCat = null;
  var categoryTouched = false;

  function normaliseConfig(c) {
    c = c || {};
    var cats = Array.isArray(c.categories) ? c.categories : [];
    cats = cats.filter(function (x) { return x && String(x.n || '').trim(); }).map(function (x) {
      return { n: String(x.n).trim(), cap: Math.max(0, +x.cap || 0), fixed: !!x.fixed };
    });
    var methods = (Array.isArray(c.methods) ? c.methods : []).map(function (m) { return String(m).trim(); }).filter(Boolean);
    if (!methods.length) methods = ['Debit card', 'Cash'];
    var rule = null;
    if (c.cardRule && c.cardRule.card) {
      rule = {
        card: String(c.cardRule.card),
        allow: Array.isArray(c.cardRule.allow) ? c.cardRule.allow.map(String) : [],
        text: String(c.cardRule.text || '')
      };
    }
    var num = function (v) { return v === null || v === undefined || v === '' || isNaN(+v) ? null : +v; };
    return { income: num(c.income), savings: num(c.savings), categories: cats, methods: methods, cardRule: rule };
  }
  function saveItems() {
    var ok = store(KEY_ITEMS, items) && store(KEY_DELETED, deleted);
    askPersist();
    if (ok) drive.changed();
    return ok;
  }
  function saveConfig() {
    var ok = store(KEY_CONFIG, config) && store(KEY_CFGTIME, Date.now());
    if (ok) drive.changed();
    return ok;
  }
  function askPersist() {
    if (load(KEY_PERSIST, false)) return;
    store(KEY_PERSIST, true);
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
  }

  // ---------- budget maths ----------
  function monthSummary(m) {
    var monthItems = items.filter(function (x) { return monthOf(x.date) === m; });
    var byCat = {};
    monthItems.forEach(function (x) { byCat[x.category] = (byCat[x.category] || 0) + x.pence; });
    var known = {};
    var rows = config.categories.map(function (c) {
      known[c.n] = true;
      var cap = capPence(c), spent = byCat[c.n] || 0;
      return { n: c.n, fixed: c.fixed, cap: cap, spent: spent, left: cap - spent };
    });
    var others = Object.keys(byCat).filter(function (k) { return !known[k]; })
      .map(function (k) { return { n: k, spent: byCat[k] }; });
    var s = { rows: rows, others: others, items: monthItems,
      dayCap: 0, daySpent: 0, billCap: 0, billPaid: 0, billDue: 0, otherSpent: 0, capTotal: 0, committed: 0 };
    rows.forEach(function (r) {
      s.capTotal += r.cap;
      s.committed += Math.max(r.cap, r.spent);
      if (r.fixed) { s.billCap += r.cap; s.billPaid += r.spent; s.billDue += Math.max(0, r.cap - r.spent); }
      else { s.dayCap += r.cap; s.daySpent += r.spent; }
    });
    others.forEach(function (o) { s.otherSpent += o.spent; });
    // Spending under removed or renamed categories still counts against day-to-day money.
    s.daySpent += s.otherSpent;
    s.committed += s.otherSpent;
    s.dayLeft = s.dayCap - s.daySpent;
    if (config.income !== null) {
      s.margin = Math.round(config.income * 100) - Math.round((config.savings || 0) * 100) - s.committed;
      s.plannedMargin = Math.round(config.income * 100) - Math.round((config.savings || 0) * 100) - s.capTotal;
    }
    return s;
  }

  // Share of the month gone (0..1) for the viewed month, or null if not the current month.
  function monthPace(m) {
    var t = todayISO();
    if (monthOf(t) !== m) return null;
    var p = m.split('-'), days = new Date(+p[0], +p[1], 0).getDate(), d = +t.slice(8, 10);
    return { frac: d / days, daysLeft: days - d + 1, days: days };
  }

  function barState(spent, cap, pace) {
    if (cap <= 0) return spent > 0 ? 'over' : '';
    if (spent > cap) return 'over';
    if (pace && spent / cap > pace.frac + 0.1) return 'warn';
    return '';
  }

  // ---------- rendering ----------
  function render() {
    $('monthLabel').textContent = monthLabel(viewMonth);
    $('nextMonth').disabled = viewMonth >= monthOf(todayISO());
    var s = monthSummary(viewMonth);
    var pace = monthPace(viewMonth);
    renderSummary(s, pace);
    renderDayCats(s, pace);
    renderBills(s);
    renderLog(s);
    $('totalsOut').hidden = true;
  }

  function renderSummary(s, pace) {
    var big = $('leftBig');
    big.textContent = s.dayLeft < 0 ? '−' + money(-s.dayLeft) : money(s.dayLeft);
    big.classList.toggle('over', s.dayLeft < 0);
    var bar = $('leftBar');
    bar.style.width = (s.dayCap > 0 ? Math.min(100, s.daySpent / s.dayCap * 100) : 0) + '%';
    bar.className = barState(s.daySpent, s.dayCap, pace);
    var mark = $('leftPace');
    mark.hidden = !pace;
    if (pace) mark.style.left = (pace.frac * 100) + '%';

    var sub;
    if (s.dayLeft < 0) sub = 'You are ' + money(-s.dayLeft) + ' over the day-to-day budget.';
    else if (pace) {
      var perDay = Math.floor(s.dayLeft / pace.daysLeft);
      sub = 'About ' + money(perDay) + ' a day (' + money(perDay * 7) + ' a week) for the ' + pace.daysLeft + ' day' + (pace.daysLeft === 1 ? '' : 's') + ' left, including today.';
    } else if (viewMonth < monthOf(todayISO())) sub = s.dayLeft > 0 ? money(s.dayLeft) + ' was left unspent. Move it to savings.' : 'Finished exactly on budget.';
    else sub = 'This month has not started yet.';
    $('leftSub').textContent = sub;

    $('statBudget').textContent = moneyShort(s.dayCap);
    $('statSpent').textContent = money(s.daySpent);
    $('statBills').textContent = moneyShort(s.billPaid) + ' of ' + moneyShort(s.billCap);
    var mw = $('marginWrap');
    mw.hidden = s.margin === undefined;
    if (s.margin !== undefined) {
      $('statMargin').textContent = s.margin < 0 ? '−' + money(-s.margin) : money(s.margin);
      $('statMargin').classList.toggle('bad', s.margin < 0);
    }
    var note = $('summaryNote'), msgs = [];
    if (s.plannedMargin !== undefined && s.plannedMargin < 0) msgs.push('Your caps plus savings are more than your income. Lower some caps in Setup.');
    else if (s.margin !== undefined && s.margin < s.plannedMargin) {
      msgs.push(s.margin < 0
        ? 'Overspending has used up the safety margin. Savings are at risk this month.'
        : 'Overspending has cut the safety margin from ' + money(s.plannedMargin) + ' to ' + money(s.margin) + '.');
    }
    note.textContent = msgs.join(' ');
    note.hidden = !msgs.length;
  }

  function catButton(r, pace, metaText) {
    var b = el('button', 'cat-row' + (filterCat === r.n ? ' active' : ''));
    b.type = 'button';
    var top = el('div', 'cat-top');
    top.appendChild(el('span', 'cat-name', r.n));
    var left = r.cap - r.spent;
    top.appendChild(el('span', 'cat-left' + (left < 0 ? ' over' : ''), left < 0 ? money(-left) + ' over' : money(left) + ' left'));
    b.appendChild(top);
    var bar = el('div', 'bar');
    var fill = el('span', barState(r.spent, r.cap, pace));
    fill.style.width = (r.cap > 0 ? Math.min(100, r.spent / r.cap * 100) : (r.spent > 0 ? 100 : 0)) + '%';
    bar.appendChild(fill);
    if (pace) { var m = el('i'); m.style.left = (pace.frac * 100) + '%'; bar.appendChild(m); }
    b.appendChild(bar);
    b.appendChild(el('div', 'cat-meta', metaText || (money(r.spent) + ' of ' + moneyShort(r.cap))));
    b.addEventListener('click', function () { setFilter(filterCat === r.n ? null : r.n); });
    return b;
  }

  function renderDayCats(s, pace) {
    var ul = $('dayCats');
    ul.textContent = '';
    s.rows.forEach(function (r) {
      if (r.fixed) return;
      var li = el('li');
      var meta = money(r.spent) + ' of ' + moneyShort(r.cap);
      if (pace && r.left > 0) meta += ' · about ' + money(Math.floor(r.left / pace.daysLeft * 7)) + ' a week left';
      li.appendChild(catButton(r, pace, meta));
      ul.appendChild(li);
    });
    if (s.others.length) {
      s.others.forEach(function (o) {
        var li = el('li');
        li.appendChild(catButton({ n: o.n, cap: 0, spent: o.spent }, null, money(o.spent) + ' · category no longer in your budget'));
        ul.appendChild(li);
      });
    }
  }

  function renderBills(s) {
    var ul = $('billCats');
    ul.textContent = '';
    var bills = s.rows.filter(function (r) { return r.fixed; });
    $('billsSub').textContent = bills.length
      ? moneyShort(s.billPaid) + ' paid, ' + money(s.billDue) + ' still to go out. Bills are not taken from left to spend.'
      : 'No fixed bills. Tick “Bill” on a category in Setup to track it here.';
    bills.forEach(function (r) {
      var li = el('li');
      var row = el('div', 'bill-row');
      var grow = el('button', 'cat-row grow' + (filterCat === r.n ? ' active' : ''));
      grow.type = 'button';
      grow.appendChild(el('div', 'cat-name', r.n));
      grow.appendChild(el('div', 'cat-meta', 'Budget ' + moneyShort(r.cap) + (r.spent && r.spent !== r.cap ? ' · logged ' + money(r.spent) : '')));
      grow.addEventListener('click', function () { setFilter(filterCat === r.n ? null : r.n); });
      row.appendChild(grow);
      if (r.spent > 0) {
        row.appendChild(el('span', 'paid', r.spent > r.cap ? '✓ ' + money(r.spent - r.cap) + ' over' : '✓ Paid'));
      } else {
        var btn = el('button', 'btn small', 'Mark paid');
        btn.type = 'button';
        btn.addEventListener('click', function () { markPaid(r); });
        row.appendChild(btn);
      }
      li.appendChild(row);
      ul.appendChild(li);
    });
  }

  function renderLog(s) {
    var ul = $('log');
    ul.textContent = '';
    var list = s.items.filter(function (x) { return !filterCat || x.category === filterCat; })
      .sort(function (a, b) { return a.date === b.date ? b.created - a.created : (a.date < b.date ? 1 : -1); });
    var chip = $('filterChip');
    chip.hidden = !filterCat;
    if (filterCat) {
      var tot = list.reduce(function (a, x) { return a + x.pence; }, 0);
      chip.textContent = filterCat + ' · ' + money(tot) + '  ✕';
    }
    var lastDate = null;
    list.forEach(function (x) {
      if (x.date !== lastDate) {
        lastDate = x.date;
        var d = new Date(x.date + 'T12:00:00');
        ul.appendChild(el('li', 'day', d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })));
      }
      var li = el('li');
      var b = el('button', 'entry');
      b.type = 'button';
      var g = el('div', 'grow');
      g.appendChild(el('div', 'who', x.merchant || x.category));
      g.appendChild(el('div', 'what', [x.category, x.method, x.note].filter(Boolean).join(' · ')));
      b.appendChild(g);
      b.appendChild(el('span', 'amt', money(x.pence)));
      b.addEventListener('click', function () { startEdit(x.id); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    $('logEmpty').hidden = list.length > 0;
    $('logEmpty').textContent = filterCat ? 'Nothing logged under ' + filterCat + ' this month.' : 'Nothing logged this month yet.';
  }

  function setFilter(n) {
    filterCat = n;
    render();
    if (n) $('log').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- form ----------
  function fillSelects() {
    var sel = $('fCategory'), cur = sel.value;
    sel.textContent = '';
    var day = el('optgroup'); day.label = 'Day-to-day';
    var bills = el('optgroup'); bills.label = 'Fixed bills';
    config.categories.forEach(function (c) {
      var o = el('option', null, c.n); o.value = c.n;
      (c.fixed ? bills : day).appendChild(o);
    });
    if (day.children.length) sel.appendChild(day);
    if (bills.children.length) sel.appendChild(bills);
    if (cur && config.categories.some(function (c) { return c.n === cur; })) sel.value = cur;

    var ms = $('fMethod'), curM = ms.value || load(KEY_METHOD, null);
    ms.textContent = '';
    config.methods.forEach(function (m) { var o = el('option', null, m); o.value = m; ms.appendChild(o); });
    if (curM && config.methods.indexOf(curM) > -1) ms.value = curM;

    var dl = $('merchantList');
    dl.textContent = '';
    var seen = {};
    items.slice().sort(function (a, b) { return b.created - a.created; }).forEach(function (x) {
      var k = (x.merchant || '').toLowerCase();
      if (!k || seen[k]) return;
      seen[k] = true;
      if (dl.children.length < 60) { var o = el('option'); o.value = x.merchant; dl.appendChild(o); }
    });
  }

  function guessCategory(merchant) {
    var m = String(merchant || '').trim().toLowerCase();
    if (!m) return null;
    var names = config.categories.map(function (c) { return c.n; });
    // 1. What you chose last time for this shop
    var past = items.slice().sort(function (a, b) { return b.created - a.created; })
      .find(function (x) { return (x.merchant || '').toLowerCase() === m && names.indexOf(x.category) > -1; });
    if (past) return { n: past.category, why: 'Same as last time at ' + past.merchant + '.' };
    // 2. Shop name patterns
    for (var i = 0; i < CLASSES.length; i++) {
      if (!CLASSES[i][0].test(m)) continue;
      var hit = names.find(function (n) { return CLASSES[i][1].test(n); });
      if (hit) return { n: hit, why: 'Guessed from the shop name.' };
    }
    return null;
  }

  function applyGuess() {
    if (categoryTouched || editingId) return;
    var g = guessCategory($('fMerchant').value);
    if (g) { $('fCategory').value = g.n; $('catHint').textContent = g.why; }
    else $('catHint').textContent = '';
    updateRuleWarn();
  }

  function updateRuleWarn() {
    var r = config.cardRule, w = $('ruleWarn');
    var show = !!(r && $('fMethod').value === r.card && $('fCategory').value && r.allow.indexOf($('fCategory').value) === -1);
    w.hidden = !show;
    if (show) w.textContent = r.text || (r.card + ' is not meant for ' + $('fCategory').value + '.');
  }

  function resetForm(keepDate) {
    editingId = null;
    categoryTouched = false;
    $('form').reset();
    fillSelects();
    var d = keepDate || todayISO();
    if (monthOf(d) !== viewMonth && monthOf(todayISO()) !== viewMonth) d = viewMonth + '-01';
    $('fDate').value = d;
    var lm = load(KEY_METHOD, null);
    if (lm && config.methods.indexOf(lm) > -1) $('fMethod').value = lm;
    $('formTitle').textContent = 'Add spending';
    $('saveBtn').textContent = 'Save';
    $('cancelEdit').hidden = true;
    $('deleteBtn').hidden = true;
    $('catHint').textContent = '';
    $('ocrDetails').hidden = true;
    updateRuleWarn();
  }

  function startEdit(id) {
    var x = items.find(function (i) { return i.id === id; });
    if (!x) return;
    resetForm();
    editingId = id;
    $('fAmount').value = (x.pence / 100).toFixed(2);
    $('fDate').value = x.date;
    $('fMerchant').value = x.merchant || '';
    if (!config.categories.some(function (c) { return c.n === x.category; })) {
      var o = el('option', null, x.category + ' (old)'); o.value = x.category; $('fCategory').appendChild(o);
    }
    $('fCategory').value = x.category;
    if (config.methods.indexOf(x.method) === -1 && x.method) {
      var om = el('option', null, x.method); om.value = x.method; $('fMethod').appendChild(om);
    }
    $('fMethod').value = x.method || config.methods[0];
    $('fNote').value = x.note || '';
    $('formTitle').textContent = 'Edit spending';
    $('saveBtn').textContent = 'Save changes';
    $('cancelEdit').hidden = false;
    $('deleteBtn').hidden = false;
    updateRuleWarn();
    $('formCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function onSubmit(e) {
    e.preventDefault();
    var pence = toPence($('fAmount').value);
    if (pence === null || pence === 0) { toast('Enter an amount, like 12.50'); $('fAmount').focus(); return; }
    var date = $('fDate').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('Pick a date'); return; }
    var cat = $('fCategory').value;
    if (!cat) { toast('Pick a category'); return; }
    var now = Date.now();
    var rec = {
      pence: pence, date: date,
      merchant: $('fMerchant').value.trim(),
      category: cat,
      method: $('fMethod').value,
      note: $('fNote').value.trim(),
      updated: now
    };
    if (editingId) {
      var x = items.find(function (i) { return i.id === editingId; });
      if (x) Object.assign(x, rec);
    } else {
      rec.id = uid(); rec.created = now;
      items.push(rec);
    }
    if (!saveItems()) return;
    store(KEY_METHOD, rec.method);
    var wasEdit = !!editingId;
    if (monthOf(date) !== viewMonth) {
      toast((wasEdit ? 'Updated' : 'Saved') + ' to ' + monthLabel(monthOf(date)));
    } else {
      var r = monthSummary(viewMonth).rows.find(function (row) { return row.n === cat; });
      toast((wasEdit ? 'Updated. ' : 'Saved. ') + (r ? (r.left >= 0 ? money(r.left) + ' left in ' + cat : cat + ' is ' + money(-r.left) + ' over') : ''));
    }
    resetForm(date);
    render();
  }

  function onDelete() {
    if (!editingId) return;
    var x = items.find(function (i) { return i.id === editingId; });
    if (!x || !confirm('Delete ' + money(x.pence) + (x.merchant ? ' at ' + x.merchant : '') + '?')) return;
    items = items.filter(function (i) { return i.id !== editingId; });
    deleted[editingId] = Date.now();
    saveItems();
    resetForm();
    render();
    toast('Deleted');
  }

  function markPaid(r) {
    var p = viewMonth.split('-');
    var t = todayISO();
    var date = monthOf(t) === viewMonth ? t : viewMonth + '-' + pad(new Date(+p[0], +p[1], 0).getDate());
    var now = Date.now();
    items.push({ id: uid(), pence: r.cap, date: date, merchant: r.n, category: r.n,
      method: config.methods[0], note: 'Bill', created: now, updated: now });
    if (!saveItems()) return;
    render();
    toast(r.n + ' marked paid (' + money(r.cap) + '). Tap it in the log to change the amount.');
  }

  // ---------- receipt scanning ----------
  var ocrWorker = null;
  function loadScript(src) {
    return new Promise(function (res, rej) {
      if (window.Tesseract) return res();
      var s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = function () { rej(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }
  function status(msg) { var s = $('scanStatus'); s.hidden = !msg; s.textContent = msg || ''; }

  function getWorker() {
    if (ocrWorker) return ocrWorker;
    var abs = function (p) { return new URL(p, location.href).href; };
    ocrWorker = loadScript('vendor/tesseract/tesseract.min.js').then(function () {
      return window.Tesseract.createWorker('eng', 1, {
        workerPath: abs('vendor/tesseract/worker.min.js'),
        corePath: abs('vendor/tesseract/core'),
        langPath: abs('vendor/tesseract/lang'),
        gzip: true,
        workerBlobURL: false,
        logger: function (m) {
          if (m.status === 'recognizing text') status('Reading receipt… ' + Math.round(m.progress * 100) + '%');
          else if (m.status && /load/.test(m.status)) status('Getting the reader ready (first time only)…');
        }
      });
    }).then(function (w) {
      return w.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' }).then(function () { return w; });
    });
    ocrWorker.catch(function () { ocrWorker = null; });
    return ocrWorker;
  }

  // Grayscale and stretch contrast so faint thermal paper reads better.
  function prepareImage(file) {
    return new Promise(function (res, rej) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(url);
        var scale = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
        var w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        var ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        var data = ctx.getImageData(0, 0, w, h), px = data.data, hist = new Uint32Array(256), i, g;
        for (i = 0; i < px.length; i += 4) {
          g = Math.round(px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114);
          px[i] = g; hist[g]++;
        }
        var total = w * h, acc = 0, lo = 0, hi = 255;
        for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= total * 0.03) { lo = i; break; } }
        acc = 0;
        for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= total * 0.03) { hi = i; break; } }
        var range = Math.max(1, hi - lo);
        for (i = 0; i < px.length; i += 4) {
          g = Math.max(0, Math.min(255, Math.round((px[i] - lo) * 255 / range)));
          px[i] = px[i + 1] = px[i + 2] = g;
        }
        ctx.putImageData(data, 0, 0);
        res(c);
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('That file is not a readable image.')); };
      img.src = url;
    });
  }

  function onScan(file) {
    if (!file) return;
    $('scanCameraBtn').disabled = $('scanPickBtn').disabled = true;
    status('Preparing photo…');
    var canvas;
    prepareImage(file).then(function (c) {
      canvas = c;
      return getWorker();
    }).then(function (w) {
      status('Reading receipt…');
      return w.recognize(canvas);
    }).then(function (out) {
      var text = out.data.text || '';
      var r = ReceiptParse.parseReceipt(text, todayISO());
      if (!editingId) resetForm();
      var found = [];
      if (r.pence) { $('fAmount').value = (r.pence / 100).toFixed(2); found.push('total'); }
      if (r.date) { $('fDate').value = r.date; found.push('date'); }
      if (r.merchant) { $('fMerchant').value = r.merchant; found.push('shop'); }
      if (r.methodHint) {
        var m = config.methods.find(function (x) { return x.toLowerCase().indexOf(r.methodHint.toLowerCase()) > -1; });
        if (m) $('fMethod').value = m;
      }
      applyGuess();
      $('ocrText').textContent = text.trim() || '(no text found)';
      $('ocrDetails').hidden = false;
      status(found.length
        ? 'Found the ' + found.join(', ') + '. Check everything, then Save.'
        : 'Could not read this receipt. Try a flatter, brighter photo, or type it in.');
      $('fAmount').focus();
    }).catch(function (err) {
      status('Scanning failed: ' + (err && err.message ? err.message : err) + '. You can still type it in.');
    }).then(function () {
      $('scanCameraBtn').disabled = $('scanPickBtn').disabled = false;
      $('scanCamera').value = $('scanPick').value = '';
    });
  }

  // ---------- exports ----------
  function isTouch() { return matchMedia('(pointer: coarse)').matches; }
  function saveFile(name, text, mime) {
    var blob = new Blob([text], { type: mime });
    if (isTouch() && navigator.canShare && typeof File === 'function') {
      var f = new File([blob], name, { type: mime });
      if (navigator.canShare({ files: [f] })) {
        return navigator.share({ files: [f], title: name }).catch(function (e) {
          if (e && e.name !== 'AbortError') download(blob, name);
        });
      }
    }
    download(blob, name);
  }
  function download(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function csvCell(v) {
    v = String(v === undefined || v === null ? '' : v);
    if (/^[=+\-@]/.test(v)) v = "'" + v;
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function exportCsv() {
    var s = monthSummary(viewMonth);
    var rows = [['Date', 'Shop', 'Category', 'Paid with', 'Amount', 'Note']];
    s.items.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.created - b.created; })
      .forEach(function (x) { rows.push([x.date, x.merchant, x.category, x.method, (x.pence / 100).toFixed(2), x.note]); });
    if (rows.length === 1) { toast('Nothing to export for ' + monthLabel(viewMonth)); return; }
    saveFile('spend-log-' + viewMonth + '.csv', rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n'), 'text/csv');
  }

  // One line per category in budget order. Bills with nothing logged count at their cap.
  function totalsText() {
    var s = monthSummary(viewMonth);
    return s.rows.map(function (r) {
      var p = r.fixed && r.spent === 0 ? r.cap : r.spent;
      return (p / 100).toFixed(2).replace(/\.00$/, '');
    }).join('\n');
  }
  function copyTotals() {
    var txt = totalsText(), out = $('totalsOut');
    out.value = txt;
    out.hidden = false;
    var done = function () { toast('Copied ' + config.categories.length + ' totals for ' + monthLabel(viewMonth)); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done, function () { out.select(); toast('Select the numbers below and copy them'); });
    } else { out.select(); toast('Select the numbers below and copy them'); }
  }

  // ---------- setup ----------
  function openSetup(first) {
    $('setup').hidden = false;
    $('firstRunMsg').hidden = !first;
    buildSetup();
    $('setup').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function closeSetup() { $('setup').hidden = true; }

  function catEditRow(c) {
    var li = el('li');
    li.dataset.orig = c ? c.n : '';
    li.dataset.key = uid();
    var name = el('input'); name.value = c ? c.n : ''; name.placeholder = 'Category'; name.className = 'cn';
    name.setAttribute('aria-label', 'Category name');
    var cap = el('input'); cap.value = c ? c.cap : ''; cap.inputMode = 'decimal'; cap.className = 'cc';
    cap.setAttribute('aria-label', 'Monthly cap in pounds');
    var fx = el('input'); fx.type = 'checkbox'; fx.checked = !!(c && c.fixed); fx.className = 'cf';
    fx.setAttribute('aria-label', 'Fixed bill');
    var mini = el('div', 'mini');
    [['↑', -1, 'Move up'], ['↓', 1, 'Move down']].forEach(function (d) {
      var b = el('button', null, d[0]); b.type = 'button'; b.setAttribute('aria-label', d[2]);
      b.addEventListener('click', function () {
        var sib = d[1] < 0 ? li.previousElementSibling : li.nextElementSibling;
        if (sib) li.parentNode.insertBefore(li, d[1] < 0 ? sib : sib.nextSibling);
        updateCapTotal(); buildRuleAllow(readCatEdits());
      });
      mini.appendChild(b);
    });
    var del = el('button', null, '✕'); del.type = 'button'; del.setAttribute('aria-label', 'Remove category');
    del.addEventListener('click', function () { li.remove(); updateCapTotal(); buildRuleAllow(readCatEdits()); });
    mini.appendChild(del);
    [name, cap, fx].forEach(function (i) { i.addEventListener('input', updateCapTotal); });
    li.appendChild(name); li.appendChild(cap); li.appendChild(fx); li.appendChild(mini);
    return li;
  }

  function readCatEdits() {
    return Array.prototype.map.call($('catEdit').children, function (li) {
      return {
        orig: li.dataset.orig,
        key: li.dataset.key,
        n: li.querySelector('.cn').value.trim(),
        cap: toPence(li.querySelector('.cc').value || '0'),
        fixed: li.querySelector('.cf').checked
      };
    }).filter(function (x) { return x.n; });
  }

  function updateCapTotal() {
    var rows = readCatEdits(), day = 0, bill = 0;
    rows.forEach(function (r) { if (r.cap !== null) { if (r.fixed) bill += r.cap; else day += r.cap; } });
    var inc = toPence($('sIncome').value), sav = toPence($('sSavings').value) || 0;
    var txt = 'Caps: ' + money(day + bill) + ' (bills ' + money(bill) + ', day-to-day ' + money(day) + ').';
    if (inc !== null) txt += ' Safety margin: ' + money(inc - sav - day - bill) + '.';
    $('capTotal').textContent = txt;
  }

  // Ticks are keyed to the category row, not its name, so renaming a category keeps its tick.
  function checkedRuleKeys() {
    return Array.prototype.map.call($('sRuleAllow').querySelectorAll('input:checked'), function (i) { return i.value; });
  }
  function buildRuleAllow(rows, allowNames) {
    var box = $('sRuleAllow');
    var keys = allowNames
      ? rows.filter(function (r) { return allowNames.indexOf(r.n) > -1; }).map(function (r) { return r.key; })
      : checkedRuleKeys();
    box.textContent = '';
    rows.forEach(function (r) {
      var l = el('label'), cb = el('input');
      cb.type = 'checkbox'; cb.value = r.key; cb.checked = keys.indexOf(r.key) > -1;
      l.appendChild(cb); l.appendChild(document.createTextNode(r.n));
      box.appendChild(l);
    });
  }

  function buildSetup() {
    $('sIncome').value = config.income === null ? '' : config.income;
    $('sSavings').value = config.savings === null ? '' : config.savings;
    var ul = $('catEdit');
    ul.textContent = '';
    config.categories.forEach(function (c) { ul.appendChild(catEditRow(c)); });
    $('sMethods').value = config.methods.join('\n');
    var rc = $('sRuleCard');
    rc.textContent = '';
    var none = el('option', null, 'No card rule'); none.value = ''; rc.appendChild(none);
    config.methods.forEach(function (m) { var o = el('option', null, m); o.value = m; rc.appendChild(o); });
    rc.value = config.cardRule ? config.cardRule.card : '';
    buildRuleAllow(readCatEdits(), config.cardRule ? config.cardRule.allow : []);
    $('sRuleText').value = config.cardRule ? config.cardRule.text : '';
    $('sRuleAllowWrap').hidden = !rc.value;
    updateCapTotal();
    showStorageInfo();
  }

  function saveSetup() {
    var rows = readCatEdits();
    if (!rows.length) { toast('Add at least one category'); return; }
    var names = {};
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].cap === null) { toast('Check the cap for ' + rows[i].n); return; }
      var k = rows[i].n.toLowerCase();
      if (names[k]) { toast('Two categories are called ' + rows[i].n); return; }
      names[k] = true;
    }
    var renamed = 0;
    rows.forEach(function (r) {
      if (r.orig && r.orig !== r.n) {
        items.forEach(function (x) { if (x.category === r.orig) { x.category = r.n; x.updated = Date.now(); renamed++; } });
      }
    });
    var methods = $('sMethods').value.split('\n').map(function (m) { return m.trim(); }).filter(Boolean);
    var card = $('sRuleCard').value;
    if (card && methods.indexOf(card) === -1) card = '';
    var keys = checkedRuleKeys();
    var allow = rows.filter(function (r) { return keys.indexOf(r.key) > -1; }).map(function (r) { return r.n; });
    config = normaliseConfig({
      income: toPence($('sIncome').value) === null ? null : toPence($('sIncome').value) / 100,
      savings: toPence($('sSavings').value) === null ? null : toPence($('sSavings').value) / 100,
      categories: rows.map(function (r) { return { n: r.n, cap: r.cap / 100, fixed: r.fixed }; }),
      methods: methods,
      cardRule: card ? { card: card, allow: allow, text: $('sRuleText').value.trim() } : null
    });
    saveConfig();
    if (renamed) saveItems();
    if (filterCat && !config.categories.some(function (c) { return c.n === filterCat; })) filterCat = null;
    fillSelects();
    resetForm();
    closeSetup();
    render();
    toast('Setup saved' + (renamed ? '. ' + renamed + ' entr' + (renamed === 1 ? 'y' : 'ies') + ' moved to renamed categories' : ''));
  }

  function applyPasted() {
    var txt = $('sPaste').value.trim();
    if (!txt) { toast('Paste the setup text first'); return; }
    var obj;
    try { obj = JSON.parse(txt); } catch (e) { toast('That is not valid setup text'); return; }
    if (obj && obj.config && obj.items) { toast('That is a backup. Use Restore backup instead.'); return; }
    var c = normaliseConfig(obj);
    if (!c.categories.length) { toast('No categories found in that setup'); return; }
    config = c;
    saveConfig();
    $('sPaste').value = '';
    buildSetup();
    fillSelects();
    resetForm();
    closeSetup();
    render();
    toast('Setup loaded: ' + c.categories.length + ' categories');
  }

  function copySetup() {
    var txt = JSON.stringify(config);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () { toast('Setup copied'); }, function () { $('sPaste').value = txt; $('sPaste').select(); });
    } else { $('sPaste').value = txt; $('sPaste').select(); }
  }

  function backup() {
    var data = { app: 'spendlog', version: 1, exported: new Date().toISOString(), config: config, items: items };
    saveFile('spend-log-backup-' + todayISO() + '.json', JSON.stringify(data, null, 1), 'application/json');
  }

  function restore(file) {
    if (!file) return;
    file.text().then(function (txt) {
      var d = JSON.parse(txt);
      if (!d || d.app !== 'spendlog' || !Array.isArray(d.items)) throw new Error('not a Spend Log backup');
      var valid = d.items.filter(function (x) {
        return x && typeof x.pence === 'number' && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && x.category;
      });
      if (!confirm('Replace everything on this device with the backup from ' + String(d.exported || '').slice(0, 10) + ' (' + valid.length + ' entries)?')) return;
      items = valid.map(function (x) {
        return { id: x.id || uid(), pence: Math.round(x.pence), date: x.date, merchant: String(x.merchant || ''),
          category: String(x.category), method: String(x.method || ''), note: String(x.note || ''),
          created: +x.created || Date.now(), updated: +x.updated || Date.now() };
      });
      config = normaliseConfig(d.config);
      saveConfig(); saveItems();
      buildSetup(); fillSelects(); resetForm(); render();
      toast('Backup restored: ' + items.length + ' entries');
    }).catch(function (e) { toast('Could not restore: ' + e.message); })
      .then(function () { $('restoreInput').value = ''; });
  }

  function showStorageInfo() {
    var info = $('storageInfo');
    info.textContent = items.length + ' entries saved on this device.';
    if (navigator.storage && navigator.storage.persisted) {
      navigator.storage.persisted().then(function (p) {
        info.textContent += p ? ' Storage is protected from automatic clearing.' : ' Add the app to your home screen so the browser keeps the data.';
      });
    }
  }

  // ---------- Google Drive ----------
  var drive = SpendSync.createDrive({
    clientId: window.SPENDLOG_CLIENT_ID || SpendSync.CLIENT_ID,
    getLocal: function () {
      return { items: items, deleted: deleted, config: config, configUpdated: load(KEY_CFGTIME, 0) };
    },
    // Merged data from Drive. Saved straight to storage, not through saveItems, so it does not loop.
    applyLocal: function (d) {
      items = Array.isArray(d.items) ? d.items : [];
      deleted = d.deleted || {};
      store(KEY_ITEMS, items);
      store(KEY_DELETED, deleted);
      if (d.config) {
        var first = !savedConfig;
        config = normaliseConfig(d.config);
        savedConfig = config;
        store(KEY_CONFIG, config);
        store(KEY_CFGTIME, d.configUpdated || 0);
        if (first && !$('setup').hidden) closeSetup();
      }
      if (editingId && !items.some(function (i) { return i.id === editingId; })) resetForm();
      else fillSelects();
      render();
      if (!$('setup').hidden) showStorageInfo();
    },
    onStatus: showDriveStatus
  });

  function timeOf(ms) { return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
  function showDriveStatus(s, detail) {
    var line = $('syncLine'), txt = '', setupTxt = '';
    switch (s) {
      case 'connecting': txt = 'Waiting for Google sign-in…'; break;
      case 'syncing': txt = 'Saving to Google Drive…'; break;
      case 'synced': txt = '✓ Saved to Google Drive at ' + timeOf(detail || Date.now()); break;
      case 'reconnect': txt = 'Google Drive needs you to sign in again. Your entries are safe on this phone.' + (detail ? ' ' + detail : ''); break;
      case 'offline': txt = 'Offline. Changes will go to Google Drive when you are back online.'; break;
      case 'error': txt = detail || 'Could not reach Google Drive.'; break;
      default: setupTxt = (detail ? detail + ' ' : '') + 'Not connected. Connect to keep a copy of everything in your Google Drive and get it back on any device.';
    }
    var on = drive.isConnected();
    line.hidden = !on && s !== 'connecting' && s !== 'error';
    $('syncText').textContent = txt;
    line.className = 'sync' + (s === 'reconnect' || s === 'error' ? ' attention' : '');
    $('syncReconnect').hidden = s !== 'reconnect';
    $('driveInfo').textContent = setupTxt || txt;
    $('driveConnect').hidden = on && s !== 'reconnect';
    $('driveConnect').textContent = on ? 'Reconnect Google Drive' : 'Connect Google Drive';
    $('driveDisconnect').hidden = !on;
  }

  // ---------- wiring ----------
  $('prevMonth').addEventListener('click', function () { viewMonth = shiftMonth(viewMonth, -1); filterCat = null; if (!editingId) resetForm(); render(); });
  $('nextMonth').addEventListener('click', function () { viewMonth = shiftMonth(viewMonth, 1); filterCat = null; if (!editingId) resetForm(); render(); });
  $('form').addEventListener('submit', onSubmit);
  $('fMerchant').addEventListener('change', applyGuess);
  $('fMerchant').addEventListener('input', function () { if (!$('fMerchant').value) $('catHint').textContent = ''; });
  $('fCategory').addEventListener('change', function () { categoryTouched = true; $('catHint').textContent = ''; updateRuleWarn(); });
  $('fMethod').addEventListener('change', updateRuleWarn);
  $('cancelEdit').addEventListener('click', function () { resetForm(); });
  $('deleteBtn').addEventListener('click', onDelete);
  $('filterChip').addEventListener('click', function () { setFilter(null); });
  // Two inputs: newer Android photo pickers have no camera option, so "Take photo" asks for the camera directly.
  $('scanCameraBtn').addEventListener('click', function () { $('scanCamera').click(); });
  $('scanPickBtn').addEventListener('click', function () { $('scanPick').click(); });
  $('scanCamera').addEventListener('change', function () { onScan(this.files[0]); });
  $('scanPick').addEventListener('change', function () { onScan(this.files[0]); });
  $('copyTotals').addEventListener('click', copyTotals);
  $('exportCsv').addEventListener('click', exportCsv);
  $('openSetup').addEventListener('click', function () { openSetup(false); });
  $('closeSetup').addEventListener('click', closeSetup);
  $('addCat').addEventListener('click', function () {
    var li = catEditRow(null); $('catEdit').appendChild(li); li.querySelector('.cn').focus();
  });
  $('catEdit').addEventListener('change', function (e) {
    if (e.target.classList.contains('cn')) buildRuleAllow(readCatEdits());
  });
  $('sIncome').addEventListener('input', updateCapTotal);
  $('sSavings').addEventListener('input', updateCapTotal);
  $('sRuleCard').addEventListener('change', function () { $('sRuleAllowWrap').hidden = !this.value; });
  $('saveSetup').addEventListener('click', saveSetup);
  $('applyPaste').addEventListener('click', applyPasted);
  $('copySetup').addEventListener('click', copySetup);
  $('backupBtn').addEventListener('click', backup);
  $('restoreBtn').addEventListener('click', function () { $('restoreInput').click(); });
  $('restoreInput').addEventListener('change', function () { restore(this.files[0]); });
  $('driveConnect').addEventListener('click', function () { drive.connect(); });
  $('syncReconnect').addEventListener('click', function () { drive.connect(); });
  $('driveDisconnect').addEventListener('click', function () {
    if (confirm('Stop saving to Google Drive? The file stays in your Drive and everything stays on this phone.')) drive.disconnect();
  });

  // Keep in step if the app is open in two tabs.
  window.addEventListener('storage', function (e) {
    if (e.key === KEY_ITEMS) { items = load(KEY_ITEMS, []); deleted = load(KEY_DELETED, {}); render(); }
    if (e.key === KEY_CONFIG) { config = normaliseConfig(load(KEY_CONFIG, null) || STARTER); fillSelects(); render(); }
  });
  // Roll over to the new month if the app stays open past midnight.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') render();
  });

  fillSelects();
  resetForm();
  render();
  if (!savedConfig) openSetup(true);
  $('driveSetup').hidden = !(window.SPENDLOG_CLIENT_ID || SpendSync.CLIENT_ID);
  drive.start();

  window.SPENDLOG_READY = true;

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
