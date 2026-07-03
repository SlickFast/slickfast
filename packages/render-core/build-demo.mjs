// Build a SINGLE self-contained, double-clickable demo of the new types.
//
//   node build-demo.mjs <path-to-RC-iife-bundle.js>
//
// The engine is bundled (esbuild IIFE, global `RC`) and INLINED into the HTML, so the
// page calls RC.renderSpec() live — no ES-module import, no HTTP server, no python.
// Just open new-types-demo.html in a browser. Palette / background / watermark toggle
// re-render in place. Re-run this script after engine changes to refresh the bundle.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const bundlePath = process.argv[2];
if (!bundlePath) { console.error('usage: node build-demo.mjs <rc-iife-bundle.js>'); process.exit(1); }
const bundle = readFileSync(bundlePath, 'utf8');

// The 14 new Information-design/layout types (one canonical sample each) + edge variants.
const SPECS = [
  { type:'cards', title:'This month', cards:[
    {label:'MRR',value:128400,valuePrefix:'$',delta:12.4},{label:'Active users',value:8210,delta:3.1},
    {label:'Churn',value:2.4,valueUnit:'%',delta:0.6,deltaGoodWhen:'down'},{label:'NPS',value:61,delta:-2}] },
  { type:'layers', title:'Our stack', layers:[
    {title:'Application',subtitle:'React + TypeScript'},{title:'API',subtitle:'Node + Hono'},
    {title:'Engine',subtitle:'render-core (pure SVG)'},{title:'Infra',subtitle:'Railway + Docker'}] },
  { type:'progress', title:'Quarter to date', bars:[
    {label:'Q1 revenue',value:82,target:100},{label:'Signups',value:1240,target:2000},
    {label:'Uptime',value:99.2,valueUnit:'%'},{label:'Onboarding',value:47,target:60}] },
  { type:'waffle', title:'Revenue by segment', parts:[
    {label:'Enterprise',value:45},{label:'SMB',value:30},{label:'Other',value:15}] },
  { type:'heatmap', title:'Active users by day & time', rows:['Mon','Tue','Wed','Thu','Fri'],
    columns:['9a','12p','3p','6p','9p'], values:[[2,5,8,3,1],[1,4,9,6,2],[0,3,7,8,4],[2,6,9,7,3],[3,7,6,4,5]] },
  { type:'funnel', title:'Signup funnel', stages:[
    {label:'Visitors',value:12000},{label:'Signups',value:4200},{label:'Trials',value:1800},{label:'Paid',value:640}] },
  { type:'pyramid', title:'Operating model', levels:[
    {title:'Vision'},{title:'Strategy'},{title:'Execution'},{title:'Operations'}] },
  { type:'quadrant', title:'Roadmap prioritization', xAxis:'Effort', yAxis:'Impact', items:[
    {label:'Quick win',x:0.2,y:0.82},{label:'Big bet',x:0.78,y:0.9},{label:'Fill-in',x:0.25,y:0.25},{label:'Time sink',x:0.8,y:0.2}] },
  { type:'timeline', title:'Company milestones', events:[
    {date:'Q1',label:'Launch'},{date:'Q2',label:'Series A'},{date:'Q3',label:'100k users'},{date:'Q4',label:'Profitable'}] },
  { type:'venn', title:'Team overlap', sets:[{label:'Design',value:120},{label:'Engineering',value:160}], overlap:40 },
  { type:'matrix', title:'Plans', columns:['Free','Pro','Enterprise'], rows:[
    {label:'SSO / SAML',cells:[false,false,true]},{label:'API access',cells:[false,true,true]},
    {label:'Priority support',cells:[false,'partial',true]},{label:'Audit log',cells:[false,false,true]},
    {label:'Seats',cells:['1','10','Unlimited']}] },
  { type:'checklist', title:'Launch checklist', items:[
    {label:'Domain transferred',status:'done'},{label:'API deployed',status:'done'},
    {label:'Load testing',status:'partial'},{label:'Billing live',status:'pending'},{label:'SOC 2 audit',status:'blocked'}] },
  { type:'iconarray', title:'Teams onboarded (7 / 10)', total:10, filled:7 },
  { type:'steps', title:'How it works', steps:[
    {label:'Sign up',description:'free, no card'},{label:'Connect data',description:'paste or upload'},
    {label:'Build chart',description:'pick a type'},{label:'Share',description:'link or embed'}] },
  // edge-case variants
  { type:'venn', title:'venn — 3 sets', sets:[{label:'SEO',value:90},{label:'Ads',value:70},{label:'Referral',value:50}] },
  { type:'waffle', title:'waffle — single % gauge', parts:[{label:'Complete',value:64}] },
  { type:'iconarray', title:'iconarray — wrap (24)', total:24, filled:17, perRow:12 },
  { type:'quadrant', title:'quadrant — edge labels', xAxis:'Reach', yAxis:'Ease',
    items:[{label:'Far right item',x:0.95,y:0.6},{label:'Low corner',x:0.05,y:0.05}] },
  // chunk 7 — extra additive types
  { type:'table', title:'Revenue by region', columns:['Region','Q1','Q2','Q3'], rows:[
    ['North',420,510,480],['South',310,290,350],['East',530,560,600],['West',280,340,390]] },
  { type:'gauge', title:'Capacity used', label:'of 500 GB', value:372, min:0, max:500, valueUnit:'GB' },
  { type:'bullet', title:'Performance vs target', bars:[
    {label:'Revenue',value:275,target:250,max:300,bands:[150,225]},
    {label:'Profit',value:82,target:100,max:120,bands:[60,90]},
    {label:'New customers',value:134,target:120,max:160,bands:[80,120]}] },
  { type:'calendar', title:'Commits in 2025', year:2025, days:{
    '2025-01-06':2,'2025-01-21':5,'2025-02-03':8,'2025-02-18':3,'2025-03-11':6,'2025-04-02':9,
    '2025-04-22':4,'2025-05-15':7,'2025-06-09':2,'2025-07-21':10,'2025-08-04':5,'2025-09-17':6,
    '2025-10-08':3,'2025-11-19':8,'2025-12-02':4,'2025-12-23':9} },
  { type:'leaderboard', title:'Top regions by revenue', valueUnit:'k', items:[
    {label:'North',value:530},{label:'South',value:480},{label:'East',value:610},
    {label:'West',value:390},{label:'Central',value:450}] },
  // R1/R2 additive batch
  { type:'callout', title:'Performance', value:3.4, valueUnit:'×', caption:'faster than last quarter', note:'vs Q1' },
  { type:'ring', title:'Quarter goal', value:70, target:100, label:'of $1M target' },
  { type:'versus', title:'Plan A vs Plan B', sides:[
    {title:'Starter', items:[{label:'Price /mo',value:9},{label:'Seats',value:3},{label:'API calls',value:1000}]},
    {title:'Pro', items:[{label:'Price /mo',value:29},{label:'Seats',value:10},{label:'API calls',value:50000}]}] },
  { type:'gantt', title:'Launch plan', tasks:[
    {label:'Design',start:0,end:3},{label:'Build',start:2,end:7},{label:'QA',start:6,end:9},{label:'Launch',start:9,end:10}] },
  { type:'waterfall', title:'Revenue bridge', start:0, steps:[
    {label:'New',value:120},{label:'Expansion',value:60},{label:'Churn',value:-40},{label:'Contraction',value:-15}] },
  { type:'swimlane', title:'Roadmap', phases:['Q1','Q2','Q3'], lanes:[
    {label:'Engine', items:[{phase:0,label:'Types'},{phase:2,label:'Tiling'}]},
    {label:'Surfaces', items:[{phase:1,label:'RapidAPI'}]},
    {label:'Sites', items:[{phase:2,label:'Relaunch'}]}] },
  { type:'tierlist', title:'Chart tiers', tiers:[
    {label:'S', items:['Bar','Line','KPI']},{label:'A', items:['Pie','Area','Funnel']},{label:'B', items:['Radar']}] },
  { type:'swot', title:'SlickFast SWOT', cells:[
    {title:'Strengths', items:['Deterministic engine','$0 local MCP','46 types']},
    {title:'Weaknesses', items:['New brand','Docs young']},
    {title:'Opportunities', items:['AI chart demand','RapidAPI funnel']},
    {title:'Threats', items:['Incumbent libraries']}] },
];

const head = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>SlickFast — new types demo</title>
<style>
:root{--bg:#f1f5f9;--card:#fff;--ink:#0f172a;--muted:#64748b;--line:#e2e8f0}
*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--ink)}
header{position:sticky;top:0;z-index:5;background:var(--card);border-bottom:1px solid var(--line);padding:14px 20px;display:flex;gap:18px;align-items:center;flex-wrap:wrap}
header h1{font-size:16px;margin:0 12px 0 0;font-weight:700}
header label{font-size:13px;color:var(--muted);display:flex;gap:6px;align-items:center}
select{font:inherit;font-size:13px;padding:5px 8px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink)}
.note{font-size:12px;color:var(--muted);margin-left:auto}
main{padding:20px;display:grid;gap:18px;grid-template-columns:repeat(auto-fill,minmax(360px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;overflow:hidden}
.card h3{margin:0 0 10px;font-size:13px;font-weight:700}
.card h3 code{background:#eef2ff;color:#3730a3;padding:2px 7px;border-radius:6px;font-size:12px}
.frame{border-radius:10px;overflow:hidden}.frame svg{display:block;width:100%;height:auto}
.err{color:#b91c1c;font-size:12px;white-space:pre-wrap}
</style></head><body>
<header><h1>SlickFast — new types</h1>
<label>Palette <select id="palette"><option>Clean Corporate</option><option>Pastel</option><option>Vibrant</option><option>Monochrome</option><option>Cyberpunk</option><option>Analogous Shift</option></select></label>
<label>Background <select id="bg"><option value="#ffffff">Light</option><option value="#0f172a">Dark</option><option value="transparent">Transparent</option></select></label>
<label><input type="checkbox" id="wm"> watermark</label>
<span class="note" id="count"></span></header>
<main id="grid"></main>
<script>`;

const ui = `
var SPECS = ${JSON.stringify(SPECS)};
var grid=document.getElementById('grid'),P=document.getElementById('palette'),B=document.getElementById('bg'),W=document.getElementById('wm');
document.getElementById('count').textContent = RC.TYPES.length+' engine types · '+SPECS.length+' samples';
function card(s){
  var m=Object.assign({},s,{palette:P.value,background:B.value,watermark:W.checked});
  var el=document.createElement('div');el.className='card';
  var h=document.createElement('h3');h.innerHTML=(s.title?s.title+' — ':'')+'<code>'+s.type+'</code>';el.appendChild(h);
  var f=document.createElement('div');f.className='frame';f.style.background=(B.value==='transparent'?'#ffffff':B.value);
  try{f.innerHTML=RC.renderSpec(m);}catch(e){f.innerHTML='<div class="err">'+(e&&e.message||e)+'</div>';}
  el.appendChild(f);return el;
}
function all(){grid.innerHTML='';SPECS.forEach(function(s){grid.appendChild(card(s));});}
[P,B,W].forEach(function(c){c.addEventListener('change',all);});all();
`;

const tail = `</script></body></html>`;

// Concatenate (NOT template-interpolate the bundle — it can contain backticks/${}).
const html = head + bundle + '\n' + ui + tail;
writeFileSync(join(here, 'new-types-demo.html'), html);
console.log('wrote new-types-demo.html (' + html.length + ' bytes, engine bundled inline)');
