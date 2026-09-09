let REG=null, DB=null, currentYears=5;
const $=s=>document.querySelector(s);
const fmt=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:1}).format(n);
const colors=['#55ef8b','#dce8e1','#8fc8a5','#628978','#b4c6bb'];

async function load(){
  // Relative paths are required for GitHub Pages project sites:
  // https://user.github.io/repository/  -> ./data/... (NOT /data/...)
  const [regRes,dbRes]=await Promise.all([
    fetch('./data/central-bank-balance-sheet-sources.json',{cache:'no-store'}),
    fetch('./data/central-bank-balance-sheets.json',{cache:'no-store'})
  ]);
  if(!regRes.ok) throw new Error(`source registry HTTP ${regRes.status}`);
  if(!dbRes.ok) throw new Error(`database HTTP ${dbRes.status}`);
  REG=await regRes.json(); DB=await dbRes.json();
  render();
}

function render(){
  const banks=REG.banks||[];
  const dbBanks=DB.banks||{};
  $('#syncState').textContent=DB.status==='ok'?'source sync current':DB.status==='partial'?'partial source sync':'source sync needs attention';
  $('#lastSync').textContent=DB.generatedAt?new Date(DB.generatedAt).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'not yet generated';

  $('#tabs').innerHTML=banks.map(b=>{
    const d=dbBanks[b.slug]||{}, ok=d.sourceStatus==='ok' && d.observations?.length;
    return `<a class="bank-tab ${ok?'ok':''}" href="${b.official}" target="_blank" rel="noopener">
      <span class="health-dot"></span><strong>${b.short}</strong><small>${d.lastUpdated?'through '+d.lastUpdated:b.currency+' · '+b.frequency}</small>
    </a>`;
  }).join('');

  $('#ledger').innerHTML=banks.map(b=>{
    const d=dbBanks[b.slug]||{}, o=d.observations||[], last=o.at(-1);
    return `<a class="record-row" href="${b.official}" target="_blank" rel="noopener">
      <div class="bank-name"><strong>${b.name}</strong><small>${b.jurisdiction}</small></div>
      <div class="series-meta"><code>${d.series||b.series}</code><small>${b.unit}</small></div>
      <div class="latest-value">${last?fmt(last.value)+' '+b.currency:'—'}</div>
      <div class="status-pill ${d.sourceStatus==='ok'?'ok':''}">${d.sourceStatus||'no sync'}</div>
      <div class="go">↗</div>
    </a>`;
  }).join('');

  draw(currentYears);
}

function draw(years){
  currentYears=years;
  const svg=$('#chart'), empty=$('#emptyState');
  const all=Object.values(DB?.banks||{}).filter(b=>b.observations?.length);
  const now=new Date();
  const cutoff=years?`${now.getUTCFullYear()-years}-${String(now.getUTCMonth()+1).padStart(2,'0')}`:'0000-00';
  const series=all.map((b,i)=>{
    const o=b.observations.filter(x=>x.date>=cutoff && Number.isFinite(Number(x.value)));
    if(!o.length) return null;
    const base=Number(o[0].value);
    return {name:b.short,i,latestDate:o.at(-1).date,pts:o.map(x=>({d:x.date,v:Number(x.value)/base*100}))};
  }).filter(Boolean);

  if(!series.length){
    svg.innerHTML=''; empty.hidden=false;
    $('#legend').innerHTML=(REG?.banks||[]).map((b,i)=>`<div class="legend-item"><div class="legend-top"><span class="swatch" style="background:${colors[i]}"></span><strong>${b.short}</strong></div><small>no observations</small></div>`).join('');
    return;
  }
  empty.hidden=true;

  const W=1120,H=420,p={l:64,r:26,t:22,b:42};
  const vals=series.flatMap(s=>s.pts.map(x=>x.v));
  let mn=Math.min(...vals), mx=Math.max(...vals);
  const pad=(mx-mn)*.08 || 10; mn-=pad; mx+=pad;
  const dates=series.flatMap(s=>s.pts.map(x=>x.d)).sort();
  const tm=d=>Date.parse(d+'-01T00:00:00Z'),t0=tm(dates[0]),t1=tm(dates.at(-1));
  const x=d=>p.l+(tm(d)-t0)/(t1-t0||1)*(W-p.l-p.r);
  const y=v=>p.t+(mx-v)/(mx-mn||1)*(H-p.t-p.b);

  let h='';
  for(let i=0;i<6;i++){
    const v=mn+(mx-mn)*i/5, yy=y(v);
    h+=`<line x1="${p.l}" x2="${W-p.r}" y1="${yy}" y2="${yy}" stroke="#1d3326" stroke-width="1"/>`;
    h+=`<text x="${p.l-11}" y="${yy+4}" fill="#708278" text-anchor="end" font-size="10">${v.toFixed(0)}</text>`;
  }
  const yearsTicks=[dates[0]];
  for(const d of dates){if(d.slice(5)==='01' && !yearsTicks.includes(d)) yearsTicks.push(d)}
  yearsTicks.push(dates.at(-1));
  for(const d of yearsTicks.filter((_,i,a)=>i===0||i===a.length-1||i%Math.ceil(a.length/6)===0)){
    const xx=x(d);h+=`<line x1="${xx}" x2="${xx}" y1="${p.t}" y2="${H-p.b}" stroke="#10251a" stroke-width="1"/>`;
    h+=`<text x="${xx}" y="${H-13}" fill="#708278" text-anchor="middle" font-size="10">${d.slice(0,4)}</text>`;
  }
  series.forEach((s,i)=>{
    const d=s.pts.map((q,j)=>`${j?'L':'M'}${x(q.d).toFixed(2)},${y(q.v).toFixed(2)}`).join(' ');
    h+=`<path d="${d}" fill="none" stroke="${colors[i%colors.length]}" stroke-width="${i===0?2.4:1.7}" vector-effect="non-scaling-stroke"/>`;
    const q=s.pts.at(-1);h+=`<circle cx="${x(q.d)}" cy="${y(q.v)}" r="3" fill="${colors[i%colors.length]}"/>`;
  });
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`); svg.innerHTML=h;

  $('#legend').innerHTML=series.map((s,i)=>{
    const idx=s.pts.at(-1).v;
    return `<div class="legend-item"><div class="legend-top"><span class="swatch" style="background:${colors[i]}"></span><strong>${s.name}</strong></div><small>latest index <span class="index">${idx.toFixed(1)}</span> · ${s.latestDate}</small></div>`;
  }).join('');
}

document.addEventListener('click',e=>{
  const b=e.target.closest('[data-years]'); if(!b)return;
  document.querySelectorAll('[data-years]').forEach(x=>x.classList.remove('active'));
  b.classList.add('active'); draw(+b.dataset.years);
});

load().catch(err=>{
  console.error(err);
  $('#syncState').textContent='database load failed';
  $('#lastSync').textContent=err.message;
  $('#emptyState').hidden=false;
  $('#emptyState').innerHTML='<strong>Database file could not be loaded.</strong><span>GitHub Pages must load data via relative ./data/ paths. This build includes that fix.</span>';
});