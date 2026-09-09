import fs from 'node:fs/promises';

const OUT = new URL('../data/central-bank-balance-sheets.json', import.meta.url);
const REG = JSON.parse(await fs.readFile(new URL('../data/central-bank-balance-sheet-sources.json', import.meta.url), 'utf8'));

let prior = {};
try { prior = JSON.parse(await fs.readFile(OUT, 'utf8')); } catch {}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchText(url) {
  const r = await fetch(url, {
    headers: {
      'user-agent': 'BondStats/1.0 central-bank-balance-sheet-research',
      'accept': 'text/csv,text/plain,text/html,application/json;q=0.8,*/*;q=0.5'
    }
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${url}`);
  return await r.text();
}

async function fetchJSON(url) {
  const r = await fetch(url, {
    headers: {
      'user-agent': 'BondStats/1.0 central-bank-balance-sheet-research',
      'accept': 'application/json'
    }
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${url}`);
  return await r.json();
}

function parseCSV(text, delim=',') {
  const rows=[]; let row=[], field='', q=false;
  for (let i=0;i<text.length;i++) {
    const c=text[i], n=text[i+1];
    if (c === '"' && q && n === '"') { field += '"'; i++; continue; }
    if (c === '"') { q=!q; continue; }
    if (!q && c === delim) { row.push(field); field=''; continue; }
    if (!q && (c === '\n' || c === '\r')) {
      if (c === '\r' && n === '\n') i++;
      row.push(field); field='';
      if (row.some(x => String(x).trim() !== '')) rows.push(row);
      row=[];
      continue;
    }
    field += c;
  }
  row.push(field);
  if (row.some(x => String(x).trim() !== '')) rows.push(row);
  return rows;
}

const num = v => {
  const s=String(v ?? '').trim().replace(/[,\s]/g,'');
  if (!s || !/^-?\d+(?:\.\d+)?$/.test(s)) return null;
  const x=Number(s);
  return Number.isFinite(x) ? x : null;
};

function monthKey(value) {
  const s=String(value ?? '').trim();
  let m=s.match(/^(\d{4})[-\/](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2,'0')}`;
  m=s.match(/^(\d{4})(\d{2})(?:\d{2})?$/);
  if (m) return `${m[1]}-${m[2]}`;

  // Bank of England style: "06 Jan 10"
  m=s.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2}|\d{4})$/);
  if (m) {
    const months={jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
    const mm=months[m[2].toLowerCase()];
    let yy=Number(m[3]);
    if (m[3].length===2) yy += yy >= 70 ? 1900 : 2000;
    if (mm) return `${yy}-${mm}`;
  }

  const d=new Date(s);
  return Number.isNaN(+d) ? null : `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
}

function clean(obs) {
  const m=new Map();
  for (const o of obs) {
    const d=monthKey(o.date);
    const v=Number(o.value);
    if (!d || !Number.isFinite(v)) continue;
    m.set(d,{date:d,value:v});
  }
  return [...m.values()].sort((a,b)=>a.date.localeCompare(b.date));
}

function monthlyLast(obs) {
  // clean() already keeps the final value encountered for the month.
  return clean(obs);
}

async function fed(bank) {
  const rows=parseCSV(await fetchText(bank.data));
  const obs=rows.slice(1).map(r=>({date:r[0],value:num(r[1])}));
  const out=monthlyLast(obs);
  if (!out.length) throw new Error('Fed WALCL returned no usable observations');
  return out;
}

async function ecb(bank) {
  const rows=parseCSV(await fetchText(bank.data));
  const h=(rows[0]||[]).map(x=>String(x).trim());
  const ti=h.findIndex(x=>/TIME_PERIOD/i.test(x));
  const vi=h.findIndex(x=>/OBS_VALUE/i.test(x));
  if (ti<0 || vi<0) throw new Error('ECB CSV columns TIME_PERIOD / OBS_VALUE not found');
  const out=clean(rows.slice(1).map(r=>({date:r[ti],value:num(r[vi])})));
  if (!out.length) throw new Error('ECB series returned no usable observations');
  return out;
}

function boeRowsToObs(rows) {
  const obs=[];
  for (const r of rows) {
    let date=null;
    for (const cell of r) {
      const mk=monthKey(cell);
      if (mk) { date=cell; break; }
    }
    if (!date) continue;
    const values=r.map(num).filter(v=>v!=null);
    if (!values.length) continue;
    obs.push({date,value:values[values.length-1]});
  }
  return obs;
}

async function boe(bank) {
  const text=await fetchText(bank.data);

  // The official IADB export is CSV. Handle comma, semicolon and tab layouts.
  let obs=[];
  for (const delim of [',',';','\t']) {
    const rows=parseCSV(text,delim);
    const candidate=boeRowsToObs(rows);
    if (candidate.length > obs.length) obs=candidate;
  }

  // Fallback for an export wrapped in text/HTML: scan lines for date + numeric value.
  if (!obs.length) {
    const re=/(\d{1,2}\s+[A-Za-z]{3}\s+\d{2,4}).{0,120}?([0-9][0-9,\s]*(?:\.\d+)?)/g;
    let m;
    while ((m=re.exec(text))) obs.push({date:m[1],value:num(m[2])});
  }

  const out=monthlyLast(obs);
  if (!out.length) throw new Error('BoE RPWB75A returned no usable observations');
  return out;
}

function resultSet(j) {
  if (Array.isArray(j?.RESULTSET)) return j.RESULTSET;
  if (Array.isArray(j?.resultset)) return j.resultset;
  for (const v of Object.values(j||{})) if (Array.isArray(v) && v.length && typeof v[0] === 'object') return v;
  return [];
}

async function boj(bank) {
  // Correct official DB name per the BOJ API manual: BS01 = Bank of Japan Accounts.
  const meta=await fetchJSON(bank.data);
  if (Number(meta?.STATUS ?? 200) !== 200) throw new Error(`BOJ metadata status ${meta?.STATUS}: ${meta?.MESSAGE||''}`);

  const rows=resultSet(meta);
  const candidates=rows.filter(o=>{
    const n=String(o.NAME_OF_TIME_SERIES ?? o.name_of_time_series ?? '').toLowerCase();
    return n.includes('total') && n.includes('asset');
  });

  if (!candidates.length) throw new Error('BOJ BS01 metadata contains no Total Assets candidate');

  // Prefer monthly total-assets series and the shortest/most direct name.
  candidates.sort((a,b)=>{
    const am=/monthly/i.test(String(a.FREQUENCY||''))?0:1;
    const bm=/monthly/i.test(String(b.FREQUENCY||''))?0:1;
    if (am!==bm) return am-bm;
    return String(a.NAME_OF_TIME_SERIES||'').length - String(b.NAME_OF_TIME_SERIES||'').length;
  });

  const chosen=candidates[0];
  const code=String(chosen.SERIES_CODE ?? '').trim();
  if (!code) throw new Error('BOJ Total Assets metadata candidate has no SERIES_CODE');

  const url=`https://www.stat-search.boj.or.jp/api/v1/getDataCode?format=json&lang=en&db=BS01&startDate=199801&code=${encodeURIComponent(code)}`;
  const data=await fetchJSON(url);
  if (Number(data?.STATUS ?? 200) !== 200) throw new Error(`BOJ data status ${data?.STATUS}: ${data?.MESSAGE||''}`);

  const series=resultSet(data).find(x=>String(x.SERIES_CODE||'')===code) || resultSet(data)[0];
  if (!series) throw new Error(`BOJ series ${code} returned no RESULTSET`);

  const dates=Array.isArray(series.SURVEY_DATES) ? series.SURVEY_DATES : [];
  const values=Array.isArray(series.VALUES) ? series.VALUES : [];
  const obs=[];
  for (let i=0;i<Math.min(dates.length,values.length);i++) {
    const v=Number(values[i]);
    if (Number.isFinite(v)) obs.push({date:dates[i],value:v});
  }

  const out=clean(obs);
  if (!out.length) throw new Error(`BOJ series ${code} returned no usable observations`);
  bank.series=code;
  return out;
}

async function snb(bank) {
  const text=await fetchText(bank.data);
  let best=[];
  for (const delim of [';',',','\t']) {
    const rows=parseCSV(text,delim), obs=[];
    for (const r of rows) {
      const d=r.find(x=>monthKey(x));
      if (!d) continue;
      const vals=r.map(num).filter(v=>v!=null);
      if (vals.length) obs.push({date:d,value:vals[vals.length-1]});
    }
    if (obs.length > best.length) best=obs;
  }
  const out=clean(best);
  if (!out.length) throw new Error('SNB snbbipo returned no usable observations');
  return out;
}

const loaders={ 'federal-reserve':fed, ecb, boj, boe, snb };
const result={
  generatedAt:new Date().toISOString(),
  status:'ok',
  methodology:{
    comparison:'Cross-bank level comparison uses an index rebased to 100 at the selected window start. Native currencies are never added together.',
    impulse:'The 12M impulse is the percentage change versus the observation 12 calendar months earlier.',
    monthly:'Higher-frequency series are reduced to the final usable observation in each calendar month.',
    revisions:'Official-source revisions replace earlier stored observations on the next successful sync.',
    failure:'A bank retains its previous successful history and is marked stale if its source temporarily fails.'
  },
  banks:{}
};

let failures=0;
for (const b0 of REG.banks) {
  const b={...b0};
  try {
    const observations=await loaders[b.slug](b);
    const latest=observations.at(-1);
    result.banks[b.slug]={
      slug:b.slug,name:b.name,short:b.short,currency:b.currency,unit:b.unit,
      frequency:b.frequency,series:b.series,source:b.source,official:b.official,
      observations,lastUpdated:latest?.date||null,sourceStatus:'ok'
    };
    console.log(`✓ ${b.short}: ${observations.length} observations through ${latest?.date} (${b.series})`);
  } catch (err) {
    failures++;
    console.error(`✗ ${b.short}: ${err.message}`);
    const old=prior?.banks?.[b.slug];
    result.banks[b.slug]=old ? {
      ...old,
      sourceStatus:'stale',
      lastError:String(err.message),
      checkedAt:new Date().toISOString()
    } : {
      slug:b.slug,name:b.name,short:b.short,currency:b.currency,unit:b.unit,
      frequency:b.frequency,series:b.series,source:b.source,official:b.official,
      observations:[],lastUpdated:null,sourceStatus:'error',lastError:String(err.message)
    };
  }
  await sleep(450);
}

if (failures) result.status=failures===REG.banks.length?'error':'partial';
await fs.writeFile(OUT, JSON.stringify(result,null,2)+'\n');
console.log(`Wrote database; status=${result.status}; source failures=${failures}`);

if (failures === REG.banks.length) {
  console.error('All configured sources failed. Failing workflow instead of publishing a false-green empty database.');
  process.exitCode=1;
}
