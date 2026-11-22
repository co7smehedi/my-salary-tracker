/* My Salary Tracker v9.5.4 - all data stays on this device (IndexedDB + localStorage). No network requests are made by this file. */
(function () {
  'use strict';
  var C = window.MSTCalc, I = window.MSTi18n, R = window.MSTRules, T = I.T;
  var VERSION = '9.5.4';
  var DB_NAME = 'salary-tracker-db';
  var STORES = ['work', 'payments', 'expenses', 'remittances', 'gifts', 'dutyPrograms'];
  var LEGACY = 'workEntries';
  var SETTINGS_KEY = 'mst-settings';
  var LAST_BACKUP_KEY = 'mst-last-backup';      // ISO time of the last successful 'Export backup' (device only, never inside a backup file)
  var SNOOZE_KEY = 'mst-backup-snooze';         // local date (YYYY-MM-DD) on which the reminder was snoozed
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    db: null, dbReady: false, dbAttempt: null, data: { work: [], payments: [], expenses: [], remittances: [], gifts: [], dutyPrograms: [] },
    settings: Object.assign({}, C.DEFAULTS), month: new Date(), rtype: 'month', ryear: new Date().getFullYear(),
    edit: null, pending: null, dbError: null, storage: null, updatePending: false, workSelected: null, personSelected: null
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
    ['basic', 'standard', 'otRate', 'bus', 'bonus', 'salaryMonthly', 'weeklyDays'].forEach(function (k) { if (r[k] !== undefined && r[k] !== null && r[k] !== '' && Number.isFinite(Number(r[k])) && Number(r[k]) >= 0) s[k] = Number(r[k]); });
    ['paidLeave', 'paidHoliday', 'sickPaid'].forEach(function (k) { if (typeof r[k] === 'boolean') s[k] = r[k]; }); s.rentEnabled=false;
    s.salaryMonthly = s.salaryMonthly || 650; s.weeklyDays = Math.max(1, Math.min(7, Math.round(s.weeklyDays || 6))); s.people = Array.isArray(r.people) ? r.people.filter(function(n){return typeof n==='string'&&n.trim();}).map(function(n){return n.trim();}) : [];
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
      var r = version ? indexedDB.open(name, version) : indexedDB.open(name), settled = false, blocked = false, timer;
      function finish(err, db) {
        if (settled) { if (db) db.close(); return; }
        settled = true; clearTimeout(timer);
        if (err) rej(err); else res(db);
      }
      r.onupgradeneeded = function () { try { upgrade && upgrade(r.result); } catch (e) { finish(e); } };
      r.onsuccess = function () { finish(null, r.result); };
      r.onerror = function () { finish(r.error || new Error('IndexedDB open failed')); };
      r.onblocked = function () {
        blocked = true;
        // Do not leave the app waiting forever if another Safari/Home-Screen instance keeps the DB open.
        if (!timer) timer = setTimeout(function () { finish(new Error('Database upgrade is blocked by another app tab. Close all My Salary Tracker tabs/apps, then retry.')); }, 15000);
      };
      timer = setTimeout(function () { finish(new Error(blocked ? 'Database upgrade is blocked by another app tab. Close all My Salary Tracker tabs/apps, then retry.' : 'Timed out opening local storage. Close other app tabs and retry.')); }, 20000);
    });
  }
  // A rendering bug must never be reported as a database failure and must never stop startup.
  function safeRender() { try { render(); state.renderError = null; return true; } catch (e) { state.renderError = e; try { console.error('render failed', e); } catch (x) {} showFatal('Screen error', e); return false; } }
  function errInfo(e) { var n = (e && e.name) || 'Error', m = (e && e.message) || String(e || ''); return n + ': ' + m; }
  function errCategory(e) {
    var n = (e && e.name) || '', m = String((e && e.message) || '');
    if (/blocked/i.test(m)) return 'BLOCKED';
    if (/timed out/i.test(m)) return 'TIMEOUT';
    if (n === 'QuotaExceededError') return 'QUOTA';
    if (n === 'InvalidStateError') return 'CONNECTION_CLOSED';
    if (n === 'VersionError') return 'VERSION';
    if (n === 'NotFoundError') return 'MISSING_STORE';
    if (n === 'SecurityError' || /denied|private|not allowed/i.test(m)) return 'STORAGE_DENIED';
    if (n === 'UnknownError' || /backing store|internal error/i.test(m)) return 'BROWSER_STORAGE_ERROR';
    return 'OTHER';
  }
  function showFatal(label, e) { var b = $('dbBanner'), t = $('dbBannerText'); if (!b || !t) return; b.hidden = false; t.textContent = label + ' [' + errCategory(e) + '] ' + errInfo(e) + ' — Saved data has not been deleted. / ডাটা মুছে যায়নি।'; }
  function renderDBBanner() {
    var b = $('dbBanner'), t = $('dbBannerText'), retry = $('dbRetry');
    if (!b || !t) return;
    if (state.dbReady && state.renderError) { showFatal('Screen error', state.renderError); retry.disabled = false; return; }
    b.hidden = !!state.dbReady;
    retry.disabled = !!state.dbAttempt;
    var hint = { BLOCKED: 'Another app window keeps the database busy. Fully close the Home Screen app and every Safari tab of this app, then tap Retry.', TIMEOUT: 'Opening took too long. Close other app windows, then tap Retry.', QUOTA: 'Phone storage is full. Free some space, then tap Retry.', CONNECTION_CLOSED: 'The browser closed the database connection. Tap Retry.', STORAGE_DENIED: 'The browser refused storage. Private Browsing blocks saving; open the app normally.', BROWSER_STORAGE_ERROR: 'The browser storage reported an internal error. Fully close the app, reopen it, tap Retry.' };
    t.textContent = state.dbAttempt ? 'Loading saved data… / আপনার সেভ করা তথ্য লোড হচ্ছে…' : state.dbError ? 'Saved data could not be opened [' + errCategory(state.dbError) + '] ' + errInfo(state.dbError) + '. ' + (hint[errCategory(state.dbError)] || 'Tap Retry.') + ' Your saved data has not been deleted. / সেভ করা তথ্য খুলতে সমস্যা হয়েছে। ডাটা মুছে যায়নি।' : 'Loading saved data… / আপনার সেভ করা তথ্য লোড হচ্ছে…';
  }
  async function initializeDatabase() {
    if (state.dbAttempt) return state.dbAttempt;
    state.dbReady = false; state.dbError = null;
    state.dbAttempt = (async function () {
      renderDBBanner();
      try {
        if (state.db) { try { state.db.close(); } catch (e) {} state.db = null; }
        state.db = await openDB();
        await loadAll(); await migrateLegacy(); await importHistoricalOnce();
        state.dbReady = true; state.dbError = null;
        renderDBBanner(); safeRender();
        return true;
      } catch (e) {
        state.dbReady = false; state.dbError = e; if (state.db) { try { state.db.close(); } catch (closeErr) {} } state.db = null;
        renderDBBanner(); safeRender();
        toast(M('err_storage', null, ': [' + errCategory(e) + '] ' + errInfo(e)));
        return false;
      } finally { state.dbAttempt = null; renderDBBanner(); }
    })();
    return state.dbAttempt;
  }
  function ensureStores(d) { STORES.concat([LEGACY]).forEach(function (s) { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' }); }); }
  // Opens the existing database at whatever version it already has (never a lower one, never deletes anything).
  // Only adds a missing store by raising the version by one.
  async function openDB() {
    var d = await idbOpen(DB_NAME, 0, ensureStores);
    var missing = STORES.concat([LEGACY]).filter(function (s) { return !d.objectStoreNames.contains(s); });
    if (missing.length) { var v = d.version + 1; d.close(); d = await idbOpen(DB_NAME, v, ensureStores); }
    d.onversionchange = function () { try { d.close(); } catch (e) {} if (state.db === d) { state.db = null; state.dbReady = false; renderDBBanner(); } };
    d.onclose = function () { if (state.db === d) { state.db = null; state.dbReady = false; renderDBBanner(); } };   // Safari may close the connection in the background
    return d;
  }
  // If the browser closed the connection (common on iOS after the app was in the background), reopen once and continue.
  async function ensureConn() {
    if (state.db && state.dbReady) return;
    if (state.dbAttempt) { await state.dbAttempt; }
    else await initializeDatabase();
    if (!state.db || !state.dbReady) throw (state.dbError || new Error('Local database is not ready. Retry database connection.'));
  }
  function reqP(req) { return new Promise(function (res, rej) { req.onsuccess = function () { res(req.result); }; req.onerror = function () { rej(req.error); }; }); }
  function getAll(s) { if (!state.db) return Promise.reject(new Error('Local database is not ready. Retry database connection.')); try { return reqP(state.db.transaction(s, 'readonly').objectStore(s).getAll()).then(function (r) { return r || []; }); } catch (e) { return Promise.reject(e); } }
  function txDone(tx) { return new Promise(function (res, rej) { tx.oncomplete = function () { res(); }; tx.onabort = function () { rej(tx.error || new Error('aborted')); }; tx.onerror = function () { }; }); }
  // rawPut works as soon as a connection exists (used by startup migration); put() additionally requires a ready, healthy connection and reconnects once if it was closed.
  function rawPut(s, x) { if (!state.db) return Promise.reject(new Error('Local database is not ready. Retry database connection.')); try { var tx = state.db.transaction(s, 'readwrite'); tx.objectStore(s).put(x); return txDone(tx); } catch (e) { return Promise.reject(e); } }
  async function put(s, x) { try { await ensureConn(); return await rawPut(s, x); } catch (e) { if (e && e.name === 'InvalidStateError') { state.db = null; state.dbReady = false; await ensureConn(); return rawPut(s, x); } throw e; } }
  // Work records: the one-record-per-date check and the write happen inside ONE transaction, against the data stored on disk
  // (not the on-screen copy), so a double tap or a second open window can never create a second record for the same day.
  async function putWork(rec) { try { await ensureConn(); return await putWork1(rec); } catch (e) { if (e && e.name === 'InvalidStateError') { state.db = null; state.dbReady = false; await ensureConn(); return putWork1(rec); } throw e; } }
  function putWork1(rec) {
    return new Promise(function (resolve, reject) {
      var tx; try { if (!state.db) throw new Error('Local database is not ready. Close other app tabs and reload.'); tx = state.db.transaction('work', 'readwrite'); } catch (e) { return reject(e); }
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
  function rawDel(s, id) { if (!state.db) return Promise.reject(new Error('Local database is not ready. Retry database connection.')); try { var tx = state.db.transaction(s, 'readwrite'); tx.objectStore(s).delete(id); return txDone(tx); } catch (e) { return Promise.reject(e); } }
  async function del(s, id) { try { await ensureConn(); return await rawDel(s, id); } catch (e) { if (e && e.name === 'InvalidStateError') { state.db = null; state.dbReady = false; await ensureConn(); return rawDel(s, id); } throw e; } }
  async function loadAll() { for (var i = 0; i < STORES.length; i++) state.data[STORES[i]] = await getAll(STORES[i]); }
  async function migrateLegacy() {
    try {
      if (localStorage.getItem('mst-migrated-v4')) return;
      var legacy = await getAll(LEGACY);
      for (var i = 0; i < legacy.length; i++) {
        var x = legacy[i];
        if (x && x.date && !state.data.work.some(function (y) { return y.date === x.date; })) await rawPut('work', Object.assign({}, x, { id: x.id || uid() }));
      }
      localStorage.setItem('mst-migrated-v4', 'yes');
      state.data.work = await getAll('work');
    } catch (e) { /* legacy data is left untouched; app continues */ }
  }
  async function refresh() { await loadAll(); render(); }

  /* ---------- rendering ---------- */
  function row(title, sub, amount, kind, id) {
    var idt = typeof id === 'number' ? 'n' : 's';
    var rec=findRec(kind,id,idt), receipt=rec&&rec.receipt, receiptHtml='';
    if(receipt&&receipt.data){var mime=receipt.type||'image/jpeg',src=receipt.data;receiptHtml='<details class="receipt-details"><summary>📎 Receipt / ফাইল দেখুন</summary>'+(mime.indexOf('image/')===0?'<img loading="lazy" alt="Receipt" src="'+safe(src)+'">':'<a href="'+safe(src)+'" target="_blank" rel="noopener">Open attached file</a>')+'</details>';}
    return '<div class="entry"><div class="entry-main"><strong>' + safe(title) + '</strong><small>' + safe(sub || '') + '</small>'+receiptHtml+'</div>' +
      '<div class="entry-side"><strong>' + safe(amount) + '</strong><span class="entry-buttons"><button type="button" data-edit="' + kind + '" data-id="' + safe(id) + '" data-idt="' + idt + '">' + safe(tr('edit')) + '</button>' +
      '<button type="button" class="del" data-delete="' + kind + '" data-id="' + safe(id) + '" data-idt="' + idt + '">' + safe(tr('del')) + '</button></span></div></div>';
  }
  function findRec(kind, idAttr, idt) {            // exact match on text AND type, so numeric and text ids both work
    var list = state.data[kind] || [];
    for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(idAttr) && (!idt || (typeof list[i].id === 'number' ? 'n' : 's') === idt)) return list[i];
    return null;
  }
  function byDateDesc(a, b) { return String(b.date || '').localeCompare(String(a.date || '')); }
  function fmtRecordDate(x){return x&&x.datePrecision==='month'?fmtMonth(String(x.date||'').slice(0,7)):fmtDate(x&&x.date);}
  function designWords() {
    var maps = {
      en: {quick:'Quick Actions',work:'Add Work',ot:'Add OT',salary:'Salary',expense:'Expense',remit:'Send Home',gift:'Give Money',balance:'Balance',balanceSub:'Income, expenses and savings comparison',recent:'Recent Transactions',add:'Add',home:'Home',money:'Money',saved:'Estimated savings',received:'Received',outgoing:'Out'},
      bn: {quick:'Quick Actions',work:'কাজ যোগ',ot:'OT যোগ',salary:'বেতন',expense:'খরচ',remit:'পরিবারে পাঠানো',gift:'অন্যদের দেওয়া',balance:'ব্যালেন্স',balanceSub:'আয়, খরচ ও সঞ্চয়ের তুলনা',recent:'সাম্প্রতিক লেনদেন',add:'যোগ',home:'হোম',money:'টাকা',saved:'আনুমানিক সঞ্চয়',received:'পেয়েছি',outgoing:'খরচ'},
      tr: {quick:'Hızlı İşlemler',work:'İş Ekle',ot:'Mesai Ekle',salary:'Maaş',expense:'Gider',remit:'Aileye Gönder',gift:'Para Ver',balance:'Maaş ve Giderler',balanceSub:'Gelir, gider ve tasarruf karşılaştırması',recent:'Son İşlemler',add:'Ekle',home:'Ana Sayfa',money:'Para',saved:'Tahmini birikim',received:'Alınan',outgoing:'Çıkan'},
      bg: {quick:'Бързи действия',work:'Добави работа',ot:'Добави извънредно',salary:'Заплата',expense:'Разход',remit:'Изпрати на семейството',gift:'Дари пари',balance:'Заплата и разходи',balanceSub:'Сравнение на доходи, разходи и спестявания',recent:'Последни транзакции',add:'Добави',home:'Начало',money:'Пари',saved:'Очаквани спестявания',received:'Получени',outgoing:'Изходящи'},
      hi: {quick:'त्वरित कार्रवाइयाँ',work:'काम जोड़ें',ot:'ओटी जोड़ें',salary:'वेतन',expense:'खर्च',remit:'परिवार को भेजें',gift:'पैसे दें',balance:'वेतन और खर्च',balanceSub:'आय, खर्च और बचत की तुलना',recent:'हाल के लेनदेन',add:'जोड़ें',home:'होम',money:'पैसा',saved:'अनुमानित बचत',received:'प्राप्त',outgoing:'खर्च'},
      el: {quick:'Γρήγορες ενέργειες',work:'Προσθήκη εργασίας',ot:'Προσθήκη υπερωρίας',salary:'Μισθός',expense:'Έξοδο',remit:'Αποστολή στην οικογένεια',gift:'Δωρεά',balance:'Μισθός και έξοδα',balanceSub:'Σύγκριση εσόδων, εξόδων και αποταμίευσης',recent:'Πρόσφατες συναλλαγές',add:'Προσθήκη',home:'Αρχική',money:'Χρήματα',saved:'Εκτιμώμενη αποταμίευση',received:'Ελήφθησαν',outgoing:'Έξοδα'}
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
    $('recentCard').querySelector('h3').textContent=w.recent;
    $('balanceBreakdown').textContent=w.balanceSub+' · '+w.received+': '+money(c.salaryReceived)+' · '+w.outgoing+': '+money(C.num(c.expenses)+C.num(c.remitEur)+C.num(c.giftEur));
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
  function addPersonName(name){name=String(name||'').trim();if(!name)return;state.settings.people=state.settings.people||[];if(!state.settings.people.some(function(n){return n.toLocaleLowerCase()===name.toLocaleLowerCase();})){state.settings.people.push(name);persistSettings();}}
  function renamePerson(oldName){if(!oldName)return;var newName=prompt('নতুন নাম লিখুন',oldName);if(!newName||!newName.trim()||newName.trim()===oldName)return;var target=newName.trim();state.settings.people=(state.settings.people||[]).map(function(n){return n.toLocaleLowerCase()===oldName.toLocaleLowerCase()?target:n;});var list=state.data.gifts.filter(function(g){return String(g.person||'').toLocaleLowerCase()===oldName.toLocaleLowerCase();});Promise.all(list.map(function(g){return put('gifts',Object.assign({},g,{person:target}));})).then(function(){persistSettings();state.personSelected=target;closeDlg('peopleDlg');refresh();toast('নাম আপডেট হয়েছে।');});}
  function readDataUrl(file){return new Promise(function(resolve,reject){var r=new FileReader();r.onload=function(){resolve(r.result);};r.onerror=function(){reject(r.error||new Error('file read failed'));};r.readAsDataURL(file);});}
  async function importHistoricalOnce(){ /* Fresh installs start empty. Existing device records are preserved. */ return; }
  function renderWorkCalendar() {
    var m = viewMonth(), y = +m.slice(0,4), mo = +m.slice(5,7)-1, first = new Date(y,mo,1), days = new Date(y,mo+1,0).getDate();
    var start = (first.getDay()+6)%7; // Monday first
    var labels = {bn:['সোম','মঙ্গল','বুধ','বৃহ','শুক্র','শনি','রবি'],en:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],tr:['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'],bg:['Пон','Вт','Ср','Чет','Пет','Съб','Нед'],hi:['सोम','मंगल','बुध','गुरु','शुक्र','शनि','रवि'],el:['Δευ','Τρι','Τετ','Πεμ','Παρ','Σαβ','Κυρ']};
    var heads=(labels[lang()]||labels.en).map(function(x){return '<span class="cal-head">'+safe(x)+'</span>';}).join('');
    var cells=''; for(var i=0;i<start;i++) cells+='<span class="cal-empty"></span>';
    for(var d=1;d<=days;d++){var date=y+'-'+String(mo+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');var rec=state.data.work.find(function(x){return x.date===date;});var status=rec?C.normStatus(rec.status):'none';var cl=status==='worked'?'worked':status==='rest'?'rest':status==='paid_leave'?'paid':status==='unpaid_leave'?'unpaid':status==='sick_leave'?'sick':status==='holiday'?'holiday':'';var isToday=date===today();cells+='<button type="button" class="cal-day '+cl+(isToday?' today':'')+'" data-cal-date="'+date+'" aria-label="'+safe(date+(rec?' '+statusLabel(rec.status):''))+'"><span>'+d+'</span>'+(rec?'<small>'+safe(status==='worked'?numFmt(rec.hours||0)+'h':statusLabel(status))+'</small>':'')+'</button>';}
    $('workCalendar').innerHTML=heads+cells; $('workMonth').textContent=fmtMonth(m); var total=C.calcMonth(state.data,state.settings,m);$('workDaysCount').textContent=total.workedDays;$('workMonthEarned').textContent=money(total.earned);
  }
  function personGroups() {var map={};(state.settings.people||[]).forEach(function(name){var k=String(name).toLocaleLowerCase();if(name&&!map[k])map[k]={name:name,eur:0,bdt:0,other:0,count:0,items:[]};});state.data.gifts.forEach(function(g){var name=String(g.person||'').trim();if(!name)return;var k=name.toLocaleLowerCase();if(!map[k])map[k]={name:name,eur:0,bdt:0,other:0,count:0,items:[]};var c=String(g.currency||'EUR').toUpperCase();if(c==='EUR')map[k].eur+=C.num(g.amount);else if(c==='BDT')map[k].bdt+=C.num(g.amount);else {map[k].other+=C.num(g.amount);map[k].currencies=map[k].currencies||{};map[k].currencies[c]=(map[k].currencies[c]||0)+C.num(g.amount);}if(g.bdtActual)map[k].bdt+=C.num(g.bdtActual);map[k].count++;map[k].items.push(g);});return Object.keys(map).map(function(k){return map[k];}).sort(function(a,b){return a.name.localeCompare(b.name);});}
  function renderPeople() {var groups=personGroups(),words={bn:'লেনদেন',en:'transactions',tr:'işlem',bg:'транзакции',hi:'लेन-देन',el:'συναλλαγές'};var word=words[lang()]||words.en;$('peopleList').innerHTML=groups.map(function(g){return '<button type="button" class="person-row" data-person="'+safe(g.name)+'"><strong>'+safe(g.name)+'</strong><span>'+money(g.eur)+' · '+numFmt(g.bdt)+' BDT</span><small>'+g.count+' '+safe(word)+'</small></button>';}).join('')||'<p class="empty">'+safe(tr('r_none'))+'</p>'; $('personDirectory').innerHTML='<p class="note">Saved people (add once, select later)</p>'+groups.map(function(g){return '<div class="directory-row"><span>'+safe(g.name)+'</span><button type="button" data-person-rename="'+safe(g.name)+'">Rename</button></div>';}).join('');}
  function openPerson(name) {var group=personGroups().find(function(g){return g.name.toLocaleLowerCase()===String(name).toLocaleLowerCase();});if(!group)return;state.personSelected=group.name;var extra=group.currencies?Object.keys(group.currencies).map(function(c){return '<div><small>'+safe(c)+' total</small><b>'+safe(numFmt(group.currencies[c]))+'</b></div>';}).join(''):'';$('personTitle').textContent=group.name;$('personProfile').innerHTML='<div class="person-totals"><div><small>EUR total</small><b>'+safe(money(group.eur))+'</b></div><div><small>BDT total</small><b>'+safe(numFmt(group.bdt))+' ৳</b></div><div><small>Transactions</small><b>'+group.count+'</b></div>'+extra+'</div>'+group.items.sort(byDateDesc).map(function(x){return row(fmtDate(x.date),x.note||'',money(x.amount,String(x.currency||'EUR').toUpperCase()),'gifts',x.id);}).join('');openDlg('peopleDlg');}
  function dutyButtonState(){var b=$('homeQuickDuty'),reason=$('dutyReason'),rec=state.data.work.find(function(x){return x.date===today();}),status=rec?C.normStatus(rec.status):null;if(!state.dbReady){b.disabled=true;b.classList.remove('done');b.classList.add('blocked');b.textContent='ডাটা লোড না হওয়া পর্যন্ত বন্ধ';reason.textContent='ডাটাবেস প্রস্তুত নয়। উপরের Retry চাপুন।';return;}b.disabled=!!(rec&&status!=='worked');b.classList.toggle('done',status==='worked');b.classList.toggle('blocked',b.disabled);b.textContent=status==='worked'?'✓ আজকের ডিউটি সম্পন্ন':b.disabled?'আজ ডিউটি নেই / ছুটি':'আজকে ডিউটি করেছি';reason.textContent=b.disabled?('আজকের অবস্থা: '+statusLabel(rec.status)+' — এই অবস্থায় Basic Salary যোগ হবে না।'):status==='worked'?'Basic Salary ইতিমধ্যে যোগ হয়েছে।':'';}
  function quickBasicDuty() {if(!state.dbReady){toast('ডাটাবেস প্রস্তুত নয়। উপরের Retry চাপুন।');return;}var dt=today(),existing=state.data.work.find(function(x){return x.date===dt;});if(existing&&C.normStatus(existing.status)==='worked'){toast('আজকের Basic Duty ইতিমধ্যে যোগ করা আছে।');return;}if(existing){toast('আজকের রেকর্ডে '+statusLabel(existing.status)+' আছে। আগে Edit করে Worked করুন।');return;}var rec={id:uid(),date:dt,status:'worked',hours:state.settings.standard,basicRate:state.settings.basic,standardHours:state.settings.standard,otRate:state.settings.otRate,busAllowanceRate:state.settings.bus,otExtraHours:0,tips:0,note:''};putWork(rec).then(refresh).then(function(){toast('আজকের Basic Duty ও Basic Salary যোগ হয়েছে।','Undo',function(){del('work',rec.id).then(refresh);});}).catch(function(e){toast(e&&e.dup?'আজকের কাজ আগেই রেকর্ড হয়েছে।':M('err_storage',null,': '+(e.message||e)));});}

  function renderTodayProgram(){
    var p=(state.data.dutyPrograms||[]).find(function(x){return x.date===today();}),box=$('schedulePeek'),out=$('scheduleToday');
    if(!p){box.hidden=true;out.textContent='';return;} box.hidden=false;
    if(p.rest){out.innerHTML='<strong>Rest Day</strong>';return;}
    var lines=[]; if(p.start&&p.end)lines.push('Duty: '+safe(p.start)+'–'+safe(p.end)); if(Number(p.breakMinutes)>0)lines.push('Break: '+safe(p.breakMinutes)+' min'); if(Number(p.otHours)>0)lines.push('Overtime: '+safe(p.otHours)+' h');
    out.innerHTML=lines.map(function(x){return '<span>'+x+'</span>';}).join('');
  }
  function renderProgramHistory(){var list=(state.data.dutyPrograms||[]).slice().sort(function(a,b){return b.date.localeCompare(a.date);});$('programHistory').innerHTML=list.map(function(p){return '<div class="program-history-row"><div><b>'+safe(p.date)+'</b><small>'+(p.rest?'Rest Day':safe((p.start||'')+'–'+(p.end||''))+' · break '+safe(p.breakMinutes||0)+'m · OT '+safe(p.otHours||0)+'h')+'</small></div><button type="button" data-program-edit="'+safe(p.id)+'">Edit</button></div>';}).join('')||'<small class="muted">No schedule saved yet.</small>';}
  function openProgram(){if(!state.dbReady){toast('ডাটাবেস প্রস্তুত নয়। উপরের Retry চাপুন।');return;}closeDlg('menu');$('programDate').value=today();$('programPhoto').value='';$('programRest').checked=false;$('programTimes').hidden=false;$('programPreview').textContent='';renderProgramHistory();openDlg('dutyProgramDialog');}
  async function saveProgram(){if(!state.dbReady){toast('ডাটাবেস প্রস্তুত নয়। উপরের Retry চাপুন।');return;}try{var date=$('programDate').value,old=(state.data.dutyPrograms||[]).find(function(x){return x.date===date;}),rest=$('programRest').checked;if(!C.isDate(date)){toast('Choose a valid date.');return;}if(old&&!confirm('A schedule already exists for this date. Replace it after review?'))return;
    var photo=old&&old.photo?old.photo:null,file=$('programPhoto').files&&$('programPhoto').files[0];if(file){if(!/^image\//.test(file.type)||file.size>8*1024*1024){toast('Please choose a paper photo up to 8 MB.');return;}photo={name:file.name,type:file.type,data:await readDataUrl(file)};}if(!photo){toast('Please upload the paper schedule photo first.');return;}
    var rec={id:old?old.id:uid(),date:date,rest:rest,start:rest?'':$('programStart').value,end:rest?'':$('programEnd').value,breakMinutes:rest?0:Number($('programBreak').value||0),otHours:rest?0:Number($('programOt').value||0),photo:photo,confirmedAt:new Date().toISOString()};
    if(!rest&&(!rec.start||!rec.end)){toast('Enter both duty start and end times.');return;}if(rec.breakMinutes<0||rec.breakMinutes>600||rec.otHours<0||rec.otHours>24){toast('Check break and overtime values.');return;}
    await put('dutyPrograms',rec);await refresh();renderProgramHistory();toast('Schedule saved on this phone.');}catch(e){toast('Schedule save failed: '+(e&&e.message||e));}}
  function render() {
    var s = state.settings, m = viewMonth(), c = C.calcMonth(state.data, s, m), d = state.data;
    document.documentElement.lang = lang(); applyTheme();
    document.querySelectorAll('[data-t]').forEach(function (el) { el.textContent = tr(el.getAttribute('data-t')); });
    var extras={bn:{quickDutyLabel:'আজকের Basic Duty ১ ক্লিকে যোগ',peopleTitle:'ব্যক্তিভিত্তিক হিসাব',peopleNote:'প্রত্যেকের মোট টাকা ও লেনদেন আলাদা',transactions:'লেনদেন'},en:{quickDutyLabel:'One-tap: record today’s basic duty',peopleTitle:'People & profiles',peopleNote:'Individual totals and transaction history',transactions:'transactions'},tr:{quickDutyLabel:'Bugünün normal mesaisini tek dokunuşla kaydet',peopleTitle:'Kişiler ve profiller',peopleNote:'Kişiye göre toplamlar ve geçmiş',transactions:'işlem'},bg:{quickDutyLabel:'Запиши днешния работен ден с едно докосване',peopleTitle:'Хора и профили',peopleNote:'Суми и история по човек',transactions:'транзакции'},hi:{quickDutyLabel:'आज की सामान्य ड्यूटी एक टैप में दर्ज करें',peopleTitle:'लोग और प्रोफ़ाइल',peopleNote:'व्यक्ति के अनुसार कुल और इतिहास',transactions:'लेन-देन'},el:{quickDutyLabel:'Καταγραφή σημερινής βάρδιας με ένα πάτημα',peopleTitle:'Άτομα και προφίλ',peopleNote:'Σύνολα και ιστορικό ανά άτομο',transactions:'συναλλαγές'}};var ex=extras[lang()]||extras.en;var qa={en:['Add Work','Add OT','Salary','Expense','Send Home','Money Given'],bn:['কাজ যোগ','OT যোগ','বেতন','খরচ','পরিবারে পাঠানো','অন্যদের দেওয়া'],tr:['İş ekle','Mesai ekle','Maaş','Gider','Eve para gönder','Para verildi'],bg:['Добави работа','Добави извънреден труд','Заплата','Разход','Изпрати у дома','Дадени пари'],hi:['काम जोड़ें','ओटी जोड़ें','वेतन','खर्च','घर पैसे भेजें','दिए गए पैसे'],el:['Προσθήκη εργασίας','Προσθήκη υπερωρίας','Μισθός','Έξοδο','Αποστολή χρημάτων','Χρήματα που δόθηκαν']}[lang()]||['Add Work','Add OT','Salary','Expense','Send Home','Money Given'];['qa_work','qa_ot','qa_salary','qa_expense','qa_remit','qa_gift'].forEach(function(k,i){document.querySelectorAll('[data-t='+k+']').forEach(function(el){el.textContent=qa[i];});});document.querySelector('[data-t=quickDutyLabel]').textContent=ex.quickDutyLabel;document.getElementById('homeQuickDuty').textContent='✅ '+ex.quickDutyLabel;document.querySelectorAll('[data-t=peopleTitle]').forEach(function(el){el.textContent=ex.peopleTitle;});document.querySelector('[data-t=peopleNote]').textContent=ex.peopleNote;
    $('month').textContent = fmtMonth(m);
    $('clock').setAttribute('aria-label', tr('clock_label')); clockShown = { d: '', t: '' }; tickClock();
    $('earned').textContent = money(c.wages); $('days').textContent = c.workedDays; $('basicDays').textContent = c.workedDays; $('ot').textContent = numFmt(c.otHours) + ' h';
    var monthTips = d.work.filter(function(x){return String(x.date||'').slice(0,7)===m;}).reduce(function(n,x){return n+C.num(x.tips);},0); $('monthOtIncome').textContent=money(c.otPay); $('monthTipsIncome').textContent=money(monthTips);
    var todayRec=d.work.find(function(x){return x.date===today();}), todayParts=todayRec?C.dayParts(todayRec,s):{base:0,otHours:0,otPay:0}; var todayTips=todayRec?C.num(todayRec.tips):0, todayTotal=C.r2(todayParts.base+todayParts.otPay+todayTips); $('todayEarnings').textContent=money(todayTotal); $('todayBreakdown').innerHTML='<span>Basic Duty · '+money(todayParts.base)+'</span><span>Overtime · '+numFmt(todayParts.otHours)+' h · '+money(todayParts.otPay)+'</span><span>Tips · '+money(todayTips)+'</span><b>Total · '+money(todayTotal)+'</b>'; renderTodayProgram();
    $('formula').textContent = tr('fml', { basic: numFmt(s.basic), ot: numFmt(s.otRate) });
    $('received').textContent = money(c.salaryReceived); $('incomeLabel').textContent = tr('incomeThisMonth'); $('expTotal').textContent = money(c.expenses);
    $('busLine').textContent = c.busDue > 0
      ? tr('bus_line', { due: money(c.busDue), status: tr('bus_' + c.busStatus) }) + (c.busStatus === 'partial' ? ' · ' + tr('bus_left', { amount: money(c.busOutstanding) }) : '')
      : tr('bus_notdue');
    var tw = d.work.find(function (x) { return x.date === today(); });
    $('today').textContent = tw ? statusLabel(tw.status) + (C.normStatus(tw.status) === 'worked' ? ' · ' + numFmt(tw.hours) + ' h' : '') : tr('notRecorded'); dutyButtonState();

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
      return row(fmtRecordDate(x) + ' · ' + (x.recipient || ''), tr('rate_lbl') + ' ' + numFmt(x.rate, 4) + ' · ' + tr('fee_lbl') + ' ' + money(q.fee) + ' · ' + tr('bonus_eur') + ' ' + money(q.bonusEur) + ' · ' + (q.actualBdt !== null ? tr('bdt') : tr('est_bdt')) + ' ' + numFmt(q.bdt), money(q.amount), 'remittances', x.id);
    }).join('') || '<small class="empty">' + safe(tr('empty_remit')) + '</small>';
    $('giftList').innerHTML = d.gifts.filter(mo).sort(byDateDesc).map(function (x) {
      return row(fmtRecordDate(x) + ' · ' + (x.person || ''), x.note || '', money(x.amount, String(x.currency || 'EUR').toUpperCase()), 'gifts', x.id);
    }).join('') || '<small class="empty">' + safe(tr('empty_gifts')) + '</small>';
    renderWorkCalendar(); renderPeople();

    ['basic', 'standard', 'otRate', 'bus', 'bonus', 'salaryMonthly', 'weeklyDays'].forEach(function (k) { if (document.activeElement !== $(k)) $(k).value = s[k]; });
    ['paidLeave', 'paidHoliday', 'sickPaid'].forEach(function (k) { $(k).checked = !!s[k]; });
    $('language').value = lang(); $('theme').value = s.theme;
    $('verLine').textContent = 'My Salary Tracker • ' + tr('ver') + ' ' + VERSION;
    $('aboutText').textContent = tr('about_text'); $('aboutVer').textContent = tr('ver') + ' ' + VERSION;
    renderBackupUi(); renderReport(); renderDesignSummary(c); renderDBBanner();
    ['record','quickDuty','addWork','addPayment','addExpense','addRemit','addGift','addPerson'].forEach(function(id){var el=$(id);if(el)el.disabled=!state.dbReady;});
    document.querySelectorAll('[data-action]').forEach(function(el){el.disabled=!state.dbReady;});
    $('menuDutyProgram').disabled=!state.dbReady;
    refreshMsgs();
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
    work: [['date', 'f_date', 'date', 1], ['status', 'f_status', 'status', 1], ['hours', 'f_hours', 'number', 0, { step: '0.25', min: '0', max: '24' }], ['otExtraHours', 'Overtime hours', 'number', 0, { step: '0.25', min: '0', max: '24' }], ['tips', 'Tips (€)', 'number', 0, { step: '0.01', min: '0' }]],
    payments: [['date', 'f_payDate', 'date', 1], ['month', 'f_salaryMonth', 'month', 1], ['amount', 'f_amountRecv', 'number', 1, NUM], ['bus', 'f_bus', 'number', 0, NUM], ['note', 'f_note', 'text', 0]],
    expenses: [['date', 'f_date', 'date', 1], ['category', 'f_category', 'category', 1], ['amount', 'f_amount', 'number', 1, NUM], ['note', 'f_note', 'text', 0]],
    remittances: [['date', 'f_date', 'date', 1], ['recipient', 'f_recipient', 'text', 1], ['amount', 'f_sent', 'number', 1, NUM], ['rate', 'f_rate', 'number', 1, { step: '0.0001', min: '0' }], ['fee', 'f_fee', 'number', 0, NUM], ['bonus', 'f_bonus', 'number', 0, { step: '0.1', min: '0' }], ['actualBdt', 'f_actualBdt', 'number', 0, NUM], ['note', 'f_note', 'text', 0]],
    gifts: [['date', 'f_date', 'date', 1], ['person', 'f_person', 'text', 1], ['currency', 'f_currency', 'currency', 1], ['amount', 'f_amount', 'number', 1, NUM], ['note', 'f_note', 'text', 0]]
  };
  function defaultDate() { var t = today(); return t.slice(0, 7) === viewMonth() ? t : viewMonth() + '-01'; }
  function openForm(kind, old) {
    if (!state.dbReady) { toast('ডাটাবেস প্রস্তুত নয়। উপরের Retry চাপুন।'); return; }
    closeWorkCalendar(); // Opening OT/work/money forms must never auto-show the calendar.
    old = old || {}; state.edit = { kind: kind, id: old.id === undefined ? null : old.id }; setMsg('formErr', null);
    $('dlgTitle').textContent = tr((old.id ? 'edit_' : 'add_') + kind);
    var box = $('fields'); box.innerHTML = '';
    FIELDS[kind].forEach(function (f) {
      var key = f[0], type = f[2], wrap = document.createElement('label'), span = document.createElement('span'), input;
      span.textContent = tr(f[1]); wrap.appendChild(span); if(kind==='work'&&key==='hours') wrap.setAttribute('data-work-hours-field','');
      var val = old[key];
      if (type === 'status' || type === 'category' || type === 'currency' || (kind==='gifts'&&key==='person')) {
        input = document.createElement('select');
        var opts = (kind==='gifts'&&key==='person') ? (state.settings.people||[]).map(function(n){return [n,n];}).concat([['__add_person__','＋ Add new person']]) : type === 'status' ? C.STATUSES.map(function (k) { return [k, tr('st_' + k)]; }) : type === 'category' ? catKeys().map(function (k) { return [k, tr('cat_' + k)]; }) : [['EUR','EUR (€)'],['BDT','BDT (৳)'],['TRY','TRY (₺)'],['BGN','BGN (лв)'],['INR','INR (₹)'],['USD','USD ($)'],['GBP','GBP (£)']];
        if (type === 'status' && val != null && C.normStatus(val)) val = C.normStatus(val);
        if (type === 'category' && val != null) { var lk = String(val).trim().toLowerCase(); if (T.en['cat_' + lk]) val = lk; if (val === 'rent' && opts.every(function (o) { return o[0] !== 'rent'; })) opts.push(['rent', tr('cat_rent')]); }
        if (type === 'currency' && val != null) val = String(val).toUpperCase();
        if (val != null && val !== '' && opts.every(function (o) { return o[0] !== val; })) opts.push([val, String(val) + ' ⚠']);   // keep unknown old values instead of losing them
        opts.forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; input.appendChild(op); });
        if (val == null || val === '') val = type === 'status' ? 'worked' : type === 'category' ? 'food' : (kind==='gifts'&&key==='person' ? (state.settings.people[0]||'') : 'EUR');
      } else {
        input = document.createElement('input'); input.type = type;
        if (type === 'number') { input.inputMode = 'decimal'; var a = f[4] || {}; Object.keys(a).forEach(function (n) { input.setAttribute(n, a[n]); }); }
        if (val == null) val = { date: defaultDate(), month: viewMonth(), hours: 8, otExtraHours: 0, tips: 0, bonus: state.settings.bonus, fee: 0, bus: 0 }[key]; if (val == null || (type === 'number' && val === null)) val = '';
      }
      input.name = key; input.value = val; if (f[3]) input.required = true;
      wrap.appendChild(input); box.appendChild(wrap);
    });
    if(['payments','expenses','remittances','gifts'].indexOf(kind)>=0){var rw=document.createElement('div');rw.className='receipt-field';var rs=document.createElement('span');rs.textContent='Optional receipt (photo/PDF, max 5 MB)';rw.appendChild(rs);var fi=document.createElement('input');fi.type='file';fi.name='receiptFile';fi.accept='image/*,application/pdf';rw.appendChild(fi);if(old.receipt){var details=document.createElement('details');details.innerHTML='<summary>Current receipt</summary>'+(String(old.receipt.type||'').indexOf('image/')===0?'<img class="receipt-preview" src="'+safe(old.receipt.data)+'" alt="Current receipt">':'<a href="'+safe(old.receipt.data)+'" target="_blank" rel="noopener">Open current file</a>');rw.appendChild(details);var rm=document.createElement('label');rm.className='check';var chk=document.createElement('input');chk.type='checkbox';chk.name='removeReceipt';var tx=document.createElement('span');tx.textContent='Remove current receipt';rm.appendChild(chk);rm.appendChild(tx);rw.appendChild(rm);}box.appendChild(rw);} if(kind==='work'){var statusEl=box.querySelector('[name=status]'),hoursWrap=box.querySelector('[data-work-hours-field]');function toggleHours(){if(hoursWrap)hoursWrap.hidden=!statusEl||statusEl.value!=='worked';}if(statusEl)statusEl.addEventListener('change',toggleHours);toggleHours();} $('deleteBtn').hidden = old.id === undefined; openDlg('editDialog');
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
      if (worked) { if (v.hours === null || Number.isNaN(v.hours) || v.hours < 0 || v.hours > 24) return fail('err_hours'); } else v.hours = 0; if (v.otExtraHours === null) v.otExtraHours = 0; if (!Number.isFinite(v.otExtraHours) || v.otExtraHours < 0 || v.otExtraHours > 24) return fail('err_hours'); if (v.tips === null) v.tips = 0; if (!Number.isFinite(v.tips) || v.tips < 0 || v.tips > 100000) return fail('err_amount');
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
    var record = Object.assign({}, old, v, { id: old.id || uid() }); var fileInput=$('fields').querySelector('[name=receiptFile]'); if(fileInput&&fileInput.files&&fileInput.files[0]){var f=fileInput.files[0];if(f.size>5*1024*1024)return fail('err_amount');record.receipt={name:f.name,type:f.type||'application/octet-stream',data:await readDataUrl(f)};}if($('fields').querySelector('[name=removeReceipt]')&&$('fields').querySelector('[name=removeReceipt]').checked)delete record.receipt;if(kind==='gifts')addPersonName(v.person); if(kind==='work'){record.basicRate=old.basicRate===undefined?state.settings.basic:old.basicRate;record.standardHours=old.standardHours===undefined?state.settings.standard:old.standardHours;record.otRate=old.otRate===undefined?state.settings.otRate:old.otRate;record.busAllowanceRate=old.busAllowanceRate===undefined?state.settings.bus:old.busAllowanceRate;}
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
      if (sg && sg.estimate) { var e = await sg.estimate(); st.usage = e && e.usage != null ? e.usage : null; st.quota = e && e.quota != null ? e.quota : null; }
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

  function closeWorkCalendar() { var panel=$('calendarPanel'),btn=$('calendarToggle'); if(panel&&btn){panel.hidden=true;btn.setAttribute('aria-expanded','false');btn.textContent=tr('showCalendar');} }
  function switchView(view) {
    closeWorkCalendar();
    document.body.setAttribute('data-view', view);
    if(['home','work','money','reports','settings'].indexOf(view)<0)view='home';
    document.body.setAttribute('data-view', view);
    document.querySelectorAll('[data-nav]').forEach(function(b){var target=b.getAttribute('data-nav');var active=(view==='home'&&target==='top')||(view==='work'&&target==='work')||(view==='money'&&target==='payments')||(view==='reports'&&target==='reports');b.classList.toggle('active',active);});
    window.scrollTo({top:0,behavior:'smooth'});
  }

  /* ---------- events ---------- */
  function bind() {
    $('menuBtn').onclick = function () { openDlg('menu'); }; $('menuDutyProgram').onclick=openProgram; $('saveProgram').onclick=saveProgram; $('dbRetry').onclick=function(){return initializeDatabase();}; $('balanceDetails').onclick=function(){switchView('reports');}; $('recentDetails').onclick=function(){switchView('money');}; $('programRest').onchange=function(){ $('programTimes').hidden=this.checked; }; $('programHistory').addEventListener('click',function(e){var b=e.target.closest('[data-program-edit]');if(!b)return;var p=state.data.dutyPrograms.find(function(x){return x.id===b.getAttribute('data-program-edit');});if(!p)return;$('programDate').value=p.date;$('programRest').checked=!!p.rest;$('programTimes').hidden=!!p.rest;$('programStart').value=p.start||'';$('programEnd').value=p.end||'';$('programBreak').value=p.breakMinutes||0;$('programOt').value=p.otHours||0;$('programPreview').textContent='Existing photo: '+(p.photo&&p.photo.name||'saved');});
    $('menuUpdate').onclick=function(){closeDlg('menu');if(navigator.serviceWorker&&navigator.serviceWorker.getRegistration){navigator.serviceWorker.getRegistration().then(function(reg){if(reg)reg.update().catch(function(){});toast('Update check started. If an update is available, the app will prompt you.');}).catch(function(){toast('Could not check for updates.');});}else{toast('Update check is not supported in this browser.');}};$('privacyBtn').onclick=function(){closeDlg('menu');openDlg('privacyDlg');};
    document.querySelectorAll('[data-money-jump]').forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-money-jump');document.getElementById(id).scrollIntoView({behavior:'smooth',block:'start'});};});
    document.querySelectorAll('[data-target]').forEach(function (b) { b.onclick = function () { closeDlg('menu'); var id = b.getAttribute('data-target'); switchView(id==='top'?'home':id==='reports'?'reports':id==='settings'||id==='language'?'settings':id==='work'?'work':'money');if(id==='people'||id==='backupSec'||id==='gifts'||id==='language'||id==='export')setTimeout(function(){var target=id==='language'?'settings':id==='export'?'backupSec':id;document.getElementById(target).scrollIntoView({behavior:'smooth',block:'start'});if(id==='language')document.getElementById('language').focus();},80); }; });
    $('aboutBtn').onclick = function () { closeDlg('menu'); openDlg('aboutDlg'); };
    document.querySelectorAll('[data-action]').forEach(function(b){b.onclick=function(){var k=b.getAttribute('data-action');closeDlg('quickAddDialog');if(k==='ot'){var old=state.data.work.find(function(x){return x.date===today();});var baseHours=old&&C.normStatus(old.status)==='worked'?Math.min(state.settings.standard,C.num(old.hours)):state.settings.standard;var priorOt=old?(old.otExtraHours!==undefined?C.num(old.otExtraHours):Math.max(0,C.num(old.hours)-state.settings.standard)):0;openForm('work',old?Object.assign({},old,{status:'worked',hours:baseHours,otExtraHours:priorOt+1}):{date:today(),status:'worked',hours:state.settings.standard,otExtraHours:1});}else openForm(k);};});
    document.querySelectorAll('[data-nav]').forEach(function(b){b.onclick=function(){var target=b.getAttribute('data-nav');if(target==='quickActions'){openDlg('quickAddDialog');return;}switchView(target==='top'?'home':target==='work'?'work':target==='payments'?'money':target==='reports'?'reports':'home');};});
    document.addEventListener('click', function (e) {
      var cl = e.target.closest('.closeDlg'); if (cl) { var dd = cl.closest('dialog'); if (dd) { if (dd.close) dd.close(); else dd.removeAttribute('open'); } return; }
      var d = e.target.closest('[data-delete]'); if (d) { if($('peopleDlg').open)closeDlg('peopleDlg');var dk = d.getAttribute('data-delete'); deleteRecord(dk, findRec(dk, d.getAttribute('data-id'), d.getAttribute('data-idt'))); return; }
      var b = e.target.closest('[data-edit]'); if (b) { if($('peopleDlg').open)closeDlg('peopleDlg');var k = b.getAttribute('data-edit'); openForm(k, findRec(k, b.getAttribute('data-id'), b.getAttribute('data-idt')) || {}); return; }
      var j = e.target.closest('[data-jump]'); if (j) { var t=j.getAttribute('data-jump'); switchView(t==='payments'?'money':t==='expenses'?'money':'work'); }
    });
    $('record').onclick = function () { var tw = state.data.work.find(function (x) { return x.date === today(); }); openForm('work', tw || { date: today() }); };
    $('quickDuty').onclick = quickBasicDuty; $('homeQuickDuty').onclick=quickBasicDuty;
    $('calendarToggle').onclick=function(){var panel=$('calendarPanel'),btn=$('calendarToggle'),open=panel.hidden;panel.hidden=!open;btn.setAttribute('aria-expanded',open?'true':'false');btn.textContent=tr(open?'hideCalendar':'showCalendar');};
    $('workPrev').onclick=function(){state.month=new Date(state.month.getFullYear(),state.month.getMonth()-1,1);render();};$('workNext').onclick=function(){state.month=new Date(state.month.getFullYear(),state.month.getMonth()+1,1);render();};
    $('workCalendar').addEventListener('click',function(e){var b=e.target.closest('[data-cal-date]');if(!b)return;var dt=b.getAttribute('data-cal-date'),rec=state.data.work.find(function(x){return x.date===dt;});if(rec)openForm('work',rec);else openForm('work',{date:dt,status:'worked',hours:state.settings.standard,otExtraHours:0});});
    $('peopleList').addEventListener('click',function(e){var b=e.target.closest('[data-person]');if(b)openPerson(b.getAttribute('data-person'));});
    $('addPerson').onclick=function(){var name=prompt('নতুন ব্যক্তির নাম লিখুন।');if(name&&name.trim()){addPersonName(name.trim());renderPeople();openForm('gifts',{date:defaultDate(),person:name.trim(),currency:'EUR'});}};
    $('renamePerson').onclick=function(){renamePerson(state.personSelected);}; $('personDirectory').addEventListener('click',function(e){var b=e.target.closest('[data-person-rename]');if(b)renamePerson(b.getAttribute('data-person-rename'));});
    $('addWork').onclick = function () { openForm('work'); }; $('addPayment').onclick = function () { openForm('payments'); }; $('addExpense').onclick = function () { openForm('expenses'); };
    $('addRemit').onclick = function () { openForm('remittances'); }; $('addGift').onclick = function () { openForm('gifts'); };
    $('editForm').addEventListener('submit', saveForm); $('fields').addEventListener('change',function(e){if(e.target.name==='person'&&e.target.value==='__add_person__'){var n=prompt('নতুন ব্যক্তির নাম লিখুন');if(n&&n.trim()){addPersonName(n.trim());var o=document.createElement('option');o.value=n.trim();o.textContent=n.trim();e.target.insertBefore(o,e.target.querySelector('[value=__add_person__]'));e.target.value=n.trim();}else e.target.value='';}});
    $('editDialog').addEventListener('close', function () { state.edit = null; });
    $('deleteBtn').onclick = async function () { if (state.edit && state.edit.id != null) { var k = state.edit.kind, rec = state.data[k].find(function (x) { return x.id === state.edit.id; }); closeDlg('editDialog'); await deleteRecord(k, rec); } };
    $('prev').onclick = function () { state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1); render(); };
    $('next').onclick = function () { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1); render(); };
    document.querySelectorAll('[data-rtype]').forEach(function (b) { b.onclick = function () { state.rtype = b.getAttribute('data-rtype'); if (state.rtype === 'year') state.ryear = state.month.getFullYear(); renderReport(); }; });
    $('rPrev').onclick = function () { if (state.rtype === 'month') { state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1); render(); } else { state.ryear--; renderReport(); } };
    $('rNext').onclick = function () { if (state.rtype === 'month') { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1); render(); } else { state.ryear++; renderReport(); } };
    $('language').onchange = function () { state.settings.language = $('language').value; persistSettings(); render(); };
    $('theme').onchange = function () { state.settings.theme = $('theme').value; persistSettings(); render(); };
    $('salaryMonthly').oninput=function(){var d=Number($('salaryMonthly').value),w=Number($('weeklyDays').value);$('basic').value=(d>0&&w>0)?(d/(w*52/12)).toFixed(2):'0';}; $('weeklyDays').oninput=function(){var d=Number($('salaryMonthly').value),w=Number(this.value);$('basic').value=(d>0&&w>0)?(d/(w*52/12)).toFixed(2):'0';};
    $('saveSettings').onclick = function () {
      var vals = {}, ok = true;
      ['basic', 'standard', 'otRate', 'bus', 'bonus', 'salaryMonthly', 'weeklyDays'].forEach(function (k) { var raw = $(k).value.trim(), n = Number(raw); if (raw === '' || !Number.isFinite(n) || n < 0) ok = false; vals[k] = n; });
      if (vals.standard > 24 || vals.weeklyDays<1 || vals.weeklyDays>7 || vals.weeklyDays%1!==0) ok = false; vals.basic = vals.salaryMonthly/(vals.weeklyDays*52/12);
      if (!ok) { setMsg('settingsMsg', M('err_settings')); return; }
      setMsg('settingsMsg', null); Object.assign(state.settings, vals);
      ['paidLeave', 'paidHoliday', 'sickPaid'].forEach(function (k) { state.settings[k] = $(k).checked; }); state.settings.rentEnabled=false;
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
    loadSettings(); applyTheme(); bind(); safeRender(); renderDBBanner(); startClock();
    document.addEventListener('visibilitychange', function () { if (document.hidden) stopClock(); else startClock(); });
    registerSW();
    try { await initializeDatabase(); } catch (e) { state.dbError = e; renderDBBanner(); }
    safeRender();
    initStorage().then(function () { renderBackupUi(); });
  }
  function registerSW() {
    if ('serviceWorker' in navigator) {
      try {
        navigator.serviceWorker.register('./service-worker.js').then(function (reg) {
          reg.addEventListener('updatefound', function () { var nw = reg.installing; if (nw) nw.addEventListener('statechange', function () { if (nw.state === 'installed' && navigator.serviceWorker.controller) maybeShowUpdate(); }); });
        }).catch(function () { });
      } catch (e) { }
    }
  }
  window.MSTReady = init();
  window.MSTDebug = { refresh: refresh, render: render, tickClock: tickClock, buildCsvReport: buildCsvReport, buildPrintHtml: buildPrintHtml, currentReport: currentReport, state: state, validateBackup: validateBackup, buildBackup: buildBackup, buildCsvAll: buildCsvAll, writeAll: writeAll, planMerge: R.planMerge, put: put, putWork: putWork, del: del, getAll: getAll, initializeDatabase: initializeDatabase, errCategory: errCategory, rawPut: rawPut };
})();
