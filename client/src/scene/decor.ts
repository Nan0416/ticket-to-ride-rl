// Scenery: forests, cacti, the wooden board frame and the table.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BOARD } from './layout.ts';
import { seeded, valueNoise } from './noise.ts';
import type { TerrainModel } from './terrain.ts';

function colored(geom: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const g = geom.index ? geom.toNonIndexed() : geom;
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

function pineGeometry() {
  const trunk = colored(new THREE.CylinderGeometry(0.03, 0.04, 0.12, 5).translate(0, 0.06, 0), '#7a5a3c');
  const low = colored(new THREE.ConeGeometry(0.17, 0.26, 6).translate(0, 0.22, 0), '#ffffff');
  const high = colored(new THREE.ConeGeometry(0.12, 0.22, 6).translate(0, 0.36, 0), '#ffffff');
  return mergeGeometries([trunk, low, high])!;
}

function roundTreeGeometry() {
  const trunk = colored(new THREE.CylinderGeometry(0.03, 0.04, 0.14, 5).translate(0, 0.07, 0), '#7a5a3c');
  const crown = colored(new THREE.IcosahedronGeometry(0.16, 0).translate(0, 0.25, 0), '#ffffff');
  return mergeGeometries([trunk, crown])!;
}

function cactusGeometry() {
  const stem = colored(new THREE.CylinderGeometry(0.035, 0.04, 0.24, 6).translate(0, 0.12, 0), '#ffffff');
  const arm1 = colored(new THREE.CylinderGeometry(0.025, 0.025, 0.1, 5).translate(0.06, 0.15, 0), '#ffffff');
  const arm2 = colored(new THREE.CylinderGeometry(0.025, 0.025, 0.08, 5).translate(-0.055, 0.12, 0), '#ffffff');
  return mergeGeometries([stem, arm1, arm2])!;
}

export function buildDecor(terrain: TerrainModel, quality: 'high' | 'low'): THREE.Group {
  const group = new THREE.Group();
  const rand = seeded(1234);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });

  const pines: THREE.Matrix4[] = [];
  const pineColors: THREE.Color[] = [];
  const rounds: THREE.Matrix4[] = [];
  const roundColors: THREE.Color[] = [];
  const cacti: THREE.Matrix4[] = [];

  const target = quality === 'high' ? 3600 : 1600;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pineGreens = ['#3f7a4a', '#4b8a50', '#356b45', '#5a9655'].map((c) => new THREE.Color(c));
  const leafGreens = ['#6fae4f', '#8cbf55', '#5f9e48', '#a7c45a', '#d49a3f'].map((c) => new THREE.Color(c));

  for (let tries = 0; tries < target * 8 && pines.length + rounds.length + cacti.length < target; tries++) {
    const x = BOARD.minX + 0.5 + rand() * (BOARD.width - 1);
    const z = BOARD.minZ + 0.5 + rand() * (BOARD.depth - 1);
    if (!terrain.isLand(x, z)) continue;
    if (terrain.coastDistance(x, z) < 0.5) continue;
    if (terrain.trackDistance(x, z) < 0.62) continue;
    const h = terrain.heightAt(x, z);
    const b = terrain.biome(x, z);
    // clustered forests
    const clump = valueNoise(x * 0.55, z * 0.55, 99);
    let pPine = 0.15 + 0.75 * b.north;
    let pRound = 0.55 * (1 - b.north) * (1 - b.prairie) * (1 - b.desert);
    pPine *= 1 - b.desert;
    pPine *= 1 - 0.85 * b.prairie;
    if (h > 1.2) pPine *= 0.2; // above tree line
    const s = 0.75 + rand() * 0.55;
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    if (b.desert > 0.6) {
      if (rand() < 0.08) cacti.push(new THREE.Matrix4().compose(new THREE.Vector3(x, h - 0.01, z), q, new THREE.Vector3(s, s, s)));
      continue;
    }
    const r = rand();
    if (clump < 0.42) continue;
    if (r < pPine * clump) {
      m.compose(new THREE.Vector3(x, h - 0.02, z), q, new THREE.Vector3(s, s * (0.9 + rand() * 0.4), s));
      pines.push(m.clone());
      pineColors.push(pineGreens[Math.floor(rand() * pineGreens.length)]);
    } else if (r < (pPine + pRound) * clump) {
      m.compose(new THREE.Vector3(x, h - 0.02, z), q, new THREE.Vector3(s, s, s));
      rounds.push(m.clone());
      // a few autumn trees in the north-east
      const autumn = x > 8 && z < -2 && rand() < 0.3;
      roundColors.push(autumn ? leafGreens[4] : leafGreens[Math.floor(rand() * 4)]);
    }
  }

  const addInstanced = (geom: THREE.BufferGeometry, mats: THREE.Matrix4[], colors?: THREE.Color[], tint?: string) => {
    if (!mats.length) return;
    const mesh = new THREE.InstancedMesh(geom, mat, mats.length);
    const tintC = tint ? new THREE.Color(tint) : null;
    mats.forEach((mm, i) => {
      mesh.setMatrixAt(i, mm);
      mesh.setColorAt(i, colors ? colors[i] : tintC!);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  addInstanced(pineGeometry(), pines, pineColors);
  addInstanced(roundTreeGeometry(), rounds, roundColors);
  addInstanced(cactusGeometry(), cacti, undefined, '#6f9a4e');

  group.add(buildFrame());
  return group;
}

function buildFrame(): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: '#8b5e3c', roughness: 0.75, flatShading: true });
  const woodDark = new THREE.MeshStandardMaterial({ color: '#5e3d26', roughness: 0.8, flatShading: true });
  const T = 0.9; // frame thickness
  const top = 0.32;
  const bottom = -1.25;
  const H = top - bottom;
  const W = BOARD.width;
  const D = BOARD.depth;
  const pieces: [number, number, number, number][] = [
    // x, z, sizeX, sizeZ
    [BOARD.cx, BOARD.minZ - T / 2, W + 2 * T, T],
    [BOARD.cx, BOARD.maxZ + T / 2, W + 2 * T, T],
    [BOARD.minX - T / 2, BOARD.cz, T, D],
    [BOARD.maxX + T / 2, BOARD.cz, T, D],
  ];
  for (const [x, z, sx, sz] of pieces) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, H, sz), wood);
    mesh.position.set(x, bottom + H / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    // bevel strip on top
    const lip = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.08, 0.08, sz + 0.08), woodDark);
    lip.position.set(x, top + 0.04, z);
    lip.receiveShadow = true;
    g.add(lip);
  }
  const base = new THREE.Mesh(new THREE.BoxGeometry(W, 0.6, D), woodDark);
  base.position.set(BOARD.cx, bottom + 0.3, BOARD.cz);
  base.receiveShadow = true;
  g.add(base);

  // table
  const table = new THREE.Mesh(
    new THREE.CircleGeometry(140, 48),
    new THREE.MeshStandardMaterial({ color: '#6d4c37', roughness: 0.9 }),
  );
  table.rotation.x = -Math.PI / 2;
  table.position.set(BOARD.cx, bottom, BOARD.cz);
  table.receiveShadow = true;
  g.add(table);
  return g;
}
