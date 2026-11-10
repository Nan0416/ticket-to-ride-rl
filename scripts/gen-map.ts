// Map design helper: computes route lengths from geography, assigns colors in a
// balanced way, sanity-checks geometry, and generates contracts.
// Usage: npx tsx scripts/gen-map.ts [--write]
import { writeFileSync } from 'node:fs';
import { CITIES } from '../shared/map/cities.ts';
import { project } from '../shared/projection.ts';

type E = [a: string, b: string, double?: boolean];

const EDGES: E[] = [
  ['vancouver', 'portland', true],
  ['vancouver', 'calgary'],
  ['vancouver', 'edmonton'],
  ['vancouver', 'spokane'],
  ['portland', 'spokane'],
  ['portland', 'boise'],
  ['portland', 'sanfrancisco'],
  ['sanfrancisco', 'reno'],
  ['sanfrancisco', 'losangeles', true],
  ['losangeles', 'lasvegas'],
  ['losangeles', 'phoenix'],
  ['losangeles', 'hermosillo'],
  ['reno', 'boise'],
  ['reno', 'saltlake'],
  ['reno', 'lasvegas'],
  ['boise', 'spokane'],
  ['boise', 'saltlake'],
  ['spokane', 'calgary'],
  ['spokane', 'billings'],
  ['calgary', 'edmonton'],
  ['calgary', 'regina'],
  ['calgary', 'billings'],
  ['edmonton', 'regina'],
  ['regina', 'winnipeg'],
  ['regina', 'billings'],
  ['regina', 'bismarck'],
  ['winnipeg', 'bismarck'],
  ['winnipeg', 'thunderbay'],
  ['winnipeg', 'minneapolis'],
  ['billings', 'bismarck'],
  ['billings', 'saltlake'],
  ['billings', 'denver'],
  ['saltlake', 'denver', true],
  ['saltlake', 'lasvegas'],
  ['lasvegas', 'phoenix'],
  ['phoenix', 'albuquerque'],
  ['phoenix', 'hermosillo'],
  ['albuquerque', 'denver'],
  ['albuquerque', 'chihuahua'],
  ['albuquerque', 'oklahomacity'],
  ['hermosillo', 'chihuahua'],
  ['hermosillo', 'mazatlan'],
  ['chihuahua', 'mazatlan'],
  ['chihuahua', 'monterrey'],
  ['chihuahua', 'sanantonio'],
  ['mazatlan', 'guadalajara'],
  ['guadalajara', 'mexicocity', true],
  ['guadalajara', 'monterrey'],
  ['monterrey', 'mexicocity'],
  ['monterrey', 'sanantonio'],
  ['denver', 'omaha'],
  ['denver', 'kansascity', true],
  ['bismarck', 'minneapolis'],
  ['bismarck', 'omaha'],
  ['minneapolis', 'thunderbay'],
  ['minneapolis', 'chicago', true],
  ['minneapolis', 'omaha'],
  ['omaha', 'chicago'],
  ['omaha', 'kansascity', true],
  ['kansascity', 'stlouis', true],
  ['kansascity', 'oklahomacity'],
  ['oklahomacity', 'dallas', true],
  ['oklahomacity', 'memphis'],
  ['dallas', 'houston', true],
  ['dallas', 'sanantonio'],
  ['dallas', 'memphis'],
  ['sanantonio', 'houston'],
  ['houston', 'neworleans'],
  ['neworleans', 'memphis'],
  ['neworleans', 'atlanta'],
  ['neworleans', 'jacksonville'],
  ['memphis', 'stlouis'],
  ['memphis', 'atlanta'],
  ['memphis', 'louisville'],
  ['stlouis', 'chicago', true],
  ['stlouis', 'louisville'],
  ['chicago', 'louisville'],
  ['chicago', 'detroit', true],
  ['louisville', 'detroit'],
  ['louisville', 'atlanta'],
  ['louisville', 'washington'],
  ['detroit', 'toronto'],
  ['detroit', 'washington'],
  ['thunderbay', 'sudbury'],
  ['sudbury', 'toronto'],
  ['sudbury', 'montreal'],
  ['toronto', 'montreal', true],
  ['toronto', 'newyork'],
  ['montreal', 'newyork'],
  ['montreal', 'boston'],
  ['montreal', 'halifax'],
  ['boston', 'halifax'],
  ['boston', 'newyork', true],
  ['newyork', 'washington', true],
  ['washington', 'charlotte'],
  ['charlotte', 'atlanta'],
  ['charlotte', 'jacksonville'],
  ['atlanta', 'jacksonville'],
  ['jacksonville', 'miami', true],
];

const UNIT = Number(process.env.UNIT ?? 1.2);
const CITY_R = 0.55;

const pos = new Map(CITIES.map((c) => [c.id, project(c.lon, c.lat)]));
for (const [a, b] of EDGES) {
  if (!pos.has(a) || !pos.has(b)) throw new Error(`unknown city in ${a}-${b}`);
}

function dist(a: string, b: string) {
  const p = pos.get(a)!;
  const q = pos.get(b)!;
  return Math.hypot(p.x - q.x, p.y - q.y);
}

// --- lengths
const lengths = EDGES.map(([a, b]) => {
  const eff = dist(a, b) - 2 * CITY_R;
  return Math.max(1, Math.min(6, Math.round(eff / UNIT)));
});

// --- geometry checks
function segPointDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
function cross(o: any, a: any, b: any) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}
function segsIntersect(p1: any, p2: any, p3: any, p4: any) {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
const problems: string[] = [];
EDGES.forEach(([a, b], i) => {
  for (const c of CITIES) {
    if (c.id === a || c.id === b) continue;
    const d = segPointDist(pos.get(c.id)!, pos.get(a)!, pos.get(b)!);
    if (d < 1.0) problems.push(`route ${a}-${b} passes ${d.toFixed(2)} from ${c.id}`);
  }
  EDGES.forEach(([c, d], j) => {
    if (j <= i) return;
    if ([a, b].includes(c) || [a, b].includes(d)) return;
    if (segsIntersect(pos.get(a), pos.get(b), pos.get(c), pos.get(d))) problems.push(`cross: ${a}-${b} x ${c}-${d}`);
  });
  const eff = dist(a, b) - 2 * CITY_R;
  const slot = eff / lengths[i];
  if (slot < 0.85 || slot > 2.2) problems.push(`slot size ${slot.toFixed(2)} on ${a}-${b} (len ${lengths[i]})`);
});

// --- colors: balanced greedy assignment
const COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'black', 'white'] as const;
type Col = (typeof COLORS)[number] | 'gray';
const usage = new Map<string, number>(COLORS.map((c) => [c, 0]));
const cityColors = new Map<string, Col[]>();
let seed = 7;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
interface R {
  id: string;
  a: string;
  b: string;
  length: number;
  color: Col;
  twin?: string;
}
const routes: R[] = [];
// Process longest first so long routes get balanced colors
const order = EDGES.map((e, i) => i).sort((x, y) => lengths[y] - lengths[x] || x - y);
for (const i of order) {
  const [a, b, dbl] = EDGES[i];
  const len = lengths[i];
  const copies = dbl ? 2 : 1;
  const chosen: Col[] = [];
  for (let k = 0; k < copies; k++) {
    // ~22% of single short routes are gray; doubles get at most one gray
    const grayOk = len <= 3 && (dbl ? k === 1 && rand() < 0.35 : rand() < 0.3);
    if (grayOk) {
      chosen.push('gray');
      continue;
    }
    const near = [...(cityColors.get(a) ?? []), ...(cityColors.get(b) ?? []), ...chosen];
    const candidates = COLORS.slice().sort((c1, c2) => {
      const s1 = usage.get(c1)! + near.filter((n) => n === c1).length * 6 + rand();
      const s2 = usage.get(c2)! + near.filter((n) => n === c2).length * 6 + rand();
      return s1 - s2;
    });
    chosen.push(candidates[0]);
    usage.set(candidates[0], usage.get(candidates[0])! + len);
  }
  for (const c of chosen) {
    cityColors.set(a, [...(cityColors.get(a) ?? []), c]);
    cityColors.set(b, [...(cityColors.get(b) ?? []), c]);
  }
  const base = `${a}-${b}`;
  if (copies === 1) routes.push({ id: base, a, b, length: len, color: chosen[0] });
  else {
    routes.push({ id: `${base}-1`, a, b, length: len, color: chosen[0], twin: `${base}-2` });
    routes.push({ id: `${base}-2`, a, b, length: len, color: chosen[1], twin: `${base}-1` });
  }
}
// restore original edge order for readability
const edgeIndex = new Map(EDGES.map(([a, b], i) => [`${a}-${b}`, i]));
routes.sort((r1, r2) => edgeIndex.get(`${r1.a}-${r1.b}`)! - edgeIndex.get(`${r2.a}-${r2.b}`)! || r1.id.localeCompare(r2.id));

// --- stats
const lenHist = [0, 0, 0, 0, 0, 0, 0];
let totalTrains = 0;
for (const r of routes) {
  lenHist[r.length]++;
  totalTrains += r.length;
}
console.log(`cities ${CITIES.length}, routes ${routes.length}, trains on board ${totalTrains}`);
console.log('length histogram', lenHist.slice(1).map((n, i) => `${i + 1}:${n}`).join(' '));
console.log('color usage', Object.fromEntries(usage), 'gray', routes.filter((r) => r.color === 'gray').reduce((s, r) => s + r.length, 0));
const degree = new Map<string, number>();
for (const [a, b] of EDGES) {
  degree.set(a, (degree.get(a) ?? 0) + 1);
  degree.set(b, (degree.get(b) ?? 0) + 1);
}
console.log('degrees', [...degree].sort((x, y) => x[1] - y[1]).map(([c, d]) => `${c}:${d}`).join(' '));
console.log(problems.length ? 'PROBLEMS:\n  ' + problems.join('\n  ') : 'no geometry problems');

// --- contracts (shortest path in trains between city pairs)
const adj = new Map<string, { to: string; w: number }[]>();
for (const r of routes) {
  if (r.id.endsWith('-2')) continue;
  adj.set(r.a, [...(adj.get(r.a) ?? []), { to: r.b, w: r.length }]);
  adj.set(r.b, [...(adj.get(r.b) ?? []), { to: r.a, w: r.length }]);
}
function shortest(src: string): Map<string, number> {
  const d = new Map<string, number>([[src, 0]]);
  const done = new Set<string>();
  while (true) {
    let best: string | null = null;
    for (const [k, v] of d) if (!done.has(k) && (best === null || v < d.get(best)!)) best = k;
    if (best === null) break;
    done.add(best);
    for (const { to, w } of adj.get(best) ?? []) {
      const nd = d.get(best)! + w;
      if (nd < (d.get(to) ?? Infinity)) d.set(to, nd);
    }
  }
  return d;
}
const allPairs: { a: string; b: string; d: number }[] = [];
for (let i = 0; i < CITIES.length; i++) {
  const sp = shortest(CITIES[i].id);
  for (let j = i + 1; j < CITIES.length; j++) allPairs.push({ a: CITIES[i].id, b: CITIES[j].id, d: sp.get(CITIES[j].id)! });
}
// Pick contracts: 36 regular (5..13) + 8 long (17+), spreading cities
const useCount = new Map<string, number>();
const pick = (lo: number, hi: number, n: number, maxUse: number) => {
  const out: typeof allPairs = [];
  const pool = allPairs.filter((p) => p.d >= lo && p.d <= hi);
  // deterministic shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  // aim for an even spread of values
  const perValue = new Map<number, number>();
  const cap = Math.ceil(n / (hi - lo + 1)) + 1;
  for (const p of pool) {
    if (out.length >= n) break;
    if ((useCount.get(p.a) ?? 0) >= maxUse || (useCount.get(p.b) ?? 0) >= maxUse) continue;
    if ((perValue.get(p.d) ?? 0) >= cap) continue;
    out.push(p);
    perValue.set(p.d, (perValue.get(p.d) ?? 0) + 1);
    useCount.set(p.a, (useCount.get(p.a) ?? 0) + 1);
    useCount.set(p.b, (useCount.get(p.b) ?? 0) + 1);
  }
  return out;
};
const longOnes = pick(20, 30, 8, 1);
const regular = pick(5, 14, 38, 3);
// make sure every city shows up in at least one contract
for (const c of CITIES) {
  if (useCount.has(c.id)) continue;
  const p = allPairs.find((q) => (q.a === c.id || q.b === c.id) && q.d >= 7 && q.d <= 13 && (useCount.get(q.a === c.id ? q.b : q.a) ?? 0) < 3);
  if (!p) continue;
  regular.push(p);
  useCount.set(p.a, (useCount.get(p.a) ?? 0) + 1);
  useCount.set(p.b, (useCount.get(p.b) ?? 0) + 1);
}
console.log("pair distance max", Math.max(...allPairs.map((p) => p.d)));
console.log(`contracts: ${regular.length} regular, ${longOnes.length} long`);
const unused = CITIES.filter((c) => !useCount.has(c.id)).map((c) => c.id);
console.log('cities without contracts:', unused.join(', ') || 'none');

if (process.argv.includes('--write')) {
  const header = `// GENERATED by scripts/gen-map.ts, then frozen. Rocky Way original North America board.\n`;
  const routesTs =
    header +
    `import type { RouteColor } from '../cards.ts';\n\nexport interface Route {\n  id: string;\n  a: string;\n  b: string;\n  length: number;\n  color: RouteColor;\n  /** id of the parallel route for double routes */\n  twin?: string;\n}\n\nexport const ROUTES: Route[] = [\n` +
    routes
      .map((r) => `  { id: '${r.id}', a: '${r.a}', b: '${r.b}', length: ${r.length}, color: '${r.color}'${r.twin ? `, twin: '${r.twin}'` : ''} },`)
      .join('\n') +
    `\n];\n`;
  writeFileSync('shared/map/routes.ts', routesTs);
  const fmt = (p: (typeof allPairs)[number], long: boolean) =>
    `  { id: '${p.a}~${p.b}', a: '${p.a}', b: '${p.b}', points: ${p.d}${long ? ', long: true' : ''} },`;
  const ticketsTs =
    header +
    `export interface Contract {\n  id: string;\n  a: string;\n  b: string;\n  points: number;\n  long?: boolean;\n}\n\nexport const CONTRACTS: Contract[] = [\n` +
    [...longOnes.map((p) => fmt(p, true)), ...regular.sort((x, y) => x.d - y.d).map((p) => fmt(p, false))].join('\n') +
    `\n];\n`;
  writeFileSync('shared/map/contracts.ts', ticketsTs);
  console.log('wrote shared/map/routes.ts and shared/map/contracts.ts');
}
