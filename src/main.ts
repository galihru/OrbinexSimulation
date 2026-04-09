import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import {
  constants,
  createUniverseEngine,
  type UniverseBody,
} from "./orbinex-compat";

import "./styles.css";

type UiLanguage = "id" | "en";

type ViewState = {
  showContext: boolean;
  showHypothesis: boolean;
  showTrails: boolean;
  showLabels: boolean;
  showAsteroids: boolean;
  showComets: boolean;
};

type UiState = {
  running: boolean;
  language: UiLanguage;
  focusName: string;
  hoverKey: string | null;
  selectedKey: string | null;
  infoPinned: boolean;
  showInfo: boolean;
  showSearch: boolean;
  showHelp: boolean;
};

type BodyNode = {
  key: string;
  body: UniverseBody;
  mesh: THREE.Mesh;
  label: THREE.Sprite | null;
  trail: THREE.Line | null;
  trailPoints: THREE.Vector3[];
};

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }
  return element as T;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function bodyKey(body: UniverseBody): string {
  return `${body.kind}:${body.name}`;
}

function bodyLooksRocky(body: UniverseBody): boolean {
  return body.kind === "meteor" || body.name.startsWith("Asteroid-") || body.name.startsWith("Kuiper-") || body.name.startsWith("Meteor-");
}

function bodyLooksComet(body: UniverseBody): boolean {
  return body.kind === "comet" || body.name.startsWith("Comet-");
}

function hexToColor(hex: string, fallback = 0x89b6ff): number {
  if (/^#[0-9a-f]{6}$/i.test(hex)) {
    return Number.parseInt(hex.slice(1), 16);
  }
  return fallback;
}

function formatExp(value: number): string {
  return value.toExponential(4);
}

function formatMass(value: number): string {
  if (value >= 1e27) {
    return `${(value / 1e27).toFixed(3)}e27 kg`;
  }
  if (value >= 1e24) {
    return `${(value / 1e24).toFixed(3)}e24 kg`;
  }
  if (value >= 1e18) {
    return `${(value / 1e18).toFixed(3)}e18 kg`;
  }
  return `${value.toFixed(1)} kg`;
}

function formatRadius(value: number): string {
  if (value >= 1e9) {
    return `${(value / 1e9).toFixed(3)}e9 m`;
  }
  return `${(value / 1000).toLocaleString()} km`;
}

const app = byId<HTMLElement>("app");
app.innerHTML = `
  <main id="sim-main" class="sim-root" aria-label="Orbinex full canvas simulation">
    <canvas id="universe-canvas" aria-label="Kanvas simulasi semesta tiga dimensi"></canvas>

    <section id="splash" class="splash is-visible" role="dialog" aria-modal="true" aria-label="Memuat OrbinexSimulation">
      <img src="/orbinex-logo.svg" alt="Logo Orbinex" width="128" height="128" />
      <p class="splash-kicker">ORBINEXSIMULATION</p>
      <h1>Universe Sandbox Scientific 3D</h1>
      <p id="splash-status">Menyalakan mesin fisika...</p>
      <progress id="splash-progress" max="100" value="8" aria-label="Kemajuan memuat simulasi"></progress>
    </section>

    <header class="top-command" aria-label="Quick controls">
      <div class="brand-mark">
        <strong>Orbinex</strong>
        <span>Web Universe Sandbox</span>
      </div>
      <div class="button-row">
        <button id="btn-run" type="button">JEDA</button>
        <button id="btn-focus" type="button">FOKUS+</button>
        <button id="btn-trail" type="button">JEJAK</button>
        <button id="btn-label" type="button">LABEL</button>
        <button id="btn-info" type="button">INFO</button>
        <button id="btn-search" type="button">CARI</button>
        <button id="btn-ref" type="button">REF</button>
        <button id="btn-help" type="button">BANTU</button>
        <button id="btn-language" type="button">BAHASA: ID</button>
      </div>
    </header>

    <aside class="hud-panel" aria-live="polite">
      <pre id="hud-text">Memuat telemetry...</pre>
    </aside>

    <section id="search-panel" class="search-panel" aria-label="Panel pencarian objek">
      <div class="search-row">
        <input id="search-input" placeholder="Cari objek... (tekan /)" aria-label="Cari objek semesta" />
        <button id="search-go" type="button">GO</button>
        <button id="search-clear" type="button">CLR</button>
      </div>
      <p id="search-meta">Indeks pencarian: 0</p>
      <ol id="search-results" class="search-results"></ol>
    </section>

    <section id="info-panel" class="info-panel" aria-live="polite" aria-label="Panel detail objek">
      <h2 id="info-name">Tidak ada objek dipilih</h2>
      <p id="info-kind">-</p>
      <dl>
        <div><dt>Massa</dt><dd id="info-mass">-</dd></div>
        <div><dt>Radius</dt><dd id="info-radius">-</dd></div>
        <div><dt>Jarak ke Matahari</dt><dd id="info-distance-sun">-</dd></div>
        <div><dt>Jarak tampilan</dt><dd id="info-distance-render">-</dd></div>
        <div><dt>Kecepatan</dt><dd id="info-speed">-</dd></div>
        <div><dt>Suhu perkiraan</dt><dd id="info-temperature">-</dd></div>
        <div><dt>Posisi</dt><dd id="info-position">-</dd></div>
        <div><dt>Velocity</dt><dd id="info-velocity">-</dd></div>
      </dl>
      <p id="info-description" class="info-desc">Arahkan mouse ke objek untuk melihat detail ilmiah.</p>
      <button id="info-pin" type="button" class="info-pin">Pin Panel</button>
    </section>

    <section class="events-panel" aria-label="Panel event simulasi">
      <h2>Log event berbasis AI</h2>
      <pre id="events-text">Belum ada event.</pre>
    </section>

    <section id="help-panel" class="help-panel" aria-label="Bantuan kontrol">
      <h2>Hint kontrol</h2>
      <ul>
        <li>Drag untuk orbit kamera, wheel untuk zoom.</li>
        <li>TAB atau tombol FOKUS+ untuk ganti objek fokus.</li>
        <li>SPACE untuk pause/jalan.</li>
        <li>T untuk jejak, L untuk label, C untuk konteks, / untuk cari.</li>
        <li>Klik objek untuk pin panel detail.</li>
      </ul>
    </section>

    <p id="bottom-hint" class="bottom-hint">Ringkas: drag/arrow orbit kamera | wheel zoom | TAB fokus | / cari | klik objek pin panel</p>
  </main>
`;

const canvas = byId<HTMLCanvasElement>("universe-canvas");
const splash = byId<HTMLElement>("splash");
const splashStatus = byId<HTMLElement>("splash-status");
const splashProgress = byId<HTMLProgressElement>("splash-progress");

const hudText = byId<HTMLPreElement>("hud-text");
const eventsText = byId<HTMLPreElement>("events-text");
const bottomHint = byId<HTMLElement>("bottom-hint");

const searchPanel = byId<HTMLElement>("search-panel");
const searchInput = byId<HTMLInputElement>("search-input");
const searchMeta = byId<HTMLElement>("search-meta");
const searchResults = byId<HTMLOListElement>("search-results");
const searchGo = byId<HTMLButtonElement>("search-go");
const searchClear = byId<HTMLButtonElement>("search-clear");

const infoPanel = byId<HTMLElement>("info-panel");
const infoName = byId<HTMLElement>("info-name");
const infoKind = byId<HTMLElement>("info-kind");
const infoMass = byId<HTMLElement>("info-mass");
const infoRadius = byId<HTMLElement>("info-radius");
const infoDistanceSun = byId<HTMLElement>("info-distance-sun");
const infoDistanceRender = byId<HTMLElement>("info-distance-render");
const infoSpeed = byId<HTMLElement>("info-speed");
const infoTemperature = byId<HTMLElement>("info-temperature");
const infoPosition = byId<HTMLElement>("info-position");
const infoVelocity = byId<HTMLElement>("info-velocity");
const infoDescription = byId<HTMLElement>("info-description");
const infoPinButton = byId<HTMLButtonElement>("info-pin");

const runButton = byId<HTMLButtonElement>("btn-run");
const focusButton = byId<HTMLButtonElement>("btn-focus");
const trailButton = byId<HTMLButtonElement>("btn-trail");
const labelButton = byId<HTMLButtonElement>("btn-label");
const infoButton = byId<HTMLButtonElement>("btn-info");
const searchButton = byId<HTMLButtonElement>("btn-search");
const refButton = byId<HTMLButtonElement>("btn-ref");
const helpButton = byId<HTMLButtonElement>("btn-help");
const languageButton = byId<HTMLButtonElement>("btn-language");

const helpPanel = byId<HTMLElement>("help-panel");

const i18n = {
  id: {
    pause: "JEDA",
    resume: "JALAN",
    focus: "FOKUS+",
    trailOn: "JEJAK",
    trailOff: "JEJAK:OFF",
    labelOn: "LABEL",
    labelOff: "LABEL:OFF",
    infoOn: "INFO",
    infoOff: "INFO:OFF",
    searchOn: "CARI",
    searchOff: "CARI:OFF",
    helpOn: "BANTU",
    helpOff: "BANTU:OFF",
    lang: "BAHASA: ID",
    bottomHint: "Ringkas: drag/arrow orbit kamera | wheel zoom | TAB fokus | / cari | klik objek pin panel",
    searchPlaceholder: "Cari objek... (tekan /)",
  },
  en: {
    pause: "PAUSE",
    resume: "RUN",
    focus: "FOCUS+",
    trailOn: "TRAIL",
    trailOff: "TRAIL:OFF",
    labelOn: "LABEL",
    labelOff: "LABEL:OFF",
    infoOn: "INFO",
    infoOff: "INFO:OFF",
    searchOn: "SEARCH",
    searchOff: "SEARCH:OFF",
    helpOn: "HELP",
    helpOff: "HELP:OFF",
    lang: "LANG: EN",
    bottomHint: "Hint: drag/arrow orbit | wheel zoom | TAB next focus | / search | click object to pin panel",
    searchPlaceholder: "Search object... (press /)",
  },
} as const;

const engine = createUniverseEngine({
  includePlanetNine: true,
  includeHypothesisObjects: true,
  initialAsteroids: 300,
  initialKuiperObjects: 220,
  initialComets: 75,
  seed: 77,
});
engine.setBaseDtSeconds(22);
engine.setTimeScale(2400);
engine.setPaused(false);

const viewState: ViewState = {
  showContext: true,
  showHypothesis: true,
  showTrails: true,
  showLabels: true,
  showAsteroids: true,
  showComets: true,
};

const uiState: UiState = {
  running: true,
  language: "id",
  focusName: "Bumi",
  hoverKey: null,
  selectedKey: null,
  infoPinned: false,
  showInfo: true,
  showSearch: true,
  showHelp: false,
};

const scene = new THREE.Scene();
scene.background = new THREE.Color("#020814");
scene.fog = new THREE.Fog("#020814", 350, 7600);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 10000);
camera.position.set(0, 95, 220);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.zoomSpeed = 0.68;
controls.minDistance = 14;
controls.maxDistance = 3000;

scene.add(new THREE.AmbientLight(0x9cb7ff, 0.44));
const keyLight = new THREE.PointLight(0xffd59b, 2.4, 0, 2);
keyLight.position.set(0, 0, 0);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x5f87ff, 0.86);
rimLight.position.set(-260, 220, -120);
scene.add(rimLight);

const starfield = (() => {
  const stars = 5200;
  const radius = 7200;
  const points = new Float32Array(stars * 3);
  for (let i = 0; i < stars; i += 1) {
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const r = radius * (0.75 + Math.random() * 0.25);
    points[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    points[i * 3 + 1] = r * Math.cos(phi);
    points[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(points, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xbad5ff,
    size: 1.2,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.95,
  });
  const cloud = new THREE.Points(geo, mat);
  scene.add(cloud);
  return cloud;
})();

const bodyNodes = new Map<string, BodyNode>();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2(2, 2);

const bodyDescriptions: Record<string, string> = {
  Matahari: "Bintang pusat sistem; sumber utama energi dan referensi gravitasi.",
  Bumi: "Planet terestrial dengan biosfer aktif dan satelit alami Bulan.",
  Jupiter: "Planet jovian terbesar; mendominasi resonansi gravitasi planet luar.",
  Saturnus: "Planet cincin utama dengan sistem satelit kompleks.",
  "Sagittarius A*": "Black hole supermasif di pusat galaksi Bima Sakti.",
  "Bima Sakti": "Galaksi spiral rumah sistem surya pada lengan Orion.",
  "Andromeda (M31)": "Galaksi tetangga terbesar di Grup Lokal.",
};

function setCanvasSize(): void {
  const width = Math.max(window.innerWidth, 320);
  const height = Math.max(window.innerHeight, 320);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function compressedDistanceMeters(distanceMeters: number): number {
  const au = Math.max(distanceMeters / constants.auMeters, 0);

  if (au <= 80) {
    return au * 2.2;
  }

  if (au <= 200000) {
    return 80 * 2.2 + Math.log10(au - 79) * 34;
  }

  return 80 * 2.2 + Math.log10(200000 - 79) * 34 + Math.log10(au / 200000 + 1) * 240;
}

function toRenderPosition(position: { x: number; y: number; z: number }): THREE.Vector3 {
  const distance = Math.hypot(position.x, position.y, position.z);
  if (distance <= 1e-9) {
    return new THREE.Vector3(0, 0, 0);
  }

  const scaledDistance = compressedDistanceMeters(distance);
  const factor = scaledDistance / distance;
  return new THREE.Vector3(position.x * factor, position.y * factor, position.z * factor);
}

function toRenderRadius(body: UniverseBody): number {
  const base = clamp(Math.log10(Math.max(body.radiusMeters, 1)) - 4.95, 0.2, 11.5);

  if (body.kind === "star") {
    return clamp(base * 1.42, 2.2, 12);
  }

  if (body.kind === "black-hole") {
    return clamp(base * 0.85, 2.4, 8.2);
  }

  if (body.kind === "galaxy" || body.kind === "cluster" || body.kind === "nebula") {
    return clamp(base * 0.52, 1.4, 7.4);
  }

  if (bodyLooksRocky(body)) {
    return clamp(base * 0.28, 0.12, 0.62);
  }

  if (bodyLooksComet(body)) {
    return clamp(base * 0.33, 0.18, 0.84);
  }

  return base;
}

function shouldRenderBody(body: UniverseBody): boolean {
  if (!body.alive) {
    return false;
  }

  if (!viewState.showHypothesis && body.isHypothesis) {
    return false;
  }

  if (!viewState.showAsteroids && bodyLooksRocky(body)) {
    return false;
  }

  if (!viewState.showComets && bodyLooksComet(body)) {
    return false;
  }

  return true;
}

function shouldTrailBody(body: UniverseBody): boolean {
  if (!viewState.showTrails) {
    return false;
  }

  if (bodyLooksRocky(body)) {
    return false;
  }

  return body.kind === "planet"
    || body.kind === "moon"
    || body.kind === "dwarf"
    || body.kind === "comet"
    || body.kind === "hypothesis";
}

function shouldLabelBody(body: UniverseBody): boolean {
  if (!viewState.showLabels) {
    return false;
  }

  if (bodyLooksRocky(body)) {
    return false;
  }

  const priorityNames = new Set([
    "Matahari",
    "Merkurius",
    "Venus",
    "Bumi",
    "Mars",
    "Jupiter",
    "Saturnus",
    "Uranus",
    "Neptunus",
    "Bulan",
    "Pluto",
    "Ceres",
    "Planet Nine?",
    "Sagittarius A*",
    "Bima Sakti",
    "Andromeda (M31)",
    "Laniakea",
    "Sirius A",
    "Betelgeuse",
  ]);

  if (priorityNames.has(body.name)) {
    return true;
  }

  return body.name === uiState.focusName || body.kind === "black-hole";
}

function createLabelSprite(text: string, colorHex: string): THREE.Sprite {
  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = 340;
  labelCanvas.height = 88;

  const ctx = labelCanvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "rgba(6, 16, 39, 0.76)";
    ctx.strokeStyle = "rgba(130, 178, 255, 0.72)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(6, 6, 328, 76, 10);
    ctx.fill();
    ctx.stroke();

    ctx.font = "700 23px 'Space Grotesk', sans-serif";
    ctx.fillStyle = /^#[0-9a-f]{6}$/i.test(colorHex) ? colorHex : "#d8e7ff";
    ctx.fillText(text, 18, 50);
  }

  const tex = new THREE.CanvasTexture(labelCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;

  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });

  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(9.6, 2.48, 1);
  return sprite;
}

function createNode(body: UniverseBody): BodyNode {
  const key = bodyKey(body);
  const color = hexToColor(body.colorHex);
  const detail = bodyLooksRocky(body) ? 10 : bodyLooksComet(body) ? 12 : 24;

  const geometry = new THREE.SphereGeometry(1, detail, detail);
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: body.kind === "star" ? 0.22 : 0.66,
    metalness: body.kind === "black-hole" ? 0.42 : 0.07,
    emissive: body.kind === "star"
      ? new THREE.Color(color).multiplyScalar(0.35)
      : body.kind === "nebula"
        ? new THREE.Color(color).multiplyScalar(0.1)
        : new THREE.Color(0x000000),
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(toRenderPosition(body.position));
  mesh.scale.setScalar(toRenderRadius(body));
  mesh.userData.bodyKey = key;
  scene.add(mesh);

  let label: THREE.Sprite | null = null;
  if (shouldLabelBody(body)) {
    label = createLabelSprite(body.name, body.colorHex);
    label.position.copy(mesh.position);
    label.position.y += toRenderRadius(body) * 1.8 + 0.35;
    scene.add(label);
  }

  let trail: THREE.Line | null = null;
  if (shouldTrailBody(body)) {
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setFromPoints([mesh.position.clone(), mesh.position.clone()]);
    const trailMat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.62,
    });
    trail = new THREE.Line(trailGeo, trailMat);
    scene.add(trail);
  }

  return {
    key,
    body,
    mesh,
    label,
    trail,
    trailPoints: [mesh.position.clone()],
  };
}

function disposeNode(node: BodyNode): void {
  scene.remove(node.mesh);
  node.mesh.geometry.dispose();
  const meshMaterial = node.mesh.material as THREE.MeshStandardMaterial;
  meshMaterial.dispose();

  if (node.label) {
    scene.remove(node.label);
    const labelMaterial = node.label.material as THREE.SpriteMaterial;
    labelMaterial.map?.dispose();
    labelMaterial.dispose();
  }

  if (node.trail) {
    scene.remove(node.trail);
    node.trail.geometry.dispose();
    const trailMaterial = node.trail.material;
    if (Array.isArray(trailMaterial)) {
      trailMaterial.forEach((m: THREE.Material) => m.dispose());
    } else {
      trailMaterial.dispose();
    }
  }
}

function collectBodies(): UniverseBody[] {
  const major = engine.getMajorBodies();
  const small = engine.getSmallBodies();
  const context = viewState.showContext ? engine.getContextBodies() : [];
  return [...major, ...small, ...context].filter(shouldRenderBody);
}

function updateNodes(): void {
  const bodies = collectBodies();
  const aliveKeys = new Set<string>();

  for (const body of bodies) {
    const key = bodyKey(body);
    aliveKeys.add(key);

    let node = bodyNodes.get(key);
    if (!node) {
      node = createNode(body);
      bodyNodes.set(key, node);
    }

    node.body = body;

    const position = toRenderPosition(body.position);
    const radius = toRenderRadius(body);
    node.mesh.position.copy(position);
    node.mesh.scale.setScalar(radius);

    const meshMaterial = node.mesh.material as THREE.MeshStandardMaterial;
    const nextColor = hexToColor(body.colorHex);
    meshMaterial.color.setHex(nextColor);
    if (body.kind === "star") {
      meshMaterial.emissive = new THREE.Color(nextColor).multiplyScalar(0.35);
    } else {
      meshMaterial.emissive = new THREE.Color(0x000000);
    }

    if (node.label && !shouldLabelBody(body)) {
      scene.remove(node.label);
      const mat = node.label.material as THREE.SpriteMaterial;
      mat.map?.dispose();
      mat.dispose();
      node.label = null;
    }

    if (!node.label && shouldLabelBody(body)) {
      node.label = createLabelSprite(body.name, body.colorHex);
      scene.add(node.label);
    }

    if (node.label) {
      node.label.position.copy(position);
      node.label.position.y += radius * 1.8 + 0.35;
      node.label.visible = shouldLabelBody(body);
    }

    if (node.trail && !shouldTrailBody(body)) {
      scene.remove(node.trail);
      node.trail.geometry.dispose();
      const mat = node.trail.material;
      if (Array.isArray(mat)) {
        mat.forEach((m: THREE.Material) => m.dispose());
      } else {
        mat.dispose();
      }
      node.trail = null;
      node.trailPoints.length = 0;
    }

    if (!node.trail && shouldTrailBody(body)) {
      const geo = new THREE.BufferGeometry();
      geo.setFromPoints([position.clone(), position.clone()]);
      const mat = new THREE.LineBasicMaterial({
        color: hexToColor(body.colorHex),
        transparent: true,
        opacity: 0.58,
      });
      node.trail = new THREE.Line(geo, mat);
      node.trailPoints = [position.clone()];
      scene.add(node.trail);
    }

    if (node.trail) {
      const last = node.trailPoints[node.trailPoints.length - 1];
      if (!last || last.distanceToSquared(position) > 0.02) {
        node.trailPoints.push(position.clone());
      }
      if (node.trailPoints.length > 240) {
        node.trailPoints.splice(0, node.trailPoints.length - 240);
      }
      node.trail.geometry.setFromPoints(node.trailPoints);
      node.trail.visible = viewState.showTrails;
    }
  }

  for (const [key, node] of bodyNodes) {
    if (!aliveKeys.has(key)) {
      disposeNode(node);
      bodyNodes.delete(key);
      if (uiState.hoverKey === key) {
        uiState.hoverKey = null;
      }
      if (uiState.selectedKey === key) {
        uiState.selectedKey = null;
        uiState.infoPinned = false;
      }
    }
  }
}

function bodyByName(name: string): UniverseBody | null {
  const key = Array.from(bodyNodes.keys()).find((entry) => entry.endsWith(`:${name}`));
  if (!key) {
    return null;
  }
  return bodyNodes.get(key)?.body ?? null;
}

function focusCandidates(): UniverseBody[] {
  const major = engine.getMajorBodies();
  const context = viewState.showContext ? engine.getContextBodies() : [];
  return [...major, ...context].filter((body) => body.alive && (viewState.showHypothesis || !body.isHypothesis));
}

function cycleFocus(): void {
  const targets = focusCandidates();
  if (targets.length === 0) {
    return;
  }

  const current = targets.findIndex((body) => body.name === uiState.focusName);
  const next = targets[(current + 1 + targets.length) % targets.length];
  uiState.focusName = next.name;
}

function updateFocusTarget(): void {
  const targetNode = Array.from(bodyNodes.values()).find((node) => node.body.name === uiState.focusName);
  if (!targetNode) {
    return;
  }

  controls.target.lerp(targetNode.mesh.position, 0.14);

  if (targetNode.body.kind === "star") {
    keyLight.position.copy(targetNode.mesh.position);
  }
}

function estimateTemperature(body: UniverseBody): number {
  const sun = bodyByName("Matahari");
  if (!sun) {
    return 0;
  }

  const dx = body.position.x - sun.position.x;
  const dy = body.position.y - sun.position.y;
  const dz = body.position.z - sun.position.z;
  const distance = Math.max(Math.hypot(dx, dy, dz), constants.auMeters * 0.01);

  const flux = 1361 * Math.pow(constants.auMeters / distance, 2);
  const kelvin = Math.pow(flux / (4 * 5.670374419e-8), 0.25);
  return kelvin;
}

function activeInfoBody(): UniverseBody | null {
  if (uiState.selectedKey) {
    return bodyNodes.get(uiState.selectedKey)?.body ?? null;
  }
  if (uiState.hoverKey) {
    return bodyNodes.get(uiState.hoverKey)?.body ?? null;
  }
  return null;
}

function updateInfoPanel(): void {
  const body = activeInfoBody();

  if (!uiState.showInfo || !body) {
    infoPanel.classList.remove("is-visible");
    return;
  }

  infoPanel.classList.add("is-visible");

  const sun = bodyByName("Matahari");
  const pos = body.position;
  const speed = Math.hypot(body.velocity.x, body.velocity.y, body.velocity.z);
  const renderPos = toRenderPosition(pos);
  const renderDistance = Math.hypot(renderPos.x, renderPos.y, renderPos.z);

  let distanceSun = 0;
  if (sun) {
    distanceSun = Math.hypot(
      pos.x - sun.position.x,
      pos.y - sun.position.y,
      pos.z - sun.position.z,
    );
  }

  const kelvin = estimateTemperature(body);

  infoName.textContent = body.name;
  infoKind.textContent = `${body.kind}${body.isHypothesis ? " | hypothesis" : " | observed"}`;
  infoMass.textContent = formatMass(body.massKg);
  infoRadius.textContent = formatRadius(body.radiusMeters);
  infoDistanceSun.textContent = `${(distanceSun / constants.auMeters).toFixed(3)} AU`;
  infoDistanceRender.textContent = `${renderDistance.toFixed(3)} unit`;
  infoSpeed.textContent = `${speed.toLocaleString(undefined, { maximumFractionDigits: 2 })} m/s`;
  infoTemperature.textContent = `${kelvin.toFixed(2)} K`;
  infoPosition.textContent = `(${formatExp(pos.x)}, ${formatExp(pos.y)}, ${formatExp(pos.z)})`;
  infoVelocity.textContent = `(${formatExp(body.velocity.x)}, ${formatExp(body.velocity.y)}, ${formatExp(body.velocity.z)})`;
  infoDescription.textContent = bodyDescriptions[body.name] ?? "Objek kosmik aktif dalam simulasi. Klik pin untuk menahan panel saat eksplorasi.";

  infoPinButton.textContent = uiState.infoPinned ? "Unpin Panel" : "Pin Panel";
}

function updateSearchResults(): void {
  const query = searchInput.value.trim().toLowerCase();
  const targets = focusCandidates();
  const filtered = query.length === 0
    ? targets.slice(0, 14)
    : targets.filter((body) => body.name.toLowerCase().includes(query)).slice(0, 14);

  searchResults.innerHTML = "";
  filtered.forEach((body) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${body.name} [${body.kind}]`;
    button.addEventListener("click", () => {
      uiState.focusName = body.name;
      uiState.selectedKey = bodyKey(body);
      uiState.infoPinned = true;
      updateInfoPanel();
    });
    item.appendChild(button);
    searchResults.appendChild(item);
  });

  searchMeta.textContent = `Indeks pencarian: ${targets.length} | Dinamis: ${engine.getStateSnapshot().counts.onlineCatalog}`;
}

function updateHudPanel(): void {
  const snap = engine.getStateSnapshot();

  const earth = bodyByName("Bumi");
  const moon = bodyByName("Bulan");
  const sun = bodyByName("Matahari");

  const earthSunDelay = earth && sun
    ? Math.hypot(
      earth.position.x - sun.position.x,
      earth.position.y - sun.position.y,
      earth.position.z - sun.position.z,
    ) / constants.speedOfLightMps
    : 0;

  const earthMoonDelay = earth && moon
    ? Math.hypot(
      earth.position.x - moon.position.x,
      earth.position.y - moon.position.y,
      earth.position.z - moon.position.z,
    ) / constants.speedOfLightMps
    : 0;

  const smallBodies = engine.getSmallBodies();
  const asteroidCount = smallBodies.filter((body) => body.name.startsWith("Asteroid-")).length;
  const kuiperCount = smallBodies.filter((body) => body.name.startsWith("Kuiper-")).length;
  const cometCount = smallBodies.filter(bodyLooksComet).length;
  const meteorCount = smallBodies.filter((body) => body.kind === "meteor" || body.name.startsWith("Meteor-")).length;

  const topForecast = engine.getForecasts(1)[0];
  const forecastLine = topForecast
    ? `${topForecast.kind} ${topForecast.bodyA} -> ${topForecast.bodyB} eta=${topForecast.etaYears.toFixed(3)} y`
    : "No forecast";

  hudText.textContent = [
    "Orbinex",
    `c=${constants.speedOfLightMps.toFixed(1)} m/s | waktu=${snap.yearsElapsed.toFixed(4)} tahun | kecepatan x${snap.timeScale.toFixed(1)}`,
    `fokus=${uiState.focusName} | ${uiState.running ? "RUN" : "PAUSE"} | label=${viewState.showLabels ? "on" : "off"}`,
    `delay Bumi-Matahari=${earthSunDelay.toFixed(2)} s | Bumi-Bulan=${earthMoonDelay.toFixed(2)} s`,
    `Ast=${asteroidCount} Kuiper=${kuiperCount} Komet=${cometCount} Meteor=${meteorCount}`,
    `Katalog diterapkan=${snap.counts.onlineCatalog} | major=${snap.counts.majorBodies} context=${snap.counts.contextBodies}`,
    `Forecast: ${forecastLine}`,
  ].join("\n");
}

function updateEventsPanel(): void {
  const events = engine.getEvents(12);
  if (events.length === 0) {
    eventsText.textContent = "Belum ada event.";
    return;
  }

  eventsText.textContent = events
    .map((event) => {
      return `[${event.kind}] waktu=${event.timeYears.toFixed(3)} tahun | ${event.message}`;
    })
    .join("\n");
}

function updateActionButtons(): void {
  const t = i18n[uiState.language];
  runButton.textContent = uiState.running ? t.pause : t.resume;
  focusButton.textContent = t.focus;
  trailButton.textContent = viewState.showTrails ? t.trailOn : t.trailOff;
  labelButton.textContent = viewState.showLabels ? t.labelOn : t.labelOff;
  infoButton.textContent = uiState.showInfo ? t.infoOn : t.infoOff;
  searchButton.textContent = uiState.showSearch ? t.searchOn : t.searchOff;
  helpButton.textContent = uiState.showHelp ? t.helpOn : t.helpOff;
  languageButton.textContent = t.lang;
  bottomHint.textContent = t.bottomHint;
  searchInput.placeholder = t.searchPlaceholder;
}

function updatePanelVisibility(): void {
  searchPanel.classList.toggle("is-hidden", !uiState.showSearch);
  helpPanel.classList.toggle("is-hidden", !uiState.showHelp);
  if (!uiState.showInfo) {
    infoPanel.classList.remove("is-visible");
  }
}

function currentMeshTargets(): THREE.Object3D[] {
  return Array.from(bodyNodes.values()).map((node) => node.mesh);
}

function updateHoverByRaycast(): void {
  if (pointer.x > 1 || pointer.y > 1) {
    if (!uiState.infoPinned) {
      uiState.hoverKey = null;
    }
    return;
  }

  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(currentMeshTargets(), false)[0];
  const object = hit?.object as THREE.Mesh | undefined;
  const key = typeof object?.userData.bodyKey === "string" ? object.userData.bodyKey as string : null;

  if (!uiState.infoPinned) {
    uiState.hoverKey = key;
  }
}

function bindUiHandlers(): void {
  runButton.addEventListener("click", () => {
    uiState.running = !uiState.running;
    engine.setPaused(!uiState.running);
    updateActionButtons();
  });

  focusButton.addEventListener("click", () => {
    cycleFocus();
  });

  trailButton.addEventListener("click", () => {
    viewState.showTrails = !viewState.showTrails;
    updateActionButtons();
  });

  labelButton.addEventListener("click", () => {
    viewState.showLabels = !viewState.showLabels;
    updateActionButtons();
  });

  infoButton.addEventListener("click", () => {
    uiState.showInfo = !uiState.showInfo;
    updateActionButtons();
    updatePanelVisibility();
  });

  searchButton.addEventListener("click", () => {
    uiState.showSearch = !uiState.showSearch;
    updateActionButtons();
    updatePanelVisibility();
    if (uiState.showSearch) {
      searchInput.focus();
    }
  });

  helpButton.addEventListener("click", () => {
    uiState.showHelp = !uiState.showHelp;
    updateActionButtons();
    updatePanelVisibility();
  });

  languageButton.addEventListener("click", () => {
    uiState.language = uiState.language === "id" ? "en" : "id";
    updateActionButtons();
  });

  refButton.addEventListener("click", () => {
    window.open("https://github.com/galihru/OrbinexSimulation", "_blank", "noopener,noreferrer");
  });

  infoPinButton.addEventListener("click", () => {
    uiState.infoPinned = !uiState.infoPinned;
    if (!uiState.infoPinned) {
      uiState.selectedKey = null;
    } else if (uiState.hoverKey) {
      uiState.selectedKey = uiState.hoverKey;
    }
    updateInfoPanel();
  });

  searchInput.addEventListener("input", () => {
    updateSearchResults();
  });

  searchGo.addEventListener("click", () => {
    const first = searchResults.querySelector("button");
    first?.dispatchEvent(new MouseEvent("click"));
  });

  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    updateSearchResults();
    searchInput.focus();
  });

  canvas.addEventListener("pointermove", (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;

    pointer.x = x * 2 - 1;
    pointer.y = -(y * 2 - 1);
  });

  canvas.addEventListener("pointerleave", () => {
    pointer.x = 2;
    pointer.y = 2;
    if (!uiState.infoPinned) {
      uiState.hoverKey = null;
      updateInfoPanel();
    }
  });

  canvas.addEventListener("click", () => {
    if (uiState.hoverKey) {
      uiState.selectedKey = uiState.hoverKey;
      uiState.infoPinned = true;
      updateInfoPanel();
    } else {
      uiState.infoPinned = false;
      uiState.selectedKey = null;
      updateInfoPanel();
    }
  });

  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();

    if (key === " ") {
      event.preventDefault();
      runButton.click();
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      cycleFocus();
      return;
    }

    if (key === "t") {
      event.preventDefault();
      trailButton.click();
      return;
    }

    if (key === "l") {
      event.preventDefault();
      labelButton.click();
      return;
    }

    if (key === "c") {
      event.preventDefault();
      viewState.showContext = !viewState.showContext;
      updateSearchResults();
      return;
    }

    if (key === "/") {
      event.preventDefault();
      if (!uiState.showSearch) {
        uiState.showSearch = true;
        updateActionButtons();
        updatePanelVisibility();
      }
      searchInput.focus();
      return;
    }

    if (key === "escape") {
      uiState.infoPinned = false;
      uiState.selectedKey = null;
      if (!uiState.showHelp && !uiState.showSearch) {
        uiState.hoverKey = null;
      }
      updateInfoPanel();
    }
  });

  window.addEventListener("resize", setCanvasSize);
}

async function runSplash(): Promise<void> {
  const steps: Array<{ p: number; t: string }> = [
    { p: 14, t: "Menginisialisasi body primer..." },
    { p: 34, t: "Memetakan asteroid dan kuiper belt..." },
    { p: 56, t: "Menyiapkan konteks galaksi dan nebula..." },
    { p: 76, t: "Menghubungkan HUD, event, dan search panel..." },
    { p: 100, t: "Simulasi siap." },
  ];

  for (const step of steps) {
    splashProgress.value = step.p;
    splashStatus.textContent = step.t;
    // Delay kecil agar transisi splash terasa natural.
    // eslint-disable-next-line no-await-in-loop
    await new Promise<void>((resolve) => {
      window.setTimeout(() => resolve(), 180);
    });
  }

  splash.classList.remove("is-visible");
  window.setTimeout(() => {
    splash.remove();
  }, 340);
}

let lastFrame = performance.now();
let simAccumulator = 0;
let hudAccumulator = 0;
let eventsAccumulator = 0;
let spawnAccumulator = 0;

const SIM_STEP_MS = 58;

function animate(now: number): void {
  const dtMs = now - lastFrame;
  lastFrame = now;

  starfield.rotation.y += 0.000032;

  if (uiState.running) {
    simAccumulator += dtMs;
    spawnAccumulator += dtMs;

    while (simAccumulator >= SIM_STEP_MS) {
      engine.step(2);
      simAccumulator -= SIM_STEP_MS;
    }

    if (spawnAccumulator >= 9000) {
      engine.spawnMeteorShower(2);
      if (Math.random() > 0.55) {
        engine.spawnCometWave(1);
      }
      spawnAccumulator = 0;
    }
  }

  updateNodes();
  updateHoverByRaycast();
  updateFocusTarget();

  controls.update();
  renderer.render(scene, camera);

  hudAccumulator += dtMs;
  if (hudAccumulator >= 160) {
    updateHudPanel();
    updateInfoPanel();
    hudAccumulator = 0;
  }

  eventsAccumulator += dtMs;
  if (eventsAccumulator >= 420) {
    updateEventsPanel();
    updateSearchResults();
    eventsAccumulator = 0;
  }

  window.requestAnimationFrame(animate);
}

bindUiHandlers();
setCanvasSize();
updateActionButtons();
updatePanelVisibility();
updateSearchResults();
updateHudPanel();
updateEventsPanel();
updateInfoPanel();

window.requestAnimationFrame(animate);
void runSplash();
