// Builds client/src/generated/geo.json: projected + clipped coastline, lakes and
// borders for the board. Source: Natural Earth via world-atlas (public domain).
// Usage: npm run geo
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { feature, mesh } from 'topojson-client';
import { CITIES } from '../shared/map/cities.ts';
import { project, type Point2 } from '../shared/projection.ts';

const topo = JSON.parse(readFileSync('node_modules/world-atlas/countries-50m.json', 'utf8'));

// Board rectangle: city extents plus a margin
const pts = CITIES.map((c) => project(c.lon, c.lat));
const MARGIN = { left: 3.2, right: 3.2, top: 2.8, bottom: 2.4 };
const bounds = {
  minX: Math.floor(Math.min(...pts.map((p) => p.x)) - MARGIN.left),
  maxX: Math.ceil(Math.max(...pts.map((p) => p.x)) + MARGIN.right),
  minY: Math.floor(Math.min(...pts.map((p) => p.y)) - MARGIN.bottom),
  maxY: Math.ceil(Math.max(...pts.map((p) => p.y)) + MARGIN.top),
};
// clip a little outside the board so clip seams never show
const CLIP = { minX: bounds.minX - 1, maxX: bounds.maxX + 1, minY: bounds.minY - 1, maxY: bounds.maxY + 1 };

type Ring = Point2[];

function clipRing(ring: Ring): Ring {
  const edges: [(p: Point2) => boolean, (a: Point2, b: Point2) => Point2][] = [
    [(p) => p.x >= CLIP.minX, (a, b) => lerpAt(a, b, 'x', CLIP.minX)],
    [(p) => p.x <= CLIP.maxX, (a, b) => lerpAt(a, b, 'x', CLIP.maxX)],
    [(p) => p.y >= CLIP.minY, (a, b) => lerpAt(a, b, 'y', CLIP.minY)],
    [(p) => p.y <= CLIP.maxY, (a, b) => lerpAt(a, b, 'y', CLIP.maxY)],
  ];
  let out = ring;
  for (const [inside, cut] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      if (inside(cur)) {
        if (!inside(prev)) out.push(cut(prev, cur));
        out.push(cur);
      } else if (inside(prev)) out.push(cut(prev, cur));
    }
    if (out.length === 0) break;
  }
  return out;
}

function lerpAt(a: Point2, b: Point2, axis: 'x' | 'y', v: number): Point2 {
  const t = (v - a[axis]) / (b[axis] - a[axis]);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function simplify(ring: Ring, minDist: number): Ring {
  const out: Ring = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= minDist) out.push(p);
  }
  return out;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const flat = (ring: Ring) => ring.flatMap((p) => [r2(p.x), r2(p.y)]);

function ringArea(ring: Ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

const land: number[][] = [];
const countries = feature(topo, topo.objects.countries) as any;
const landFeature = feature(topo, topo.objects.land) as any;
const geoms = landFeature.type === 'FeatureCollection' ? landFeature.features.map((f: any) => f.geometry) : [landFeature.geometry];
for (const g of geoms) {
  const polys: number[][][][] = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (const poly of polys) {
    for (const ringLL of poly) {
      // skip rings far from North America quickly
      if (!ringLL.some(([lon, lat]) => lon > -140 && lon < -50 && lat > 10 && lat < 62)) continue;
      const ring = simplify(clipRing(ringLL.map(([lon, lat]) => project(lon, lat))), 0.12);
      if (ring.length < 3 || Math.abs(ringArea(ring)) < 0.05) continue;
      land.push(flat(ring));
    }
  }
}

// Lakes are not cut out of Natural Earth land, so add the big ones by hand.
const LAKES_LL: [number, number][][] = [
  // Superior
  [[-92.1, 46.7], [-90.4, 46.6], [-88.4, 47.4], [-87.6, 46.5], [-86.0, 46.6], [-84.6, 46.5], [-84.8, 47.4], [-85.8, 47.9], [-87.0, 48.6], [-88.4, 48.6], [-89.4, 48.0], [-90.6, 47.7], [-91.9, 47.0]],
  // Michigan
  [[-87.8, 41.7], [-86.9, 41.7], [-86.4, 42.4], [-86.2, 43.5], [-86.5, 44.4], [-85.6, 45.2], [-84.9, 45.8], [-85.6, 46.0], [-86.6, 45.9], [-87.6, 45.1], [-87.9, 44.1], [-87.6, 43.0], [-87.8, 42.3]],
  // Huron + Georgian Bay
  [[-84.6, 45.9], [-83.6, 46.1], [-82.2, 46.1], [-80.8, 46.0], [-80.0, 45.2], [-80.6, 44.6], [-81.4, 45.2], [-81.7, 44.6], [-81.7, 43.9], [-82.4, 43.1], [-82.6, 43.7], [-83.5, 43.9], [-83.3, 44.8], [-84.2, 45.3]],
  // Erie
  [[-83.4, 41.7], [-82.5, 41.4], [-81.0, 41.8], [-79.8, 42.2], [-78.9, 42.8], [-79.6, 42.85], [-80.8, 42.6], [-82.0, 42.1], [-83.1, 42.05]],
  // Ontario
  [[-79.8, 43.3], [-79.0, 43.25], [-77.8, 43.3], [-76.3, 43.5], [-76.2, 44.1], [-77.0, 44.05], [-78.3, 43.95], [-79.4, 43.7]],
  // Winnipeg
  [[-97.0, 50.4], [-96.3, 50.6], [-96.2, 51.6], [-97.2, 52.8], [-98.6, 53.8], [-99.3, 53.6], [-98.2, 52.6], [-97.7, 51.4], [-97.2, 50.8]],
  // Great Salt Lake
  [[-112.9, 41.6], [-112.2, 41.7], [-112.0, 41.2], [-112.4, 40.75], [-113.0, 41.0]],
];
const lakes = LAKES_LL.map((ring) => flat(ring.map(([lon, lat]) => project(lon, lat))));

// Country borders (shared edges between different countries), clipped to the board
const borderLines: number[][] = [];
const ml = mesh(topo, topo.objects.countries as any, (a: any, b: any) => a !== b) as any;
for (const lineLL of ml.coordinates as number[][][]) {
  if (!lineLL.some(([lon, lat]) => lon > -135 && lon < -55 && lat > 12 && lat < 60)) continue;
  let cur: Point2[] = [];
  const flush = () => {
    if (cur.length > 1) borderLines.push(flat(simplify(cur, 0.1)));
    cur = [];
  };
  for (const [lon, lat] of lineLL) {
    const p = project(lon, lat);
    const inside = p.x >= bounds.minX && p.x <= bounds.maxX && p.y >= bounds.minY && p.y <= bounds.maxY;
    if (inside) cur.push(p);
    else flush();
  }
  flush();
}
void countries;

mkdirSync('client/src/generated', { recursive: true });
const out = { bounds, land, lakes, borders: borderLines };
writeFileSync('client/src/generated/geo.json', JSON.stringify(out));
const size = JSON.stringify(out).length;
console.log(`bounds ${JSON.stringify(bounds)}; land rings ${land.length} (${land.reduce((n, r) => n + r.length / 2, 0)} pts); borders ${borderLines.length}; ${(size / 1024).toFixed(0)} KB`);
