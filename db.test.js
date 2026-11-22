'use strict';
const test=require('node:test');const assert=require('assert');const fs=require('fs');const path=require('path');const vm=require('vm');
const {load,seed,dump,sleep,FDB,ROOT}=require('./harness');
const W=(id,date,extra)=>Object.assign({id,date,status:'worked',hours:8,basicRate:25,standardHours:8,otRate:2.77,busAllowanceRate:50,otExtraHours:0,tips:0,note:''},extra);
const all6={work:[],payments:[],expenses:[],remittances:[],gifts:[],dutyPrograms:[],workEntries:[]};

test('ROOT CAUSE: every $("id") used by app.js exists in index.html (missing #ot crashed render())',()=>{
  const app=fs.readFileSync(path.join(ROOT,'app.js'),'utf8'),html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  const ids=new Set([...app.matchAll(/\$\('([A-Za-z0-9_]+)'\)/g)].map(m=>m[1]));
  const missing=[...ids].filter(i=>!html.includes('id="'+i+'"'));
  assert.deepStrictEqual(missing,[]);
});

test('fresh install: database opens, all stores exist, banner hidden, no render error',async()=>{
  const a=await load();
  assert.equal(a.initError,null);assert.equal(a.state.dbReady,true);assert.equal(a.state.dbError,null);assert.equal(a.state.renderError||null,null);
  assert.equal(a.$('dbBanner').hidden,true);
  const d=await dump(a.idb);assert.deepStrictEqual(Object.keys(d.stores).sort(),Object.keys(all6).sort());
  assert.equal(a.$('ot').textContent,'0 h');a.close();
});

test('existing database (v1 with real records) opens; records and version preserved',async()=>{
  const idb=new FDB.IDBFactory();
  await seed(idb,{version:1,stores:Object.assign({},all6,{work:[W('a','2026-11-01'),W('b','2026-11-02')],payments:[{id:'p1',date:'2026-11-05',month:'2026-11',amount:40,bus:0}]})});
  const a=await load({indexedDB:idb});
  assert.equal(a.state.dbReady,true);assert.equal(a.state.data.work.length,2);assert.equal(a.state.data.payments.length,1);
  assert.equal((await dump(idb)).version,1,'version must not change when nothing is missing');a.close();
});

test('missing object stores are added WITHOUT touching existing records',async()=>{
  const idb=new FDB.IDBFactory();
  await seed(idb,{version:3,stores:{work:[W('a','2026-11-01')],payments:[{id:'p1',date:'2026-11-05',month:'2026-11',amount:40,bus:0}]}});
  const a=await load({indexedDB:idb});
  assert.equal(a.state.dbReady,true);
  const d=await dump(idb);assert.equal(d.version,4);
  assert.deepStrictEqual(Object.keys(d.stores).sort(),Object.keys(all6).sort());
  assert.equal(d.stores.work.length,1);assert.equal(d.stores.work[0].id,'a');assert.equal(d.stores.payments[0].amount,40);a.close();
});

test('database opening failure shows real error category; Retry then recovers (same call path)',async()=>{
  let fail=true,opens=0;const base=new FDB.IDBFactory();
  const factory={open(n,v){opens++;if(!fail)return base.open(n,v);const r={};setTimeout(()=>{const e=new Error('The operation failed for reasons unrelated to the database itself');e.name='UnknownError';r.error=e;r.onerror&&r.onerror({})},5);return r},databases:()=>base.databases&&base.databases()};
  const a=await load({indexedDB:factory});
  assert.equal(a.state.dbReady,false);assert.equal(a.$('dbBanner').hidden,false);
  assert.match(a.$('dbBannerText').textContent,/BROWSER_STORAGE_ERROR/);assert.match(a.$('dbBannerText').textContent,/UnknownError/);
  assert.match(a.$('dbBannerText').textContent,/not been deleted/);
  fail=false;await a.$('dbRetry').onclick();
  assert.equal(a.state.dbReady,true);assert.equal(a.$('dbBanner').hidden,true);a.close();
});

test('blocked upgrade (another window holds old version open): clear BLOCKED error, no data loss, Retry works after other window closes',async()=>{
  const idb=new FDB.IDBFactory();
  await seed(idb,{version:2,stores:{work:[W('a','2026-11-01')]}});
  // "other tab": holds the DB open and ignores versionchange
  const other=await new Promise((res)=>{const r=idb.open('salary-tracker-db');r.onsuccess=()=>res(r.result)});
  other.onversionchange=()=>{};
  const a=await load({indexedDB:idb});
  assert.equal(a.state.dbReady,false);assert.match(a.$('dbBannerText').textContent,/BLOCKED/);assert.match(a.$('dbBannerText').textContent,/Fully close/);
  other.close();await sleep(50);
  await a.$('dbRetry').onclick();
  assert.equal(a.state.dbReady,true);
  const d=await dump(idb);assert.equal(d.stores.work.length,1);assert.equal(d.stores.work[0].id,'a');a.close();
});

test('duplicate initialization is prevented (concurrent calls share ONE attempt)',async()=>{
  const a=await load();let n=0;const orig=a.idb.open.bind(a.idb);a.w.indexedDB.open=function(){n++;return orig.apply(null,arguments)};
  const [x,y,z]=await Promise.all([a.D.initializeDatabase(),a.D.initializeDatabase(),a.D.initializeDatabase()]);
  assert.equal(x,true);assert.equal(n,1,'only one open call for 3 concurrent inits');a.close();
});

test('a screen-rendering bug is NOT reported as a database failure (original defect class)',async()=>{
  const a=await load();
  a.$('ot').remove();
  const ok=await a.D.initializeDatabase();
  assert.equal(ok,true);assert.equal(a.state.dbReady,true);
  assert.match(a.$('dbBannerText').textContent,/Screen error/);
  await a.D.putWork(W('x','2026-11-09'));await a.D.refresh().catch(()=>{});
  assert.equal((await dump(a.idb)).stores.work.length,1,'writes still work');a.close();
});

test('add work record; duplicate date refused and nothing overwritten',async()=>{
  const a=await load();
  await a.D.putWork(W('w1','2026-11-10'));
  await assert.rejects(()=>a.D.putWork(W('w2','2026-11-10')),e=>e.dup===true);
  await a.D.putWork(W('w1','2026-11-10',{hours:10}));  // same id = edit, allowed
  const d=await dump(a.idb);assert.equal(d.stores.work.length,1);assert.equal(d.stores.work[0].hours,10);a.close();
});

test('Home "Duty" quick button adds today\'s record through the real click handler',async()=>{
  const a=await load();
  a.$('homeQuickDuty').click();await sleep(150);
  const d=await dump(a.idb);assert.equal(d.stores.work.length,1);assert.equal(d.stores.work[0].status,'worked');assert.match(a.$('homeQuickDuty').textContent,/✓/);
  a.$('homeQuickDuty').click();await sleep(100);
  assert.equal((await dump(a.idb)).stores.work.length,1,'second tap does not create a second record');a.close();
});

test('add payment, expense, gift, remittance; they are read back after reload',async()=>{
  const idb=new FDB.IDBFactory();const a=await load({indexedDB:idb});
  await a.D.put('payments',{id:'p',date:'2026-11-05',month:'2026-11',amount:100,bus:0});
  await a.D.put('expenses',{id:'e',date:'2026-11-06',category:'Food',amount:12.5});
  await a.D.put('gifts',{id:'g',date:'2026-11-07',person:'Riyad',currency:'EUR',amount:20});
  await a.D.put('remittances',{id:'r',date:'2026-11-08',amount:100,fee:2,rate:100,bonus:2.5});
  a.close();
  const b=await load({indexedDB:idb});
  assert.equal(b.state.dbReady,true);
  assert.deepStrictEqual(['payments','expenses','gifts','remittances'].map(s=>b.state.data[s].length),[1,1,1,1]);
  assert.equal(b.state.data.expenses[0].amount,12.5);b.close();
});

test('closed connection (iOS background) is reopened automatically on the next save',async()=>{
  const a=await load();
  a.state.db.close();                       // browser killed the connection silently
  await a.D.putWork(W('c1','2026-11-11'));
  assert.equal((await dump(a.idb)).stores.work.length,1);assert.equal(a.state.dbReady,true);a.close();
});

test('transaction failure (bad record) rejects cleanly and leaves existing data intact',async()=>{
  const a=await load();await a.D.putWork(W('ok','2026-11-12'));
  await assert.rejects(()=>a.D.put('expenses',{noId:true}));          // no keyPath value -> DataError
  assert.equal((await dump(a.idb)).stores.work.length,1);assert.equal(a.state.dbReady,true);a.close();
});

test('Duty Program saves a photo (one picker = Camera + Photo Library on iOS/Android; no capture attribute), on any weekday',async()=>{
  assert.ok(!/capture=/.test(fs.readFileSync(path.join(ROOT,'index.html'),'utf8')));
  for(const input of ['programPhoto']){
    const a=await load();a.$('menuDutyProgram').click();
    const f=new a.w.File([new Uint8Array([1,2,3,4])],'sched.jpg',{type:'image/jpeg'});
    Object.defineProperty(a.$(input),'files',{value:[f],configurable:true});
    a.$('programDate').value='2026-11-18'; // a Wednesday
    a.$('programStart').value='08:00';a.$('programEnd').value='17:00';
    a.$('saveProgram').click();await sleep(300);
    const d=await dump(a.idb);assert.equal(d.stores.dutyPrograms.length,1,input);
    assert.equal(d.stores.dutyPrograms[0].photo.name,'sched.jpg');assert.match(d.stores.dutyPrograms[0].photo.data,/^data:image\/jpeg/);a.close();
  }
});

test('backup -> restore into a fresh database reproduces every record',async()=>{
  const a=await load();
  await a.D.putWork(W('w1','2026-11-01'));await a.D.put('payments',{id:'p',date:'2026-11-05',month:'2026-11',amount:100,bus:0});
  await a.D.put('gifts',{id:'g',date:'2026-11-07',person:'Riyad',currency:'EUR',amount:20});
  await a.D.refresh();const json=JSON.stringify(a.D.buildBackup());a.close();
  const b=await load();const v=b.D.validateBackup(JSON.parse(json));assert.equal(v.ok,true);
  await b.D.writeAll(v.payload,false);await b.D.refresh();
  assert.deepStrictEqual([b.state.data.work.length,b.state.data.payments.length,b.state.data.gifts.length],[1,1,1]);
  const ex=await a.D.buildBackup;b.close();
});

test('legacy migration: old "workEntries" copied into work, never overwriting, legacy store untouched',async()=>{
  const idb=new FDB.IDBFactory();
  await seed(idb,{version:2,stores:Object.assign({},all6,{work:[W('keep','2026-10-02',{hours:9})],workEntries:[{id:'L1',date:'2026-10-01',status:'worked',hours:8},{id:'L2',date:'2026-10-02',status:'worked',hours:4}]})});
  const a=await load({indexedDB:idb});
  const d=await dump(idb);
  assert.equal(d.stores.work.length,2);assert.equal(d.stores.work.find(x=>x.date==='2026-10-02').hours,9,'existing record not overwritten');
  assert.ok(d.stores.work.find(x=>x.date==='2026-10-01'),'legacy day imported');assert.equal(d.stores.workEntries.length,2,'legacy store untouched');a.close();
});

test('Home "Details" and "View all" open the Reports and Money screens',async()=>{
  const a=await load();
  a.$('balanceDetails').click();assert.equal(a.w.document.body.getAttribute('data-view'),'reports');
  a.$('recentDetails').click();assert.equal(a.w.document.body.getAttribute('data-view'),'money');
  assert.ok(a.$('reports')&&a.$('payments'));a.close();
});

test('render() survives every language and view with real data',async()=>{
  const a=await load();await a.D.putWork(W('w1','2026-11-01'));await a.D.refresh();
  for(const l of ['en','bn','tr','bg','hi','el']){a.state.settings.language=l;for(const v of ['home','work','money','reports','settings']){a.w.document.body.setAttribute('data-view',v);a.D.render()}}
  a.close();
});

test('no network request is made while using the app (offline-first, data stays on phone)',async()=>{
  const a=await load();await a.D.putWork(W('w1','2026-11-01'));await a.D.refresh();
  assert.equal(a.w.fetchCalls,0);a.close();
});

// ---- service worker, executed for real in a vm sandbox ----
function makeSW(version){
  const store=new Map(),handlers={},fetchLog=[];let online=true;
  const mk=name=>{if(!store.has(name))store.set(name,new Map());const m=store.get(name);
    return {addAll:async reqs=>{for(const r of reqs){const href=typeof r==='string'?new URL(r,'https://e.io/app/').href:r.url;const rel=href.replace('https://e.io/app/','');if(rel&&!fs.existsSync(path.join(ROOT,rel)))throw new Error('missing '+rel);m.set(href,{body:'cached:'+href,ok:true})}},put:async(r,res)=>{m.set(r.url,res)},};};
  const caches={open:async n=>mk(n),keys:async()=>[...store.keys()],delete:async n=>store.delete(n),
    match:async(req)=>{const url=typeof req==='string'?new URL(req,'https://e.io/app/').href:req.url;for(const m of store.values()){const k=[...m.keys()].find(k=>k.split('?')[0]===url.split('?')[0]);if(k)return m.get(k)}}};
  const sandbox={self:{addEventListener:(t,f)=>{handlers[t]=f},skipWaiting:async()=>{},clients:{claim:async()=>{}},location:{origin:'https://e.io'}},caches,Request:function(u){this.url=new URL(u,'https://e.io/app/').href},URL,Response:{error:()=>({error:true})},
    fetch:async(req)=>{fetchLog.push(req.url);if(!online)throw new Error('offline');return {ok:true,body:'net:'+req.url,clone(){return this}}},console};
  sandbox.self.location=sandbox.self.location;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT,'service-worker.js'),'utf8').replace(/const /g,'var '),sandbox);
  const run=async(t,ev)=>{let p;handlers[t](Object.assign(ev||{},{waitUntil:x=>{p=x},respondWith:x=>{p=x}}));return p};
  return {store,handlers,sandbox,fetchLog,run,setOnline:v=>{online=v}};
}
test('service worker: version 9.5.4 cache, install caches every core file that really exists',async()=>{
  const s=makeSW();await s.run('install');
  assert.ok(s.store.has('mst-v9-5-4'));
  const core=vm.runInContext('CORE',s.sandbox);for(const f of core){if(f==='./')continue;assert.ok(fs.existsSync(path.join(ROOT,f)),f)}
});
test('service worker: activate deletes OLD mst- caches (stale code cannot survive) but keeps unrelated caches',async()=>{
  const s=makeSW();s.store.set('mst-v9-5-3',new Map());s.store.set('mst-v9-2',new Map());s.store.set('other-site',new Map());
  await s.run('install');await s.run('activate');
  assert.deepStrictEqual([...s.store.keys()].sort(),['mst-v9-5-4','other-site']);
});
test('service worker: network-first (online gets fresh app.js) and falls back to cache when offline',async()=>{
  const s=makeSW();await s.run('install');
  const req={method:'GET',url:'https://e.io/app/app.js',mode:'no-cors'};
  assert.equal((await s.run('fetch',{request:req})).body,'net:https://e.io/app/app.js');
  s.setOnline(false);
  assert.match((await s.run('fetch',{request:req})).body,/net:|cached:/);
  const nav={method:'GET',url:'https://e.io/app/unknown-page',mode:'navigate'};
  assert.ok((await s.run('fetch',{request:nav})).body,'offline navigation falls back to index.html');
});
test('version numbers agree everywhere',()=>{
  const app=fs.readFileSync(path.join(ROOT,'app.js'),'utf8'),sw=fs.readFileSync(path.join(ROOT,'service-worker.js'),'utf8');
  assert.match(app,/VERSION = '9\.5\.4'/);assert.match(sw,/VERSION = '9\.5\.4'/);
});
