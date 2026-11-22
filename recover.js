/* My Salary Tracker - read-only data recovery page (script moved out of recover.html so a strict Content-Security-Policy can be used; logic unchanged). */
'use strict';
const $=id=>document.getElementById(id);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Opens an existing database WITHOUT a version number (never upgrades).
// If the database does not exist, the creation is cancelled so nothing is created.
function openExisting(name){return new Promise((resolve,reject)=>{
  let missing=false;const r=indexedDB.open(name);
  r.onupgradeneeded=()=>{missing=true;try{r.transaction.abort()}catch(e){}};
  r.onsuccess=()=>{const db=r.result;db.onversionchange=()=>db.close();resolve(db)};
  r.onerror=()=>missing?resolve(null):reject(r.error);
  r.onblocked=()=>reject(new Error('blocked'));
})}
function readAll(db,storeName){return new Promise((resolve,reject)=>{
  const t=db.transaction(storeName,'readonly');const s=t.objectStore(storeName);
  const q=s.getAll();q.onsuccess=()=>resolve({keyPath:s.keyPath,records:q.result||[]});q.onerror=()=>reject(q.error);
})}
async function collect(){
  const result={app:'My Salary Tracker',kind:'recovery-export',createdAt:new Date().toISOString(),origin:location.origin,databases:[],localStorage:{},notes:[]};
  let names=[];
  if(indexedDB.databases){names=(await indexedDB.databases()).map(d=>d.name).filter(Boolean)}
  else{names=['salary-tracker-db'];result.notes.push('Browser cannot list databases; tried the usual name only.')}
  for(const name of names){
    const entry={name,version:null,stores:{},error:null};
    try{
      const db=await openExisting(name);
      if(!db){entry.error='not found';result.databases.push(entry);continue}
      entry.version=db.version;
      const storeNames=Array.from(db.objectStoreNames);
      for(const s of storeNames){entry.stores[s]=await readAll(db,s)}
      db.close();
    }catch(e){entry.error=String(e&&e.message||e)}
    result.databases.push(entry);
  }
  try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);result.localStorage[k]=localStorage.getItem(k)}}catch(e){result.notes.push('localStorage not readable: '+e.message)}
  return result;
}
function summarize(res){
  const items=[];let total=0;
  for(const d of res.databases){
    if(d.error){items.push(`Database "${d.name}": ${d.error}`);continue}
    const parts=Object.entries(d.stores).map(([n,s])=>{total+=s.records.length;return `${n}: ${s.records.length}`});
    items.push(`Database "${d.name}" (version ${d.version}) - ${parts.join(', ')||'no stores'}`);
  }
  items.push(`Settings keys found: ${Object.keys(res.localStorage).length}`);
  return {items,total};
}
let json='';
async function main(){
  try{
    if(!window.indexedDB)throw new Error('This browser has no IndexedDB.');
    const res=await collect();const sm=summarize(res);
    json=JSON.stringify(res,null,2);
    $('summary').innerHTML='';sm.items.forEach(t=>{const li=document.createElement('li');li.textContent=t;$('summary').appendChild(li)});
    $('found').hidden=false;
    if(sm.total>0){$('status').innerHTML='<b class="ok">Records found: '+sm.total+'.</b> Save a copy below.';$('actions').hidden=false;$('out').value=json}
    else{$('status').innerHTML='<b class="warn">No records found in this place.</b><br><span class="muted">On iPhone, the Home Screen app and the Safari browser keep SEPARATE storage. If you normally use the Home Screen icon, open this page from inside that app. If you normally use Safari, open it in Safari. Nothing was changed.</span>';$('actions').hidden=false;$('out').value=json}
  }catch(e){$('status').innerHTML='<b class="bad">Could not read data:</b> '+String(e.message||e).replace(/[<>&]/g,'')+'<br><span class="muted">Nothing was changed.</span>'}
}
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(json);$('copy').textContent='Copied!'}catch(e){$('out').focus();$('out').select();$('copy').textContent='Select the text in the box and copy it'}};
$('share').onclick=async()=>{
  const name='salary-tracker-recovery-'+new Date().toLocaleDateString('en-CA')+'.json';
  try{const f=new File([json],name,{type:'application/json'});
    if(navigator.canShare&&navigator.canShare({files:[f]})){await navigator.share({files:[f],title:name});return}}catch(e){if(e&&e.name==='AbortError')return}
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([json],{type:'application/json'}));a.download=name;document.body.appendChild(a);a.click();a.remove();
};
if(typeof module==='undefined')main();
