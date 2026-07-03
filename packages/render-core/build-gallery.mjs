// Build the LAUNCH gallery — a single static, shareable HTML page of real engine
// output: a curated chart-type showcase + the flagship dashboards. No JS, no bundle;
// each SVG is rendered here and inlined, and every card carries its copy-pasteable
// render_chart spec ("see it in the MCP" = paste the spec). Also writes hero PNGs.
//   node build-gallery.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderSpec, TYPES } from './render-core.mjs';
import { EXAMPLES, GALLERY_BOARDS, boardSpec } from './examples.mjs';
import { FLAT_PALETTES, NESTED_THEMES } from '../palette-core/palette-core.mjs';
import { svgToPng } from '../raster/raster.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, 'gallery-assets');
mkdirSync(assets, { recursive: true });

// ── curated chart-type showcase (family coverage, launch-quality data) ──────────
const CHARTS = [
  ['Bar', { type:'bar', title:'Revenue by quarter', data:{ labels:['Q1','Q2','Q3','Q4'], series:[{ name:'Revenue', values:[420,510,480,620] }] } }],
  ['Grouped', { type:'grouped', title:'Sales by region', data:{ labels:['North','South','East','West'], series:[{ name:'2024', values:[42,31,53,28] },{ name:'2025', values:[51,29,60,34] }] } }],
  ['Line', { type:'line', title:'Monthly active users', data:{ labels:['Jan','Feb','Mar','Apr','May','Jun'], series:[{ name:'Product A', values:[120,190,170,250,230,310] },{ name:'Product B', values:[80,110,160,140,210,260] }] } }],
  ['Area', { type:'area', title:'Website traffic', data:{ labels:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], series:[{ name:'Sessions', values:[3.2,4.1,3.8,5.0,4.6,2.1,1.9] }] } }],
  ['Donut', { type:'donut', title:'Market share', valuePrefix:'', data:{ labels:['Us','Rival A','Rival B','Other'], series:[{ values:[38,27,20,15] }] } }],
  ['100% stacked', { type:'stacked100', title:'Plan mix by month', data:{ labels:['Jan','Feb','Mar','Apr'], series:[{ name:'Free', values:[60,55,50,44] },{ name:'Pro', values:[30,33,36,40] },{ name:'Enterprise', values:[10,12,14,16] }] } }],
  ['Waterfall', { type:'waterfall', title:'Cash flow', start:120, steps:[{ label:'Sales', value:80 },{ label:'Refunds', value:-18 },{ label:'Costs', value:-42 },{ label:'Other', value:12 }] }],
  ['Funnel', { type:'funnel', title:'Signup funnel', stages:[{ label:'Visitors', value:12000 },{ label:'Signups', value:4200 },{ label:'Trials', value:1800 },{ label:'Paid', value:640 }] }],
  ['Gauge', { type:'gauge', title:'Capacity used', label:'of 500 GB', value:372, min:0, max:500, valueUnit:'GB' }],
  ['Heatmap', { type:'heatmap', title:'Active users by day & time', rows:['Mon','Tue','Wed','Thu','Fri'], columns:['9a','12p','3p','6p','9p'], values:[[2,5,8,3,1],[1,4,9,6,2],[0,3,7,8,4],[2,6,9,7,3],[3,7,6,4,5]] }],
  ['Quadrant', { type:'quadrant', title:'Roadmap prioritization', xAxis:'Effort', yAxis:'Impact', items:[{ label:'Quick win', x:0.2, y:0.82 },{ label:'Big bet', x:0.78, y:0.9 },{ label:'Fill-in', x:0.25, y:0.25 },{ label:'Time sink', x:0.8, y:0.2 }] }],
  ['Gantt', { type:'gantt', title:'Launch roadmap', tasks:[{ label:'Design', start:0, end:3 },{ label:'Build', start:2, end:7 },{ label:'Beta', start:6, end:9 },{ label:'Launch', start:9, end:10 }] }],
  ['Calendar', { type:'calendar', title:'Commits in 2025', year:2025, days:{ '2025-01-06':2,'2025-01-21':5,'2025-02-03':8,'2025-02-18':3,'2025-03-11':6,'2025-04-02':9,'2025-04-22':4,'2025-05-15':7,'2025-06-09':2,'2025-07-21':10,'2025-08-04':5,'2025-09-17':6,'2025-10-01':8,'2025-11-12':3,'2025-12-05':7 } }],
  ['Leaderboard', { type:'leaderboard', title:'Top reps this quarter', items:[{ label:'Dana', value:412 },{ label:'Priya', value:388 },{ label:'Marco', value:351 },{ label:'Sam', value:290 },{ label:'Lee', value:244 }] }],
  ['Bullet', { type:'bullet', title:'Performance vs target', bars:[{ label:'Revenue', value:275, target:250, max:300, bands:[150,225] },{ label:'Profit', value:82, target:100, max:120, bands:[60,90] },{ label:'New customers', value:134, target:120, max:160, bands:[80,120] }] }],
];

// ── flagship dashboards (each = ONE render_chart call → ONE image) ──────────────
const kpi = (label, value, o={}) => ({ chart:{ type:'kpi', label, value, ...o } });
const DASHBOARDS = [
  ['SaaS — monthly business review', { type:'dashboard', title:'Acme — Monthly Business Review', palette:'Clean Corporate', layout:{ cols:3, tileHeight:250 }, tiles:[
    kpi('Monthly Recurring Revenue', 128400, { valuePrefix:'$', delta:12.4 }),
    kpi('Active Users', 8640, { delta:8.1 }),
    kpi('Churn', 2.3, { valueUnit:'%', delta:-0.4, deltaUnit:'pt', deltaGoodWhen:'down' }),
    { span:[2,1], chart:{ type:'line', title:'Monthly active users', data:{ labels:['Jan','Feb','Mar','Apr','May','Jun'], series:[{ name:'Product A', values:[120,190,170,250,230,310] },{ name:'Product B', values:[80,110,160,140,210,260] }] } } },
    { chart:{ type:'gauge', title:'Net revenue retention', value:112, min:0, max:150, valueUnit:'%' } },
    { chart:{ type:'funnel', title:'Signup funnel', stages:[{ label:'Visitors', value:12000 },{ label:'Signups', value:4200 },{ label:'Trials', value:1800 },{ label:'Paid', value:640 }] } },
    { chart:{ type:'waffle', title:'Revenue by segment', parts:[{ label:'Enterprise', value:45 },{ label:'SMB', value:30 },{ label:'Other', value:15 }] } },
    { chart:{ type:'bar', title:'Deals by stage', data:{ labels:['Lead','Demo','Won'], series:[{ name:'Deals', values:[42,24,11] }] } } },
  ] }],
  ['Sales — pipeline', { type:'dashboard', title:'Sales Pipeline — Q2', palette:'Vibrant', layout:{ cols:3, tileHeight:250 }, tiles:[
    kpi('Pipeline', 2.4, { valuePrefix:'$', valueUnit:'M', delta:9 }),
    kpi('Win rate', 28, { valueUnit:'%', delta:3, deltaUnit:'pt' }),
    kpi('Avg deal size', 18, { valuePrefix:'$', valueUnit:'k', delta:-4 }),
    { span:[1,2], chart:{ type:'funnel', title:'Pipeline stages', stages:[{ label:'Lead', value:900 },{ label:'Qualified', value:520 },{ label:'Demo', value:300 },{ label:'Proposal', value:160 },{ label:'Won', value:64 }] } },
    { span:[2,1], chart:{ type:'bar', title:'Bookings by rep', data:{ labels:['Dana','Priya','Marco','Sam','Lee'], series:[{ name:'Bookings ($k)', values:[412,388,351,290,244] }] } } },
    { span:[2,1], chart:{ type:'leaderboard', title:'Top reps', items:[{ label:'Dana', value:412 },{ label:'Priya', value:388 },{ label:'Marco', value:351 }] } },
  ] }],
  ['Marketing — performance', { type:'dashboard', title:'Marketing Performance', palette:'Clean Corporate', layout:{ cols:3, tileHeight:250 }, tiles:[
    kpi('Sessions', 84200, { delta:11 }),
    kpi('Signups', 3210, { delta:6 }),
    kpi('CAC', 42, { valuePrefix:'$', delta:-8, deltaGoodWhen:'down' }),
    { span:[2,1], chart:{ type:'area', title:'Traffic over time', data:{ labels:['W1','W2','W3','W4','W5','W6'], series:[{ name:'Sessions (k)', values:[10,13,12,16,18,21] }] } } },
    { chart:{ type:'waffle', title:'Channel mix', parts:[{ label:'Organic', value:44 },{ label:'Paid', value:31 },{ label:'Referral', value:15 }] } },
    { chart:{ type:'funnel', title:'Acquisition', stages:[{ label:'Reach', value:50000 },{ label:'Click', value:9000 },{ label:'Signup', value:3210 }] } },
    { span:[2,1], chart:{ type:'bar', title:'Campaign ROI', data:{ labels:['Search','Social','Email','Events'], series:[{ name:'ROI (x)', values:[4.2,2.8,6.1,1.9] }] } } },
  ] }],
  ['Ops — service health', { type:'dashboard', title:'Service Health', palette:'Clean Corporate', layout:{ cols:3, tileHeight:240 }, tiles:[
    kpi('Uptime (30d)', 99.98, { valueUnit:'%' }),
    kpi('p95 latency', 240, { valueUnit:'ms', delta:-12, deltaGoodWhen:'down' }),
    kpi('Error rate', 0.03, { valueUnit:'%', delta:-0.01, deltaGoodWhen:'down' }),
    { span:[2,1], chart:{ type:'heatmap', title:'Incidents by day & hour', rows:['Mon','Tue','Wed','Thu','Fri'], columns:['00','06','12','18'], values:[[0,1,2,0],[0,0,3,1],[1,0,1,2],[0,2,1,0],[0,0,2,1]] } },
    { chart:{ type:'gauge', title:'Capacity', value:68, min:0, max:100, valueUnit:'%' } },
    { span:[3,1], chart:{ type:'progress', title:'SLO attainment', bars:[{ label:'API availability', value:99.95, valueUnit:'%' },{ label:'DB latency SLO', value:92, target:100 },{ label:'Job success', value:99.2, valueUnit:'%' }] } },
  ] }],
  ['Product — analytics', { type:'dashboard', title:'Product Analytics', palette:'Vibrant', layout:{ cols:3, tileHeight:250 }, tiles:[
    kpi('DAU', 12400, { delta:5 }),
    kpi('D30 retention', 44, { valueUnit:'%', delta:2, deltaUnit:'pt' }),
    kpi('Feature adoption', 61, { valueUnit:'%', delta:9, deltaUnit:'pt' }),
    { span:[2,1], chart:{ type:'line', title:'Retention curve', data:{ labels:['D1','D7','D14','D30','D60','D90'], series:[{ name:'Cohort', values:[100,62,51,44,39,36] }] } } },
    { chart:{ type:'iconarray', title:'Teams onboarded (7/10)', total:10, filled:7 } },
    { chart:{ type:'funnel', title:'Activation', stages:[{ label:'Installed', value:5000 },{ label:'Activated', value:2600 },{ label:'Habit', value:1400 }] } },
    { span:[2,1], chart:{ type:'quadrant', title:'Feature prioritization', xAxis:'Effort', yAxis:'Impact', items:[{ label:'Search', x:0.3, y:0.8 },{ label:'Mobile', x:0.75, y:0.85 },{ label:'Theming', x:0.2, y:0.3 },{ label:'Rewrite', x:0.85, y:0.25 }] } },
  ] }],
  ['Cyberpunk — grid ops (dark)', { type:'dashboard', title:'GRID OPS — LIVE', palette:'Cyberpunk', background:'#0b1020', layout:{ cols:3, tileHeight:240 }, tiles:[
    kpi('Throughput', 4820, { valueUnit:'req/s', delta:14 }),
    kpi('Nodes online', 128, { delta:2 }),
    kpi('Error rate', 0.04, { valueUnit:'%', delta:-0.02, deltaGoodWhen:'down' }),
    { span:[2,1], chart:{ type:'line', title:'Traffic (24h)', data:{ labels:['00','04','08','12','16','20'], series:[{ name:'Edge', values:[220,180,340,520,610,430] },{ name:'Core', values:[140,120,260,380,410,300] }] } } },
    { chart:{ type:'gauge', title:'Load', value:73, min:0, max:100, valueUnit:'%' } },
    { chart:{ type:'heatmap', title:'Latency by region & hour', rows:['US','EU','APAC'], columns:['00','06','12','18'], values:[[2,3,6,4],[1,2,5,3],[3,4,7,5]] } },
    { chart:{ type:'waffle', title:'Capacity by tier', parts:[{ label:'Hot', value:52 },{ label:'Warm', value:28 },{ label:'Cold', value:14 }] } },
    { chart:{ type:'funnel', title:'Request pipeline', stages:[{ label:'Ingress', value:10000 },{ label:'Auth', value:8200 },{ label:'Served', value:7900 }] } },
  ] }],
  ['Systems — bridge status (rowspan)', { type:'dashboard', title:'Bridge Systems — Status', palette:'Clean Corporate', layout:{ cols:3, tileHeight:150 }, tiles:[
    { span:[1,3], chart:{ type:'funnel', title:'Power flow', stages:[{ label:'Reactor', value:1000 },{ label:'Distribution', value:820 },{ label:'Shields', value:540 },{ label:'Weapons', value:300 },{ label:'Reserve', value:120 }] } },
    { span:[2,1], chart:{ type:'progress', title:'Subsystem integrity', bars:[{ label:'Hull', value:98, valueUnit:'%' },{ label:'Life support', value:100, valueUnit:'%' },{ label:'Sensors', value:76, valueUnit:'%' }] } },
    { chart:{ type:'gauge', title:'Core temp', value:64, min:0, max:100, valueUnit:'%' } },
    { chart:{ type:'kpi', label:'Crew', value:412 } },
    { span:[2,1], chart:{ type:'checklist', title:'Pre-jump checks', items:[{ label:'Nav lock', status:'done' },{ label:'Coolant', status:'done' },{ label:'Docking clamps', status:'pending' },{ label:'Comms relay', status:'blocked' }] } },
    { chart:{ type:'iconarray', title:'Escape pods (9/12)', total:12, filled:9 } },
  ] }],
];

// ── render everything ───────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
function card(name, spec, wide, badge) {
  const svg = renderSpec(spec);
  const specJson = esc(JSON.stringify(spec, null, 2));
  return `<figure class="card${wide ? ' wide' : ''}">
  <figcaption>${esc(name)}<span class="badge">${esc(badge || spec.type)}</span></figcaption>
  <div class="chart">${svg}</div>
  <details><summary>render_chart spec</summary><pre>${specJson}</pre></details>
</figure>`;
}

const dashCards = DASHBOARDS.map(([n, s]) => card(n, s, true)).join('\n');

// FULL catalog — EVERY registered type (except dashboard, showcased above), grouped by
// structural family. Uses the curated launch-quality spec where we have one, else the
// type's minimal EXAMPLES spec — so the page covers ALL types and the heroes still shine.
const CURATED = Object.fromEntries(CHARTS.map(([, s]) => [s.type, s]));
const FAMILY_LABEL = { comparison:'Comparison', trend:'Trend', composition:'Composition', deviation:'Deviation', change:'Change', 'single-value':'Single value', layout:'Information design / layout' };
const FAMILY_ORDER = ['comparison', 'trend', 'composition', 'deviation', 'change', 'single-value', 'layout'];
const catalogTypes = TYPES.filter((t) => t.type !== 'dashboard');
const fams = [...new Set(catalogTypes.map((t) => t.family))];
const orderedFams = [...FAMILY_ORDER.filter((f) => fams.includes(f)), ...fams.filter((f) => !FAMILY_ORDER.includes(f))];
const familySections = orderedFams.map((fam) => {
  const ts = catalogTypes.filter((t) => t.family === fam);
  const cards = ts.map((t) => card(t.type, CURATED[t.type] || EXAMPLES[t.type], false, t.family)).join('\n');
  return `<h2>${esc(FAMILY_LABEL[fam] || fam)} <span class="count">${ts.length}</span></h2>\n<div class="grid">\n${cards}\n</div>`;
}).join('\n');
const totalCatalog = catalogTypes.length;

// Palette showcase — every flat palette on a bar, every nested theme on a pie-of-pie,
// so the (otherwise name-only) color sets are actually VISIBLE on the page.
const flatPaletteCards = FLAT_PALETTES.map((p) =>
  card(p.name, { type: 'bar', title: p.name, palette: p.name, watermark: false, data: { labels: ['A', 'B', 'C', 'D', 'E'], series: [{ values: [8, 6, 9, 5, 7] }] } }, false, 'flat')
).join('\n');
const nestedPaletteCards = NESTED_THEMES.map((t) =>
  card(t.name, { type: 'pieofpie', palette: t.name, watermark: false, pies: [
    { title: '', labels: ['A', 'B', 'C'], values: [60, 30, 10] },
    { title: '', labels: ['X', 'Y', 'Z'], values: [35, 15, 10] },
    { title: '', labels: ['P', 'Q', 'R'], values: [18, 12, 5] },
  ] }, false, t.dark ? 'nested · dark' : 'nested')
).join('\n');
const totalPalettes = FLAT_PALETTES.length + NESTED_THEMES.length;

// Family boards — every type grouped into tiled dashboards (the "show everything" view).
const boardCards = GALLERY_BOARDS.map((b) => card(b.title, boardSpec(b), true, 'board')).join('\n');

// hero PNGs for the dashboards + family boards (launch images)
for (const [n, s] of DASHBOARDS) writeFileSync(join(assets, slug(n) + '.png'), svgToPng(renderSpec(s), { scale: 2 }));
for (const b of GALLERY_BOARDS) writeFileSync(join(assets, 'board-' + b.id + '.png'), svgToPng(renderSpec(boardSpec(b)), { scale: 2 }));

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SlickFast — chart & dashboard gallery</title>
<style>
  :root{ --bg:#f8fafc; --card:#fff; --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; --accent:#2563eb; }
  *{ box-sizing:border-box }
  body{ margin:0; background:var(--bg); color:var(--ink); font:16px/1.5 Inter,system-ui,-apple-system,sans-serif; }
  header{ max-width:1200px; margin:0 auto; padding:56px 24px 8px; }
  h1{ font-size:34px; margin:0 0 8px; letter-spacing:-.02em; }
  .tag{ font-size:18px; color:var(--muted); margin:0; max-width:720px; }
  .pills{ margin:18px 0 0; display:flex; gap:8px; flex-wrap:wrap; }
  .pill{ font-size:13px; color:var(--accent); background:#eff6ff; border:1px solid #dbeafe; border-radius:999px; padding:5px 12px; }
  h2{ max-width:1200px; margin:48px auto 4px; padding:0 24px; font-size:22px; }
  .count{ font-size:13px; font-weight:500; color:var(--accent); background:#eff6ff; border:1px solid #dbeafe; border-radius:999px; padding:1px 10px; vertical-align:middle; }
  .sub{ max-width:1200px; margin:0 auto 20px; padding:0 24px; color:var(--muted); }
  .grid{ max-width:1200px; margin:0 auto; padding:0 24px 24px; display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:20px; }
  .grid.dash{ grid-template-columns:1fr; }
  .card{ margin:0; background:var(--card); border:1px solid var(--line); border-radius:16px; padding:16px; overflow:hidden; }
  figcaption{ font-weight:600; font-size:15px; margin-bottom:10px; display:flex; align-items:center; gap:10px; }
  .badge{ font-weight:500; font-size:11px; color:var(--muted); background:var(--bg); border:1px solid var(--line); border-radius:6px; padding:2px 8px; font-family:ui-monospace,monospace; }
  .chart svg{ width:100%; height:auto; display:block; border-radius:8px; }
  details{ margin-top:12px; }
  summary{ cursor:pointer; font-size:13px; color:var(--muted); }
  pre{ background:#0f172a; color:#e2e8f0; border-radius:10px; padding:14px; overflow:auto; font-size:12px; line-height:1.45; margin:10px 0 0; }
  footer{ max-width:1200px; margin:0 auto; padding:24px; color:var(--muted); font-size:13px; }
</style></head><body>
<header>
  <h1>SlickFast — chart &amp; dashboard gallery</h1>
  <p class="tag">Arbitrary multi-type composition in one deterministic render. Every image below is a single <code>render_chart</code> call — the spec is under each one, paste-ready for the MCP.</p>
  <div class="pills"><span class="pill">47 chart types</span><span class="pill">${totalPalettes} palettes</span><span class="pill">Dashboards: many charts → one image, one render</span><span class="pill">Deterministic — same spec, same chart</span><span class="pill">Local · nothing leaves the machine</span></div>
</header>
<h2>Dashboards</h2>
<p class="sub">One call tiles many charts into a single PNG — no per-chart loop, no stitching. Each tile is a full spec of any type; <code>span</code> makes a tile wider or taller.</p>
<div class="grid dash">
${dashCards}
</div>
<h2>Family boards <span class="count">${GALLERY_BOARDS.length}</span></h2>
<p class="sub">Every chart type, grouped into ${GALLERY_BOARDS.length} tiled boards — each is a single <code>dashboard</code> render. The gallery tool serves these too: <em>"show me the comparison board"</em>.</p>
<div class="grid dash">
${boardCards}
</div>
<h2>All chart types</h2>
<p class="sub">Every one of the ${totalCatalog} standalone types (the dashboards above compose them), grouped by family. Curated where we have a showcase spec, otherwise the type's minimal example — all real engine output.</p>
${familySections}
<h2>Palettes <span class="count">${totalPalettes}</span></h2>
<p class="sub">Set any with <code>"palette": "Name"</code>. Flat palettes (shown on a bar) suit any chart; nested themes (shown as a pie-of-pie drill-down) are tuned for pieofpie but work anywhere.</p>
<div class="grid">
${flatPaletteCards}
${nestedPaletteCards}
</div>
<footer>Rendered by SlickFast render-core · slickfast.com</footer>
</body></html>`;

writeFileSync(join(here, 'launch-gallery.html'), html);
console.log(`launch-gallery.html: ${totalCatalog} chart types + ${DASHBOARDS.length} dashboards + ${GALLERY_BOARDS.length} family boards + ${totalPalettes} palettes, ${(html.length/1024|0)}KB`);
console.log(`hero PNGs -> gallery-assets/ (${DASHBOARDS.length} dashboards + ${GALLERY_BOARDS.length} boards)`);
