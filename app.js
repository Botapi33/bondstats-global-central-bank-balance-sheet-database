let REG=null, DB=null;
let mode='level', years=5;
const visible=new Set();
const $=s=>document.querySelector(s);
const colors=['#4eeb86','#dfe9e3','#86bea0','#5d8972','#abb8b1'];
const fmt=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:1}).format(n);
const pct=n=>(n==null||!Number.isFinite(n))?'—':`${n>0?'+':''}${n.toFixed(1)}%`;

function shiftYear(month, delta=-1){
  const [y,m]=month.split('-').map(Number);
  return `${y+delta}-${String(m).padStart(2,'0')}`;
}
function yoyFor(obs, atIndex=obs.length-1){
  if(atIndex<0) return null;
  const map=new Map(obs.map(x=>[x.date,Number(x.value)]));
  const cur=obs[atIndex], prev=map.get(shiftYear(cur.date,-1));
  return Number.isFinite(prev) && prev!==0 ? (Number(cur.value)/prev-1)*100 : null;
}
function windowObs(obs){
  if(!years) return obs;
  const now=new Date();
  const cutoff=`${now.getUTCFullYear()-years}-${String(now.getUTCMonth()+1).padStart(2,'0')}`;
  return obs.filter(x=>x.date>=cutoff);
}
function bankSeries(){
  return (REG?.banks||[]).map((meta,i)=>{
    const d=DB?.banks?.[meta.slug]||{};
    const obs=(d.observations||[]).filter(x=>x.date && Number.isFinite(Number(x.value)));
    return {meta,d,obs,i};
  });
}

async function load(){
  const [a,b]=await Promise.all([
    fetch('./data/central-bank-balance-sheet-sources.json',{cache:'no-store'}),
    fetch('./data/central-bank-balance-sheets.json',{cache:'no-store'})
  ]);
  if(!a.ok) throw new Error(`source registry HTTP ${a.status}`);
  if(!b.ok) throw new Error(`database HTTP ${b.status}`);
  REG=await a.json(); DB=await b.json();
  for(const bank of REG.banks) visible.add(bank.slug);
  renderAll();
}

function renderAll(){
  const okBanks=bankSeries().filter(x=>x.d.sourceStatus==='ok' && x.obs.length).length;
  $('#syncState').textContent=`${okBanks}/${REG.banks.length} sources current`;
  $('.source-light').classList.toggle('ok',okBanks>0);
  $('#lastSync').textContent=DB.generatedAt ? new Date(DB.generatedAt).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}) : 'not generated';
  renderInstitutions();
  renderSourceLedger();
  draw();
}

function renderInstitutions(){
  $('#institutionList').innerHTML=bankSeries().map(({meta,d,obs,i})=>{
    const yo=yoyFor(obs);
    const win=windowObs(obs);
    const idx=win.length ? Number(win.at(-1).value)/Number(win[0].value)*100 : null;
    const on=visible.has(meta.slug);
    return `<button class="institution-row ${on?'':'off'}" data-bank="${meta.slug}">
      <div class="bank-line"><span class="series-swatch" style="background:${colors[i]}"></span><strong>${meta.short}</strong></div>
      <small>${d.lastUpdated?'through '+d.lastUpdated:(d.sourceStatus||'no data')}</small>
      <div class="micro"><span>index<b>${idx==null?'—':idx.toFixed(1)}</b></span><span>12m<b>${pct(yo)}</b></span></div>
    </button>`;
  }).join('');
}

function renderSourceLedger(){
  $('#sourceLedger').innerHTML=bankSeries().map(({meta,d,obs})=>{
    const last=obs.at(-1), yo=yoyFor(obs);
    return `<a class="record-row" href="${meta.official}" target="_blank" rel="noopener">
      <div><strong>${meta.name}</strong><small>${meta.jurisdiction} · ${meta.unit}</small></div>
      <div><code>${d.series||meta.series}</code></div>
      <div class="latest">${last?fmt(Number(last.value))+' '+meta.currency:'—'}</div>
      <div class="yoy ${yo>0?'pos':''}">${pct(yo)}</div>
      <div class="health ${d.sourceStatus==='ok'?'ok':''}">${d.sourceStatus||'no sync'}</div>
      <div class="open">↗</div>
    </a>`;
  }).join('');
}

function transformSeries(item){
  const o=windowObs(item.obs);
  if(!o.length) return null;
  if(mode==='level'){
    const base=Number(o[0].value);
    return {...item,pts:o.map(x=>({d:x.date,v:Number(x.value)/base*100,raw:Number(x.value)}))};
  }
  const fullMap=new Map(item.obs.map(x=>[x.date,Number(x.value)]));
  const pts=[];
  for(const x of o){
    const prev=fullMap.get(shiftYear(x.date,-1));
    if(Number.isFinite(prev) && prev!==0) pts.push({d:x.date,v:(Number(x.value)/prev-1)*100,raw:Number(x.value)});
  }
  return pts.length ? {...item,pts} : null;
}

function draw(){
  const svg=$('#chart'), empty=$('#emptyState');
  const data=bankSeries().filter(x=>visible.has(x.meta.slug) && x.obs.length).map(transformSeries).filter(Boolean);

  $('#chartMeasure').textContent=mode==='level'?'Index · selected-window start = 100':'Year-over-year change · %';
  if(!data.length){
    svg.innerHTML=''; empty.hidden=false; renderPulse([]); renderBreadth(); return;
  }
  empty.hidden=true;

  const W=980,H=405,p={l:58,r:74,t:22,b:38};
  const vals=data.flatMap(s=>s.pts.map(x=>x.v));
  let mn=Math.min(...vals),mx=Math.max(...vals);
  if(mode==='impulse'){ mn=Math.min(mn,0); mx=Math.max(mx,0); }
  const pad=(mx-mn)*.09 || 5; mn-=pad;mx+=pad;
  const dates=data.flatMap(s=>s.pts.map(x=>x.d)).sort();
  const tm=d=>Date.parse(d+'-01T00:00:00Z'),t0=tm(dates[0]),t1=tm(dates.at(-1));
  const x=d=>p.l+(tm(d)-t0)/(t1-t0||1)*(W-p.l-p.r);
  const y=v=>p.t+(mx-v)/(mx-mn||1)*(H-p.t-p.b);

  let h='';
  for(let i=0;i<6;i++){
    const v=mn+(mx-mn)*i/5, yy=y(v);
    h+=`<line x1="${p.l}" x2="${W-p.r}" y1="${yy}" y2="${yy}" stroke="#1a3023" vector-effect="non-scaling-stroke"/>`;
    h+=`<text x="${p.l-10}" y="${yy+4}" fill="#65786d" text-anchor="end" font-size="10">${mode==='impulse'?v.toFixed(0)+'%':v.toFixed(0)}</text>`;
  }
  if(mode==='impulse' && mn<0 && mx>0){
    h+=`<line x1="${p.l}" x2="${W-p.r}" y1="${y(0)}" y2="${y(0)}" stroke="#50665a" stroke-dasharray="4 5" vector-effect="non-scaling-stroke"/>`;
  }

  const tickYears=[];
  for(const d of dates){
    if(d.endsWith('-01') && !tickYears.includes(d)) tickYears.push(d);
  }
  const step=Math.max(1,Math.ceil(tickYears.length/6));
  tickYears.filter((_,i)=>i%step===0).forEach(d=>{
    const xx=x(d);
    h+=`<line x1="${xx}" x2="${xx}" y1="${p.t}" y2="${H-p.b}" stroke="#10261a" vector-effect="non-scaling-stroke"/>`;
    h+=`<text x="${xx}" y="${H-11}" fill="#65786d" text-anchor="middle" font-size="10">${d.slice(0,4)}</text>`;
  });

  data.forEach(s=>{
    const c=colors[s.i];
    const path=s.pts.map((q,j)=>`${j?'L':'M'}${x(q.d).toFixed(2)},${y(q.v).toFixed(2)}`).join(' ');
    h+=`<path d="${path}" fill="none" stroke="${c}" stroke-width="${s.i===0?2.5:1.7}" vector-effect="non-scaling-stroke"/>`;
    const q=s.pts.at(-1);
    h+=`<circle cx="${x(q.d)}" cy="${y(q.v)}" r="3.2" fill="${c}"/>`;
    h+=`<text x="${Math.min(W-8,x(q.d)+8)}" y="${y(q.v)+4}" fill="${c}" font-size="10" font-weight="700">${s.meta.short}</text>`;
  });

  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
  svg.innerHTML=h;
  setupHover(svg,data,{W,H,p,x,y,t0,t1});
  renderPulse(data);
  renderBreadth();
}

function renderPulse(data){
  const bySlug=new Map(data.map(s=>[s.meta.slug,s]));
  $('#pulseLedger').innerHTML=bankSeries().map(({meta,d,obs,i})=>{
    const yo=yoyFor(obs);
    const w=windowObs(obs);
    let dd=null;
    if(w.length){
      const vals=w.map(x=>Number(x.value)), peak=Math.max(...vals), last=vals.at(-1);
      dd=peak?((last/peak)-1)*100:null;
    }
    return `<div class="pulse-cell">
      <div class="pc-head"><strong>${meta.short}</strong><span class="direction ${yo>0?'up':''}">${yo==null?'no 12m':yo>0?'expanding':'contracting'}</span></div>
      <div class="pc-value">${pct(yo)}</div>
      <small>12M change · ${dd==null?'peak comparison n/a':pct(dd)+' vs window peak'}</small>
    </div>`;
  }).join('');
}

function renderBreadth(){
  const yoy=bankSeries().map(x=>({name:x.meta.short,v:yoyFor(x.obs)})).filter(x=>Number.isFinite(x.v));
  if(!yoy.length){ $('#breadthFill').style.width='0%'; $('#breadthCopy').textContent='No complete 12M comparisons'; return; }
  const up=yoy.filter(x=>x.v>0).length, down=yoy.filter(x=>x.v<0).length, flat=yoy.length-up-down;
  $('#breadthFill').style.width=`${up/yoy.length*100}%`;
  const leader=[...yoy].sort((a,b)=>b.v-a.v)[0], lag=[...yoy].sort((a,b)=>a.v-b.v)[0];
  $('#breadthCopy').textContent=`${up} expanding · ${down} contracting${flat?' · '+flat+' flat':''} · strongest ${leader.name} ${pct(leader.v)} · weakest ${lag.name} ${pct(lag.v)}`;
}

function setupHover(svg,data,geom){
  const tooltip=$('#tooltip'), dateLabel=$('#hoverDate');
  const allDates=[...new Set(data.flatMap(s=>s.pts.map(p=>p.d)))].sort();
  const tm=d=>Date.parse(d+'-01T00:00:00Z');
  function nearestDate(px){
    const box=svg.getBoundingClientRect();
    const ux=(px-box.left)/box.width*geom.W;
    const ratio=Math.max(0,Math.min(1,(ux-geom.p.l)/(geom.W-geom.p.l-geom.p.r)));
    const target=geom.t0+ratio*(geom.t1-geom.t0);
    let best=allDates[0],dist=Infinity;
    for(const d of allDates){const q=Math.abs(tm(d)-target);if(q<dist){dist=q;best=d}}
    return best;
  }
  svg.onpointermove=e=>{
    const d=nearestDate(e.clientX);
    dateLabel.textContent=d;
    const rows=[];
    for(const s of data){
      let q=s.pts.find(p=>p.d===d);
      if(!q){
        // nearest point in that series
        q=s.pts.reduce((a,b)=>Math.abs(tm(b.d)-tm(d))<Math.abs(tm(a.d)-tm(d))?b:a,s.pts[0]);
      }
      if(q) rows.push(`<div class="tv"><b style="color:${colors[s.i]}">${s.meta.short}</b><span>${mode==='impulse'?pct(q.v):q.v.toFixed(1)}</span></div>`);
    }
    tooltip.innerHTML=`<div class="td">${d}</div>${rows.join('')}`;
    tooltip.hidden=false;
    const shell=tooltip.parentElement.getBoundingClientRect();
    let left=e.clientX-shell.left+14, top=e.clientY-shell.top+10;
    if(left+190>shell.width) left-=205;
    tooltip.style.left=`${left}px`; tooltip.style.top=`${Math.max(8,top)}px`;
  };
  svg.onpointerleave=()=>{tooltip.hidden=true;dateLabel.textContent='Move across chart for values'};
}

document.addEventListener('click',e=>{
  const bank=e.target.closest('[data-bank]');
  if(bank){
    const slug=bank.dataset.bank;
    if(visible.has(slug) && visible.size>1) visible.delete(slug); else visible.add(slug);
    renderInstitutions(); draw(); return;
  }
  const m=e.target.closest('[data-mode]');
  if(m){
    mode=m.dataset.mode;
    document.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('active',x===m));
    draw(); return;
  }
  const p=e.target.closest('[data-years]');
  if(p){
    years=+p.dataset.years;
    document.querySelectorAll('[data-years]').forEach(x=>x.classList.toggle('active',x===p));
    renderInstitutions(); draw();
  }
});

load().catch(err=>{
  console.error(err);
  $('#syncState').textContent='database load failed';
  $('#lastSync').textContent=err.message;
  $('#emptyState').hidden=false;
  $('#emptyState').innerHTML='<strong>Database file could not be loaded.</strong><span>This build uses repository-relative data paths. Check the JSON file and GitHub Pages deployment.</span>';
});