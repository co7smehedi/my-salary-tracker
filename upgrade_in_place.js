/* node upgrade_in_place.js <old-app-folder> <new-app-folder>
   The real central-update scenario: ONE browser profile, ONE origin. The old version is installed (service worker + data entered through its own screens),
   then the server starts serving the new version. Every stored value must be identical afterwards. */
const fs = require('fs'), path = require('path'), http = require('http'), os = require('os');
const { chromium } = require('playwright');
const OLD = path.resolve(process.argv[2]), NEW = path.resolve(process.argv[3]);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
let root = OLD;
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(fs.readFileSync(f)); });
const pad = n => String(n).padStart(2, '0'), N = new Date(), M = N.getFullYear() + '-' + pad(N.getMonth() + 1), d = n => M + '-' + pad(n);
let fails = 0; const R = (n, ok, x) => { if (!ok) fails++; console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (x ? '  -> ' + x : '')); };
const dump = p => p.evaluate(async () => { const db = await new Promise((a, b) => { const r = indexedDB.open('salary-tracker-db'); r.onsuccess = () => a(r.result); r.onerror = () => b(r.error); });
  const o = { _version: db.version, _stores: Array.from(db.objectStoreNames).sort() }; for (const s of o._stores) o[s] = (await new Promise(a => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => a(q.result); })).sort((x, y) => String(x.id).localeCompare(String(y.id))); db.close();
  o._ls = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o._ls[k] = localStorage.getItem(k); } return o; });
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + server.address().port;
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true }); const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  await p.goto(base + '/'); await p.evaluate(() => window.MSTReady);
  const oldVer = await p.textContent('#verLine'); console.log('installed first:', oldVer);
  await p.waitForFunction(() => navigator.serviceWorker.getRegistration().then(r => r && r.active)); await p.waitForTimeout(600);
  // --- enter data the way a real user does, through the OLD app's own screens
  await p.click('#addWork'); await p.fill('[name=date]', d(2)); await p.fill('[name=hours]', '10'); await p.click('#editForm button[type=submit]'); await p.waitForTimeout(200);
  await p.click('#addWork'); await p.fill('[name=date]', d(3)); await p.selectOption('[name=status]', 'paid_leave'); await p.click('#editForm button[type=submit]'); await p.waitForTimeout(200);
  await p.click('#addPayment'); await p.fill('[name=amount]', '80'); await p.fill('[name=bus]', '30'); await p.fill('[name=note]', 'march ✓ ñ'); await p.click('#editForm button[type=submit]'); await p.waitForTimeout(200);
  await p.click('#addExpense'); await p.selectOption('[name=category]', 'food'); await p.fill('[name=amount]', '12.34'); await p.click('#editForm button[type=submit]'); await p.waitForTimeout(200);
  await p.click('#addRemit'); await p.fill('[name=recipient]', 'Mum'); await p.fill('[name=amount]', '100'); await p.fill('[name=rate]', '130.5'); await p.fill('[name=fee]', '2'); await p.fill('[name=actualBdt]', '13100'); await p.click('#editForm button[type=submit]'); await p.waitForTimeout(200);
  await p.click('#addGift'); await p.fill('[name=person]', 'Friend'); await p.selectOption('[name=currency]', 'BDT'); await p.fill('[name=amount]', '500'); await p.click('#editForm button[type=submit]'); await p.waitForTimeout(200);
  await p.selectOption('#language', 'bn'); await p.selectOption('#theme', 'dark'); await p.fill('#bus', '55'); await p.click('#saveSettings'); await p.waitForTimeout(200);
  const before = await dump(p); const earnedBefore = await p.textContent('#earned');
  const bkOld = await (async () => { const w = p.waitForEvent('download'); await p.click('#backup'); const dl = await w; return fs.readFileSync(await dl.path(), 'utf8'); })();
  console.log('records before:', ['work', 'payments', 'expenses', 'remittances', 'gifts'].map(s => s + '=' + before[s].length).join(' '), '| db version', before._version, '| earned shown', earnedBefore);

  // --- the new version is "deployed": same origin, same profile, old service worker still in charge
  root = NEW; await p.reload(); await p.evaluate(() => window.MSTReady); await p.waitForTimeout(1500);
  const verNew = await p.textContent('#verLine'); R('new version is running after deploy', /9\.1/.test(verNew), verNew);
  const after = await dump(p);
  for (const s of ['work', 'payments', 'expenses', 'remittances', 'gifts']) R('every ' + s + ' record byte-for-byte identical after upgrade (' + before[s].length + ')', JSON.stringify(before[s]) === JSON.stringify(after[s]));
  R('database version and store list unchanged', before._version === after._version && JSON.stringify(before._stores) === JSON.stringify(after._stores), before._version + ' -> ' + after._version);
  const lsBefore = Object.assign({}, before._ls), lsAfter = Object.assign({}, after._ls); const newKeys = Object.keys(lsAfter).filter(k => !(k in lsBefore));
  R('existing settings/localStorage untouched (only additions allowed)', Object.keys(lsBefore).every(k => lsBefore[k] === lsAfter[k]), 'new keys: ' + (newKeys.join(',') || 'none'));
  R('earned total shown is unchanged', (await p.textContent('#earned')) === earnedBefore, earnedBefore + ' vs ' + await p.textContent('#earned'));
  R('language/theme preserved (Bengali + dark)', (await p.getAttribute('html', 'lang')) === 'bn' && (await p.getAttribute('html', 'data-theme')) === 'dark');
  let caches = [], waited = 0; for (; waited < 12000; waited += 500) { caches = await p.evaluate(() => caches.keys()); if (caches.length === 1 && /9-1-0/.test(caches[0])) break; await p.waitForTimeout(500); }
  const swInfo = await p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return { active: r.active && r.active.state, waiting: !!r.waiting, installing: !!r.installing }; });
  R('old service-worker cache replaced by the new one (waited ' + waited + ' ms)', caches.length === 1 && /9-1-0/.test(caches[0]), caches.join(',') + ' sw=' + JSON.stringify(swInfo));
  R('backup banner shown (records exist, never exported with 9.1)', await p.isVisible('#backupBanner'));
  // --- old-version backup restores cleanly into the new version
  const f = path.join(os.tmpdir(), 'oldbk.json'); fs.writeFileSync(f, bkOld); await p.setInputFiles('#file', f); await p.waitForTimeout(300);
  R('backup made by the OLD version is accepted by the new validator', await p.isVisible('#restoreDlg'));
  const w1 = p.waitForEvent('download'); await p.click('#rsSafety'); await w1; await p.click('#rsMerge'); await p.waitForTimeout(500);
  const merged = await dump(p); for (const s of ['work', 'payments', 'expenses', 'remittances', 'gifts']) R('merge of old backup leaves ' + s + ' identical (no duplicates)', JSON.stringify(before[s]) === JSON.stringify(merged[s]));
  // --- offline with the new service worker
  await ctx.setOffline(true); await p.reload(); await p.evaluate(() => window.MSTReady); const off = await dump(p); R('offline reload: data intact and app loads', JSON.stringify(off.work) === JSON.stringify(before.work) && /9\.1/.test(await p.textContent('#verLine'))); await ctx.setOffline(false);
  // --- v9.1 delete + re-add still keeps everything else
  await b.close(); server.close(); console.log('\n' + (fails ? 'UPGRADE RESULT: ' + fails + ' FAILED' : 'UPGRADE RESULT: ALL PASSED')); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('SCRIPT ERROR', e.stack); process.exit(1); });
