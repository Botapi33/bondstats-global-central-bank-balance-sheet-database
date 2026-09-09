const S='/data/';
let REG,DB;
const $=s=>document.querySelector(s);
async function init(){
 [REG,DB]=await Promise.all([fetch(S+'central-bank-balance-sheet-sources.json').then(r=>r.json()),fetch(S+'central-bank-balance-sheets.json',{cache:'no-store'}).then(r=>r.json())]);
 $('#tabs').innerHTML=REG.banks.map(b=>`<a class="bank-tab" href="${b.official}" target="_blank" rel="noopener"><strong>${b.short}</strong><small>${b.currency} · ${b.frequency}</small></a>`).join('');
 $('#ledger').innerHTML=REG.banks.map(b=>`<a class="row" href="${b.official}" target="_blank" rel="noopener"><div class="code">${b.short}</div><div><strong>${b.name}</strong><div class="meta">${b.jurisdiction}</div></div><div class="meta">${b.series}<br>${b.unit}</div><div class="go">Source ↗</div></a>`).join('');
 $('#legend').innerHTML=REG.banks.map(b=>`<span>${b.short}</span>`).join('');
 draw(5);
}
function draw(years){
 const svg=$('#chart'), all=Object.values(DB.banks||{}).filter(b=>b.observations?.length), now=new Date(),cut=years?`${now.getUTCFullYear()-years}-${String(now.getUTCMonth()+1).padStart(2,'0')}`:'0000-00';
 const ss=all.map((b,i)=>{const o=b.observations.filter(x=>x.date>=cut);return o.length?{i,o:o.map(x=>({d:x.date,v:x.value/o[0].value*100}))}:null}).filter(Boolean);
 const vals=ss.flatMap(s=>s.o.map(x=>x.v)); if(!vals.length){svg.innerHTML='<text x="50%" y="50%" fill="#8fa098" text-anchor="middle">Run the GitHub Action once to load official-source data</text>';return}
 const W=1000,H=390,p={l:58,r:18,t:18,b:38},mn=Math.min(...vals),mx=Math.max(...vals),dates=ss.flatMap(s=>s.o.map(x=>x.d)).sort(),tm=d=>Date.parse(d+'-01T00:00:00Z'),t0=tm(dates[0]),t1=tm(dates.at(-1));
 const x=d=>p.l+(tm(d)-t0)/(t1-t0||1)*(W-p.l-p.r),y=v=>p.t+(mx-v)/(mx-mn||1)*(H-p.t-p.b);let h='';
 for(let i=0;i<5;i++){const v=mn+(mx-mn)*i/4,yy=y(v);h+=`<line x1="${p.l}" x2="${W-p.r}" y1="${yy}" y2="${yy}" stroke="#21352a"/><text x="${p.l-10}" y="${yy+4}" fill="#708079" text-anchor="end" font-size="11">${v.toFixed(0)}</text>`}
 ss.forEach((s,i)=>{h+=`<path d="${s.o.map((q,j)=>`${j?'L':'M'}${x(q.d)},${y(q.v)}`).join(' ')}" fill="none" stroke="#56ef8a" stroke-opacity="${1-i*.14}" stroke-width="${i?1.6:2.6}"/>`});
 svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.innerHTML=h;
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-years]');if(!b)return;document.querySelectorAll('[data-years]').forEach(x=>x.classList.remove('active'));b.classList.add('active');draw(+b.dataset.years)});
init();
