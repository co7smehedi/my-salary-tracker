/* My Salary Tracker - pure calculation helpers (no DOM, no storage). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MSTCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULTS = {
    basic: 25, standard: 8, otRate: 2.77, bus: 50, bonus: 2.5,
    paidLeave: true, paidHoliday: true, sickPaid: false, rentEnabled: false,
    language: 'en', theme: 'auto'
  };
  var STATUSES = ['worked', 'rest', 'paid_leave', 'unpaid_leave', 'sick_leave', 'holiday'];

  function num(v) { var n = Number(v); return Number.isFinite(n) ? n : 0; }
  function r2(n) { return Math.round((num(n) + Number.EPSILON) * 100) / 100; }

  function pad(n) { return String(n).padStart(2, '0'); }
  function dateKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }   // LOCAL date, never UTC
  function monthKeyOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function isDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10), t = new Date(y, m - 1, d);
    return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d;
  }
  function isMonth(s) { return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s); }

  // Older versions stored free text; map the common spellings, keep unknown values as null.
  function normStatus(s) {
    var k = String(s == null ? '' : s).trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (STATUSES.indexOf(k) >= 0) return k;
    var alias = { work: 'worked', duty: 'worked', present: 'worked', off: 'rest', day_off: 'rest', leave: 'paid_leave', sick: 'sick_leave' };
    return alias[k] || null;
  }

  // One work record -> money. Known example: 8h = 25.00, 10h = 25.00 + 2 x 2.77 = 30.54
  function dayParts(w, st) {
    var s = Object.assign({}, DEFAULTS, st || {});
    var status = normStatus(w && w.status), base = 0, otHours = 0, otPay = 0;
    if (status === 'worked') {
      base = num(s.basic);
      otHours = Math.max(0, num(w.hours) - num(s.standard));
      otPay = otHours * num(s.otRate);
    } else if (status === 'paid_leave' && s.paidLeave) base = num(s.basic);
    else if (status === 'holiday' && s.paidHoliday) base = num(s.basic);
    else if (status === 'sick_leave' && s.sickPaid) base = num(s.basic);
    base = r2(base); otPay = r2(otPay);
    return { status: status, base: base, otHours: otHours, otPay: otPay, total: r2(base + otPay) };
  }

  function remitParts(r) {
    var amount = num(r.amount), fee = num(r.fee), rate = num(r.rate), bonus = num(r.bonus);
    var net = Math.max(0, amount - fee);
    var bonusEur = r2(net * bonus / 100);
    var estimated = r2((net + bonusEur) * rate);
    var actual = num(r.actualBdt) > 0 ? r2(r.actualBdt) : null;
    return { amount: amount, fee: fee, net: net, bonusEur: bonusEur, estimatedBdt: estimated, actualBdt: actual, bdt: actual !== null ? actual : estimated };
  }

  function isRent(e) { return String(e && e.category || '').trim().toLowerCase() === 'rent'; }
  function pay(p) { return p.month && isMonth(p.month) ? p.month : String(p.date || '').slice(0, 7); }

  function calcMonth(data, st, m) {
    var s = Object.assign({}, DEFAULTS, st || {});
    var w = (data.work || []).filter(function (x) { return String(x.date || '').slice(0, 7) === m; });
    var p = (data.payments || []).filter(function (x) { return pay(x) === m; });
    var e = (data.expenses || []).filter(function (x) { return String(x.date || '').slice(0, 7) === m; });
    var r = (data.remittances || []).filter(function (x) { return String(x.date || '').slice(0, 7) === m; });
    var g = (data.gifts || []).filter(function (x) { return String(x.date || '').slice(0, 7) === m; });
    var out = { month: m, workedDays: 0, otHours: 0, wages: 0, otPay: 0, earned: 0, busDue: 0, busReceived: 0,
      paymentsTotal: 0, salaryReceived: 0, outstanding: 0, overpaid: 0,
      busOutstanding: 0, busStatus: 'notdue', expenses: 0, rentExcluded: 0, remitEur: 0, remitFee: 0, remitBonusEur: 0, remitBdt: 0, giftEur: 0, giftBdt: 0, giftOther: 0, balance: 0,
      counts: { work: w.length, payments: p.length, expenses: e.length, remittances: r.length, gifts: g.length } };
    w.forEach(function (x) { var d = dayParts(x, s); if (d.status === 'worked') { out.workedDays++; out.otHours += d.otHours; } out.wages += d.base; out.otPay += d.otPay; });
    out.wages = r2(out.wages); out.otPay = r2(out.otPay); out.otHours = r2(out.otHours);
    out.earned = r2(out.wages + out.otPay);
    out.busDue = out.workedDays > 0 ? r2(s.bus) : 0;
    p.forEach(function (x) { var a = num(x.amount), b = Math.min(Math.max(0, num(x.bus)), a); out.paymentsTotal += a; out.busReceived += b; });
    out.paymentsTotal = r2(out.paymentsTotal); out.busReceived = r2(out.busReceived);
    // Bus allowance Paid / Unpaid: derived from the payments' "bus allowance included" amounts. Display only - never part of earned or salary outstanding.
    out.busOutstanding = r2(Math.max(0, out.busDue - out.busReceived));
    out.busStatus = out.busDue <= 0 ? 'notdue' : (out.busOutstanding <= 0 ? 'paid' : (out.busReceived > 0 ? 'partial' : 'unpaid'));
    out.salaryReceived = r2(out.paymentsTotal - out.busReceived);       // bus allowance is never mixed into salary
    var diff = r2(out.earned - out.salaryReceived);
    out.outstanding = diff > 0 ? diff : 0; out.overpaid = diff < 0 ? -diff : 0;
    e.forEach(function (x) { if (isRent(x) && !s.rentEnabled) out.rentExcluded += num(x.amount); else out.expenses += num(x.amount); });
    out.expenses = r2(out.expenses); out.rentExcluded = r2(out.rentExcluded);
    r.forEach(function (x) { var q = remitParts(x); out.remitEur += q.amount; out.remitFee += q.fee; out.remitBonusEur += q.bonusEur; out.remitBdt += q.bdt; });
    out.remitEur = r2(out.remitEur); out.remitFee = r2(out.remitFee); out.remitBonusEur = r2(out.remitBonusEur); out.remitBdt = r2(out.remitBdt);
    g.forEach(function (x) { var c = String(x.currency || 'EUR').toUpperCase(); if (c === 'EUR') out.giftEur += num(x.amount); else if (c === 'BDT') out.giftBdt += num(x.amount); else out.giftOther += num(x.amount); });
    out.giftEur = r2(out.giftEur); out.giftBdt = r2(out.giftBdt); out.giftOther = r2(out.giftOther);
    // cash left in EUR = money received - expenses - money sent home - money given (EUR)
    out.balance = r2(out.paymentsTotal - out.expenses - out.remitEur - out.giftEur);
    return out;
  }

  function monthsIn(data) {
    var set = {};
    ['work', 'expenses', 'remittances', 'gifts'].forEach(function (k) { (data[k] || []).forEach(function (x) { var m = String(x.date || '').slice(0, 7); if (isMonth(m)) set[m] = 1; }); });
    (data.payments || []).forEach(function (x) { var m = pay(x); if (isMonth(m)) set[m] = 1; });
    return Object.keys(set).sort();
  }

  function sum(list) {
    var keys = ['workedDays', 'otHours', 'wages', 'otPay', 'earned', 'busDue', 'busReceived', 'busOutstanding', 'paymentsTotal', 'salaryReceived', 'outstanding', 'overpaid', 'expenses', 'rentExcluded', 'remitEur', 'remitFee', 'remitBonusEur', 'remitBdt', 'giftEur', 'giftBdt', 'giftOther', 'balance'];
    var t = {}; keys.forEach(function (k) { t[k] = 0; });
    list.forEach(function (c) { keys.forEach(function (k) { t[k] += c[k]; }); });
    keys.forEach(function (k) { t[k] = r2(t[k]); });
    return t;
  }

  // Month / year / all-time. Outstanding and overpaid are computed per month, then added up (an overpaid month never hides a different unpaid month).
  function calcPeriod(data, st, type, key) {
    var months;
    if (type === 'month') months = [key];
    else if (type === 'year') { months = []; for (var i = 1; i <= 12; i++) months.push(key + '-' + pad(i)); }
    else months = monthsIn(data);
    var per = months.map(function (m) { return calcMonth(data, st, m); });
    var total = sum(per); total.type = type; total.key = key || ''; total.busStatus = type === 'month' && per[0] ? per[0].busStatus : null;
    return { total: total, months: per };
  }

  return { DEFAULTS: DEFAULTS, STATUSES: STATUSES, r2: r2, num: num, dateKey: dateKey, monthKeyOf: monthKeyOf, isDate: isDate, isMonth: isMonth,
    normStatus: normStatus, dayParts: dayParts, remitParts: remitParts, calcMonth: calcMonth, calcPeriod: calcPeriod, monthsIn: monthsIn, isRent: isRent };
});
