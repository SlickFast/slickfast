// EXAMPLES — one MINIMAL valid spec per type. The single source for "show me a
// working spec for type X", consumed by the MCP `describe_type` tool so an agent can
// learn any type's data shape without trial-and-error. Every TYPES entry must have an
// example here (enforced by scripts/check-surfaces.mjs).

export const EXAMPLES = {
  bar: { type: 'bar', data: { labels: ['A', 'B', 'C'], series: [{ values: [10, 20, 15] }] } },
  grouped: { type: 'grouped', data: { labels: ['Q1', 'Q2'], series: [{ name: '2023', values: [42, 55] }, { name: '2024', values: [52, 48] }] } },
  stacked: { type: 'stacked', data: { labels: ['Q1', 'Q2'], series: [{ name: 'Core', values: [30, 35] }, { name: 'Add-ons', values: [18, 20] }] } },
  stacked100: { type: 'stacked100', data: { labels: ['Q1', 'Q2'], series: [{ name: 'Core', values: [30, 35] }, { name: 'Add-ons', values: [18, 20] }] } },
  stackedh: { type: 'stackedh', data: { labels: ['Eng', 'Sales'], series: [{ name: 'Salaries', values: [120, 90] }, { name: 'Tools', values: [40, 25] }] } },
  horizontal: { type: 'horizontal', data: { labels: ['US', 'India'], series: [{ values: [820, 610] }] } },
  lollipop: { type: 'lollipop', data: { labels: ['A', 'B', 'C'], series: [{ values: [78, 64, 52] }] } },
  diverging: { type: 'diverging', data: { labels: ['A', 'B'], series: [{ name: 'Agree', values: [62, 48] }, { name: 'Disagree', values: [38, 52] }] } },
  line: { type: 'line', data: { labels: ['Jan', 'Feb', 'Mar'], series: [{ name: 'Users', values: [120, 190, 170] }] } },
  smooth: { type: 'smooth', data: { labels: ['Jan', 'Feb', 'Mar'], series: [{ values: [120, 190, 170] }] } },
  area: { type: 'area', data: { labels: ['Jan', 'Feb', 'Mar'], series: [{ values: [120, 190, 170] }] } },
  stepped: { type: 'stepped', data: { labels: ['Jan', 'Feb', 'Mar'], series: [{ values: [120, 190, 170] }] } },
  stackedArea: { type: 'stackedArea', data: { labels: ['Q1', 'Q2'], series: [{ name: 'A', values: [30, 35] }, { name: 'B', values: [18, 20] }] } },
  difference: { type: 'difference', data: { labels: ['Jan', 'Feb', 'Mar'], series: [{ name: 'Plan', values: [50, 60, 70] }, { name: 'Actual', values: [48, 65, 62] }] } },
  slope: { type: 'slope', data: { labels: ['2023', '2024'], series: [{ name: 'A', values: [40, 60] }, { name: 'B', values: [55, 50] }] } },
  pie: { type: 'pie', data: { labels: ['A', 'B', 'C'], series: [{ values: [45, 30, 25] }] } },
  donut: { type: 'donut', data: { labels: ['A', 'B', 'C'], series: [{ values: [45, 30, 25] }] } },
  pieofpie: { type: 'pieofpie', pies: [{ labels: ['Enterprise', 'SMB', 'Other'], values: [60, 30, 10] }, { labels: ['US', 'EU', 'APAC'], values: [35, 15, 10] }] },
  kpi: { type: 'kpi', label: 'MRR', value: 128400, valuePrefix: '$', delta: 12.4 },
  cards: { type: 'cards', cards: [{ label: 'MRR', value: 128400, valuePrefix: '$', delta: 12.4 }, { label: 'Active users', value: 8210, delta: 3.1 }] },
  layers: { type: 'layers', layers: [{ title: 'Application', subtitle: 'React + TypeScript' }, { title: 'API', subtitle: 'Node + Hono' }] },
  progress: { type: 'progress', bars: [{ label: 'Q1 revenue', value: 82, target: 100 }, { label: 'Uptime', value: 99.2, valueUnit: '%' }] },
  waffle: { type: 'waffle', parts: [{ label: 'Enterprise', value: 45 }, { label: 'SMB', value: 30 }, { label: 'Other', value: 15 }] },
  heatmap: { type: 'heatmap', rows: ['Mon', 'Tue'], columns: ['9a', '12p', '3p'], values: [[2, 5, 8], [1, 4, 9]] },
  funnel: { type: 'funnel', stages: [{ label: 'Visitors', value: 12000 }, { label: 'Signups', value: 4200 }, { label: 'Paid', value: 640 }] },
  pyramid: { type: 'pyramid', levels: [{ title: 'Vision' }, { title: 'Strategy' }, { title: 'Execution' }] },
  quadrant: { type: 'quadrant', xAxis: 'Effort', yAxis: 'Impact', items: [{ label: 'Quick win', x: 0.2, y: 0.8 }, { label: 'Big bet', x: 0.8, y: 0.9 }] },
  timeline: { type: 'timeline', events: [{ date: 'Q1', label: 'Launch' }, { date: 'Q2', label: 'Series A' }] },
  venn: { type: 'venn', sets: [{ label: 'Design', value: 120 }, { label: 'Engineering', value: 160 }], overlap: 40 },
  matrix: { type: 'matrix', columns: ['Free', 'Pro'], rows: [{ label: 'SSO', cells: [false, true] }, { label: 'API access', cells: [true, true] }] },
  checklist: { type: 'checklist', items: [{ label: 'Domain transferred', status: 'done' }, { label: 'Billing live', status: 'pending' }] },
  iconarray: { type: 'iconarray', total: 10, filled: 7 },
  steps: { type: 'steps', steps: [{ label: 'Sign up' }, { label: 'Connect data' }, { label: 'Share' }] },
  table: { type: 'table', columns: ['Region', 'Q1', 'Q2'], rows: [['North', 420, 510], ['South', 310, 290]] },
  gauge: { type: 'gauge', label: 'CPU load', value: 72, valueUnit: '%' },
  bullet: { type: 'bullet', bars: [{ label: 'Revenue', value: 275, target: 250, max: 300, bands: [150, 225] }] },
  calendar: { type: 'calendar', year: 2025, days: { '2025-01-06': 3, '2025-07-21': 8 } },
  leaderboard: { type: 'leaderboard', items: [{ label: 'North', value: 530 }, { label: 'East', value: 610 }] },
  callout: { type: 'callout', value: 3.4, valueUnit: '×', caption: 'faster than last quarter', note: 'vs Q1' },
  ring: { type: 'ring', value: 70, target: 100, label: 'Goal completion' },
  versus: { type: 'versus', sides: [{ title: 'Plan A', items: [{ label: 'Price', value: 9 }, { label: 'Seats', value: 3 }] }, { title: 'Plan B', items: [{ label: 'Price', value: 29 }, { label: 'Seats', value: 10 }] }] },
  gantt: { type: 'gantt', tasks: [{ label: 'Design', start: 0, end: 3 }, { label: 'Build', start: 2, end: 7 }, { label: 'Launch', start: 7, end: 9 }] },
  waterfall: { type: 'waterfall', start: 0, steps: [{ label: 'Q1', value: 50 }, { label: 'Q2', value: 30 }, { label: 'Q3', value: -20 }, { label: 'Q4', value: 40 }] },
  swimlane: { type: 'swimlane', phases: ['Q1', 'Q2', 'Q3'], lanes: [{ label: 'Eng', items: [{ phase: 0, label: 'API' }, { phase: 2, label: 'v2' }] }, { label: 'Design', items: [{ phase: 1, label: 'Rebrand' }] }] },
  tierlist: { type: 'tierlist', tiers: [{ label: 'S', items: ['Bar', 'Line'] }, { label: 'A', items: ['Pie', 'Area'] }, { label: 'B', items: ['Radar'] }] },
  swot: { type: 'swot', cells: [{ title: 'Strengths', items: ['Fast', 'Cheap'] }, { title: 'Weaknesses', items: ['New brand'] }, { title: 'Opportunities', items: ['AI demand'] }, { title: 'Threats', items: ['Incumbents'] }] },
  dashboard: { type: 'dashboard', title: 'Overview', layout: { cols: 2 }, tiles: [{ chart: { type: 'kpi', label: 'Revenue', value: 128400, valuePrefix: '$', delta: 12.4 } }, { chart: { type: 'kpi', label: 'Users', value: 8640, delta: 8.1 } }, { span: [2, 1], chart: { type: 'bar', data: { labels: ['A', 'B', 'C'], series: [{ name: 'Sales', values: [8, 5, 3] }] } } }] },
};

// GALLERY — a curated, launch-quality SHOWCASE (not the minimal examples above). The
// MCP `gallery` tool renders each to a PNG and returns it alongside its spec, so a user
// who asks to "see a demo / gallery" gets an instant visual tour that also teaches the
// spec shape. Leads with the flagship dashboard (many charts → one image, one render).
export const GALLERY = [
  { name: 'Dashboard — SaaS business review', blurb: 'Nine charts tiled into one image in a single render.',
    spec: { type: 'dashboard', title: 'Acme — Monthly Business Review', palette: 'Clean Corporate', layout: { cols: 3, tileHeight: 250 }, tiles: [
      { chart: { type: 'kpi', label: 'Monthly Recurring Revenue', value: 128400, valuePrefix: '$', delta: 12.4 } },
      { chart: { type: 'kpi', label: 'Active Users', value: 8640, delta: 8.1 } },
      { chart: { type: 'kpi', label: 'Churn', value: 2.3, valueUnit: '%', delta: -0.4, deltaUnit: 'pt', deltaGoodWhen: 'down' } },
      { span: [2, 1], chart: { type: 'line', title: 'Monthly active users', data: { labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'], series: [{ name: 'Product A', values: [120, 190, 170, 250, 230, 310] }, { name: 'Product B', values: [80, 110, 160, 140, 210, 260] }] } } },
      { chart: { type: 'gauge', title: 'Net revenue retention', value: 112, min: 0, max: 150, valueUnit: '%' } },
      { chart: { type: 'funnel', title: 'Signup funnel', stages: [{ label: 'Visitors', value: 12000 }, { label: 'Signups', value: 4200 }, { label: 'Trials', value: 1800 }, { label: 'Paid', value: 640 }] } },
      { chart: { type: 'waffle', title: 'Revenue by segment', parts: [{ label: 'Enterprise', value: 45 }, { label: 'SMB', value: 30 }, { label: 'Other', value: 15 }] } },
      { chart: { type: 'bar', title: 'Deals by stage', data: { labels: ['Lead', 'Demo', 'Won'], series: [{ name: 'Deals', values: [42, 24, 11] }] } } },
    ] } },
  { name: 'Line — trend over time', blurb: 'Multi-series line with legend.',
    spec: { type: 'line', title: 'Monthly active users', data: { labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'], series: [{ name: 'Product A', values: [120, 190, 170, 250, 230, 310] }, { name: 'Product B', values: [80, 110, 160, 140, 210, 260] }] } } },
  { name: 'Donut — part of whole', blurb: 'Composition with a center total.',
    spec: { type: 'donut', title: 'Market share', data: { labels: ['Us', 'Rival A', 'Rival B', 'Other'], series: [{ values: [38, 27, 20, 15] }] } } },
  { name: 'Funnel — conversion', blurb: 'Stages narrowing top → bottom with %.',
    spec: { type: 'funnel', title: 'Signup funnel', stages: [{ label: 'Visitors', value: 12000 }, { label: 'Signups', value: 4200 }, { label: 'Trials', value: 1800 }, { label: 'Paid', value: 640 }] } },
  { name: 'Heatmap — a grid of values', blurb: 'Value → color intensity.',
    spec: { type: 'heatmap', title: 'Active users by day & time', rows: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], columns: ['9a', '12p', '3p', '6p', '9p'], values: [[2, 5, 8, 3, 1], [1, 4, 9, 6, 2], [0, 3, 7, 8, 4], [2, 6, 9, 7, 3], [3, 7, 6, 4, 5]] } },
  { name: 'Waterfall — running total', blurb: 'Signed steps to a final total.',
    spec: { type: 'waterfall', title: 'Cash flow', start: 120, steps: [{ label: 'Sales', value: 80 }, { label: 'Refunds', value: -18 }, { label: 'Costs', value: -42 }, { label: 'Other', value: 12 }] } },
];

// GALLERY_BOARDS — every chart type grouped into six editorial "boards". Each board
// renders as ONE tiled `dashboard` (a tile per type, labeled by type name) — the
// "show me EVERYTHING, organized" view. Covers all 46 standalone types across 6 images.
export const GALLERY_BOARDS = [
  { id: 'comparison',      title: 'Comparison',        cols: 4, types: ['bar', 'grouped', 'stacked', 'stacked100', 'stackedh', 'horizontal', 'lollipop', 'diverging'] },
  { id: 'trend',           title: 'Trend',             cols: 4, types: ['line', 'smooth', 'area', 'stepped', 'stackedArea', 'difference', 'slope'] },
  { id: 'part-to-whole',   title: 'Part-to-Whole',     cols: 3, types: ['pie', 'donut', 'waffle', 'pieofpie', 'funnel', 'pyramid'] },
  { id: 'single-stat',     title: 'Single-Stat',       cols: 4, types: ['kpi', 'gauge', 'ring', 'iconarray', 'cards', 'callout', 'progress', 'bullet'] },
  { id: 'grid-structure',  title: 'Grid & Structure',  cols: 4, types: ['heatmap', 'quadrant', 'venn', 'matrix', 'table', 'timeline', 'calendar', 'swimlane'] },
  { id: 'process-planning', title: 'Process & Planning', cols: 3, types: ['layers', 'steps', 'checklist', 'leaderboard', 'versus', 'gantt', 'waterfall', 'tierlist', 'swot'] },
];

// Build the tiled `dashboard` spec for one board — each tile is that type's example
// spec, titled by the type name (deterministic; renders in a single pass).
export function boardSpec(board) {
  const n = GALLERY_BOARDS.length;
  const idx = GALLERY_BOARDS.findIndex((b) => b.id === board.id);
  return {
    type: 'dashboard',
    title: `SlickFast Gallery ${idx + 1}/${n} — ${board.title}`,
    palette: 'Clean Corporate',
    layout: { cols: board.cols || 4, tileHeight: 240 },
    tiles: board.types.map((t) => ({ chart: { ...(EXAMPLES[t] || { type: t }), type: t, title: t } })),
  };
}
