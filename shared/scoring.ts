import { ROUTE_BY_ID } from './map/index.ts';

/** Union-find over cities connected by a player's claimed routes. */
export function connectivity(routeIds: string[]): (a: string, b: string) => boolean {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let p = parent.get(x) ?? x;
    if (p !== x) {
      p = find(p);
      parent.set(x, p);
    }
    return p;
  };
  for (const id of routeIds) {
    const r = ROUTE_BY_ID.get(id);
    if (!r) continue;
    const ra = find(r.a);
    const rb = find(r.b);
    if (ra !== rb) parent.set(ra, rb);
  }
  return (a, b) => find(a) === find(b);
}

/**
 * Longest continuous line: the longest trail (no route used twice, cities may
 * repeat) through a player's claimed routes, measured in cars.
 */
export function longestLine(routeIds: string[]): number {
  const adj = new Map<string, { edge: number; to: string; len: number }[]>();
  const edges = routeIds.map((id) => ROUTE_BY_ID.get(id)).filter((r) => r !== undefined);
  edges.forEach((r, i) => {
    if (!adj.has(r.a)) adj.set(r.a, []);
    if (!adj.has(r.b)) adj.set(r.b, []);
    adj.get(r.a)!.push({ edge: i, to: r.b, len: r.length });
    adj.get(r.b)!.push({ edge: i, to: r.a, len: r.length });
  });
  const used = new Uint8Array(edges.length);
  let best = 0;
  const dfs = (city: string, total: number) => {
    if (total > best) best = total;
    for (const e of adj.get(city) ?? []) {
      if (used[e.edge]) continue;
      used[e.edge] = 1;
      dfs(e.to, total + e.len);
      used[e.edge] = 0;
    }
  };
  for (const city of adj.keys()) dfs(city, 0);
  return best;
}
