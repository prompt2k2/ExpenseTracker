/* Spending advice from your own history. Plain rules, worked out on the device.
   advise(config, items, todayISO) -> [{key, level, label, title, text, action}]
   Also loads in Node for tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SpendAdvice = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LABELS = { over: 'Over budget', warn: 'Heading over', change: 'Budget check', save: 'Could save', trend: 'Trend', spike: 'Spending more' };
  var ORDER = { over: 0, warn: 1, change: 2, spike: 3, save: 4, trend: 5 };
  var GBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
  var GBP0 = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0, minimumFractionDigits: 0 });

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function money(p) { return p % 100 === 0 ? GBP0.format(p / 100) : GBP.format(p / 100); }
  function shift(m, by) {
    var d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1 + by, 1));
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1);
  }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function monthName(m) { return MONTHS[+m.slice(5, 7) - 1]; }
  function up5(p) { return Math.ceil(p / 500) * 500; }
  function sum(a) { return a.reduce(function (x, y) { return x + y; }, 0); }

  function advise(config, items, today) {
    var cur = today.slice(0, 7);
    var y = +cur.slice(0, 4), mo = +cur.slice(5, 7);
    var days = new Date(Date.UTC(y, mo, 0)).getUTCDate(), day = +today.slice(8, 10);
    var frac = day / days, daysLeft = days - day + 1;
    var cats = (config.categories || []).filter(function (c) { return !c.fixed && +c.cap > 0; });
    var totalCap = sum((config.categories || []).map(function (c) { return Math.round((+c.cap || 0) * 100); }));
    var margin = config.income === null || config.income === undefined ? null
      : Math.round(config.income * 100) - Math.round((config.savings || 0) * 100) - totalCap;

    // spend[month][category], byNow[month][category] = spent by today's day of the month,
    // shops[month][shop key] = {name, p}
    var spend = {}, byNow = {}, shops = {}, first = null;
    items.forEach(function (x) {
      var m = x.date.slice(0, 7);
      if (m > cur) return;
      if (!first || m < first) first = m;
      (spend[m] = spend[m] || {})[x.category] = (spend[m][x.category] || 0) + x.pence;
      if (+x.date.slice(8, 10) <= day) (byNow[m] = byNow[m] || {})[x.category] = (byNow[m][x.category] || 0) + x.pence;
      if (x.merchant) {
        var k = x.merchant.trim().toLowerCase();
        var s = (shops[m] = shops[m] || {});
        (s[k] = s[k] || { name: x.merchant.trim(), p: 0 }).p += x.pence;
      }
    });
    // Up to 3 finished months, counted from the month you started logging.
    var hist = [shift(cur, -3), shift(cur, -2), shift(cur, -1)].filter(function (m) { return first && m >= first; });
    var got = function (m, n) { return (spend[m] && spend[m][n]) || 0; };
    var out = [];

    cats.forEach(function (c) {
      var cap = Math.round(c.cap * 100), spent = got(cur, c.n);
      var past = hist.map(function (m) { return got(m, c.n); });
      var avg = past.length ? Math.round(sum(past) / past.length) : 0;

      // 1. This month
      if (spent > cap) {
        out.push({ key: 'over:' + c.n, level: 'over', title: c.n + ' is ' + money(spent - cap) + ' over',
          text: money(spent) + ' spent against a ' + money(cap) + ' cap. Anything more comes out of other categories or your savings.' });
      } else if (frac >= 0.25 && frac < 1 && spent >= cap * 0.5) {
        // With history, compare with what you had usually spent by this day, so a regular
        // big shop early in the month is not mistaken for overspending. Otherwise a straight line.
        var usualByNow = past.length ? sum(hist.map(function (m) { return (byNow[m] && byNow[m][c.n]) || 0; })) / past.length : 0;
        var projected = usualByNow > 0 && avg > 0 ? spent / usualByNow * avg : spent / frac;
        projected = Math.round(projected / 100) * 100;
        if (projected > cap * 1.1) {
          var basis = usualByNow > 0 && avg > 0
            ? ' By this day you usually spend about ' + money(Math.round(usualByNow / 100) * 100) + ', so you are on course for about '
            : ' At this rate you will spend about ';
          out.push({ key: 'pace:' + c.n, level: 'warn', title: c.n + ' is heading over', projected: projected,
            text: money(spent) + ' spent with ' + daysLeft + ' days left.' + basis + money(projected) + ', ' + money(projected - cap) +
              ' over. To stay on budget, keep to ' + money(Math.max(0, Math.floor((cap - spent) / daysLeft * 7 / 100) * 100)) + ' a week.' });
        }
      }

      // 2. Over two months running: change the cap on purpose, or plan cuts
      if (past.length >= 2 && past[past.length - 1] > cap && past[past.length - 2] > cap) {
        var overAvg = Math.round((past[past.length - 1] + past[past.length - 2]) / 2);
        var raiseTo = Math.max(up5(overAvg), up5(cap + 1));
        var t = c.n + ' went over its ' + money(cap) + ' cap in ' + monthName(hist[hist.length - 2]) + ' and ' + monthName(hist[hist.length - 1]) +
          ' (' + money(past[past.length - 2]) + ' and ' + money(past[past.length - 1]) + '). Decide on purpose: raise the cap to ' + money(raiseTo) + ', or plan how to cut back.';
        if (margin !== null) {
          var after = margin - (raiseTo - cap);
          t += after >= 0 ? ' Raising it would leave a safety margin of ' + money(after) + '.'
            : ' Raising it would take you ' + money(-after) + ' past your safety margin, so another cap would have to come down.';
        }
        out.push({ key: 'raise:' + c.n, level: 'change', title: c.n + ': over two months running', text: t,
          action: { label: 'Raise cap to ' + money(raiseTo), category: c.n, cap: raiseTo / 100 } });
      }

      // 3. Used every month but well under for three: lower the cap and save the difference.
      // Categories with empty months are left alone: clothing or gifts can be quiet for months, then need it all.
      if (past.length >= 3 && past.every(function (p) { return p > 0 && p < cap * 0.7; })) {
        var lowerTo = up5(Math.max(Math.max.apply(null, past), avg * 1.1));
        if (cap - lowerTo >= 500) {
          out.push({ key: 'lower:' + c.n, level: 'save', title: c.n + ': stayed well under for 3 months',
            text: 'You spent ' + past.map(money).join(', ') + ' against a ' + money(cap) + ' cap. Lower it to ' + money(lowerTo) +
              ' and move ' + money(cap - lowerTo) + ' a month to savings.',
            action: { label: 'Lower cap to ' + money(lowerTo), category: c.n, cap: lowerTo / 100 } });
        }
      }

      // 4. Rising three months running
      if (past.length >= 3 && past[0] < past[1] && past[1] < past[2] && past[2] >= past[0] * 1.25 && past[2] >= 2000) {
        out.push({ key: 'rise:' + c.n, level: 'trend', title: c.n + ' has gone up three months running',
          text: past.map(function (p, i) { return monthName(hist[i]) + ' ' + money(p); }).join(', ') + '. Worth a look before it becomes the new normal.' });
      }
    });

    // 5. Shops you are spending more at than usual (needs 2 finished months)
    if (hist.length >= 2 && shops[cur]) {
      var spikes = [];
      Object.keys(shops[cur]).forEach(function (k) {
        var now = shops[cur][k].p;
        var usual = Math.round(sum(hist.map(function (m) { return shops[m] && shops[m][k] ? shops[m][k].p : 0; })) / hist.length);
        if (now >= 1500 && now > usual * 1.5 && now - usual >= 1000) spikes.push({ name: shops[cur][k].name, now: now, usual: usual });
      });
      spikes.sort(function (a, b) { return (b.now - b.usual) - (a.now - a.usual); }).slice(0, 3).forEach(function (s) {
        out.push({ key: 'shop:' + s.name.toLowerCase(), level: 'spike', title: s.name + ': ' + money(s.now) + ' so far this month',
          text: s.usual ? 'You usually spend about ' + money(s.usual) + ' a month there.' : 'You did not spend anything there in the last ' + hist.length + ' months.' });
      });
    }

    out.forEach(function (a) { a.label = LABELS[a.level]; });
    return out.sort(function (a, b) { return ORDER[a.level] - ORDER[b.level]; });
  }

  // One line for the "Saved" message. projected: from this month's "heading over" advice, if any.
  function afterSave(cap, spent, projected) {
    if (cap <= 0) return '';
    if (spent > cap) return ' ⚠ This category is now ' + money(spent - cap) + ' over budget.';
    var left = cap - spent;
    if (projected > cap) return ' ⚠ ' + money(left) + ' left, but you are on course to go about ' + money(projected - cap) + ' over.';
    if (spent >= cap * 0.8) return ' ⚠ Only ' + money(left) + ' left (' + Math.round(spent / cap * 100) + '% used).';
    return ' ' + money(left) + ' left.';
  }

  return { advise: advise, afterSave: afterSave };
});
