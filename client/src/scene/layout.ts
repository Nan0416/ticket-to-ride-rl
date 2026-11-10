// Board-space geometry shared by terrain and pieces.
// World axes: x = east, z = south (so north is "up" on screen from the default camera), y = up.
import { CITIES, ROUTES, type Route } from '../../../shared/map/index.ts';
import { project } from '../../../shared/projection.ts';
import geo from '../generated/geo.json';

export const BOUNDS = geo.bounds as { minX: number; maxX: number; minY: number; maxY: number };
export const BOARD = {
  minX: BOUNDS.minX,
  maxX: BOUNDS.maxX,
  minZ: -BOUNDS.maxY,
  maxZ: -BOUNDS.minY,
  get width() {
    return this.maxX - this.minX;
  },
  get depth() {
    return this.maxZ - this.minZ;
  },
  get cx() {
    return (this.minX + this.maxX) / 2;
  },
  get cz() {
    return (this.minZ + this.maxZ) / 2;
  },
};

export const CITY_RADIUS = 0.42;
const CITY_INSET = 0.56;
const DOUBLE_OFFSET = 0.23;
const SLOT_GAP = 0.09;

export interface XZ {
  x: number;
  z: number;
}

export function lonLatToXZ(lon: number, lat: number): XZ {
  const p = project(lon, lat);
  return { x: p.x, z: -p.y };
}

export const CITY_POS = new Map<string, XZ>(CITIES.map((c) => [c.id, lonLatToXZ(c.lon, c.lat)]));

export interface SlotLayout {
  /** center on the ground plane */
  x: number;
  z: number;
  /** heading around +y (radians) */
  yaw: number;
  /** slot length along the track */
  len: number;
  /** 2D endpoints of this slot, for heights */
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

export interface RouteLayout {
  route: Route;
  /** centerline endpoints (after double-route offset and city inset) */
  a: XZ;
  b: XZ;
  slots: SlotLayout[];
  mid: XZ;
}

function computeRouteLayout(route: Route): RouteLayout {
  const pa = CITY_POS.get(route.a)!;
  const pb = CITY_POS.get(route.b)!;
  const dx = pb.x - pa.x;
  const dz = pb.z - pa.z;
  const L = Math.hypot(dx, dz);
  const ux = dx / L;
  const uz = dz / L;
  // perpendicular offset for double routes (stable regardless of a/b order)
  let off = 0;
  if (route.twin) off = route.id.endsWith('-1') ? -DOUBLE_OFFSET : DOUBLE_OFFSET;
  const px = -uz * off;
  const pz = ux * off;
  // a little more inset for doubles so the two tracks fan into the city
  const inset = CITY_INSET + (route.twin ? 0.06 : 0);
  const a = { x: pa.x + ux * inset + px, z: pa.z + uz * inset + pz };
  const b = { x: pb.x - ux * inset + px, z: pb.z - uz * inset + pz };
  const span = Math.hypot(b.x - a.x, b.z - a.z);
  const step = span / route.length;
  const yaw = Math.atan2(-uz, ux);
  const slots: SlotLayout[] = [];
  for (let i = 0; i < route.length; i++) {
    const t0 = i * step + SLOT_GAP / 2;
    const t1 = (i + 1) * step - SLOT_GAP / 2;
    const tm = (t0 + t1) / 2;
    slots.push({
      x: a.x + ux * tm,
      z: a.z + uz * tm,
      yaw,
      len: t1 - t0,
      ax: a.x + ux * t0,
      az: a.z + uz * t0,
      bx: a.x + ux * t1,
      bz: a.z + uz * t1,
    });
  }
  return { route, a, b, slots, mid: { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 } };
}

export const ROUTE_LAYOUTS: RouteLayout[] = ROUTES.map(computeRouteLayout);
export const ROUTE_LAYOUT_BY_ID = new Map(ROUTE_LAYOUTS.map((r) => [r.route.id, r]));

/** Distance from a point to the nearest track (or city pad). Used for carving rail beds. */
export function distanceToTrack(x: number, z: number): number {
  let best = Infinity;
  for (const r of ROUTE_LAYOUTS) {
    const dx = r.b.x - r.a.x;
    const dz = r.b.z - r.a.z;
    const t = Math.max(0, Math.min(1, ((x - r.a.x) * dx + (z - r.a.z) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(x - (r.a.x + t * dx), z - (r.a.z + t * dz));
    if (d < best) best = d;
  }
  for (const p of CITY_POS.values()) {
    const d = Math.hypot(x - p.x, z - p.z) - CITY_RADIUS;
    if (d < best) best = d;
  }
  return best;
}
