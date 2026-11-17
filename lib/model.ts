// Token Radar, model radar-4: a clean-room rewrite.
//
// The board ranks pre-token protocols by an implied value that follows only from the
// sealed snapshot's own figures. No protocol name is ever special-cased: one scoring
// function runs every row, and the dashboard shows its whole arithmetic.
//
//   base       = sqrt(tvl_usd) x SCALE          (the log scale: a protocol 100x larger
//                                                in TVL is worth 10x more, not 100x)
//   growth     = 1 + clamp(change_7d, -60, 120) / 100 x GROWTH_WEIGHT
//   chain pay  = min(1.35, 1 + 0.70 x summed chain weight)
//                each chain's weight is its share of the live set's total TVL, a
//                protocol's TVL split evenly across the chains it lists
//   crowding   = 1 / (1 + 0.06 x ln(n))         n = rankable protocols in the category
//   bleed      = up to a further 15% off when the 7-day drop passes -20%
//   haircut    = -3% when change_7d is missing, -2% when listed_at is missing
//   maturity   = 0.85 + 0.15 x min(age_days, 730) / 730
//   implied    = max(1, round(base x growth x chain pay x crowding x bleed x haircut x maturity))
//
// The board is the watchlist (the floor, never the ceiling) plus the 163 rankable
// pre-token protocols below the floor with the most TVL: 203 rows on this snapshot.
// Live-token protocols are kept apart and shown at the market's own values.

/** One protocol entry of the sealed snapshot: exactly its ten fields. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** radar-4's constants, stated in the dashboard and movable in its sandbox. */
export interface ModelParams {
  scale: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  chain_coefficient: number;
  chain_cap: number;
  crowd_coefficient: number;
  bleed_cap: number;
  bleed_start: number;
  bleed_full: number;
  missing_growth_haircut: number;
  missing_date_haircut: number;
  maturity_floor: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelParams = {
  scale: 3000,
  growth_weight: 0.4,
  growth_floor: -60,
  growth_cap: 120,
  chain_coefficient: 0.7,
  chain_cap: 1.35,
  crowd_coefficient: 0.06,
  bleed_cap: 0.15,
  bleed_start: -20,
  bleed_full: -40,
  missing_growth_haircut: 0.03,
  missing_date_haircut: 0.02,
  maturity_floor: 0.85,
  maturity_days: 730,
  unknown_age_days: 365,
};

export const MODEL_VERSION = 'radar-4';

/** Rankable pre-token protocols below the watchlist floor the board adds, by TVL. */
export const EARLY_ROWS = 163;

/** Live-token protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One farm step: the action, what it costs, how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** The waterfall behind one row's implied value, shown in the detail view. */
export interface Waterfall {
  base: number;
  growth_mult: number;
  chain_pay: number;
  crowd_mult: number;
  bleed_mult: number;
  haircut_mult: number;
  maturity_mult: number;
  chain_weight_sum: number;
  category_count: number;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  model: Waterfall;
  cheapest_chain: string;
  farm_steps: string[];
}

/** The dashboard's compact row, with everything the sandbox needs to rescore it. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  waterfall: Waterfall;
  cheapest_chain: string;
  watchlist: boolean;
  farm_steps: string[];
}

/** A live-token protocol, shown at the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelParams;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  chain_weights: Record<string, number>;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, or null when the listing date is missing. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A name ending in a version marker is a pool of another protocol, not its own. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A protocol the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/**
 * Each chain's weight: its share of the live set's total TVL, a protocol's TVL split
 * evenly across the chains it lists. Ethereum carries the most weight, then Bitcoin,
 * Solana and the rest; the shares come from the snapshot, never from a list.
 */
export function chainWeights(protocols: SnapshotProtocol[]): Map<string, number> {
  const totals = new Map<string, number>();
  let all = 0;
  for (const p of protocols) {
    if (p.chains.length === 0) continue;
    const share = p.tvl_usd / p.chains.length;
    for (const c of p.chains) totals.set(c, (totals.get(c) ?? 0) + share);
    all += p.tvl_usd;
  }
  const out = new Map<string, number>();
  for (const [c, v] of totals) out.set(c, all > 0 ? v / all : 0);
  return out;
}

/** How many rankable protocols sit in each category, for the crowding discount. */
export function categoryCounts(protocols: SnapshotProtocol[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of protocols) {
    if (!isRankable(p)) continue;
    const key = p.category ?? 'Uncategorised';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The full waterfall and implied value for one protocol under `params`. */
export function scoreProtocol(
  p: SnapshotProtocol,
  asOf: string,
  weights: Map<string, number>,
  counts: Map<string, number>,
  params: ModelParams = MODEL,
): { implied: number; fall: Waterfall; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const base = Math.max(1, Math.round(Math.sqrt(Math.max(0, p.tvl_usd)) * params.scale));

  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = Math.min(params.growth_cap, Math.max(params.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * params.growth_weight;

  let weightSum = 0;
  for (const c of p.chains) weightSum += weights.get(c) ?? 0;
  const chainPay = Math.min(params.chain_cap, 1 + params.chain_coefficient * weightSum);

  const n = counts.get(p.category ?? 'Uncategorised') ?? 1;
  const crowdMult = 1 / (1 + params.crowd_coefficient * Math.log(Math.max(1, n)));

  let bleedMult = 1;
  if (p.change_7d !== null && p.change_7d < params.bleed_start) {
    const depth = Math.min(1, (params.bleed_start - p.change_7d) / (params.bleed_start - params.bleed_full));
    bleedMult = 1 - params.bleed_cap * depth;
  }

  let haircutMult = 1;
  if (p.change_7d === null) haircutMult -= params.missing_growth_haircut;
  if (p.listed_at === null) haircutMult -= params.missing_date_haircut;

  const ageForModel = age ?? params.unknown_age_days;
  const maturityMult = params.maturity_floor + (1 - params.maturity_floor) * (Math.min(Math.max(ageForModel, 0), params.maturity_days) / params.maturity_days);

  const implied = Math.max(1, Math.round(base * growthMult * chainPay * crowdMult * bleedMult * haircutMult * maturityMult));
  return {
    implied,
    age,
    fall: {
      base,
      growth_mult: round4(growthMult),
      chain_pay: round4(chainPay),
      crowd_mult: round4(crowdMult),
      bleed_mult: round4(bleedMult),
      haircut_mult: round4(haircutMult),
      maturity_mult: round4(maturityMult),
      chain_weight_sum: round4(weightSum),
      category_count: n,
    },
  };
}

// ---------------------------------------------------------------- farm plans

/** Approximate median cost of one simple swap on a chain, in USD (public fee data). */
const SWAP_COST_USD: Record<string, number> = {
  Solana: 0.01,
  Base: 0.05,
  Polygon: 0.05,
  Gnosis: 0.05,
  Arbitrum: 0.1,
  Optimism: 0.1,
  zkSync: 0.1,
  Linea: 0.1,
  Fantom: 0.1,
  BSC: 0.15,
  'BNB Chain': 0.15,
  Avalanche: 0.3,
  Tron: 0.5,
  Ethereum: 3.0,
  Bitcoin: 5.0,
};
const DEFAULT_SWAP_COST = 0.5;

/** The cheapest chain to farm this protocol on, by the swap-cost table. */
export function cheapestChain(p: SnapshotProtocol): string {
  let best = p.chains[0] ?? 'its main chain';
  let bestCost = Number.POSITIVE_INFINITY;
  for (const c of p.chains) {
    const cost = SWAP_COST_USD[c] ?? DEFAULT_SWAP_COST;
    if (cost < bestCost) {
      bestCost = cost;
      best = c;
    }
  }
  return best;
}

/** The capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols need a longer window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('liquid')) return `Deposit $${capital} of the liquid staking asset through ${name} on ${chain} and hold the receipt.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** One farm step as a single string: action, cost, time, within 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time, derived
 * from the protocol's own record (category, chains, TVL, age) and the cheapest chain
 * to farm it on. Never a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = cheapestChain(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = SWAP_COST_USD[chain] ?? DEFAULT_SWAP_COST;
  return [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${Math.max(1, Math.round(gas * 4))} of gas on ${chain}`,
      time: '15 minutes to set up',
    },
    {
      text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.',
      cost: `about $${Math.max(1, Math.round(gas * 2))} of gas a week on ${chain}`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: 'Before you withdraw, open the protocol\u2019s own points or rewards page and claim only from the link it publishes.',
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

// ---------------------------------------------------------------- the board

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, params: ModelParams = MODEL): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const weights = chainWeights(snapshot.protocols);
  const counts = categoryCounts(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const { implied, fall, age } = scoreProtocol(p, snapshot.as_of, weights, counts, params);
    return { p, implied, fall, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: s.fall,
    cheapest_chain: cheapestChain(s.p),
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow, watchlist: string[]): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    waterfall: row.model,
    cheapest_chain: row.cheapest_chain,
    watchlist: watchlist.includes(row.slug),
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, params: ModelParams = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, params);
  const live = liveRows(snapshot);
  const weights = chainWeights(snapshot.protocols);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const chainWeightsOut: Record<string, number> = {};
  for (const [c, w] of [...weights.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24)) chainWeightsOut[c] = round4(w);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: params,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    chain_weights: chainWeightsOut,
    rows: board.map((r) => radarRow(r, snapshot.watchlist)),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's whole dataset as one script: no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
