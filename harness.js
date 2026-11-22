'use strict';
// Loads the REAL index.html + app.js in jsdom with a real (fake-indexeddb) IndexedDB implementation.
const {JSDOM}=require('jsdom');const fs=require('fs');const path=require('path');
const FDB=require('fake-indexeddb');
const ROOT=path.join(__dirname,'..');
const opens=[];
async function load(opts={}){
  const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8').replace(/<script[^>]*src=[^>]*><\/script>/g,'');
  const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://example.github.io/my-salary-tracker/',pretendToBeVisual:true});
  const w=dom.window;
  w.indexedDB=opts.indexedDB||new FDB.IDBFactory();w.IDBKeyRange=FDB.IDBKeyRange;
  const real=w.setTimeout.bind(w);w.setTimeout=(f,ms,...a)=>real(f,ms>=10000?60:ms,...a); // shrink the 15s/20s DB timeouts
  w.fetchCalls=0;w.fetch=()=>{w.fetchCalls++;return Promise.reject(new Error('offline'))};
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')};
  w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'))};
  w.scrollTo=()=>{};w.matchMedia=w.matchMedia||(()=>({matches:false,addEventListener(){},addListener(){}}));
  w.confirm=()=>true;
  if(opts.beforeApp)opts.beforeApp(w);
  for(const f of ['i18n.js','calc.js','backup-rules.js','app.js'])w.eval(fs.readFileSync(path.join(ROOT,f),'utf8'));
  let initError=null;try{await w.MSTReady}catch(e){initError=e}
  return {w,dom,idb:w.indexedDB,state:w.MSTDebug.state,D:w.MSTDebug,initError,$:id=>w.document.getElementById(id),close(){try{w.MSTDebug.state.db&&w.MSTDebug.state.db.close()}catch(e){};w.close()}};
}
// Create a database as an OLDER app version would have, before the app opens it.
function seed(idb,{name='salary-tracker-db',version=1,stores={},}){
  return new Promise((res,rej)=>{const r=idb.open(name,version);
    r.onupgradeneeded=()=>{for(const s of Object.keys(stores))r.result.createObjectStore(s,{keyPath:'id'})};
    r.onsuccess=()=>{const db=r.result;const names=Object.keys(stores);if(!names.length){db.close();return res()}
      const tx=db.transaction(names,'readwrite');for(const s of names)for(const x of stores[s])tx.objectStore(s).put(x);
      tx.oncomplete=()=>{db.close();res()};tx.onerror=()=>rej(tx.error)};r.onerror=()=>rej(r.error)});
}
function dump(idb,name='salary-tracker-db'){return new Promise((res,rej)=>{const r=idb.open(name);r.onsuccess=()=>{const db=r.result,out={version:db.version,stores:{}},names=Array.from(db.objectStoreNames);
  if(!names.length){db.close();return res(out)}const tx=db.transaction(names,'readonly');let n=names.length;
  names.forEach(s=>{const q=tx.objectStore(s).getAll();q.onsuccess=()=>{out.stores[s]=q.result;if(!--n){db.close();res(out)}}})};r.onerror=()=>rej(r.error)})}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
module.exports={load,seed,dump,sleep,FDB,ROOT};
