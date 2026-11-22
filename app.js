/* My Salary Tracker v9.2.2 - all data stays on this device (IndexedDB + localStorage). No network requests are made by this file. */
(function () {
  'use strict';
  var C = window.MSTCalc, I = window.MSTi18n, R = window.MSTRules, T = I.T;
  var VERSION = '9.2.2';
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

  /* ---------- live date & time ---------- */
  /* Only the two small clock elements are touched each second; render() is never called for a tick (except once when midnight passes,
     so "Today's duty" and the default dates move to the new day). Uses the device's local time zone and the selected language. */
  var clockFmt = { lang: '', date: null, time: null }, clockShown = { d: '', t: '' }, clockDay = '', clockTimer = null;
  function clockFormats() {
    var l = lang();
    if (clockFmt.lang !== l) clockFmt = { lang: l, date: new Intl.DateTimeFormat(loc(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), time: new Intl.DateTimeFormat(loc(), { hour: '2-digit', minute: '2-digit', second: '2-digit' }) };
    return clockFmt;
  }
  function tickClock() {
    var now = new Date(), d, t;
    try { var f = clockFormats(); d = f.date.format(now); t = f.time.format(now); }
    catch (e) { d = C.dateKey(now); t = now.toTimeString().slice(0, 8); }
    if (d !== clockShown.d) { $('clockDate').textContent = d; clockShown.d = d; }
    if (t !== clockShown.t) { $('clockTime').textContent = t; clockShown.t = t; }
    var dk = C.dateKey(now), changed = clockDay !== '' && dk !== clockDay; clockDay = dk;
    if (changed) render();
  }
  function clockLoop() { tickClock(); clockTimer = setTimeout(clockLoop, 1000 - (Date.now() % 1000) + 15); }
  function startClock() { clearTimeout(clockTimer); clockLoop(); }
  function stopClock() { clearTimeout(clockTimer); clockTimer = null; }

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
  // Work records: the one-record-per-date check and the write happen inside ONE transaction, against the data stored on disk
  // (not the on-screen copy), so a double tap or a second open window can never create a second record for the same day.
  function putWork(rec) {
    return new Promise(function (resolve, reject) {
      var tx; try { tx = state.db.transaction('work', 'readwrite'); } catch (e) { return reject(e); }
      var os = tx.objectStore('work'), dup = false, rq = os.getAll();
      tx.oncomplete = function () { resolve(); };
      tx.onabort = function () { var err = dup ? new Error('duplicate date') : (tx.error || new Error('aborted')); err.dup = dup; reject(err); };
      tx.onerror = function () { };
      rq.onsuccess = function () {
        var clash = (rq.result || []).some(function (x) { return x.date === rec.date && x.id !== rec.id; });
        if (clash) { dup = true; try { tx.abort(); } catch (e) { } return; }
        os.put(rec);
      };
    });
  }
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
  function designWords() {
    var maps = {
      en: {quick:'Quick Actions',work:'Add Work',ot:'Add OT',salary:'Salary',expense:'Expense',remit:'Send Home',gift:'Give Money',balance:'Salary & Expenses',balanceSub:'Income, expenses and savings comparison',recent:'Recent Transactions',add:'Add',home:'Home',money:'Money',saved:'Estimated savings'},
      bn: {quick:'Quick Actions',work:'কাজ যোগ',ot:'OT যোগ',salary:'বেতন',expense:'খরচ',remit:'পরিবারে পাঠানো',gift:'অন্যদের দেওয়া',balance:'বেতন ও খরচ',balanceSub:'আয়, খরচ ও সঞ্চয়ের তুলনা',recent:'সাম্প্রতিক লেনদেন',add:'যোগ',home:'হোম',money:'টাকা',saved:'আনুমানিক সঞ্চয়'},
      tr: {quick:'Hızlı İşlemler',work:'İş Ekle',ot:'Mesai Ekle',salary:'Maaş',expense:'Gider',remit:'Aileye Gönder',gift:'Para Ver',balance:'Maaş ve Giderler',balanceSub:'Gelir, gider ve tasarruf karşılaştırması',recent:'Son İşlemler',add:'Ekle',home:'Ana Sayfa',money:'Para',saved:'Tahmini birikim'},
      bg: {quick:'Бързи действия',work:'Добави работа',ot:'Добави извънредно',salary:'Заплата',expense:'Разход',remit:'Изпрати на семейството',gift:'Дари пари',balance:'Заплата и разходи',balanceSub:'Сравнение на доходи, разходи и спестявания',recent:'Последни транзакции',add:'Добави',home:'Начало',money:'Пари',saved:'Очаквани спестявания'},
      hi: {quick:'त्वरित कार्रवाइयाँ',work:'काम जोड़ें',ot:'ओटी जोड़ें',salary:'वेतन',expense:'खर्च',remit:'परिवार को भेजें',gift:'पैसे दें',balance:'वेतन और खर्च',balanceSub:'आय, खर्च और बचत की तुलना',recent:'हाल के लेनदेन',add:'जोड़ें',home:'होम',money:'पैसा',saved:'अनुमानित बचत'},
      el: {quick:'Γρήγορες ενέργειες',work:'Προσθήκη εργασίας',ot:'Προσθήκη υπερωρίας',salary:'Μισθός',expense:'Έξοδο',remit:'Αποστολή στην οικογένεια',gift:'Δωρεά',balance:'Μισθός και έξοδα',balanceSub:'Σύγκριση εσόδων, εξόδων και αποταμίευσης',recent:'Πρόσφατες συναλλαγές',add:'Προσθήκη',home:'Αρχική',money:'Χρήματα',saved:'Εκτιμώμενη αποταμίευση'}
    };
    return maps[lang()] || maps.en;
  }
  function renderDesignSummary(c) {
    var w = designWords();
    $('quickActions').querySelector('h3').textContent = w.quick;
    document.querySelector('[data-nav=top] b').textContent=w.home; document.querySelector('[data-nav=quickActions] b').textContent=w.add; document.querySelector('[data-nav=payments] b').textContent=w.money; document.querySelector('[data-nav=work] b').textContent=(lang()==='bn'?'কাজ':lang()==='tr'?'İş':lang()==='bg'?'Работа':lang()==='hi'?'काम':lang()==='el'?'Εργασία':'Work'); document.querySelector('[data-nav=reports] b').textContent=tr('reports');
    var labels = {work:w.work,ot:w.ot,payments:w.salary,expenses:w.expense,remittances:w.remit,gifts:w.gift};
    document.querySelectorAll('[data-action]').forEach(function(b){b.querySelector('b').textContent=labels[b.getAttribute('data-action')]||'';});
    $('balanceSummary').querySelector('h3').textContent=w.balance;
    $('balanceSummary').querySelector('.note').textContent=w.balanceSub;
    $('recentTitleText') && ($('recentTitleText').textContent=w.recent);
    $('balanceMonth').textContent=fmtMonth(viewMonth(),true);
    var income=Math.max(0,C.num(c.salaryReceived)), out=Math.max(0,C.num(c.expenses)+C.num(c.remitEur)+C.num(c.giftEur));
    $('balanceBar').style.width=(income?Math.min(100,out/income*100):0)+'%';
    $('savings').textContent=w.saved+': '+money(c.balance);
    var list=[];
    state.data.work.forEach(function(x){var p=C.dayParts(x,state.settings);if(p.total>0)list.push({date:x.date,icon:'🛠️',name:tr('workRecords'),amount:p.total,kind:'pos'});});
    state.data.payments.forEach(function(x){list.push({date:x.date,icon:'💰',name:tr('payments'),amount:C.num(x.amount),kind:'pos'});});
    state.data.expenses.forEach(function(x){list.push({date:x.date,icon:'🛒',name:catLabel(x.category),amount:-C.num(x.amount),kind:'neg'});});
    state.data.remittances.forEach(function(x){var q=C.remitParts(x);list.push({date:x.date,icon:'🇧🇩',name:tr('remit'),amount:-C.num(q.amount),kind:'neg'});});
    state.data.gifts.forEach(function(x){list.push({date:x.date,icon:'🎁',name:tr('given'),amount:-C.num(x.amount),kind:'neg'});});
    list.sort(function(a,b){return String(b.date||'').localeCompare(String(a.date||''));});
    $('recentList').innerHTML=list.slice(0,5).map(function(x){return '<div class="recent-item"><span class="recent-icon">'+x.icon+'</span><span class="recent-name">'+safe(x.name)+'</span><span class="recent-amount '+(x.kind==='pos'?'positive':'negative')+'">'+(x.amount>=0?'+':'−')+safe(money(Math.abs(x.amount)))+'</span></div>';}).join('')||'<small class="empty">'+safe(tr('r_none'))+'</small>';
  }
  function render() {
    var s = state.settings, m = viewMonth(), c = C.calcMonth(state.data, s, m), d = state.data;
    document.documentElement.lang = lang(); applyTheme();
    document.querySelectorAll('[data-t]').forEach(function (el) { el.textContent = tr(el.getAttribute('data-t')); });
    $('month').textContent = fmtMonth(m);
    $('clock').setAttribute('aria-label', tr('clock_label')); clockShown = { d: '', t: '' }; tickClock();
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
    var dups = R.findDuplicateDates(d.work), dw = $('dupWarn');
    dw.hidden = dups.length === 0; dw.textContent = dups.length ? tr('dup_warn', { dates: dups.slice(0, 6).map(function (x) { return x.date + ' ×' + x.count; }).join(', ') + (dups.length > 6 ? ' …' : '') }) : '';
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
    renderBackupUi(); renderReport(); renderDesignSummary(c); refreshMsgs();
  }

  /* ---------- reports ---------- */
  function periodInfo() {
    var t = state.rtype;
    if (t === 'month') return { type: 'month', key: viewMonth(), label: fmtMonth(viewMonth()) };
    if (t === 'year') return { type: 'year', key: String(state.ryear), label: String(state.ryear) };
    return { type: 'all', key: '', label: tr('r_all') };
  }
  function rw(l, n, u, c) {                              // one report line: label, display text, css class, raw number, unit (raw values feed the CSV)
    var v = u === 'EUR' ? money(n) : u === 'BDT' ? numFmt(n) + ' BDT' : u === 'days' ? numFmt(n) : u === 'h' ? numFmt(n) + ' h' : String(n);
    return { l: l, v: v, c: c || '', n: n, u: u };
  }
  // Earned, Received, Outstanding/Overpaid and Bus allowance are kept in separate groups, never added together.
  function reportSections(tot) {
    var sal = [rw(tr('r_wages'), tot.wages, 'EUR'), rw(tr('r_otPay'), tot.otPay, 'EUR'), rw(tr('r_earned'), tot.earned, 'EUR', 'hl'),
      rw(tr('r_received'), tot.salaryReceived, 'EUR'), rw(tr('r_outstanding'), tot.outstanding, 'EUR', tot.outstanding > 0 ? 'hl' : '')];
    if (tot.overpaid > 0) sal.push(rw(tr('r_overpaid'), tot.overpaid, 'EUR', 'warn'));
    var work = [rw(tr('r_days'), tot.workedDays, 'days'), rw(tr('r_hoursWorked'), tot.hoursWorked, 'h'), rw(tr('r_otHours'), tot.otHours, 'h')];
    [['paidLeaveDays', 'paid_leave'], ['holidayDays', 'holiday'], ['sickDays', 'sick_leave'], ['unpaidLeaveDays', 'unpaid_leave'], ['restDays', 'rest']].forEach(function (p) { if (tot[p[0]] > 0) work.push(rw(tr('st_' + p[1]), tot[p[0]], 'days')); });
    var bus = [rw(tr('r_busDue'), tot.busDue, 'EUR'), rw(tr('r_busRecv'), tot.busReceived, 'EUR'), rw(tr('r_busOut'), tot.busOutstanding, 'EUR')];
    if (tot.busStatus) bus.push({ l: tr('r_busStatus'), v: tr('bus_' + tot.busStatus), c: '', n: null, u: '' });
    var money_ = [rw(tr('r_totalReceived'), tot.paymentsTotal, 'EUR'), rw(tr('r_expenses'), tot.expenses, 'EUR')];
    if (tot.rentExcluded > 0) money_.push(rw(tr('r_rentExcl'), tot.rentExcluded, 'EUR'));
    money_.push(rw(tr('r_remitted'), tot.remitEur, 'EUR'));
    if (tot.remitFee > 0) money_.push(rw(tr('fee_lbl') + ' (EUR)', tot.remitFee, 'EUR'));
    if (tot.remitBonusEur > 0) money_.push(rw(tr('bonus_eur'), tot.remitBonusEur, 'EUR'));
    money_.push(rw(tr('r_bdt'), tot.remitBdt, 'BDT'), rw(tr('r_giftEur'), tot.giftEur, 'EUR'));
    if (tot.giftBdt > 0) money_.push(rw(tr('r_giftBdt'), tot.giftBdt, 'BDT'));
    money_.push(rw(tr('r_balance'), tot.balance, 'EUR', tot.balance < 0 ? 'warn' : 'hl'));
    return [{ id: 'salary', title: tr('r_sec_salary'), rows: sal }, { id: 'work', title: tr('r_sec_work'), rows: work },
      { id: 'bus', title: tr('r_sec_bus'), rows: bus }, { id: 'money', title: tr('r_sec_money'), rows: money_ }];
  }
  function hasActivity(t) { return !!t && (t.counts ? (t.counts.work + t.counts.payments + t.counts.expenses + t.counts.remittances + t.counts.gifts) > 0 : true); }
  // Year report -> one entry per month that has records. All-time report -> one entry per year.
  function breakdownItems(info, per) {
    if (info.type === 'year') return per.months.filter(hasActivity).map(function (m) { return { label: fmtMonth(m.month), t: m }; });
    if (info.type === 'all') { var ys = {}; C.monthsIn(state.data).forEach(function (m) { ys[m.slice(0, 4)] = 1; }); return Object.keys(ys).sort().map(function (y) { return { label: y, t: C.calcPeriod(state.data, state.settings, 'year', y).total }; }); }
    return [];
  }
  function dueText(t) { return t.overpaid > 0 ? tr('r_overpaid') + ' ' + money(t.overpaid) : tr('r_outstanding') + ' ' + money(t.outstanding); }
  function breakdownHtml(items) {
    return items.map(function (it) {
      var t = it.t, pairs = [[tr('r_days'), numFmt(t.workedDays)], [tr('r_otHours'), numFmt(t.otHours) + ' h'], [tr('r_earned'), money(t.earned)], [tr('r_received'), money(t.salaryReceived)],
        [tr('r_expenses'), money(t.expenses)], [tr('r_remitted'), money(t.remitEur)], [tr('r_giftEur'), money(t.giftEur)], [tr('r_balance'), money(t.balance)]];
      if (t.busStatus) pairs.push([tr('r_busStatus'), tr('bus_' + t.busStatus)]);
      return '<div class="mrow"><div class="mhead"><strong>' + safe(it.label) + '</strong><span class="' + (t.overpaid > 0 ? 'warn' : t.outstanding > 0 ? 'hl' : '') + '">' + safe(dueText(t)) + '</span></div><dl class="mgrid">' +
        pairs.map(function (p) { return '<dt>' + safe(p[0]) + '</dt><dd>' + safe(p[1]) + '</dd>'; }).join('') + '</dl></div>';
    }).join('');
  }
  function cardsHtml(t) {
    var over = t.overpaid > 0;
    function card(l, v, cls) { return '<div class="rcard ' + (cls || '') + '"><small>' + safe(l) + '</small><b>' + safe(v) + '</b></div>'; }
    return '<div class="rcards">' + card(tr('r_earned'), money(t.earned), 'earn') + card(tr('r_received'), money(t.salaryReceived), 'recv') + card(over ? tr('r_overpaid') : tr('r_outstanding'), money(over ? t.overpaid : t.outstanding), over ? 'warn' : t.outstanding > 0 ? 'hl' : '') + '</div>' +
      '<div class="rcards two">' + card(tr('r_expenses'), money(t.expenses)) + card(tr('r_balance'), money(t.balance), t.balance < 0 ? 'warn' : 'hl') + '</div>';
  }
  function barsHtml(t) {                                   // month chart: plain HTML bars, so long labels wrap instead of overflowing
    var items = [[tr('r_earned'), t.earned, 'var(--accent)'], [tr('r_received'), t.salaryReceived, 'var(--blue)'], [tr('r_expenses'), t.expenses, 'var(--danger)'], [tr('r_remitted'), t.remitEur, 'var(--warn)'], [tr('r_giftEur'), t.giftEur, 'var(--muted)']];
    var max = Math.max.apply(null, items.map(function (i) { return i[1]; }).concat([1]));
    return '<div class="bars" role="img" aria-label="' + safe(tr('r_chart')) + '">' + items.map(function (i) {
      return '<div class="bar-row"><span class="bar-l">' + safe(i[0]) + '</span><span class="bar-t"><i style="width:' + (i[1] > 0 ? Math.max(2, Math.round(i[1] / max * 100)) : 0) + '%;background:' + i[2] + '"></i></span><b>' + safe(money(i[1])) + '</b></div>';
    }).join('') + '</div>';
  }
  function groupedChart(items) {                           // year / all-time chart: Earned, Received, Expenses per group
    if (!items.length) return '';
    var series = [{ n: tr('r_earned'), c: 'var(--accent)', k: 'earned' }, { n: tr('r_received'), c: 'var(--blue)', k: 'salaryReceived' }, { n: tr('r_expenses'), c: 'var(--danger)', k: 'expenses' }];
    var W = 340, H = 140, top = 14, left = 4, mx = Math.max.apply(null, items.map(function (g) { return Math.max(g.t.earned, g.t.salaryReceived, g.t.expenses); }).concat([1]));
    var gw = (W - left - 2) / items.length, bw = Math.max(2, Math.min(9, (gw - 4) / 3));
    var svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + (top + H + 20) + '" role="img" aria-label="' + safe(tr('r_chart')) + '"><text x="' + left + '" y="10">' + safe(money(mx)) + '</text>' +
      '<line x1="0" x2="' + W + '" y1="' + top + '" y2="' + top + '" class="grid"/><line x1="0" x2="' + W + '" y1="' + (top + H / 2) + '" y2="' + (top + H / 2) + '" class="grid"/><line x1="0" x2="' + W + '" y1="' + (top + H) + '" y2="' + (top + H) + '" class="axis"/>';
    items.forEach(function (g, gi) {
      series.forEach(function (s, si) { var bh = Math.round(g.t[s.k] / mx * H); svg += '<rect x="' + (left + gi * gw + si * bw) + '" y="' + (top + H - bh) + '" width="' + bw + '" height="' + bh + '" rx="1.5" style="fill:' + s.c + '"/>'; });
      var lbl = g.short || g.label; svg += '<text x="' + (left + gi * gw + gw / 2 - 2) + '" y="' + (top + H + 14) + '" text-anchor="middle">' + safe(lbl) + '</text>';
    });
    return svg + '</svg><div class="legend">' + series.map(function (s) { return '<span><i style="background:' + s.c + '"></i>' + safe(s.n) + '</span>'; }).join('') + '</div>';
  }
  function chartHtml(info, per) {
    if (info.type === 'month') return barsHtml(per.total);
    var items = breakdownItems(info, per);
    if (info.type === 'year') items = per.months.map(function (m) { return { label: fmtMonth(m.month, true), t: m }; });   // all 12 months keep their place on the axis
    return groupedChart(items);
  }
  function currentReport() { var info = periodInfo(), per = C.calcPeriod(state.data, state.settings, info.type, info.key); return { info: info, per: per, sections: reportSections(per.total), items: breakdownItems(info, per) }; }
  function reportEmpty(r) { var t = r.per.total; return !r.per.months.some(hasActivity) && !t.paymentsTotal && !t.earned; }
  function sectionsHtml(secs, tag) {
    return secs.map(function (s) { return '<h4>' + safe(s.title) + '</h4><dl class="rep-list">' + s.rows.map(function (x) { return '<div class="' + x.c + '"><dt>' + safe(x.l) + '</dt><dd>' + safe(x.v) + '</dd></div>'; }).join('') + '</dl>'; }).join('');
  }
  function renderReport() {
    var r = currentReport();
    document.querySelectorAll('[data-rtype]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-rtype') === state.rtype)); });
    $('repNav').style.display = state.rtype === 'all' ? 'none' : 'flex';
    $('repLabel').textContent = r.info.label;
    var html = '';
    if (reportEmpty(r)) html = '<p class="note">' + safe(tr('r_none')) + '</p>';
    else {
      html = cardsHtml(r.per.total) + chartHtml(r.info, r.per) + sectionsHtml(r.sections);
      if (r.items.length) html += '<h4>' + safe(tr(r.info.type === 'year' ? 'r_sec_monthly' : 'r_sec_yearly')) + '</h4>' + breakdownHtml(r.items);
    }
    html += '<p class="note">' + safe(tr('net_note')) + '</p>' + (r.per.total.rentExcluded > 0 ? '<p class="note">' + safe(tr('rent_note')) + '</p>' : '');
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
  function recordMonth(kind, r) { return kind === 'payments' && C.isMonth(r.month) ? r.month : String(r.date || '').slice(0, 7); }
  async function saveForm(e) {
    e.preventDefault(); if (!state.edit || state.saving) return;          // a second tap while saving is ignored
    state.saving = true; var btn = document.querySelector('#editForm button[type=submit]'); if (btn) btn.disabled = true;
    try { await saveFormInner(); } finally { state.saving = false; if (btn) btn.disabled = false; }
  }
  async function saveFormInner() {
    if (!state.edit) return;
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
    try {
      if (kind === 'work') await putWork(record); else await put(kind, record);
      closeDlg('editDialog'); state.edit = null;
      // Show the month the record belongs to (a payment counts in its salary month), so the totals on screen include it.
      var mk = recordMonth(kind, record), moved = C.isMonth(mk) && mk !== viewMonth();
      if (moved) state.month = new Date(+mk.slice(0, 4), +mk.slice(5, 7) - 1, 1);
      await refresh();
      if (moved) toast(function () { return tr('saved_in', { month: fmtMonth(mk) }); });
    } catch (e2) {
      if (e2 && e2.dup) setMsg('formErr', M('err_dup'));
      else setMsg('formErr', M('err_storage', null, ': ' + (e2 && e2.message || e2)));
    }
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
  // Report CSV: numbers are plain (12345.67, no currency symbol or thousands separator) so Excel / Numbers read them in any region.
  function num2(n) { return C.r2(n).toFixed(2); }
  function buildCsvReport() {
    var r = currentReport(), t = r.per.total, rows = [['period', 'section', 'item', 'value', 'unit']];
    r.sections.forEach(function (sec) { sec.rows.forEach(function (x) { rows.push([r.info.label, sec.title, x.l, x.n === null ? x.v : num2(x.n), x.u]); }); });
    var out = csvText(rows, [0, 1, 2]);
    if (r.items.length) {
      var b = [[tr(r.info.type === 'year' ? 'r_month' : 'r_year'), 'worked_days', 'hours_worked', 'overtime_hours', 'earned_eur', 'received_eur', 'outstanding_eur', 'overpaid_eur', 'bus_due_eur', 'bus_received_eur', 'expenses_eur', 'sent_home_eur', 'money_given_eur', 'cash_left_eur']];
      r.items.forEach(function (it) { var x = it.t; b.push([it.label, x.workedDays, num2(x.hoursWorked), num2(x.otHours), num2(x.earned), num2(x.salaryReceived), num2(x.outstanding), num2(x.overpaid), num2(x.busDue), num2(x.busReceived), num2(x.expenses), num2(x.remitEur), num2(x.giftEur), num2(x.balance)]); });
      out += '\r\n\r\n' + csvText(b, [0]).slice(1);
    }
    return out;
  }
  function buildPrintHtml() {
    var r = currentReport(), t = r.per.total, over = t.overpaid > 0;
    var h = '<h1>' + safe(tr('print_title')) + '</h1><p class="muted">' + safe(tr('r_report')) + ': <strong>' + safe(r.info.label) + '</strong> · ' + safe(tr('r_created')) + ': ' + safe(fmtStamp(new Date())) + '</p>';
    if (reportEmpty(r)) return h + '<p>' + safe(tr('r_none')) + '</p>';
    h += '<table class="p-sum"><thead><tr><th>' + safe(tr('r_earned')) + '</th><th>' + safe(tr('r_received')) + '</th><th>' + safe(over ? tr('r_overpaid') : tr('r_outstanding')) + '</th><th>' + safe(tr('r_balance')) + '</th></tr></thead><tbody><tr><td>' +
      safe(money(t.earned)) + '</td><td>' + safe(money(t.salaryReceived)) + '</td><td>' + safe(money(over ? t.overpaid : t.outstanding)) + '</td><td>' + safe(money(t.balance)) + '</td></tr></tbody></table>';
    h += chartHtml(r.info, r.per);
    r.sections.forEach(function (sec) { h += '<table class="p-sec"><caption>' + safe(sec.title) + '</caption><tbody>' + sec.rows.map(function (x) { return '<tr><td>' + safe(x.l) + '</td><td>' + safe(x.v) + '</td></tr>'; }).join('') + '</tbody></table>'; });
    if (r.items.length) {
      h += '<table class="p-break"><caption>' + safe(tr(r.info.type === 'year' ? 'r_sec_monthly' : 'r_sec_yearly')) + '</caption><thead><tr>' + [r.info.type === 'year' ? 'r_month' : 'r_year', 'r_days', 'r_earned', 'r_received', 'r_outstanding', 'r_expenses', 'r_balance'].map(function (k) { return '<th>' + safe(tr(k)) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        r.items.map(function (it) { var x = it.t; return '<tr><td>' + safe(it.label) + '</td><td>' + numFmt(x.workedDays) + '</td><td>' + safe(money(x.earned)) + '</td><td>' + safe(money(x.salaryReceived)) + '</td><td>' + safe(x.overpaid > 0 ? tr('r_overpaid') + ' ' + money(x.overpaid) : money(x.outstanding)) + '</td><td>' + safe(money(x.expenses)) + '</td><td>' + safe(money(x.balance)) + '</td></tr>'; }).join('') + '</tbody></table>';
    }
    return h + '<p class="muted">' + safe(tr('net_note')) + '</p>';
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

  function switchView(view) {
    document.body.setAttribute('data-view', view);
    document.querySelectorAll('[data-nav]').forEach(function(b){var target=b.getAttribute('data-nav');var active=(view==='home'&&target==='top')||(view==='work'&&target==='work')||(view==='money'&&target==='payments')||(view==='reports'&&target==='reports');b.classList.toggle('active',active);});
    window.scrollTo({top:0,behavior:'smooth'});
  }

  /* ---------- events ---------- */
  function bind() {
    $('menuBtn').onclick = function () { openDlg('menu'); };
    document.querySelectorAll('[data-target]').forEach(function (b) { b.onclick = function () { closeDlg('menu'); var id = b.getAttribute('data-target'); switchView(id==='top'?'home':id==='reports'?'reports':id==='settings'?'settings':'money'); }; });
    $('aboutBtn').onclick = function () { closeDlg('menu'); openDlg('aboutDlg'); };
    document.querySelectorAll('[data-action]').forEach(function(b){b.onclick=function(){var k=b.getAttribute('data-action');closeDlg('quickAddDialog');if(k==='ot')openForm('work',{date:today(),hours:state.settings.standard+1});else openForm(k);};});
    document.querySelectorAll('[data-nav]').forEach(function(b){b.onclick=function(){var target=b.getAttribute('data-nav');if(target==='quickActions'){openDlg('quickAddDialog');return;}switchView(target==='top'?'home':target==='work'?'work':target==='payments'?'money':target==='reports'?'reports':'home');};});
    document.addEventListener('click', function (e) {
      var cl = e.target.closest('.closeDlg'); if (cl) { var dd = cl.closest('dialog'); if (dd) { if (dd.close) dd.close(); else dd.removeAttribute('open'); } return; }
      var d = e.target.closest('[data-delete]'); if (d) { var dk = d.getAttribute('data-delete'); deleteRecord(dk, findRec(dk, d.getAttribute('data-id'), d.getAttribute('data-idt'))); return; }
      var b = e.target.closest('[data-edit]'); if (b) { var k = b.getAttribute('data-edit'); openForm(k, findRec(k, b.getAttribute('data-id'), b.getAttribute('data-idt')) || {}); return; }
      var j = e.target.closest('[data-jump]'); if (j) { var t=j.getAttribute('data-jump'); switchView(t==='payments'?'money':t==='expenses'?'money':'work'); }
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
    $('rPrev').onclick = function () { if (state.rtype === 'month') { state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1); render(); } else { state.ryear--; renderReport(); } };
    $('rNext').onclick = function () { if (state.rtype === 'month') { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1); render(); } else { state.ryear++; renderReport(); } };
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
    $('print').onclick = function () { $('printArea').innerHTML = buildPrintHtml(); window.print(); };
    window.addEventListener('afterprint', function () { $('printArea').innerHTML = ''; });
  }

  /* ---------- start ---------- */
  async function init() {
    loadSettings(); applyTheme(); bind(); render(); startClock();
    document.addEventListener('visibilitychange', function () { if (document.hidden) stopClock(); else startClock(); });
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
  window.MSTDebug = { refresh: refresh, render: render, tickClock: tickClock, buildCsvReport: buildCsvReport, buildPrintHtml: buildPrintHtml, currentReport: currentReport, state: state, validateBackup: validateBackup, buildBackup: buildBackup, buildCsvAll: buildCsvAll, writeAll: writeAll, planMerge: R.planMerge };
})();
