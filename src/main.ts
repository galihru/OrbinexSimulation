import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import {
    circularOrbitSpeed,
    constants,
    createOrbitSample,
    createUniverseEngine,
    equatorialToCartesian,
    generateRecommendationReport,
    generateSimulationReport,
    generateUniverseStateReport,
    orbitalPeriodFromSemiMajorAxis,
    type UniverseBody,
} from "./orbinex-compat";

import "./styles.css";

type TerminalLevel = "output" | "command" | "error";

type ViewState = {
    showMoons: boolean;
    showContext: boolean;
    showHypothesis: boolean;
    showLabels: boolean;
    showTrails: boolean;
    showMeteors: boolean;
    showComets: boolean;
};

type StatusPayload = {
    yearsElapsed: number;
    totalBodies: number;
    collisionCount: number;
    timeScale: number;
    running: boolean;
    focusTarget: string;
};

type TerminalCommandEvent = CustomEvent<string>;

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

function parsePositiveInteger(value: string, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return Math.floor(parsed);
}

function parseFlag(command: string, flag: string, fallback: number): number {
    const regex = new RegExp(`--${flag}\\s+([^\\s]+)`, "i");
    const match = command.match(regex);
    if (!match) {
        return fallback;
    }
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : fallback;
}

function formatScientific(value: number): string {
    return value.toExponential(6);
}

class OrbinexSplashElement extends HTMLElement {
    private progressEl: HTMLProgressElement | null = null;

    private statusEl: HTMLParagraphElement | null = null;

    connectedCallback(): void {
        if (this.dataset.ready === "true") {
            return;
        }

        this.dataset.ready = "true";
        this.classList.add("splash-host");
        this.setAttribute("aria-live", "polite");
        this.innerHTML = `
      <section class="splash-shell" role="dialog" aria-modal="true" aria-label="Memuat simulasi Orbinex">
        <img class="splash-logo" src="/orbinex-logo.svg" alt="Logo Orbinex Simulation" width="140" height="140" />
        <p class="splash-kicker">OrbinexSimulation</p>
        <h2 class="splash-title">UniverseSandboxScientific3D Web</h2>
        <p id="splash-status" class="splash-status">Inisialisasi renderer kosmik...</p>
        <progress id="splash-progress" max="100" value="8" aria-label="Kemajuan loading simulasi"></progress>
      </section>
    `;

        this.progressEl = this.querySelector<HTMLProgressElement>("#splash-progress");
        this.statusEl = this.querySelector<HTMLParagraphElement>("#splash-status");
    }

    setProgress(progress: number, status: string): void {
        if (this.progressEl) {
            this.progressEl.value = clamp(progress, 0, 100);
        }
        if (this.statusEl) {
            this.statusEl.textContent = status;
        }
    }

    complete(): void {
        this.classList.add("is-hidden");
        window.setTimeout(() => {
            this.remove();
        }, 420);
    }
}

class OrbinexStatusElement extends HTMLElement {
    private yearsEl: HTMLElement | null = null;

    private bodiesEl: HTMLElement | null = null;

    private collisionsEl: HTMLElement | null = null;

    private scaleEl: HTMLElement | null = null;

    private runningEl: HTMLElement | null = null;

    private focusEl: HTMLElement | null = null;

    connectedCallback(): void {
        if (this.dataset.ready === "true") {
            return;
        }

        this.dataset.ready = "true";
        this.classList.add("status-host");
        this.innerHTML = `
      <section class="status-shell" aria-label="Telemetry real-time">
        <h3>Mission Telemetry</h3>
        <dl class="status-grid">
          <div>
            <dt>Years Elapsed</dt>
            <dd id="status-years">0.000000</dd>
          </div>
          <div>
            <dt>Total Bodies</dt>
            <dd id="status-bodies">0</dd>
          </div>
          <div>
            <dt>Collisions</dt>
            <dd id="status-collisions">0</dd>
          </div>
          <div>
            <dt>Time Scale</dt>
            <dd id="status-scale">0</dd>
          </div>
          <div>
            <dt>Engine</dt>
            <dd id="status-running">PAUSED</dd>
          </div>
          <div>
            <dt>Focus</dt>
            <dd id="status-focus">Matahari</dd>
          </div>
        </dl>
      </section>
    `;

        this.yearsEl = this.querySelector<HTMLElement>("#status-years");
        this.bodiesEl = this.querySelector<HTMLElement>("#status-bodies");
        this.collisionsEl = this.querySelector<HTMLElement>("#status-collisions");
        this.scaleEl = this.querySelector<HTMLElement>("#status-scale");
        this.runningEl = this.querySelector<HTMLElement>("#status-running");
        this.focusEl = this.querySelector<HTMLElement>("#status-focus");
    }

    updateStatus(payload: StatusPayload): void {
        if (this.yearsEl) {
            this.yearsEl.textContent = payload.yearsElapsed.toFixed(6);
        }
        if (this.bodiesEl) {
            this.bodiesEl.textContent = String(payload.totalBodies);
        }
        if (this.collisionsEl) {
            this.collisionsEl.textContent = String(payload.collisionCount);
        }
        if (this.scaleEl) {
            this.scaleEl.textContent = payload.timeScale.toFixed(0);
        }
        if (this.runningEl) {
            this.runningEl.textContent = payload.running ? "RUNNING" : "PAUSED";
        }
        if (this.focusEl) {
            this.focusEl.textContent = payload.focusTarget;
        }
    }
}

class OrbinexTerminalElement extends HTMLElement {
    private historyEl: HTMLOListElement | null = null;

    private inputEl: HTMLInputElement | null = null;

    connectedCallback(): void {
        if (this.dataset.ready === "true") {
            return;
        }

        this.dataset.ready = "true";
        this.classList.add("terminal-host");
        this.innerHTML = `
      <section class="terminal-shell" aria-label="Terminal command simulation">
        <header class="terminal-head">
          <h2>Interactive Command Terminal</h2>
          <p>Gunakan perintah seperti <strong>status</strong>, <strong>focus Bumi</strong>, atau <strong>view context on</strong>.</p>
        </header>
        <ol id="terminal-history" class="terminal-history" aria-live="polite" aria-label="Riwayat terminal"></ol>
        <form id="terminal-form" class="terminal-form" aria-label="Masukkan command terminal">
          <label for="terminal-input" class="prompt">orbinex@sim:$</label>
          <input id="terminal-input" name="command" autocomplete="off" spellcheck="false" placeholder="help" />
          <button type="submit">Run</button>
        </form>
        <div class="terminal-shortcuts" aria-label="Shortcut command">
          <button type="button" data-cmd="help">help</button>
          <button type="button" data-cmd="status">status</button>
          <button type="button" data-cmd="step --n 8">step</button>
          <button type="button" data-cmd="forecast">forecast</button>
          <button type="button" data-cmd="rec">rec</button>
          <button type="button" data-cmd="view context on">context on</button>
          <button type="button" data-cmd="focus Matahari">focus sun</button>
          <button type="button" data-cmd="timescale --value 2600">timescale</button>
          <button type="button" data-cmd="clear">clear</button>
        </div>
      </section>
    `;

        this.historyEl = this.querySelector<HTMLOListElement>("#terminal-history");
        this.inputEl = this.querySelector<HTMLInputElement>("#terminal-input");

        const form = this.querySelector<HTMLFormElement>("#terminal-form");
        if (form) {
            form.addEventListener("submit", (event) => {
                event.preventDefault();
                const raw = this.inputEl?.value ?? "";
                const command = raw.trim();
                if (!command) {
                    return;
                }
                this.dispatchEvent(new CustomEvent<string>("terminal-command", {
                    detail: command,
                    bubbles: true,
                }));
                if (this.inputEl) {
                    this.inputEl.value = "";
                }
            });
        }

        Array.from(this.querySelectorAll<HTMLButtonElement>(".terminal-shortcuts button")).forEach((button) => {
            button.addEventListener("click", () => {
                const command = button.dataset.cmd ?? "";
                this.dispatchEvent(new CustomEvent<string>("terminal-command", {
                    detail: command,
                    bubbles: true,
                }));
            });
        });
    }

    print(message: string, level: TerminalLevel = "output"): void {
        if (!this.historyEl) {
            return;
        }

        const line = document.createElement("li");
        line.className = `terminal-line ${level}`;
        line.textContent = message;
        this.historyEl.appendChild(line);
        this.historyEl.scrollTop = this.historyEl.scrollHeight;
    }

    clearHistory(): void {
        if (this.historyEl) {
            this.historyEl.innerHTML = "";
        }
    }

    focusInput(): void {
        this.inputEl?.focus();
    }
}

if (!customElements.get("orbinex-splash")) {
    customElements.define("orbinex-splash", OrbinexSplashElement);
}
if (!customElements.get("orbinex-status")) {
    customElements.define("orbinex-status", OrbinexStatusElement);
}
if (!customElements.get("orbinex-terminal")) {
    customElements.define("orbinex-terminal", OrbinexTerminalElement);
}

const app = byId<HTMLElement>("app");
app.innerHTML = `
  <header class="site-header" aria-labelledby="hero-title">
    <p class="site-kicker">OrbinexSimulation</p>
    <h1 id="hero-title">Universe Sandbox Scientific 3D Web Simulation</h1>
    <p class="site-lead">
      Simulasi web ini mengadopsi struktur UniverseSandboxScientific3D Scala: visual 3D aktif,
      kontrol fisika, event kosmik, prediksi tabrakan, dan command terminal real-time.
    </p>
    <ul class="constant-ribbon" aria-label="Konstanta fisika utama">
      <li>G = ${formatScientific(constants.gravitationalConstant)}</li>
      <li>c = ${constants.speedOfLightMps.toLocaleString()} m/s</li>
      <li>1 AU = ${formatScientific(constants.auMeters)} m</li>
    </ul>
  </header>

  <main id="sim-main" class="sim-main" tabindex="-1">
    <section class="stage-panel" aria-labelledby="stage-title">
      <div class="stage-head">
        <h2 id="stage-title">3D Universe Stage</h2>
        <p>Objek kosmik dirender dalam skala non-linear agar galaksi dan sistem surya tetap terlihat bersamaan.</p>
      </div>
      <figure class="canvas-shell">
        <canvas id="universe-canvas" aria-label="Kanvas simulasi semesta tiga dimensi"></canvas>
        <figcaption>
          Drag untuk orbit kamera, scroll untuk zoom, dan gunakan panel fokus untuk lock ke objek tertentu.
        </figcaption>
      </figure>
      <orbinex-status id="status-board"></orbinex-status>
    </section>

    <aside class="control-panel" aria-label="Panel kontrol simulasi">
      <section class="card" aria-labelledby="playback-title">
        <h2 id="playback-title">Playback Engine</h2>
        <div class="button-grid">
          <button id="run-toggle" type="button">Pause</button>
          <button id="step-one" type="button">Step x1</button>
          <button id="step-ten" type="button">Step x10</button>
          <button id="spawn-meteor" type="button">Spawn Meteor x6</button>
          <button id="spawn-comet" type="button">Spawn Comet x3</button>
          <button id="trigger-supernova" type="button">Trigger Supernova</button>
        </div>
      </section>

      <section class="card" aria-labelledby="physics-title">
        <h2 id="physics-title">Physics Settings</h2>
        <form id="physics-form" class="stack-form">
          <label for="setting-dt">Base dt (seconds)</label>
          <input id="setting-dt" type="number" min="1" value="24" step="1" />

          <label for="setting-scale">Time scale</label>
          <input id="setting-scale" type="number" min="1" value="1800" step="100" />

          <button id="apply-settings" type="submit">Apply Physics</button>
        </form>
      </section>

      <section class="card" aria-labelledby="visibility-title">
        <h2 id="visibility-title">Universe Layers</h2>
        <fieldset class="toggle-fieldset">
          <legend>Tampilan Objek</legend>
          <label><input id="toggle-moons" type="checkbox" checked /> Bulan / satelit</label>
          <label><input id="toggle-context" type="checkbox" checked /> Deep space context</label>
          <label><input id="toggle-hypothesis" type="checkbox" checked /> Hypothesis objects</label>
          <label><input id="toggle-labels" type="checkbox" checked /> Label nama</label>
          <label><input id="toggle-trails" type="checkbox" checked /> Orbit trails</label>
          <label><input id="toggle-meteors" type="checkbox" checked /> Meteor stream</label>
          <label><input id="toggle-comets" type="checkbox" checked /> Comet stream</label>
        </fieldset>
      </section>

      <section class="card" aria-labelledby="focus-title">
        <h2 id="focus-title">Camera Focus</h2>
        <form id="focus-form" class="stack-form">
          <label for="focus-target">Target object</label>
          <select id="focus-target" aria-label="Pilih objek fokus kamera"></select>
          <button id="focus-apply" type="submit">Lock Focus</button>
        </form>
      </section>

      <section class="card" aria-labelledby="science-title">
        <h2 id="science-title">Scientific Console</h2>

        <article>
          <h3>Orbit Sample</h3>
          <form id="orbit-form" class="stack-form">
            <label for="calc-mass">Primary mass (kg)</label>
            <input id="calc-mass" type="number" value="${constants.solarMassKg}" step="1e28" />

            <label for="calc-radius">Orbital radius (m)</label>
            <input id="calc-radius" type="number" value="${constants.auMeters}" step="1e8" />

            <button id="compute-sample" type="submit">Compute Orbit</button>
          </form>
          <pre id="calc-output" class="mono-block">Tekan compute untuk melihat hasil orbit sample.</pre>
        </article>

        <article>
          <h3>Coordinate Converter</h3>
          <form id="coord-form" class="stack-form">
            <label for="calc-ra">Right ascension (deg)</label>
            <input id="calc-ra" type="number" value="10.684" step="0.001" />

            <label for="calc-dec">Declination (deg)</label>
            <input id="calc-dec" type="number" value="41.269" step="0.001" />

            <label for="calc-pc">Distance (parsec)</label>
            <input id="calc-pc" type="number" value="778000" step="100" />

            <button id="compute-coord" type="submit">Convert Coordinate</button>
          </form>
          <pre id="coord-output" class="mono-block">Koordinat Cartesian akan muncul di sini.</pre>
        </article>
      </section>
    </aside>
  </main>

  <section class="reports-panel" aria-labelledby="reports-title">
    <h2 id="reports-title">Simulation Reports</h2>
    <article>
      <h3>Universe State</h3>
      <pre id="state-output" class="mono-block compact"></pre>
    </article>
    <article>
      <h3>Forecasts</h3>
      <pre id="forecast-output" class="mono-block compact"></pre>
    </article>
    <article>
      <h3>AI Recommendations</h3>
      <pre id="recommend-output" class="mono-block compact"></pre>
    </article>
    <article>
      <h3>Recent Events</h3>
      <pre id="event-output" class="mono-block compact"></pre>
    </article>
  </section>

  <orbinex-terminal id="command-terminal"></orbinex-terminal>
  <orbinex-splash id="splash"></orbinex-splash>
`;

const splash = byId<OrbinexSplashElement>("splash");
const statusBoard = byId<OrbinexStatusElement>("status-board");
const terminal = byId<OrbinexTerminalElement>("command-terminal");

const runToggleButton = byId<HTMLButtonElement>("run-toggle");
const stepOneButton = byId<HTMLButtonElement>("step-one");
const stepTenButton = byId<HTMLButtonElement>("step-ten");
const spawnMeteorButton = byId<HTMLButtonElement>("spawn-meteor");
const spawnCometButton = byId<HTMLButtonElement>("spawn-comet");
const triggerSupernovaButton = byId<HTMLButtonElement>("trigger-supernova");

const physicsForm = byId<HTMLFormElement>("physics-form");
const settingDtInput = byId<HTMLInputElement>("setting-dt");
const settingScaleInput = byId<HTMLInputElement>("setting-scale");

const toggleMoonsInput = byId<HTMLInputElement>("toggle-moons");
const toggleContextInput = byId<HTMLInputElement>("toggle-context");
const toggleHypothesisInput = byId<HTMLInputElement>("toggle-hypothesis");
const toggleLabelsInput = byId<HTMLInputElement>("toggle-labels");
const toggleTrailsInput = byId<HTMLInputElement>("toggle-trails");
const toggleMeteorsInput = byId<HTMLInputElement>("toggle-meteors");
const toggleCometsInput = byId<HTMLInputElement>("toggle-comets");

const focusForm = byId<HTMLFormElement>("focus-form");
const focusSelect = byId<HTMLSelectElement>("focus-target");

const orbitForm = byId<HTMLFormElement>("orbit-form");
const calcMassInput = byId<HTMLInputElement>("calc-mass");
const calcRadiusInput = byId<HTMLInputElement>("calc-radius");
const calcOutput = byId<HTMLPreElement>("calc-output");

const coordForm = byId<HTMLFormElement>("coord-form");
const calcRaInput = byId<HTMLInputElement>("calc-ra");
const calcDecInput = byId<HTMLInputElement>("calc-dec");
const calcPcInput = byId<HTMLInputElement>("calc-pc");
const coordOutput = byId<HTMLPreElement>("coord-output");

const stateOutput = byId<HTMLPreElement>("state-output");
const forecastOutput = byId<HTMLPreElement>("forecast-output");
const recommendOutput = byId<HTMLPreElement>("recommend-output");
const eventOutput = byId<HTMLPreElement>("event-output");

const canvas = byId<HTMLCanvasElement>("universe-canvas");

const engine = createUniverseEngine({
    includePlanetNine: true,
    includeHypothesisObjects: true,
    initialAsteroids: 320,
    initialKuiperObjects: 260,
    initialComets: 80,
    seed: 77,
});

const scene = new THREE.Scene();
scene.background = new THREE.Color("#040913");
scene.fog = new THREE.Fog("#040913", 180, 4800);

const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const camera = new THREE.PerspectiveCamera(53, 1, 0.1, 10000);
camera.position.set(85, 96, 150);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.065;
controls.zoomSpeed = 0.65;
controls.panSpeed = 0.72;
controls.minDistance = 6;
controls.maxDistance = 2600;

const ambientLight = new THREE.AmbientLight(0xa6b9ff, 0.54);
scene.add(ambientLight);

const sunlight = new THREE.PointLight(0xffd99d, 2.7, 0, 2);
sunlight.position.set(0, 0, 0);
scene.add(sunlight);

const rimLight = new THREE.DirectionalLight(0x6f92ff, 1.2);
rimLight.position.set(-280, 210, -170);
scene.add(rimLight);

const starfield = (() => {
    const starCount = 3600;
    const radius = 4300;
    const points = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i += 1) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = radius * (0.85 + Math.random() * 0.15);

        points[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        points[i * 3 + 1] = r * Math.cos(phi);
        points[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(points, 3));
    const material = new THREE.PointsMaterial({
        color: 0x9ec0ff,
        size: 1.45,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.95,
    });
    const pointCloud = new THREE.Points(geometry, material);
    scene.add(pointCloud);
    return pointCloud;
})();

type BodyNode = {
    body: UniverseBody;
    mesh: THREE.Mesh;
    label: THREE.Sprite | null;
    trail: THREE.Line | null;
    trailPoints: THREE.Vector3[];
};

const bodyNodes = new Map<string, BodyNode>();

const viewState: ViewState = {
    showMoons: true,
    showContext: true,
    showHypothesis: true,
    showLabels: true,
    showTrails: true,
    showMeteors: true,
    showComets: true,
};

let simulationRunning = true;
let focusTarget = "Matahari";

function resolveColor(hex: string, fallback: number): number {
    if (/^#[0-9a-f]{6}$/i.test(hex)) {
        return Number.parseInt(hex.slice(1), 16);
    }
    return fallback;
}

function compressDistanceMeters(distanceMeters: number): number {
    const distanceAu = Math.max(distanceMeters / constants.auMeters, 0);

    if (distanceAu <= 80) {
        return distanceAu * 1.92;
    }

    if (distanceAu <= 60000) {
        return 80 * 1.92 + Math.log10(1 + distanceAu - 80) * 30;
    }

    return 80 * 1.92 + Math.log10(1 + 60000 - 80) * 30 + Math.log10(1 + distanceAu / 60000) * 200;
}

function toScenePosition(position: { x: number; y: number; z: number }): THREE.Vector3 {
    const distance = Math.hypot(position.x, position.y, position.z);
    if (distance <= 1e-9) {
        return new THREE.Vector3(0, 0, 0);
    }

    const scaled = compressDistanceMeters(distance);
    const factor = scaled / distance;
    return new THREE.Vector3(position.x * factor, position.y * factor, position.z * factor);
}

function radiusToSceneUnits(body: UniverseBody): number {
    const base = clamp(Math.log10(Math.max(body.radiusMeters, 1)) - 4.95, 0.28, 10.5);

    if (body.kind === "star") {
        return base * 1.35;
    }

    if (body.kind === "black-hole") {
        return clamp(base * 0.8, 1.7, 7.8);
    }

    if (body.kind === "galaxy" || body.kind === "cluster" || body.kind === "nebula") {
        return clamp(base * 0.62, 1.2, 6.9);
    }

    if (body.kind === "meteor" || bodyLooksLikeAsteroid(body)) {
        return clamp(base * 0.28, 0.12, 0.7);
    }

    if (body.kind === "comet") {
        return clamp(base * 0.36, 0.18, 0.85);
    }

    return base;
}

function bodyIsMeteor(body: UniverseBody): boolean {
    return body.kind === "meteor" || body.name.startsWith("Meteor-");
}

function bodyIsComet(body: UniverseBody): boolean {
    return body.kind === "comet" || body.name.startsWith("Comet-");
}

function bodyLooksLikeAsteroid(body: UniverseBody): boolean {
    return body.name.startsWith("Asteroid-") || body.name.startsWith("Kuiper-");
}

function getBodyKey(body: UniverseBody): string {
    return `${body.kind}:${body.name}`;
}

function shouldRenderBody(body: UniverseBody): boolean {
    if (!body.alive) {
        return false;
    }

    if (!viewState.showMoons && body.kind === "moon") {
        return false;
    }

    if (!viewState.showHypothesis && body.isHypothesis) {
        return false;
    }

    if (!viewState.showMeteors && bodyIsMeteor(body)) {
        return false;
    }

    if (!viewState.showComets && bodyIsComet(body)) {
        return false;
    }

    return true;
}

function shouldLabelBody(body: UniverseBody): boolean {
    if (!viewState.showLabels) {
        return false;
    }

    if (body.kind === "meteor") {
        return false;
    }

    if (body.name.startsWith("Asteroid-") || body.name.startsWith("Kuiper-") || body.name.startsWith("Meteor-")) {
        return false;
    }

    return true;
}

function shouldTrailBody(body: UniverseBody): boolean {
    if (!viewState.showTrails) {
        return false;
    }
    return (
        body.kind === "planet"
        || body.kind === "dwarf"
        || body.kind === "moon"
        || body.kind === "comet"
        || body.kind === "meteor"
        || bodyLooksLikeAsteroid(body)
    );
}

function createLabelSprite(text: string, colorHex: string): THREE.Sprite {
    const canvasLabel = document.createElement("canvas");
    const ctx = canvasLabel.getContext("2d");
    const width = 340;
    const height = 100;
    canvasLabel.width = width;
    canvasLabel.height = height;

    if (ctx) {
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = "rgba(2, 9, 24, 0.72)";
        ctx.strokeStyle = "rgba(168, 207, 255, 0.62)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(8, 8, width - 16, height - 16, 12);
        ctx.fill();
        ctx.stroke();

        ctx.font = "700 24px 'Space Grotesk', sans-serif";
        ctx.fillStyle = /^#[0-9a-f]{6}$/i.test(colorHex) ? colorHex : "#dce9ff";
        ctx.fillText(text, 24, 60);
    }

    const texture = new THREE.CanvasTexture(canvasLabel);
    texture.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        depthTest: true,
    });

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(8.8, 2.4, 1);
    return sprite;
}

function createBodyNode(body: UniverseBody): BodyNode {
    const radius = radiusToSceneUnits(body);

    const detail = body.kind === "meteor" || bodyLooksLikeAsteroid(body)
        ? 10
        : body.kind === "comet"
            ? 12
            : 20;

    const geometry = new THREE.SphereGeometry(1, detail, detail);
    const color = resolveColor(body.colorHex, 0x89b7ff);

    const material = new THREE.MeshStandardMaterial({
        color,
        roughness: body.kind === "star" ? 0.25 : 0.62,
        metalness: body.kind === "black-hole" ? 0.45 : 0.08,
        emissive: body.kind === "star"
            ? new THREE.Color(color).multiplyScalar(0.35)
            : body.kind === "nebula"
                ? new THREE.Color(color).multiplyScalar(0.12)
                : new THREE.Color(0x000000),
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(toScenePosition(body.position));
    mesh.scale.setScalar(radius);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    scene.add(mesh);

    let label: THREE.Sprite | null = null;
    if (shouldLabelBody(body)) {
        label = createLabelSprite(body.name, body.colorHex);
        label.position.copy(mesh.position);
        label.position.y += radius * 1.8 + 0.2;
        scene.add(label);
    }

    let trail: THREE.Line | null = null;
    if (shouldTrailBody(body)) {
        const trailGeometry = new THREE.BufferGeometry();
        trailGeometry.setFromPoints([mesh.position.clone(), mesh.position.clone()]);
        const trailMaterial = new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity: 0.62,
        });
        trail = new THREE.Line(trailGeometry, trailMaterial);
        scene.add(trail);
    }

    return {
        body,
        mesh,
        label,
        trail,
        trailPoints: [mesh.position.clone()],
    };
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
    if (Array.isArray(material)) {
        material.forEach((item) => item.dispose());
        return;
    }
    material.dispose();
}

function disposeBodyNode(node: BodyNode): void {
    scene.remove(node.mesh);
    node.mesh.geometry.dispose();
    disposeMaterial(node.mesh.material);

    if (node.label) {
        scene.remove(node.label);
        if (node.label.material.map) {
            node.label.material.map.dispose();
        }
        node.label.material.dispose();
    }

    if (node.trail) {
        scene.remove(node.trail);
        node.trail.geometry.dispose();
        disposeMaterial(node.trail.material);
    }
}

function collectBodies(): UniverseBody[] {
    const majorBodies = engine.getMajorBodies();
    const smallBodies = engine.getSmallBodies();
    const contextBodies = viewState.showContext ? engine.getContextBodies() : [];

    return [...majorBodies, ...smallBodies, ...contextBodies].filter(shouldRenderBody);
}

function updateBodyNodes(): void {
    const bodies = collectBodies();
    const aliveIds = new Set<string>();

    for (const body of bodies) {
        const bodyKey = getBodyKey(body);
        aliveIds.add(bodyKey);

        let node = bodyNodes.get(bodyKey);
        if (!node) {
            node = createBodyNode(body);
            bodyNodes.set(bodyKey, node);
        }

        node.body = body;

        const nextPosition = toScenePosition(body.position);
        node.mesh.position.copy(nextPosition);
        const radius = radiusToSceneUnits(body);
        node.mesh.scale.setScalar(radius);

        const meshMaterial = node.mesh.material as THREE.MeshStandardMaterial;
        const nextColor = resolveColor(body.colorHex, 0x89b7ff);
        meshMaterial.color.setHex(nextColor);
        if (body.kind === "star") {
            meshMaterial.emissive.setHex(nextColor);
            meshMaterial.emissive.multiplyScalar(0.34);
        } else {
            meshMaterial.emissive.setHex(0x000000);
        }

        if (node.label && !shouldLabelBody(body)) {
            scene.remove(node.label);
            if (node.label.material.map) {
                node.label.material.map.dispose();
            }
            node.label.material.dispose();
            node.label = null;
        }

        if (!node.label && shouldLabelBody(body)) {
            node.label = createLabelSprite(body.name, body.colorHex);
            scene.add(node.label);
        }

        if (node.label) {
            node.label.visible = shouldLabelBody(body);
            node.label.position.copy(nextPosition);
            node.label.position.y += radius * 1.9 + 0.22;
        }

        if (node.trail && !shouldTrailBody(body)) {
            scene.remove(node.trail);
            node.trail.geometry.dispose();
            disposeMaterial(node.trail.material);
            node.trail = null;
            node.trailPoints.length = 0;
        }

        if (!node.trail && shouldTrailBody(body)) {
            const trailGeometry = new THREE.BufferGeometry();
            trailGeometry.setFromPoints([nextPosition.clone(), nextPosition.clone()]);
            const trailMaterial = new THREE.LineBasicMaterial({
                color: resolveColor(body.colorHex, 0x89b7ff),
                transparent: true,
                opacity: 0.58,
            });
            node.trail = new THREE.Line(trailGeometry, trailMaterial);
            node.trailPoints = [nextPosition.clone()];
            scene.add(node.trail);
        }

        if (node.trail) {
            const previous = node.trailPoints[node.trailPoints.length - 1];
            if (!previous || previous.distanceToSquared(nextPosition) > 0.03) {
                node.trailPoints.push(nextPosition.clone());
            }
            if (node.trailPoints.length > 220) {
                node.trailPoints.splice(0, node.trailPoints.length - 220);
            }
            node.trail.geometry.setFromPoints(node.trailPoints);
            node.trail.visible = viewState.showTrails;
        }
    }

    for (const [bodyKey, node] of bodyNodes) {
        if (!aliveIds.has(bodyKey)) {
            disposeBodyNode(node);
            bodyNodes.delete(bodyKey);
        }
    }
}

function fitRendererToCanvas(): void {
    const width = Math.max(560, canvas.clientWidth || 560);
    const height = Math.max(340, canvas.clientHeight || 340);

    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
}

function describeForecasts(): string {
    const forecasts = engine.getForecasts(10);
    if (forecasts.length === 0) {
        return "No forecasts available.";
    }

    return forecasts
        .map((forecast, index) => {
            return [
                `${index + 1}. [${forecast.kind}] ${forecast.bodyA} -> ${forecast.bodyB}`,
                `   etaYears=${forecast.etaYears.toFixed(6)} confidence=${(forecast.confidence * 100).toFixed(1)}%`,
            ].join("\n");
        })
        .join("\n");
}

function describeEvents(): string {
    const events = engine.getEvents(10);
    if (events.length === 0) {
        return "Belum ada event kosmik.";
    }

    return events
        .map((event) => {
            return [
                `#${event.id} [${event.kind}] t=${event.timeYears.toFixed(6)} years`,
                `  ${event.message}`,
                `  ${event.bodyA}${event.bodyB ? ` -> ${event.bodyB}` : ""} dv=${event.relSpeedMps.toFixed(2)} m/s`,
            ].join("\n");
        })
        .join("\n");
}

function renderPanels(): void {
    const snapshot = engine.getStateSnapshot();
    statusBoard.updateStatus({
        yearsElapsed: snapshot.yearsElapsed,
        totalBodies: snapshot.counts.allBodies,
        collisionCount: snapshot.collisionCount,
        timeScale: snapshot.timeScale,
        running: simulationRunning,
        focusTarget,
    });

    stateOutput.textContent = generateUniverseStateReport(snapshot);
    forecastOutput.textContent = describeForecasts();
    recommendOutput.textContent = generateRecommendationReport(engine.getAiRecommendations(6));
    eventOutput.textContent = describeEvents();

    runToggleButton.textContent = simulationRunning ? "Pause" : "Start";
}

function runOrbitCalculation(): void {
    const mass = Number(calcMassInput.value);
    const radius = Number(calcRadiusInput.value);

    if (!Number.isFinite(mass) || mass <= 0 || !Number.isFinite(radius) || radius <= 0) {
        calcOutput.textContent = "Mass dan radius harus positif dan finite.";
        return;
    }

    try {
        const sample = createOrbitSample(mass, radius);
        const speed = circularOrbitSpeed(mass, radius);
        const period = orbitalPeriodFromSemiMajorAxis(radius, mass);

        calcOutput.textContent = [
            generateSimulationReport(sample),
            "",
            `circularSpeedMps=${speed.toFixed(5)}`,
            `periodSeconds=${period.toFixed(5)}`,
            `periodDays=${(period / 86400).toFixed(6)}`,
        ].join("\n");
    } catch (error) {
        calcOutput.textContent = (error as Error).message;
    }
}

function runCoordinateCalculation(): void {
    const rightAscensionDeg = Number(calcRaInput.value);
    const declinationDeg = Number(calcDecInput.value);
    const distanceParsec = Number(calcPcInput.value);

    if (!Number.isFinite(rightAscensionDeg) || !Number.isFinite(declinationDeg) || !Number.isFinite(distanceParsec)) {
        coordOutput.textContent = "Input koordinat harus angka finite.";
        return;
    }

    try {
        const cartesian = equatorialToCartesian({
            rightAscensionDeg,
            declinationDeg,
            distanceParsec,
        });

        coordOutput.textContent = [
            `xMeters=${cartesian.xMeters.toExponential(6)}`,
            `yMeters=${cartesian.yMeters.toExponential(6)}`,
            `zMeters=${cartesian.zMeters.toExponential(6)}`,
        ].join("\n");
    } catch (error) {
        coordOutput.textContent = (error as Error).message;
    }
}

function setRunning(nextValue: boolean): void {
    simulationRunning = nextValue;
    engine.setPaused(!nextValue);
    runToggleButton.textContent = nextValue ? "Pause" : "Start";
}

function applyViewInputs(): void {
    toggleMoonsInput.checked = viewState.showMoons;
    toggleContextInput.checked = viewState.showContext;
    toggleHypothesisInput.checked = viewState.showHypothesis;
    toggleLabelsInput.checked = viewState.showLabels;
    toggleTrailsInput.checked = viewState.showTrails;
    toggleMeteorsInput.checked = viewState.showMeteors;
    toggleCometsInput.checked = viewState.showComets;
}

function refreshFocusOptions(): void {
    const names = [
        ...engine.getMajorBodies().map((body) => body.name),
        ...(viewState.showContext ? engine.getContextBodies().map((body) => body.name) : []),
    ];

    const uniqueNames = Array.from(new Set(names));
    const previous = focusSelect.value || focusTarget;
    focusSelect.innerHTML = uniqueNames
        .map((name) => `<option value="${name}">${name}</option>`)
        .join("");

    if (uniqueNames.includes(previous)) {
        focusSelect.value = previous;
        focusTarget = previous;
    } else if (uniqueNames.length > 0) {
        focusSelect.value = uniqueNames[0];
        focusTarget = uniqueNames[0];
    }
}

function printTerminal(message: string, level: TerminalLevel = "output"): void {
    terminal.print(message, level);
}

function runTerminal(commandRaw: string): void {
    const command = commandRaw.trim();
    if (!command) {
        return;
    }

    printTerminal(`orbinex@sim:$ ${command}`, "command");
    const normalized = command.toLowerCase();

    if (normalized === "clear") {
        terminal.clearHistory();
        return;
    }

    if (normalized === "help") {
        [
            "Commands:",
            "- help",
            "- run | pause",
            "- status",
            "- step --n <count>",
            "- meteor --count <n>",
            "- comet --count <n>",
            "- supernova",
            "- forecast",
            "- rec",
            "- timescale --value <n>",
            "- dt --value <seconds>",
            "- focus <name>",
            "- search <keyword>",
            "- view moons|context|hypothesis|labels|trails|meteors|comets on|off",
            "- orbinex speed --mass <kg> --radius <m>",
            "- orbinex period --mass <kg> --axis <m>",
            "- clear",
        ].forEach((entry) => printTerminal(entry));
        return;
    }

    if (normalized === "run") {
        setRunning(true);
        printTerminal("Simulation resumed.");
        return;
    }

    if (normalized === "pause") {
        setRunning(false);
        printTerminal("Simulation paused.");
        return;
    }

    if (normalized === "status") {
        generateUniverseStateReport(engine.getStateSnapshot())
            .split("\n")
            .forEach((entry) => printTerminal(entry));
        return;
    }

    if (normalized.startsWith("step")) {
        const count = parsePositiveInteger(String(parseFlag(command, "n", 1)), 1);
        const summary = engine.step(count);
        printTerminal(
            `performedSteps=${summary.performedSteps} yearsElapsed=${summary.yearsElapsed.toFixed(6)} bodyCount=${summary.bodyCount}`,
        );
        renderPanels();
        return;
    }

    if (normalized.startsWith("meteor")) {
        const count = parsePositiveInteger(String(parseFlag(command, "count", 1)), 1);
        engine.spawnMeteorShower(count);
        printTerminal(`spawned meteor count=${count}`);
        return;
    }

    if (normalized.startsWith("comet")) {
        const count = parsePositiveInteger(String(parseFlag(command, "count", 1)), 1);
        engine.spawnCometWave(count);
        printTerminal(`spawned comet count=${count}`);
        return;
    }

    if (normalized === "supernova") {
        engine.triggerSupernova("Betelgeuse");
        printTerminal("Supernova trigger dikirim untuk Betelgeuse.");
        return;
    }

    if (normalized === "forecast") {
        describeForecasts()
            .split("\n")
            .forEach((entry) => printTerminal(entry));
        return;
    }

    if (normalized === "rec") {
        generateRecommendationReport(engine.getAiRecommendations(6))
            .split("\n")
            .forEach((entry) => printTerminal(entry));
        return;
    }

    if (normalized.startsWith("timescale")) {
        const value = parseFlag(command, "value", engine.currentTimeScale);
        if (!Number.isFinite(value) || value <= 0) {
            printTerminal("timescale harus positif.", "error");
            return;
        }
        engine.setTimeScale(value);
        settingScaleInput.value = String(value);
        printTerminal(`timeScale updated to ${value}`);
        renderPanels();
        return;
    }

    if (normalized.startsWith("dt")) {
        const value = parseFlag(command, "value", engine.getStateSnapshot().baseDtSeconds);
        if (!Number.isFinite(value) || value <= 0) {
            printTerminal("dt harus positif.", "error");
            return;
        }
        engine.setBaseDtSeconds(value);
        settingDtInput.value = String(value);
        printTerminal(`baseDt updated to ${value}`);
        renderPanels();
        return;
    }

    if (normalized.startsWith("focus ")) {
        const targetName = command.slice(6).trim();
        if (!targetName) {
            printTerminal("Usage: focus <name>", "error");
            return;
        }

        const names = new Set([
            ...engine.getMajorBodies().map((body) => body.name.toLowerCase()),
            ...engine.getContextBodies().map((body) => body.name.toLowerCase()),
            ...engine.getSmallBodies().map((body) => body.name.toLowerCase()),
        ]);

        if (!names.has(targetName.toLowerCase())) {
            printTerminal("Objek tidak ditemukan di semesta aktif.", "error");
            return;
        }

        focusTarget = targetName;
        const option = Array.from(focusSelect.options).find((entry) => entry.value.toLowerCase() === targetName.toLowerCase());
        if (option) {
            focusSelect.value = option.value;
            focusTarget = option.value;
        }

        printTerminal(`Focus locked to ${focusTarget}`);
        renderPanels();
        return;
    }

    if (normalized.startsWith("search ")) {
        const keyword = command.slice(7).trim().toLowerCase();
        if (!keyword) {
            printTerminal("Usage: search <keyword>", "error");
            return;
        }

        const allNames = [
            ...engine.getMajorBodies().map((body) => body.name),
            ...engine.getContextBodies().map((body) => body.name),
            ...engine.getSmallBodies().map((body) => body.name),
        ];

        const result = allNames.filter((name) => name.toLowerCase().includes(keyword)).slice(0, 20);
        if (result.length === 0) {
            printTerminal("Tidak ada objek yang cocok.");
            return;
        }

        printTerminal(`Ditemukan ${result.length} objek:`);
        result.forEach((name) => printTerminal(`- ${name}`));
        return;
    }

    if (normalized.startsWith("view ")) {
        const parts = normalized.split(/\s+/);
        if (parts.length < 3) {
            printTerminal("Usage: view <target> <on|off>", "error");
            return;
        }

        const target = parts[1];
        const action = parts[2];
        if (action !== "on" && action !== "off") {
            printTerminal("Action harus on/off.", "error");
            return;
        }

        const enabled = action === "on";

        if (target === "moons") {
            viewState.showMoons = enabled;
        } else if (target === "context") {
            viewState.showContext = enabled;
            refreshFocusOptions();
        } else if (target === "hypothesis") {
            viewState.showHypothesis = enabled;
        } else if (target === "labels") {
            viewState.showLabels = enabled;
        } else if (target === "trails") {
            viewState.showTrails = enabled;
        } else if (target === "meteors") {
            viewState.showMeteors = enabled;
        } else if (target === "comets") {
            viewState.showComets = enabled;
        } else {
            printTerminal("Target view tidak dikenal.", "error");
            return;
        }

        applyViewInputs();
        printTerminal(`view ${target}=${enabled ? "on" : "off"}`);
        return;
    }

    if (normalized.startsWith("orbinex speed")) {
        const mass = parseFlag(command, "mass", constants.solarMassKg);
        const radius = parseFlag(command, "radius", constants.auMeters);
        try {
            const speed = circularOrbitSpeed(mass, radius);
            printTerminal(`speed_mps=${speed.toFixed(5)}`);
        } catch (error) {
            printTerminal((error as Error).message, "error");
        }
        return;
    }

    if (normalized.startsWith("orbinex period")) {
        const mass = parseFlag(command, "mass", constants.solarMassKg);
        const axis = parseFlag(command, "axis", constants.auMeters);
        try {
            const period = orbitalPeriodFromSemiMajorAxis(axis, mass);
            printTerminal(`period_seconds=${period.toFixed(5)}`);
            printTerminal(`period_days=${(period / 86400).toFixed(6)}`);
        } catch (error) {
            printTerminal((error as Error).message, "error");
        }
        return;
    }

    printTerminal("Unknown command. Type help.", "error");
}

function updateFocusTarget(): void {
    const node = Array.from(bodyNodes.values()).find((entry) => entry.body.name.toLowerCase() === focusTarget.toLowerCase());
    if (!node) {
        return;
    }

    controls.target.lerp(node.mesh.position, 0.12);

    if (node.body.kind === "star") {
        sunlight.position.copy(node.mesh.position);
    }
}

function bindInputs(): void {
    runToggleButton.addEventListener("click", () => {
        setRunning(!simulationRunning);
    });

    stepOneButton.addEventListener("click", () => {
        engine.step(1);
        renderPanels();
    });

    stepTenButton.addEventListener("click", () => {
        engine.step(10);
        renderPanels();
    });

    spawnMeteorButton.addEventListener("click", () => {
        engine.spawnMeteorShower(6);
        renderPanels();
    });

    spawnCometButton.addEventListener("click", () => {
        engine.spawnCometWave(3);
        renderPanels();
    });

    triggerSupernovaButton.addEventListener("click", () => {
        engine.triggerSupernova("Betelgeuse");
        renderPanels();
    });

    physicsForm.addEventListener("submit", (event) => {
        event.preventDefault();

        const dt = Number(settingDtInput.value);
        const scale = Number(settingScaleInput.value);

        if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(scale) || scale <= 0) {
            stateOutput.textContent = "Base dt dan time scale harus positif.";
            return;
        }

        engine.setBaseDtSeconds(dt);
        engine.setTimeScale(scale);
        renderPanels();
    });

    toggleMoonsInput.addEventListener("change", () => {
        viewState.showMoons = toggleMoonsInput.checked;
    });

    toggleContextInput.addEventListener("change", () => {
        viewState.showContext = toggleContextInput.checked;
        refreshFocusOptions();
    });

    toggleHypothesisInput.addEventListener("change", () => {
        viewState.showHypothesis = toggleHypothesisInput.checked;
    });

    toggleLabelsInput.addEventListener("change", () => {
        viewState.showLabels = toggleLabelsInput.checked;
    });

    toggleTrailsInput.addEventListener("change", () => {
        viewState.showTrails = toggleTrailsInput.checked;
    });

    toggleMeteorsInput.addEventListener("change", () => {
        viewState.showMeteors = toggleMeteorsInput.checked;
    });

    toggleCometsInput.addEventListener("change", () => {
        viewState.showComets = toggleCometsInput.checked;
    });

    focusForm.addEventListener("submit", (event) => {
        event.preventDefault();
        focusTarget = focusSelect.value;
        renderPanels();
    });

    orbitForm.addEventListener("submit", (event) => {
        event.preventDefault();
        runOrbitCalculation();
    });

    coordForm.addEventListener("submit", (event) => {
        event.preventDefault();
        runCoordinateCalculation();
    });

    terminal.addEventListener("terminal-command", (event) => {
        runTerminal((event as TerminalCommandEvent).detail);
    });

    window.addEventListener("resize", () => {
        fitRendererToCanvas();
    });
}

async function runSplashSequence(): Promise<void> {
    const steps: Array<{ progress: number; message: string }> = [
        { progress: 15, message: "Menyiapkan komponen semesta..." },
        { progress: 32, message: "Menyusun peta gravitasi utama..." },
        { progress: 50, message: "Menyalakan renderer 3D..." },
        { progress: 68, message: "Memuat objek konteks kosmik..." },
        { progress: 84, message: "Sinkronisasi AI recommendation engine..." },
        { progress: 100, message: "Universe siap dijalankan." },
    ];

    for (const step of steps) {
        splash.setProgress(step.progress, step.message);
        // Memberi tempo singkat agar transisi splash terasa natural.
        // eslint-disable-next-line no-await-in-loop
        await new Promise<void>((resolve) => {
            window.setTimeout(() => resolve(), 180);
        });
    }

    splash.complete();
}

let lastFrame = performance.now();
let lastPanelRefresh = 0;
let simulationAccumulatorMs = 0;
const SIMULATION_STEP_MS = 95;

function renderLoop(timestamp: number): void {
    const deltaMs = timestamp - lastFrame;
    lastFrame = timestamp;

    starfield.rotation.y += 0.00005;

    if (simulationRunning) {
        simulationAccumulatorMs += deltaMs;
        while (simulationAccumulatorMs >= SIMULATION_STEP_MS) {
            engine.step(1);
            simulationAccumulatorMs -= SIMULATION_STEP_MS;
        }
    }

    updateBodyNodes();
    updateFocusTarget();
    controls.update();
    renderer.render(scene, camera);

    if (timestamp - lastPanelRefresh > 180) {
        renderPanels();
        lastPanelRefresh = timestamp;
    }

    window.requestAnimationFrame(renderLoop);
}

bindInputs();
applyViewInputs();
refreshFocusOptions();
runOrbitCalculation();
runCoordinateCalculation();
fitRendererToCanvas();
setRunning(true);
renderPanels();

printTerminal("OrbinexSimulation terminal ready.");
printTerminal("Type help untuk daftar command.");

window.requestAnimationFrame(renderLoop);
void runSplashSequence();
