'use strict';
const BASIC=25, STANDARD_HOURS=8, OT_RATE=2.77;
const $=id=>document.getElementById(id);
let viewDate=new Date(), records=[], editingId=null;
const dbPromise=new Promise((resolve,reject)=>{
  if(!('indexedDB' in window)){reject(new Error('IndexedDB is unavailable'));return;}
  const req=indexedDB.open('salary-tracker-db',2);
  req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('workEntries'))db.createObjectStore('workEntries',{keyPath:'id'});};
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
});
function txRequest(mode,action){return dbPromise.then(db=>new Promise((resolve,reject)=>{
  const tx=db.transaction('workEntries',mode),store=tx.objectStore('workEntries');let result;
  const req=action(store);if(req){req.onsuccess=()=>result=req.result;req.onerror=()=>reject(req.error);}
  tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Database transaction aborted'));
}));}
const allRecords=()=>txRequest('readonly',s=>s.getAll());
const saveRecord=item=>txRequest('readwrite',s=>s.put(item));
const removeRecord=id=>txRequest('readwrite',s=>s.delete(id));
const money=n=>'€'+Number(n||0).toFixed(2);
const monthKey=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
const localDate=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
const dateText=s=>new Date(s+'T12:00:00').toLocaleDateString(undefined,{day:'numeric',month:'short'});
const statusName=s=>({worked:'Worked',rest:'Rest',paid_leave:'Paid Leave',unpaid_leave:'Unpaid Leave',sick_leave:'Sick Leave',holiday:'Holiday'})[s]||s;
const pay=r=>r.status==='worked'?BASIC+Math.max(0,Number(r.hours||0)-STANDARD_HOURS)*OT_RATE:0;
function render(){
  $('monthLabel').textContent=viewDate.toLocaleDateString(undefined,{month:'long',year:'numeric'});
  const list=records.filter(r=>r.date.startsWith(monthKey(viewDate))).sort((a,b)=>b.date.localeCompare(a.date));
  const worked=list.filter(r=>r.status==='worked');
  const ot=worked.reduce((sum,r)=>sum+Math.max(0,Number(r.hours)-STANDARD_HOURS),0);
  $('earned').textContent=money(list.reduce((sum,r)=>sum+pay(r),0));
  $('workedDays').textContent=worked.length;
  $('otHours').textContent=ot.toFixed(2)+' h';
  $('entries').innerHTML=list.length?list.map(r=>`<div class="entry"><div><strong>${dateText(r.date)} · ${statusName(r.status)}</strong><small>${r.status==='worked'?Number(r.hours).toFixed(2)+' h · '+Math.max(0,Number(r.hours)-STANDARD_HOURS).toFixed(2)+' OT h':'No paid hours recorded'}</small></div><div><strong>${money(pay(r))}</strong><button type="button" data-edit="${r.id}">Edit</button></div></div>`).join(''):'<p class="muted">No work entries for this month.</p>';
  document.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',()=>openDialog(b.dataset.edit)));
  const today=records.find(r=>r.date===localDate());
  $('todayStatus').textContent=today?statusName(today.status):'Not recorded';
  $('todayHours').textContent=today&&today.status==='worked'?Number(today.hours).toFixed(2)+' hours · '+money(pay(today)):'';
}
function preview(){
  const status=$('workStatus').value,hours=Number($('hours').value||0);
  $('hours').disabled=status!=='worked';
  $('entryPreview').textContent='Estimated pay: '+money(status==='worked'?BASIC+Math.max(0,hours-STANDARD_HOURS)*OT_RATE:0)+' · OT: '+(status==='worked'?Math.max(0,hours-STANDARD_HOURS):0).toFixed(2)+' h';
}
function openDialog(id){
  editingId=id||null;const record=id?records.find(x=>x.id===id):null;
  $('dialogTitle').textContent=record?'Edit work entry':'Record duty';
  $('workDate').value=record?.date||localDate();$('workStatus').value=record?.status||'worked';$('hours').value=record?.hours??8;
  $('deleteEntry').hidden=!record;preview();$('entryDialog').showModal();
}
$('prev').addEventListener('click',()=>{viewDate.setMonth(viewDate.getMonth()-1);render();});
$('next').addEventListener('click',()=>{viewDate.setMonth(viewDate.getMonth()+1);render();});
['record','addEntry','quickAdd'].forEach(id=>$(id).addEventListener('click',()=>openDialog()));
$('closeDialog').addEventListener('click',()=>$('entryDialog').close());
$('workStatus').addEventListener('change',preview);$('hours').addEventListener('input',preview);
$('homeTab').addEventListener('click',()=>window.scrollTo({top:0,behavior:'smooth'}));
$('workTab').addEventListener('click',()=>$('workSection').scrollIntoView({behavior:'smooth',block:'start'}));
$('entryForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const date=$('workDate').value,status=$('workStatus').value,hours=status==='worked'?Number($('hours').value||0):0;
  if(!date){alert('Please choose a date.');return;}
  const duplicate=records.find(r=>r.date===date&&r.id!==editingId);
  if(duplicate){alert('An entry already exists for this date. Edit the existing entry instead.');return;}
  const item={id:editingId||((crypto&&crypto.randomUUID)?crypto.randomUUID():String(Date.now())),date,status,hours,updatedAt:new Date().toISOString()};
  try{await saveRecord(item);records=await allRecords();$('entryDialog').close();render();}
  catch(err){alert('Could not save this entry. Please try again.');console.error(err);}
});
$('deleteEntry').addEventListener('click',async()=>{
  if(!editingId||!confirm('Delete this work entry?'))return;
  try{await removeRecord(editingId);records=await allRecords();$('entryDialog').close();render();}
  catch(err){alert('Could not delete this entry. Please try again.');console.error(err);}
});
(async()=>{
  try{records=await allRecords();render();}
  catch(err){$('entries').innerHTML='<p class="muted">Storage could not be opened. Open the app in Chrome or Safari using its HTTPS address, then reload.</p>';console.error(err);}
  if('serviceWorker' in navigator && location.protocol.startsWith('http')){
    navigator.serviceWorker.register('./service-worker.js?v=3',{updateViaCache:'none'}).then(reg=>reg.update()).catch(console.error);
  }
})();