'use strict';
const test=require('node:test');const assert=require('assert');const fs=require('fs');const path=require('path');
const P=require('./profile.js');const {load,seed,dump,sleep,ROOT}=require('./harness');
const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const W=(id,date,x)=>Object.assign({id,date,status:'worked',hours:8,basicRate:25,standardHours:8,otRate:2.77,busAllowanceRate:50,tips:0,note:''},x);
const JPEG='data:image/jpeg;base64,'+Buffer.from('x'.repeat(3000)).toString('base64');
const fakeEnv=(sizes)=>({decode:async()=>({width:4000,height:3000,source:{}}),canvas:(side)=>{const c={side,ctx:{fillRect(){},drawImage(){},set fillStyle(v){}},toDataURL:(t,q)=>{c.q=q;return sizes.shift()}};envLog.push(c);return c}});
let envLog=[];
const mem=()=>{const m={};return {getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v)},m}};

// ---------- profile.js unit tests ----------
test('name cleaning: trims, collapses spaces, strips angle brackets, max 60',()=>{
  assert.equal(P.cleanName('  Mehedi   Hasan '),'Mehedi Hasan');assert.equal(P.cleanName('<b>x</b>'),'bx/b');assert.equal(P.cleanName('a'.repeat(100)).length,60);assert.equal(P.cleanName(null),'');
});
test('initials work for English and Bengali names',()=>{assert.equal(P.initials('Mehedi Hasan'),'MH');assert.equal(P.initials('মেহেদী হাসান'),'মহ'); assert.equal(P.initials(''),'')});
test('photo validation accepts only small image data URLs',()=>{
  assert.equal(P.validPhoto(JPEG),true);assert.equal(P.validPhoto('http://evil.example/a.jpg'),false);assert.equal(P.validPhoto('data:text/html;base64,AAAA'),false);assert.equal(P.validPhoto('javascript:alert(1)'),false);
  assert.equal(P.validPhoto('data:image/jpeg;base64,'+'A'.repeat(300000)),false);
});
test('save/load round trip; invalid stored data is ignored, not trusted',()=>{
  const s=mem();assert.equal(P.save(s,{name:' Rafi ',photo:JPEG}).ok,true);const p=P.load(s);assert.equal(p.name,'Rafi');assert.equal(p.photo,JPEG);
  s.setItem(P.KEY,'{"name":"A","photo":"http://x/y.png"}');assert.equal(P.load(s).photo,'');s.setItem(P.KEY,'not json');assert.deepStrictEqual(P.load(s),P.empty());
});
test('storage failure is reported by reason and leaves the saved profile unchanged',()=>{
  const s=mem();P.save(s,{name:'Old',photo:''});
  const quota={getItem:s.getItem,setItem(){const e=new Error('full');e.name='QuotaExceededError';throw e}};
  const r=P.save(quota,{name:'New',photo:''});assert.equal(r.ok,false);assert.equal(r.reason,'quota');assert.equal(P.load(s).name,'Old');
  assert.equal(P.save({setItem(){const e=new Error('denied');e.name='SecurityError';throw e}},{name:'x'}).reason,'denied');
});
test('compress: centre-crops, rescales to <=256px, falls back to smaller size/quality when too big',async()=>{
  envLog=[];const big='data:image/jpeg;base64,'+'A'.repeat(130000),ok=JPEG;
  const url=await P.compress({type:'image/jpeg',size:5e6},fakeEnv([big,ok]));
  assert.equal(url,ok);assert.equal(envLog[0].side,256);assert.equal(envLog[1].side,192);assert.ok(envLog[1].q<envLog[0].q);
  assert.deepStrictEqual(P.fitSquare(4000,3000,256),{sx:500,sy:0,side:3000,out:256});
});
test('compress rejects non-images, oversize files, unreadable images and impossible sizes',async()=>{
  await assert.rejects(()=>P.compress({type:'application/pdf',size:1},fakeEnv([])),e=>e.code==='type');
  await assert.rejects(()=>P.compress({type:'image/png',size:30e6},fakeEnv([])),e=>e.code==='size');
  await assert.rejects(()=>P.compress({type:'image/png',size:1},{decode:async()=>{throw new Error('x')}}),e=>e.code==='decode');
  const big='data:image/jpeg;base64,'+'A'.repeat(130000);
  await assert.rejects(()=>P.compress({type:'image/png',size:1},fakeEnv([big,big,big])),e=>e.code==='big');
});
test('backup helpers: merge only fills blanks, replace takes the backup, junk is dropped',()=>{
  const cur={name:'Phone',photo:'',updatedAt:'a'},bk={name:'Backup',photo:JPEG,updatedAt:'b'};
  assert.deepStrictEqual(P.fromBackup(bk,cur,false),{name:'Phone',photo:JPEG,updatedAt:'a'});
  assert.equal(P.fromBackup(bk,cur,true).name,'Backup');assert.equal(P.fromBackup({name:'',photo:'bad'},cur,true),null);assert.equal(P.forBackup(P.empty()),null);
});

// ---------- app integration (real index.html + app.js) ----------
async function app(opts){const a=await load(opts);a.w.MSTProfile.browserEnv=()=>fakeEnv([JPEG,JPEG,JPEG]);return a}
const open=a=>{a.$('menuAccount').click()};
const nowYM=()=>{const n=new Date();return n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0')};
const openDay=(a,day)=>{a.w.document.querySelector('[data-cal-date="'+nowYM()+'-'+day+'"]').click()};
const fileOf=(a,name='p.jpg')=>new a.w.File([new Uint8Array([1,2,3])],name,{type:'image/jpeg'});
async function pick(a,f){Object.defineProperty(a.$('pfFile'),'files',{value:[f],configurable:true});a.$('pfFile').dispatchEvent(new a.w.Event('change'));await sleep(60)}

test('default avatar + prompt are shown when no profile exists (menu and My Account)',async()=>{
  const a=await app();open(a);
  assert.ok(a.$('pfAvatar').querySelector('svg use'));assert.ok(a.$('menuAvatar').querySelector('svg use'));
  assert.equal(a.$('menuName').textContent,'Add your name');assert.equal(a.$('pfForm').hidden,true);a.close();
});
test('edit name -> Save persists, shows in My Account and menu, survives reload',async()=>{
  const a=await app();open(a);a.$('pfEdit').click();assert.equal(a.$('pfForm').hidden,false);
  a.$('pfName').value='Mehedi Hasan';a.$('pfForm').dispatchEvent(new a.w.Event('submit',{cancelable:true}));
  assert.equal(a.$('pfNameView').textContent,'Mehedi Hasan');assert.equal(a.$('menuName').textContent,'Mehedi Hasan');assert.equal(a.$('pfAvatar').textContent.trim(),'MH');
  const raw=JSON.parse(a.w.localStorage.getItem('mst-profile'));assert.equal(raw.name,'Mehedi Hasan');
  const ls=a.w.localStorage.getItem('mst-profile');a.close();
  const b=await app({beforeApp:w=>w.localStorage.setItem('mst-profile',ls)});assert.equal(b.$('menuName').textContent,'Mehedi Hasan');b.close();
});
test('photo: preview shows BEFORE saving, Cancel discards it, Save keeps it',async()=>{
  const a=await app();open(a);a.$('pfEdit').click();await pick(a,fileOf(a));
  assert.ok(a.$('pfPreview').querySelector('img'),'preview image');assert.equal(a.$('pfUnsaved').hidden,false);assert.equal(a.w.localStorage.getItem('mst-profile'),null,'nothing stored yet');
  assert.equal(a.$('pfChangeLbl').textContent,'Change photo');
  a.$('pfCancel').click();assert.ok(!a.$('pfAvatar').querySelector('img'));assert.equal(a.w.localStorage.getItem('mst-profile'),null);
  a.$('pfEdit').click();await pick(a,fileOf(a));a.$('pfName').value='Rafi';a.$('pfForm').dispatchEvent(new a.w.Event('submit',{cancelable:true}));
  assert.ok(a.$('pfAvatar').querySelector('img'));assert.ok(a.$('menuAvatar').querySelector('img'));assert.equal(JSON.parse(a.w.localStorage.getItem('mst-profile')).photo,JPEG);a.close();
});
test('remove photo works and is saved; change photo replaces it',async()=>{
  const a=await app();open(a);a.$('pfEdit').click();await pick(a,fileOf(a));a.$('pfForm').dispatchEvent(new a.w.Event('submit',{cancelable:true}));
  a.$('pfEdit').click();a.$('pfRemove').click();assert.ok(!a.$('pfPreview').querySelector('img'));a.$('pfName').value='R';a.$('pfForm').dispatchEvent(new a.w.Event('submit',{cancelable:true}));
  assert.equal(JSON.parse(a.w.localStorage.getItem('mst-profile')).photo,'');assert.ok(!a.$('menuAvatar').querySelector('img'));a.close();
});
test('bad photo (decode error) shows an error and keeps the form usable',async()=>{
  const a=await app();a.w.MSTProfile.browserEnv=()=>({decode:async()=>{throw new Error('boom')}});open(a);a.$('pfEdit').click();await pick(a,fileOf(a));
  assert.match(a.$('pfErr').textContent,/could not be/i);assert.equal(a.$('pfChange').disabled,false);a.close();
});
test('storage full: clear error, previously saved profile unchanged',async()=>{
  const a=await app();open(a);a.$('pfEdit').click();a.$('pfName').value='First';a.$('pfForm').dispatchEvent(new a.w.Event('submit',{cancelable:true}));
  a.w.Storage.prototype.setItem=function(){const e=new Error('q');e.name='QuotaExceededError';throw e};
  a.$('pfEdit').click();a.$('pfName').value='Second';a.$('pfForm').dispatchEvent(new a.w.Event('submit',{cancelable:true}));
  assert.match(a.$('pfErr').textContent,/storage is full/i);assert.equal(a.$('menuName').textContent,'First');a.close();
});
test('profile never touches IndexedDB: same version, same stores, same records',async()=>{
  const a=await app();await a.D.putWork(W('w1','2026-11-01'));const before=await dump(a.idb);
  open(a);a.$('pfEdit').click();await pick(a,fileOf(a));a.$('pfName').value='X';a.$('pfForm').dispatchEvent(new a.w.Event('submit',{cancelable:true}));
  assert.deepStrictEqual(await dump(a.idb),before);a.close();
});
test('Bengali UI strings exist for the profile screen',async()=>{
  const a=await app({beforeApp:w=>w.localStorage.setItem('mst-settings',JSON.stringify({language:'bn'}))});
  assert.equal(a.$('pfEdit').textContent.trim(),'প্রোফাইল সম্পাদনা');assert.equal(a.$('menuName').textContent,'আপনার নাম যোগ করুন');a.close();
});
test('backup contains the profile; Merge keeps phone values, Replace takes the backup',async()=>{
  const a=await app();await a.D.putWork(W('w1','2026-11-01'));open(a);a.$('pfEdit').click();await pick(a,fileOf(a));a.$('pfName').value='Original';a.$('pfForm').dispatchEvent(new a.w.Event('submit',{cancelable:true}));
  await a.D.refresh();const bk=JSON.parse(JSON.stringify(a.D.buildBackup()));assert.equal(bk.profile.name,'Original');assert.equal(bk.profile.photo,JPEG);assert.equal(a.D.validateBackup(bk).ok,true,'older/newer validators accept the extra field');
  // restore into a phone with a different profile
  const b=await app({beforeApp:w=>w.localStorage.setItem('mst-profile',JSON.stringify({name:'PhoneName',photo:'',updatedAt:'t'}))});
  const v=b.D.validateBackup(bk);b.state.pending={v,name:'x.json',safety:true,profile:P.forBackup(bk.profile)};
  b.$('rsMerge').disabled=false;b.$('rsMerge').click();await sleep(300);
  let p=JSON.parse(b.w.localStorage.getItem('mst-profile'));assert.equal(p.name,'PhoneName');assert.equal(p.photo,JPEG,'blank photo filled from backup');assert.equal(b.state.data.work.length,1);
  b.state.pending={v,name:'x.json',safety:true,profile:P.forBackup(bk.profile)};b.$('rsReplace').disabled=false;b.$('rsReplace').click();await sleep(100);b.$('cfOk').click();await sleep(300);
  p=JSON.parse(b.w.localStorage.getItem('mst-profile'));assert.equal(p.name,'Original');a.close();b.close();
});
test('backup without a profile (older backups) restores fine and leaves the phone profile alone',async()=>{
  const b=await app({beforeApp:w=>w.localStorage.setItem('mst-profile',JSON.stringify({name:'Keep',photo:'',updatedAt:'t'}))});
  await b.D.putWork(W('w1','2026-11-01'));await b.D.refresh();const bk=JSON.parse(JSON.stringify(b.D.buildBackup()));delete bk.profile;
  const v=b.D.validateBackup(bk);b.state.pending={v,name:'old.json',safety:true,profile:P.forBackup(bk.profile)};b.$('rsMerge').disabled=false;b.$('rsMerge').click();await sleep(300);
  assert.equal(JSON.parse(b.w.localStorage.getItem('mst-profile')).name,'Keep');b.close();
});

// ---------- work form ----------
test('Add work form has ONLY date, status and hours worked (no overtime field)',async()=>{
  const a=await app();openDay(a,'10');
  const names=[...a.$('fields').querySelectorAll('[name]')].map(e=>e.name);assert.deepStrictEqual(names,['date','status','hours']);
  assert.match(a.$('addWork').className,/primary/);a.close();
});
test('add work through the form saves the record (10 h still earns 25 + 2 x 2.77 = 30.54)',async()=>{
  const a=await app();openDay(a,'10');a.$('fields').querySelector('[name=date]').value='2026-11-10';a.$('fields').querySelector('[name=hours]').value='10';
  a.$('editForm').dispatchEvent(new a.w.Event('submit',{cancelable:true}));await sleep(200);
  const d=await dump(a.idb);assert.equal(d.stores.work.length,1);assert.equal(d.stores.work[0].hours,10);
  const C=a.w.MSTCalc;assert.equal(C.dayParts(d.stores.work[0],C.DEFAULTS).total,30.54);a.close();
});
test('editing hours keeps OT added from the OT screen, adds new OT from hours, and keeps tips',async()=>{
  const a=await app();await a.D.putWork(W('w9','2026-11-12',{hours:8,otExtraHours:2,tips:5}));await a.D.refresh();
  a.D.render();const btn=a.w.document.querySelector('[data-edit="work"]');assert.ok(btn,'edit button');btn.click();
  a.$('fields').querySelector('[name=hours]').value='9';a.$('editForm').dispatchEvent(new a.w.Event('submit',{cancelable:true}));await sleep(200);
  const r=(await dump(a.idb)).stores.work[0];assert.equal(r.hours,9);assert.equal(r.otExtraHours,3,'1h new overtime from the extra hour + 2h added earlier from the OT screen');assert.equal(r.tips,5);a.close();
});
test('non-worked status hides hours and saves zero hours',async()=>{
  const a=await app();openDay(a,'14');const st=a.$('fields').querySelector('[name=status]');st.value='holiday';st.dispatchEvent(new a.w.Event('change'));
  assert.equal(a.$('fields').querySelector('[data-work-hours-field]').hidden,true);
  a.$('fields').querySelector('[name=date]').value='2026-11-14';a.$('editForm').dispatchEvent(new a.w.Event('submit',{cancelable:true}));await sleep(200);
  const r=(await dump(a.idb)).stores.work[0];assert.equal(r.hours,0);assert.equal(r.status,'holiday');a.close();
});
test('calendar day tap opens the same simple form for that date',async()=>{
  const a=await app();a.D.render();const cell=a.w.document.querySelector('[data-cal-date]');assert.ok(cell);cell.click();
  assert.deepStrictEqual([...a.$('fields').querySelectorAll('[name]')].map(e=>e.name),['date','status','hours']);a.close();
});

// ---------- markup hygiene ----------
test('no emoji icons remain in index.html; every <use> points at a defined symbol; no duplicate ids',()=>{
  assert.equal((html.match(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF\u2B50]/gu)||[]).length,0);
  const defined=new Set([...html.matchAll(/<symbol id="(i-[a-z-]+)"/g)].map(m=>m[1]));
  const used=[...html.matchAll(/<use href="#(i-[a-z-]+)"/g)].map(m=>m[1]);assert.ok(used.length>25);
  assert.deepStrictEqual(used.filter(u=>!defined.has(u)),[]);
  const ids=[...html.matchAll(/ id="([^"]+)"/g)].map(m=>m[1]);assert.deepStrictEqual(ids.filter((x,i)=>ids.indexOf(x)!==i),[]);
});
test('CSP still blocks every network destination; profile.js is a same-origin script and is cached by the service worker',()=>{
  assert.match(html,/connect-src 'self'/);assert.match(html,/<script src="\.\/profile\.js">/);
  assert.match(fs.readFileSync(path.join(ROOT,'service-worker.js'),'utf8'),/'\.\/profile\.js'/);
  assert.equal(/fetch\(|XMLHttpRequest|sendBeacon/.test(fs.readFileSync(path.join(ROOT,'profile.js'),'utf8')),false);
});
test('icons: nav, quick actions and menu render SVG after a full render (JS did not wipe them)',async()=>{
  const a=await app();a.D.render();const d=a.w.document;
  assert.ok(d.querySelectorAll('.bottom-nav svg').length>=5);assert.ok(d.querySelectorAll('.quick svg').length>=6);assert.ok(d.querySelectorAll('#menu .menu-items svg').length>=8);a.close();
});
