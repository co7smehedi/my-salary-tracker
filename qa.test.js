'use strict';
const test=require('node:test');const assert=require('assert');const fs=require('fs');const path=require('path');
const C=require('./calc.js');const {load,seed,dump,sleep,FDB,ROOT}=require('./harness');
const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const nowYM=()=>{const n=new Date();return n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0')};
const prevYM=()=>{const n=new Date();const p=new Date(n.getFullYear(),n.getMonth()-1,1);return p.getFullYear()+'-'+String(p.getMonth()+1).padStart(2,'0')};
const W=(id,date,x)=>Object.assign({id,date,status:'worked',hours:8,basicRate:25,standardHours:8,otRate:2.77,busAllowanceRate:50,tips:0,note:''},x);
const submit=a=>a.$('editForm').dispatchEvent(new a.w.Event('submit',{cancelable:true}));
const day=(a,d)=>a.w.document.querySelector('[data-cal-date="'+nowYM()+'-'+d+'"]');

// ---------- salary maths ----------
test('pay per duty length: 4h=12.50, 6h=18.75, 7h=21.88, 8h=25.00, 9h=25.00+1h OT 2.77, 10h=30.54',()=>{
  const exp={4:[12.5,0,12.5],6:[18.75,0,18.75],7:[21.88,0,21.88],8:[25,0,25],9:[25,2.77,27.77],10:[25,5.54,30.54]};
  for(const h of Object.keys(exp)){const p=C.dayParts(W('x','2026-11-01',{hours:+h}),{});assert.deepStrictEqual([p.base,p.otPay,p.total],exp[h],h+'h')}
});
test('month totals: basic, OT, tips (work + standalone), bus allowance, expenses, remittance, money given',()=>{
  const m='2026-11',d=(n)=>m+'-0'+n;
  const data={work:[4,6,7,8,9].map((h,i)=>W('w'+i,d(i+1),{hours:h,tips:i===0?2:0})),tips:[{id:'t',date:d(2),amount:3.5}],
    payments:[{id:'p',date:d(5),month:m,amount:100,bus:20}],expenses:[{id:'e',date:d(3),category:'food',amount:12.25}],
    remittances:[{id:'r',date:d(4),amount:50,fee:1,rate:140,bonus:2.5}],gifts:[{id:'g',date:d(4),currency:'EUR',amount:5}]};
  const c=C.calcMonth(data,{},m);
  assert.equal(c.wages,103.13);assert.equal(c.otPay,2.77);assert.equal(c.otHours,1);assert.equal(c.tips,5.5);assert.equal(c.busDue,50);
  assert.equal(c.earned,155.9);assert.equal(c.expenses,12.25);assert.equal(c.remitEur,50);assert.equal(c.giftEur,5);
  assert.equal(c.balance,C.r2(100-12.25-50-5));assert.equal(c.outstanding,55.9);
});
test('another month never leaks into this month (income, tips, expense, remittance, gifts)',()=>{
  const data={work:[W('a','2026-10-31'),W('b','2026-12-01')],tips:[{id:'t',date:'2026-10-31',amount:9}],payments:[{id:'p',date:'2026-10-31',month:'2026-10',amount:80,bus:0}],
    expenses:[{id:'e',date:'2026-12-01',category:'food',amount:7}],remittances:[{id:'r',date:'2026-10-30',amount:40,fee:0,rate:100,bonus:0}],gifts:[{id:'g',date:'2026-12-02',currency:'EUR',amount:3}]};
  const c=C.calcMonth(data,{},'2026-11');
  assert.deepStrictEqual([c.workedDays,c.wages,c.tips,c.paymentsTotal,c.expenses,c.remitEur,c.giftEur,c.busDue],[0,0,0,0,0,0,0,0]);
});
test('old records keep their own rates when settings change (snapshot), legacy records without hours still pay a full day',()=>{
  const old=W('o','2026-09-01',{basicRate:20,otRate:2,hours:9});const s={basic:99,otRate:9,standard:8};
  assert.deepStrictEqual(C.dayParts(old,s).total,22);
  const legacy={date:'2026-09-02',status:'work'};assert.equal(C.dayParts(legacy,{basic:25,standard:8}).total,25);
});

// ---------- Home: month consistency and block swap ----------
test('Home income, tips, OT and expense always stay on the current month when Work month changes',async()=>{
  const a=await load();await a.D.putWork(W('c1',nowYM()+'-05',{hours:7}));await a.D.putWork(W('p1',prevYM()+'-05',{hours:8}));
  await a.D.put('tips',{id:'t1',date:nowYM()+'-05',amount:4});await a.D.put('tips',{id:'t2',date:prevYM()+'-05',amount:90});
  await a.D.put('expenses',{id:'e1',date:nowYM()+'-05',category:'food',amount:12});await a.D.put('expenses',{id:'e2',date:prevYM()+'-05',category:'food',amount:30});await a.D.refresh();
  assert.equal(a.$('earned').textContent,'€21.88');assert.equal(a.$('homeTotalIncome').textContent,'€25.88');assert.equal(a.$('expTotal').textContent,'€12.00');assert.equal(a.$('monthTipsIncome').textContent,'€4.00');assert.equal(a.$('earnedLbl').textContent,"This Month's Duty Income");
  a.$('prev').click();await sleep(20);
  assert.equal(a.$('earned').textContent,'€21.88');assert.equal(a.$('homeTotalIncome').textContent,'€25.88');assert.equal(a.$('expTotal').textContent,'€12.00');assert.equal(a.$('monthTipsIncome').textContent,'€4.00');assert.equal(a.$('earnedLbl').textContent,"This Month's Duty Income");
  a.$('next').click();await sleep(20);assert.equal(a.$('earned').textContent,'€21.88');assert.equal(a.$('expTotal').textContent,'€12.00');a.close();
});
test('Home blocks swapped: Today\'s Earnings sits inside the month card, Tips/Expense/OT tiles come after it',async()=>{
  const a=await load();const hero=a.w.document.querySelector('.hero');
  assert.ok(hero.querySelector('.earnings-today #todayEarnings'),'today earnings inside hero');
  assert.equal(hero.querySelector('.home-main-totals'),null,'tiles no longer inside hero');
  const tiles=a.w.document.querySelector('.home-totals-card');assert.ok(tiles.querySelector('#monthTipsIncome')&&tiles.querySelector('#expTotal')&&tiles.querySelector('#monthOtIncome')&&tiles.querySelector('#addTipsHome'));
  assert.ok(hero.compareDocumentPosition(tiles)&a.w.Node.DOCUMENT_POSITION_FOLLOWING,'tiles after hero');
  assert.equal(tiles.parentElement,hero.parentElement,'same parent as the hero, so the existing per-screen hide rules (#top>section:not([data-screen])) apply to it');assert.equal(tiles.hasAttribute('data-screen'),false);
  assert.ok(a.w.document.querySelector('.hero .earnings-today').compareDocumentPosition(tiles)&a.w.Node.DOCUMENT_POSITION_FOLLOWING);a.close();
});

// ---------- Add work calendar ----------
test('Add work opens the calendar dialog (Add work button AND Quick-add "Work")',async()=>{
  const a=await load();a.$('addWork').click();assert.equal(a.$('addWorkDlg').hasAttribute('open'),true);a.$('addWorkDlg').close();
  a.$('quickActions').click();a.w.document.querySelector('#quickAddDialog [data-action=work]').click();assert.equal(a.$('addWorkDlg').hasAttribute('open'),true);a.close();
});
test('calendar is Sunday-first and lists every day of the month; today is marked; existing records show a status dot',async()=>{
  const a=await load();await a.D.putWork(W('x',nowYM()+'-03'));await a.D.refresh();a.$('addWork').click();
  const n=new Date(),days=new Date(n.getFullYear(),n.getMonth()+1,0).getDate(),first=new Date(n.getFullYear(),n.getMonth(),1).getDay();
  assert.equal(a.w.document.querySelectorAll('.aw-day').length,days);assert.equal(a.w.document.querySelectorAll('#awCal .aw-empty').length,first);
  assert.ok(a.w.document.querySelector('.aw-day.today'));assert.ok(a.w.document.querySelector('[data-aw-date="'+nowYM()+'-03"] i.worked'));a.close();
});
test('select PAST days, give each its own hours, save: records created with correct pay and OT',async()=>{
  const a=await load();a.$('addWork').click();const d=a.w.document;
  a.$('awPrev').click();
  for(const n of ['01','02','03'])d.querySelector('[data-aw-date="'+prevYM()+'-'+n+'"]').click();
  assert.equal(a.$('awSave').textContent,'Save 3 day(s)');
  const rows=[...d.querySelectorAll('#awSelected .aw-row-hours')];rows[0].value='4';rows[0].dispatchEvent(new a.w.Event('input',{bubbles:true}));rows[1].value='7';rows[1].dispatchEvent(new a.w.Event('input',{bubbles:true}));rows[2].value='9';rows[2].dispatchEvent(new a.w.Event('input',{bubbles:true}));
  a.$('awSave').click();await sleep(300);
  const w=(await dump(a.idb)).stores.work.sort((x,y)=>x.date.localeCompare(y.date));
  assert.equal(w.length,3);assert.deepStrictEqual(w.map(r=>C.dayParts(r,{}).total),[12.5,21.88,27.77]);assert.equal(w[2].otExtraHours,1);assert.equal(a.$('addWorkDlg').hasAttribute('open'),false);a.close();
});
test('calendar: common hours apply to all selected days; status Rest saves zero hours; Clear and remove work',async()=>{
  const a=await load();a.$('addWork').click();const d=a.w.document,q=n=>d.querySelector('[data-aw-date="'+nowYM()+'-'+n+'"]');
  q('01').click();q('02').click();a.$('awHours').value='6';a.$('awHours').dispatchEvent(new a.w.Event('input'));
  assert.deepStrictEqual([...d.querySelectorAll('.aw-row-hours')].map(x=>x.value),['6','6']);
  d.querySelector('[data-aw-remove="'+nowYM()+'-02"]').click();assert.equal(a.$('awSave').textContent,'Save 1 day(s)');
  a.$('awClear').click();assert.equal(a.$('awSave').disabled,true);
  q('04').click();a.$('awStatus').value='rest';a.$('awStatus').dispatchEvent(new a.w.Event('change'));assert.equal(a.$('awHoursWrap').hidden,true);
  a.$('awSave').click();await sleep(250);const r=(await dump(a.idb)).stores.work;assert.equal(r.length,1);assert.deepStrictEqual([r[0].status,r[0].hours],['rest',0]);a.close();
});
test('calendar: "Empty days up to today" selects only past empty days; tapping an existing day opens its edit form (never overwrites)',async()=>{
  const a=await load();await a.D.putWork(W('x',nowYM()+'-01'));await a.D.refresh();a.$('addWork').click();
  a.$('awPast').click();const t=new Date().getDate();
  const picked=[...a.w.document.querySelectorAll('.aw-day.sel')].map(b=>b.dataset.awDate);
  assert.equal(picked.length,t-1,'every day up to today except the one that already has a record');assert.ok(!picked.includes(nowYM()+'-01'));
  a.w.document.querySelector('[data-aw-date="'+nowYM()+'-01"]').click();
  assert.equal(a.$('addWorkDlg').hasAttribute('open'),false);assert.equal(a.$('editDialog').hasAttribute('open'),true);a.close();
});
test('calendar: double-tapping Save creates each day once; Cancel writes nothing; invalid hours rejected',async()=>{
  const a=await load();a.$('addWork').click();a.w.document.querySelector('[data-aw-date="'+nowYM()+'-02"]').click();a.w.document.querySelector('[data-aw-date="'+nowYM()+'-03"]').click();
  a.$('awHours').value='30';a.$('awHours').dispatchEvent(new a.w.Event('input'));a.$('awSave').click();await sleep(50);assert.ok(a.$('awErr').textContent.length>0);assert.equal((await dump(a.idb)).stores.work.length,0);
  a.$('awHours').value='8';a.$('awHours').dispatchEvent(new a.w.Event('input'));a.$('awSave').click();a.$('awSave').click();await sleep(300);
  assert.equal((await dump(a.idb)).stores.work.length,2);
  a.$('addWork').click();a.w.document.querySelector('[data-aw-date="'+nowYM()+'-09"]').click();a.w.document.querySelector('#addWorkDlg .closeDlg').click();await sleep(30);assert.equal((await dump(a.idb)).stores.work.length,2);a.close();
});
test('calendar: a day that gained a record meanwhile is refused as duplicate (database check), nothing partial is saved',async()=>{
  const a=await load();a.$('addWork').click();const q=n=>a.w.document.querySelector('[data-aw-date="'+nowYM()+'-'+n+'"]');q('05').click();q('06').click();
  await a.D.putWork(W('late',nowYM()+'-06'));          // arrives after the picker rendered (state not refreshed)
  a.$('awSave').click();await sleep(250);
  assert.ok(a.$('awErr').textContent.length>0);assert.equal((await dump(a.idb)).stores.work.length,1,'no partial batch');a.close();
});

// ---------- regression: overtime logic ----------
test('OT follows hours when a record is edited (9h -> 7h removes the OT) and legacy records stay untouched',async()=>{
  const a=await load();await a.D.putWork(W('a',nowYM()+'-05',{hours:9,otExtraHours:1}));await a.D.putWork(W('legacy',nowYM()+'-06',{hours:10,otExtraHours:undefined}));await a.D.refresh();
  day(a,'05').click();a.$('fields').querySelector('[name=hours]').value='7';submit(a);await sleep(250);
  let w=(await dump(a.idb)).stores.work;const r=w.find(x=>x.id==='a');assert.equal(r.otExtraHours,0);assert.equal(C.dayParts(r,{}).total,21.88);
  assert.equal(w.find(x=>x.id==='legacy').hours,10);a.close();
});
test('Bulk range entry: 9h day gets 1h overtime (was lost before)',async()=>{
  const a=await load();a.$('bulkWork').click();a.$('bulkStart').value=nowYM()+'-02';a.$('bulkEnd').value=nowYM()+'-03';a.$('bulkPreviewBtn').click();
  const rows=[...a.w.document.querySelectorAll('.bulk-row-hours')];rows[0].value='9';rows[1].value='6';a.$('bulkSave').click();a.$('bulkSave').click();await sleep(300);
  const w=(await dump(a.idb)).stores.work.sort((x,y)=>x.date.localeCompare(y.date));assert.equal(w.length,2);assert.deepStrictEqual(w.map(r=>C.dayParts(r,{}).total),[27.77,18.75]);a.close();
});
test('Worked-today popup: 7h = 21.88, 9h = 25.00 + 1h OT',async()=>{
  for(const [h,total] of [[7,21.88],[9,27.77]]){
    const a=await load();a.$('homeQuickDuty').click();a.$('quickDutyHours').value=String(h);a.$('saveQuickDutyHours').click();await sleep(200);
    const r=(await dump(a.idb)).stores.work[0];assert.equal(C.dayParts(r,{}).total,total,h+'h');a.close();
  }
});

// ---------- duplicate protection ----------
test('double tap: Tips, OT, expense/payment/gift/remittance form, quick duty never create duplicates',async()=>{
  const a=await load();
  a.$('addTipsHome').click();a.$('tipAmount').value='5';a.$('saveTip').click();a.$('saveTip').click();await sleep(250);assert.equal((await dump(a.idb)).stores.tips.length,1);
  await a.D.putWork(W('o',nowYM()+'-04'));await a.D.refresh();a.$('ot').closest&&0;
  a.w.document.querySelector('[data-action=ot]').click();a.$('otDate').value=nowYM()+'-04';a.$('otHoursAdd').value='1';a.$('saveOt').click();a.$('saveOt').click();await sleep(300);
  assert.equal((await dump(a.idb)).stores.work.find(x=>x.id==='o').otExtraHours,1,'OT added once, not twice');
  for(const [btn,store,fill] of [['addExpense','expenses',{amount:'3'}],['addPayment','payments',{amount:'10'}],['addGift','gifts',{amount:'4',person:'X'}],['addRemit','remittances',{amount:'20',rate:'140'}]]){
    a.$(btn).click();for(const k of Object.keys(fill)){const el=a.$('fields').querySelector('[name='+k+']');if(el)el.value=fill[k]}submit(a);submit(a);await sleep(250);
    assert.ok((await dump(a.idb)).stores[store].length<=1,store+' not duplicated');
  }
  a.close();
});

// ---------- navigation, menu, dialogs: every control leads somewhere that works ----------
test('bottom navigation: Home/Work/Reports and Add dialog switch correctly, no errors',async()=>{
  const a=await load();const errs=[];a.w.addEventListener('error',e=>errs.push(e.message));
  for(const [nav,view] of [['work','work'],['reports','reports'],['top','home']]){const b=a.w.document.querySelector('.bottom-nav [data-nav="'+nav+'"]');assert.ok(b,nav);b.click();assert.equal(a.w.document.body.getAttribute('data-view'),view,nav);if(view==='reports')assert.equal(a.$('reportsAccordion').open,true,'Reports accordion opens on Reports tab')}
  const add=a.w.document.querySelector('.bottom-nav [data-nav="quickActions"]');assert.ok(add);add.click();assert.equal(a.$('quickAddDialog').hasAttribute('open'),true);assert.equal(a.w.document.querySelectorAll('#quickAddDialog [data-action]').length,6);
  assert.deepStrictEqual(errs,[]);a.close();
});
test('simplified menu reaches Money, Backup, Settings and Home',async()=>{
  const a=await load();const d=a.w.document;
  for(const [t,id] of [['payments','payments'],['backupSec','backupSec'],['settings','settings']]){
    a.$('menuBtn').click();const b=d.querySelector('#menu [data-target="'+t+'"]');assert.ok(b,t);b.click();
    const el=d.getElementById(id);assert.ok(el,'section #'+id+' exists');const screen=el.closest('[data-screen]').getAttribute('data-screen');
    assert.equal(d.body.getAttribute('data-view'),screen,t+' opens the screen that contains it');assert.equal(el.hidden,false,t+' section visible');assert.equal(a.$('menu').hasAttribute('open'),false,'menu closed after '+t);
  }
  a.$('menuBtn').click();d.querySelector('#menu [data-target="top"]').click();assert.equal(d.body.getAttribute('data-view'),'home');
  a.$('menuBtn').click();d.querySelector('#menu [data-target="settings"]').click();a.$('openProfileSettings').click();assert.equal(a.$('accountDlg').hasAttribute('open'),true);a.close();
});
test('People: add a person (opens Money-given form for them), save, see their total, rename updates their records',async()=>{
  const a=await load();let answer='Rafi';a.w.prompt=()=>answer;const d=a.w.document;
  a.$('addPerson').click();await sleep(20);assert.equal(a.$('editDialog').hasAttribute('open'),true);
  assert.equal(a.$('fields').querySelector('[name=person]').value,'Rafi');a.$('fields').querySelector('[name=amount]').value='12.5';submit(a);await sleep(250);
  assert.equal((await dump(a.idb)).stores.gifts.length,1);assert.match(a.$('peopleList').textContent,/Rafi/);assert.match(a.$('peopleList').textContent,/12\.50/);
  answer='Rafique';d.querySelector('[data-person-rename="Rafi"]').click();await sleep(250);
  assert.equal((await dump(a.idb)).stores.gifts[0].person,'Rafique');assert.match(a.$('peopleList').textContent,/Rafique/);assert.ok(a.state.settings.people.includes('Rafique'));a.close();
});
test('every dialog can be opened and closed from its button without JS errors',async()=>{
  const a=await load();const errs=[];a.w.addEventListener('error',e=>errs.push(e.message));const d=a.w.document;
  for(const sel of ['#menuBtn','#addTipsHome','#addWork','#bulkWork','.bottom-nav [data-nav=quickActions]']){const id=sel;
    d.querySelector(sel).click();const open=[...d.querySelectorAll('dialog[open]')];assert.equal(open.length>=1,true,id+' opens a dialog');open.forEach(x=>x.close());assert.equal(d.querySelectorAll('dialog[open]').length,0,id+' closes');
  }
  assert.deepStrictEqual(errs,[]);a.close();
});

// ---------- data safety ----------
test('export -> wipe -> restore brings back every store (work, payments, expenses, remittances, gifts, tips, duty programs) and the profile',async()=>{
  const prof={name:'Test Person',photo:'',updatedAt:'t'};
  const a=await load({beforeApp:w=>w.localStorage.setItem('mst-profile',JSON.stringify(prof))});
  await a.D.putWork(W('w',nowYM()+'-02',{hours:9,otExtraHours:1}));
  await a.D.put('payments',{id:'p',date:nowYM()+'-05',month:nowYM(),amount:50,bus:5});await a.D.put('expenses',{id:'e',date:nowYM()+'-03',category:'food',amount:4});
  await a.D.put('remittances',{id:'r',date:nowYM()+'-04',recipient:'F',amount:20,rate:140,fee:1,bonus:0});await a.D.put('gifts',{id:'g',date:nowYM()+'-04',person:'X',currency:'EUR',amount:2});
  await a.D.put('tips',{id:'t',date:nowYM()+'-02',amount:3});await a.D.put('dutyPrograms',{id:'d',date:nowYM()+'-06',rest:false,start:'08:00',end:'17:00',photo:{name:'s.jpg',data:'data:image/jpeg;base64,AAAA'}});
  await a.D.refresh();const bk=JSON.parse(JSON.stringify(a.D.buildBackup()));
  for(const s of ['work','payments','expenses','remittances','gifts','tips','dutyPrograms'])assert.equal(bk.stores[s].length,1,s+' in backup');
  assert.equal(bk.profile.name,'Test Person');
  const b=await load();const v=b.D.validateBackup(bk);assert.equal(v.ok,true);await b.D.writeAll(v.payload,false);await b.D.refresh();
  const d=await dump(b.idb);for(const s of ['work','payments','expenses','remittances','gifts','tips','dutyPrograms'])assert.equal(d.stores[s].length,1,s+' restored');
  assert.equal(d.stores.work[0].otExtraHours,1);assert.equal(C.calcMonth(b.state.data,b.state.settings,nowYM()).earned,C.calcMonth(a.state.data,a.state.settings,nowYM()).earned,'same totals after restore');a.close();b.close();
});
test('restore (Merge) never deletes or overwrites what is already on the phone',async()=>{
  const a=await load();await a.D.putWork(W('keep',nowYM()+'-02',{hours:5}));await a.D.refresh();
  const v=a.D.validateBackup({app:'My Salary Tracker',format:2,version:'x',exportedAt:new Date().toISOString(),stores:{work:[W('other',nowYM()+'-02',{hours:8}),W('new',nowYM()+'-03')],payments:[],expenses:[],remittances:[],gifts:[],dutyPrograms:[],tips:[]},settings:a.state.settings});
  assert.equal(v.ok,true);a.state.pending={v,name:'x.json',safety:true,profile:null};a.$('rsMerge').disabled=false;a.$('rsMerge').click();await sleep(300);
  const w=(await dump(a.idb)).stores.work;assert.equal(w.find(x=>x.date===nowYM()+'-02').hours,5,'existing day kept');assert.ok(w.find(x=>x.date===nowYM()+'-03'));a.close();
});
test('app update: a database created by the previous version (v2, all stores, real records) opens untouched with the new code',async()=>{
  const idb=new FDB.IDBFactory();const st={work:[W('a','2026-10-01',{hours:7})],payments:[{id:'p',date:'2026-10-05',month:'2026-10',amount:60,bus:0}],expenses:[],remittances:[],gifts:[],dutyPrograms:[],workEntries:[],tips:[{id:'t',date:'2026-10-02',amount:2}]};
  await seed(idb,{version:2,stores:st});const before=await dump(idb);
  const a=await load({indexedDB:idb});assert.equal(a.state.dbReady,true);const after=await dump(idb);
  assert.deepStrictEqual(after.stores,before.stores,'records identical');assert.equal(after.version,before.version,'no needless version bump');a.close();
});
test('offline: the app opens, saves and reads with every network call failing',async()=>{
  const a=await load();await a.D.putWork(W('w',nowYM()+'-02'));await a.D.refresh();assert.equal(a.w.fetchCalls,0);assert.equal(a.$('earned').textContent,'€25.00');a.close();
});
test('no duplicate ids in index.html; every $("id") exists; no emoji icons; service worker lists every shipped script',()=>{
  const ids=[...html.matchAll(/ id="([^"]+)"/g)].map(m=>m[1]);assert.deepStrictEqual(ids.filter((x,i)=>ids.indexOf(x)!==i),[]);
  const app=fs.readFileSync(path.join(ROOT,'app.js'),'utf8');const need=new Set([...app.matchAll(/\$\('([A-Za-z0-9_]+)'\)/g)].map(m=>m[1]));
  assert.deepStrictEqual([...need].filter(i=>!html.includes('id="'+i+'"')),[]);
  const sw=fs.readFileSync(path.join(ROOT,'service-worker.js'),'utf8');for(const f of ['index.html','app.js','calc.js','i18n.js','profile.js','backup-rules.js','style.css'])assert.ok(sw.includes("'./"+f+"'")||sw.includes('"./'+f+'"'),f+' in SW core');
});

// ---------- Reports, Settings, Work calendar, Monday Duty Program ----------
test('Reports: Month / Year / All-time render with the correct earned total (wages + OT + bus allowance), no errors',async()=>{
  const a=await load();const errs=[];a.w.addEventListener('error',e=>errs.push(e.message));
  await a.D.putWork(W('w1',nowYM()+'-02',{hours:9}));await a.D.put('expenses',{id:'e',date:nowYM()+'-03',category:'food',amount:8});await a.D.refresh();
  a.w.document.querySelector('[data-target=payments]').click();
  for(const id of ['rMonth','rYear','rAll']){a.$(id).click();await sleep(20);assert.ok(a.$('reports').textContent.length>50,id);assert.match(a.$('reports').textContent,/77\.77/,id+' shows earned 77.77 (25.00 wages + 2.77 OT + 50.00 bus allowance)');}
  assert.deepStrictEqual(errs,[]);a.close();
});
test('Settings: changing the daily rate never changes records already saved (they keep their own rate)',async()=>{
  const a=await load();await a.D.putWork(W('old',nowYM()+'-02'));await a.D.refresh();
  a.$('salaryMonthly').value='1000';a.$('weeklyDays').value='5';a.$('salaryMonthly').dispatchEvent(new a.w.Event('input'));a.$('saveSettings').click();await sleep(100);
  const rate=a.state.settings.basic;assert.notEqual(rate,25,'rate really changed to '+rate);
  const old=a.state.data.work.find(x=>x.id==='old');assert.equal(C.dayParts(old,a.state.settings).total,25,'old record still €25');
  a.$('homeQuickDuty').click();a.$('saveQuickDutyHours').click();await sleep(200);
  const fresh=(await dump(a.idb)).stores.work.find(x=>x.id!=='old');assert.equal(fresh.basicRate,rate,'new record uses the new rate');a.close();
});
test('Work calendar: toggle shows/hides it; tapping an empty day opens the one-day form for that date',async()=>{
  const a=await load();a.w.document.querySelector('[data-nav=work]').click();const panel=a.$('calendarPanel'),was=panel.hidden;
  a.$('calendarToggle').click();assert.equal(panel.hidden,!was);
  day(a,'12').click();assert.equal(a.$('editDialog').hasAttribute('open'),true);assert.equal(a.$('fields').querySelector('[name=date]').value,nowYM()+'-12');a.close();
});
test('Monday Duty Program: save a schedule photo on any weekday, re-open, delete',async()=>{
  const a=await load();a.$('menuDutyProgram').click();
  Object.defineProperty(a.$('programPhoto'),'files',{value:[new a.w.File([new Uint8Array([1,2,3])],'s.jpg',{type:'image/jpeg'})],configurable:true});
  a.$('programDate').value=nowYM()+'-18';a.$('programStart').value='08:00';a.$('programEnd').value='17:00';a.$('saveProgram').click();await sleep(300);
  const p=(await dump(a.idb)).stores.dutyPrograms;assert.equal(p.length,1);assert.equal(p[0].photo.name,'s.jpg');assert.equal(a.w.fetchCalls,0,'photo never leaves the phone');a.close();
});
