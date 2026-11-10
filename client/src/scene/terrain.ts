// Low-poly diorama terrain: a flat-shaded heightfield built from the Natural
// Earth coastline, with stylized mountain ranges and rail beds carved along routes.
import * as THREE from 'three';
import geo from '../generated/geo.json';
import { BOARD, distanceToTrack, lonLatToXZ, type XZ } from './layout.ts';
import { fbm, smoothstep, valueNoise } from './noise.ts';

export const WATER_LEVEL = 0;

interface Range {
  pts: [number, number][];
  width: number;
  height: number;
}

const RANGES: Range[] = [
  // Rockies
  { pts: [[-124, 55.5], [-120, 54], [-117.5, 52], [-115.5, 50], [-114, 48.5], [-112.5, 46.5], [-111, 45], [-110, 43.5], [-107.5, 41.5], [-106.3, 39.5], [-105.8, 37.5], [-105.6, 35.8]], width: 1.9, height: 1.9 },
  // Coast Mountains & Cascades
  { pts: [[-128, 54], [-125.5, 51.5], [-123, 50], [-121.5, 48.5], [-121.7, 46.5], [-122, 44.5], [-122, 42.5]], width: 1.0, height: 1.35 },
  // Sierra Nevada
  { pts: [[-121.5, 41], [-120.3, 39], [-118.8, 37], [-118.2, 35.6]], width: 0.9, height: 1.4 },
  // Basin & range
  { pts: [[-117.5, 41], [-115, 39.5], [-113.5, 38]], width: 2.0, height: 0.55 },
  // Wasatch & Uinta
  { pts: [[-111.7, 42], [-111.5, 40.6], [-110, 40.5]], width: 0.8, height: 0.9 },
  // Sierra Madre Occidental
  { pts: [[-109.5, 31], [-108, 28.5], [-106.5, 26], [-105.2, 23.5], [-104.2, 21.5]], width: 1.4, height: 1.3 },
  // Sierra Madre Oriental
  { pts: [[-102.5, 28], [-100.6, 25.3], [-99.5, 23], [-98.5, 21]], width: 0.9, height: 1.0 },
  // Trans-Mexican volcanic belt
  { pts: [[-105, 20], [-102, 19.6], [-99.6, 19.2], [-97.3, 19]], width: 0.7, height: 1.45 },
  // Baja California spine
  { pts: [[-116.3, 32.5], [-115, 30.5], [-113.3, 28], [-111.5, 25.5], [-110, 23.5]], width: 0.6, height: 0.7 },
  // Appalachians
  { pts: [[-86, 33.8], [-84, 35.5], [-81.5, 37], [-79.5, 38.6], [-77.8, 40.3], [-75.8, 41.8], [-73.8, 43.5], [-71.5, 44.5], [-69, 45.6], [-66.5, 47]], width: 1.2, height: 0.65 },
  // Ozarks
  { pts: [[-94.2, 35.8], [-92, 36.8]], width: 1.0, height: 0.3 },
  // Laurentians
  { pts: [[-76, 47], [-72, 47.6], [-69, 48.6]], width: 1.2, height: 0.45 },
];

const RANGE_XZ: { pts: XZ[]; width: number; height: number }[] = RANGES.map((r) => ({
  ...r,
  pts: r.pts.map(([lon, lat]) => lonLatToXZ(lon, lat)),
}));

function distToPolyline(x: number, z: number, pts: XZ[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(x - (a.x + t * dx), z - (a.z + t * dz));
    if (d < best) best = d;
  }
  return best;
}

/** Smooth land base height (no mountains): rail beds and cities sit on this. */
export function bedHeight(x: number, z: number): number {
  const highPlains = 0.26 * smoothstep(1, -8, x);
  return 0.26 + highPlains + (fbm(x * 0.08, z * 0.08, 2, 5) - 0.5) * 0.12;
}

function mountainHeight(x: number, z: number): number {
  let h = 0;
  for (const r of RANGE_XZ) {
    const d = distToPolyline(x, z, r.pts);
    if (d > r.width) continue;
    const f = Math.pow(1 - (d / r.width) ** 2, 1.4);
    const ridge = 1 - Math.abs(2 * fbm(x * 0.9, z * 0.9, 3, 11) - 1);
    const peaks = 0.55 + 0.9 * valueNoise(x * 1.7, z * 1.7, 23);
    h = Math.max(h, r.height * f * (0.35 + 0.65 * ridge) * peaks);
  }
  return h;
}

// --------------------------------------------------------------- biome colors
const C = (hex: string) => new THREE.Color(hex);
const COL = {
  sand: C('#e8d9a6'),
  prairie: C('#d3c877'),
  grass: C('#93c25f'),
  lush: C('#78b257'),
  boreal: C('#6a9a5c'),
  desert: C('#e2b67a'),
  redDesert: C('#d79a63'),
  rock: C('#a69580'),
  rockDark: C('#8c7c6b'),
  snow: C('#f6f5ef'),
  bed: C('#cdbb95'),
  seabedShallow: C('#8fd0cf'),
  seabedDeep: C('#3f86a8'),
};

function biomeColor(x: number, z: number, out: THREE.Color) {
  const jx = x + (fbm(x * 0.15, z * 0.15, 2, 31) - 0.5) * 5;
  const jz = z + (fbm(x * 0.15, z * 0.15, 2, 37) - 0.5) * 5;
  const north = smoothstep(-11, -16, jz);
  const desert = Math.max(
    smoothstep(-6.5, -10, jx) * smoothstep(-7, -2.5, jz) * smoothstep(-21, -16.5, jx),
    0.85 * smoothstep(-1.5, -6, jx) * smoothstep(3, 7, jz) * smoothstep(17, 13, jz),
  );
  const prairie = smoothstep(-9, -6.5, jx) * smoothstep(3.5, 0, jx) * smoothstep(-18, -14, jz) * smoothstep(6, 2, jz);
  out.copy(COL.lush);
  out.lerp(COL.grass, smoothstep(0, 1, valueNoise(x * 0.4, z * 0.4, 3)));
  out.lerp(COL.prairie, prairie * 0.85);
  out.lerp(COL.boreal, north);
  out.lerp(valueNoise(x * 0.3, z * 0.3, 9) > 0.5 ? COL.desert : COL.redDesert, desert);
  return { north, desert, prairie };
}

// --------------------------------------------------------------- terrain build

export interface TerrainModel {
  group: THREE.Group;
  water: THREE.Mesh;
  heightAt(x: number, z: number): number;
  isLand(x: number, z: number): boolean;
  coastDistance(x: number, z: number): number;
  trackDistance(x: number, z: number): number;
  biome(x: number, z: number): { north: number; desert: number; prairie: number };
  update(time: number): void;
}

function scanlineFill(rings: number[][], nx: number, nz: number, cell: number, out: Uint8Array, value: number) {
  const xs: number[] = [];
  for (let j = 0; j <= nz; j++) {
    const y = -(BOARD.minZ + j * cell);
    xs.length = 0;
    for (const r of rings) {
      const n = r.length / 2;
      for (let k = 0; k < n; k++) {
        const y1 = r[2 * k + 1];
        const k2 = (k + 1) % n;
        const y2 = r[2 * k2 + 1];
        if (y1 > y !== y2 > y) {
          const x1 = r[2 * k];
          const x2 = r[2 * k2];
          xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
        }
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - BOARD.minX) / cell));
      const i1 = Math.min(nx, Math.floor((xs[k + 1] - BOARD.minX) / cell));
      for (let i = i0; i <= i1; i++) out[j * (nx + 1) + i] = value;
    }
  }
}

/** Two-pass chamfer distance (in cells) from every vertex to the nearest vertex where target() is true. */
function distanceField(nx: number, nz: number, target: (idx: number) => boolean): Float32Array {
  const W = nx + 1;
  const H = nz + 1;
  const d = new Float32Array(W * H);
  for (let k = 0; k < d.length; k++) d[k] = target(k) ? 0 : 1e6;
  const D = Math.SQRT2;
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + 1);
      if (j > 0) {
        v = Math.min(v, d[k - W] + 1);
        if (i > 0) v = Math.min(v, d[k - W - 1] + D);
        if (i < W - 1) v = Math.min(v, d[k - W + 1] + D);
      }
      d[k] = v;
    }
  for (let j = H - 1; j >= 0; j--)
    for (let i = W - 1; i >= 0; i--) {
      const k = j * W + i;
      let v = d[k];
      if (i < W - 1) v = Math.min(v, d[k + 1] + 1);
      if (j < H - 1) {
        v = Math.min(v, d[k + W] + 1);
        if (i < W - 1) v = Math.min(v, d[k + W + 1] + D);
        if (i > 0) v = Math.min(v, d[k + W - 1] + D);
      }
      d[k] = v;
    }
  return d;
}

export function buildTerrain(opts: { cell: number }): TerrainModel {
  const cell = opts.cell;
  const nx = Math.ceil(BOARD.width / cell);
  const nz = Math.ceil(BOARD.depth / cell);
  const W = nx + 1;
  const count = W * (nz + 1);
  const vx = (i: number) => Math.min(BOARD.maxX, BOARD.minX + i * cell);
  const vz = (j: number) => Math.min(BOARD.maxZ, BOARD.minZ + j * cell);

  // land / lake masks
  const mask = new Uint8Array(count);
  scanlineFill(geo.land, nx, nz, cell, mask, 1);
  const lake = new Uint8Array(count);
  scanlineFill(geo.lakes, nx, nz, cell, lake, 1);
  for (let k = 0; k < count; k++) if (lake[k]) mask[k] = 0;

  const toWater = distanceField(nx, nz, (k) => mask[k] === 0);
  const toLand = distanceField(nx, nz, (k) => mask[k] === 1);

  const heights = new Float32Array(count);
  const track = new Float32Array(count);
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const k = j * W + i;
      const x = vx(i);
      const z = vz(j);
      const td = distanceToTrack(x, z);
      track[k] = td;
      if (mask[k]) {
        const bed = bedHeight(x, z);
        const detail = (fbm(x * 0.45, z * 0.45, 3, 3) - 0.5) * 0.16;
        const north = smoothstep(-12, -18, z);
        const shield = north * smoothstep(-2, 6, x) * fbm(x * 0.7, z * 0.7, 2, 41) * 0.25;
        let h = bed + detail + mountainHeight(x, z) + shield;
        // rail beds: flatten terrain around tracks and city pads
        const carve = 1 - smoothstep(0.3, 0.8, td);
        h = h + (bed - 0.02 - h) * carve;
        // coastline ramp
        const coast = smoothstep(0.5, 2.6, toWater[k]);
        h = 0.05 + (h - 0.05) * coast;
        if (carve > 0.5) h = Math.max(h, bed - 0.02 - (1 - coast) * 0.15);
        heights[k] = h;
      } else {
        const depth = Math.min(toLand[k], 7);
        heights[k] = (lake[k] ? -0.1 : -0.12) - depth * (lake[k] ? 0.03 : 0.055);
      }
    }
  }

  // ---- triangles with per-face colors (non-indexed => crisp low-poly facets)
  const cells = nx * nz;
  const pos = new Float32Array(cells * 18);
  const col = new Float32Array(cells * 18);
  const tmp = new THREE.Color();
  const face = new THREE.Color();
  let p = 0;
  const pushTri = (ax: number, az: number, ah: number, bx: number, bz: number, bh: number, cx: number, cz: number, ch: number, landCount: number, trackMin: number) => {
    pos.set([ax, ah, az, bx, bh, bz, cx, ch, cz], p);
    const fx = (ax + bx + cx) / 3;
    const fz = (az + bz + cz) / 3;
    const fh = (ah + bh + ch) / 3;
    if (landCount === 0 || fh < 0.0) {
      face.copy(COL.seabedDeep).lerp(COL.seabedShallow, smoothstep(-0.5, -0.05, fh));
    } else {
      biomeColor(fx, fz, face);
      const bed = bedHeight(fx, fz);
      const relief = fh - bed;
      // steepness from the face normal
      const ux = bx - ax, uy = bh - ah, uz = bz - az;
      const vx2 = cx - ax, vy = ch - ah, vz2 = cz - az;
      const nx2 = uy * vz2 - uz * vy;
      const ny = uz * vx2 - ux * vz2;
      const nz2 = ux * vy - uy * vx2;
      const steep = 1 - Math.abs(ny) / Math.hypot(nx2, ny, nz2);
      if (fh < 0.16) face.lerp(COL.sand, 0.8);
      else if (fh < 0.22) face.lerp(COL.sand, 0.35);
      const rockiness = Math.max(smoothstep(0.35, 0.8, relief), smoothstep(0.35, 0.6, steep));
      face.lerp(valueNoise(fx * 2, fz * 2, 4) > 0.5 ? COL.rock : COL.rockDark, rockiness);
      if (relief > 1.15 + valueNoise(fx * 3, fz * 3, 8) * 0.35) face.copy(COL.snow);
      if (trackMin < 0.36) face.lerp(COL.bed, 0.55);
    }
    const shade = 0.94 + valueNoise(fx * 5.3, fz * 5.3, 77) * 0.1;
    tmp.copy(face).multiplyScalar(shade);
    for (let v = 0; v < 3; v++) col.set([tmp.r, tmp.g, tmp.b], p + v * 3);
    p += 9;
  };

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k00 = j * W + i;
      const k10 = k00 + 1;
      const k01 = k00 + W;
      const k11 = k01 + 1;
      const x0 = vx(i), x1 = vx(i + 1), z0 = vz(j), z1 = vz(j + 1);
      const h00 = heights[k00], h10 = heights[k10], h01 = heights[k01], h11 = heights[k11];
      const l00 = mask[k00], l10 = mask[k10], l01 = mask[k01], l11 = mask[k11];
      if ((i + j) % 2 === 0) {
        pushTri(x0, z0, h00, x0, z1, h01, x1, z0, h10, l00 + l01 + l10, Math.min(track[k00], track[k01], track[k10]));
        pushTri(x1, z0, h10, x0, z1, h01, x1, z1, h11, l10 + l01 + l11, Math.min(track[k10], track[k01], track[k11]));
      } else {
        pushTri(x0, z0, h00, x0, z1, h01, x1, z1, h11, l00 + l01 + l11, Math.min(track[k00], track[k01], track[k11]));
        pushTri(x0, z0, h00, x1, z1, h11, x1, z0, h10, l00 + l11 + l10, Math.min(track[k00], track[k11], track[k10]));
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const terrain = new THREE.Mesh(
    g,
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 }),
  );
  terrain.receiveShadow = true;
  terrain.castShadow = true;
  terrain.name = 'terrain';

  // ---- water surface with gentle animated swell
  const wseg = Math.round(BOARD.width / 0.9);
  const dseg = Math.round(BOARD.depth / 0.9);
  const wg = new THREE.PlaneGeometry(BOARD.width, BOARD.depth, wseg, dseg);
  wg.rotateX(-Math.PI / 2);
  wg.translate(BOARD.cx, WATER_LEVEL, BOARD.cz);
  const water = new THREE.Mesh(
    wg,
    new THREE.MeshStandardMaterial({
      color: '#4aa8d8',
      transparent: true,
      opacity: 0.72,
      roughness: 0.25,
      metalness: 0.05,
      flatShading: true,
    }),
  );
  water.receiveShadow = true;
  water.name = 'water';
  const basePos = Float32Array.from(wg.attributes.position.array as Float32Array);

  const group = new THREE.Group();
  group.add(terrain, water);

  const idx = (x: number, z: number) => {
    const i = Math.max(0, Math.min(nx, Math.round((x - BOARD.minX) / cell)));
    const j = Math.max(0, Math.min(nz, Math.round((z - BOARD.minZ) / cell)));
    return j * W + i;
  };

  return {
    group,
    water,
    heightAt(x, z) {
      // bilinear sample of the grid
      const fx = Math.max(0, Math.min(nx - 1e-6, (x - BOARD.minX) / cell));
      const fz = Math.max(0, Math.min(nz - 1e-6, (z - BOARD.minZ) / cell));
      const i = Math.floor(fx), j = Math.floor(fz);
      const tx = fx - i, tz = fz - j;
      const k = j * W + i;
      const a = heights[k] + (heights[k + 1] - heights[k]) * tx;
      const b = heights[k + W] + (heights[k + W + 1] - heights[k + W]) * tx;
      return a + (b - a) * tz;
    },
    isLand: (x, z) => mask[idx(x, z)] === 1,
    coastDistance: (x, z) => toWater[idx(x, z)] * cell,
    trackDistance: (x, z) => track[idx(x, z)],
    biome: (x, z) => biomeColor(x, z, tmp),
    update(time) {
      const arr = wg.attributes.position.array as Float32Array;
      for (let v = 0; v < arr.length; v += 3) {
        const x = basePos[v];
        const z = basePos[v + 2];
        arr[v + 1] = WATER_LEVEL + Math.sin(x * 0.9 + time * 0.9) * 0.025 + Math.cos(z * 1.1 - time * 0.7) * 0.025;
      }
      wg.attributes.position.needsUpdate = true;
    },
  };
}
