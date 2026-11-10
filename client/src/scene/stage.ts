// Renderer, camera, orbit controls, lights, labels and input → route picking.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import type { PlayerColor } from '../../../shared/cards.ts';
import { buildBoard, type BoardPieces } from './board.ts';
import { buildDecor } from './decor.ts';
import { BOARD, CITY_POS } from './layout.ts';
import { bedHeight, buildTerrain } from './terrain.ts';

export interface Stage {
  board: BoardPieces;
  onPick(cb: (routeId: string | null) => void): void;
  setInteractive(on: boolean): void;
  setIdle(on: boolean): void;
  flyTo(x: number, z: number, distance?: number): void;
  flyToCities(ids: string[]): void;
  resetView(): void;
}

export function createStage(container: HTMLElement): Stage {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const quality: 'high' | 'low' = coarse || Math.min(innerWidth, innerHeight) < 600 ? 'low' : 'high';

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, quality === 'high' ? 2 : 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'label-layer';
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#bcd9e6');
  scene.fog = new THREE.Fog('#bcd9e6', 90, 190);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 400);

  // lights
  const hemi = new THREE.HemisphereLight('#fff7e8', '#6d5a48', 1.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff0d8', 2.6);
  sun.position.set(BOARD.cx - 22, 40, BOARD.cz + 18);
  sun.target.position.set(BOARD.cx, 0, BOARD.cz);
  sun.castShadow = true;
  const sm = quality === 'high' ? 4096 : 2048;
  sun.shadow.mapSize.set(sm, sm);
  const sc = sun.shadow.camera;
  sc.left = -36;
  sc.right = 36;
  sc.top = 32;
  sc.bottom = -32;
  sc.near = 5;
  sc.far = 110;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  // world
  const terrain = buildTerrain({ cell: quality === 'high' ? 0.28 : 0.36 });
  scene.add(terrain.group);
  scene.add(buildDecor(terrain, quality));
  const board = buildBoard();
  scene.add(board.group);

  // controls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = false;
  controls.minDistance = 5;
  controls.maxDistance = 85;
  controls.minPolarAngle = 0.05;
  controls.maxPolarAngle = 1.25;
  controls.zoomToCursor = true;
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.autoRotateSpeed = 0.35;

  const home = () => {
    const aspect = camera.aspect;
    const vfov = (camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const dW = (BOARD.width / 2) * 1.02 / Math.tan(hfov / 2);
    const dD = (BOARD.depth / 2) * 1.05 / Math.tan(vfov / 2);
    // portrait phones start closer (pan to explore); everything else fits the board
    const d = Math.min(Math.max(dW, dD) * 0.95, aspect < 0.8 ? 44 : 85);
    const polar = 0.62;
    return {
      target: new THREE.Vector3(BOARD.cx + 1, 0, BOARD.cz + 1.5),
      pos: new THREE.Vector3(BOARD.cx + 1, d * Math.cos(polar), BOARD.cz + 1.5 + d * Math.sin(polar)),
    };
  };

  const resize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  new ResizeObserver(resize).observe(container);
  const h0 = home();
  camera.position.copy(h0.pos);
  controls.target.copy(h0.target);

  // smooth camera flights
  let flight: { fromT: THREE.Vector3; toT: THREE.Vector3; fromP: THREE.Vector3; toP: THREE.Vector3; t: number } | null = null;
  const fly = (toT: THREE.Vector3, toP: THREE.Vector3) => {
    flight = { fromT: controls.target.clone(), toT, fromP: camera.position.clone(), toP, t: 0 };
  };

  // ---- picking
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let pickCb: (id: string | null) => void = () => {};
  let interactive = false;
  let down: { x: number; y: number; t: number } | null = null;
  const toNdc = (e: PointerEvent) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  };
  renderer.domElement.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
    flight = null;
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || !interactive) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const dt = performance.now() - down.t;
    down = null;
    if (moved > 8 || dt > 700) return;
    toNdc(e);
    pickCb(board.pick(raycaster));
  });
  let hoverQueued: PointerEvent | null = null;
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || !interactive) return;
    hoverQueued = e;
  });
  renderer.domElement.addEventListener('pointerleave', () => board.setHover(null));

  // ---- loop
  const timer = new THREE.Timer();
  timer.connect(document);
  const tmp = new THREE.Vector3();
  renderer.setAnimationLoop((timestamp) => {
    timer.update(timestamp);
    const time = timer.getElapsed();
    const dt = Math.min(timer.getDelta(), 0.1);
    if (flight) {
      flight.t = Math.min(1, flight.t + dt / 0.9);
      const k = 1 - Math.pow(1 - flight.t, 3);
      controls.target.lerpVectors(flight.fromT, flight.toT, k);
      camera.position.lerpVectors(flight.fromP, flight.toP, k);
      if (flight.t >= 1) flight = null;
    }
    controls.update();
    // keep the view over the board
    const t = controls.target;
    tmp.set(
      THREE.MathUtils.clamp(t.x, BOARD.minX + 2, BOARD.maxX - 2) - t.x,
      -t.y,
      THREE.MathUtils.clamp(t.z, BOARD.minZ + 2, BOARD.maxZ - 2) - t.z,
    );
    if (tmp.lengthSq() > 0) {
      t.add(tmp);
      camera.position.add(tmp);
    }
    if (hoverQueued) {
      toNdc(hoverQueued);
      const id = board.pick(raycaster);
      board.setHover(id);
      renderer.domElement.style.cursor = id ? 'pointer' : '';
      hoverQueued = null;
    }
    terrain.update(time);
    board.update(time, dt);
    // shrink labels as the camera pulls back
    const dist = camera.position.distanceTo(controls.target);
    const touch = quality === 'low';
    container.style.setProperty('--label-scale', String(THREE.MathUtils.clamp((touch ? 40 : 34) / dist, touch ? 0.78 : 0.55, 1.3)));
    container.classList.toggle('labels-far', dist > (touch ? 58 : 70));
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  });

  return {
    board,
    onPick(cb) {
      pickCb = cb;
    },
    setInteractive(on) {
      interactive = on;
      if (!on) board.setHover(null);
    },
    setIdle(on) {
      controls.autoRotate = on;
    },
    flyTo(x, z, distance = 22) {
      const dir = camera.position.clone().sub(controls.target).normalize();
      const toT = new THREE.Vector3(x, bedHeight(x, z) * 0, z);
      fly(toT, toT.clone().add(dir.multiplyScalar(distance)));
    },
    flyToCities(ids) {
      const pts = ids.map((id) => CITY_POS.get(id)).filter((p) => p !== undefined);
      if (!pts.length) return;
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
      const span = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].z - pts[1].z) : 0;
      this.flyTo(cx, cz, THREE.MathUtils.clamp(span * 1.5 + 14, 16, 70));
    },
    resetView() {
      const h = home();
      fly(h.target, h.pos);
    },
  };
}

export type { PlayerColor };
