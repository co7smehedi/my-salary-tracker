/* My Salary Tracker v9.1 - all data stays on this device (IndexedDB + localStorage). No network requests are made by this file. */
(function () {
  'use strict';
  var C = window.MSTCalc, I = window.MSTi18n, R = window.MSTRules, T = I.T;
  var VERSION = '9.1';
  var DB_NAME = 'salary-tracker-db';
  var STORES = ['work', 'payments', 'expenses', 'remittances', 'gifts'];
  var LEGACY = 'workEntries';
  var SETTINGS_KEY = 'mst-settings';
  var LAST_BACKUP_KEY = 'mst-last-backup';      // ISO time of the last successful 'Export backup' (device only, never inside a backup file)
  var SNOOZE_KEY = 'mst-backup-snooze';         // local date (YYYY-MM-DD) on which the reminder was snoozed
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    db: null, data: { work: [], payments: [], expenses: [], remittances: [], gifts: [] },
    settings: Object.assign({}, C.DEFAULTS), month: new Date(), rtype: 'month', ryear: new Date().getFullYear(),
    edit: null, pending: null, dbError: null, storage: null, updatePending: false
  };

  /* ---------- translation & formatting ---------- */
  function lang() { return I.LANGS.indexOf(state.settings.language) >= 0 ? state.settings.language : 'en'; }
  function tr(k, vars) {
    var s = (T[lang()] && T[lang()][k]) || T.en[k] || k;
    if (vars) Object.keys(vars).forEach(function (n) { s = s.replace('{' + n + '}', vars[n]); });
    return s;
  }
  function loc() { return I.LOCALES[lang()]; }
  function money(n, cur) {
    cur = cur || 'EUR';
    try { return new Intl.NumberFormat(loc(), { style: 'currency', currency: cur }).format(C.num(n)); }
    catch (e) { return C.num(n).toFixed(2) + ' ' + cur; }
  }
  function numFmt(n, d) { try { return new Intl.NumberFormat(loc(), { maximumFractionDigits: d == null ? 2 : d }).format(C.num(n)); } catch (e) { return String(n); } }
  function parts(ds) { return [+ds.slice(0, 4), +ds.slice(5, 7), +ds.slice(8, 10)]; }
  function fmtDate(ds) {
    if (!C.isDate(ds)) return String(ds || '');
    var p = parts(ds);
    try { return new Intl.DateTimeFormat(loc(), { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(p[0], p[1] - 1, p[2])); } catch (e) { return ds; }
  }
  function fmtMonth(mk, short) {
    if (!C.isMonth(mk)) return String(mk || '');
    try { return new Intl.DateTimeFormat(loc(), { month: short ? 'short' : 'long', year: short ? undefined : 'numeric' }).format(new Date(+mk.slice(0, 4), +mk.slice(5, 7) - 1, 1)); } catch (e) { return mk; }
  }
  function safe(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)); }
  function today() { return C.dateKey(new Date()); }
  function viewMonth() { return C.monthKeyOf(state.month); }
  function statusLabel(s) { var k = C.normStatus(s); return k ? tr('st_' + k) : String(s || '') + ' ⚠'; }
  function catLabel(v) { var k = String(v || '').trim().toLowerCase(); return (T.en['cat_' + k]) ? tr('cat_' + k) : String(v || ''); }
  function catKeys() { return ['food', 'transport', 'phone', 'health', 'shopping', 'family', 'other'].concat(state.settings.rentEnabled ? ['rent'] : []); }

  /* ---------- toast & dialogs ---------- */
  /* Messages are stored as small builder functions (not finished text), so a message that is already on screen is re-written
     in the new language the moment the language changes. */
  function txt(m) { return typeof m === 'function' ? m() : String(m == null ? '' : m); }
  function M(key, vars, tail) { return function () { return tr(key, vars) + (tail ? txt(tail) : ''); }; }
  var live = {};
  function setMsg(id, m) { live[id] = m || null; $(id).textContent = m ? txt(m) : ''; }
  function refreshMsgs() { Object.keys(live).forEach(function (id) { if (live[id]) $(id).textContent = txt(live[id]); }); if (toastState && !$('toast').hidden) drawToast(); }
  var toastTimer = null, toastState = null;
  function drawToast() {
    var t = $('toast'); t.innerHTML = '';
    var s = document.createElement('span'); s.textContent = txt(toastState.msg); t.appendChild(s);
    if (toastState.label) { var b = document.createElement('button'); b.type = 'button'; b.textContent = txt(toastState.label); b.onclick = function () { t.hidden = true; toastState.action && toastState.action(); }; t.appendChild(b); }
  }
  function toast(msg, actionLabel, action) {
    toastState = { msg: msg, label: actionLabel, action: action }; drawToast();
    var t = $('toast'); t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, actionLabel ? 12000 : 3200);
  }
  function openDlg(id) { var d = $(id); if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
  function closeDlg(id) { var d = $(id); if (d.close) d.close(); else d.removeAttribute('open'); }
  function askConfirm(title, msg, okLabel) {
    return new Promise(function (resolve) {
      $('cfTitle').textContent = title; $('cfMsg').textContent = msg; $('cfOk').textContent = okLabel;
      var done = false;
      function fin(v) { if (done) return; done = true; $('cfOk').onclick = $('cfCancel').onclick = null; $('confirmDlg').removeEventListener('close', onClose); closeDlg('confirmDlg'); resolve(v); }
      function onClose() { fin(false); }
      $('confirmDlg').addEventListener('close', onClose);
      $('cfOk').onclick = function () { fin(true); }; $('cfCancel').onclick = function () { fin(false); };
      openDlg('confirmDlg');
    });
  }

  /* ---------- settings (localStorage) ---------- */
  function cleanSettings(raw) {
    var s = Object.assign({}, C.DEFAULTS), r = raw && typeof raw === 'object' ? raw : {};
    ['basic', 'standard', 'otRate', 'bus', 'bonus'].forEach(function (k) { if (r[k] !== undefined && r[k] !== null && r[k] !== '' && Number.isFinite(Number(r[k])) && Number(r[k]) >= 0) s[k] = Number(r[k]); });
    ['paidLeave', 'paidHoliday', 'sickPaid', 'rentEnabled'].forEach(function (k) { if (typeof r[k] === 'boolean') s[k] = r[k]; });
    if (I.LANGS.indexOf(r.language) >= 0) s.language = r.language;
    if (['auto', 'light', 'dark'].indexOf(r.theme) >= 0) s.theme = r.theme;
    return s;
  }
  function loadSettings() { try { state.settings = cleanSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch (e) { state.settings = cleanSettings({}); } }
  function persistSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); return true; } catch (e) { toast(M('err_storage')); return false; } }
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.settings.theme);
    var m = document.querySelector('meta[name=theme-color]');
    if (m) m.setAttribute('content', state.settings.theme === 'light' ? '#f2f5f9' : '#101827');
  }

  /* ---------- IndexedDB ---------- */
  function idbOpen(name, version, upgrade) {
    return new Promise(function (res, rej) {
      var r = version ? indexedDB.open(name, version) : indexedDB.open(name);
      r.onupgradeneeded = function () { upgrade && upgrade(r.result); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
      r.onblocked = function () { rej(new Error('blocked')); };
    });
  }
  function ensureStores(d) { STORES.concat([LEGACY]).forEach(function (s) { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' }); }); }
  // Opens the existing database at whatever version it already has (never a lower one, never deletes anything).
  // Only adds a missing store by raising the version by one.
  async function openDB() {
    var d = await idbOpen(DB_NAME, 0, ensureStores);
    var missing = STORES.concat([LEGACY]).filter(function (s) { return !d.objectStoreNames.contains(s); });
    if (missing.length) { var v = d.version + 1; d.close(); d = await idbOpen(DB_NAME, v, ensureStores); }
    d.onversionchange = function () { d.close(); };
    return d;
  }
  function reqP(req) { return new Promise(function (res, rej) { req.onsuccess = function () { res(req.result); }; req.onerror = function () { rej(req.error); }; }); }
  function getAll(s) { return reqP(state.db.transaction(s, 'readonly').objectStore(s).getAll()).then(function (r) { return r || []; }); }
  function txDone(tx) { return new Promise(function (res, rej) { tx.oncomplete = function () { res(); }; tx.onabort = function () { rej(tx.error || new Error('aborted')); }; tx.onerror = function () { }; }); }
  function put(s, x) { var tx = state.db.transaction(s, 'readwrite'); tx.objectStore(s).put(x); return txDone(tx); }
  function del(s, id) { var tx = state.db.transaction(s, 'readwrite'); tx.objectStore(s).delete(id); return txDone(tx); }
  async function loadAll() { for (var i = 0; i < STORES.length; i++) state.data[STORES[i]] = await getAll(STORES[i]); }
  async function migrateLegacy() {
    try {
      if (localStorage.getItem('mst-migrated-v4')) return;
      var legacy = await getAll(LEGACY);
      for (var i = 0; i < legacy.length; i++) {
        var x = legacy[i];
        if (x && x.date && !state.data.work.some(function (y) { return y.date === x.date; })) await put('work', Object.assign({}, x, { id: x.id || uid() }));
      }
      localStorage.setItem('mst-migrated-v4', 'yes');
      state.data.work = await getAll('work');
    } catch (e) { /* legacy data is left untouched; app continues */ }
  }
  async function refresh() { await loadAll(); render(); }

  /* ---------- rendering ---------- */
  function row(title, sub, amount, kind, id) {
    var idt = typeof id === 'number' ? 'n' : 's';
    return '<div class="entry"><div class="entry-main"><strong>' + safe(title) + '</strong><small>' + safe(sub || '') + '</small></div>' +
      '<div class="entry-side"><strong>' + safe(amount) + '</strong><span class="entry-buttons"><button type="button" data-edit="' + kind + '" data-id="' + safe(id) + '" data-idt="' + idt + '">' + safe(tr('edit')) + '</button>' +
      '<button type="button" class="del" data-delete="' + kind + '" data-id="' + safe(id) + '" data-idt="' + idt + '">' + safe(tr('del')) + '</button></span></div></div>';
  }
  function findRec(kind, idAttr, idt) {            // exact match on text AND type, so numeric and text ids both work
    var list = state.data[kind] || [];
    for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(idAttr) && (!idt || (typeof list[i].id === 'number' ? 'n' : 's') === idt)) return list[i];
    return null;
  }
  function byDateDesc(a, b) { return String(b.date || '').localeCompare(String(a.date || '')); }
  function render() {
    var s = state.settings, m = viewMonth(), c = C.calcMonth(state.data, s, m), d = state.data;
    document.documentElement.lang = lang(); applyTheme();
    document.querySelectorAll('[data-t]').forEach(function (el) { el.textContent = tr(el.getAttribute('data-t')); });
    $('month').textContent = fmtMonth(m);
    $('earned').textContent = money(c.earned); $('days').textContent = c.workedDays; $('ot').textContent = numFmt(c.otHours) + ' h';
    $('formula').textContent = tr('fml', { basic: numFmt(s.basic), ot: numFmt(s.otRate) });
    $('received').textContent = money(c.salaryReceived); $('expTotal').textContent = money(c.expenses);
    var over = c.overpaid > 0;
    $('dueLbl').textContent = tr(over ? 'overpaid' : 'due'); $('due').textContent = money(over ? c.overpaid : c.outstanding);
    $('dueTile').classList.toggle('warn', over);
    $('busLine').textContent = c.busDue > 0
      ? tr('bus_line', { due: money(c.busDue), status: tr('bus_' + c.busStatus) }) + (c.busStatus === 'partial' ? ' · ' + tr('bus_left', { amount: money(c.busOutstanding) }) : '')
      : tr('bus_notdue');
    var tw = d.work.find(function (x) { return x.date === today(); });
    $('today').textContent = tw ? statusLabel(tw.status) + (C.normStatus(tw.status) === 'worked' ? ' · ' + numFmt(tw.hours) + ' h' : '') : tr('notRecorded');

    var mo = function (x) { return String(x.date || '').slice(0, 7) === m; };
    $('workList').innerHTML = d.work.filter(mo).sort(byDateDesc).map(function (x) {
      var p = C.dayParts(x, s), sub = numFmt(x.hours || 0) + ' h' + (p.otHours > 0 ? ' · ' + tr('ot') + ' ' + numFmt(p.otHours) + ' h' : '') + (p.status ? '' : ' · ' + tr('unknown_status'));
      return row(fmtDate(x.date) + ' · ' + statusLabel(x.status), sub, money(p.total), 'work', x.id);
    }).join('') || '<small class="empty">' + safe(tr('empty_work')) + '</small>';
    $('paymentList').innerHTML = d.payments.filter(function (x) { return (C.isMonth(x.month) ? x.month : String(x.date || '').slice(0, 7)) === m; }).sort(byDateDesc).map(function (x) {
      return row(fmtDate(x.date), tr('f_salaryMonth') + ': ' + fmtMonth(x.month || String(x.date).slice(0, 7)) + (C.num(x.bus) > 0 ? ' · ' + tr('f_bus').replace(' (€)', '') + ' ' + money(x.bus) : '') + (x.note ? ' · ' + x.note : ''), money(x.amount), 'payments', x.id);
    }).join('') || '<small class="empty">' + safe(tr('empty_payments')) + '</small>';
    $('expenseList').innerHTML = d.expenses.filter(mo).sort(byDateDesc).map(function (x) {
      var excl = C.isRent(x) && !s.rentEnabled;
      return row(fmtDate(x.date) + ' · ' + catLabel(x.category), (excl ? tr('rent_note') + ' ' : '') + (x.note || ''), money(x.amount), 'expenses', x.id);
    }).join('') || '<small class="empty">' + safe(tr('empty_expenses')) + '</small>';
    $('remitSummary').textContent = money(c.remitEur) + ' · ' + tr('fee_lbl') + ' ' + money(c.remitFee) + ' · ' + tr('bdt') + ' ' + numFmt(c.remitBdt);
    $('remitList').innerHTML = d.remittances.filter(mo).sort(byDateDesc).map(function (x) {
      var q = C.remitParts(x);
      return row(fmtDate(x.date) + ' · ' + (x.recipient || ''), tr('rate_lbl') + ' ' + numFmt(x.rate, 4) + ' · ' + tr('fee_lbl') + ' ' + money(q.fee) + ' · ' + tr('bonus_eur') + ' ' + money(q.bonusEur) + ' · ' + (q.actualBdt !== null ? tr('bdt') : tr('est_bdt')) + ' ' + numFmt(q.bdt), money(q.amount), 'remittances', x.id);
    }).join('') || '<small class="empty">' + safe(tr('empty_remit')) + '</small>';
    $('giftList').innerHTML = d.gifts.filter(mo).sort(byDateDesc).map(function (x) {
      return row(fmtDate(x.date) + ' · ' + (x.person || ''), x.note || '', money(x.amount, String(x.currency || 'EUR').toUpperCase()), 'gifts', x.id);
    }).join('') || '<small class="empty">' + safe(tr('empty_gifts')) + '</small>';

    ['basic', 'standard', 'otRate', 'bus', 'bonus'].forEach(function (k) { if (document.activeElement !== $(k)) $(k).value = s[k]; });
    ['paidLeave', 'paidHoliday', 'sickPaid', 'rentEnabled'].forEach(function (k) { $(k).checked = !!s[k]; });
    $('language').value = lang(); $('theme').value = s.theme;
    $('verLine').textContent = 'My Salary Tracker • ' + tr('ver') + ' ' + VERSION;
    $('aboutText').textContent = tr('about_text'); $('aboutVer').textContent = tr('ver') + ' ' + VERSION;
    renderBackupUi(); renderReport(); refreshMsgs();
  }

  /* ---------- reports ---------- */
  function periodInfo() {
    var t = state.rtype;
    if (t === 'month') return { type: 'month', key: viewMonth(), label: fmtMonth(viewMonth()) };
    if (t === 'year') return { type: 'year', key: String(state.ryear), label: String(state.ryear) };
    return { type: 'all', key: '', label: tr('r_all') };
  }
  function reportRows(tot) {
    var rows = [[tr('r_days'), String(tot.workedDays)], [tr('r_wages'), money(tot.wages)], [tr('r_otPay'), money(tot.otPay)], [tr('r_otHours'), numFmt(tot.otHours) + ' h'], [tr('r_earned'), money(tot.earned), 'hl'],
      [tr('r_received'), money(tot.salaryReceived)], [tr('r_outstanding'), money(tot.outstanding), tot.outstanding > 0 ? 'hl' : '']];
    if (tot.overpaid > 0) rows.push([tr('r_overpaid'), money(tot.overpaid), 'warn']);
    rows.push([tr('r_busDue'), money(tot.busDue)], [tr('r_busRecv'), money(tot.busReceived)], [tr('r_busOut'), money(tot.busOutstanding)]);
    if (tot.busStatus) rows.push([tr('r_busStatus'), tr('bus_' + tot.busStatus)]);
    rows.push([tr('r_totalReceived'), money(tot.paymentsTotal)], [tr('r_expenses'), money(tot.expenses)]);
    if (tot.rentExcluded > 0) rows.push([tr('r_rentExcl'), money(tot.rentExcluded)]);
    rows.push([tr('r_remitted'), money(tot.remitEur)], [tr('r_bdt'), numFmt(tot.remitBdt) + ' BDT'], [tr('r_giftEur'), money(tot.giftEur)], [tr('r_giftBdt'), money(tot.giftBdt, 'BDT')], [tr('r_balance'), money(tot.balance), 'hl']);
    return rows;
  }
  function reportChart(info, per) {
    var W = 340, H = 150, series = [{ n: tr('r_earned'), c: 'var(--accent)', k: 'earned' }, { n: tr('r_received'), c: 'var(--blue)', k: 'salaryReceived' }, { n: tr('r_expenses'), c: 'var(--danger)', k: 'expenses' }], groups;
    if (info.type === 'month') {
      var t = per.total, items = [[tr('r_earned'), t.earned, 'var(--accent)'], [tr('r_received'), t.salaryReceived, 'var(--blue)'], [tr('r_expenses'), t.expenses, 'var(--danger)'], [tr('r_remitted'), t.remitEur, 'var(--warn)'], [tr('r_giftEur'), t.giftEur, 'var(--muted)']];
      var max = Math.max.apply(null, items.map(function (i) { return i[1]; }).concat([1])), h = '<svg class="chart" viewBox="0 0 340 ' + (items.length * 28 + 6) + '" role="img" aria-label="' + safe(tr('r_chart')) + '">';
      items.forEach(function (it, i) { var w = Math.max(1, Math.round(it[1] / max * 170)); h += '<text x="0" y="' + (i * 28 + 14) + '">' + safe(it[0]) + '</text><rect x="120" y="' + (i * 28 + 4) + '" width="' + w + '" height="14" rx="4" style="fill:' + it[2] + '"/><text x="' + (126 + w) + '" y="' + (i * 28 + 15) + '">' + safe(numFmt(it[1], 0)) + '</text>'; });
      return h + '</svg>';
    }
    if (info.type === 'year') groups = per.months.map(function (m) { return { l: fmtMonth(m.month, true), v: m }; });
    else { var years = {}; C.monthsIn(state.data).forEach(function (m) { years[m.slice(0, 4)] = 1; }); groups = Object.keys(years).sort().map(function (y) { return { l: y, v: C.calcPeriod(state.data, state.settings, 'year', y).total }; }); }
    if (!groups.length) return '';
    var mx = Math.max.apply(null, groups.map(function (g) { return Math.max(g.v.earned, g.v.salaryReceived, g.v.expenses); }).concat([1])), gw = (W - 10) / groups.length, bw = Math.max(2, Math.min(10, (gw - 4) / 3));
    var svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + (H + 22) + '" role="img" aria-label="' + safe(tr('r_chart')) + '">';
    groups.forEach(function (g, gi) {
      series.forEach(function (s, si) { var v = g.v[s.k], bh = Math.round(v / mx * H); svg += '<rect x="' + (5 + gi * gw + si * bw) + '" y="' + (H - bh) + '" width="' + bw + '" height="' + bh + '" rx="1.5" style="fill:' + s.c + '"/>'; });
      svg += '<text x="' + (5 + gi * gw) + '" y="' + (H + 14) + '">' + safe(g.l) + '</text>';
    });
    svg += '</svg><div class="legend">' + series.map(function (s) { return '<span><i style="background:' + s.c + '"></i>' + safe(s.n) + '</span>'; }).join('') + '</div>';
    return svg;
  }
  function currentReport() { var info = periodInfo(), per = C.calcPeriod(state.data, state.settings, info.type, info.key); return { info: info, per: per }; }
  function renderReport() {
    var r = currentReport();
    document.querySelectorAll('[data-rtype]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-rtype') === state.rtype)); });
    $('repNav').style.display = state.rtype === 'year' ? 'flex' : 'none';
    $('repLabel').textContent = r.info.label;
    var html = state.rtype === 'month' ? '<p class="muted" style="margin:6px 0 0"><strong>' + safe(r.info.label) + '</strong></p>' : '';
    html += '<table class="report-table"><tbody>' + reportRows(r.per.total).map(function (x) { return '<tr class="' + (x[2] || '') + '"><td>' + safe(x[0]) + '</td><td>' + safe(x[1]) + '</td></tr>'; }).join('') + '</tbody></table>';
    html += reportChart(r.info, r.per) + '<p class="note">' + safe(tr('net_note')) + '</p>' + (r.per.total.rentExcluded > 0 ? '<p class="note">' + safe(tr('rent_note')) + '</p>' : '');
    $('reportBody').innerHTML = html;
  }

  /* ---------- forms ---------- */
  var NUM = { step: '0.01', min: '0' };
  var FIELDS = {
    work: [['date', 'f_date', 'date', 1], ['status', 'f_status', 'status', 1], ['hours', 'f_hours', 'number', 0, { step: '0.25', min: '0', max: '24' }]],
    payments: [['date', 'f_payDate', 'date', 1], ['month', 'f_salaryMonth', 'month', 1], ['amount', 'f_amountRecv', 'number', 1, NUM], ['bus', 'f_bus', 'number', 0, NUM], ['note', 'f_note', 'text', 0]],
    expenses: [['date', 'f_date', 'date', 1], ['category', 'f_category', 'category', 1], ['amount', 'f_amount', 'number', 1, NUM], ['note', 'f_note', 'text', 0]],
    remittances: [['date', 'f_date', 'date', 1], ['recipient', 'f_recipient', 'text', 1], ['amount', 'f_sent', 'number', 1, NUM], ['rate', 'f_rate', 'number', 1, { step: '0.0001', min: '0' }], ['fee', 'f_fee', 'number', 0, NUM], ['bonus', 'f_bonus', 'number', 0, { step: '0.1', min: '0' }], ['actualBdt', 'f_actualBdt', 'number', 0, NUM], ['note', 'f_note', 'text', 0]],
    gifts: [['date', 'f_date', 'date', 1], ['person', 'f_person', 'text', 1], ['currency', 'f_currency', 'currency', 1], ['amount', 'f_amount', 'number', 1, NUM], ['note', 'f_note', 'text', 0]]
  };
  function defaultDate() { var t = today(); return t.slice(0, 7) === viewMonth() ? t : viewMonth() + '-01'; }
  function openForm(kind, old) {
    old = old || {}; state.edit = { kind: kind, id: old.id === undefined ? null : old.id }; setMsg('formErr', null);
    $('dlgTitle').textContent = tr((old.id ? 'edit_' : 'add_') + kind);
    var box = $('fields'); box.innerHTML = '';
    FIELDS[kind].forEach(function (f) {
      var key = f[0], type = f[2], wrap = document.createElement('label'), span = document.createElement('span'), input;
      span.textContent = tr(f[1]); wrap.appendChild(span);
      var val = old[key];
      if (type === 'status' || type === 'category' || type === 'currency') {
        input = document.createElement('select');
        var opts = type === 'status' ? C.STATUSES.map(function (k) { return [k, tr('st_' + k)]; }) : type === 'category' ? catKeys().map(function (k) { return [k, tr('cat_' + k)]; }) : [['EUR', 'EUR'], ['BDT', 'BDT']];
        if (type === 'status' && val != null && C.normStatus(val)) val = C.normStatus(val);
        if (type === 'category' && val != null) { var lk = String(val).trim().toLowerCase(); if (T.en['cat_' + lk]) val = lk; if (val === 'rent' && opts.every(function (o) { return o[0] !== 'rent'; })) opts.push(['rent', tr('cat_rent')]); }
        if (type === 'currency' && val != null) val = String(val).toUpperCase();
        if (val != null && val !== '' && opts.every(function (o) { return o[0] !== val; })) opts.push([val, String(val) + ' ⚠']);   // keep unknown old values instead of losing them
        opts.forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; input.appendChild(op); });
        if (val == null || val === '') val = type === 'status' ? 'worked' : type === 'category' ? 'food' : 'EUR';
      } else {
        input = document.createElement('input'); input.type = type;
        if (type === 'number') { input.inputMode = 'decimal'; var a = f[4] || {}; Object.keys(a).forEach(function (n) { input.setAttribute(n, a[n]); }); }
        if (val == null) val = { date: defaultDate(), month: viewMonth(), hours: 8, bonus: state.settings.bonus, fee: 0, bus: 0 }[key]; if (val == null || (type === 'number' && val === null)) val = '';
      }
      input.name = key; input.value = val; if (f[3]) input.required = true;
      wrap.appendChild(input); box.appendChild(wrap);
    });
    $('deleteBtn').hidden = old.id === undefined; openDlg('editDialog');
  }
  function formVal(name) { var el = $('fields').querySelector('[name="' + name + '"]'); return el ? el.value.trim() : ''; }
  function numOrNull(v) { if (v === '') return null; var n = Number(v); return Number.isFinite(n) ? n : NaN; }
  async function saveForm(e) {
    e.preventDefault(); if (!state.edit) return;
    var kind = state.edit.kind, old = state.edit.id != null ? (state.data[kind].find(function (x) { return x.id === state.edit.id; }) || {}) : {}, v = {};
    function fail(k) { setMsg('formErr', M(k)); return false; }
    FIELDS[kind].forEach(function (f) { var raw = formVal(f[0]); v[f[0]] = f[2] === 'number' ? numOrNull(raw) : raw; });
    if (!C.isDate(v.date)) return fail('err_date');
    if (kind === 'work') {
      var worked = v.status === 'worked';
      if (worked) { if (v.hours === null || Number.isNaN(v.hours) || v.hours < 0 || v.hours > 24) return fail('err_hours'); } else v.hours = 0;
      if (state.data.work.some(function (x) { return x.date === v.date && x.id !== old.id; })) return fail('err_dup');
    } else {
      if (!(v.amount > 0)) return fail('err_amount');
    }
    if (kind === 'payments') {
      if (!C.isMonth(v.month)) return fail('err_month');
      if (Number.isNaN(v.bus)) return fail('err_amount'); v.bus = v.bus || 0;
      if (v.bus < 0 || v.bus > v.amount) return fail('err_bus');
    }
    if (kind === 'remittances') {
      if (!(v.rate > 0)) return fail('err_rate'); if (!v.recipient) return fail('err_amount');
      if (Number.isNaN(v.fee) || Number.isNaN(v.bonus) || Number.isNaN(v.actualBdt)) return fail('err_amount');
      v.fee = v.fee || 0; v.bonus = v.bonus === null ? state.settings.bonus : v.bonus;
      if (v.fee < 0 || v.bonus < 0 || (v.actualBdt !== null && v.actualBdt < 0)) return fail('err_amount');
      if (v.fee > v.amount) return fail('err_fee');
      v.actualBdt = v.actualBdt > 0 ? v.actualBdt : null;
      var q = C.remitParts(v); v.bonusAmount = q.bonusEur; v.bdt = q.bdt;
    }
    if (kind === 'gifts' && !v.person) return fail('err_amount');
    if (kind === 'expenses' && !v.category) v.category = 'other';
    var record = Object.assign({}, old, v, { id: old.id || uid() });
    try { await put(kind, record); closeDlg('editDialog'); state.edit = null; await refresh(); }
    catch (e2) { setMsg('formErr', M('err_storage', null, ': ' + (e2 && e2.message || e2))); }
  }
  async function deleteRecord(kind, rec) {
    if (!rec) { toast(M('err_delete')); return false; }
    var ok = await askConfirm(tr('del_title'), tr('del_msg'), tr('del_ok')); if (!ok) return false;
    try {
      await del(kind, rec.id); await loadAll();
      if (findRec(kind, rec.id, typeof rec.id === 'number' ? 'n' : 's')) { render(); toast(M('err_delete')); return false; }     // IndexedDB says "ok" even when nothing was deleted, so check
      render(); return true;
    } catch (e) { toast(M('err_storage', null, ': ' + (e && e.message || e))); return false; }
  }

  /* ---------- files: backup, raw export, CSV ---------- */
  async function saveFile(name, content, mime) {
    var blob = new Blob([content], { type: mime });
    try {
      var f = new File([blob], name, { type: mime });
      if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: name }); return true; }
    } catch (e) { if (e && e.name === 'AbortError') return false; }
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { try { URL.revokeObjectURL(a.href); } catch (e) { } }, 4000); return true;
  }
  function buildBackup() {
    var st = {}; STORES.forEach(function (s) { st[s] = state.data[s]; });
    return { app: 'My Salary Tracker', format: 2, version: VERSION, exportedAt: new Date().toISOString(), stores: st, settings: state.settings };
  }
  async function freshData() { if (state.db) { try { await loadAll(); } catch (e) { /* keep the in-memory copy */ } } }   // another window may have written since this one loaded
  async function doBackup() {
    await freshData();
    var ok = await saveFile('salary-tracker-backup-' + today() + '.json', JSON.stringify(buildBackup(), null, 2), 'application/json');
    if (ok) { markBackup(); toast(M('b_saved')); renderBackupUi(); }
    return ok;
  }
  async function doRaw() {
    try {
      var out = { app: 'My Salary Tracker', kind: 'recovery-export', exportedAt: new Date().toISOString(), version: VERSION, dbVersion: state.db ? state.db.version : null, stores: {}, localStorage: {} };
      if (state.db) for (var i = 0; i < state.db.objectStoreNames.length; i++) { var n = state.db.objectStoreNames[i]; out.stores[n] = await getAll(n); }
      for (var j = 0; j < localStorage.length; j++) { var k = localStorage.key(j); out.localStorage[k] = localStorage.getItem(k); }
      if (await saveFile('salary-tracker-recovery-' + today() + '.json', JSON.stringify(out, null, 2), 'application/json')) toast(M('b_saved'));
    } catch (e) { toast(M('err_storage', null, ': ' + (e && e.message || e))); }
  }
  function csvCell(v, isText) { var s = String(v == null ? '' : v); if (isText && /^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; }
  function csvText(rows, textCols) { return '\ufeff' + rows.map(function (r, ri) { return r.map(function (v, ci) { return csvCell(v, ri > 0 && textCols.indexOf(ci) >= 0); }).join(','); }).join('\r\n'); }
  function buildCsvAll() {
    var rows = [['kind', 'date', 'salary_month', 'type_or_category', 'name', 'amount', 'currency', 'hours', 'earned_eur', 'fee_eur', 'rate_bdt_per_eur', 'bonus_percent', 'bdt', 'note']], d = state.data, s = state.settings;
    d.work.slice().sort(byDateDesc).reverse().forEach(function (x) { var p = C.dayParts(x, s); rows.push(['work', x.date, '', x.status, '', '', 'EUR', x.hours || 0, p.total, '', '', '', '', x.note || '']); });
    d.payments.forEach(function (x) { rows.push(['payment', x.date, x.month || '', '', '', x.amount, 'EUR', '', '', '', '', '', '', ((C.num(x.bus) > 0 ? 'bus included ' + x.bus + '; ' : '') + (x.note || ''))]); });
    d.expenses.forEach(function (x) { rows.push(['expense', x.date, '', x.category, '', x.amount, 'EUR', '', '', '', '', '', '', x.note || '']); });
    d.remittances.forEach(function (x) { var q = C.remitParts(x); rows.push(['remittance', x.date, '', '', x.recipient, x.amount, 'EUR', '', '', q.fee, x.rate, x.bonus, q.bdt, x.note || '']); });
    d.gifts.forEach(function (x) { rows.push(['money_given', x.date, '', '', x.person, x.amount, String(x.currency || 'EUR').toUpperCase(), '', '', '', '', '', '', x.note || '']); });
    return csvText(rows, [3, 4, 13]);
  }
  function buildCsvReport() {
    var r = currentReport(), rows = [['period', 'item', 'value']];
    reportRows(r.per.total).forEach(function (x) { rows.push([r.info.label, x[0], x[1]]); });
    return csvText(rows, [1]);
  }

  /* ---------- restore (validate -> safety backup -> all-or-nothing write) ---------- */
  function validateBackup(p) {
    var r = R.validateBackup(p); if (!r.ok) return r;
    r.settings = r.rawSettings ? cleanSettings(Object.assign({}, state.settings, r.rawSettings)) : null;
    return r;
  }
  function describeErr(e) {                         // human text in the CURRENT language
    var where = e.field && !e.store ? (({ basic: 's_basic', standard: 's_standard', otRate: 's_ot', bus: 's_bus', bonus: 's_bonus' })[e.field] ? tr(({ basic: 's_basic', standard: 's_standard', otRate: 's_ot', bus: 's_bus', bonus: 's_bonus' })[e.field]) : e.field)
      : (e.store ? tr(e.store === 'work' ? 'workRecords' : e.store === 'payments' ? 'payments' : e.store === 'expenses' ? 'expenses' : e.store === 'remittances' ? 'remit' : 'given') + (e.n ? ' #' + e.n : '') : '');
    return tr(e.key, { where: where });
  }
  function writeAll(payload, replace) {
    return new Promise(function (resolve, reject) {
      var tx;
      try { tx = state.db.transaction(STORES, 'readwrite'); } catch (e) { return reject(e); }
      tx.oncomplete = function () { resolve(); };
      tx.onabort = function () { reject(tx.error || new Error('aborted')); };
      tx.onerror = function () { };
      try { STORES.forEach(function (s) { var os = tx.objectStore(s); if (replace) os.clear(); (payload[s] || []).forEach(function (x) { os.put(x); }); }); }
      catch (e) { try { tx.abort(); } catch (_) { } reject(e); }
    });
  }
  async function onRestoreFile(e) {
    var input = e.target, f = input.files && input.files[0]; if (!f) return;
    try {
      var parsed; try { parsed = JSON.parse(await f.text()); } catch (er) { toast(M('b_invalid')); return; }
      var v = validateBackup(parsed); if (!v.ok) { toast(M('b_invalid', null, function () { return ' (' + describeErr(v.err) + ')'; })); return; }
      state.pending = { v: v, name: f.name, safety: false };
      $('rsInfo').innerHTML = '<div>' + safe(tr('b_file')) + ': <strong>' + safe(f.name) + '</strong></div>' + (v.exportedAt ? '<div>' + safe(tr('b_exported')) + ': ' + safe(v.exportedAt.slice(0, 16).replace('T', ' ')) + '</div>' : '') +
        '<div>' + STORES.map(function (s) { return safe(tr(s === 'work' ? 'workRecords' : s === 'payments' ? 'payments' : s === 'expenses' ? 'expenses' : s === 'remittances' ? 'remit' : 'given')) + ': ' + v.counts[s]; }).join('<br>') + '</div>';
      $('rsSafety').textContent = tr('b_safety'); $('rsSafety').classList.remove('step-done');
      $('rsMerge').textContent = tr('b_merge'); $('rsReplace').textContent = tr('b_replace'); $('rsMerge').disabled = $('rsReplace').disabled = true;
      $('rsMergeHint').textContent = tr('b_mergeHint'); $('rsReplaceHint').textContent = tr('b_replaceHint'); setMsg('rsErr', null);
      var plan = R.planMerge(v.payload, state.data.work), notes = '';
      if (v.warnings.dupDates > 0) notes += '<div class="restore-warn">' + safe(tr('b_dupWarn', { n: v.warnings.dupDates })) + '</div>';
      if (plan.skipped > 0) notes += '<div class="restore-warn">' + safe(tr('b_skipped', { n: plan.skipped })) + '</div>';
      $('rsInfo').insertAdjacentHTML('beforeend', notes);
      openDlg('restoreDlg');
    } finally { input.value = ''; }
  }
  async function doSafety() {
    await freshData();
    var json = JSON.stringify(buildBackup(), null, 2);
    try { localStorage.setItem('mst-safety-backup', json); } catch (e) { /* too big or blocked: the file copy below is the real safety net */ }
    var ok = await saveFile('salary-tracker-safety-' + today() + '.json', json, 'application/json');
    if (ok && state.pending) { state.pending.safety = true; $('rsSafety').textContent = tr('b_safetyDone'); $('rsSafety').classList.add('step-done'); $('rsMerge').disabled = $('rsReplace').disabled = false; }
  }
  async function doRestore(replace) {
    var pend = state.pending; if (!pend || !pend.safety) return;
    if (replace && !(await askConfirm(tr('b_replace'), tr('b_replaceHint'), tr('b_replace')))) return;
    try {
      var payload = pend.v.payload, skipped = 0;
      if (!replace) { var plan = R.planMerge(payload, await getAll('work')); payload = plan.payload; skipped = plan.skipped; }
      await writeAll(payload, replace);                                  // one transaction: all or nothing
      if (pend.v.settings) { state.settings = pend.v.settings; persistSettings(); }
      state.pending = null; closeDlg('restoreDlg'); await refresh();
      toast(function () { return tr(replace ? 'b_doneReplace' : 'b_doneMerge') + (skipped > 0 ? ' ' + tr('b_skipped', { n: skipped }) : ''); });
    } catch (e) { setMsg('rsErr', M('b_fail', null, ' (' + (e && e.message || e) + ')')); try { await refresh(); } catch (_) { } }
  }

  /* ---------- storage protection, backup reminder, update offer ---------- */
  function getLastBackup() { try { var v = localStorage.getItem(LAST_BACKUP_KEY), t = v ? Date.parse(v) : NaN; return isNaN(t) ? null : new Date(t); } catch (e) { return null; } }
  function markBackup() { try { localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString()); } catch (e) { } }
  function totalRecords() { return STORES.reduce(function (n, s) { return n + (state.data[s] || []).length; }, 0); }
  function fmtStamp(d) { try { return new Intl.DateTimeFormat(loc(), { dateStyle: 'medium', timeStyle: 'short' }).format(d); } catch (e) { return d.toISOString().slice(0, 16).replace('T', ' '); } }
  function fmtMB(bytes) { var mb = C.num(bytes) / 1048576; return mb > 0 && mb < 0.1 ? '<0.1 MB' : numFmt(mb, 1) + ' MB'; }
  async function initStorage() {
    var st = { supported: false, persisted: false, usage: null, quota: null };
    try {
      var sg = navigator.storage;
      if (sg && (sg.persisted || sg.persist)) {
        st.supported = true;
        st.persisted = sg.persisted ? !!(await sg.persisted()) : false;
        if (!st.persisted && sg.persist) st.persisted = !!(await sg.persist());
      }
      if (sg && sg.estimate) { var e = await sg.estimate(); st.usage = e.usage; st.quota = e.quota; }
    } catch (e) { }
    state.storage = st;
  }
  async function askPersist() {
    var granted = false;
    try { if (navigator.storage && navigator.storage.persist) granted = !!(await navigator.storage.persist()); } catch (e) { }
    await initStorage(); renderBackupUi();
    setMsg('persistMsg', M(granted ? 'st_request_ok' : 'st_request_no'));
  }
  function renderBackupUi() {
    var last = getLastBackup(), st = state.storage;
    // Settings: storage box
    var pt = !st ? '…' : !st.supported ? tr('st_persist_na') : st.persisted ? tr('st_persist_yes') : tr('st_persist_no');
    $('stPersist').textContent = pt;
    $('stUsed').textContent = !st || st.usage == null ? tr('st_unknown') : fmtMB(st.usage) + (st.quota ? ' / ' + numFmt(st.quota / 1073741824, 1) + ' GB' : '');
    $('stLast').textContent = last ? fmtStamp(last) : tr('st_never');
    $('persistBtn').hidden = !!(st && (!st.supported || st.persisted));
    $('bkLast').textContent = tr('st_lastBackup') + ': ' + (last ? fmtStamp(last) : tr('st_never'));
    // Banner
    var snooze = ''; try { snooze = localStorage.getItem(SNOOZE_KEY) || ''; } catch (e) { }
    var b = R.backupStatus({ last: last, snooze: snooze, today: today(), hasRecords: totalRecords() > 0, now: new Date() });
    $('backupBanner').hidden = !b.show;
    if (b.show) $('bannerText').textContent = b.never ? tr('b_never') : tr('b_overdue', { date: fmtStamp(b.last) });
    $('updLastLine').textContent = tr('st_lastBackup') + ': ' + (last ? fmtStamp(last) : tr('st_never'));
  }
  function maybeShowUpdate() {                      // never interrupts a dialog the person is using
    if (document.querySelector('dialog[open]')) { state.updatePending = true; return; }
    state.updatePending = false; $('updBackup').classList.remove('step-done'); $('updBackup').textContent = tr('upd_backup'); renderBackupUi(); openDlg('updateDlg');
  }

  /* ---------- events ---------- */
  function bind() {
    $('menuBtn').onclick = function () { openDlg('menu'); };
    document.querySelectorAll('[data-target]').forEach(function (b) { b.onclick = function () { closeDlg('menu'); var id = b.getAttribute('data-target'); if (id === 'top') window.scrollTo({ top: 0, behavior: 'smooth' }); else { var el = $(id); el && el.scrollIntoView({ behavior: 'smooth' }); } }; });
    $('aboutBtn').onclick = function () { closeDlg('menu'); openDlg('aboutDlg'); };
    document.addEventListener('click', function (e) {
      var cl = e.target.closest('.closeDlg'); if (cl) { var dd = cl.closest('dialog'); if (dd) { if (dd.close) dd.close(); else dd.removeAttribute('open'); } return; }
      var d = e.target.closest('[data-delete]'); if (d) { var dk = d.getAttribute('data-delete'); deleteRecord(dk, findRec(dk, d.getAttribute('data-id'), d.getAttribute('data-idt'))); return; }
      var b = e.target.closest('[data-edit]'); if (b) { var k = b.getAttribute('data-edit'); openForm(k, findRec(k, b.getAttribute('data-id'), b.getAttribute('data-idt')) || {}); return; }
      var j = e.target.closest('[data-jump]'); if (j) { var t = $(j.getAttribute('data-jump')); t && t.scrollIntoView({ behavior: 'smooth' }); }
    });
    $('record').onclick = function () { var tw = state.data.work.find(function (x) { return x.date === today(); }); openForm('work', tw || { date: today() }); };
    $('addWork').onclick = function () { openForm('work'); }; $('addPayment').onclick = function () { openForm('payments'); }; $('addExpense').onclick = function () { openForm('expenses'); };
    $('addRemit').onclick = function () { openForm('remittances'); }; $('addGift').onclick = function () { openForm('gifts'); };
    $('editForm').addEventListener('submit', saveForm);
    $('editDialog').addEventListener('close', function () { state.edit = null; });
    $('deleteBtn').onclick = async function () { if (state.edit && state.edit.id != null) { var k = state.edit.kind, rec = state.data[k].find(function (x) { return x.id === state.edit.id; }); closeDlg('editDialog'); await deleteRecord(k, rec); } };
    $('prev').onclick = function () { state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1); render(); };
    $('next').onclick = function () { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1); render(); };
    document.querySelectorAll('[data-rtype]').forEach(function (b) { b.onclick = function () { state.rtype = b.getAttribute('data-rtype'); if (state.rtype === 'year') state.ryear = state.month.getFullYear(); renderReport(); }; });
    $('rPrev').onclick = function () { state.ryear--; renderReport(); }; $('rNext').onclick = function () { state.ryear++; renderReport(); };
    $('language').onchange = function () { state.settings.language = $('language').value; persistSettings(); render(); };
    $('theme').onchange = function () { state.settings.theme = $('theme').value; persistSettings(); render(); };
    $('saveSettings').onclick = function () {
      var vals = {}, ok = true;
      ['basic', 'standard', 'otRate', 'bus', 'bonus'].forEach(function (k) { var raw = $(k).value.trim(), n = Number(raw); if (raw === '' || !Number.isFinite(n) || n < 0) ok = false; vals[k] = n; });
      if (vals.standard > 24) ok = false;
      if (!ok) { setMsg('settingsMsg', M('err_settings')); return; }
      setMsg('settingsMsg', null); Object.assign(state.settings, vals);
      ['paidLeave', 'paidHoliday', 'sickPaid', 'rentEnabled'].forEach(function (k) { state.settings[k] = $(k).checked; });
      if (persistSettings()) { render(); toast(M('saved')); }
    };
    $('backup').onclick = doBackup; $('raw').onclick = doRaw;
    $('persistBtn').onclick = askPersist;
    $('bannerExport').onclick = async function () { await doBackup(); };
    $('bannerLater').onclick = function () { try { localStorage.setItem(SNOOZE_KEY, today()); } catch (e) { } renderBackupUi(); };
    $('updBackup').onclick = async function () { if (await doBackup()) { $('updBackup').classList.add('step-done'); $('updBackup').textContent = tr('b_saved'); } };
    $('updReload').onclick = function () { location.reload(); };
    document.addEventListener('close', function () { if (state.updatePending && !document.querySelector('dialog[open]')) maybeShowUpdate(); }, true);
    $('restore').onclick = function () { $('file').click(); }; $('file').onchange = onRestoreFile;
    $('rsSafety').onclick = doSafety; $('rsMerge').onclick = function () { doRestore(false); }; $('rsReplace').onclick = function () { doRestore(true); };
    $('rsCancel').onclick = function () { state.pending = null; closeDlg('restoreDlg'); };
    $('csv').onclick = function () { saveFile('salary-tracker-' + today() + '.csv', buildCsvAll(), 'text/csv'); };
    $('csvReport').onclick = function () { saveFile('salary-tracker-report-' + today() + '.csv', buildCsvReport(), 'text/csv'); };
    $('print').onclick = function () {
      var r = currentReport();
      $('printArea').innerHTML = '<h1>' + safe(tr('print_title')) + '</h1><p class="muted">' + safe(tr('r_report')) + ': ' + safe(r.info.label) + '</p><table><tbody>' + reportRows(r.per.total).map(function (x) { return '<tr><td>' + safe(x[0]) + '</td><td>' + safe(x[1]) + '</td></tr>'; }).join('') + '</tbody></table>' + reportChart(r.info, r.per) + '<p class="muted">' + safe(tr('net_note')) + '</p>';
      window.print();
    };
    window.addEventListener('afterprint', function () { $('printArea').innerHTML = ''; });
  }

  /* ---------- start ---------- */
  async function init() {
    loadSettings(); applyTheme(); bind(); render();
    try { state.db = await openDB(); await loadAll(); await migrateLegacy(); }
    catch (e) { state.dbError = e; toast(M('err_storage', null, ': ' + (e && e.message || e))); }
    render();
    initStorage().then(function () { renderBackupUi(); });
    if ('serviceWorker' in navigator) {
      try {
        navigator.serviceWorker.register('./service-worker.js').then(function (reg) {
          reg.addEventListener('updatefound', function () { var nw = reg.installing; if (nw) nw.addEventListener('statechange', function () { if (nw.state === 'installed' && navigator.serviceWorker.controller) maybeShowUpdate(); }); });
        }).catch(function () { });
      } catch (e) { }
    }
  }
  window.MSTReady = init();
  window.MSTDebug = { state: state, validateBackup: validateBackup, buildBackup: buildBackup, buildCsvAll: buildCsvAll, writeAll: writeAll, planMerge: R.planMerge };
})();
