'use strict';
const assert=require('assert');
const C=require('./calc.js');
const I=require('./i18n.js');
const fs=require('fs');
const html=fs.readFileSync('./index.html','utf8');
const app=fs.readFileSync('./app.js','utf8');
const css=fs.readFileSync('./style.css','utf8');
const sw=fs.readFileSync('./service-worker.js','utf8');
let tests=0;
function test(name,fn){fn();tests++;console.log('PASS',name)}
test('Default wage settings',()=>{assert.equal(C.DEFAULTS.basic,25);assert.equal(C.DEFAULTS.standard,8);assert.equal(C.DEFAULTS.otRate,2.77)});
test('8 hour basic duty earns exactly €25',()=>{const d=C.dayParts({status:'worked',hours:8},C.DEFAULTS);assert.equal(d.base,25);assert.equal(d.otPay,0);assert.equal(d.total,25)});
test('9 hours includes one hour OT',()=>{const d=C.dayParts({status:'worked',hours:9},C.DEFAULTS);assert.equal(d.base,25);assert.equal(d.otHours,1);assert.equal(d.otPay,2.77);assert.equal(d.total,27.77)});
test('€650 monthly basic over six days/week derives €25/day',()=>{const daily=650/(6*52/12);assert.equal(C.r2(daily),25);const d=C.dayParts({status:'worked',hours:10,basicRate:daily,standardHours:8,otRate:2.77});assert.equal(d.total,30.54);});
test('Three duties plus two OT hours and monthly bus allowance total €130.54',()=>{const data={work:[1,2,3].map((n)=>({date:'2026-11-0'+n,status:'worked',hours:n===3?10:8,basicRate:25,standardHours:8,otRate:2.77})),payments:[],expenses:[],remittances:[],gifts:[]};assert.equal(C.calcMonth(data,C.DEFAULTS,'2026-11').earned,130.54);});
test('Actual BDT side of EUR gift is included in BDT report',()=>{const data={work:[],payments:[],expenses:[],remittances:[],gifts:[{date:'2026-08-20',person:'Riyad',currency:'EUR',amount:70,bdtActual:10000}]};const c=C.calcMonth(data,C.DEFAULTS,'2026-08');assert.equal(c.giftEur,70);assert.equal(c.giftBdt,10000);});

test('10 hours includes two hours OT',()=>{const d=C.dayParts({status:'worked',hours:10},C.DEFAULTS);assert.equal(d.total,30.54)});
test('Work rate snapshots protect historical calculation',()=>{const d=C.dayParts({status:'worked',hours:9,basicRate:24,standardHours:8,otRate:2.5},{basic:30,standard:10,otRate:4});assert.equal(d.total,26.5)});
test('Bus allowance snapshot is used for month calculation',()=>{const data={work:[{date:'2026-11-01',status:'worked',hours:8,busAllowanceRate:40}],payments:[],expenses:[],remittances:[],gifts:[]};const c=C.calcMonth(data,{...C.DEFAULTS,bus:50},'2026-11');assert.equal(c.busDue,40)});
test('Remittance fee and bonus formula',()=>{const q=C.remitParts({amount:100,fee:2,rate:100,bonus:2.5});assert.equal(q.net,98);assert.equal(q.bonusEur,2.45);assert.equal(q.bdt,10045)});
test('Earned, received, outstanding, expenses remain separate',()=>{const data={work:[{date:'2026-11-01',status:'worked',hours:8}],payments:[{date:'2026-11-02',month:'2026-11',amount:10,bus:0}],expenses:[{date:'2026-11-03',amount:4,category:'food'}],remittances:[],gifts:[]};const c=C.calcMonth(data,C.DEFAULTS,'2026-11');assert.equal(c.earned,75);assert.equal(c.salaryReceived,10);assert.equal(c.outstanding,65);assert.equal(c.expenses,4);assert.equal(c.balance,6)});
test('Six language bundles exist',()=>{I.LANGS.forEach(k=>assert(I.T[k]));assert.equal(I.LANGS.length,6)});
test('Work calendar and one-tap duty controls exist',()=>{['workCalendar','workMonth','workPrev','workNext','quickDuty','homeQuickDuty'].forEach(id=>assert(html.includes('id="'+id+'"'),id))});
test('People profiles and rename dialog exist',()=>{['people','peopleList','peopleDlg','renamePerson','addPerson'].forEach(id=>assert(html.includes('id="'+id+'"'),id))});
test('Edit and delete controls remain available',()=>{assert(app.includes('data-edit'));assert(app.includes('data-delete'));assert(html.includes('id="deleteBtn"'))});
test('All main nav destinations are defined',()=>{['data-nav="top"','data-nav="work"','data-nav="quickActions"','data-nav="reports"'].forEach(x=>assert(html.includes(x),x))});
test('Two daily buttons lock after one choice and Settings edit is present',()=>{assert(app.includes('function dutyButtonState'));assert(app.includes('yes.disabled=locked;no.disabled=locked'));assert(html.includes('id=\"homeQuickDuty\"'));assert(html.includes('id=\"homeQuickNoDuty\"'));assert(html.includes('id=\"editTodayStatus\"'));assert(html.includes('id=\"dutyReason\"'));assert(!html.includes('id=\"record\"'))});
test('Salary setup uses monthly salary and workdays per week',()=>{assert(html.includes('id=\"salaryMonthly\"'));assert(html.includes('id=\"weeklyDays\"'));assert(app.includes('vals.basic = vals.salaryMonthly/(vals.weeklyDays*52/12)'));});
test('People directory supports persistent names and selection',()=>{assert(app.includes('state.settings.people'));assert(app.includes('__add_person__'));assert(html.includes('id=\"personDirectory\"'));});
test('Receipt attachment is optional, locally stored and expandable',()=>{assert(app.includes('receiptFile'));assert(app.includes('readDataUrl'));assert(app.includes('receipt-details'));assert(app.includes('5*1024*1024'));});
test('Fresh installs contain no hard-coded personal transaction records',()=>{assert(!app.includes('historic-remit-2026-08'));assert(!app.includes('historic-gift-sohel-2026-09-15'));assert(app.includes('Fresh installs start empty'));});
test('Compact UI and sticky header rules present',()=>{assert(css.includes('header{position:sticky'));assert(css.includes('.duty-toggle.done'));});
test('v9.7.x country selector and currency display are independent of language',()=>{assert(html.includes('id=\"country\"'));assert(app.includes('state.settings.country=this.value'));assert(html.includes('id=\"language\"'));});
test('Menu close button and account salary settings are present',()=>{assert(html.includes('id=\"menuClose\"'));assert(html.includes('account-salary'));assert(!html.includes('data-target=\"language\"'));});
test('Tips dialog has no autofocus-triggering amount input',()=>{assert(!html.includes('tipAmount') || !html.includes('autofocus'));});
test('No Rent setting is exposed in settings',()=>{assert(!html.includes('id="rentEnabled"'))});
test('Version and cache updated, tagline removed',()=>{assert(app.includes("VERSION = '9.7.6'"));assert(sw.includes("VERSION = '9.7.6'"));assert(!html.includes('PRIVATE • OFFLINE FIRST'));});
test('Today duty section is positioned immediately before Quick Actions',()=>{const duty=html.indexOf('class="card duty-card"'),quick=html.indexOf('id="quickActions"');assert(duty>=0&&quick>=0&&duty<quick);assert(quick-duty<600);});
test('Opening any edit form closes the calendar instead of auto-showing it',()=>{assert(app.includes('function openForm(kind, old) {\n    if (!state.dbReady'));assert(app.includes('closeWorkCalendar();'));assert(html.includes('id="calendarPanel" hidden'));});
test('Home savings tile and optional settings toggle exist',()=>{assert(html.includes('id="homeSavingsTile"'));assert(html.includes('id="homeSavingsTotal"'));assert(html.includes('id="showHomeSavings"'));assert(app.includes('mst-home-savings-visible'));assert(app.includes('mst-home-savings-visible'));});
test('Quick Actions restored to six entries',()=>{const qa=html.slice(html.indexOf('id="quickActions"'),html.indexOf('id="quickActions"')+1800);['data-action="work"','data-action="ot"','data-action="payments"','data-action="expenses"','data-action="remittances"','data-action="gifts"'].forEach(x=>assert(qa.includes(x),x));});
test('Reports is bottom navigation and direct screen',()=>{assert(html.includes('data-nav="reports"'));assert(html.includes('id="reportsAccordion" data-screen="reports"'));assert(app.includes("view==='reports'"));});
test('CSS is structurally balanced',()=>{assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length)});
test('Basic pay is proportional to shorter recorded hours (7h = €21.88)',()=>{const d=C.dayParts({status:'worked',hours:7,otExtraHours:0},C.DEFAULTS);assert.equal(d.base,21.88);assert.equal(d.total,21.88)});
test('Short duty, manual overtime and tips remain separate',()=>{const d=C.dayParts({status:'worked',hours:4,otExtraHours:2,tips:3},C.DEFAULTS);assert.equal(d.base,12.5);assert.equal(d.otPay,5.54);assert.equal(C.r2(d.base+d.otPay+3),21.04)});
test('Duty program remains phone-local and backed up',()=>{assert(app.includes("'dutyPrograms'"));assert(html.includes('id=\"menuDutyProgram\"'));assert(html.includes('id=\"programPhoto\"'));assert(html.includes('id=\"programHistory\"'))});
test('Home main summary contains income, expenses, OT, tips and schedule preview',()=>{['todayEarnings','todayBreakdown','monthOtIncome','monthTipsIncome','tipsMonthIncome','expTotal','schedulePeek'].forEach(id=>assert(html.includes('id=\"'+id+'\"'),id));assert(html.includes('home-main-totals'));assert(!html.includes('class=\"tiles\"'));assert(!html.includes('class=\"extra-income\"'));});
test('Camera and Photo Library picker enabled without camera-only capture',()=>{assert(html.includes('accept="image/*"'));assert(!html.includes('capture="environment"'));assert(html.includes('Camera or Photo Library'));});
test('Quick Actions use restored six options and Tips has its inline add control',()=>{['data-action=\"work\"','data-action=\"ot\"','data-action=\"payments\"','data-action=\"expenses\"','data-action=\"remittances\"','data-action=\"gifts\"'].forEach(x=>assert(html.includes(x),x));assert(html.includes('id=\"addTipsHome\"'));assert(app.includes('actionLabels'));});
test('Duty hours field hidden when status is not worked',()=>{assert(app.includes("data-work-hours-field"));assert(app.includes("statusEl.value==='worked'"));});
test('Storage usage/quota null values handled safely',()=>{assert(app.includes("e && e.usage != null ? e.usage : null"));assert(app.includes("e && e.quota != null ? e.quota : null"));});
test('IndexedDB blocked upgrade has a finite timeout and closes late connections',()=>{assert(app.includes('Database upgrade is blocked by another app tab'));assert(app.includes('if (settled) { if (db) db.close(); return; }'));});
test('Database writes guard missing connection with readable error',()=>{assert(app.includes('Local database is not ready. Retry database connection.'));});
test('Database startup has a visible Retry banner and blocks writes until ready',()=>{assert(html.includes('id=\"dbBanner\"'));assert(html.includes('id=\"dbRetry\"'));assert(app.includes('state.dbReady = false'));assert(app.includes('initializeDatabase'));assert(app.includes('Database upgrade is blocked by another app tab'));});
test('Balance and Recent panels moved to Money and populated summaries',()=>{assert(html.includes('id=\"balanceSummary\"'));assert(html.includes('id=\"recentCard\"'));assert(app.includes("switchView('money')"));assert(app.includes('balanceBreakdown'));});

test('Bus allowance is added to monthly earned total',()=>{const data={work:[{date:'2026-11-01',status:'worked',hours:8}],payments:[],expenses:[],remittances:[],gifts:[]};const c=C.calcMonth(data,{...C.DEFAULTS,bus:60},'2026-11');assert.equal(c.earned,85);assert.equal(c.busDue,60);assert.equal(c.outstanding,85);});
test('Home Tips quick add button exists and backup section is menu-hidden',()=>{assert(html.includes('id=\"addTipsHome\"'));assert(/id=\"backupSec\"[^>]*hidden/.test(html));assert(!html.includes('data-money-jump=\"backupSec\"'));});

test('Backup section hidden by CSS when hidden attribute is set',()=>{assert(css.includes('#backupSec[hidden]{display:none!important}'));});
test('v9.6.3 clock balances time and date across the row',()=>{assert(css.includes('#clockDate,#clockTime'));assert(css.includes('#clock{justify-content:space-between!important'));assert(css.includes('.month button{width:30px'));assert(css.includes('.month strong{'));});
test('Dialogs focus heading, not native date controls',()=>{assert(app.includes('function openDlg(id)'));assert(app.includes('h.focus({preventScroll:true})'));});
test('Bangladesh remittance exchange rate defaults to 140',()=>{assert(app.includes('BD:140'));assert(app.includes('BD:140'));assert(app.includes('function remitRateDefault'));assert(app.includes('return latest&&Number(latest.rate)>0?Number(latest.rate):140'));});
test('OT quick action uses a dedicated OT-only dialog, not basic duty hours form',()=>{assert(html.includes('id=\"otDialog\"'));assert(html.includes('id=\"otHoursAdd\"'));assert(app.includes('saveOt'));assert(!app.includes('openForm(\'work\',old?Object.assign({},old,{status:\'worked\',hours:baseHours,otExtraHours:priorOt+1}'))});
test('Tips dialog does not autofocus date picker',()=>{assert(html.includes('id=\"tipAmount\"')&&!html.includes('autofocus'));assert(html.includes('id=\"tipDate\"'));});

test('Bulk entry supports per-date status and atomic batch save',()=>{assert(app.includes('bulk-date-row'));assert(app.includes('bulk-row-status'));assert(app.includes('putWorkBatch(records)'));assert(app.includes('tx.abort()'))});
test('Expanded currency list includes additional ISO codes',()=>{['XOF','XAF','DZD','RSD','ETB','TZS','UGX','KZT','KRW','XPF','TWD','FKP','LBP','MOP','SBD'].forEach(c=>assert(app.includes("['"+c+"','"+c+"']"),c))});
test('Home monthly figures use current month hc instead of selected month c',()=>{assert(app.includes("$('earned').textContent = money(C.r2(hc.wages + hc.otPay))"));assert(app.includes("$('expTotal').textContent = money(hc.expenses)"));assert(app.includes("$('monthTipsIncome').textContent=money(hc.tips)"));});
test('Home income mini-box removed and Tips moved into its position',()=>{assert(!html.includes('id=\"received\"'));assert(html.includes('class=\"home-tips\"'));assert(html.includes('id=\"tipsMonthIncome\"'));});
test('Worked-today popup contains only hours field, no date or status',()=>{assert(html.includes('id=\"quickDutyHoursDlg\"'));assert(html.includes('id=\"quickDutyHours\"'));assert(app.includes('function saveQuickDutyHours'));assert(app.includes('quickToday(\'worked\',hours)'));});
test('Tip entry saves into separate local tips store',()=>{assert(app.includes('function putTip'));assert(app.includes('objectStore(\'tips\').put(rec)'));assert(html.includes('id=\"saveTip\"'));});

test('Money sections consolidated into accordions and simplified menu',()=>{['Remittance','Money given','People & profiles','Reports','Balance &amp; savings','Recent transactions'].forEach(x=>assert(html.includes('>'+x+'</summary>'),x));assert(html.includes('data-target="payments"'));assert(!html.includes('data-target="remit"'));assert(!html.includes('data-target="gifts"'));assert(!html.includes('data-target="people"'));assert(!html.includes('data-target="profile"'));assert(html.includes('id="openProfileSettings"'));});



test('Home duty income excludes tips and bus allowance; total income includes tips',()=>{assert(app.includes('hc.wages + hc.otPay'));assert(app.includes('hc.wages + hc.otPay + hc.tips'));assert(html.includes('id=\"homeTotalIncome\"'));assert(html.includes('This Month\'s Duty Income'));});

test('v9.7.6 five-item navigation, language flags and home savings',()=>{assert.equal((html.match(/data-nav=/g)||[]).length,5);assert(html.includes('data-nav=\"money\"'));['bn','en','el','bg'].forEach(l=>assert(html.includes('data-lang=\"'+l+'\"')));assert(css.includes('.money-accordion>summary'));assert(css.includes('#clockTime,#clockDate{display:flex'));});
test('v9.7.6 five bottom navigation items, centered Add and compact actions',()=>{assert.equal((html.match(/data-nav=/g)||[]).length,5);assert(html.includes('class="nav-add" data-nav="quickActions"'));assert(css.includes('#quickActions .quick-grid,#quickAddDialog .quick-grid{grid-template-columns:repeat(3'));assert(css.includes('.bottom-nav{grid-template-columns:repeat(5'));});


test('Closed Money accordions hide their inner sections despite screen display rules',()=>{assert(css.includes('.money-accordion:not([open])>section[data-screen="money"]{display:none!important}'));});



test('Money Given currency conversion stores and reports BDT equivalent',()=>{const c=C.calcMonth({work:[],payments:[],expenses:[],remittances:[],gifts:[{date:'2026-11-01',person:'Test',currency:'EUR',amount:10,rate:135.5}]},C.DEFAULTS,'2026-11');assert.equal(c.giftEur,10);assert.equal(c.giftBdt,1355);assert(app.includes('function giftRateDefault'));assert(app.includes('moneyConvertPreview'));assert(app.includes('Select or add a person.'));});
test('Remittance form shows estimated BDT preview and actual override',()=>{assert(app.includes('Exchange rate (1 EUR = BDT)'));assert(app.includes('estimate=(net+bonusAmount)*rate'));assert(app.includes('Actual: '));});

console.log(`\n${tests}/${tests} checks passed.\n`);

test('Quick Add modal has SVG icons and icon-above-label layout',()=>{const dlg=html.split('<dialog id=\"quickAddDialog\">')[1].split('</dialog>')[0];assert.equal((dlg.match(/<svg class=\"ic\"/g)||[]).length,6);assert(css.includes('#quickAddDialog .quick span .ic'));assert(css.includes('#quickAddDialog .quick{min-height:88px'));});
test('Header is fixed with high z-index and safe-area offset',()=>{assert(css.includes('header{position:fixed!important'));assert(css.includes('z-index:100!important'));assert(css.includes('top:env(safe-area-inset-top,0px)!important'));});
