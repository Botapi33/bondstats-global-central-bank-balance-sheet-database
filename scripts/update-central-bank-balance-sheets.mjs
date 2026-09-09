import fs from 'node:fs/promises';

const OUT = new URL('../data/central-bank-balance-sheets.json', import.meta.url);
const REG = JSON.parse(await fs.readFile(new URL('../data/central-bank-balance-sheet-sources.json', import.meta.url), 'utf8'));
let prior = {};
try { prior = JSON.parse(await fs.readFile(OUT, 'utf8')); } catch {}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function fetchText(url, opts={}) {
  const r = await fetch(url, {headers:{'user-agent':'BondStats/1.0 balance-sheet database; public-source research'}, ...opts});
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${url}`);
  return await r.text();
}
async function fetchJSON(url) {
  const r = await fetch(url, {headers:{'user-agent':'BondStats/1.0 balance-sheet database; public-source research'}});
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${url}`);
  return await r.json();
}
function parseCSV(text, delim=',') {
  const rows=[]; let row=[], field='', q=false;
  for (let i=0;i<text.length;i++) {
    const c=text[i], n=text[i+1];
    if(c==='"' && q && n==='"'){field+='"'; i++; continue;}
    if(c==='"'){q=!q; continue;}
    if(!q && c===delim){row.push(field); field=''; continue;}
    if(!q && (c==='\n' || c==='\r')){
      if(c==='\r' && n==='\n') i++;
      row.push(field); field='';
      if(row.some(x=>String(x).trim()!=='')) rows.push(row);
      row=[]; continue;
    }
    field+=c;
  }
  row.push(field); if(row.some(x=>String(x).trim()!=='')) rows.push(row);
  return rows;
}
const num = v => {
  const x = Number(String(v ?? '').replace(/[,\s]/g,''));
  return Number.isFinite(x) ? x : null;
};
function monthKey(date) {
  const m=String(date).match(/^(\d{4})[-\/](\d{1,2})/);
  if(m) return `${m[1]}-${String(m[2]).padStart(2,'0')}`;
  const d=new Date(date); return Number.isNaN(+d)?null:`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
}
function monthlyLast(obs) {
  const map=new Map();
  for(const o of obs){
    const m=monthKey(o.date); if(!m || o.value==null) continue;
    if(!map.has(m) || String(o.date) > String(map.get(m).rawDate||'')) map.set(m,{date:m,value:o.value,rawDate:o.date});
  }
  return [...map.values()].map(({date,value})=>({date,value})).sort((a,b)=>a.date.localeCompare(b.date));
}
function clean(obs) {
  return obs.filter(o=>o.date && Number.isFinite(o.value)).sort((a,b)=>a.date.localeCompare(b.date));
}

async function fed(bank) {
  const rows=parseCSV(await fetchText(bank.data));
  const obs=rows.slice(1).map(r=>({date:r[0],value:num(r[1])}));
  return monthlyLast(clean(obs));
}
async function ecb(bank) {
  const rows=parseCSV(await fetchText(bank.data));
  const h=rows[0].map(x=>x.trim());
  const ti=h.findIndex(x=>/TIME_PERIOD/i.test(x));
  const vi=h.findIndex(x=>/OBS_VALUE/i.test(x));
  if(ti<0 || vi<0) throw new Error('ECB CSV columns not found');
  return clean(rows.slice(1).map(r=>({date:monthKey(r[ti]),value:num(r[vi])})));
}
async function boe(bank) {
  const rows=parseCSV(await fetchText(bank.data));
  const obs=[];
  for(const r of rows) {
    const v=num(r[r.length-1]); if(v==null) continue;
    const d=String(r[0]||'').trim();
    const parsed=new Date(d);
    if(!Number.isNaN(+parsed)) obs.push({date:parsed.toISOString().slice(0,10),value:v});
  }
  if(!obs.length) throw new Error('BoE CSV returned no observations');
  return monthlyLast(obs);
}
function deepCollect(obj, out=[]) {
  if(!obj || typeof obj!=='object') return out;
  if(Array.isArray(obj)) { for(const x of obj) deepCollect(x,out); return out; }
  out.push(obj); for(const v of Object.values(obj)) deepCollect(v,out); return out;
}
async function boj(bank) {
  const meta=await fetchJSON(bank.data);
  const objs=deepCollect(meta);
  const candidates=objs.filter(o=>{
    const text=Object.values(o).filter(v=>typeof v==='string').join(' ').toLowerCase();
    return text.includes('total assets') && (text.includes('bank of japan') || text.includes('principal accounts'));
  });
  let code=null;
  for(const o of candidates){
    for(const [k,v] of Object.entries(o)){
      if(typeof v==='string' && /code/i.test(k) && v.length>4){ code=v; break; }
    }
    if(code) break;
  }
  if(!code) throw new Error('BOJ total-assets series could not be resolved from BS metadata');
  code=code.replace(/^BS'/,'');
  const url=`https://www.stat-search.boj.or.jp/api/v1/getDataCode?format=json&lang=en&db=BS&startDate=199801&code=${encodeURIComponent(code)}`;
  const data=await fetchJSON(url);
  const all=deepCollect(data);
  const obs=[];
  for(const o of all){
    const vals=Object.values(o);
    const date=vals.find(v=>typeof v==='string' && /^\d{4}[-\/]?\d{2}/.test(v));
    const value=vals.map(num).find(v=>v!=null && Math.abs(v)>1000);
    if(date && value!=null) obs.push({date:monthKey(date),value});
  }
  const dedup=new Map(clean(obs).map(o=>[o.date,o]));
  if(!dedup.size) throw new Error(`BOJ series ${code} returned no parsed observations`);
  bank.series=`BS'${code}`;
  return [...dedup.values()];
}
async function snb(bank) {
  const text=await fetchText(bank.data);
  const rows=parseCSV(text,';');
  const obs=[];
  for(const r of rows){
    const date=r.find(x=>/^\d{4}-\d{2}/.test(String(x).trim()));
    if(!date) continue;
    const vals=r.map(num).filter(v=>v!=null);
    if(vals.length) obs.push({date:monthKey(date),value:vals[vals.length-1]});
  }
  const dedup=new Map(clean(obs).map(o=>[o.date,o]));
  if(!dedup.size) throw new Error('SNB CSV returned no observations');
  return [...dedup.values()];
}

const loaders={ 'federal-reserve':fed, ecb, boj, boe, snb };
const result={
  generatedAt:new Date().toISOString(),
  status:'ok',
  methodology:{
    comparison:'Native-currency balance sheets are not converted into one currency. Cross-bank comparison uses an indexed series (100 at each selected comparison start).',
    monthly:'Weekly series are reduced to the final available observation in each calendar month.',
    revisions:'Official-source revisions replace prior observations on the next successful sync.',
    failure:'Updater preserves the last successful bank series if one source temporarily fails.'
  },
  banks:{}
};

let failures=0;
for(const b0 of REG.banks){
  const b={...b0};
  try{
    const observations=await loaders[b.slug](b);
    const latest=observations.at(-1);
    result.banks[b.slug]={
      slug:b.slug,name:b.name,short:b.short,currency:b.currency,unit:b.unit,
      frequency:b.frequency,series:b.series,source:b.source,official:b.official,
      observations,lastUpdated:latest?.date||null,sourceStatus:'ok'
    };
    console.log(`✓ ${b.short}: ${observations.length} monthly observations through ${latest?.date}`);
  }catch(err){
    failures++;
    console.error(`✗ ${b.short}:`,err.message);
    const old=prior?.banks?.[b.slug];
    result.banks[b.slug]=old ? {...old,sourceStatus:'stale',lastError:String(err.message),checkedAt:new Date().toISOString()} : {
      slug:b.slug,name:b.name,short:b.short,currency:b.currency,unit:b.unit,
      frequency:b.frequency,series:b.series,source:b.source,official:b.official,
      observations:[],lastUpdated:null,sourceStatus:'error',lastError:String(err.message)
    };
  }
  await sleep(400);
}
if(failures) result.status=failures===REG.banks.length?'error':'partial';
await fs.writeFile(OUT, JSON.stringify(result,null,2)+'\n');
console.log(`Wrote ${OUT.pathname}; status=${result.status}; source failures=${failures}`);
