// Token Radar dashboard: renders window.RADAR (written by main.ts from the sealed
// snapshot), with a sortable, filterable board, a detail view per protocol, a live
// view of already-trading protocols, and a model sandbox that rescores the board
// in the page. No network, no fetch: the data ships in data.js beside this page.

const R = window.RADAR;
const $ = (id) => document.getElementById(id);
const watchSet = new Set(R.rows.filter((r) => r.watchlist).map((r) => r.slug));

/** $2.75B, $153.3M, $6.1M, $812K. */
function usd(n) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(n >= 1e11 ? 0 : 2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}
function pct(v) {
  if (v === null || v === undefined) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
}
function ageText(days) {
  if (days === null || days === undefined) return '—';
  if (days >= 365) return `${(days / 365).toFixed(1)}y`;
  return `${days}d`;
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The sandbox's parameters: radar-4's, until a slider moves. */
let params = { ...R.model };
let rescored = false;

function rescore(row) {
  const p = params;
  const base = Math.max(1, Math.round(Math.sqrt(Math.max(0, row.tvl_usd)) * p.scale));
  const g = Math.min(p.growth_cap, Math.max(p.growth_floor, row.change_7d ?? 0));
  const growth = 1 + (g / 100) * p.growth_weight;
  const chainPay = Math.min(p.chain_cap, 1 + p.chain_coefficient * row.waterfall.chain_weight_sum);
  const crowd = 1 / (1 + p.crowd_coefficient * Math.log(Math.max(1, row.waterfall.category_count)));
  let bleed = 1;
  if (row.change_7d !== null && row.change_7d < p.bleed_start) {
    const depth = Math.min(1, (p.bleed_start - row.change_7d) / (p.bleed_start - p.bleed_full));
    bleed = 1 - p.bleed_cap * depth;
  }
  let hair = 1;
  if (row.change_7d === null) hair -= p.missing_growth_haircut;
  if (row.listed_at === null) hair -= p.missing_date_haircut;
  const age = row.age_days ?? p.unknown_age_days;
  const mat = p.maturity_floor + (1 - p.maturity_floor) * (Math.min(Math.max(age, 0), p.maturity_days) / p.maturity_days);
  return { implied: Math.max(1, Math.round(base * growth * chainPay * crowd * bleed * hair * mat)), base, growth, chainPay, crowd, bleed, hair, mat };
}

/** Rows in display order: rescored by implied value when the sandbox moved, else radar-4's rank. */
function displayRows() {
  const rows = R.rows.map((r) => ({ ...r, current: rescored ? rescore(r).implied : r.implied_value_usd }));
  rows.sort((a, b) => b.current - a.current || (a.slug < b.slug ? -1 : 1));
  rows.forEach((r, i) => { r.displayRank = i + 1; });
  return rows;
}

let sortKey = 'rank';
let selected = null;

function filtered() {
  const q = $('q').value.trim().toLowerCase();
  const cat = $('catFilter').value;
  const watchOnly = $('watchOnly').checked;
  let rows = displayRows();
  if (watchOnly) rows = rows.filter((r) => watchSet.has(r.slug));
  if (cat) rows = rows.filter((r) => r.category === cat);
  if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.slug.includes(q) || (r.category || '').toLowerCase().includes(q));
  const key = sortKey;
  const by = {
    rank: (a, b) => a.displayRank - b.displayRank,
    name: (a, b) => a.name.localeCompare(b.name),
    category: (a, b) => (a.category || '').localeCompare(b.category || '') || a.displayRank - b.displayRank,
    tvl: (a, b) => b.tvl_usd - a.tvl_usd,
    growth: (a, b) => (b.change_7d ?? -1e9) - (a.change_7d ?? -1e9),
    age: (a, b) => (b.age_days ?? -1) - (a.age_days ?? -1),
    value: (a, b) => b.current - a.current,
  }[key] || ((a, b) => a.displayRank - b.displayRank);
  return rows.sort(by);
}

function render() {
  const rows = filtered();
  $('count').textContent = `${rows.length} of ${R.board_size} rows`;
  $('rows').innerHTML = rows.map((r) => {
    const ch = r.change_7d;
    const cls = ch === null ? '' : ch >= 0 ? 'up' : 'down';
    const chains = r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ` +${r.chains.length - 2}` : '');
    const pill = watchSet.has(r.slug) ? ' <span class="pill watch">watchlist</span>' : '';
    return `<tr data-slug="${esc(r.slug)}" class="${selected === r.slug ? 'selected' : ''}">` +
      `<td>${r.displayRank}</td>` +
      `<td><b>${esc(r.name)}</b>${pill}<br><span class="note">${esc(r.slug)}</span></td>` +
      `<td>${esc(r.category || '—')}</td>` +
      `<td>${esc(chains)}</td>` +
      `<td class="num">${usd(r.tvl_usd)}</td>` +
      `<td class="num ${cls}">${pct(ch)}</td>` +
      `<td class="num">${ageText(r.age_days)}</td>` +
      `<td class="num value">${usd(r.current)}</td>` +
      `<td>${esc(r.cheapest_chain)}</td></tr>`;
  }).join('');
  document.querySelectorAll('#rows tr').forEach((tr) => tr.addEventListener('click', () => showDetail(tr.dataset.slug)));
}

function showDetail(slug) {
  const row = R.rows.find((r) => r.slug === slug);
  if (!row) return;
  selected = slug;
  const w = row.waterfall;
  const s = rescored ? rescore(row) : null;
  const implied = s ? s.implied : row.implied_value_usd;
  const wf = s || { base: w.base, growth: w.growth_mult, chainPay: w.chain_pay, crowd: w.crowd_mult, bleed: w.bleed_mult, hair: w.haircut_mult, mat: w.maturity_mult };
  $('detailPanel').hidden = false;
  $('detailTitle').textContent = `${row.name} — rank ${row.rank}`;
  $('detail').innerHTML =
    `<div class="detailGrid"><div>` +
    `<div class="kv"><span>Slug</span><span>${esc(row.slug)}</span></div>` +
    `<div class="kv"><span>Category</span><span>${esc(row.category || '—')}</span></div>` +
    `<div class="kv"><span>Chains</span><span>${esc(row.chains.join(', '))}</span></div>` +
    `<div class="kv"><span>TVL</span><span>${usd(row.tvl_usd)}</span></div>` +
    `<div class="kv"><span>7-day change</span><span>${pct(row.change_7d)}</span></div>` +
    `<div class="kv"><span>Age</span><span>${ageText(row.age_days)}${row.listed_at ? ` (since ${esc(row.listed_at)})` : ' (listing date unreported)'}</span></div>` +
    `<div class="kv"><span>Cheapest chain to farm</span><span>${esc(row.cheapest_chain)}</span></div>` +
    `</div><div>` +
    `<table class="waterfall"><tbody>` +
    `<tr><td>Base — √TVL × ${params.scale}</td><td>${usd(wf.base)}</td></tr>` +
    `<tr><td>Growth × ${wf.growth.toFixed(4)}</td><td>${pct(row.change_7d)}</td></tr>` +
    `<tr><td>Chain pay × ${wf.chainPay.toFixed(4)}</td><td>weight Σ ${w.chain_weight_sum.toFixed(4)}</td></tr>` +
    `<tr><td>Crowding × ${wf.crowd.toFixed(4)}</td><td>${w.category_count} in category</td></tr>` +
    `<tr><td>Bleed × ${wf.bleed.toFixed(4)}</td><td>${row.change_7d !== null && row.change_7d < -20 ? 'drop past −20%' : 'no bleed'}</td></tr>` +
    `<tr><td>Completeness × ${wf.hair.toFixed(4)}</td><td>${row.change_7d === null ? '7d missing ' : ''}${row.listed_at === null ? 'date missing' : ''}${row.change_7d !== null && row.listed_at !== null ? 'complete' : ''}</td></tr>` +
    `<tr><td>Maturity × ${wf.mat.toFixed(4)}</td><td>${ageText(row.age_days)}</td></tr>` +
    `<tr class="total"><td>Implied value</td><td>${usd(implied)}${s ? ' (rescored)' : ''}</td></tr>` +
    `</tbody></table></div></div>` +
    `<h3>Farm plan — cheapest chain: ${esc(row.cheapest_chain)}</h3>` +
    `<ol class="steps">${row.farm_steps.map((st, i) => `<li><b>Step ${i + 1}:</b> ${esc(st)}</li>`).join('')}</ol>`;
  render();
}

function renderLive() {
  $('liveRows').innerHTML = R.live.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td>${esc(p.category || '—')}</td><td class="num">${usd(p.tvl_usd)}</td><td class="num">${p.mcap_usd ? usd(p.mcap_usd) : '—'}</td><td class="num ${p.change_7d === null ? '' : p.change_7d >= 0 ? 'up' : 'down'}">${pct(p.change_7d)}</td></tr>`).join('');
}

function renderStats() {
  $('stats').innerHTML =
    `<div class="stat"><b>${R.board_size}</b><span>board rows</span></div>` +
    `<div class="stat"><b>${R.watchlist_size}</b><span>watchlist</span></div>` +
    `<div class="stat"><b>${R.early_size}</b><span>early finds</span></div>` +
    `<div class="stat"><b>${R.live_size}</b><span>live, set aside</span></div>` +
    `<div class="stat"><b>${R.model_version}</b><span>model</span></div>`;
  const cats = [...new Set(R.rows.map((r) => r.category).filter(Boolean))].sort();
  $('catFilter').innerHTML = '<option value="">All categories</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join('');
  const top = Object.entries(R.chain_weights).slice(0, 8).map(([c, w]) => `${esc(c)} ${(w * 100).toFixed(1)}%`).join(' · ');
  $('chainWeights').innerHTML = `<b>Chain weights</b> (share of the live set's TVL): ${top}.`;
  $('sourceLine').textContent = `Snapshot: ${R.source}, as of ${R.as_of}. Watchlist floor $${R.floor_usd.toLocaleString()}. Implied values are this entry's own claim, never make.fun's.`;
}

const SLIDERS = [
  { key: 'scale', label: 'Base scale √TVL ×', min: 1000, max: 6000, step: 100 },
  { key: 'growth_weight', label: 'Growth weight', min: 0, max: 1, step: 0.05 },
  { key: 'chain_coefficient', label: 'Chain coefficient', min: 0, max: 1.5, step: 0.05 },
  { key: 'crowd_coefficient', label: 'Crowding coefficient', min: 0, max: 0.15, step: 0.01 },
  { key: 'bleed_cap', label: 'Bleed cap', min: 0, max: 0.3, step: 0.01 },
];

function renderSliders() {
  $('sliders').innerHTML = SLIDERS.map((s) => `<div class="slider"><label>${s.label}<output id="out-${s.key}">${params[s.key]}</output></label><input type="range" id="in-${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${params[s.key]}"></div>`).join('');
  SLIDERS.forEach((s) => {
    $(`in-${s.key}`).addEventListener('input', (e) => {
      params[s.key] = Number(e.target.value);
      $(`out-${s.key}`).textContent = e.target.value;
      rescored = true;
      $('sandboxNote').textContent = 'Rescored with your parameters — the ranks above moved. Reset to see radar-4 as submitted.';
      render();
    });
  });
}

$('q').addEventListener('input', render);
$('watchOnly').addEventListener('change', render);
$('catFilter').addEventListener('change', render);
$('sortBy').addEventListener('change', (e) => { sortKey = e.target.value; render(); });
document.querySelectorAll('#board th[data-sort]').forEach((th) => th.addEventListener('click', () => {
  sortKey = th.dataset.sort;
  $('sortBy').value = sortKey === 'name' || sortKey === 'category' ? 'rank' : sortKey;
  if (sortKey === 'name' || sortKey === 'category') sortKey = 'rank';
  render();
}));
$('resetModel').addEventListener('click', () => {
  params = { ...R.model };
  rescored = false;
  $('sandboxNote').textContent = 'Showing radar-4, the model as submitted.';
  renderSliders();
  render();
});

renderStats();
renderSliders();
renderLive();
render();
