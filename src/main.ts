import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import {
    constants,
    createUniverseEngine,
    type UniverseBody,
    type UniverseForecast,
    type UniverseOrbitGuide,
    type UniverseSimulationEvent,
} from "./orbinex-compat";

import "./styles.css";

type UiLanguage = "id" | "en";

type ViewState = {
    showContext: boolean;
    showHypothesis: boolean;
    showTrails: boolean;
    showOrbitalGuides: boolean;
    showLabels: boolean;
    showAsteroids: boolean;
    showComets: boolean;
    scientificDataOnly: boolean;
    hierarchyMin: number;
    hierarchyMax: number;
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

type NasaExoplanetRow = {
    pl_name?: string;
    hostname?: string;
    ra?: number;
    dec?: number;
    sy_dist?: number;
    pl_orbsmax?: number | null;
    pl_orbper?: number | null;
    pl_bmasse?: number | null;
    pl_rade?: number | null;
    st_mass?: number | null;
    st_rad?: number | null;
};

type ExternalCatalogEntry = {
    name: string;
    kind: UniverseBody["kind"];
    raDeg: number;
    decDeg: number;
    distancePc: number;
    massKg?: number;
    radiusMeters?: number;
    colorHex?: string;
    parentName?: string | null;
    description?: string;
    imageUrl?: string;
};

type IngestStatus = {
    source: string;
    mode: "online" | "fallback" | "failed";
    count: number;
    note: string;
};

type IngestRunSummary = {
    statuses: IngestStatus[];
    generatedAt: string | null;
    durationMs: number;
};

type AgencyCatalogSourceFile = {
    mode?: "online" | "fallback";
    note?: string;
    entries?: ExternalCatalogEntry[];
};

type AgencyCatalogFile = {
    generatedAt?: string;
    nasa?: {
        mode?: "online" | "fallback";
        note?: string;
        rows?: NasaExoplanetRow[];
    };
    agencies?: Record<string, AgencyCatalogSourceFile>;
};

type BodyNode = {
    key: string;
    body: UniverseBody;
    mesh: THREE.Mesh;
    label: THREE.Sprite | null;
    ring: THREE.Mesh | null;
    spinRadPerSec: number;
    trail: THREE.Line | null;
    trailPoints: THREE.Vector3[];
};

type CameraFlight = {
    fromPosition: THREE.Vector3;
    toPosition: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    startMs: number;
    durationMs: number;
};

type EventPulse = {
    core: THREE.Mesh;
    ring: THREE.Mesh | null;
    ageMs: number;
    lifetimeMs: number;
    startScale: number;
    endScale: number;
    spinSpeed: number;
};

type SolarRenderAnchor = {
    physicalPosition: { x: number; y: number; z: number };
    renderPosition: THREE.Vector3;
    distanceScale?: number;
};

type DynamicCatalogOrbitState = {
    bodyName: string;
    parentName: string;
    semiMajorMeters: number;
    omegaRadPerSec: number;
    inclinationRad: number;
    phaseRad: number;
    eccentricity: number;
    ascendingNodeRad: number;
    argumentPeriapsisRad: number;
};

type GalaxyMorphology = "elliptical" | "spiral" | "barred-spiral" | "irregular";

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

function degToRad(value: number): number {
    return (value * Math.PI) / 180;
}

function hashString(text: string): number {
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
        hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
}

const bodyRotationHoursByName: Record<string, number> = {
    Matahari: 609,
    Merkurius: 1407.6,
    Venus: -5832.5,
    Bumi: 23.934,
    Bulan: 655.7,
    Mars: 24.623,
    Jupiter: 9.925,
    Saturnus: 10.7,
    Uranus: -17.24,
    Neptunus: 16.11,
    Io: 42.46,
    Europa: 85.2,
    Ganymede: 171.7,
    Callisto: 400.5,
    Titan: 382.7,
    Rhea: 108,
    Iapetus: 1903,
    Enceladus: 32.9,
    Mimas: 22.6,
    Tethys: 45.3,
    Dione: 65.7,
    Triton: -141.1,
};

const logoUrl = `${import.meta.env.BASE_URL}orbinex-logo.svg`;
const EARTH_MASS = 5.9722e24;
const EARTH_RADIUS = 6.371e6;
const SOLAR_RADIUS = 6.9634e8;
const YEAR_SECONDS = 365.25 * 86400;
const AUTO_REFRESH_MS = 45 * 1000;
const PLANCK_REDUCED = 1.054571817e-34;
const BOLTZMANN = 1.380649e-23;

const app = byId<HTMLElement>("app");
app.innerHTML = `
  <main id="sim-main" class="sim-root" aria-label="Orbinex full canvas simulation">
        <canvas id="universe-canvas" aria-label="Kanvas simulasi semesta tiga dimensi"></canvas>

        <section id="splash" class="splash is-visible" role="dialog" aria-modal="true" aria-label="Memuat OrbinexSimulation">
            <img src="${logoUrl}" alt="Logo Orbinex" width="128" height="128" />
            <p class="splash-kicker">ORBINEXSIMULATION</p>
            <h1>Universe Sandbox Scientific 3D</h1>
            <p id="splash-status">Menyalakan mesin fisika...</p>
            <progress id="splash-progress" max="100" value="8" aria-label="Kemajuan memuat simulasi"></progress>
            <span id="splash-percent" class="splash-percent">8%</span>
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
                        <button id="btn-guides" type="button">LINTASAN</button>
                <button id="btn-label" type="button">LABEL</button>
                <button id="btn-info" type="button">INFO</button>
                <button id="btn-search" type="button">CARI</button>
                        <button id="btn-science" type="button">SCI:OFF</button>
                <button id="btn-ref" type="button">REF</button>
                <button id="btn-help" type="button">BANTU</button>
                <button id="btn-language" type="button">BAHASA: ID</button>
            </div>
        </header>

        <aside class="hud-panel" aria-live="polite">
        <pre id="hud-text">Memuat telemetry...</pre>
        </aside>

        <aside id="right-stack" class="right-stack" aria-label="Stack panel kanan">
            <section id="search-panel" class="search-panel" aria-label="Panel pencarian objek">
                <div class="search-row">
                    <input id="search-input" list="search-suggestions" placeholder="Cari objek... (tekan /)" aria-label="Cari objek semesta" />
                    <button id="search-go" type="button">GO</button>
                    <button id="search-clear" type="button">CLR</button>
                </div>
                <datalist id="search-suggestions"></datalist>
                <p id="search-meta">Indeks pencarian: 0</p>
                <ol id="search-results" class="search-results"></ol>
            </section>

            <section id="hierarchy-panel" class="hierarchy-panel" aria-label="Panel filter hirarki kosmik">
                <h2>Filter Hirarki 1-13</h2>
                <div class="hierarchy-row">
                    <label for="hierarchy-min">Min</label>
                    <input id="hierarchy-min" type="range" min="1" max="13" step="1" value="1" />
                    <span id="hierarchy-min-value">1</span>
                </div>
                <div class="hierarchy-row">
                    <label for="hierarchy-max">Max</label>
                    <input id="hierarchy-max" type="range" min="1" max="13" step="1" value="13" />
                    <span id="hierarchy-max-value">13</span>
                </div>
                <p id="hierarchy-note">Menampilkan level 1 sampai 13.</p>
                <button id="hierarchy-reset" type="button">RESET HIRARKI</button>
            </section>

            <section id="info-panel" class="info-panel" aria-live="polite" aria-label="Panel detail objek">
                <div class="info-head">
                    <canvas id="info-preview" class="info-image" aria-label="Pratinjau 3D objek"></canvas>
                    <div>
                        <h2 id="info-name">Tidak ada objek dipilih</h2>
                        <p id="info-kind">-</p>
                        <p id="info-source" class="info-source">Sumber: Orbinex Engine</p>
                        <p id="info-quality" class="info-quality">Kualitas referensi: internal model</p>
                        <p id="info-parent" class="info-parent">Parent: -</p>
                    </div>
                </div>
                <dl>
                    <div><dt>Massa</dt><dd id="info-mass">-</dd></div>
                    <div><dt>Radius</dt><dd id="info-radius">-</dd></div>
                    <div><dt>Jarak ke Matahari</dt><dd id="info-distance-sun">-</dd></div>
                    <div><dt>Jarak tampilan</dt><dd id="info-distance-render">-</dd></div>
                    <div><dt>Kecepatan</dt><dd id="info-speed">-</dd></div>
                    <div><dt>Suhu perkiraan</dt><dd id="info-temperature">-</dd></div>
                    <div><dt>Rotasi</dt><dd id="info-rotation">-</dd></div>
                    <div><dt>Revolusi</dt><dd id="info-revolution">-</dd></div>
                    <div><dt>Tingkat struktur</dt><dd id="info-hierarchy">-</dd></div>
                    <div><dt>Tipe orbit</dt><dd id="info-orbit-type">-</dd></div>
                    <div><dt>Gravitasi permukaan</dt><dd id="info-gravity">-</dd></div>
                    <div><dt>Kecepatan lepas</dt><dd id="info-escape">-</dd></div>
                    <div><dt>Fluks radiasi</dt><dd id="info-radiation">-</dd></div>
                    <div><dt>UV relatif</dt><dd id="info-uv">-</dd></div>
                    <div><dt>Radius Schwarzschild</dt><dd id="info-schwarzschild">-</dd></div>
                    <div><dt>Suhu Hawking</dt><dd id="info-hawking">-</dd></div>
                    <div><dt>Posisi</dt><dd id="info-position">-</dd></div>
                    <div><dt>Velocity</dt><dd id="info-velocity">-</dd></div>
                </dl>
                <p id="info-description" class="info-desc">Arahkan mouse ke objek untuk melihat detail ilmiah.</p>
                <button id="info-pin" type="button" class="info-pin">Pin Panel</button>
            </section>

            <section class="events-panel" aria-label="Panel event simulasi">
                <h2>Log event berbasis AI</h2>
                <p class="events-tip">Klik event untuk fokus ke koordinat kejadian.</p>
                <ol id="events-list" class="events-list">
                    <li class="event-item event-item-empty">Belum ada event.</li>
                </ol>
            </section>
        </aside>

        <section id="help-panel" class="help-panel" aria-label="Bantuan kontrol">
        <h2>Hint kontrol</h2>
        <ul>
            <li>Drag untuk orbit kamera, wheel untuk zoom.</li>
            <li>TAB atau tombol FOKUS+ untuk ganti objek fokus.</li>
            <li>SPACE untuk pause/jalan.</li>
            <li>T untuk jejak, L untuk label, C untuk konteks, / untuk cari.</li>
                    <li>R untuk reset kamera kembali mengorbit Bumi.</li>
            <li>Klik objek untuk pin panel detail.</li>
        </ul>
        </section>

        <p id="bottom-hint" class="bottom-hint">Ringkas: drag/arrow orbit kamera | wheel zoom | TAB fokus | / cari | R reset bumi | klik objek pin panel</p>
  </main>
`;

const canvas = byId<HTMLCanvasElement>("universe-canvas");
const splash = byId<HTMLElement>("splash");
const splashStatus = byId<HTMLElement>("splash-status");
const splashProgress = byId<HTMLProgressElement>("splash-progress");
const splashPercent = byId<HTMLElement>("splash-percent");

const hudText = byId<HTMLPreElement>("hud-text");
const eventsList = byId<HTMLOListElement>("events-list");
const bottomHint = byId<HTMLElement>("bottom-hint");

const searchPanel = byId<HTMLElement>("search-panel");
const searchInput = byId<HTMLInputElement>("search-input");
const searchMeta = byId<HTMLElement>("search-meta");
const searchSuggestions = byId<HTMLDataListElement>("search-suggestions");
const searchResults = byId<HTMLOListElement>("search-results");
const searchGo = byId<HTMLButtonElement>("search-go");
const searchClear = byId<HTMLButtonElement>("search-clear");
const hierarchyPanel = byId<HTMLElement>("hierarchy-panel");
const hierarchyMinInput = byId<HTMLInputElement>("hierarchy-min");
const hierarchyMaxInput = byId<HTMLInputElement>("hierarchy-max");
const hierarchyMinValue = byId<HTMLElement>("hierarchy-min-value");
const hierarchyMaxValue = byId<HTMLElement>("hierarchy-max-value");
const hierarchyNote = byId<HTMLElement>("hierarchy-note");
const hierarchyResetButton = byId<HTMLButtonElement>("hierarchy-reset");

const infoPanel = byId<HTMLElement>("info-panel");
const infoPreviewCanvas = byId<HTMLCanvasElement>("info-preview");
const infoName = byId<HTMLElement>("info-name");
const infoKind = byId<HTMLElement>("info-kind");
const infoSource = byId<HTMLElement>("info-source");
const infoQuality = byId<HTMLElement>("info-quality");
const infoParent = byId<HTMLElement>("info-parent");
const infoMass = byId<HTMLElement>("info-mass");
const infoRadius = byId<HTMLElement>("info-radius");
const infoDistanceSun = byId<HTMLElement>("info-distance-sun");
const infoDistanceRender = byId<HTMLElement>("info-distance-render");
const infoSpeed = byId<HTMLElement>("info-speed");
const infoTemperature = byId<HTMLElement>("info-temperature");
const infoRotation = byId<HTMLElement>("info-rotation");
const infoRevolution = byId<HTMLElement>("info-revolution");
const infoHierarchy = byId<HTMLElement>("info-hierarchy");
const infoOrbitType = byId<HTMLElement>("info-orbit-type");
const infoGravity = byId<HTMLElement>("info-gravity");
const infoEscape = byId<HTMLElement>("info-escape");
const infoRadiation = byId<HTMLElement>("info-radiation");
const infoUv = byId<HTMLElement>("info-uv");
const infoSchwarzschild = byId<HTMLElement>("info-schwarzschild");
const infoHawking = byId<HTMLElement>("info-hawking");
const infoPosition = byId<HTMLElement>("info-position");
const infoVelocity = byId<HTMLElement>("info-velocity");
const infoDescription = byId<HTMLElement>("info-description");
const infoPinButton = byId<HTMLButtonElement>("info-pin");

const runButton = byId<HTMLButtonElement>("btn-run");
const focusButton = byId<HTMLButtonElement>("btn-focus");
const trailButton = byId<HTMLButtonElement>("btn-trail");
const guidesButton = byId<HTMLButtonElement>("btn-guides");
const labelButton = byId<HTMLButtonElement>("btn-label");
const infoButton = byId<HTMLButtonElement>("btn-info");
const searchButton = byId<HTMLButtonElement>("btn-search");
const scienceButton = byId<HTMLButtonElement>("btn-science");
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
        guidesOn: "LINTASAN",
        guidesOff: "LINTASAN:OFF",
        labelOn: "LABEL",
        labelOff: "LABEL:OFF",
        infoOn: "INFO",
        infoOff: "INFO:OFF",
        searchOn: "CARI",
        searchOff: "CARI:OFF",
        scienceOn: "SCI:ON",
        scienceOff: "SCI:OFF",
        helpOn: "BANTU",
        helpOff: "BANTU:OFF",
        lang: "BAHASA: ID",
        bottomHint: "Ringkas: drag/arrow orbit kamera | wheel zoom | TAB fokus | / cari | R reset bumi | klik objek pin panel",
        searchPlaceholder: "Cari objek... (tekan /)",
    },
    en: {
        pause: "PAUSE",
        resume: "RUN",
        focus: "FOCUS+",
        trailOn: "TRAIL",
        trailOff: "TRAIL:OFF",
        guidesOn: "ORBIT",
        guidesOff: "ORBIT:OFF",
        labelOn: "LABEL",
        labelOff: "LABEL:OFF",
        infoOn: "INFO",
        infoOff: "INFO:OFF",
        searchOn: "SEARCH",
        searchOff: "SEARCH:OFF",
        scienceOn: "SCI:ON",
        scienceOff: "SCI:OFF",
        helpOn: "HELP",
        helpOff: "HELP:OFF",
        lang: "LANG: EN",
        bottomHint: "Hint: drag/arrow orbit | wheel zoom | TAB next focus | / search | R reset Earth | click object to pin panel",
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
    showOrbitalGuides: true,
    showLabels: true,
    showAsteroids: true,
    showComets: true,
    scientificDataOnly: false,
    hierarchyMin: 1,
    hierarchyMax: 13,
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
scene.fog = new THREE.Fog("#020814", 600, 26000);

const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const camera = new THREE.PerspectiveCamera(58, 1, 0.05, 50000);
camera.position.set(0, 95, 220);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.zoomSpeed = 0.12;
controls.minDistance = 2.5;
controls.maxDistance = 18000;
controls.enablePan = false;

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

const orbitGuideGroup = new THREE.Group();
scene.add(orbitGuideGroup);

const eventPulseGroup = new THREE.Group();
scene.add(eventPulseGroup);

const eventPulseCoreGeometry = new THREE.SphereGeometry(1, 16, 16);
const eventPulseRingGeometry = new THREE.RingGeometry(0.84, 1.08, 52);

const bodyNodes = new Map<string, BodyNode>();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2(2, 2);

const nasaCatalogBodies: UniverseBody[] = [];
const nasaCatalogIndex = new Set<string>();
let nasaCatalogStatus = "loading";
let nasaCatalogEntries = 0;
let lastOrbitGuideBuild = -1;
const localEvents: string[] = [];
let supernovaAutoTriggered = false;
const bodySourcesByName = new Map<string, Set<string>>();
const bodyDescriptionsDynamic = new Map<string, string>();
const bodyImagesDynamic = new Map<string, string>();
const ingestStatuses = new Map<string, IngestStatus>();
const eventById = new Map<number, UniverseSimulationEvent>();
const seenEventIds = new Set<number>();
const dismissedEventIds = new Set<number>();
const forecastByKey = new Map<string, UniverseForecast>();
const eventPulses: EventPulse[] = [];
const dynamicCatalogOrbits = new Map<string, DynamicCatalogOrbitState>();
const syntheticGalaxyBodyNames = new Set<string>();
let engineEventsSynced = false;
let cameraFlight: CameraFlight | null = null;
let focusSuspendUntilMs = 0;
let latestCatalogGeneratedAt = "";
let catalogRefreshTimer: number | null = null;

const bodyDescriptions: Record<string, string> = {
    Matahari: "Bintang pusat sistem; sumber utama energi dan referensi gravitasi.",
    Bumi: "Planet terestrial dengan biosfer aktif dan satelit alami Bulan.",
    Jupiter: "Planet jovian terbesar; mendominasi resonansi gravitasi planet luar.",
    Saturnus: "Planet cincin utama dengan sistem satelit kompleks.",
    "Sagittarius A*": "Black hole supermasif di pusat galaksi Bima Sakti.",
    "Bima Sakti": "Galaksi spiral rumah sistem surya pada lengan Orion.",
    "Andromeda (M31)": "Galaksi tetangga terbesar di Grup Lokal.",
};

const bodyImagesByName: Record<string, string> = {
    Matahari: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Solar_sys8.jpg/640px-Solar_sys8.jpg",
    Merkurius: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/Mercury_in_true_color.jpg/640px-Mercury_in_true_color.jpg",
    Venus: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/Venus-real_color.jpg/640px-Venus-real_color.jpg",
    Bumi: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/97/The_Earth_seen_from_Apollo_17.jpg/640px-The_Earth_seen_from_Apollo_17.jpg",
    Bulan: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e1/FullMoon2010.jpg/640px-FullMoon2010.jpg",
    Mars: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/02/OSIRIS_Mars_true_color.jpg/640px-OSIRIS_Mars_true_color.jpg",
    Jupiter: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e2/Jupiter.jpg/640px-Jupiter.jpg",
    Saturnus: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c7/Saturn_during_Equinox.jpg/640px-Saturn_during_Equinox.jpg",
    Uranus: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3d/Uranus2.jpg/640px-Uranus2.jpg",
    Neptunus: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/Neptune_Full.jpg/640px-Neptune_Full.jpg",
    "Sagittarius A*": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Sagittarius_A%2A.jpg/640px-Sagittarius_A%2A.jpg",
    "Bima Sakti": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/60/Milky_Way_Galaxy.jpg/640px-Milky_Way_Galaxy.jpg",
    "Andromeda (M31)": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Andromeda_Galaxy_%28with_h-alpha%29.jpg/640px-Andromeda_Galaxy_%28with_h-alpha%29.jpg",
};

const bodyImagesByKind: Partial<Record<UniverseBody["kind"], string>> = {
    star: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d5/Sun_poster.svg/512px-Sun_poster.svg.png",
    planet: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/97/The_Earth_seen_from_Apollo_17.jpg/512px-The_Earth_seen_from_Apollo_17.jpg",
    moon: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e1/FullMoon2010.jpg/512px-FullMoon2010.jpg",
    dwarf: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ef/Pluto_in_True_Color_-_High-Res.jpg/512px-Pluto_in_True_Color_-_High-Res.jpg",
    comet: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/Comet_Hale-Bopp_1995O1.jpg/640px-Comet_Hale-Bopp_1995O1.jpg",
    meteor: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/99/Bolide2.jpg/640px-Bolide2.jpg",
    "black-hole": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/Black_hole_-_Messier_87_crop_max_res.jpg/640px-Black_hole_-_Messier_87_crop_max_res.jpg",
    galaxy: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/Andromeda_Galaxy_%28with_h-alpha%29.jpg/640px-Andromeda_Galaxy_%28with_h-alpha%29.jpg",
    cluster: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Pleiades_large.jpg/640px-Pleiades_large.jpg",
    nebula: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/Orion_Nebula_-_Hubble_2006_mosaic_18000.jpg/640px-Orion_Nebula_-_Hubble_2006_mosaic_18000.jpg",
    hypothesis: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/ESO-VLT-Laser-phot-33a-07.jpg/640px-ESO-VLT-Laser-phot-33a-07.jpg",
};

function mergeBodySources(name: string, sources: string[]): void {
    const set = bodySourcesByName.get(name) ?? new Set<string>();
    for (const source of sources) {
        if (source.trim().length > 0) {
            set.add(source);
        }
    }
    if (set.size === 0) {
        set.add("Orbinex Engine");
    }
    bodySourcesByName.set(name, set);
}

const sourceQualityScore: Record<string, number> = {
    "Orbinex Engine": 1,
    "External Catalog": 3,
    "Synthetic Galaxy Model": 1,
    "Scientific Hierarchy Model": 2,
    NASA: 5,
    ESA: 5,
    JAXA: 5,
    NED: 5,
    SIMBAD: 4,
    MPC: 4,
};

function sourceQualityLabel(source: string): string {
    const score = sourceQualityScore[source] ?? 2;
    if (score >= 5) {
        return "Agency catalog / jurnal terkurasi";
    }
    if (score === 4) {
        return "Basis data astronomi terverifikasi";
    }
    if (score === 3) {
        return "Katalog sekunder";
    }
    if (score === 2) {
        return "Model ilmiah terarah";
    }
    return "Model simulasi";
}

function bodyReferenceQuality(name: string): string {
    const sources = Array.from(bodySourcesByName.get(name) ?? []);
    if (sources.length === 0) {
        return "Model simulasi";
    }

    const top = sources
        .map((source) => ({ source, score: sourceQualityScore[source] ?? 2 }))
        .sort((a, b) => b.score - a.score)[0];
    return `${sourceQualityLabel(top.source)} (${top.source})`;
}

function bodySourceText(name: string): string {
    const set = bodySourcesByName.get(name);
    if (!set || set.size === 0) {
        return "Orbinex Engine";
    }
    return Array.from(set).join(" | ");
}

function updateHierarchyFilterUi(): void {
    hierarchyMinInput.value = `${viewState.hierarchyMin}`;
    hierarchyMaxInput.value = `${viewState.hierarchyMax}`;
    hierarchyMinValue.textContent = `${viewState.hierarchyMin}`;
    hierarchyMaxValue.textContent = `${viewState.hierarchyMax}`;
    hierarchyNote.textContent = `Menampilkan level ${viewState.hierarchyMin} sampai ${viewState.hierarchyMax}.`;
}

function ensureFocusWithinVisibleBodies(): void {
    const focusedBody = bodyByNameAny(uiState.focusName);
    if (focusedBody && shouldRenderBody(focusedBody)) {
        return;
    }

    const fallback = focusCandidates()[0] ?? bodyByNameAny("Bumi");
    if (!fallback) {
        return;
    }

    if (fallback.name === "Bumi") {
        resetCameraToEarthView();
        return;
    }

    const preferredDistance = preferredFocusDistance(fallback);
    setFocusBody(fallback, { pinInfo: true, preferredDistance, durationMs: 560 });
}

function applyScientificDataOnly(enabled: boolean): void {
    viewState.scientificDataOnly = enabled;
    if (enabled) {
        clearSyntheticGalaxyBodies();
        addLocalEvent("Mode Scientific Data Only aktif: objek sintetis disembunyikan.");
    } else {
        addSyntheticGalaxySystems();
        addLocalEvent(`Mode Scientific Data Only nonaktif: model sintetis aktif (${syntheticGalaxyBodyNames.size} objek).`);
    }

    if (uiState.selectedKey) {
        const selectedBody = bodyNodes.get(uiState.selectedKey)?.body;
        if (selectedBody && !shouldRenderBody(selectedBody)) {
            uiState.selectedKey = null;
            uiState.infoPinned = false;
        }
    }
    if (uiState.hoverKey) {
        const hoveredBody = bodyNodes.get(uiState.hoverKey)?.body;
        if (hoveredBody && !shouldRenderBody(hoveredBody)) {
            uiState.hoverKey = null;
        }
    }

    ensureFocusWithinVisibleBodies();
    updateActionButtons();
    updateHierarchyFilterUi();

    rebuildOrbitGuides(true);
    updateSearchResults();
    updateHudPanel();
    updateInfoPanel();
    updateEventsPanel();
}

function applyHierarchyWindow(nextMin: number, nextMax: number): void {
    const min = clamp(Math.round(nextMin), 1, 13);
    const max = clamp(Math.round(nextMax), 1, 13);
    viewState.hierarchyMin = Math.min(min, max);
    viewState.hierarchyMax = Math.max(min, max);

    if (uiState.selectedKey) {
        const selectedBody = bodyNodes.get(uiState.selectedKey)?.body;
        if (selectedBody && !shouldRenderBody(selectedBody)) {
            uiState.selectedKey = null;
            uiState.infoPinned = false;
        }
    }
    if (uiState.hoverKey) {
        const hoveredBody = bodyNodes.get(uiState.hoverKey)?.body;
        if (hoveredBody && !shouldRenderBody(hoveredBody)) {
            uiState.hoverKey = null;
        }
    }

    ensureFocusWithinVisibleBodies();
    updateHierarchyFilterUi();
    rebuildOrbitGuides(true);
    updateSearchResults();
    updateHudPanel();
    updateInfoPanel();
}

function setIngestStatus(source: string, mode: IngestStatus["mode"], count: number, note: string): void {
    ingestStatuses.set(source, { source, mode, count, note });
    const compact = Array.from(ingestStatuses.values())
        .map((entry) => {
            const modeText = entry.mode === "online" ? "on" : entry.mode === "fallback" ? "fb" : "off";
            return `${entry.source}:${modeText}`;
        })
        .join(" ");
    nasaCatalogStatus = compact || "loading";
}

function fallbackImageForBody(body: UniverseBody): string {
    const tint = /^#[0-9a-f]{6}$/i.test(body.colorHex) ? body.colorHex : "#6fa8ff";
    const safeLabel = body.name.slice(0, 20).replace(/&/g, "and").replace(/</g, "(").replace(/>/g, ")");
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='480' height='300' viewBox='0 0 480 300'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='${tint}' stop-opacity='0.92'/><stop offset='100%' stop-color='#0a142b'/></linearGradient></defs><rect width='480' height='300' fill='url(#g)'/><circle cx='360' cy='85' r='58' fill='${tint}' fill-opacity='0.56'/><text x='26' y='250' fill='#eef5ff' font-size='28' font-family='Arial, sans-serif'>${safeLabel}</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function imageForBody(body: UniverseBody): string {
    return bodyImagesDynamic.get(body.name)
        ?? bodyImagesByName[body.name]
        ?? bodyImagesByKind[body.kind]
        ?? fallbackImageForBody(body);
}

const fallbackNasaRows: NasaExoplanetRow[] = [
    {
        pl_name: "Kepler-452b",
        hostname: "Kepler-452",
        ra: 283.17,
        dec: 44.3,
        sy_dist: 560,
        pl_orbsmax: 1.05,
        pl_orbper: 384,
        pl_bmasse: 5,
        pl_rade: 1.6,
        st_mass: 1.04,
        st_rad: 1.11,
    },
    {
        pl_name: "TRAPPIST-1e",
        hostname: "TRAPPIST-1",
        ra: 346.62,
        dec: -5.04,
        sy_dist: 12.43,
        pl_orbsmax: 0.028,
        pl_orbper: 6.1,
        pl_bmasse: 0.69,
        pl_rade: 0.91,
        st_mass: 0.089,
        st_rad: 0.12,
    },
    {
        pl_name: "Proxima Cen b",
        hostname: "Proxima Centauri",
        ra: 217.43,
        dec: -62.68,
        sy_dist: 1.3,
        pl_orbsmax: 0.048,
        pl_orbper: 11.2,
        pl_bmasse: 1.27,
        pl_rade: 1.1,
        st_mass: 0.122,
        st_rad: 0.154,
    },
    {
        pl_name: "LHS 1140 b",
        hostname: "LHS 1140",
        ra: 0.0,
        dec: -15.27,
        sy_dist: 14.99,
        pl_orbsmax: 0.093,
        pl_orbper: 24.7,
        pl_bmasse: 6.98,
        pl_rade: 1.73,
        st_mass: 0.18,
        st_rad: 0.21,
    },
    {
        pl_name: "WASP-12 b",
        hostname: "WASP-12",
        ra: 96.36,
        dec: 29.67,
        sy_dist: 432,
        pl_orbsmax: 0.023,
        pl_orbper: 1.1,
        pl_bmasse: 450,
        pl_rade: 18,
        st_mass: 1.35,
        st_rad: 1.63,
    },
];

const esaFallbackEntries: ExternalCatalogEntry[] = [
    {
        name: "Gaia BH1",
        kind: "black-hole",
        raDeg: 262.47,
        decDeg: -5.34,
        distancePc: 480,
        colorHex: "#8ba0ff",
        description: "Objek kandidat black hole dari observasi Gaia (referensi sains ESA).",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/Black_hole_-_Messier_87_crop_max_res.jpg/640px-Black_hole_-_Messier_87_crop_max_res.jpg",
    },
    {
        name: "K2-18 b",
        kind: "planet",
        raDeg: 172.11,
        decDeg: 7.59,
        distancePc: 38.7,
        colorHex: "#9ec7ff",
        description: "Eksoplanet kandidat layak huni yang sering dirujuk pada materi eksoplanet ESA.",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8e/Exoplanet_Comparison_K2-18b.png/640px-Exoplanet_Comparison_K2-18b.png",
    },
    {
        name: "Gaia DR3 Anchor",
        kind: "cluster",
        raDeg: 56.75,
        decDeg: 24.12,
        distancePc: 120,
        colorHex: "#9fd6ff",
        description: "Anchor cluster sintetis untuk menampilkan ingest ESA/Gaia pada simulasi web.",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Pleiades_large.jpg/640px-Pleiades_large.jpg",
    },
];

const jaxaFallbackEntries: ExternalCatalogEntry[] = [
    {
        name: "MAXI J1820+070",
        kind: "black-hole",
        raDeg: 275.09,
        decDeg: 7.18,
        distancePc: 960,
        colorHex: "#7e8bff",
        description: "Sumber sinar-X biner yang aktif pada observasi misi MAXI/JAXA.",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Artist%E2%80%99s_impression_of_Cygnus_X-1.jpg/640px-Artist%E2%80%99s_impression_of_Cygnus_X-1.jpg",
    },
    {
        name: "Hitomi Legacy Field",
        kind: "nebula",
        raDeg: 83.63,
        decDeg: 22.01,
        distancePc: 2000,
        colorHex: "#8fc8d8",
        description: "Area referensi observasi spektrum energi tinggi yang dikurasi dari publikasi JAXA.",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/Orion_Nebula_-_Hubble_2006_mosaic_18000.jpg/640px-Orion_Nebula_-_Hubble_2006_mosaic_18000.jpg",
    },
    {
        name: "Hayabusa Corridor",
        kind: "other",
        raDeg: 187.4,
        decDeg: -5.1,
        distancePc: 4,
        colorHex: "#b9c8e8",
        description: "Koridor lintasan sintetis misi Hayabusa/Hayabusa2 untuk meniru ingest JAXA pada HUD.",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Hayabusa2_at_Ryugu_%28artist%27s_impression%29.jpg/640px-Hayabusa2_at_Ryugu_%28artist%27s_impression%29.jpg",
    },
];

const nedFallbackEntries: ExternalCatalogEntry[] = [
    {
        name: "NGC 1300",
        kind: "galaxy",
        raDeg: 49.92,
        decDeg: -19.41,
        distancePc: 19000000,
        colorHex: "#9cb8e2",
        description: "Galaksi spiral berbatang dari katalog NED/IPAC (fallback kurasi).",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c4/NGC_1300_HST.jpg/640px-NGC_1300_HST.jpg",
    },
    {
        name: "NGC 4993",
        kind: "galaxy",
        raDeg: 197.45,
        decDeg: -23.38,
        distancePc: 40000000,
        colorHex: "#93afd4",
        description: "Galaksi host dari event gelombang gravitasi GW170817 yang tercantum pada NED.",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/07/NGC_4993_Hubble_WFC3.jpg/640px-NGC_4993_Hubble_WFC3.jpg",
    },
    {
        name: "Centaurus A",
        kind: "galaxy",
        raDeg: 201.37,
        decDeg: -43.02,
        distancePc: 3800000,
        colorHex: "#9db7cf",
        description: "Galaksi radio aktif populer di basis data ekstragalaksi NED.",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Centaurus_A.jpg/640px-Centaurus_A.jpg",
    },
];

const simbadFallbackEntries: ExternalCatalogEntry[] = [
    {
        name: "Sirius B",
        kind: "star",
        raDeg: 101.287,
        decDeg: -16.716,
        distancePc: 2.64,
        colorHex: "#cddfff",
        parentName: "Sirius A",
        description: "Katalog bintang SIMBAD untuk sistem Sirius.",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/Sirius_A_and_B_Hubble_photo.jpg/640px-Sirius_A_and_B_Hubble_photo.jpg",
    },
    {
        name: "Barnard's Star",
        kind: "star",
        raDeg: 269.452,
        decDeg: 4.693,
        distancePc: 1.83,
        colorHex: "#ffb98d",
        parentName: "Bima Sakti",
        description: "Bintang katai merah dengan proper motion besar dari katalog SIMBAD.",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a8/RedDwarfNASA.jpg/640px-RedDwarfNASA.jpg",
    },
    {
        name: "VY Canis Majoris",
        kind: "star",
        raDeg: 110.743,
        decDeg: -25.767,
        distancePc: 1170,
        colorHex: "#ff9f8a",
        parentName: "Bima Sakti",
        description: "Supergiant merah dari SIMBAD, sering dipakai sebagai referensi ukuran bintang.",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/VY_Canis_Majoris.jpg/640px-VY_Canis_Majoris.jpg",
    },
];

const mpcFallbackEntries: ExternalCatalogEntry[] = [
    {
        name: "(99942) Apophis",
        kind: "meteor",
        raDeg: 250.1,
        decDeg: -8.2,
        distancePc: 0.000006,
        colorHex: "#d3c1a6",
        parentName: "Matahari",
        description: "Near-Earth asteroid dari arsip Minor Planet Center (MPC).",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/84/99942_Apophis_asteroid.jpg/640px-99942_Apophis_asteroid.jpg",
    },
    {
        name: "(101955) Bennu",
        kind: "meteor",
        raDeg: 85.3,
        decDeg: 8.1,
        distancePc: 0.000004,
        colorHex: "#bcae95",
        parentName: "Matahari",
        description: "Asteroid target misi OSIRIS-REx dari katalog MPC.",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cf/Bennu_in_natural_color.jpg/640px-Bennu_in_natural_color.jpg",
    },
    {
        name: "(1) Ceres",
        kind: "dwarf",
        raDeg: 291.4,
        decDeg: -23.5,
        distancePc: 0.000014,
        colorHex: "#b9c7d8",
        parentName: "Matahari",
        description: "Planet kerdil sabuk asteroid utama dari data MPC/IAU.",
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/76/Ceres_-_RC3_-_Haulani_Crater_%2822381131691%29.jpg/640px-Ceres_-_RC3_-_Haulani_Crater_%2822381131691%29.jpg",
    },
];

function raDecDistanceToVector(raDeg: number, decDeg: number, distancePc: number): THREE.Vector3 {
    const ra = degToRad(raDeg);
    const dec = degToRad(decDeg);
    const distance = Math.max(distancePc, 0.05) * constants.parsecMeters;
    const cosDec = Math.cos(dec);
    return new THREE.Vector3(
        distance * cosDec * Math.cos(ra),
        distance * Math.sin(dec),
        distance * cosDec * Math.sin(ra),
    );
}

function findExistingBodyByName(name: string): UniverseBody | null {
    const major = engine.getMajorBodies().find((body) => body.name === name);
    if (major) {
        return major;
    }
    const context = engine.getContextBodies().find((body) => body.name === name);
    if (context) {
        return context;
    }
    const catalog = nasaCatalogBodies.find((body) => body.name === name);
    return catalog ?? null;
}

function normalizeCatalogMass(kind: UniverseBody["kind"], customMass?: number): number {
    if (Number.isFinite(customMass) && (customMass as number) > 0) {
        return customMass as number;
    }

    if (kind === "star") {
        return constants.solarMassKg;
    }
    if (kind === "black-hole") {
        return 8 * constants.solarMassKg;
    }
    if (kind === "planet") {
        return EARTH_MASS;
    }
    if (kind === "galaxy") {
        return 1e11 * constants.solarMassKg;
    }
    if (kind === "cluster") {
        return 5e12 * constants.solarMassKg;
    }
    return 0.2 * EARTH_MASS;
}

function normalizeCatalogRadius(kind: UniverseBody["kind"], customRadius?: number): number {
    if (Number.isFinite(customRadius) && (customRadius as number) > 0) {
        return customRadius as number;
    }

    if (kind === "star") {
        return SOLAR_RADIUS;
    }
    if (kind === "black-hole") {
        return 8.2e9;
    }
    if (kind === "planet") {
        return EARTH_RADIUS;
    }
    if (kind === "galaxy") {
        return 6e20;
    }
    if (kind === "cluster") {
        return 9e22;
    }
    if (kind === "nebula") {
        return 1.1e18;
    }
    return 4.1e7;
}

function morphologyForGalaxy(body: UniverseBody): GalaxyMorphology {
    const sourceText = `${body.name} ${bodyDescriptionsDynamic.get(body.name) ?? ""}`.toLowerCase();
    if (sourceText.includes("magellan") || sourceText.includes("irregular") || sourceText.includes("tak beraturan")) {
        return "irregular";
    }
    if (sourceText.includes("ngc 1300") || sourceText.includes("berpalang") || sourceText.includes("barred") || sourceText.includes("bar ")) {
        return "barred-spiral";
    }
    if (sourceText.includes("m87") || sourceText.includes("ellipt") || sourceText.includes("elips")) {
        return "elliptical";
    }
    return "spiral";
}

function normalizeCatalogKind(
    name: string,
    kind: UniverseBody["kind"],
    description?: string,
): UniverseBody["kind"] {
    const text = `${name} ${description ?? ""}`.toLowerCase();

    if (text.includes("matahari") || text.includes("sun")) {
        return "star";
    }
    if (text.includes("black hole") || text.includes("black-hole") || text.includes("bh") || text.includes("sagittarius a*") || text.includes("m87*")) {
        return "black-hole";
    }
    if (text.includes("galaxy") || text.includes("m31") || text.includes("m33") || text.includes("ngc") || text.includes("andromeda") || text.includes("bima sakti") || text.includes("milky way")) {
        return "galaxy";
    }
    if (text.includes("cluster") || text.includes("grup lokal") || text.includes("laniakea")) {
        return "cluster";
    }
    if (text.includes("nebula") || text.includes("snr")) {
        return "nebula";
    }
    if (text.includes("comet") || text.includes("komet")) {
        return "comet";
    }
    if (text.includes("meteor") || text.includes("asteroid") || text.includes("meteoroid")) {
        return "meteor";
    }
    if (text.includes("planet") || text.includes("exoplanet") || /\bp-\d+\b/.test(text)) {
        return "planet";
    }
    if (text.includes("moon") || text.includes("bulan") || text.includes("satellite")) {
        return "moon";
    }

    return kind;
}

function preferredFocusDistance(body: UniverseBody): number {
    const rank = hierarchyRankForBody(body);
    if (rank >= 13) {
        return 5400;
    }
    if (rank === 12) {
        return 3600;
    }
    if (rank === 11) {
        return 2400;
    }
    if (rank === 10) {
        return 1500;
    }
    if (rank === 9) {
        return 980;
    }
    if (rank === 8) {
        return 760;
    }
    if (body.kind === "cluster") {
        return 760;
    }
    if (body.kind === "galaxy") {
        return 620;
    }
    if (body.kind === "nebula") {
        return 420;
    }
    if (body.kind === "black-hole") {
        return 140;
    }
    if (body.kind === "star") {
        return body.name === "Matahari" ? 72 : 96;
    }
    if (isSolarSystemBody(body)) {
        return 34;
    }
    return 180;
}

function hierarchyRankForBody(body: UniverseBody): number {
    const name = body.name.toLowerCase();

    if (name.includes("observable universe") || name.includes("alam semesta teramati")) {
        return 13;
    }
    if (name.includes("void")) {
        return 12;
    }
    if (name.includes("filamen") || name.includes("filament") || name.includes("cosmic web")) {
        return 11;
    }
    if (name.includes("supercluster") || name.includes("superklaster") || name.includes("laniakea")) {
        return 10;
    }
    if (name.includes("local group") || name.includes("grup lokal") || name.includes("group")) {
        return 8;
    }
    if (body.kind === "cluster") {
        return 9;
    }
    if (body.kind === "galaxy") {
        return 7;
    }
    if (name.includes("lengan") || name.includes("arm")) {
        return 6;
    }
    if (name.includes("sistem") || name.includes("system")) {
        return 5;
    }
    if (body.kind === "star" || body.kind === "black-hole") {
        return 4;
    }
    if (body.kind === "planet" || body.kind === "dwarf") {
        return 3;
    }
    if (body.kind === "moon") {
        return 1;
    }
    if (body.kind === "comet" || body.kind === "meteor" || body.kind === "asteroid" || body.kind === "kuiper") {
        return 2;
    }

    return 5;
}

function hierarchyLabelForBody(body: UniverseBody): string {
    const rank = hierarchyRankForBody(body);
    const labels: Record<number, string> = {
        1: "1. Satelit alami",
        2: "2. Asteroid/Komet/Meteoroid",
        3: "3. Planet",
        4: "4. Bintang / Remnan kompak",
        5: "5. Sistem gravitasi lokal",
        6: "6. Lengan spiral galaksi",
        7: "7. Galaksi",
        8: "8. Galaxy Group",
        9: "9. Galaxy Cluster",
        10: "10. Supercluster",
        11: "11. Filamen kosmik",
        12: "12. Void kosmik",
        13: "13. Observable Universe",
    };
    return labels[rank] ?? "5. Sistem gravitasi lokal";
}

function bodyWithinHierarchyWindow(body: UniverseBody): boolean {
    const rank = hierarchyRankForBody(body);
    return rank >= viewState.hierarchyMin && rank <= viewState.hierarchyMax;
}

function orbitGuideForBody(bodyName: string): UniverseOrbitGuide | undefined {
    const guide = engine.getOrbitGuides(true).find((entry) => entry.bodyName === bodyName);
    if (guide) {
        return guide;
    }

    const dynamic = dynamicCatalogOrbits.get(bodyName);
    if (!dynamic) {
        return undefined;
    }

    const body = bodyByNameAny(bodyName);
    return {
        bodyName: dynamic.bodyName,
        parentName: dynamic.parentName,
        kind: body?.kind ?? "other",
        isHypothesis: body?.isHypothesis ?? false,
        semiMajorMeters: dynamic.semiMajorMeters,
        orbitalPeriodSeconds: (2 * Math.PI) / Math.max(Math.abs(dynamic.omegaRadPerSec), 1e-15),
        eccentricity: dynamic.eccentricity,
        inclinationRad: dynamic.inclinationRad,
        ascendingNodeRad: dynamic.ascendingNodeRad,
        argumentPeriapsisRad: dynamic.argumentPeriapsisRad,
    };
}

function catalogEntryToBody(entry: ExternalCatalogEntry): UniverseBody {
    const normalizedKind = normalizeCatalogKind(entry.name, entry.kind, entry.description);
    const vector = raDecDistanceToVector(entry.raDeg, entry.decDeg, entry.distancePc);
    const inferredParent = entry.parentName
        ?? (normalizedKind === "galaxy" || normalizedKind === "cluster"
            ? "Laniakea"
            : normalizedKind === "star" || normalizedKind === "planet" || normalizedKind === "moon" || normalizedKind === "comet" || normalizedKind === "meteor" || normalizedKind === "black-hole" || normalizedKind === "nebula"
                ? "Bima Sakti"
                : "Grup Lokal");
    return {
        name: entry.name,
        kind: normalizedKind,
        massKg: normalizeCatalogMass(normalizedKind, entry.massKg),
        radiusMeters: normalizeCatalogRadius(normalizedKind, entry.radiusMeters),
        colorHex: entry.colorHex ?? "#98b8ef",
        position: { x: vector.x, y: vector.y, z: vector.z },
        velocity: { x: 0, y: 0, z: 0 },
        alive: true,
        parentName: inferredParent,
        isHypothesis: false,
    };
}

function pushCatalogBody(
    body: UniverseBody,
    options?: {
        sources?: string[];
        description?: string;
        imageUrl?: string;
    },
): void {
    if (options?.description) {
        bodyDescriptionsDynamic.set(body.name, options.description);
    }
    if (options?.imageUrl) {
        bodyImagesDynamic.set(body.name, options.imageUrl);
    }
    mergeBodySources(body.name, options?.sources ?? ["NASA"]);

    const key = bodyKey(body);
    if (nasaCatalogIndex.has(key)) {
        return;
    }
    nasaCatalogIndex.add(key);
    nasaCatalogBodies.push(body);
}

function seededUnit(label: string, salt: number): number {
    const hash = hashString(`${label}:${salt}`);
    return (hash % 1_000_003) / 1_000_003;
}

function seededRange(label: string, salt: number, min: number, max: number): number {
    return min + (max - min) * seededUnit(label, salt);
}

function dynamicOrbitPoint(state: DynamicCatalogOrbitState, phaseRad = state.phaseRad): { x: number; y: number; z: number } {
    const e = clamp(state.eccentricity, 0, 0.86);
    const a = Math.max(state.semiMajorMeters, 1);
    const p = a * (1 - e * e);
    const r = p / Math.max(1e-9, 1 + e * Math.cos(phaseRad));

    const argument = phaseRad + state.argumentPeriapsisRad;
    const cosArg = Math.cos(argument);
    const sinArg = Math.sin(argument);
    const cosNode = Math.cos(state.ascendingNodeRad);
    const sinNode = Math.sin(state.ascendingNodeRad);
    const cosI = Math.cos(state.inclinationRad);
    const sinI = Math.sin(state.inclinationRad);

    return {
        x: r * (cosNode * cosArg - sinNode * sinArg * cosI),
        y: r * (sinArg * sinI),
        z: r * (sinNode * cosArg + cosNode * sinArg * cosI),
    };
}

function clearSyntheticGalaxyBodies(): void {
    if (syntheticGalaxyBodyNames.size === 0) {
        return;
    }

    for (const name of syntheticGalaxyBodyNames) {
        dynamicCatalogOrbits.delete(name);
        bodyDescriptionsDynamic.delete(name);
        bodyImagesDynamic.delete(name);
        bodySourcesByName.delete(name);
    }

    for (let i = nasaCatalogBodies.length - 1; i >= 0; i -= 1) {
        const body = nasaCatalogBodies[i];
        if (!syntheticGalaxyBodyNames.has(body.name)) {
            continue;
        }
        nasaCatalogIndex.delete(bodyKey(body));
        nasaCatalogBodies.splice(i, 1);
    }

    syntheticGalaxyBodyNames.clear();
    nasaCatalogEntries = nasaCatalogBodies.length;
}

function registerDynamicOrbit(
    bodyName: string,
    parentName: string,
    semiMajorMeters: number,
    periodDays: number,
    inclinationDeg: number,
    eccentricity: number,
    seedLabel: string,
): void {
    const omegaRadPerSec = (2 * Math.PI) / Math.max(periodDays * 86400, 3600);
    dynamicCatalogOrbits.set(bodyName, {
        bodyName,
        parentName,
        semiMajorMeters: Math.max(semiMajorMeters, 1),
        omegaRadPerSec,
        inclinationRad: degToRad(inclinationDeg),
        phaseRad: seededRange(seedLabel, 11, 0, Math.PI * 2),
        eccentricity: clamp(eccentricity, 0, 0.82),
        ascendingNodeRad: degToRad(seededRange(seedLabel, 12, 0, 360)),
        argumentPeriapsisRad: degToRad(seededRange(seedLabel, 13, 0, 360)),
    });
}

function estimateOrbitalPeriodDays(semiMajorMeters: number, parentMassKg: number): number {
    const a = Math.max(semiMajorMeters, 1);
    const mu = constants.gravitationalConstant * Math.max(parentMassKg, constants.solarMassKg * 0.1);
    const periodSec = 2 * Math.PI * Math.sqrt((a * a * a) / Math.max(mu, 1));
    return clamp(periodSec / 86400, 8, 2.0e12);
}

function upsertSyntheticBody(
    body: UniverseBody,
    description: string,
    sources: string[] = ["Scientific Hierarchy Model"],
): UniverseBody {
    const existing = findExistingBodyByName(body.name);
    if (existing) {
        mergeBodySources(existing.name, sources);
        bodyDescriptionsDynamic.set(existing.name, description);
        if (existing.kind !== body.kind) {
            existing.kind = body.kind;
        }
        if (!existing.parentName && body.parentName) {
            existing.parentName = body.parentName;
        }
        return existing;
    }

    pushCatalogBody(body, {
        sources,
        description,
    });
    syntheticGalaxyBodyNames.add(body.name);
    return body;
}

function ensureCosmicHierarchyBodies(): void {
    const milkyWay = findExistingBodyByName("Bima Sakti");
    const localGroup = findExistingBodyByName("Grup Lokal");
    const laniakea = findExistingBodyByName("Laniakea");
    const filament = findExistingBodyByName("Filamen Kosmik");
    const sun = findExistingBodyByName("Matahari");

    const solarSystemNode = upsertSyntheticBody({
        name: "Sistem Surya Lokal",
        kind: "other",
        massKg: Math.max((sun?.massKg ?? constants.solarMassKg) * 1.002, constants.solarMassKg),
        radiusMeters: 1.3e13,
        colorHex: "#7fb0ff",
        position: sun ? { ...sun.position } : { x: 0, y: 0, z: 0 },
        velocity: sun ? { ...sun.velocity } : { x: 0, y: 0, z: 0 },
        alive: true,
        parentName: "Bima Sakti",
        isHypothesis: false,
    }, "Representasi sistem bintang lokal (bintang+planet+satelit+small bodies).");

    if (milkyWay) {
        registerDynamicOrbit(
            solarSystemNode.name,
            milkyWay.name,
            Math.max(milkyWay.radiusMeters * 0.42, 2.3e20),
            226_000_000 * 365.25,
            6.2,
            0.08,
            `${solarSystemNode.name}:hierarchy`,
        );
    }

    const orionArmNode = upsertSyntheticBody({
        name: "Lengan Orion",
        kind: "other",
        massKg: Math.max((milkyWay?.massKg ?? 1e12 * constants.solarMassKg) * 0.03, 1e10 * constants.solarMassKg),
        radiusMeters: 2.8e20,
        colorHex: "#8ac4ff",
        position: milkyWay ? { ...milkyWay.position } : { x: 0, y: 0, z: 0 },
        velocity: milkyWay ? { ...milkyWay.velocity } : { x: 0, y: 0, z: 0 },
        alive: true,
        parentName: "Bima Sakti",
        isHypothesis: false,
    }, "Lengan spiral tempat Matahari berada di Bima Sakti.");

    if (milkyWay) {
        registerDynamicOrbit(
            orionArmNode.name,
            milkyWay.name,
            Math.max(milkyWay.radiusMeters * 0.58, 3.4e20),
            260_000_000 * 365.25,
            4.4,
            0.12,
            `${orionArmNode.name}:hierarchy`,
        );
    }

    const virgoClusterNode = upsertSyntheticBody({
        name: "Virgo Cluster",
        kind: "cluster",
        massKg: 1.2e15 * constants.solarMassKg,
        radiusMeters: 7.8e22,
        colorHex: "#9ec0de",
        position: laniakea ? { ...laniakea.position } : { x: 0, y: 0, z: 0 },
        velocity: laniakea ? { ...laniakea.velocity } : { x: 0, y: 0, z: 0 },
        alive: true,
        parentName: "Laniakea",
        isHypothesis: false,
    }, "Klaster galaksi padat (skala ratusan-ribuan galaksi).", ["Scientific Hierarchy Model", "NASA", "ESA"]);

    if (laniakea) {
        registerDynamicOrbit(
            virgoClusterNode.name,
            laniakea.name,
            Math.max(laniakea.radiusMeters * 0.24, 6.6e23),
            980_000_000 * 365.25,
            3.8,
            0.13,
            `${virgoClusterNode.name}:hierarchy`,
        );
    }

    const superclusterNode = upsertSyntheticBody({
        name: "Superklaster Laniakea",
        kind: "cluster",
        massKg: 3.0e13 * constants.solarMassKg,
        radiusMeters: 1.8e24,
        colorHex: "#a7d9d2",
        position: laniakea ? { ...laniakea.position } : { x: 0, y: 0, z: 0 },
        velocity: laniakea ? { ...laniakea.velocity } : { x: 0, y: 0, z: 0 },
        alive: true,
        parentName: "Filamen Kosmik",
        isHypothesis: false,
    }, "Representasi supercluster pada jaringan kosmik skala sangat besar.");

    if (filament) {
        registerDynamicOrbit(
            superclusterNode.name,
            filament.name,
            Math.max(filament.radiusMeters * 0.12, 2.6e24),
            1_900_000_000 * 365.25,
            2.5,
            0.06,
            `${superclusterNode.name}:hierarchy`,
        );
    }

    upsertSyntheticBody({
        name: "Void Lokal",
        kind: "other",
        massKg: 1e10,
        radiusMeters: 3.2e24,
        colorHex: "#4d5f87",
        position: filament
            ? {
                x: filament.position.x + 2.2e24,
                y: filament.position.y + 0.2e24,
                z: filament.position.z - 1.5e24,
            }
            : { x: 2.2e24, y: 0.2e24, z: -1.5e24 },
        velocity: { x: 0, y: 0, z: 0 },
        alive: true,
        parentName: "Filamen Kosmik",
        isHypothesis: false,
    }, "Wilayah kosmik sangat jarang galaksi (void), bukan benda pejal.");

    upsertSyntheticBody({
        name: "Observable Universe",
        kind: "other",
        massKg: 1e53,
        radiusMeters: 4.4e26,
        colorHex: "#9fb6e6",
        position: localGroup ? { ...localGroup.position } : { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        alive: true,
        parentName: null,
        isHypothesis: false,
    }, "Batas alam semesta teramati (~93 miliar tahun cahaya diameter).", ["Scientific Hierarchy Model", "NASA"]);
}

function addSyntheticGalaxySystems(): void {
    clearSyntheticGalaxyBodies();

    const parentMap = new Map<string, UniverseBody>();
    engine.getContextBodies()
        .filter((body) => body.kind === "galaxy" || body.kind === "cluster")
        .forEach((body) => parentMap.set(body.name, body));
    nasaCatalogBodies
        .filter((body) => body.kind === "galaxy" || body.kind === "cluster")
        .forEach((body) => parentMap.set(body.name, body));

    for (const parent of parentMap.values()) {
        const parentSeed = parent.name;
        const isGalaxy = parent.kind === "galaxy";
        const starCount = isGalaxy ? 24 : 12;
        const planetPerStar = isGalaxy ? 4 : 3;
        const cometCount = isGalaxy ? 10 : 6;
        const meteorCount = isGalaxy ? 14 : 8;

        const existingCore = findExistingBodyByName(`${parent.name} Core BH`);
        if (!existingCore) {
            const coreName = `${parent.name} Core BH`;
            const coreBody: UniverseBody = {
                name: coreName,
                kind: "black-hole",
                massKg: Math.max(parent.massKg * 0.0000022, 2 * constants.solarMassKg),
                radiusMeters: Math.max(parent.radiusMeters * 0.0000007, 1.8e9),
                colorHex: "#8097ff",
                position: { ...parent.position },
                velocity: { ...parent.velocity },
                alive: true,
                parentName: parent.name,
                isHypothesis: false,
            };
            pushCatalogBody(coreBody, {
                sources: ["Synthetic Galaxy Model"],
                description: `Objek inti gravitasional sintetis untuk ${parent.name}.`,
            });
            syntheticGalaxyBodyNames.add(coreName);
        }

        for (let i = 0; i < starCount; i += 1) {
            const starName = `${parent.name} Star-${i + 1}`;
            const starBody: UniverseBody = {
                name: starName,
                kind: "star",
                massKg: seededRange(parentSeed, 100 + i, 0.35, 2.8) * constants.solarMassKg,
                radiusMeters: seededRange(parentSeed, 200 + i, 0.45, 1.95) * SOLAR_RADIUS,
                colorHex: seededUnit(parentSeed, 300 + i) > 0.5 ? "#cfe6ff" : "#ffdca7",
                position: { ...parent.position },
                velocity: { ...parent.velocity },
                alive: true,
                parentName: parent.name,
                isHypothesis: false,
            };
            pushCatalogBody(starBody, {
                sources: ["Synthetic Galaxy Model"],
                description: `Bintang sintetis pada cabang ${parent.name}.`,
            });
            syntheticGalaxyBodyNames.add(starName);

            registerDynamicOrbit(
                starName,
                parent.name,
                parent.radiusMeters * seededRange(parentSeed, 400 + i, 0.03, 0.24),
                seededRange(parentSeed, 500 + i, isGalaxy ? 180_000 : 260_000, isGalaxy ? 460_000 : 760_000) * 365.25,
                seededRange(parentSeed, 600 + i, 0.4, 14.0),
                seededRange(parentSeed, 700 + i, 0.01, 0.35),
                `${starName}:orbit`,
            );

            for (let p = 0; p < planetPerStar; p += 1) {
                const planetName = `${starName} p-${p + 1}`;
                const planetBody: UniverseBody = {
                    name: planetName,
                    kind: "planet",
                    massKg: seededRange(parentSeed, 800 + i * 7 + p, 0.2, 9.0) * EARTH_MASS,
                    radiusMeters: seededRange(parentSeed, 900 + i * 7 + p, 0.4, 2.2) * EARTH_RADIUS,
                    colorHex: seededUnit(parentSeed, 1000 + i * 7 + p) > 0.5 ? "#8db9ff" : "#d8c3a1",
                    position: { ...starBody.position },
                    velocity: { ...starBody.velocity },
                    alive: true,
                    parentName: starName,
                    isHypothesis: false,
                };
                pushCatalogBody(planetBody, {
                    sources: ["Synthetic Galaxy Model"],
                    description: `Planet sintetis sistem ${starName}.`,
                });
                syntheticGalaxyBodyNames.add(planetName);

                registerDynamicOrbit(
                    planetName,
                    starName,
                    seededRange(parentSeed, 1100 + i * 11 + p, 0.24, 7.6) * constants.auMeters,
                    seededRange(parentSeed, 1200 + i * 11 + p, 48, 920),
                    seededRange(parentSeed, 1300 + i * 11 + p, 0, 9.5),
                    seededRange(parentSeed, 1400 + i * 11 + p, 0.001, 0.2),
                    `${planetName}:orbit`,
                );
            }
        }

        for (let c = 0; c < cometCount; c += 1) {
            const cometName = `${parent.name} Comet-${c + 1}`;
            const cometBody: UniverseBody = {
                name: cometName,
                kind: "comet",
                massKg: seededRange(parentSeed, 2000 + c, 9e12, 8e14),
                radiusMeters: seededRange(parentSeed, 2100 + c, 1100, 18000),
                colorHex: "#9fd1ff",
                position: { ...parent.position },
                velocity: { ...parent.velocity },
                alive: true,
                parentName: parent.name,
                isHypothesis: false,
            };
            pushCatalogBody(cometBody, {
                sources: ["Synthetic Galaxy Model"],
                description: `Komet sintetis pada halo ${parent.name}.`,
            });
            syntheticGalaxyBodyNames.add(cometName);
            registerDynamicOrbit(
                cometName,
                parent.name,
                parent.radiusMeters * seededRange(parentSeed, 2200 + c, 0.16, 0.42),
                seededRange(parentSeed, 2300 + c, isGalaxy ? 120_000 : 220_000, isGalaxy ? 280_000 : 420_000) * 365.25,
                seededRange(parentSeed, 2400 + c, 6, 46),
                seededRange(parentSeed, 2500 + c, 0.2, 0.72),
                `${cometName}:orbit`,
            );
        }

        for (let m = 0; m < meteorCount; m += 1) {
            const meteorName = `${parent.name} Meteor-${m + 1}`;
            const meteorBody: UniverseBody = {
                name: meteorName,
                kind: "meteor",
                massKg: seededRange(parentSeed, 2600 + m, 5e9, 6e11),
                radiusMeters: seededRange(parentSeed, 2700 + m, 80, 1800),
                colorHex: "#d4c4a2",
                position: { ...parent.position },
                velocity: { ...parent.velocity },
                alive: true,
                parentName: parent.name,
                isHypothesis: false,
            };
            pushCatalogBody(meteorBody, {
                sources: ["Synthetic Galaxy Model"],
                description: `Meteoroid sintetis pada halo ${parent.name}.`,
            });
            syntheticGalaxyBodyNames.add(meteorName);
            registerDynamicOrbit(
                meteorName,
                parent.name,
                parent.radiusMeters * seededRange(parentSeed, 2800 + m, 0.1, 0.32),
                seededRange(parentSeed, 2900 + m, isGalaxy ? 60_000 : 110_000, isGalaxy ? 180_000 : 260_000) * 365.25,
                seededRange(parentSeed, 3000 + m, 3, 38),
                seededRange(parentSeed, 3100 + m, 0.05, 0.42),
                `${meteorName}:orbit`,
            );
        }
    }

    ensureCosmicHierarchyBodies();

    nasaCatalogEntries = nasaCatalogBodies.length;
    addLocalEvent(`Model sintetis galaksi diperbarui: +${syntheticGalaxyBodyNames.size} objek dinamis.`);
}

function updateDynamicCatalogBodies(dtMs: number): void {
    if (dynamicCatalogOrbits.size === 0 || !uiState.running) {
        return;
    }

    const dtSec = (dtMs / 1000) * clamp(engine.currentTimeScale / 120, 2, 64);
    const bodyIndex = new Map<string, UniverseBody>();
    engine.getMajorBodies().forEach((body) => bodyIndex.set(body.name, body));
    engine.getContextBodies().forEach((body) => bodyIndex.set(body.name, body));
    nasaCatalogBodies.forEach((body) => bodyIndex.set(body.name, body));

    for (const orbit of dynamicCatalogOrbits.values()) {
        const body = bodyIndex.get(orbit.bodyName);
        const parent = bodyIndex.get(orbit.parentName);
        if (!body || !parent) {
            continue;
        }

        orbit.phaseRad += orbit.omegaRadPerSec * dtSec;
        const rel = dynamicOrbitPoint(orbit, orbit.phaseRad);
        body.position = {
            x: parent.position.x + rel.x,
            y: parent.position.y + rel.y,
            z: parent.position.z + rel.z,
        };

        const relNext = dynamicOrbitPoint(orbit, orbit.phaseRad + 0.0008);
        const tx = relNext.x - rel.x;
        const ty = relNext.y - rel.y;
        const tz = relNext.z - rel.z;
        const mag = Math.max(Math.hypot(tx, ty, tz), 1e-9);
        const speed = Math.max(Math.abs(orbit.omegaRadPerSec) * orbit.semiMajorMeters, 0.1);
        body.velocity = {
            x: parent.velocity.x + (tx / mag) * speed,
            y: parent.velocity.y + (ty / mag) * speed,
            z: parent.velocity.z + (tz / mag) * speed,
        };
    }
}

function addLocalEvent(message: string): void {
    const stamp = engine.getStateSnapshot().yearsElapsed.toFixed(3);
    localEvents.unshift(`[ingest] waktu=${stamp} tahun | ${message}`);
    if (localEvents.length > 16) {
        localEvents.splice(16);
    }
}

function setSplashProgress(progress: number, message: string): void {
    const safeProgress = clamp(progress, 0, 100);
    splashProgress.value = safeProgress;
    splashStatus.textContent = message;
    splashPercent.textContent = `${Math.round(safeProgress)}%`;
}

function ingestModeBreakdown(statuses: IngestStatus[]): { online: number; fallback: number; failed: number } {
    return {
        online: statuses.filter((entry) => entry.mode === "online").length,
        fallback: statuses.filter((entry) => entry.mode === "fallback").length,
        failed: statuses.filter((entry) => entry.mode === "failed").length,
    };
}

function normalizeIngestMode(mode?: string): IngestStatus["mode"] {
    if (mode === "online") {
        return "online";
    }
    if (mode === "failed") {
        return "failed";
    }
    return "fallback";
}

async function fetchAgencyCatalogFile(): Promise<AgencyCatalogFile | null> {
    const url = `${import.meta.env.BASE_URL}data/agency-catalog.json`;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: { Accept: "application/json" },
            cache: "no-store",
            signal: controller.signal,
        });
        if (!response.ok) {
            return null;
        }
        return await response.json() as AgencyCatalogFile;
    } catch {
        return null;
    } finally {
        window.clearTimeout(timeout);
    }
}

function applyCatalogEntries(entries: ExternalCatalogEntry[], sourceName: string): number {
    let freshCount = 0;
    for (const entry of entries) {
        mergeBodySources(entry.name, [sourceName]);
        if (entry.description) {
            bodyDescriptionsDynamic.set(entry.name, entry.description);
        }
        if (entry.imageUrl) {
            bodyImagesDynamic.set(entry.name, entry.imageUrl);
        }

        if (findExistingBodyByName(entry.name)) {
            continue;
        }

        const createdBody = catalogEntryToBody(entry);
        pushCatalogBody(createdBody, {
            sources: [sourceName],
            description: entry.description,
            imageUrl: entry.imageUrl,
        });

        const parent = createdBody.parentName ? findExistingBodyByName(createdBody.parentName) : null;
        if (parent && parent.name !== createdBody.name) {
            const relDx = createdBody.position.x - parent.position.x;
            const relDy = createdBody.position.y - parent.position.y;
            const relDz = createdBody.position.z - parent.position.z;
            const semiMajorMeters = Math.max(Math.hypot(relDx, relDy, relDz), constants.auMeters * 0.02);
            const periodDays = estimateOrbitalPeriodDays(semiMajorMeters, parent.massKg);
            registerDynamicOrbit(
                createdBody.name,
                parent.name,
                semiMajorMeters,
                periodDays,
                seededRange(createdBody.name, 41, 0, 26),
                seededRange(createdBody.name, 42, 0.001, 0.42),
                `${createdBody.name}:${sourceName}:dyn`,
            );
        }

        freshCount += 1;
    }

    nasaCatalogEntries = nasaCatalogBodies.length;
    return freshCount;
}

function applyNasaRows(rows: NasaExoplanetRow[]): number {
    const reservedNames = new Set([
        ...engine.getMajorBodies().map((body) => body.name),
    ]);
    const hostMap = new Map<string, UniverseBody>();
    let freshCount = 0;
    for (const row of rows) {
        if (!row.hostname || !Number.isFinite(row.ra) || !Number.isFinite(row.dec) || !Number.isFinite(row.sy_dist)) {
            continue;
        }

        const hostName = row.hostname.trim();
        if (!hostName) {
            continue;
        }

        if (!hostMap.has(hostName)) {
            const hostVector = raDecDistanceToVector(row.ra as number, row.dec as number, row.sy_dist as number);
            const hostDisplayName = reservedNames.has(hostName) ? `NASA ${hostName}` : hostName;
            const hostBody: UniverseBody = {
                name: hostDisplayName,
                kind: "star",
                massKg: Math.max(0.08, row.st_mass ?? 1) * constants.solarMassKg,
                radiusMeters: Math.max(0.1, row.st_rad ?? 1) * SOLAR_RADIUS,
                colorHex: "#cde4ff",
                position: { x: hostVector.x, y: hostVector.y, z: hostVector.z },
                velocity: { x: 0, y: 0, z: 0 },
                alive: true,
                parentName: "Bima Sakti",
                isHypothesis: false,
            };
            hostMap.set(hostName, hostBody);
            pushCatalogBody(hostBody, {
                sources: ["NASA"],
                description: `Host star katalog NASA Exoplanet Archive (${hostName}).`,
            });
            freshCount += 1;
            reservedNames.add(hostDisplayName);
        }

        if (!row.pl_name) {
            continue;
        }

        const hostBody = hostMap.get(hostName);
        if (!hostBody) {
            continue;
        }

        const orbitAu = Math.max(0.02, row.pl_orbsmax ?? 0.35);
        const theta = Math.random() * Math.PI * 2;
        const orbitalOffset = orbitAu * constants.auMeters;
        const planetBody: UniverseBody = {
            name: row.pl_name,
            kind: "planet",
            massKg: Math.max(0.05, row.pl_bmasse ?? 1) * EARTH_MASS,
            radiusMeters: Math.max(0.2, row.pl_rade ?? 1) * EARTH_RADIUS,
            colorHex: "#9bc6ff",
            position: {
                x: hostBody.position.x + orbitalOffset * Math.cos(theta),
                y: hostBody.position.y + orbitalOffset * 0.06 * Math.sin(theta),
                z: hostBody.position.z + orbitalOffset * Math.sin(theta),
            },
            velocity: { x: 0, y: 0, z: 0 },
            alive: true,
            parentName: hostBody.name,
            isHypothesis: false,
        };
        pushCatalogBody(planetBody, {
            sources: ["NASA"],
            description: `Eksoplanet ${row.pl_name} dari katalog NASA Exoplanet Archive.`,
        });
        registerDynamicOrbit(
            planetBody.name,
            hostBody.name,
            orbitAu * constants.auMeters,
            Math.max(8, row.pl_orbper ?? 320),
            seededRange(planetBody.name, 21, 0, 10),
            seededRange(planetBody.name, 22, 0.001, 0.24),
            `${planetBody.name}:nasa`,
        );
        freshCount += 1;
    }
    nasaCatalogEntries = nasaCatalogBodies.length;
    return freshCount;
}

function ingestFallbackCatalogs(): IngestStatus[] {
    const statuses: IngestStatus[] = [];

    setSplashProgress(40, "Fallback: memproses NASA...");
    const nasaAdded = applyNasaRows(fallbackNasaRows);
    const nasa: IngestStatus = {
        source: "NASA",
        mode: "fallback",
        count: nasaAdded,
        note: "NASA fallback rows enabled",
    };
    setIngestStatus(nasa.source, nasa.mode, nasa.count, nasa.note);
    addLocalEvent(`NASA ingest fallback aktif: +${nasaAdded} objek referensi.`);
    statuses.push(nasa);

    setSplashProgress(44, "Fallback: memproses ESA...");
    const esaAdded = applyCatalogEntries(esaFallbackEntries, "ESA");
    const esa: IngestStatus = {
        source: "ESA",
        mode: "fallback",
        count: esaAdded,
        note: "ESA fallback dataset active",
    };
    setIngestStatus(esa.source, esa.mode, esa.count, esa.note);
    addLocalEvent(`ESA ingest fallback aktif: +${esaAdded} objek katalog.`);
    statuses.push(esa);

    setSplashProgress(48, "Fallback: memproses JAXA...");
    const jaxaAdded = applyCatalogEntries(jaxaFallbackEntries, "JAXA");
    const jaxa: IngestStatus = {
        source: "JAXA",
        mode: "fallback",
        count: jaxaAdded,
        note: "JAXA fallback dataset active",
    };
    setIngestStatus(jaxa.source, jaxa.mode, jaxa.count, jaxa.note);
    addLocalEvent(`JAXA ingest fallback aktif: +${jaxaAdded} objek katalog.`);
    statuses.push(jaxa);

    setSplashProgress(52, "Fallback: memproses NED...");
    const nedAdded = applyCatalogEntries(nedFallbackEntries, "NED");
    const ned: IngestStatus = {
        source: "NED",
        mode: "fallback",
        count: nedAdded,
        note: "NED fallback dataset active",
    };
    setIngestStatus(ned.source, ned.mode, ned.count, ned.note);
    addLocalEvent(`NED ingest fallback aktif: +${nedAdded} objek katalog.`);
    statuses.push(ned);

    setSplashProgress(56, "Fallback: memproses SIMBAD...");
    const simbadAdded = applyCatalogEntries(simbadFallbackEntries, "SIMBAD");
    const simbad: IngestStatus = {
        source: "SIMBAD",
        mode: "fallback",
        count: simbadAdded,
        note: "SIMBAD fallback dataset active",
    };
    setIngestStatus(simbad.source, simbad.mode, simbad.count, simbad.note);
    addLocalEvent(`SIMBAD ingest fallback aktif: +${simbadAdded} objek katalog.`);
    statuses.push(simbad);

    setSplashProgress(60, "Fallback: memproses MPC...");
    const mpcAdded = applyCatalogEntries(mpcFallbackEntries, "MPC");
    const mpc: IngestStatus = {
        source: "MPC",
        mode: "fallback",
        count: mpcAdded,
        note: "MPC fallback dataset active",
    };
    setIngestStatus(mpc.source, mpc.mode, mpc.count, mpc.note);
    addLocalEvent(`MPC ingest fallback aktif: +${mpcAdded} objek katalog.`);
    statuses.push(mpc);

    return statuses;
}

function ingestFromAgencyCatalogFile(payload: AgencyCatalogFile): IngestStatus[] {
    const statuses: IngestStatus[] = [];

    setSplashProgress(40, "Sinkronisasi NASA Exoplanet Archive...");
    const nasaRows = payload.nasa?.rows;
    const hasNasaRows = Array.isArray(nasaRows) && nasaRows.length > 0;
    const nasaAdded = applyNasaRows(hasNasaRows ? nasaRows : fallbackNasaRows);
    const nasa: IngestStatus = {
        source: "NASA",
        mode: hasNasaRows ? normalizeIngestMode(payload.nasa?.mode) : "fallback",
        count: nasaAdded,
        note: payload.nasa?.note ?? (hasNasaRows ? "NASA cached catalog loaded" : "NASA fallback rows enabled"),
    };
    setIngestStatus(nasa.source, nasa.mode, nasa.count, nasa.note);
    addLocalEvent(`NASA ingest ${nasa.mode}: +${nasaAdded} objek katalog.`);
    statuses.push(nasa);

    const agencyEntries = payload.agencies ?? {};
    const agencyFallbacks: Record<string, ExternalCatalogEntry[]> = {
        ESA: esaFallbackEntries,
        JAXA: jaxaFallbackEntries,
        NED: nedFallbackEntries,
        SIMBAD: simbadFallbackEntries,
        MPC: mpcFallbackEntries,
    };

    const sourceProgress: Record<string, number> = { ESA: 44, JAXA: 48, NED: 52, SIMBAD: 56, MPC: 60 };
    for (const sourceName of ["ESA", "JAXA", "NED", "SIMBAD", "MPC"]) {
        setSplashProgress(sourceProgress[sourceName], `Sinkronisasi ${sourceName} catalog...`);
        const sourceFile = agencyEntries[sourceName];
        const sourceRows = sourceFile?.entries;
        const entries = Array.isArray(sourceRows) && sourceRows.length > 0
            ? sourceRows
            : agencyFallbacks[sourceName];
        const mode = Array.isArray(sourceRows) && sourceRows.length > 0
            ? normalizeIngestMode(sourceFile?.mode)
            : "fallback";

        const added = applyCatalogEntries(entries, sourceName);
        const status: IngestStatus = {
            source: sourceName,
            mode,
            count: added,
            note: sourceFile?.note ?? `${sourceName} catalog loaded`,
        };
        setIngestStatus(status.source, status.mode, status.count, status.note);
        addLocalEvent(`${sourceName} ingest ${status.mode}: +${added} objek katalog.`);
        statuses.push(status);
    }

    return statuses;
}

async function ingestExternalCatalogs(): Promise<IngestRunSummary> {
    const startedAt = performance.now();
    setSplashProgress(30, "Mengambil payload katalog NASA/ESA/JAXA/NED/SIMBAD/MPC...");
    const payload = await fetchAgencyCatalogFile();
    setSplashProgress(38, payload ? "Payload katalog diterima, memvalidasi struktur data..." : "Payload tidak tersedia, menyiapkan fallback ilmiah...");
    const statuses = payload ? ingestFromAgencyCatalogFile(payload) : ingestFallbackCatalogs();
    const online = statuses.filter((entry) => entry.mode === "online").length;
    const fallback = statuses.filter((entry) => entry.mode === "fallback").length;
    const failed = statuses.filter((entry) => entry.mode === "failed").length;

    setSplashProgress(62, `Sinkronisasi sumber selesai (online=${online} fallback=${fallback} failed=${failed}).`);

    addLocalEvent(`Ingest selesai: online=${online} fallback=${fallback} failed=${failed}.`);

    const generatedAt = typeof payload?.generatedAt === "string" ? payload.generatedAt : null;
    if (generatedAt) {
        latestCatalogGeneratedAt = generatedAt;
    }

    if (viewState.scientificDataOnly) {
        clearSyntheticGalaxyBodies();
        setSplashProgress(60, "Mode Scientific Data Only aktif: hanya data observasional/katalog.");
    } else {
        addSyntheticGalaxySystems();
        setSplashProgress(60, `Membangun sistem galaksi dinamis (${syntheticGalaxyBodyNames.size} objek sintetis).`);
    }

    return {
        statuses,
        generatedAt,
        durationMs: performance.now() - startedAt,
    };
}

function setCanvasSize(): void {
    const width = Math.max(window.innerWidth, 320);
    const height = Math.max(window.innerHeight, 320);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    resizeInfoPreviewCanvas();
}

function compressedDistanceMeters(distanceMeters: number): number {
    const au = Math.max(distanceMeters / constants.auMeters, 0);

    if (au <= 3) {
        return au * 12;
    }

    if (au <= 80) {
        return 3 * 12 + (au - 3) * 4.4;
    }

    if (au <= 200000) {
        return 3 * 12 + (80 - 3) * 4.4 + Math.log10(au - 79) * 34;
    }

    return 3 * 12 + (80 - 3) * 4.4 + Math.log10(200000 - 79) * 34 + Math.log10(au / 200000 + 1) * 240;
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

function toRenderPositionRelative(
    position: { x: number; y: number; z: number },
    origin: { x: number; y: number; z: number },
    originRender: THREE.Vector3,
    distanceScale = 1,
): THREE.Vector3 {
    const dx = position.x - origin.x;
    const dy = position.y - origin.y;
    const dz = position.z - origin.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance <= 1e-9) {
        return originRender.clone();
    }

    const scaledDistance = compressedDistanceMeters(distance) * clamp(distanceScale, 0.08, 1.2);
    const factor = scaledDistance / distance;
    return new THREE.Vector3(
        originRender.x + dx * factor,
        originRender.y + dy * factor,
        originRender.z + dz * factor,
    );
}

function solarRenderAnchorFromBodies(bodies: UniverseBody[]): SolarRenderAnchor | null {
    const sun = bodies.find((body) => body.name === "Matahari");
    if (!sun) {
        return null;
    }

    return {
        physicalPosition: sun.position,
        renderPosition: toRenderPosition(sun.position),
        distanceScale: 1,
    };
}

function structureDistanceScale(structureRoot: UniverseBody): number {
    if (structureRoot.kind === "galaxy") {
        return 0.22;
    }
    if (structureRoot.kind === "cluster") {
        return 0.3;
    }
    if (structureRoot.kind === "nebula") {
        return 0.38;
    }
    return 0.45;
}

function renderPositionForBody(
    body: UniverseBody,
    solarAnchor: SolarRenderAnchor | null,
    structureAnchor: SolarRenderAnchor | null,
    structureRoot: UniverseBody | null,
    bodyIndex: Map<string, UniverseBody> | null,
): THREE.Vector3 {
    if (solarAnchor && isSolarSystemBody(body)) {
        return toRenderPositionRelative(
            body.position,
            solarAnchor.physicalPosition,
            solarAnchor.renderPosition,
            solarAnchor.distanceScale ?? 1,
        );
    }

    if (structureAnchor && structureRoot && bodyIndex) {
        const relation = bodyInFocusedBranch(body, structureRoot, bodyIndex);
        if (relation.descendant || body.name === structureRoot.name) {
            return toRenderPositionRelative(
                body.position,
                structureAnchor.physicalPosition,
                structureAnchor.renderPosition,
                structureAnchor.distanceScale ?? 1,
            );
        }
    }

    return toRenderPosition(body.position);
}

function renderPositionForWorld(
    worldPosition: { x: number; y: number; z: number },
    isSolarLocal: boolean,
    solarAnchor: SolarRenderAnchor | null,
    structureAnchor: SolarRenderAnchor | null = null,
): THREE.Vector3 {
    if (isSolarLocal && solarAnchor) {
        return toRenderPositionRelative(
            worldPosition,
            solarAnchor.physicalPosition,
            solarAnchor.renderPosition,
            solarAnchor.distanceScale ?? 1,
        );
    }

    if (structureAnchor) {
        return toRenderPositionRelative(
            worldPosition,
            structureAnchor.physicalPosition,
            structureAnchor.renderPosition,
            structureAnchor.distanceScale ?? 1,
        );
    }

    return toRenderPosition(worldPosition);
}

function toRenderRadius(body: UniverseBody, zoomSpan = cameraZoomSpan()): number {
    const safeRadius = Math.max(body.radiusMeters, 1);
    const logRadius = Math.log10(safeRadius);
    const zoomFactor = Math.max(zoomSpan, 1);

    if (body.kind === "star") {
        const base = clamp(0.65 + (logRadius - 6.0) * 0.42, 0.65, 2.4);
        if (body.name === "Matahari") {
            const nearShrink = clamp(zoomFactor / 280, 0.42, 1.35);
            return clamp(base * nearShrink, 0.56, 2.9);
        }
        return base;
    }

    if (body.kind === "black-hole") {
        return clamp(0.55 + (logRadius - 6.0) * 0.38, 0.55, 2.2);
    }

    if (body.kind === "planet" || body.kind === "dwarf" || body.kind === "hypothesis") {
        const base = clamp(0.12 + (logRadius - 5.7) * 0.24, 0.08, 0.72);
        if (isSolarSystemBody(body)) {
            const nearBoost = clamp(1.36 - zoomFactor / 900, 1.0, 1.34);
            return clamp(base * nearBoost, 0.12, 0.96);
        }
        return base;
    }

    if (body.kind === "moon") {
        const base = clamp(0.06 + (logRadius - 5.0) * 0.14, 0.04, 0.32);
        if (isSolarSystemBody(body)) {
            const nearBoost = clamp(1.48 - zoomFactor / 920, 1.0, 1.44);
            return clamp(base * nearBoost, 0.06, 0.48);
        }
        return base;
    }

    if (body.kind === "galaxy") {
        const base = clamp(1.1 + (logRadius - 14.0) * 0.42, 1.0, 4.4);
        const zoomBlend = clamp(0.62 + zoomFactor / 2600, 0.62, 1.22);
        return clamp(base * zoomBlend, 0.9, 5.2);
    }

    if (body.kind === "cluster") {
        const base = clamp(1.0 + (logRadius - 14.0) * 0.36, 0.95, 3.9);
        const zoomBlend = clamp(0.66 + zoomFactor / 3000, 0.66, 1.16);
        return clamp(base * zoomBlend, 0.85, 4.8);
    }

    if (body.kind === "nebula") {
        const base = clamp(0.95 + (logRadius - 13.5) * 0.32, 0.78, 3.4);
        const zoomBlend = clamp(0.7 + zoomFactor / 3400, 0.7, 1.12);
        return clamp(base * zoomBlend, 0.72, 4.0);
    }

    if (bodyLooksRocky(body)) {
        return clamp(0.03 + (logRadius - 3.5) * 0.1, 0.02, 0.12);
    }

    if (bodyLooksComet(body)) {
        return clamp(0.05 + (logRadius - 3.8) * 0.13, 0.03, 0.18);
    }

    return clamp(0.1 + (logRadius - 5.3) * 0.18, 0.06, 0.8);
}

const solarSystemAnchors = new Set([
    "Matahari",
    "Merkurius",
    "Venus",
    "Bumi",
    "Mars",
    "Jupiter",
    "Saturnus",
    "Uranus",
    "Neptunus",
]);

function cameraZoomSpan(): number {
    return camera.position.distanceTo(controls.target);
}

function isSolarSystemBody(body: UniverseBody): boolean {
    if (body.name === "Matahari") {
        return true;
    }

    if (body.parentName && solarSystemAnchors.has(body.parentName)) {
        return true;
    }

    if (!(bodyLooksRocky(body) || bodyLooksComet(body))) {
        return false;
    }

    const parent = (body.parentName ?? "").toLowerCase();
    if (parent.length === 0) {
        return body.name.startsWith("Asteroid-")
            || body.name.startsWith("Kuiper-")
            || body.name.startsWith("Meteor-")
            || body.name.startsWith("Comet-");
    }

    return parent === "matahari"
        || parent === "bumi"
        || parent === "jupiter"
        || parent === "saturnus"
        || parent === "uranus"
        || parent === "neptunus"
        || parent.includes("solar")
        || parent.includes("sistem surya")
        || parent.includes("sistem surya lokal");
}

function isLargeScaleStructure(body: UniverseBody | null): boolean {
    if (!body) {
        return false;
    }
    if (body.kind === "galaxy" || body.kind === "cluster") {
        return true;
    }
    if (body.kind === "nebula") {
        return true;
    }
    if (body.kind === "other" || body.kind === "hypothesis") {
        return !isSolarSystemBody(body);
    }
    return false;
}

function bodyHasAncestorName(
    body: UniverseBody,
    ancestorName: string,
    bodyIndex: Map<string, UniverseBody>,
): boolean {
    let parentName: string | null = body.parentName ?? null;
    let guard = 0;
    while (parentName && guard < 32) {
        if (parentName === ancestorName) {
            return true;
        }
        const parentBody = bodyIndex.get(parentName) ?? findExistingBodyByName(parentName);
        parentName = parentBody?.parentName ?? null;
        guard += 1;
    }
    return false;
}

function bodyInFocusedBranch(
    body: UniverseBody,
    focusBody: UniverseBody,
    bodyIndex: Map<string, UniverseBody>,
): { inBranch: boolean; descendant: boolean; ancestor: boolean } {
    if (body.name === focusBody.name) {
        return { inBranch: true, descendant: true, ancestor: false };
    }

    const descendant = bodyHasAncestorName(body, focusBody.name, bodyIndex);
    const ancestor = bodyHasAncestorName(focusBody, body.name, bodyIndex);
    return {
        inBranch: descendant || ancestor,
        descendant,
        ancestor,
    };
}

function focusedStructureRoot(
    focusBody: UniverseBody | null,
    bodyIndex: Map<string, UniverseBody>,
): UniverseBody | null {
    if (!focusBody) {
        return null;
    }

    if (isLargeScaleStructure(focusBody)) {
        return focusBody;
    }

    let parentName: string | null = focusBody.parentName ?? null;
    let guard = 0;
    while (parentName && guard < 32) {
        const parent = bodyIndex.get(parentName) ?? findExistingBodyByName(parentName);
        if (!parent) {
            return null;
        }
        if (isLargeScaleStructure(parent)) {
            return parent;
        }
        parentName = parent.parentName ?? null;
        guard += 1;
    }

    return null;
}

function shouldDisplayBodyAtZoom(
    body: UniverseBody,
    key: string,
    position: THREE.Vector3,
    focusPosition: THREE.Vector3,
    zoomSpan: number,
    focusBody: UniverseBody | null,
    bodyIndex: Map<string, UniverseBody>,
    structureRoot: UniverseBody | null,
): boolean {
    const selected = uiState.selectedKey === key;
    const focused = focusBody ? body.name === focusBody.name : body.name === uiState.focusName;
    if (selected || focused) {
        return true;
    }

    const distanceFromFocus = position.distanceTo(focusPosition);
    const solarBody = isSolarSystemBody(body);

    if (structureRoot) {
        const branch = bodyInFocusedBranch(body, structureRoot, bodyIndex);
        if (!branch.inBranch) {
            return false;
        }

        if (zoomSpan < 120) {
            if (branch.ancestor) {
                return body.kind === "cluster" || body.kind === "galaxy";
            }
            if (body.kind === "planet" || body.kind === "moon") {
                return branch.descendant && distanceFromFocus < 320;
            }
            if (bodyLooksRocky(body) || bodyLooksComet(body) || body.kind === "meteor") {
                return branch.descendant && distanceFromFocus < 220;
            }
            return true;
        }

        if (zoomSpan < 520) {
            if (bodyLooksRocky(body) || bodyLooksComet(body) || body.kind === "meteor") {
                return branch.descendant && distanceFromFocus < 680;
            }
            return true;
        }

        if (zoomSpan < 2000) {
            if (body.kind === "planet" || body.kind === "moon" || bodyLooksRocky(body) || bodyLooksComet(body) || body.kind === "meteor") {
                return branch.descendant && distanceFromFocus < 5200;
            }
            return true;
        }

        if (body.kind === "planet" || body.kind === "moon" || bodyLooksRocky(body) || bodyLooksComet(body) || body.kind === "meteor") {
            return branch.descendant;
        }
        return true;
    }

    if (zoomSpan < 180) {
        if (!solarBody && ["star", "black-hole", "galaxy", "cluster", "nebula"].includes(body.kind)) {
            return false;
        }
        if ((bodyLooksRocky(body) || bodyLooksComet(body)) && distanceFromFocus > 80) {
            return false;
        }
        return solarBody || distanceFromFocus < 120;
    }

    if (zoomSpan < 520) {
        if (["galaxy", "cluster", "nebula"].includes(body.kind) && !focused && !selected) {
            return false;
        }
        if ((bodyLooksRocky(body) || body.kind === "meteor") && distanceFromFocus > 220) {
            return false;
        }
        return true;
    }

    if (zoomSpan < 1200) {
        if ((body.kind === "cluster" || body.kind === "nebula") && !focused && !selected) {
            return false;
        }
        if (body.kind === "moon" && !focused && !selected && distanceFromFocus > 260) {
            return false;
        }
        if (bodyLooksRocky(body) || bodyLooksComet(body) || body.kind === "meteor") {
            return focused || selected || distanceFromFocus < 340;
        }
        return true;
    }

    if (zoomSpan < 2200) {
        if ((body.kind === "planet" || body.kind === "moon" || bodyLooksRocky(body) || bodyLooksComet(body)) && solarBody) {
            return focused || selected;
        }
        if (body.kind === "cluster" && !focused && !selected && distanceFromFocus > 1600) {
            return false;
        }
        return true;
    }

    if ((body.kind === "planet" || body.kind === "moon" || bodyLooksRocky(body) || bodyLooksComet(body)) && solarBody) {
        return focused || selected;
    }

    return true;
}

function isRingedBody(body: UniverseBody): boolean {
    return body.name === "Saturnus" || body.name === "Uranus" || body.kind === "black-hole";
}

function ringTiltRadForBody(body: UniverseBody): number {
    if (body.name === "Saturnus") {
        return degToRad(26.7);
    }
    if (body.name === "Uranus") {
        return degToRad(97.8);
    }
    return degToRad(62);
}

function createRingMesh(body: UniverseBody): THREE.Mesh {
    const isBlackHole = body.kind === "black-hole";
    const geometry = new THREE.RingGeometry(
        isBlackHole ? 1.18 : 1.26,
        isBlackHole ? 2.18 : 2.42,
        90,
    );
    const material = new THREE.MeshStandardMaterial({
        color: isBlackHole ? 0x7f95ff : body.name === "Uranus" ? 0x86cce0 : 0xd7be8e,
        emissive: isBlackHole ? new THREE.Color(0x2d3a8b) : new THREE.Color(0x000000),
        emissiveIntensity: isBlackHole ? 0.8 : 0,
        transparent: true,
        opacity: isBlackHole ? 0.78 : 0.66,
        side: THREE.DoubleSide,
        roughness: 0.68,
        metalness: 0.08,
    });
    return new THREE.Mesh(geometry, material);
}

function updateRingMeshTransform(ring: THREE.Mesh, body: UniverseBody, position: THREE.Vector3, radius: number): void {
    ring.position.copy(position);
    const scale = body.kind === "black-hole" ? radius * 1.05 : radius;
    ring.scale.setScalar(Math.max(scale, 0.25));
    ring.rotation.set(Math.PI / 2, 0, ringTiltRadForBody(body));
}

const infoPreviewScene = new THREE.Scene();
const infoPreviewCamera = new THREE.PerspectiveCamera(34, 1, 0.1, 44);
infoPreviewCamera.position.set(0, 0, 4.2);

const infoPreviewRenderer = new THREE.WebGLRenderer({
    canvas: infoPreviewCanvas,
    antialias: true,
    alpha: true,
    powerPreference: "low-power",
});
infoPreviewRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
infoPreviewRenderer.outputColorSpace = THREE.SRGBColorSpace;
infoPreviewRenderer.setClearColor(0x000000, 0);

infoPreviewScene.add(new THREE.AmbientLight(0xa6c7ff, 0.88));
const infoPreviewKeyLight = new THREE.DirectionalLight(0xfff0cf, 1.2);
infoPreviewKeyLight.position.set(2.1, 1.4, 2.2);
infoPreviewScene.add(infoPreviewKeyLight);

let infoPreviewMesh: THREE.Mesh | null = null;
let infoPreviewRing: THREE.Mesh | null = null;
let infoPreviewBodyName = "";

function resizeInfoPreviewCanvas(): void {
    const rect = infoPreviewCanvas.getBoundingClientRect();
    const width = Math.max(72, Math.round(rect.width || 96));
    const height = Math.max(72, Math.round(rect.height || 96));
    infoPreviewRenderer.setSize(width, height, false);
    infoPreviewCamera.aspect = width / height;
    infoPreviewCamera.updateProjectionMatrix();
}

function clearInfoPreviewBody(): void {
    if (infoPreviewMesh) {
        infoPreviewScene.remove(infoPreviewMesh);
        infoPreviewMesh.geometry.dispose();
        const meshMaterial = infoPreviewMesh.material;
        if (Array.isArray(meshMaterial)) {
            meshMaterial.forEach((m) => m.dispose());
        } else {
            meshMaterial.dispose();
        }
        infoPreviewMesh = null;
    }

    if (infoPreviewRing) {
        infoPreviewScene.remove(infoPreviewRing);
        infoPreviewRing.geometry.dispose();
        const ringMaterial = infoPreviewRing.material;
        if (Array.isArray(ringMaterial)) {
            ringMaterial.forEach((m) => m.dispose());
        } else {
            ringMaterial.dispose();
        }
        infoPreviewRing = null;
    }

    infoPreviewBodyName = "";
}

function setInfoPreviewBody(body: UniverseBody): void {
    if (infoPreviewBodyName === body.name && infoPreviewMesh) {
        return;
    }

    clearInfoPreviewBody();
    infoPreviewBodyName = body.name;

    const detail = body.kind === "galaxy" || body.kind === "nebula" ? 14 : 26;
    const geometry = new THREE.SphereGeometry(1, detail, detail);
    const material = new THREE.MeshStandardMaterial({
        color: hexToColor(body.colorHex),
        roughness: body.kind === "star" ? 0.24 : 0.56,
        metalness: body.kind === "black-hole" ? 0.5 : 0.18,
        emissive: body.kind === "star"
            ? new THREE.Color(hexToColor(body.colorHex)).multiplyScalar(0.24)
            : body.kind === "black-hole"
                ? new THREE.Color(0x202862)
                : new THREE.Color(0x050d1e),
        emissiveIntensity: body.kind === "black-hole" ? 0.55 : 1,
    });

    infoPreviewMesh = new THREE.Mesh(geometry, material);
    infoPreviewScene.add(infoPreviewMesh);

    if (isRingedBody(body)) {
        infoPreviewRing = createRingMesh(body);
        infoPreviewScene.add(infoPreviewRing);
        updateRingMeshTransform(infoPreviewRing, body, new THREE.Vector3(0, 0, 0), 1);
    }
}

function animateInfoPreview(dtMs: number): void {
    if (!infoPreviewMesh) {
        return;
    }

    const seconds = dtMs / 1000;
    infoPreviewMesh.rotation.y += seconds * 0.9;
    infoPreviewMesh.rotation.x += seconds * 0.2;

    if (infoPreviewRing) {
        infoPreviewRing.rotation.z += seconds * 0.12;
    }

    infoPreviewRenderer.render(infoPreviewScene, infoPreviewCamera);
}

function disposeOrbitGuides(): void {
    orbitGuideGroup.children.forEach((child) => {
        const line = child as THREE.Line;
        line.geometry.dispose();
        const mat = line.material;
        if (Array.isArray(mat)) {
            mat.forEach((m: THREE.Material) => m.dispose());
        } else {
            mat.dispose();
        }
    });
    orbitGuideGroup.clear();
}

function orbitGuidePoint(guide: UniverseOrbitGuide, phaseRad: number): { x: number; y: number; z: number } {
    const e = clamp(guide.eccentricity, 0, 0.86);
    const a = Math.max(guide.semiMajorMeters, 1);
    const p = a * (1 - e * e);
    const r = p / Math.max(1e-9, 1 + e * Math.cos(phaseRad));

    const argument = phaseRad + guide.argumentPeriapsisRad;
    const cosArg = Math.cos(argument);
    const sinArg = Math.sin(argument);
    const cosNode = Math.cos(guide.ascendingNodeRad);
    const sinNode = Math.sin(guide.ascendingNodeRad);
    const cosI = Math.cos(guide.inclinationRad);
    const sinI = Math.sin(guide.inclinationRad);

    return {
        x: r * (cosNode * cosArg - sinNode * sinArg * cosI),
        y: r * (sinArg * sinI),
        z: r * (sinNode * cosArg + cosNode * sinArg * cosI),
    };
}

function rebuildOrbitGuides(force = false): void {
    if (!viewState.showOrbitalGuides) {
        orbitGuideGroup.visible = false;
        return;
    }

    orbitGuideGroup.visible = true;

    const now = performance.now();
    if (!force && orbitGuideGroup.children.length > 0 && now - lastOrbitGuideBuild < 1200) {
        return;
    }
    lastOrbitGuideBuild = now;

    disposeOrbitGuides();

    const zoomSpan = cameraZoomSpan();
    const nearZoom = zoomSpan < 260;
    const midZoom = zoomSpan >= 260 && zoomSpan < 900;
    const solarAnchor = solarRenderAnchorFromBodies(engine.getMajorBodies());
    const guideBodyIndex = new Map<string, UniverseBody>();
    engine.getMajorBodies().forEach((body) => guideBodyIndex.set(body.name, body));
    engine.getContextBodies().forEach((body) => guideBodyIndex.set(body.name, body));
    nasaCatalogBodies.forEach((body) => guideBodyIndex.set(body.name, body));

    const focusBody = guideBodyIndex.get(uiState.focusName) ?? bodyByNameAny(uiState.focusName);
    const structureRoot = focusedStructureRoot(focusBody, guideBodyIndex);
    const structureAnchor = structureRoot
        ? {
            physicalPosition: structureRoot.position,
            renderPosition: toRenderPosition(structureRoot.position),
            distanceScale: structureDistanceScale(structureRoot),
        }
        : null;

    const dynamicGuides: UniverseOrbitGuide[] = Array.from(dynamicCatalogOrbits.values())
        .map((orbit): UniverseOrbitGuide | null => {
            const body = guideBodyIndex.get(orbit.bodyName) ?? bodyByNameAny(orbit.bodyName);
            if (!body || !body.alive) {
                return null;
            }
            return {
                bodyName: orbit.bodyName,
                parentName: orbit.parentName,
                kind: body.kind,
                isHypothesis: body.isHypothesis,
                semiMajorMeters: orbit.semiMajorMeters,
                orbitalPeriodSeconds: (2 * Math.PI) / Math.max(Math.abs(orbit.omegaRadPerSec), 1e-15),
                eccentricity: orbit.eccentricity,
                inclinationRad: orbit.inclinationRad,
                ascendingNodeRad: orbit.ascendingNodeRad,
                argumentPeriapsisRad: orbit.argumentPeriapsisRad,
            };
        })
        .filter((guide): guide is UniverseOrbitGuide => guide !== null);

    const guides = [...engine.getOrbitGuides(viewState.showContext), ...dynamicGuides]
        .filter((guide) => guide.kind !== "other")
        .filter((guide) => {
            const guideBody = guideBodyIndex.get(guide.bodyName) ?? bodyByNameAny(guide.bodyName);
            return !!guideBody && shouldRenderBody(guideBody);
        })
        .filter((guide) => {
            if (structureRoot) {
                const guideBody = guideBodyIndex.get(guide.bodyName) ?? bodyByNameAny(guide.bodyName);
                if (!guideBody) {
                    return false;
                }
                const relation = bodyInFocusedBranch(guideBody, structureRoot, guideBodyIndex);
                if (!relation.inBranch) {
                    return false;
                }
                if (zoomSpan < 180 && relation.ancestor && guide.bodyName !== structureRoot.name) {
                    return false;
                }
            }

            if (guide.kind === "moon") {
                return guide.bodyName === uiState.focusName || guide.parentName === uiState.focusName;
            }

            if (nearZoom) {
                if (["galaxy", "cluster", "nebula"].includes(guide.kind)) {
                    return false;
                }
                if (!solarSystemAnchors.has(guide.parentName) && guide.bodyName !== uiState.focusName) {
                    return false;
                }
                if (guide.semiMajorMeters > 130 * constants.auMeters && guide.bodyName !== uiState.focusName) {
                    return false;
                }
            }

            if (midZoom) {
                if (guide.semiMajorMeters > 50000 * constants.auMeters && !["galaxy", "cluster"].includes(guide.kind)) {
                    return false;
                }
            }

            if (!nearZoom && zoomSpan > 1300) {
                if (guide.kind === "planet" && guide.bodyName !== uiState.focusName && guide.parentName !== uiState.focusName) {
                    return false;
                }
            }

            return true;
        });

    for (const guide of guides) {
        const parent = bodyByName(guide.parentName);
        if (!parent) {
            continue;
        }

        const refDistance = compressedDistanceMeters(Math.max(guide.semiMajorMeters, 1));
        if (!Number.isFinite(refDistance) || refDistance < 0.08) {
            continue;
        }

        const points: THREE.Vector3[] = [];
        const segments = guide.kind === "moon" ? 140 : 200;
        const solarLocalGuide = solarSystemAnchors.has(guide.parentName) || guide.parentName === "Matahari";
        const guideBody = guideBodyIndex.get(guide.bodyName) ?? bodyByNameAny(guide.bodyName);
        const structureLocalGuide = !!(structureRoot && guideBody && bodyInFocusedBranch(guideBody, structureRoot, guideBodyIndex).descendant);
        for (let i = 0; i <= segments; i += 1) {
            const t = (i / segments) * Math.PI * 2;
            const localPoint = orbitGuidePoint(guide, t);
            const worldPoint = {
                x: parent.position.x + localPoint.x,
                y: parent.position.y + localPoint.y,
                z: parent.position.z + localPoint.z,
            };
            points.push(renderPositionForWorld(worldPoint, solarLocalGuide, solarAnchor, structureLocalGuide ? structureAnchor : null));
        }

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const zoomOpacityScale = nearZoom ? 0.62 : midZoom ? 0.5 : 0.34;
        const material = new THREE.LineBasicMaterial({
            color: guide.kind === "moon" ? 0x8ca7db : 0x6f8fca,
            transparent: true,
            opacity: (guide.isHypothesis ? 0.26 : guide.kind === "moon" ? 0.22 : 0.44) * zoomOpacityScale,
        });
        const line = new THREE.LineLoop(geometry, material);
        orbitGuideGroup.add(line);
    }
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

    if (viewState.scientificDataOnly && syntheticGalaxyBodyNames.has(body.name)) {
        return false;
    }

    if (!bodyWithinHierarchyWindow(body)) {
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
        "Triangulum (M33)",
        "M87 Galaxy",
        "Laniakea",
        "Grup Lokal",
        "Halo Materi Gelap",
        "Latar Energi Gelap",
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
    labelCanvas.width = 320;
    labelCanvas.height = 56;

    const ctx = labelCanvas.getContext("2d");
    if (ctx) {
        ctx.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
        ctx.font = "600 19px 'Space Grotesk', sans-serif";
        ctx.textBaseline = "middle";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(8, 18, 36, 0.95)";
        ctx.fillStyle = /^#[0-9a-f]{6}$/i.test(colorHex) ? colorHex : "#d8e7ff";
        ctx.strokeText(text, 10, 28);
        ctx.fillText(text, 10, 28);
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
    sprite.scale.set(5.6, 1.15, 1);
    return sprite;
}

const bodyTextureCache = new Map<string, THREE.CanvasTexture>();

function textureForBody(body: UniverseBody): THREE.Texture | null {
    if (body.kind === "cluster" || body.kind === "other") {
        return null;
    }

    const key = `${body.name}|${body.kind}|${body.colorHex}`;
    const cached = bodyTextureCache.get(key);
    if (cached) {
        return cached;
    }

    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        return null;
    }

    const base = /^#[0-9a-f]{6}$/i.test(body.colorHex) ? body.colorHex : "#8fb6ff";
    const seed = hashString(body.name);

    const drawBands = (light: string, dark: string): void => {
        for (let i = 0; i < 18; i += 1) {
            const y = (i / 18) * canvas.height;
            const h = canvas.height / 18 + 2;
            ctx.fillStyle = i % 2 === 0 ? light : dark;
            ctx.globalAlpha = 0.7 + ((seed + i) % 3) * 0.08;
            ctx.fillRect(0, y, canvas.width, h);
        }
        ctx.globalAlpha = 1;
    };

    const fillRadial = (inner: string, outer: string): void => {
        const grad = ctx.createRadialGradient(95, 85, 18, 128, 128, 132);
        grad.addColorStop(0, inner);
        grad.addColorStop(1, outer);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    };

    const drawSpiralArms = (armCount: number, color: string, stretchY: number): void => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        for (let arm = 0; arm < armCount; arm += 1) {
            ctx.beginPath();
            for (let t = 0; t <= 320; t += 1) {
                const angle = arm * ((Math.PI * 2) / armCount) + t * 0.11;
                const radius = 10 + t * 0.44;
                const x = 128 + Math.cos(angle) * radius;
                const y = 128 + Math.sin(angle) * radius * stretchY;
                if (t === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.stroke();
        }
    };

    if (body.kind === "star") {
        fillRadial("#fff0bb", base);
    } else if (body.kind === "galaxy") {
        const morphology = morphologyForGalaxy(body);
        if (morphology === "elliptical") {
            fillRadial("#dce7ff", "#586ea8");
            ctx.fillStyle = "rgba(225, 236, 255, 0.25)";
            for (let i = 0; i < 8; i += 1) {
                ctx.beginPath();
                ctx.ellipse(
                    128,
                    128,
                    38 + i * 12,
                    28 + i * 8,
                    (i * 11 * Math.PI) / 180,
                    0,
                    Math.PI * 2,
                );
                ctx.fill();
            }
        } else if (morphology === "irregular") {
            fillRadial("#cfe2ff", "#415c96");
            ctx.fillStyle = "rgba(206, 229, 255, 0.42)";
            for (let i = 0; i < 24; i += 1) {
                ctx.beginPath();
                ctx.ellipse(
                    seededRange(body.name, 510 + i, 26, 230),
                    seededRange(body.name, 610 + i, 24, 232),
                    seededRange(body.name, 710 + i, 6, 24),
                    seededRange(body.name, 810 + i, 4, 18),
                    seededRange(body.name, 910 + i, 0, Math.PI),
                    0,
                    Math.PI * 2,
                );
                ctx.fill();
            }
        } else if (morphology === "barred-spiral") {
            fillRadial("#dce8ff", "#304b86");
            ctx.fillStyle = "rgba(226, 237, 255, 0.62)";
            ctx.fillRect(62, 120, 132, 16);
            drawSpiralArms(2, "rgba(196, 220, 255, 0.58)", 0.62);
        } else {
            fillRadial("#d8e2ff", "#364d8f");
            drawSpiralArms(3, "rgba(191, 210, 255, 0.45)", 0.72);
        }
    } else if (body.kind === "black-hole") {
        fillRadial("#1b2147", "#02040b");
        ctx.strokeStyle = "rgba(120, 146, 255, 0.5)";
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.arc(128, 128, 74, 0, Math.PI * 2);
        ctx.stroke();
    } else if (body.name === "Jupiter") {
        drawBands("#d7bf9a", "#a88864");
    } else if (body.name === "Saturnus") {
        drawBands("#d8c49b", "#9f8d6c");
    } else if (body.name === "Bumi") {
        fillRadial("#88d8ff", "#2d6db8");
        ctx.fillStyle = "rgba(80, 150, 92, 0.85)";
        for (let i = 0; i < 8; i += 1) {
            ctx.beginPath();
            ctx.ellipse(((seed + i * 29) % 180) + 30, ((seed + i * 41) % 180) + 35, 18 + (i % 4) * 6, 10 + (i % 3) * 6, (i * 33 * Math.PI) / 180, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.fillStyle = "rgba(255, 255, 255, 0.24)";
        ctx.fillRect(0, 96, 256, 10);
    } else if (body.name === "Mars") {
        fillRadial("#f0a07b", "#9b4d3a");
    } else if (body.kind === "moon" || body.kind === "dwarf") {
        fillRadial("#d8d8d8", "#808080");
        ctx.fillStyle = "rgba(70, 70, 70, 0.22)";
        for (let i = 0; i < 14; i += 1) {
            ctx.beginPath();
            ctx.arc(((seed + i * 17) % 220) + 18, ((seed + i * 31) % 220) + 18, 4 + (i % 5), 0, Math.PI * 2);
            ctx.fill();
        }
    } else {
        fillRadial("#bfd3ff", base);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    bodyTextureCache.set(key, texture);
    return texture;
}

function spinRadPerSecForBody(body: UniverseBody): number {
    const hours = bodyRotationHoursByName[body.name];
    if (hours && Number.isFinite(hours) && Math.abs(hours) > 0.05) {
        return (2 * Math.PI) / (Math.abs(hours) * 3600) * Math.sign(hours);
    }

    if (body.kind === "black-hole") {
        return (2 * Math.PI) / (10 * 3600);
    }
    if (body.kind === "star") {
        return (2 * Math.PI) / (580 * 3600);
    }
    if (body.kind === "planet") {
        return (2 * Math.PI) / (30 * 3600);
    }
    if (body.kind === "moon") {
        return (2 * Math.PI) / (65 * 3600);
    }
    return (2 * Math.PI) / (90 * 3600);
}

function createNode(body: UniverseBody): BodyNode {
    const key = bodyKey(body);
    const color = hexToColor(body.colorHex);
    const diffuseStructure = body.kind === "galaxy" || body.kind === "cluster" || body.kind === "nebula";
    const detail = diffuseStructure ? 18 : bodyLooksRocky(body) ? 10 : bodyLooksComet(body) ? 12 : 24;
    const spinRadPerSec = spinRadPerSecForBody(body);

    const geometry = new THREE.SphereGeometry(1, detail, detail);
    const texture = textureForBody(body);
    const material = new THREE.MeshStandardMaterial({
        color,
        map: texture,
        roughness: diffuseStructure ? 0.94 : body.kind === "star" ? 0.22 : 0.66,
        metalness: diffuseStructure ? 0.01 : body.kind === "black-hole" ? 0.42 : 0.07,
        transparent: diffuseStructure,
        opacity: diffuseStructure ? (body.kind === "galaxy" ? 0.42 : body.kind === "cluster" ? 0.34 : 0.28) : 1,
        depthWrite: !diffuseStructure,
        side: diffuseStructure ? THREE.DoubleSide : THREE.FrontSide,
        emissive: body.kind === "star"
            ? new THREE.Color(color).multiplyScalar(0.35)
            : body.kind === "galaxy" || body.kind === "cluster"
                ? new THREE.Color(color).multiplyScalar(0.22)
                : body.kind === "nebula"
                    ? new THREE.Color(color).multiplyScalar(0.1)
                    : new THREE.Color(0x000000),
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(toRenderPosition(body.position));
    mesh.scale.setScalar(toRenderRadius(body));
    mesh.userData.structureShell = diffuseStructure;
    mesh.rotation.x = ((hashString(body.name) % 28) - 14) * (Math.PI / 180);
    mesh.rotation.z = ((hashString(body.name) % 22) - 11) * (Math.PI / 180);
    mesh.userData.bodyKey = key;
    scene.add(mesh);

    let ring: THREE.Mesh | null = null;
    if (isRingedBody(body)) {
        ring = createRingMesh(body);
        updateRingMeshTransform(ring, body, mesh.position, toRenderRadius(body));
        scene.add(ring);
    }

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
        ring,
        spinRadPerSec,
        trail,
        trailPoints: [mesh.position.clone()],
    };
}

function disposeNode(node: BodyNode): void {
    scene.remove(node.mesh);
    node.mesh.geometry.dispose();
    const meshMaterial = node.mesh.material as THREE.MeshStandardMaterial;
    meshMaterial.dispose();

    if (node.ring) {
        scene.remove(node.ring);
        node.ring.geometry.dispose();
        const ringMaterial = node.ring.material;
        if (Array.isArray(ringMaterial)) {
            ringMaterial.forEach((m: THREE.Material) => m.dispose());
        } else {
            ringMaterial.dispose();
        }
    }

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
    const nasaBodies = viewState.showContext ? nasaCatalogBodies : [];

    major.forEach((body) => mergeBodySources(body.name, ["Orbinex Engine"]));
    small.forEach((body) => mergeBodySources(body.name, ["Orbinex Engine"]));
    context.forEach((body) => mergeBodySources(body.name, ["Orbinex Engine"]));
    nasaBodies.forEach((body) => mergeBodySources(body.name, ["External Catalog"]));

    return [...major, ...small, ...context, ...nasaBodies].filter(shouldRenderBody);
}

function updateNodes(dtMs: number): void {
    const bodies = collectBodies();
    const aliveKeys = new Set<string>();
    const bodyIndex = new Map<string, UniverseBody>(bodies.map((body) => [body.name, body]));
    const spinMultiplier = clamp(engine.currentTimeScale / 900, 0.7, 18);
    const zoomSpan = cameraZoomSpan();
    const solarAnchor = solarRenderAnchorFromBodies(bodies);
    const focusBody = bodies.find((entry) => entry.name === uiState.focusName) ?? null;
    const structureRoot = focusedStructureRoot(focusBody, bodyIndex);
    const structureAnchor = structureRoot
        ? {
            physicalPosition: structureRoot.position,
            renderPosition: toRenderPosition(structureRoot.position),
            distanceScale: structureDistanceScale(structureRoot),
        }
        : null;
    const focusPosition = focusBody
        ? renderPositionForBody(focusBody, solarAnchor, structureAnchor, structureRoot, bodyIndex)
        : controls.target.clone();

    for (const body of bodies) {
        const key = bodyKey(body);
        aliveKeys.add(key);

        let node = bodyNodes.get(key);
        if (!node) {
            node = createNode(body);
            bodyNodes.set(key, node);
        }

        node.body = body;
        node.spinRadPerSec = spinRadPerSecForBody(body);

        const position = renderPositionForBody(body, solarAnchor, structureAnchor, structureRoot, bodyIndex);
        const radius = toRenderRadius(body, zoomSpan);
        node.mesh.position.copy(position);
        const isStructureShell = node.mesh.userData.structureShell === true;
        if (isStructureShell) {
            let flattenY = body.kind === "galaxy" ? 0.34 : body.kind === "cluster" ? 0.56 : 0.7;
            let spread = body.kind === "galaxy" ? 1.92 : body.kind === "cluster" ? 1.58 : 1.35;
            if (body.kind === "galaxy") {
                const morphology = morphologyForGalaxy(body);
                if (morphology === "elliptical") {
                    flattenY = 0.76;
                    spread = 1.44;
                } else if (morphology === "barred-spiral") {
                    flattenY = 0.28;
                    spread = 2.08;
                } else if (morphology === "irregular") {
                    flattenY = 0.58;
                    spread = 1.72;
                }
            }
            node.mesh.scale.set(radius * spread, radius * flattenY, radius * spread);
        } else {
            node.mesh.scale.setScalar(radius);
        }

        const visibleByZoom = shouldDisplayBodyAtZoom(body, key, position, focusPosition, zoomSpan, focusBody, bodyIndex, structureRoot);
        node.mesh.visible = visibleByZoom;
        if (node.ring) {
            node.ring.visible = visibleByZoom;
        }

        if (uiState.running) {
            const deltaSec = dtMs / 1000;
            node.mesh.rotation.y += (isStructureShell ? 0.12 : node.spinRadPerSec * spinMultiplier) * deltaSec;
        }

        if (!node.ring && isRingedBody(body)) {
            node.ring = createRingMesh(body);
            scene.add(node.ring);
        }

        if (node.ring && !isRingedBody(body)) {
            scene.remove(node.ring);
            node.ring.geometry.dispose();
            const mat = node.ring.material;
            if (Array.isArray(mat)) {
                mat.forEach((m: THREE.Material) => m.dispose());
            } else {
                mat.dispose();
            }
            node.ring = null;
        }

        if (node.ring) {
            updateRingMeshTransform(node.ring, body, position, radius);
        }

        if (!visibleByZoom) {
            if (node.label) {
                node.label.visible = false;
            }
            if (node.trail) {
                node.trail.visible = false;
            }
            continue;
        }

        const meshMaterial = node.mesh.material as THREE.MeshStandardMaterial;
        const nextColor = hexToColor(body.colorHex);
        meshMaterial.color.setHex(nextColor);
        if (body.kind === "galaxy" || body.kind === "cluster" || body.kind === "nebula") {
            meshMaterial.transparent = true;
            meshMaterial.depthWrite = false;
            meshMaterial.opacity = body.kind === "galaxy" ? 0.42 : body.kind === "cluster" ? 0.34 : 0.28;
        } else {
            meshMaterial.transparent = false;
            meshMaterial.depthWrite = true;
            meshMaterial.opacity = 1;
        }
        if (body.kind === "star") {
            meshMaterial.emissive = new THREE.Color(nextColor).multiplyScalar(0.35);
        } else if (body.kind === "galaxy" || body.kind === "cluster") {
            meshMaterial.emissive = new THREE.Color(nextColor).multiplyScalar(0.22);
        } else if (body.kind === "nebula") {
            meshMaterial.emissive = new THREE.Color(nextColor).multiplyScalar(0.1);
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
            const sideSign = hashString(body.name) % 2 === 0 ? 1 : -1;
            node.label.position.x += sideSign * (radius * 1.45 + 0.32);
            node.label.position.y += ((hashString(body.name) % 5) - 2) * 0.05;

            const cameraDistance = camera.position.distanceTo(position);
            const labelScale = clamp(220 / Math.max(cameraDistance, 1), 0.42, 1.75);
            node.label.scale.set(5.6 * labelScale, 1.15 * labelScale, 1);

            const isCriticalLabel = body.name === "Matahari"
                || body.name === uiState.focusName
                || body.kind === "black-hole";
            const crowdedInner = position.length() < 9 && !isCriticalLabel && body.kind !== "star";
            const hiddenByZoom = (cameraDistance > 300 && !isCriticalLabel) || crowdedInner;
            node.label.visible = shouldLabelBody(body) && !hiddenByZoom;
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
            let trailUpdated = false;
            if (!last) {
                node.trailPoints.push(position.clone());
                trailUpdated = true;
            } else {
                const stepDistance = Math.sqrt(last.distanceToSquared(position));
                const orbitalScale = Math.max(position.length(), 1);
                const maxSegmentLength = clamp(
                    orbitalScale * 0.22,
                    bodyLooksComet(body) ? 2.4 : 1.2,
                    bodyLooksComet(body) ? 28 : 16,
                );

                if (stepDistance > maxSegmentLength) {
                    node.trailPoints = [position.clone()];
                    trailUpdated = true;
                } else if (stepDistance > 0.02) {
                    node.trailPoints.push(position.clone());
                    trailUpdated = true;
                }
            }
            if (node.trailPoints.length > 240) {
                node.trailPoints.splice(0, node.trailPoints.length - 240);
                trailUpdated = true;
            }
            if (trailUpdated) {
                const oldGeometry = node.trail.geometry;
                node.trail.geometry = new THREE.BufferGeometry().setFromPoints(node.trailPoints);
                oldGeometry.dispose();
            }
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
    const nasaBodies = viewState.showContext ? nasaCatalogBodies : [];
    return [...major, ...context, ...nasaBodies].filter((body) => body.alive && shouldRenderBody(body));
}

function cycleFocus(): void {
    const targets = focusCandidates();
    if (targets.length === 0) {
        return;
    }

    const current = targets.findIndex((body) => body.name === uiState.focusName);
    const next = targets[(current + 1 + targets.length) % targets.length];
    const preferredDistance = preferredFocusDistance(next);
    setFocusBody(next, { pinInfo: false, preferredDistance, durationMs: 640 });
}

function normalizeClickedFocusBody(body: UniverseBody): UniverseBody {
    const zoomSpan = cameraZoomSpan();
    if (zoomSpan < 90) {
        return body;
    }

    const parent = body.parentName ? bodyByNameAny(body.parentName) : null;
    if (!parent) {
        return body;
    }

    if (!isLargeScaleStructure(parent)) {
        return body;
    }

    if (isLargeScaleStructure(body)) {
        return body;
    }

    if (isSolarSystemBody(body)) {
        return body;
    }

    return parent;
}

function setFocusBody(
    body: UniverseBody,
    options?: {
        pinInfo?: boolean;
        preferredDistance?: number;
        durationMs?: number;
    },
): void {
    uiState.focusName = body.name;
    uiState.selectedKey = bodyKey(body);
    uiState.infoPinned = options?.pinInfo ?? true;

    const targetNode = bodyNodes.get(bodyKey(body));
    const fallbackAnchor = isSolarSystemBody(body) ? solarRenderAnchorFromBodies(engine.getMajorBodies()) : null;
    const target = targetNode ? targetNode.mesh.position.clone() : renderPositionForBody(body, fallbackAnchor, null, null, null);
    const preferredDistance = options?.preferredDistance ?? preferredFocusDistance(body);
    focusSuspendUntilMs = performance.now() + Math.max(900, (options?.durationMs ?? 920) + 200);

    const offset = camera.position.clone().sub(controls.target);
    if (offset.lengthSq() < 1e-6) {
        offset.set(42, 26, 68);
    }
    offset.setLength(clamp(preferredDistance, 28, 420));

    cameraFlight = {
        fromPosition: camera.position.clone(),
        toPosition: target.clone().add(offset),
        fromTarget: controls.target.clone(),
        toTarget: target,
        startMs: performance.now(),
        durationMs: options?.durationMs ?? 920,
    };

    updateInfoPanel();
}

function updateFocusTarget(): void {
    if (cameraFlight || performance.now() < focusSuspendUntilMs) {
        return;
    }

    const targetNode = Array.from(bodyNodes.values()).find((node) => node.body.name === uiState.focusName);
    if (!targetNode) {
        return;
    }

    const prevTarget = controls.target.clone();
    controls.target.lerp(targetNode.mesh.position, 0.18);
    const followDelta = controls.target.clone().sub(prevTarget);
    if (followDelta.lengthSq() > 1e-10) {
        camera.position.add(followDelta);
    }

    if (targetNode.body.kind === "star") {
        keyLight.position.copy(targetNode.mesh.position);
    }
}

function resetCameraToEarthView(): void {
    uiState.focusName = "Bumi";
    uiState.selectedKey = "planet:Bumi";
    uiState.infoPinned = true;
    cameraFlight = null;
    focusSuspendUntilMs = 0;

    const earthNode = Array.from(bodyNodes.values()).find((node) => node.body.name === "Bumi");
    const earth = engine.getMajorBodies().find((body) => body.name === "Bumi");
    const earthFallbackAnchor = earth ? solarRenderAnchorFromBodies(engine.getMajorBodies()) : null;
    const target = earthNode
        ? earthNode.mesh.position.clone()
        : earth
            ? renderPositionForBody(earth, earthFallbackAnchor, null, null, null)
            : new THREE.Vector3(0, 0, 0);
    const offset = new THREE.Vector3(28, 16, 36);

    controls.target.copy(target);
    camera.position.copy(target.clone().add(offset));
    camera.lookAt(target);
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

function orbitTypeLabel(orbitGuide: UniverseOrbitGuide | undefined, body: UniverseBody): string {
    if (!orbitGuide) {
        return body.parentName ? `Parent-coupled (${body.parentName})` : "Bebas / drift";
    }

    const e = orbitGuide.eccentricity;
    if (e < 0.05) {
        return "Hampir sirkular";
    }
    if (e < 1) {
        return "Eliptik terikat";
    }
    if (Math.abs(e - 1) < 1e-3) {
        return "Parabolik";
    }
    return "Hiperbolik / lepas";
}

function surfaceGravity(body: UniverseBody): number {
    return (constants.gravitationalConstant * body.massKg) / Math.max(body.radiusMeters * body.radiusMeters, 1);
}

function escapeVelocity(body: UniverseBody): number {
    return Math.sqrt((2 * constants.gravitationalConstant * body.massKg) / Math.max(body.radiusMeters, 1));
}

function schwarzschildRadius(body: UniverseBody): number {
    return (2 * constants.gravitationalConstant * body.massKg) / (constants.speedOfLightMps * constants.speedOfLightMps);
}

function hawkingTemperature(body: UniverseBody): number {
    return (PLANCK_REDUCED * Math.pow(constants.speedOfLightMps, 3))
        / (8 * Math.PI * constants.gravitationalConstant * Math.max(body.massKg, 1) * BOLTZMANN);
}

function irradianceFromSunWm2(body: UniverseBody, distanceSun: number): number {
    if (body.name === "Matahari") {
        return 1361;
    }
    const distance = Math.max(distanceSun, constants.auMeters * 0.01);
    return 1361 * Math.pow(constants.auMeters / distance, 2);
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
        clearInfoPreviewBody();
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
    const rotationHours = bodyRotationHoursByName[body.name];
    const orbitGuide = orbitGuideForBody(body.name);
    const orbitType = orbitTypeLabel(orbitGuide, body);
    const gravity = surfaceGravity(body);
    const vEscape = escapeVelocity(body);
    const irradiance = irradianceFromSunWm2(body, distanceSun);
    const uvRelative = clamp(irradiance / 110, 0, 500);
    const schwarzschildM = schwarzschildRadius(body);
    const hawkingK = hawkingTemperature(body);

    infoName.textContent = body.name;
    infoKind.textContent = `${body.kind}${body.isHypothesis ? " | hypothesis" : " | observed"}`;
    infoSource.textContent = `Sumber: ${bodySourceText(body.name)}`;
    infoQuality.textContent = `Kualitas referensi: ${bodyReferenceQuality(body.name)}`;
    infoParent.textContent = `Parent: ${body.parentName ?? "-"}`;
    infoMass.textContent = formatMass(body.massKg);
    infoRadius.textContent = formatRadius(body.radiusMeters);
    infoDistanceSun.textContent = `${(distanceSun / constants.auMeters).toFixed(3)} AU`;
    infoDistanceRender.textContent = `${renderDistance.toFixed(3)} unit`;
    infoSpeed.textContent = `${speed.toLocaleString(undefined, { maximumFractionDigits: 2 })} m/s`;
    infoTemperature.textContent = `${kelvin.toFixed(2)} K`;
    infoRotation.textContent = Number.isFinite(rotationHours)
        ? `${Math.abs(rotationHours).toFixed(3)} jam${rotationHours < 0 ? " (retrograde)" : ""}`
        : "Model dinamis";
    if (orbitGuide && Number.isFinite(orbitGuide.orbitalPeriodSeconds) && orbitGuide.orbitalPeriodSeconds > 0) {
        const days = orbitGuide.orbitalPeriodSeconds / 86400;
        infoRevolution.textContent = days >= 365
            ? `${(days / 365.25).toFixed(3)} tahun`
            : `${days.toFixed(3)} hari`;
    } else {
        infoRevolution.textContent = "Model dinamis";
    }
    infoHierarchy.textContent = hierarchyLabelForBody(body);
    infoOrbitType.textContent = orbitType;
    infoGravity.textContent = `${gravity.toExponential(3)} m/s²`;
    infoEscape.textContent = `${(vEscape / 1000).toFixed(3)} km/s`;
    infoRadiation.textContent = `${irradiance.toExponential(3)} W/m²`;
    infoUv.textContent = `${uvRelative.toFixed(2)} UV-index(eq)`;
    infoSchwarzschild.textContent = `${schwarzschildM.toExponential(3)} m`;
    infoHawking.textContent = body.kind === "black-hole"
        ? `${hawkingK.toExponential(3)} K`
        : "n/a";
    infoPosition.textContent = `(${formatExp(pos.x)}, ${formatExp(pos.y)}, ${formatExp(pos.z)})`;
    infoVelocity.textContent = `(${formatExp(body.velocity.x)}, ${formatExp(body.velocity.y)}, ${formatExp(body.velocity.z)})`;
    infoDescription.textContent = bodyDescriptionsDynamic.get(body.name)
        ?? bodyDescriptions[body.name]
        ?? "Objek kosmik aktif dalam simulasi. Klik pin untuk menahan panel saat eksplorasi.";

    setInfoPreviewBody(body);

    infoPinButton.textContent = uiState.infoPinned ? "Unpin Panel" : "Pin Panel";
}

function focusBodyBySearchTerm(term: string): boolean {
    const normalized = term.trim().toLowerCase();
    if (normalized.length === 0) {
        return false;
    }

    const targets = focusCandidates();
    const exact = targets.find((body) => body.name.toLowerCase() === normalized);
    const partial = targets.find((body) => body.name.toLowerCase().includes(normalized));
    const target = exact ?? partial;
    if (!target) {
        return false;
    }

    const preferredDistance = preferredFocusDistance(target);
    setFocusBody(target, { pinInfo: true, preferredDistance, durationMs: 820 });
    return true;
}

function updateSearchResults(): void {
    const query = searchInput.value.trim().toLowerCase();
    const targets = focusCandidates();
    const filteredTargets = query.length === 0
        ? targets
        : targets.filter((body) => body.name.toLowerCase().includes(query));

    const filtered = filteredTargets.slice(0, 80);

    searchSuggestions.innerHTML = "";
    filteredTargets.slice(0, 120).forEach((body) => {
        const option = document.createElement("option");
        option.value = body.name;
        option.label = `L${hierarchyRankForBody(body)} ${body.kind} | ${bodySourceText(body.name)}`;
        searchSuggestions.appendChild(option);
    });

    searchResults.innerHTML = "";
    filtered.forEach((body) => {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        const sourceHint = bodySourceText(body.name).split(" | ").slice(0, 2).join("+");
        button.textContent = `${body.name} [L${hierarchyRankForBody(body)}|${body.kind}] <${sourceHint}>`;
        button.addEventListener("click", () => {
            const preferredDistance = preferredFocusDistance(body);
            setFocusBody(body, { pinInfo: true, preferredDistance, durationMs: 820 });
        });
        item.appendChild(button);
        searchResults.appendChild(item);
    });

    const blackHoleCount = targets.filter((body) => body.kind === "black-hole").length;
    const galaxyCount = targets.filter((body) => body.kind === "galaxy").length;
    const groupCount = targets.filter((body) => hierarchyRankForBody(body) === 8).length;
    const clusterCount = targets.filter((body) => hierarchyRankForBody(body) === 9).length;
    const superclusterCount = targets.filter((body) => hierarchyRankForBody(body) === 10).length;
    const filamentCount = targets.filter((body) => hierarchyRankForBody(body) === 11).length;
    const voidCount = targets.filter((body) => hierarchyRankForBody(body) === 12).length;
    const hypothesisCount = targets.filter((body) => body.isHypothesis).length;
    searchMeta.textContent = `Mode:${viewState.scientificDataOnly ? "DataOnly" : "Hybrid"} | L${viewState.hierarchyMin}-${viewState.hierarchyMax} | Indeks:${targets.length} | BH:${blackHoleCount} Gal:${galaxyCount} Group:${groupCount} Cluster:${clusterCount} Super:${superclusterCount} Fil:${filamentCount} Void:${voidCount} Hyp:${hypothesisCount} | Eksternal:${nasaCatalogEntries} ${nasaCatalogStatus}`;
}

function updateHudPanel(): void {
    const snap = engine.getStateSnapshot();
    const totalRenderObjects = collectBodies().length;

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
    const hypothesisCount = engine.getContextBodies().filter((body) => body.isHypothesis).length;

    const topForecast = engine.getForecasts(1)[0];
    const forecastLine = topForecast
        ? `${topForecast.kind} ${topForecast.bodyA} -> ${topForecast.bodyB} eta=${topForecast.etaYears.toFixed(3)} y`
        : "No forecast";

    hudText.textContent = [
        "Orbinex",
        `c=${constants.speedOfLightMps.toFixed(1)} m/s | waktu=${snap.yearsElapsed.toFixed(4)} tahun | kecepatan x${snap.timeScale.toFixed(1)}`,
        `fokus=${uiState.focusName} | ${uiState.running ? "RUN" : "PAUSE"} | label=${viewState.showLabels ? "on" : "off"}`,
        `mode=${viewState.scientificDataOnly ? "ScientificDataOnly" : "Scientific+Synthetic"} | hierarki=L${viewState.hierarchyMin}-L${viewState.hierarchyMax}`,
        `delay Bumi-Matahari=${earthSunDelay.toFixed(2)} s | Bumi-Bulan=${earthMoonDelay.toFixed(2)} s`,
        `Ast=${asteroidCount} Kuiper=${kuiperCount} Komet=${cometCount} Meteor=${meteorCount}`,
        `BH=${snap.counts.blackHole} Galaxy=${snap.counts.galaxy} Nebula=${snap.counts.nebula} Hypothesis=${hypothesisCount}`,
        `Katalog eksternal=${nasaCatalogEntries} (${nasaCatalogStatus}) | major=${snap.counts.majorBodies} context=${snap.counts.contextBodies}`,
        `Render3D=${totalRenderObjects} | sintetis-galaksi=${syntheticGalaxyBodyNames.size} | orbit-dinamis=${dynamicCatalogOrbits.size}`,
        `Forecast: ${forecastLine}`,
    ].join("\n");
}

function formatEtaYears(etaYears: number): string {
    const safeYears = Math.max(etaYears, 0);
    if (safeYears >= 1) {
        return `${safeYears.toFixed(3)} tahun`;
    }
    const days = safeYears * 365.25;
    if (days >= 1) {
        return `${days.toFixed(2)} hari`;
    }
    const hours = days * 24;
    if (hours >= 1) {
        return `${hours.toFixed(2)} jam`;
    }
    const minutes = hours * 60;
    if (minutes >= 1) {
        return `${minutes.toFixed(2)} menit`;
    }
    return `${(minutes * 60).toFixed(2)} detik`;
}

function formatDistanceKm(distanceKm: number): string {
    const safe = Math.max(distanceKm, 0);
    if (safe >= 1e9) {
        return `${(safe / 1e9).toFixed(3)}e9 km`;
    }
    if (safe >= 1e6) {
        return `${(safe / 1e6).toFixed(3)}e6 km`;
    }
    if (safe >= 1000) {
        return `${safe.toLocaleString(undefined, { maximumFractionDigits: 0 })} km`;
    }
    return `${safe.toFixed(2)} km`;
}

function bodyByNameAny(name: string): UniverseBody | null {
    return bodyByName(name) ?? findExistingBodyByName(name);
}

function structureAnchorForBodies(bodyA: UniverseBody | null, bodyB: UniverseBody | null): SolarRenderAnchor | null {
    const index = new Map<string, UniverseBody>();
    engine.getMajorBodies().forEach((body) => index.set(body.name, body));
    engine.getContextBodies().forEach((body) => index.set(body.name, body));
    nasaCatalogBodies.forEach((body) => index.set(body.name, body));

    const rootA = focusedStructureRoot(bodyA, index);
    const rootB = focusedStructureRoot(bodyB, index);
    const root = rootA && rootB
        ? rootA.name === rootB.name
            ? rootA
            : rootA
        : rootA ?? rootB;

    if (!root) {
        return null;
    }

    return {
        physicalPosition: root.position,
        renderPosition: toRenderPosition(root.position),
        distanceScale: structureDistanceScale(root),
    };
}

function relativeSpeedMps(bodyA: UniverseBody | null, bodyB: UniverseBody | null): number {
    if (!bodyA || !bodyB) {
        return 0;
    }
    return Math.hypot(
        bodyA.velocity.x - bodyB.velocity.x,
        bodyA.velocity.y - bodyB.velocity.y,
        bodyA.velocity.z - bodyB.velocity.z,
    );
}

function distanceAuBetween(bodyA: UniverseBody | null, bodyB: UniverseBody | null): number | null {
    if (!bodyA || !bodyB) {
        return null;
    }
    const dist = Math.hypot(
        bodyA.position.x - bodyB.position.x,
        bodyA.position.y - bodyB.position.y,
        bodyA.position.z - bodyB.position.z,
    );
    return dist / constants.auMeters;
}

function estimateEncounterEnergyJ(bodyA: UniverseBody | null, bodyB: UniverseBody | null, relSpeed: number): number {
    const mA = Math.max(bodyA?.massKg ?? 0, 0);
    const mB = Math.max(bodyB?.massKg ?? 0, 0);
    const speed = Math.max(relSpeed, 0);

    let reducedMass = 1e11;
    if (mA > 0 && mB > 0) {
        reducedMass = (mA * mB) / (mA + mB);
    } else if (mA > 0 || mB > 0) {
        reducedMass = Math.min(Math.max(mA, mB), 2e22);
    }

    return clamp(0.5 * reducedMass * speed * speed, 0, 1e41);
}

function estimateEffectRadiusKm(energyJ: number, kind: string, bodyA: UniverseBody | null, bodyB: UniverseBody | null): number {
    const mtEquivalent = Math.max(energyJ / 4.184e15, 1e-9);
    const blastRadiusKm = 4.7 * Math.cbrt(mtEquivalent);
    const bodyScaleKm = Math.max(bodyA?.radiusMeters ?? 0, bodyB?.radiusMeters ?? 0) / 1000;

    if (kind.includes("close-pass")) {
        return clamp(Math.max(bodyScaleKm * 9, blastRadiusKm * 0.16), 100, 4e8);
    }

    return clamp(Math.max(bodyScaleKm * 2.5, blastRadiusKm), 20, 8e8);
}

function impactNarrative(kind: string, energyJ: number, confidence: number): string {
    const confPct = (confidence * 100).toFixed(1);
    if (kind.includes("supernova") || kind.includes("collapse") || kind.includes("white-dwarf")) {
        return `Potensi radiasi sangat tinggi; confidence ${confPct}%.`;
    }
    if (kind.includes("collision") || kind.includes("impact")) {
        if (energyJ >= 1e29) {
            return `Skala global/catastrophic; confidence ${confPct}%.`;
        }
        if (energyJ >= 1e24) {
            return `Skala regional-planetary; confidence ${confPct}%.`;
        }
        return `Skala lokal-regional; confidence ${confPct}%.`;
    }
    return `Gangguan gravitasi/gelombang kejut potensial; confidence ${confPct}%.`;
}

function isMajorEventKind(kind: string): boolean {
    return kind.includes("impact")
        || kind.includes("accretion")
        || kind.includes("supernova")
        || kind.includes("collapse")
        || kind.includes("white-dwarf")
        || kind.includes("collision");
}

function compactPanelMessage(message: string, limit = 84): string {
    const clean = message.replace(/\s+/g, " ").trim();
    if (clean.length <= limit) {
        return clean;
    }
    return `${clean.slice(0, Math.max(0, limit - 1)).trimEnd()}...`;
}

function focusForecastByKey(key: string): void {
    const forecast = forecastByKey.get(key);
    if (!forecast) {
        return;
    }

    const bodyA = bodyByNameAny(forecast.bodyA);
    const bodyB = bodyByNameAny(forecast.bodyB);
    const anchor = bodyA ?? bodyB;

    const worldLocation = bodyA && bodyB
        ? {
            x: (bodyA.position.x + bodyB.position.x) * 0.5,
            y: (bodyA.position.y + bodyB.position.y) * 0.5,
            z: (bodyA.position.z + bodyB.position.z) * 0.5,
        }
        : anchor?.position ?? { x: 0, y: 0, z: 0 };

    if (anchor) {
        uiState.focusName = anchor.name;
        uiState.selectedKey = bodyKey(anchor);
        uiState.infoPinned = true;
    }

    const relSpeed = relativeSpeedMps(bodyA, bodyB);
    const solarLocal = !!((bodyA && isSolarSystemBody(bodyA)) || (bodyB && isSolarSystemBody(bodyB)));
    const solarAnchor = solarLocal ? solarRenderAnchorFromBodies(engine.getMajorBodies()) : null;
    const structureAnchor = solarLocal ? null : structureAnchorForBodies(bodyA, bodyB);
    focusSuspendUntilMs = performance.now() + 1500;
    beginCameraFlight(renderPositionForWorld(worldLocation, solarLocal, solarAnchor, structureAnchor));
    spawnEventPulse({
        id: -1,
        kind: forecast.kind,
        message: forecast.message,
        timeYears: engine.getStateSnapshot().yearsElapsed,
        location: worldLocation,
        bodyA: forecast.bodyA,
        bodyB: forecast.bodyB,
        relSpeedMps: relSpeed,
    });
    updateInfoPanel();
}

function eventVisualProfile(kind: string): {
    color: number;
    lifetimeMs: number;
    startScale: number;
    endScale: number;
    coreOpacity: number;
    ringOpacity: number;
} {
    if (kind === "impact" || kind === "accretion") {
        return { color: 0xff8b57, lifetimeMs: 1600, startScale: 0.3, endScale: 4.6, coreOpacity: 0.92, ringOpacity: 0.72 };
    }
    if (kind === "supernova" || kind === "stellar-collapse") {
        return { color: 0xffd788, lifetimeMs: 2400, startScale: 0.6, endScale: 9.8, coreOpacity: 0.98, ringOpacity: 0.84 };
    }
    if (kind === "supernova-shock-front" || kind === "supernova-remnant") {
        return { color: 0xffc86e, lifetimeMs: 2100, startScale: 0.44, endScale: 7.6, coreOpacity: 0.9, ringOpacity: 0.76 };
    }
    if (kind === "white-dwarf") {
        return { color: 0xd5ecff, lifetimeMs: 1700, startScale: 0.28, endScale: 3.8, coreOpacity: 0.82, ringOpacity: 0.58 };
    }
    if (kind === "meteor-shower") {
        return { color: 0xffb06b, lifetimeMs: 1500, startScale: 0.26, endScale: 3.2, coreOpacity: 0.88, ringOpacity: 0.64 };
    }
    if (kind === "comet-wave") {
        return { color: 0x93d7ff, lifetimeMs: 1700, startScale: 0.24, endScale: 3.9, coreOpacity: 0.84, ringOpacity: 0.6 };
    }
    if (kind.includes("close-pass") || kind.includes("collision")) {
        return { color: 0xa4c6ff, lifetimeMs: 1300, startScale: 0.22, endScale: 2.7, coreOpacity: 0.8, ringOpacity: 0.52 };
    }
    return { color: 0x87a9ff, lifetimeMs: 1200, startScale: 0.2, endScale: 2.4, coreOpacity: 0.7, ringOpacity: 0.45 };
}

function disposeEventPulse(pulse: EventPulse): void {
    eventPulseGroup.remove(pulse.core);
    const coreMaterial = pulse.core.material;
    if (Array.isArray(coreMaterial)) {
        coreMaterial.forEach((material: THREE.Material) => material.dispose());
    } else {
        coreMaterial.dispose();
    }

    if (pulse.ring) {
        eventPulseGroup.remove(pulse.ring);
        const ringMaterial = pulse.ring.material;
        if (Array.isArray(ringMaterial)) {
            ringMaterial.forEach((material: THREE.Material) => material.dispose());
        } else {
            ringMaterial.dispose();
        }
    }
}

function spawnEventPulse(event: UniverseSimulationEvent): void {
    let worldPosition = event.location;
    const bodyA = event.bodyA ? bodyByNameAny(event.bodyA) : null;
    const bodyB = event.bodyB ? bodyByNameAny(event.bodyB) : null;
    const nearOrigin = Math.hypot(worldPosition.x, worldPosition.y, worldPosition.z) < constants.auMeters * 1e-7;
    if (nearOrigin && bodyA) {
        const body = bodyA;
        if (body) {
            worldPosition = body.position;
        }
    }

    const solarLocal = !!((bodyA && isSolarSystemBody(bodyA)) || (bodyB && isSolarSystemBody(bodyB)));
    const solarAnchor = solarLocal ? solarRenderAnchorFromBodies(engine.getMajorBodies()) : null;
    const structureAnchor = solarLocal ? null : structureAnchorForBodies(bodyA, bodyB);
    const position = renderPositionForWorld(worldPosition, solarLocal, solarAnchor, structureAnchor);
    const profile = eventVisualProfile(event.kind);

    const coreMaterial = new THREE.MeshBasicMaterial({
        color: profile.color,
        transparent: true,
        opacity: profile.coreOpacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
    const core = new THREE.Mesh(eventPulseCoreGeometry, coreMaterial);
    core.position.copy(position);
    core.scale.setScalar(profile.startScale);
    eventPulseGroup.add(core);

    const ringMaterial = new THREE.MeshBasicMaterial({
        color: profile.color,
        transparent: true,
        opacity: profile.ringOpacity,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(eventPulseRingGeometry, ringMaterial);
    ring.position.copy(position);
    ring.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    ring.scale.setScalar(profile.startScale * 1.3);
    eventPulseGroup.add(ring);

    eventPulses.push({
        core,
        ring,
        ageMs: 0,
        lifetimeMs: profile.lifetimeMs,
        startScale: profile.startScale,
        endScale: profile.endScale,
        spinSpeed: (Math.random() * 2 - 1) * 1.1,
    });

    while (eventPulses.length > 90) {
        const oldPulse = eventPulses.shift();
        if (oldPulse) {
            disposeEventPulse(oldPulse);
        }
    }
}

function updateEventPulses(dtMs: number): void {
    for (let i = eventPulses.length - 1; i >= 0; i -= 1) {
        const pulse = eventPulses[i];
        pulse.ageMs += dtMs;
        const t = clamp(pulse.ageMs / pulse.lifetimeMs, 0, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        const scale = pulse.startScale + (pulse.endScale - pulse.startScale) * eased;

        pulse.core.scale.setScalar(scale);
        const coreMaterial = pulse.core.material as THREE.MeshBasicMaterial;
        coreMaterial.opacity = (1 - t) * 0.9;

        if (pulse.ring) {
            pulse.ring.scale.setScalar(scale * 1.22);
            pulse.ring.rotation.z += pulse.spinSpeed * (dtMs / 1000);
            const ringMaterial = pulse.ring.material as THREE.MeshBasicMaterial;
            ringMaterial.opacity = (1 - t) * 0.68;
        }

        if (t >= 1) {
            const donePulse = eventPulses.splice(i, 1)[0];
            disposeEventPulse(donePulse);
        }
    }
}

function beginCameraFlight(target: THREE.Vector3, durationMs = 920): void {
    const offset = camera.position.clone().sub(controls.target);
    if (offset.lengthSq() < 1e-6) {
        offset.set(36, 20, 52);
    }
    offset.setLength(clamp(offset.length(), 26, 320));

    cameraFlight = {
        fromPosition: camera.position.clone(),
        toPosition: target.clone().add(offset),
        fromTarget: controls.target.clone(),
        toTarget: target.clone(),
        startMs: performance.now(),
        durationMs,
    };
}

function updateCameraFlight(nowMs: number): void {
    if (!cameraFlight) {
        return;
    }

    const elapsed = nowMs - cameraFlight.startMs;
    const t = clamp(elapsed / cameraFlight.durationMs, 0, 1);
    const eased = 1 - Math.pow(1 - t, 3);

    camera.position.lerpVectors(cameraFlight.fromPosition, cameraFlight.toPosition, eased);
    controls.target.lerpVectors(cameraFlight.fromTarget, cameraFlight.toTarget, eased);

    if (t >= 1) {
        cameraFlight = null;
    }
}

function focusEventById(eventId: number): void {
    const event = eventById.get(eventId);
    if (!event) {
        return;
    }

    const primaryBody = event.bodyA ? bodyByNameAny(event.bodyA) : null;
    const secondaryBody = event.bodyB ? bodyByNameAny(event.bodyB) : null;
    const anchorBody = primaryBody ?? secondaryBody;

    let worldLocation = event.location;
    if (Math.hypot(worldLocation.x, worldLocation.y, worldLocation.z) < constants.auMeters * 1e-7 && anchorBody) {
        worldLocation = anchorBody.position;
    }

    if (anchorBody) {
        uiState.focusName = anchorBody.name;
        uiState.selectedKey = bodyKey(anchorBody);
        uiState.infoPinned = true;
    } else {
        uiState.infoPinned = false;
        uiState.selectedKey = null;
    }

    const solarLocal = !!((primaryBody && isSolarSystemBody(primaryBody)) || (secondaryBody && isSolarSystemBody(secondaryBody)));
    const solarAnchor = solarLocal ? solarRenderAnchorFromBodies(engine.getMajorBodies()) : null;
    const structureAnchor = solarLocal ? null : structureAnchorForBodies(primaryBody, secondaryBody);

    focusSuspendUntilMs = performance.now() + 1500;
    beginCameraFlight(renderPositionForWorld(worldLocation, solarLocal, solarAnchor, structureAnchor));
    spawnEventPulse(event);
    if (isMajorEventKind(event.kind)) {
        dismissedEventIds.add(event.id);
        addLocalEvent(`Event mayor ditandai selesai: ${event.kind} (${event.id}).`);
    }
    updateInfoPanel();
    updateEventsPanel();
}

function updateEventsPanel(): void {
    const recentEvents = engine.getEvents(24).filter((event) => !dismissedEventIds.has(event.id));
    const forecasts = engine.getForecasts(8)
        .filter((forecast, index) => forecast.confidence >= 0.52 || index < 3)
        .slice(0, 4);
    const events: UniverseSimulationEvent[] = [];
    let minorCount = 0;
    for (const event of recentEvents) {
        const major = isMajorEventKind(event.kind);
        if (!major && minorCount >= 4) {
            continue;
        }
        events.push(event);
        if (!major) {
            minorCount += 1;
        }
        if (events.length >= 10) {
            break;
        }
    }
    if (events.length === 0 && recentEvents.length > 0) {
        events.push(...recentEvents.slice(0, 6));
    }

    const simYears = engine.getStateSnapshot().yearsElapsed;

    eventById.clear();
    forecastByKey.clear();
    events.forEach((event) => eventById.set(event.id, event));

    if (!engineEventsSynced) {
        recentEvents.forEach((event) => seenEventIds.add(event.id));
        engineEventsSynced = true;
    } else {
        for (const event of recentEvents) {
            if (!seenEventIds.has(event.id)) {
                seenEventIds.add(event.id);
                spawnEventPulse(event);
            }
        }
    }

    eventsList.innerHTML = "";

    localEvents.slice(0, 3).forEach((line) => {
        const item = document.createElement("li");
        item.className = "event-item event-item-local";
        item.textContent = line;
        eventsList.appendChild(item);
    });

    for (const event of events) {
        const bodyA = bodyByNameAny(event.bodyA);
        const bodyB = bodyByNameAny(event.bodyB);
        const relSpeed = event.relSpeedMps > 0 ? event.relSpeedMps : relativeSpeedMps(bodyA, bodyB);
        const energyJ = estimateEncounterEnergyJ(bodyA, bodyB, relSpeed);
        const confidence = event.kind.includes("close-pass") ? 0.7 : 0.82;
        const impact = impactNarrative(event.kind, energyJ, confidence);
        const note = compactPanelMessage(event.message, 82);

        const item = document.createElement("li");
        item.className = "event-item";

        const button = document.createElement("button");
        button.type = "button";
        button.className = "event-button";
        button.dataset.targetKey = `event:${event.id}`;
        button.title = isMajorEventKind(event.kind)
            ? "Klik untuk fokus dan sembunyikan event mayor ini dari panel."
            : "Klik untuk fokus ke koordinat kejadian.";

        const distanceAu = Math.hypot(event.location.x, event.location.y, event.location.z) / constants.auMeters;
        const anchor = [event.bodyA, event.bodyB].filter((token) => token.trim().length > 0).join(" -> ");
        const anchorText = anchor.length > 0 ? ` | ${anchor}` : "";
        button.textContent = `[event:${event.kind}] t=${event.timeYears.toFixed(3)} th${anchorText}${Number.isFinite(distanceAu) ? ` | r=${distanceAu.toFixed(3)} AU` : ""}`
            + ` | v_rel=${(relSpeed / 1000).toFixed(2)} km/s | ${impact} | ${note}`;

        item.appendChild(button);
        eventsList.appendChild(item);
    }

    if (forecasts.length > 0) {
        const predictionHeader = document.createElement("li");
        predictionHeader.className = "event-item event-item-local";
        predictionHeader.textContent = `Prediksi AI @ t=${simYears.toFixed(3)} tahun (ringkas).`;
        eventsList.appendChild(predictionHeader);
    }

    forecasts.forEach((forecast, index) => {
        const bodyA = bodyByNameAny(forecast.bodyA);
        const bodyB = bodyByNameAny(forecast.bodyB);
        const relSpeed = relativeSpeedMps(bodyA, bodyB);
        const currentDistanceAu = distanceAuBetween(bodyA, bodyB);
        const closingAu = currentDistanceAu === null
            ? null
            : Math.max(0, currentDistanceAu - (relSpeed * forecast.etaYears * YEAR_SECONDS) / constants.auMeters);
        const etaText = formatEtaYears(forecast.etaYears);
        const currentDistanceText = currentDistanceAu === null ? "n/a" : `${currentDistanceAu.toFixed(3)} AU`;
        const predictedDistanceText = closingAu === null ? "n/a" : `${closingAu.toFixed(3)} AU`;
        const note = compactPanelMessage(forecast.message, 78);

        const key = `forecast:${index}`;
        forecastByKey.set(key, forecast);

        const item = document.createElement("li");
        item.className = "event-item";

        const button = document.createElement("button");
        button.type = "button";
        button.className = "event-button event-button-forecast";
        button.dataset.targetKey = key;
        button.title = "Klik untuk fokus ke area prediksi";
        button.textContent = `[prediksi:${forecast.kind}] ${forecast.bodyA} -> ${forecast.bodyB}`
            + ` | ETA=${etaText}`
            + ` | conf=${(forecast.confidence * 100).toFixed(1)}%`
            + ` | v_rel=${(relSpeed / 1000).toFixed(2)} km/s`
            + ` | d=${currentDistanceText}->${predictedDistanceText}`
            + ` | ${note}`;

        item.appendChild(button);
        eventsList.appendChild(item);
    });

    if (eventsList.children.length === 0) {
        const empty = document.createElement("li");
        empty.className = "event-item event-item-empty";
        empty.textContent = "Belum ada event.";
        eventsList.appendChild(empty);
    }
}

function updateActionButtons(): void {
    const t = i18n[uiState.language];
    runButton.textContent = uiState.running ? t.pause : t.resume;
    focusButton.textContent = t.focus;
    trailButton.textContent = viewState.showTrails ? t.trailOn : t.trailOff;
    guidesButton.textContent = viewState.showOrbitalGuides ? t.guidesOn : t.guidesOff;
    labelButton.textContent = viewState.showLabels ? t.labelOn : t.labelOff;
    infoButton.textContent = uiState.showInfo ? t.infoOn : t.infoOff;
    searchButton.textContent = uiState.showSearch ? t.searchOn : t.searchOff;
    scienceButton.textContent = viewState.scientificDataOnly ? t.scienceOn : t.scienceOff;
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

function currentNodeTargets(): BodyNode[] {
    const zoomSpan = cameraZoomSpan();
    const nodeBodies = Array.from(bodyNodes.values()).map((node) => node.body);
    const bodyIndex = new Map<string, UniverseBody>(nodeBodies.map((body) => [body.name, body]));
    const focusBody = bodyIndex.get(uiState.focusName) ?? bodyByNameAny(uiState.focusName);
    const structureRoot = focusedStructureRoot(focusBody, bodyIndex);

    return Array.from(bodyNodes.values())
        .filter((node) => node.mesh.visible)
        .filter((node) => {
            if (zoomSpan >= 240) {
                return true;
            }

            if (structureRoot) {
                const relation = bodyInFocusedBranch(node.body, structureRoot, bodyIndex);
                return relation.inBranch || node.body.name === structureRoot.name || uiState.selectedKey === node.key;
            }

            return isSolarSystemBody(node.body)
                || node.body.name === uiState.focusName
                || uiState.selectedKey === node.key;
        });
}

function currentMeshTargets(): THREE.Object3D[] {
    return currentNodeTargets().map((node) => node.mesh);
}

function nearestBodyKeyFromPointer(): string | null {
    const candidates = currentNodeTargets();
    if (candidates.length === 0) {
        return null;
    }

    let bestKey: string | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    const zoomSpan = cameraZoomSpan();
    const maxNdcDistance = zoomSpan < 120 ? 0.095 : zoomSpan < 500 ? 0.072 : 0.052;

    for (const node of candidates) {
        const projected = node.mesh.position.clone().project(camera);
        if (projected.z < -1 || projected.z > 1) {
            continue;
        }

        const dx = projected.x - pointer.x;
        const dy = projected.y - pointer.y;
        const ndcDistance = Math.hypot(dx, dy);
        if (ndcDistance > maxNdcDistance) {
            continue;
        }

        const shellPenalty = node.mesh.userData.structureShell === true
            ? (zoomSpan < 220 ? 0.03 : 0.012)
            : 0;
        const score = ndcDistance + (projected.z + 1) * 0.002 + shellPenalty;
        if (score < bestScore) {
            bestScore = score;
            bestKey = node.key;
        }
    }

    return bestKey;
}

function updateHoverByRaycast(): void {
    if (pointer.x > 1 || pointer.y > 1) {
        if (!uiState.infoPinned) {
            uiState.hoverKey = null;
        }
        return;
    }

    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(currentMeshTargets(), false);
    const preferredHit = hits.find((entry) => {
        const hitObject = entry.object as THREE.Mesh;
        const bodyKeyRaw = hitObject.userData.bodyKey;
        if (typeof bodyKeyRaw !== "string") {
            return false;
        }
        const node = bodyNodes.get(bodyKeyRaw);
        return !!node && node.mesh.userData.structureShell !== true;
    }) ?? hits[0];
    const object = preferredHit?.object as THREE.Mesh | undefined;
    const raycastKey = typeof object?.userData.bodyKey === "string" ? object.userData.bodyKey as string : null;
    const key = raycastKey ?? nearestBodyKeyFromPointer();

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

    guidesButton.addEventListener("click", () => {
        viewState.showOrbitalGuides = !viewState.showOrbitalGuides;
        rebuildOrbitGuides(true);
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

    scienceButton.addEventListener("click", () => {
        applyScientificDataOnly(!viewState.scientificDataOnly);
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

    eventsList.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }
        const button = target.closest<HTMLButtonElement>("button[data-target-key]");
        if (!button) {
            return;
        }
        const targetKey = button.dataset.targetKey ?? "";
        if (targetKey.startsWith("event:")) {
            const rawId = Number.parseInt(targetKey.slice("event:".length), 10);
            if (Number.isFinite(rawId)) {
                focusEventById(rawId);
            }
            return;
        }
        if (targetKey.startsWith("forecast:")) {
            focusForecastByKey(targetKey);
        }
    });

    searchInput.addEventListener("input", () => {
        updateSearchResults();
    });

    searchInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") {
            return;
        }
        event.preventDefault();
        const focused = focusBodyBySearchTerm(searchInput.value);
        if (!focused) {
            const first = searchResults.querySelector("button");
            first?.dispatchEvent(new MouseEvent("click"));
        }
    });

    searchGo.addEventListener("click", () => {
        const focused = focusBodyBySearchTerm(searchInput.value);
        if (!focused) {
            const first = searchResults.querySelector("button");
            first?.dispatchEvent(new MouseEvent("click"));
        }
    });

    searchClear.addEventListener("click", () => {
        searchInput.value = "";
        updateSearchResults();
        searchInput.focus();
    });

    hierarchyMinInput.addEventListener("input", () => {
        const min = Number.parseInt(hierarchyMinInput.value, 10);
        applyHierarchyWindow(Number.isFinite(min) ? min : viewState.hierarchyMin, viewState.hierarchyMax);
    });

    hierarchyMaxInput.addEventListener("input", () => {
        const max = Number.parseInt(hierarchyMaxInput.value, 10);
        applyHierarchyWindow(viewState.hierarchyMin, Number.isFinite(max) ? max : viewState.hierarchyMax);
    });

    hierarchyResetButton.addEventListener("click", () => {
        applyHierarchyWindow(1, 13);
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
            const hoveredBody = bodyNodes.get(uiState.hoverKey)?.body;
            if (hoveredBody) {
                const selectedBody = normalizeClickedFocusBody(hoveredBody);
                const preferredDistance = preferredFocusDistance(selectedBody);
                setFocusBody(selectedBody, { pinInfo: true, preferredDistance, durationMs: 760 });
            } else {
                uiState.selectedKey = uiState.hoverKey;
                uiState.infoPinned = true;
                updateInfoPanel();
            }
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
            rebuildOrbitGuides(true);
            updateSearchResults();
            return;
        }

        if (key === "o") {
            event.preventDefault();
            guidesButton.click();
            return;
        }

        if (key === "x") {
            event.preventDefault();
            scienceButton.click();
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

        if (key === "r") {
            event.preventDefault();
            resetCameraToEarthView();
            updateInfoPanel();
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

async function waitMs(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
        window.setTimeout(resolve, ms);
    });
}

async function closeSplash(message: string): Promise<void> {
    setSplashProgress(100, message);
    await waitMs(220);
    splash.classList.remove("is-visible");
    window.setTimeout(() => {
        splash.remove();
    }, 340);
}

async function refreshCatalogIfUpdated(): Promise<void> {
    const payload = await fetchAgencyCatalogFile();
    const generatedAt = typeof payload?.generatedAt === "string" ? payload.generatedAt : "";
    if (!payload || !generatedAt || generatedAt === latestCatalogGeneratedAt) {
        return;
    }

    const beforeCount = nasaCatalogEntries;
    const statuses = ingestFromAgencyCatalogFile(payload);
    const afterCount = nasaCatalogEntries;
    const delta = afterCount - beforeCount;
    const modeStats = ingestModeBreakdown(statuses);

    latestCatalogGeneratedAt = generatedAt;
    if (viewState.scientificDataOnly) {
        clearSyntheticGalaxyBodies();
    } else {
        addSyntheticGalaxySystems();
    }
    addLocalEvent(
        `Auto-sync katalog ${new Date(generatedAt).toLocaleString()}: +${delta} objek | online=${modeStats.online} fallback=${modeStats.fallback} failed=${modeStats.failed}.`,
    );

    rebuildOrbitGuides(true);
    updateSearchResults();
    updateHudPanel();
    updateInfoPanel();
    updateEventsPanel();
}

function startCatalogAutoRefresh(): void {
    if (catalogRefreshTimer !== null) {
        window.clearInterval(catalogRefreshTimer);
    }

    catalogRefreshTimer = window.setInterval(() => {
        void refreshCatalogIfUpdated();
    }, AUTO_REFRESH_MS);
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

        if (spawnAccumulator >= 6000) {
            engine.spawnMeteorShower(4);
            if (Math.random() > 0.4) {
                engine.spawnCometWave(2);
            }
            spawnAccumulator = 0;
        }

        if (!supernovaAutoTriggered && engine.getStateSnapshot().yearsElapsed >= 8) {
            const triggered = engine.triggerSupernova("Betelgeuse");
            if (triggered) {
                addLocalEvent("Supernova model aktif: Betelgeuse masuk mode observasi ledakan.");
            }
            supernovaAutoTriggered = true;
        }
    }

    updateDynamicCatalogBodies(dtMs);
    updateNodes(dtMs);
    rebuildOrbitGuides();
    updateHoverByRaycast();
    updateFocusTarget();
    updateCameraFlight(now);
    updateEventPulses(dtMs);

    controls.update();
    renderer.render(scene, camera);
    animateInfoPreview(dtMs);

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

async function bootstrapApp(): Promise<void> {
    const bootStart = performance.now();

    setSplashProgress(8, "Menyalakan mesin fisika dan menyiapkan status loader...");
    bindUiHandlers();

    setSplashProgress(14, "Menyusun scene 3D dasar (kamera, cahaya, kanvas)...");
    setCanvasSize();
    setSplashProgress(18, "Mengunci target awal kamera ke Bumi...");
    resetCameraToEarthView();
    setSplashProgress(22, "Sinkronisasi panel UI, pencarian, dan telemetry HUD...");
    updateHierarchyFilterUi();
    updateActionButtons();
    updatePanelVisibility();
    updateSearchResults();
    updateHudPanel();
    updateEventsPanel();
    updateInfoPanel();

    setSplashProgress(26, "Audit taksonomi objek (bintang/planet/galaksi/cluster)...");

    setSplashProgress(32, "Mengambil data eksternal NASA/ESA/JAXA/NED/SIMBAD/MPC...");
    const ingest = await ingestExternalCatalogs();
    const modeStats = ingestModeBreakdown(ingest.statuses);

    setSplashProgress(
        66,
        `Ingest selesai: online=${modeStats.online} fallback=${modeStats.fallback} failed=${modeStats.failed} | ${(ingest.durationMs / 1000).toFixed(2)}s`,
    );

    setSplashProgress(72, "Menyusun orbit guide 3D berdasarkan struktur fokus...");
    rebuildOrbitGuides(true);
    setSplashProgress(78, "Menyusun indeks klik objek dan panel pencarian...");
    updateSearchResults();
    updateHudPanel();
    updateInfoPanel();
    updateEventsPanel();

    const objectCount = collectBodies().length;
    const generatedStamp = ingest.generatedAt
        ? new Date(ingest.generatedAt).toLocaleString()
        : "n/a";

    setSplashProgress(84, `Menyiapkan render ${objectCount} objek 3D (engine + katalog + sintetis)...`);
    await waitMs(120);

    setSplashProgress(92, "Mengaktifkan loop simulasi (rotasi/revolusi/event AI)...");
    window.requestAnimationFrame(animate);
    startCatalogAutoRefresh();

    const loadSec = (performance.now() - bootStart) / 1000;
    await closeSplash(`Simulasi siap | load=${loadSec.toFixed(2)}s | katalog=${generatedStamp} | auto-sync=${(AUTO_REFRESH_MS / 1000).toFixed(0)}s`);
}

void bootstrapApp();
