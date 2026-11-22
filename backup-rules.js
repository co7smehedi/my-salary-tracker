/* My Salary Tracker - backup validation, merge rules and backup-reminder rules.
   Pure logic: no DOM, no storage, no network. The app and the automated tests both use this file. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'));
  else root.MSTRules = factory(root.MSTCalc);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  var STORES = ['work', 'payments', 'expenses', 'remittances', 'gifts'];
  var SETTING_KEYS = ['basic', 'standard', 'otRate', 'bus', 'bonus'];
  var MAX = 1e12;            // anything bigger than this is certainly a typo or a damaged file

  function has(v) { return v !== undefined && v !== null && v !== ''; }
  function isNum(v) { if (typeof v === 'number') return isFinite(v); if (typeof v === 'string') return v.trim() !== '' && isFinite(Number(v)); return false; }
  function amountOk(v) { return isNum(v) && Number(v) >= 0 && Number(v) <= MAX; }
  function validId(id) { return (typeof id === 'string' && id !== '') || (typeof id === 'number' && isFinite(id)); }
  function idKey(id) { return typeof id + ':' + id; }        // same rule as IndexedDB: the number 5 and the text "5" are different keys

  // err.key is a translation key (v_*), store/n say where, field says which value.
  function bad(key, store, n, field) {
    return { ok: false, error: key + (store ? ' ' + store + (n ? ' #' + n : '') : '') + (field ? ' [' + field + ']' : ''), err: { key: key, store: store || '', n: n || 0, field: field || '' } };
  }

  function checkRecord(s, x, where) {          // returns an error object or null
    var n = where;
    if (s === 'work') {
      if (!C.isDate(x.date)) return bad('v_bad_date', s, n, 'date');
      if (typeof x.status !== 'string') return bad('v_bad_status', s, n, 'status');
      if (has(x.hours) && !(isNum(x.hours) && Number(x.hours) >= 0 && Number(x.hours) <= 24)) return bad('v_bad_hours', s, n, 'hours');
      return null;
    }
    if (s === 'payments') {
      if (has(x.date) && !C.isDate(x.date)) return bad('v_bad_date', s, n, 'date');
      if (has(x.month) && !C.isMonth(x.month)) return bad('v_bad_month', s, n, 'month');
      if (!C.isDate(x.date) && !C.isMonth(x.month)) return bad('v_bad_date', s, n, 'date');
      if (!amountOk(x.amount)) return bad('v_bad_amount', s, n, 'amount');
      if (has(x.bus) && (!amountOk(x.bus) || Number(x.bus) > Number(x.amount))) return bad('v_bad_bus', s, n, 'bus');
      return null;
    }
    if (!C.isDate(x.date)) return bad('v_bad_date', s, n, 'date');
    if (!amountOk(x.amount)) return bad('v_bad_amount', s, n, 'amount');
    if (s === 'remittances') {
      if (!(isNum(x.rate) && Number(x.rate) > 0 && Number(x.rate) <= MAX)) return bad('v_bad_rate', s, n, 'rate');
      if (has(x.fee) && (!amountOk(x.fee) || Number(x.fee) > Number(x.amount))) return bad('v_bad_fee', s, n, 'fee');
      if (has(x.bonus) && !amountOk(x.bonus)) return bad('v_bad_amount', s, n, 'bonus');
      if (has(x.actualBdt) && !amountOk(x.actualBdt)) return bad('v_bad_amount', s, n, 'actualBdt');
    }
    return null;
  }

  function findDuplicateDates(list) {          // [{date, count}] for every date that has more than one work record
    var seen = {}, out = [];
    (list || []).forEach(function (x) { var d = x && x.date; if (d) seen[d] = (seen[d] || 0) + 1; });
    Object.keys(seen).sort().forEach(function (d) { if (seen[d] > 1) out.push({ date: d, count: seen[d] }); });
    return out;
  }

  function validateBackup(p) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return bad('v_not_object');
    var payload = p.stores && typeof p.stores === 'object' && !Array.isArray(p.stores) ? p.stores
      : (p.data && typeof p.data === 'object' && !Array.isArray(p.data) ? p.data : null);
    if (!payload) return bad('v_no_data');
    var out = {}, counts = {}, total = 0, hasAny = false;
    for (var i = 0; i < STORES.length; i++) {
      var s = STORES[i], list = payload[s];
      if (list === undefined) { out[s] = []; counts[s] = 0; continue; }
      if (!Array.isArray(list)) return bad('v_not_list', s);
      hasAny = true;
      var seen = {};
      for (var j = 0; j < list.length; j++) {
        var x = list[j], n = j + 1;
        if (!x || typeof x !== 'object' || Array.isArray(x)) return bad('v_not_record', s, n);
        if (!validId(x.id)) return bad('v_no_id', s, n);
        if (seen[idKey(x.id)]) return bad('v_dup_id', s, n);
        seen[idKey(x.id)] = 1;
        var e = checkRecord(s, x, n); if (e) return e;
      }
      out[s] = list; counts[s] = list.length; total += list.length;
    }
    if (!hasAny) return bad('v_no_data');
    if (total === 0) return bad('v_no_records');       // an empty backup could only ever wipe real data
    var raw = p.settings && typeof p.settings === 'object' && !Array.isArray(p.settings) ? p.settings
      : (payload.settings && typeof payload.settings === 'object' && !Array.isArray(payload.settings) ? payload.settings : null);
    var cleaned = null;
    if (raw) {
      cleaned = {};
      Object.keys(raw).forEach(function (k) { if (SETTING_KEYS.indexOf(k) < 0 || has(raw[k])) cleaned[k] = raw[k]; });   // empty/null numbers are "not set", never "zero"
      for (var k = 0; k < SETTING_KEYS.length; k++) {
        var key = SETTING_KEYS[k], v = cleaned[key];
        if (v !== undefined && !(isNum(v) && Number(v) >= 0 && Number(v) <= MAX)) return bad('v_bad_setting', '', 0, key);
      }
      if (cleaned.standard !== undefined && Number(cleaned.standard) > 24) return bad('v_bad_setting', '', 0, 'standard');
    }
    return { ok: true, payload: out, counts: counts, total: total, rawSettings: cleaned, exportedAt: p.exportedAt || '', warnings: { dupDates: findDuplicateDates(out.work).length } };
  }

  // Merge never overwrites or duplicates a day: one work record per date.
  // An incoming record is skipped when its date already belongs to a different record (existing, or earlier in the file).
  // An incoming record with the same id as an existing one updates it in place (unless that would move it onto another record's date).
  function planMerge(payload, currentWork) {
    var cur = currentWork || [], byId = {}, owner = {};
    cur.forEach(function (x) { byId[idKey(x.id)] = x; if (x.date && owner[x.date] === undefined) owner[x.date] = idKey(x.id); });
    var out = [], skipped = [];
    ((payload && payload.work) || []).forEach(function (r) {
      var k = idKey(r.id), existing = byId[k];
      if (existing) {
        if (existing.date === r.date) { out.push(r); return; }                        // plain update, same day
        if (owner[r.date] !== undefined && owner[r.date] !== k) { skipped.push({ id: r.id, date: r.date }); return; }
        if (owner[existing.date] === k) delete owner[existing.date];
        owner[r.date] = k; out.push(r); return;
      }
      if (owner[r.date] !== undefined) { skipped.push({ id: r.id, date: r.date }); return; }
      owner[r.date] = k; out.push(r);
    });
    var copy = {}; STORES.forEach(function (s) { copy[s] = s === 'work' ? out : ((payload && payload[s]) || []); });
    return { payload: copy, skipped: skipped.length, skippedItems: skipped };
  }

  // Should the "please export a backup" banner show?  o = {last: Date|null, snooze: 'YYYY-MM-DD'|'', today: 'YYYY-MM-DD', hasRecords: bool, now: Date, days: 7}
  function backupStatus(o) {
    var days = o.days || 7, out = { show: false, never: false, last: o.last || null };
    if (!o.hasRecords) return out;
    if (o.snooze && o.snooze === o.today) return out;
    if (!o.last || isNaN(o.last.getTime())) { out.show = true; out.never = true; out.last = null; return out; }
    out.show = (o.now.getTime() - o.last.getTime()) >= days * 86400000;
    return out;
  }

  return { STORES: STORES, validateBackup: validateBackup, planMerge: planMerge, findDuplicateDates: findDuplicateDates, backupStatus: backupStatus, idKey: idKey };
});
