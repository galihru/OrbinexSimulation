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
    showOrbitalGuides: boolean;
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

function degToRad(value: number): number {
    return (value * Math.PI) / 180;
}

const logoUrl = `${import.meta.env.BASE_URL}orbinex-logo.svg`;
const EARTH_MASS = 5.9722e24;
const EARTH_RADIUS = 6.371e6;
const SOLAR_RADIUS = 6.9634e8;

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

            <section id="info-panel" class="info-panel" aria-live="polite" aria-label="Panel detail objek">
                            <div class="info-head">
                            <canvas id="info-preview" class="info-image" aria-label="Pratinjau 3D objek"></canvas>
                                    <div>
                                            <h2 id="info-name">Tidak ada objek dipilih</h2>
                                            <p id="info-kind">-</p>
                                            <p id="info-source" class="info-source">Sumber: Orbinex Engine</p>
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
        </aside>

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
const splashPercent = byId<HTMLElement>("splash-percent");

const hudText = byId<HTMLPreElement>("hud-text");
const eventsText = byId<HTMLPreElement>("events-text");
const bottomHint = byId<HTMLElement>("bottom-hint");

const searchPanel = byId<HTMLElement>("search-panel");
const searchInput = byId<HTMLInputElement>("search-input");
const searchMeta = byId<HTMLElement>("search-meta");
const searchSuggestions = byId<HTMLDataListElement>("search-suggestions");
const searchResults = byId<HTMLOListElement>("search-results");
const searchGo = byId<HTMLButtonElement>("search-go");
const searchClear = byId<HTMLButtonElement>("search-clear");

const infoPanel = byId<HTMLElement>("info-panel");
const infoPreviewCanvas = byId<HTMLCanvasElement>("info-preview");
const infoName = byId<HTMLElement>("info-name");
const infoKind = byId<HTMLElement>("info-kind");
const infoSource = byId<HTMLElement>("info-source");
const infoParent = byId<HTMLElement>("info-parent");
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
const guidesButton = byId<HTMLButtonElement>("btn-guides");
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
        guidesOn: "LINTASAN",
        guidesOff: "LINTASAN:OFF",
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
        guidesOn: "ORBIT",
        guidesOff: "ORBIT:OFF",
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
    showOrbitalGuides: true,
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

const orbitGuideGroup = new THREE.Group();
scene.add(orbitGuideGroup);

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

function bodySourceText(name: string): string {
    const set = bodySourcesByName.get(name);
    if (!set || set.size === 0) {
        return "Orbinex Engine";
    }
    return Array.from(set).join(" | ");
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

function catalogEntryToBody(entry: ExternalCatalogEntry): UniverseBody {
    const vector = raDecDistanceToVector(entry.raDeg, entry.decDeg, entry.distancePc);
    return {
        name: entry.name,
        kind: entry.kind,
        massKg: normalizeCatalogMass(entry.kind, entry.massKg),
        radiusMeters: normalizeCatalogRadius(entry.kind, entry.radiusMeters),
        colorHex: entry.colorHex ?? "#98b8ef",
        position: { x: vector.x, y: vector.y, z: vector.z },
        velocity: { x: 0, y: 0, z: 0 },
        alive: true,
        parentName: entry.parentName ?? "Matahari",
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

function addLocalEvent(message: string): void {
    const stamp = engine.getStateSnapshot().yearsElapsed.toFixed(3);
    localEvents.unshift(`[ingest] waktu=${stamp} tahun | ${message}`);
    if (localEvents.length > 40) {
        localEvents.splice(40);
    }
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

        pushCatalogBody(catalogEntryToBody(entry), {
            sources: [sourceName],
            description: entry.description,
            imageUrl: entry.imageUrl,
        });
        freshCount += 1;
    }

    nasaCatalogEntries = nasaCatalogBodies.length;
    return freshCount;
}

function applyNasaRows(rows: NasaExoplanetRow[]): number {
    const reservedNames = new Set([
        ...engine.getMajorBodies().map((body) => body.name),
        ...engine.getContextBodies().map((body) => body.name),
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
                parentName: "Matahari",
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
        freshCount += 1;
    }
    nasaCatalogEntries = nasaCatalogBodies.length;
    return freshCount;
}

function ingestFallbackCatalogs(): IngestStatus[] {
    const statuses: IngestStatus[] = [];

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

    return statuses;
}

function ingestFromAgencyCatalogFile(payload: AgencyCatalogFile): IngestStatus[] {
    const statuses: IngestStatus[] = [];

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
    };

    for (const sourceName of ["ESA", "JAXA", "NED"]) {
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

async function ingestExternalCatalogs(): Promise<void> {
    const payload = await fetchAgencyCatalogFile();
    const statuses = payload ? ingestFromAgencyCatalogFile(payload) : ingestFallbackCatalogs();
    const online = statuses.filter((entry) => entry.mode === "online").length;
    const fallback = statuses.filter((entry) => entry.mode === "fallback").length;
    const failed = statuses.filter((entry) => entry.mode === "failed").length;

    addLocalEvent(`Ingest selesai: online=${online} fallback=${fallback} failed=${failed}.`);
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

    if (au <= 80) {
        return au * 4.6;
    }

    if (au <= 200000) {
        return 80 * 4.6 + Math.log10(au - 79) * 34;
    }

    return 80 * 4.6 + Math.log10(200000 - 79) * 34 + Math.log10(au / 200000 + 1) * 240;
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
        return clamp(base * 0.62, 1.1, 6.2);
    }

    if (body.kind === "black-hole") {
        return clamp(base * 0.62, 1.4, 5.6);
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

    const sun = bodyByName("Matahari");
    if (!sun) {
        return;
    }

    const sunRenderPos = toRenderPosition(sun.position);
    const guideBodies = engine.getMajorBodies().filter((body) => {
        return body.parentName === "Matahari"
            && (body.kind === "planet" || body.kind === "dwarf" || body.kind === "hypothesis");
    });

    for (const body of guideBodies) {
        if (!body.alive) {
            continue;
        }

        const distMeters = Math.hypot(
            body.position.x - sun.position.x,
            body.position.y - sun.position.y,
            body.position.z - sun.position.z,
        );
        const radius = compressedDistanceMeters(distMeters);
        if (!Number.isFinite(radius) || radius < 0.55) {
            continue;
        }

        const points: THREE.Vector3[] = [];
        const segments = 170;
        for (let i = 0; i <= segments; i += 1) {
            const t = (i / segments) * Math.PI * 2;
            points.push(new THREE.Vector3(Math.cos(t) * radius, 0, Math.sin(t) * radius));
        }

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
            color: 0x6f8fca,
            transparent: true,
            opacity: body.kind === "hypothesis" ? 0.3 : 0.46,
        });
        const line = new THREE.LineLoop(geometry, material);
        line.position.copy(sunRenderPos);
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

            const cameraDistance = camera.position.distanceTo(position);
            const labelScale = clamp(220 / Math.max(cameraDistance, 1), 0.42, 1.75);
            node.label.scale.set(9.6 * labelScale, 2.48 * labelScale, 1);

            const isCriticalLabel = body.name === "Matahari"
                || body.name === uiState.focusName
                || body.kind === "black-hole";
            const hiddenByZoom = cameraDistance > 520 && !isCriticalLabel;
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
            if (!last || last.distanceToSquared(position) > 0.02) {
                node.trailPoints.push(position.clone());
                trailUpdated = true;
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
    return [...major, ...context, ...nasaBodies].filter((body) => body.alive && (viewState.showHypothesis || !body.isHypothesis));
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

    infoName.textContent = body.name;
    infoKind.textContent = `${body.kind}${body.isHypothesis ? " | hypothesis" : " | observed"}`;
    infoSource.textContent = `Sumber: ${bodySourceText(body.name)}`;
    infoParent.textContent = `Parent: ${body.parentName ?? "-"}`;
    infoMass.textContent = formatMass(body.massKg);
    infoRadius.textContent = formatRadius(body.radiusMeters);
    infoDistanceSun.textContent = `${(distanceSun / constants.auMeters).toFixed(3)} AU`;
    infoDistanceRender.textContent = `${renderDistance.toFixed(3)} unit`;
    infoSpeed.textContent = `${speed.toLocaleString(undefined, { maximumFractionDigits: 2 })} m/s`;
    infoTemperature.textContent = `${kelvin.toFixed(2)} K`;
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

    uiState.focusName = target.name;
    uiState.selectedKey = bodyKey(target);
    uiState.infoPinned = true;
    updateInfoPanel();
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
        option.label = `${body.kind} | ${bodySourceText(body.name)}`;
        searchSuggestions.appendChild(option);
    });

    searchResults.innerHTML = "";
    filtered.forEach((body) => {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        const sourceHint = bodySourceText(body.name).split(" | ").slice(0, 2).join("+");
        button.textContent = `${body.name} [${body.kind}] <${sourceHint}>`;
        button.addEventListener("click", () => {
            uiState.focusName = body.name;
            uiState.selectedKey = bodyKey(body);
            uiState.infoPinned = true;
            updateInfoPanel();
        });
        item.appendChild(button);
        searchResults.appendChild(item);
    });

    const blackHoleCount = targets.filter((body) => body.kind === "black-hole").length;
    const galaxyCount = targets.filter((body) => body.kind === "galaxy").length;
    const hypothesisCount = targets.filter((body) => body.isHypothesis).length;
    searchMeta.textContent = `Indeks: ${targets.length} | BH:${blackHoleCount} Galaxy:${galaxyCount} Hypothesis:${hypothesisCount} | Eksternal:${nasaCatalogEntries} ${nasaCatalogStatus}`;
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
    const hypothesisCount = engine.getContextBodies().filter((body) => body.isHypothesis).length;

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
        `BH=${snap.counts.blackHole} Galaxy=${snap.counts.galaxy} Nebula=${snap.counts.nebula} Hypothesis=${hypothesisCount}`,
        `Katalog eksternal=${nasaCatalogEntries} (${nasaCatalogStatus}) | major=${snap.counts.majorBodies} context=${snap.counts.contextBodies}`,
        `Forecast: ${forecastLine}`,
    ].join("\n");
}

function updateEventsPanel(): void {
    const events = engine.getEvents(12);
    if (events.length === 0 && localEvents.length === 0) {
        eventsText.textContent = "Belum ada event.";
        return;
    }

    const engineLines = events
        .map((event) => {
            return `[${event.kind}] waktu=${event.timeYears.toFixed(3)} tahun | ${event.message}`;
        });

    eventsText.textContent = [...localEvents.slice(0, 5), ...engineLines].join("\n");
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
            rebuildOrbitGuides(true);
            updateSearchResults();
            return;
        }

        if (key === "o") {
            event.preventDefault();
            guidesButton.click();
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
        splashPercent.textContent = `${step.p}%`;
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

    updateNodes();
    rebuildOrbitGuides();
    updateHoverByRaycast();
    updateFocusTarget();

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

bindUiHandlers();
setCanvasSize();
updateActionButtons();
updatePanelVisibility();
updateSearchResults();
updateHudPanel();
updateEventsPanel();
updateInfoPanel();

void ingestExternalCatalogs().then(() => {
    rebuildOrbitGuides(true);
    updateSearchResults();
    updateHudPanel();
    updateInfoPanel();
    updateEventsPanel();
});

window.requestAnimationFrame(animate);
void runSplash();
