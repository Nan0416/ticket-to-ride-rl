import { CITIES, type City } from './cities.ts';
import { ROUTES, type Route } from './routes.ts';
import { CONTRACTS, type Contract } from './contracts.ts';

export type { City, Route, Contract };
export { CITIES, ROUTES, CONTRACTS };

export const CITY_BY_ID = new Map(CITIES.map((c) => [c.id, c]));
export const ROUTE_BY_ID = new Map(ROUTES.map((r) => [r.id, r]));
export const CONTRACT_BY_ID = new Map(CONTRACTS.map((t) => [t.id, t]));

export function cityName(id: string): string {
  return CITY_BY_ID.get(id)?.name ?? id;
}
