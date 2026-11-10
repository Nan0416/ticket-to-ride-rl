// Lambert conformal conic projection tuned for North America.
// Output units are roughly "degrees of latitude" (1 unit ~ 111 km) so the
// board is about 65 x 45 units. +x is east, +y is north.

const DEG = Math.PI / 180;
const PHI1 = 33 * DEG;
const PHI2 = 45 * DEG;
const PHI0 = 37 * DEG;
const LAM0 = -96 * DEG;
const SCALE = 180 / Math.PI;

const N =
  Math.log(Math.cos(PHI1) / Math.cos(PHI2)) /
  Math.log(Math.tan(Math.PI / 4 + PHI2 / 2) / Math.tan(Math.PI / 4 + PHI1 / 2));
const F = (Math.cos(PHI1) * Math.pow(Math.tan(Math.PI / 4 + PHI1 / 2), N)) / N;
const RHO0 = F / Math.pow(Math.tan(Math.PI / 4 + PHI0 / 2), N);

export interface Point2 {
  x: number;
  y: number;
}

export function project(lon: number, lat: number): Point2 {
  const rho = F / Math.pow(Math.tan(Math.PI / 4 + (lat * DEG) / 2), N);
  const theta = N * (lon * DEG - LAM0);
  return {
    x: rho * Math.sin(theta) * SCALE,
    y: (RHO0 - rho * Math.cos(theta)) * SCALE,
  };
}
