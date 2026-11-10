// Game pieces on the board: city stations + labels, route slots, train cars,
// selection/hover highlights and route picking.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CARD_HEX, PLAYER_COLOR_HEX, type PlayerColor } from '../../../shared/cards.ts';
import { CITIES } from '../../../shared/map/index.ts';
import { CITY_POS, CITY_RADIUS, ROUTE_LAYOUTS, type SlotLayout } from './layout.ts';
import { bedHeight } from './terrain.ts';

const SLOT_W = 0.34;
const SLOT_H = 0.06;
const LIFT = 0.012;

function colored(geom: THREE.BufferGeometry, hex: string) {
  const g = geom.index ? geom.toNonIndexed() : geom;
  const c = new THREE.Color(hex);
  const arr = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < g.attributes.position.count; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

/** Unit-length (along x) freight car. Vertex colors get multiplied by the player color. */
function carGeometry() {
  return mergeGeometries([
    colored(new THREE.BoxGeometry(0.74, 0.06, 0.22).translate(0, 0.04, 0), '#2a2420'), // chassis + wheels
    colored(new THREE.BoxGeometry(0.88, 0.19, 0.36).translate(0, 0.165, 0), '#d9d9d9'), // body
    colored(new THREE.BoxGeometry(0.92, 0.045, 0.4).translate(0, 0.28, 0), '#ffffff'), // roof
  ])!;
}

/** Untinted details (roof stripe + door trims), drawn with the same matrices as the body. */
function roofGeometry() {
  return mergeGeometries([
    colored(new THREE.BoxGeometry(0.78, 0.014, 0.08).translate(0, 0.309, 0), '#fff1d6'),
    colored(new THREE.BoxGeometry(0.045, 0.13, 0.365).translate(-0.25, 0.165, 0), '#f3ead8'),
    colored(new THREE.BoxGeometry(0.045, 0.13, 0.365).translate(0.25, 0.165, 0), '#f3ead8'),
  ])!;
}

function stationGeometry() {
  const roof = new THREE.ConeGeometry(0.2, 0.13, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(0.05, 0.31, -0.05);
  return mergeGeometries([
    colored(new THREE.CylinderGeometry(CITY_RADIUS + 0.05, CITY_RADIUS + 0.08, 0.08, 14).translate(0, 0.04, 0), '#5b4636'),
    colored(new THREE.CylinderGeometry(CITY_RADIUS, CITY_RADIUS, 0.1, 14).translate(0, 0.07, 0), '#f3e7cc'),
    colored(new THREE.BoxGeometry(0.26, 0.16, 0.2).translate(0.05, 0.2, -0.05), '#e9d6ad'),
    colored(roof, '#b9553e'),
    colored(new THREE.BoxGeometry(0.05, 0.06, 0.205).translate(0.05, 0.17, -0.05), '#6a4b37'),
  ])!;
}

interface SlotRef {
  route: number;
  slot: SlotLayout;
  y: number;
  pitch: number;
}

export interface BoardPieces {
  group: THREE.Group;
  labels: CSS2DObject[];
  pick(ray: THREE.Raycaster): string | null;
  setClaims(claims: Record<string, number>, colors: PlayerColor[], animate: boolean): void;
  setHover(routeId: string | null): void;
  setSelected(routeId: string | null, ghostColor?: PlayerColor): void;
  setFocusCities(ids: string[]): void;
  setContractCities(ids: string[]): void;
  update(time: number, dt: number): void;
  routeCenter(routeId: string): THREE.Vector3;
}

export function buildBoard(): BoardPieces {
  const group = new THREE.Group();
  const labels: CSS2DObject[] = [];

  // ---- cities
  const stationGeom = stationGeometry();
  const stationMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8 });
  const stations = new THREE.InstancedMesh(stationGeom, stationMat, CITIES.length);
  const labelById = new Map<string, HTMLDivElement>();
  CITIES.forEach((c, i) => {
    const p = CITY_POS.get(c.id)!;
    const y = bedHeight(p.x, p.z) - 0.03;
    stations.setMatrixAt(i, new THREE.Matrix4().makeRotationY((i * 1.7) % (Math.PI * 2)).setPosition(p.x, y, p.z));
    const el = document.createElement('div');
    el.className = 'city-label';
    el.textContent = c.name;
    const label = new CSS2DObject(el);
    label.position.set(p.x, y + 0.5, p.z);
    label.center.set(0.5, 1);
    group.add(label);
    labels.push(label);
    labelById.set(c.id, el);
  });
  stations.castShadow = true;
  stations.receiveShadow = true;
  group.add(stations);

  // ---- route slots
  const slots: SlotRef[] = [];
  const routeSlotIndex: number[][] = [];
  ROUTE_LAYOUTS.forEach((rl, ri) => {
    routeSlotIndex.push([]);
    for (const s of rl.slots) {
      const ha = bedHeight(s.ax, s.az);
      const hb = bedHeight(s.bx, s.bz);
      routeSlotIndex[ri].push(slots.length);
      slots.push({ route: ri, slot: s, y: (ha + hb) / 2 + LIFT, pitch: Math.atan2(hb - ha, s.len) });
    }
  });
  const routeIndexById = new Map(ROUTE_LAYOUTS.map((r, i) => [r.route.id, i]));

  const slotMat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.0, flatShading: true });
  const slotMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, SLOT_H, SLOT_W), slotMat, slots.length);
  const edgeMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, SLOT_H * 0.7, SLOT_W + 0.07),
    new THREE.MeshStandardMaterial({ color: '#3b3229', roughness: 0.9 }),
    slots.length,
  );
  const hitMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 0.6, 0.62),
    new THREE.MeshBasicMaterial({ visible: false }),
    slots.length,
  );
  const ghostMesh = new THREE.InstancedMesh(
    carGeometry(),
    new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false }),
    8,
  );
  for (let k = 0; k < 8; k++) ghostMesh.setColorAt(k, new THREE.Color('#ffffff'));
  ghostMesh.count = 0;
  const carMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.5, metalness: 0.05 });
  const carMesh = new THREE.InstancedMesh(carGeometry(), carMat, slots.length);
  const roofMesh = new THREE.InstancedMesh(roofGeometry(), carMat.clone(), slots.length);

  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpE = new THREE.Euler();
  const tmpV = new THREE.Vector3();
  const tmpS = new THREE.Vector3();
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

  const slotMatrix = (s: SlotRef, yOff: number, sx: number, sy = 1, sz = 1) => {
    tmpE.set(0, s.slot.yaw, s.pitch, 'YXZ');
    tmpQ.setFromEuler(tmpE);
    tmpV.set(s.slot.x, s.y + yOff, s.slot.z);
    tmpS.set(sx, sy, sz);
    return tmpM.compose(tmpV, tmpQ, tmpS);
  };

  const baseColors: THREE.Color[] = [];
  slots.forEach((s, i) => {
    const color = new THREE.Color(CARD_HEX[ROUTE_LAYOUTS[s.route].route.color]);
    baseColors.push(color);
    slotMesh.setMatrixAt(i, slotMatrix(s, SLOT_H / 2, s.slot.len));
    slotMesh.setColorAt(i, color);
    edgeMesh.setMatrixAt(i, slotMatrix(s, SLOT_H * 0.3, s.slot.len + 0.06));
    hitMesh.setMatrixAt(i, slotMatrix(s, 0.2, s.slot.len + 0.1));
    carMesh.setMatrixAt(i, ZERO);
    roofMesh.setMatrixAt(i, ZERO);
    carMesh.setColorAt(i, new THREE.Color('#ffffff'));
  });
  hitMesh.computeBoundingSphere();
  slotMesh.receiveShadow = true;
  slotMesh.castShadow = true;
  edgeMesh.receiveShadow = true;
  for (const m of [carMesh, roofMesh]) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
  }
  ghostMesh.frustumCulled = false;
  group.add(edgeMesh, slotMesh, carMesh, roofMesh, ghostMesh, hitMesh);

  // ---- focus rings for highlighted contract cities
  const ringGeom = new THREE.TorusGeometry(CITY_RADIUS + 0.16, 0.05, 6, 28);
  ringGeom.rotateX(Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ color: '#ffe066' });
  const rings = [0, 1].map(() => {
    const r = new THREE.Mesh(ringGeom, ringMat);
    r.visible = false;
    group.add(r);
    return r;
  });

  // ---- state
  let claimed: Record<string, number> = {};
  let hovered: number | null = null;
  let selected: number | null = null;
  interface Drop {
    slot: number;
    start: number;
  }
  let drops: Drop[] = [];
  let clock = 0;
  const DROP_MS = 0.5;

  const restSlotColor = (i: number) => {
    const s = slots[i];
    const c = tmpColor.copy(baseColors[i]);
    const rid = ROUTE_LAYOUTS[s.route].route.id;
    if (claimed[rid] !== undefined) c.lerp(darkBed, 0.8);
    return c;
  };
  const tmpColor = new THREE.Color();
  const darkBed = new THREE.Color('#3b3229');
  const white = new THREE.Color('#ffffff');

  const repaintRoute = (ri: number, time = clock) => {
    for (const i of routeSlotIndex[ri]) {
      const c = restSlotColor(i);
      let lift = 0;
      if (ri === selected) {
        c.lerp(white, 0.3 + 0.25 * Math.sin(time * 6));
        lift = 0.05;
      } else if (ri === hovered) c.lerp(white, 0.35);
      slotMesh.setColorAt(i, c);
      slotMesh.setMatrixAt(i, slotMatrix(slots[i], SLOT_H / 2 + lift, slots[i].slot.len));
    }
    slotMesh.instanceColor!.needsUpdate = true;
    slotMesh.instanceMatrix.needsUpdate = true;
  };

  const setCarMatrix = (i: number, m: THREE.Matrix4) => {
    carMesh.setMatrixAt(i, m);
    roofMesh.setMatrixAt(i, m);
  };
  const placeCar = (i: number, yOff: number) => {
    const s = slots[i];
    setCarMatrix(i, slotMatrix(s, SLOT_H + yOff - 0.01, s.slot.len * 0.98, 1, 1));
  };
  const carsChanged = () => {
    carMesh.instanceMatrix.needsUpdate = true;
    roofMesh.instanceMatrix.needsUpdate = true;
  };

  const api: BoardPieces = {
    group,
    labels,
    pick(ray) {
      const hit = ray.intersectObject(hitMesh, false)[0];
      if (!hit || hit.instanceId === undefined) return null;
      return ROUTE_LAYOUTS[slots[hit.instanceId].route].route.id;
    },
    setClaims(claims, colors, animate) {
      const prev = claimed;
      claimed = { ...claims };
      let order = 0;
      ROUTE_LAYOUTS.forEach((rl, ri) => {
        const owner = claims[rl.route.id];
        const was = prev[rl.route.id];
        if (owner === was) return;
        routeSlotIndex[ri].forEach((si, k) => {
          if (owner === undefined) {
            setCarMatrix(si, ZERO);
            return;
          }
          carMesh.setColorAt(si, new THREE.Color(PLAYER_COLOR_HEX[colors[owner]]));
          if (animate) {
            drops.push({ slot: si, start: clock + 0.08 * (order + k) });
            setCarMatrix(si, ZERO); // hidden until its drop starts
          } else placeCar(si, 0);
        });
        if (owner !== undefined && animate) order += routeSlotIndex[ri].length;
        repaintRoute(ri);
      });
      carsChanged();
      if (carMesh.instanceColor) carMesh.instanceColor.needsUpdate = true;
    },
    setHover(routeId) {
      const ri = routeId ? routeIndexById.get(routeId) ?? null : null;
      if (ri === hovered) return;
      const old = hovered;
      hovered = ri;
      if (old !== null) repaintRoute(old);
      if (ri !== null) repaintRoute(ri);
    },
    setSelected(routeId, ghostColor) {
      const ri = routeId ? routeIndexById.get(routeId) ?? null : null;
      const old = selected;
      selected = ri;
      if (old !== null) repaintRoute(old);
      if (ri !== null) repaintRoute(ri);
      // ghost preview cars in the player's color
      ghostMesh.count = 0;
      if (ri !== null && ghostColor) {
        const c = new THREE.Color(PLAYER_COLOR_HEX[ghostColor]);
        routeSlotIndex[ri].forEach((si, k) => {
          const s = slots[si];
          ghostMesh.setMatrixAt(k, slotMatrix(s, SLOT_H + 0.06, s.slot.len * 0.98));
          ghostMesh.setColorAt(k, c);
        });
        ghostMesh.count = routeSlotIndex[ri].length;
        ghostMesh.instanceMatrix.needsUpdate = true;
        if (ghostMesh.instanceColor) ghostMesh.instanceColor.needsUpdate = true;
      }
    },
    setFocusCities(ids) {
      rings.forEach((r, i) => {
        const id = ids[i];
        const p = id ? CITY_POS.get(id) : undefined;
        r.visible = !!p;
        if (p) r.position.set(p.x, bedHeight(p.x, p.z) + 0.1, p.z);
      });
      for (const [id, el] of labelById) el.classList.toggle('focus', ids.includes(id));
    },
    setContractCities(ids) {
      for (const [id, el] of labelById) el.classList.toggle('mine', ids.includes(id));
    },
    update(time) {
      clock = time;
      if (selected !== null) repaintRoute(selected, time);
      if (drops.length) {
        const remaining: Drop[] = [];
        for (const d of drops) {
          const t = (time - d.start) / DROP_MS;
          if (t < 0) {
            remaining.push(d);
            continue;
          }
          if (t >= 1) {
            placeCar(d.slot, 0);
            continue;
          }
          // fall + small bounce
          const fall = 1 - t;
          const bounce = t > 0.7 ? Math.sin(((t - 0.7) / 0.3) * Math.PI) * 0.08 : 0;
          placeCar(d.slot, fall * fall * 2.2 + bounce);
          remaining.push(d);
        }
        drops = remaining;
        carsChanged();
      }
      const pulse = 1 + Math.sin(time * 4) * 0.08;
      for (const r of rings) r.scale.setScalar(pulse);
    },
    routeCenter(routeId) {
      const rl = ROUTE_LAYOUTS[routeIndexById.get(routeId)!];
      return new THREE.Vector3(rl.mid.x, bedHeight(rl.mid.x, rl.mid.z), rl.mid.z);
    },
  };
  return api;
}
