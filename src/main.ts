import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import QRCode from "qrcode";

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
    pointedKey: string | null;
    pointerClientX: number;
    pointerClientY: number;
    pointerInsideCanvas: boolean;
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
    extras: THREE.Object3D[];
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

type DeferredInstallPromptEvent = Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{
        outcome: "accepted" | "dismissed";
        platform: string;
    }>;
};

type PermissionProbeResult = "granted" | "denied" | "unsupported";

type PermissionCapabilityState = {
    virtualReality: PermissionProbeResult;
    augmentedReality: PermissionProbeResult;
    deviceUse: PermissionProbeResult;
    camera: PermissionProbeResult;
    notifications: PermissionProbeResult;
    persistentStorage: PermissionProbeResult;
    wakeLock: PermissionProbeResult;
};

type RuntimeProfile = "default" | "low-lag";

type WakeLockSentinelLike = {
    release: () => Promise<void> | void;
};

type NavigatorWithWakeLock = Navigator & {
    wakeLock?: {
        request?: (type: "screen") => Promise<WakeLockSentinelLike>;
    };
};

type NavigatorWithInstalledRelatedApps = Navigator & {
    getInstalledRelatedApps?: () => Promise<Array<{ id?: string; platform?: string; url?: string }>>;
    xr?: {
        isSessionSupported?: (mode: "immersive-vr" | "immersive-ar" | "inline") => Promise<boolean>;
        requestSession?: (
            mode: "immersive-vr" | "immersive-ar",
            options?: {
                requiredFeatures?: string[];
                optionalFeatures?: string[];
                domOverlay?: { root: Element };
            },
        ) => Promise<{ end?: () => Promise<void> | void }>;
    };
    standalone?: boolean;
};

type XrSessionMode = "immersive-vr" | "immersive-ar";

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
    Venus: 5832.5,
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

const splashLogoUrl = `${import.meta.env.BASE_URL}orbinex-logo.svg`;
const brandLogoUrl = `${import.meta.env.BASE_URL}orbinex.png`;
const EARTH_MASS = 5.9722e24;
const EARTH_RADIUS = 6.371e6;
const SOLAR_RADIUS = 6.9634e8;
const YEAR_SECONDS = 365.25 * 86400;
const AUTO_REFRESH_MS = 45 * 1000;
const PLANCK_REDUCED = 1.054571817e-34;
const BOLTZMANN = 1.380649e-23;
const LIGHT_YEAR_METERS = 9.4607304725808e15;
const HIRO_MARKER_URL = "https://raw.githubusercontent.com/AR-js-org/AR.js/master/data/images/hiro.png";
const APP_BUILD_HASH = typeof __BUILD_HASH__ === "string" ? __BUILD_HASH__ : "dev-build";
const RUNTIME_PROFILE_STORAGE_KEY = "orbinex.runtimeProfile";
const PWA_DB_FILES = [
    "db/cn2tw_1.json",
    "db/tw2cn_1.json",
    "data/agency-catalog.json",
];

const app = byId<HTMLElement>("app");
app.innerHTML = `
  <main id="sim-main" class="sim-root" aria-label="Orbinex full canvas simulation">
        <canvas id="universe-canvas" aria-label="Kanvas simulasi semesta tiga dimensi"></canvas>

        <section id="hover-card" class="hover-card is-hidden" aria-live="polite" aria-label="Ringkasan objek di bawah kursor">
            <p id="hover-card-name" class="hover-card-name">-</p>
            <p id="hover-card-parent" class="hover-card-parent">-</p>
            <p id="hover-card-distance" class="hover-card-distance">-</p>
        </section>

        <section id="splash" class="splash is-visible" role="dialog" aria-modal="true" aria-label="Memuat OrbinexSimulation">
            <img src="${splashLogoUrl}" alt="Logo Orbinex" width="128" height="128" />
            <p class="splash-kicker">ORBINEXSIMULATION</p>
            <h1>Universe Sandbox Scientific 3D</h1>
            <p id="splash-status">Menyalakan mesin fisika...</p>
            <progress id="splash-progress" max="100" value="8" aria-label="Kemajuan memuat simulasi"></progress>
            <span id="splash-percent" class="splash-percent">8%</span>
        </section>

        <header class="top-command" aria-label="Quick controls">
            <div class="brand-mark">
                <img class="brand-logo" src="${brandLogoUrl}" alt="Orbinex" width="40" height="40" />
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
                <button id="btn-install" type="button">INSTALL</button>
                <button id="btn-device-access" type="button">AKSES DEVICE</button>
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
                    <div class="info-media">
                        <div class="info-image-wrap">
                            <canvas id="info-preview" class="info-image" aria-label="Pratinjau 3D objek"></canvas>
                            <img
                                id="info-preview-marker"
                                class="info-preview-marker"
                                src="https://raw.githubusercontent.com/AR-js-org/AR.js/master/data/images/hiro.png"
                                alt="Ikon marker objek"
                                loading="lazy"
                            />
                        </div>
                    </div>
                    <div>
                        <div class="info-title-row">
                            <h2 id="info-name">Tidak ada objek dipilih</h2>
                            <button id="info-ar-trigger" class="info-ar-trigger" type="button" aria-label="Lihat kode AR dan marker">AR</button>
                            <figure id="info-ar-card" class="info-ar-card" aria-label="QR AR objek aktif">
                                <div class="info-ar-code-wrap">
                                    <img id="info-ar-qr" class="info-ar-qr" alt="QR AR belum tersedia" />
                                </div>
                                <figcaption id="info-ar-caption" class="info-ar-caption">Scan HP untuk AR objek aktif</figcaption>
                                <a id="info-ar-link" class="info-ar-link" href="#" target="_blank" rel="noopener noreferrer">Buka AR di HP</a>
                            </figure>
                        </div>
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

                <p id="bottom-hint" class="bottom-hint">Ringkasan: drag/arrow orbit kamera | wheel zoom | TAB fokus | / cari | R reset bumi | klik objek pin panel</p>
  </main>
`;

const canvas = byId<HTMLCanvasElement>("universe-canvas");
const splash = byId<HTMLElement>("splash");
const splashStatus = byId<HTMLElement>("splash-status");
const splashProgress = byId<HTMLProgressElement>("splash-progress");
const splashPercent = byId<HTMLElement>("splash-percent");
const hoverCard = byId<HTMLElement>("hover-card");
const hoverCardName = byId<HTMLElement>("hover-card-name");
const hoverCardParent = byId<HTMLElement>("hover-card-parent");
const hoverCardDistance = byId<HTMLElement>("hover-card-distance");

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
const infoPreviewMarker = byId<HTMLImageElement>("info-preview-marker");
const infoArTrigger = byId<HTMLButtonElement>("info-ar-trigger");
const infoArCard = byId<HTMLElement>("info-ar-card");
const infoArQr = byId<HTMLImageElement>("info-ar-qr");
const infoArCaption = byId<HTMLElement>("info-ar-caption");
const infoArLink = byId<HTMLAnchorElement>("info-ar-link");
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

let infoArQrCurrentUrl = "";
let infoArQrPendingUrl = "";
let infoArQrRenderToken = 0;

const runButton = byId<HTMLButtonElement>("btn-run");
const focusButton = byId<HTMLButtonElement>("btn-focus");
const trailButton = byId<HTMLButtonElement>("btn-trail");
const guidesButton = byId<HTMLButtonElement>("btn-guides");
const labelButton = byId<HTMLButtonElement>("btn-label");
const infoButton = byId<HTMLButtonElement>("btn-info");
const searchButton = byId<HTMLButtonElement>("btn-search");
const installButton = byId<HTMLButtonElement>("btn-install");
const deviceAccessButton = byId<HTMLButtonElement>("btn-device-access");
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
        install: "INSTALL APP",
        installDone: "APP:TERPASANG",
        installUnavailable: "Install via menu browser (Add to Home Screen)",
        deviceAccess: "AKSES DEVICE",
        deviceAccessHint: "Minta akses aplikasi/layanan perangkat",
        helpOn: "BANTU",
        helpOff: "BANTU:OFF",
        lang: "BAHASA: ID",
        bottomHint: "Ringkasan: drag/arrow orbit kamera | wheel zoom | TAB fokus | / cari | R reset bumi | klik objek pin panel",
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
        install: "INSTALL APP",
        installDone: "APP:INSTALLED",
        installUnavailable: "Install via browser menu (Add to Home Screen)",
        deviceAccess: "DEVICE ACCESS",
        deviceAccessHint: "Request access to device apps/services",
        helpOn: "HELP",
        helpOff: "HELP:OFF",
        lang: "LANG: EN",
        bottomHint: "Summary: drag/arrow orbit | wheel zoom | TAB next focus | / search | R reset Earth | click object to pin panel",
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
    pointedKey: null,
    pointerClientX: 0,
    pointerClientY: 0,
    pointerInsideCanvas: false,
    infoPinned: false,
    showInfo: true,
    showSearch: true,
    showHelp: false,
};

const scene = new THREE.Scene();
scene.background = new THREE.Color("#020814");
scene.fog = new THREE.Fog("#020814", 600, 26000);

let rendererPixelRatioCap = 2;
let infoPreviewPixelRatioCap = 2;
let dynamicSimStepMs = 58;
let dynamicHudIntervalMs = 160;
let dynamicEventsIntervalMs = 420;
let dynamicSpawnIntervalMs = 6000;
let dynamicTrailPointLimit = 240;
let dynamicLabelLimitCompact = 10;
let dynamicLabelLimitWide = 18;
let lowLagModeActive = false;
let wakeLockHandle: WakeLockSentinelLike | null = null;

const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, rendererPixelRatioCap));
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
        size: 0.68,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.22,
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
let deferredInstallPrompt: DeferredInstallPromptEvent | null = null;
let pwaInstalled = window.matchMedia("(display-mode: standalone)").matches
    || ((window.navigator as NavigatorWithInstalledRelatedApps).standalone === true);
let pwaListenersBound = false;

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
    "Synthetic Planetary Model": 2,
    "Scientific Hierarchy Model": 2,
    NASA: 5,
    ESA: 5,
    JAXA: 5,
    NED: 5,
    SIMBAD: 4,
    MPC: 4,
    "JPL Horizons": 5,
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

type PlanetaryMoonSeed = {
    name: string;
    parentName: string;
    massKg: number;
    radiusMeters: number;
    colorHex: string;
    semiMajorMeters: number;
    periodDays: number;
    inclinationDeg: number;
    eccentricity: number;
    description: string;
};

const planetaryMoonSeeds: PlanetaryMoonSeed[] = [
    {
        name: "Phobos (Mars)",
        parentName: "Mars",
        massKg: 1.0659e16,
        radiusMeters: 11_266,
        colorHex: "#b8a486",
        semiMajorMeters: 9.376e6,
        periodDays: 0.319,
        inclinationDeg: 1.1,
        eccentricity: 0.015,
        description: "Satelit alami terdalam Mars; orbit sangat dekat dan cepat.",
    },
    {
        name: "Deimos (Mars)",
        parentName: "Mars",
        massKg: 1.476e15,
        radiusMeters: 6200,
        colorHex: "#c5b08d",
        semiMajorMeters: 2.346e7,
        periodDays: 1.263,
        inclinationDeg: 1.8,
        eccentricity: 0.0002,
        description: "Satelit alami terluar Mars dengan orbit lebih stabil.",
    },
    {
        name: "Io (Jupiter)",
        parentName: "Jupiter",
        massKg: 8.93e22,
        radiusMeters: 1.8216e6,
        colorHex: "#d8bd87",
        semiMajorMeters: 4.218e8,
        periodDays: 1.769,
        inclinationDeg: 0.04,
        eccentricity: 0.004,
        description: "Satelit Galilean dengan aktivitas vulkanik sangat tinggi.",
    },
    {
        name: "Europa (Jupiter)",
        parentName: "Jupiter",
        massKg: 4.8e22,
        radiusMeters: 1.5608e6,
        colorHex: "#d0d8e7",
        semiMajorMeters: 6.711e8,
        periodDays: 3.551,
        inclinationDeg: 0.47,
        eccentricity: 0.009,
        description: "Satelit Galilean dengan indikasi samudra bawah permukaan es.",
    },
    {
        name: "Ganymede (Jupiter)",
        parentName: "Jupiter",
        massKg: 1.48e23,
        radiusMeters: 2.6341e6,
        colorHex: "#b8c5ce",
        semiMajorMeters: 1.0704e9,
        periodDays: 7.154,
        inclinationDeg: 0.2,
        eccentricity: 0.001,
        description: "Satelit terbesar Tata Surya, memiliki medan magnet intrinsik.",
    },
    {
        name: "Callisto (Jupiter)",
        parentName: "Jupiter",
        massKg: 1.08e23,
        radiusMeters: 2.4103e6,
        colorHex: "#9f9f9f",
        semiMajorMeters: 1.8827e9,
        periodDays: 16.689,
        inclinationDeg: 0.28,
        eccentricity: 0.007,
        description: "Satelit Galilean terluar dengan permukaan berkrater tua.",
    },
    {
        name: "Amalthea (Jupiter)",
        parentName: "Jupiter",
        massKg: 2.08e18,
        radiusMeters: 83_500,
        colorHex: "#cc8f6e",
        semiMajorMeters: 1.814e8,
        periodDays: 0.498,
        inclinationDeg: 0.37,
        eccentricity: 0.003,
        description: "Satelit kecil Jupiter di wilayah dalam sistem Jovian.",
    },
    {
        name: "Titan (Saturnus)",
        parentName: "Saturnus",
        massKg: 1.3452e23,
        radiusMeters: 2.575e6,
        colorHex: "#d3b385",
        semiMajorMeters: 1.2219e9,
        periodDays: 15.945,
        inclinationDeg: 0.35,
        eccentricity: 0.029,
        description: "Satelit terbesar Saturnus dengan atmosfer tebal kaya nitrogen.",
    },
    {
        name: "Rhea (Saturnus)",
        parentName: "Saturnus",
        massKg: 2.306e21,
        radiusMeters: 763_800,
        colorHex: "#c8c6c4",
        semiMajorMeters: 5.271e8,
        periodDays: 4.518,
        inclinationDeg: 0.35,
        eccentricity: 0.001,
        description: "Satelit es besar Saturnus dengan crater terrain luas.",
    },
    {
        name: "Iapetus (Saturnus)",
        parentName: "Saturnus",
        massKg: 1.806e21,
        radiusMeters: 734_600,
        colorHex: "#b5a07f",
        semiMajorMeters: 3.561e9,
        periodDays: 79.322,
        inclinationDeg: 15.5,
        eccentricity: 0.028,
        description: "Satelit Saturnus dengan kontras albedo dua belahan sangat khas.",
    },
    {
        name: "Dione (Saturnus)",
        parentName: "Saturnus",
        massKg: 1.095e21,
        radiusMeters: 561_300,
        colorHex: "#d2d2d2",
        semiMajorMeters: 3.774e8,
        periodDays: 2.737,
        inclinationDeg: 0.02,
        eccentricity: 0.002,
        description: "Satelit es Saturnus pada orbit menengah.",
    },
    {
        name: "Tethys (Saturnus)",
        parentName: "Saturnus",
        massKg: 6.174e20,
        radiusMeters: 531_100,
        colorHex: "#d8dce2",
        semiMajorMeters: 2.946e8,
        periodDays: 1.888,
        inclinationDeg: 1.1,
        eccentricity: 0.0,
        description: "Satelit es Saturnus dengan crater dan graben besar.",
    },
    {
        name: "Enceladus (Saturnus)",
        parentName: "Saturnus",
        massKg: 1.08e20,
        radiusMeters: 252_100,
        colorHex: "#e2eef9",
        semiMajorMeters: 2.380e8,
        periodDays: 1.37,
        inclinationDeg: 0.0,
        eccentricity: 0.005,
        description: "Satelit aktif geologi dengan plume kriovolkanik.",
    },
    {
        name: "Mimas (Saturnus)",
        parentName: "Saturnus",
        massKg: 3.75e19,
        radiusMeters: 198_300,
        colorHex: "#c9ccd3",
        semiMajorMeters: 1.855e8,
        periodDays: 0.942,
        inclinationDeg: 1.6,
        eccentricity: 0.02,
        description: "Satelit kecil Saturnus dengan crater raksasa Herschel.",
    },
    {
        name: "Titania (Uranus)",
        parentName: "Uranus",
        massKg: 3.4e21,
        radiusMeters: 788_900,
        colorHex: "#c7d3db",
        semiMajorMeters: 4.363e8,
        periodDays: 8.706,
        inclinationDeg: 0.1,
        eccentricity: 0.002,
        description: "Satelit terbesar Uranus dengan lembah tektonik panjang.",
    },
    {
        name: "Oberon (Uranus)",
        parentName: "Uranus",
        massKg: 3.01e21,
        radiusMeters: 761_400,
        colorHex: "#b4c1cc",
        semiMajorMeters: 5.835e8,
        periodDays: 13.463,
        inclinationDeg: 0.1,
        eccentricity: 0.001,
        description: "Satelit luar Uranus dengan permukaan es gelap.",
    },
    {
        name: "Triton (Neptunus)",
        parentName: "Neptunus",
        massKg: 2.14e22,
        radiusMeters: 1.353e6,
        colorHex: "#cdd7e5",
        semiMajorMeters: 3.548e8,
        periodDays: 5.877,
        inclinationDeg: 156.8,
        eccentricity: 0.0,
        description: "Satelit retrograde Neptunus dengan aktivitas kriovolkanik.",
    },
];

type PlanetaryDebrisProfile = {
    parentName: string;
    kind: "meteor" | "comet";
    count: number;
    semiMajorMinMeters: number;
    semiMajorMaxMeters: number;
    periodMinDays: number;
    periodMaxDays: number;
    inclinationMaxDeg: number;
    eccentricityMax: number;
    radiusMinMeters: number;
    radiusMaxMeters: number;
    massMinKg: number;
    massMaxKg: number;
    colorHex: string;
    sources: string[];
    note: string;
};

const planetaryDebrisProfiles: PlanetaryDebrisProfile[] = [
    {
        parentName: "Mars",
        kind: "meteor",
        count: 14,
        semiMajorMinMeters: 9.5e6,
        semiMajorMaxMeters: 3.8e7,
        periodMinDays: 0.2,
        periodMaxDays: 2.2,
        inclinationMaxDeg: 35,
        eccentricityMax: 0.28,
        radiusMinMeters: 520,
        radiusMaxMeters: 3800,
        massMinKg: 1.2e10,
        massMaxKg: 8e12,
        colorHex: "#caa482",
        sources: ["MPC", "NASA", "Synthetic Planetary Model"],
        note: "Meteoroid cluster sintetis koridor Mars.",
    },
    {
        parentName: "Jupiter",
        kind: "meteor",
        count: 22,
        semiMajorMinMeters: 2.1e8,
        semiMajorMaxMeters: 2.6e9,
        periodMinDays: 0.4,
        periodMaxDays: 65,
        inclinationMaxDeg: 30,
        eccentricityMax: 0.42,
        radiusMinMeters: 700,
        radiusMaxMeters: 4600,
        massMinKg: 2e10,
        massMaxKg: 2e13,
        colorHex: "#d0b08a",
        sources: ["MPC", "NASA", "Synthetic Planetary Model"],
        note: "Meteoroid swarm sintetis zona Jovian.",
    },
    {
        parentName: "Jupiter",
        kind: "comet",
        count: 10,
        semiMajorMinMeters: 4.5e8,
        semiMajorMaxMeters: 4.2e9,
        periodMinDays: 1.5,
        periodMaxDays: 240,
        inclinationMaxDeg: 55,
        eccentricityMax: 0.7,
        radiusMinMeters: 1400,
        radiusMaxMeters: 22_000,
        massMinKg: 7e11,
        massMaxKg: 9e14,
        colorHex: "#9cd5ff",
        sources: ["MPC", "ESA", "Synthetic Planetary Model"],
        note: "Komet terperangkap sintetis gravitasi Jupiter.",
    },
    {
        parentName: "Saturnus",
        kind: "meteor",
        count: 18,
        semiMajorMinMeters: 1.6e8,
        semiMajorMaxMeters: 3.6e9,
        periodMinDays: 0.5,
        periodMaxDays: 120,
        inclinationMaxDeg: 42,
        eccentricityMax: 0.52,
        radiusMinMeters: 620,
        radiusMaxMeters: 4200,
        massMinKg: 1e10,
        massMaxKg: 1.6e13,
        colorHex: "#cdbb9f",
        sources: ["MPC", "NASA", "Synthetic Planetary Model"],
        note: "Meteoroid swarm sintetis zona Saturnian.",
    },
    {
        parentName: "Saturnus",
        kind: "comet",
        count: 9,
        semiMajorMinMeters: 5e8,
        semiMajorMaxMeters: 4.6e9,
        periodMinDays: 2,
        periodMaxDays: 280,
        inclinationMaxDeg: 60,
        eccentricityMax: 0.72,
        radiusMinMeters: 1500,
        radiusMaxMeters: 26_000,
        massMinKg: 8e11,
        massMaxKg: 1e15,
        colorHex: "#9ac9f0",
        sources: ["MPC", "ESA", "Synthetic Planetary Model"],
        note: "Komet terperangkap sintetis gravitasi Saturnus.",
    },
];

type PlanetaryMinorMoonProfile = {
    parentName: string;
    count: number;
    semiMajorMinMeters: number;
    semiMajorMaxMeters: number;
    periodMinDays: number;
    periodMaxDays: number;
    inclinationMaxDeg: number;
    eccentricityMax: number;
    radiusMinMeters: number;
    radiusMaxMeters: number;
    massMinKg: number;
    massMaxKg: number;
    colorHex: string;
    sources: string[];
    note: string;
};

const planetaryMinorMoonProfiles: PlanetaryMinorMoonProfile[] = [
    {
        parentName: "Mars",
        count: 4,
        semiMajorMinMeters: 2.8e7,
        semiMajorMaxMeters: 1.1e8,
        periodMinDays: 1.4,
        periodMaxDays: 6.2,
        inclinationMaxDeg: 16,
        eccentricityMax: 0.24,
        radiusMinMeters: 1500,
        radiusMaxMeters: 9000,
        massMinKg: 1e13,
        massMaxKg: 6e15,
        colorHex: "#b89f7f",
        sources: ["MPC", "NASA", "Synthetic Planetary Model"],
        note: "Satelit minor sintetis orbit Mars.",
    },
    {
        parentName: "Jupiter",
        count: 22,
        semiMajorMinMeters: 2.1e9,
        semiMajorMaxMeters: 2.3e10,
        periodMinDays: 24,
        periodMaxDays: 840,
        inclinationMaxDeg: 42,
        eccentricityMax: 0.48,
        radiusMinMeters: 10_000,
        radiusMaxMeters: 95_000,
        massMinKg: 4e14,
        massMaxKg: 8e18,
        colorHex: "#b5b9c3",
        sources: ["NASA", "JPL Horizons", "Synthetic Planetary Model"],
        note: "Satelit minor sintetis orbit Jupiter.",
    },
    {
        parentName: "Saturnus",
        count: 26,
        semiMajorMinMeters: 6.2e8,
        semiMajorMaxMeters: 2.8e10,
        periodMinDays: 3,
        periodMaxDays: 1120,
        inclinationMaxDeg: 48,
        eccentricityMax: 0.56,
        radiusMinMeters: 8000,
        radiusMaxMeters: 110_000,
        massMinKg: 2e14,
        massMaxKg: 9e18,
        colorHex: "#c4bba8",
        sources: ["NASA", "JPL Horizons", "Synthetic Planetary Model"],
        note: "Satelit minor sintetis orbit Saturnus.",
    },
    {
        parentName: "Uranus",
        count: 12,
        semiMajorMinMeters: 7e8,
        semiMajorMaxMeters: 8.6e9,
        periodMinDays: 2,
        periodMaxDays: 520,
        inclinationMaxDeg: 32,
        eccentricityMax: 0.34,
        radiusMinMeters: 7000,
        radiusMaxMeters: 84_000,
        massMinKg: 2e14,
        massMaxKg: 5e18,
        colorHex: "#b8cad4",
        sources: ["NASA", "JPL Horizons", "Synthetic Planetary Model"],
        note: "Satelit minor sintetis orbit Uranus.",
    },
    {
        parentName: "Neptunus",
        count: 10,
        semiMajorMinMeters: 5.2e8,
        semiMajorMaxMeters: 1.3e10,
        periodMinDays: 2,
        periodMaxDays: 700,
        inclinationMaxDeg: 38,
        eccentricityMax: 0.42,
        radiusMinMeters: 7000,
        radiusMaxMeters: 88_000,
        massMinKg: 2e14,
        massMaxKg: 6e18,
        colorHex: "#b6c4d3",
        sources: ["NASA", "JPL Horizons", "Synthetic Planetary Model"],
        note: "Satelit minor sintetis orbit Neptunus.",
    },
];

function addSyntheticPlanetarySystems(): void {
    for (const seed of planetaryMoonSeeds) {
        const parent = findExistingBodyByName(seed.parentName);
        if (!parent || findExistingBodyByName(seed.name)) {
            continue;
        }

        const moon: UniverseBody = {
            name: seed.name,
            kind: "moon",
            massKg: seed.massKg,
            radiusMeters: seed.radiusMeters,
            colorHex: seed.colorHex,
            position: { ...parent.position },
            velocity: { ...parent.velocity },
            alive: true,
            parentName: parent.name,
            isHypothesis: false,
        };

        pushCatalogBody(moon, {
            sources: ["NASA", "JPL Horizons", "Synthetic Planetary Model"],
            description: seed.description,
        });
        syntheticGalaxyBodyNames.add(seed.name);

        registerDynamicOrbit(
            seed.name,
            parent.name,
            seed.semiMajorMeters,
            seed.periodDays,
            seed.inclinationDeg,
            seed.eccentricity,
            `${seed.name}:moon`,
        );
    }

    for (const profile of planetaryMinorMoonProfiles) {
        const parent = findExistingBodyByName(profile.parentName);
        if (!parent) {
            continue;
        }

        for (let i = 0; i < profile.count; i += 1) {
            const moonName = `${profile.parentName} Minor Moon-${i + 1}`;
            if (findExistingBodyByName(moonName)) {
                continue;
            }

            const seedLabel = `${moonName}:${profile.parentName}`;
            const moon: UniverseBody = {
                name: moonName,
                kind: "moon",
                massKg: seededRange(seedLabel, 1, profile.massMinKg, profile.massMaxKg),
                radiusMeters: seededRange(seedLabel, 2, profile.radiusMinMeters, profile.radiusMaxMeters),
                colorHex: profile.colorHex,
                position: { ...parent.position },
                velocity: { ...parent.velocity },
                alive: true,
                parentName: parent.name,
                isHypothesis: false,
            };

            pushCatalogBody(moon, {
                sources: profile.sources,
                description: `${profile.note} Parent ${profile.parentName}.`,
            });
            syntheticGalaxyBodyNames.add(moonName);

            registerDynamicOrbit(
                moonName,
                parent.name,
                seededRange(seedLabel, 3, profile.semiMajorMinMeters, profile.semiMajorMaxMeters),
                seededRange(seedLabel, 4, profile.periodMinDays, profile.periodMaxDays),
                seededRange(seedLabel, 5, 0, profile.inclinationMaxDeg),
                seededRange(seedLabel, 6, 0.001, profile.eccentricityMax),
                `${moonName}:orbit`,
            );
        }
    }

    for (const profile of planetaryDebrisProfiles) {
        const parent = findExistingBodyByName(profile.parentName);
        if (!parent) {
            continue;
        }

        for (let i = 0; i < profile.count; i += 1) {
            const kindLabel = profile.kind === "meteor" ? "Meteoroid" : "Comet";
            const bodyName = `${profile.parentName} ${kindLabel}-${i + 1}`;
            if (findExistingBodyByName(bodyName)) {
                continue;
            }

            const seedLabel = `${bodyName}:${profile.parentName}`;
            const semiMajorMeters = seededRange(seedLabel, 1, profile.semiMajorMinMeters, profile.semiMajorMaxMeters);
            const periodDays = seededRange(seedLabel, 2, profile.periodMinDays, profile.periodMaxDays);
            const inclinationDeg = seededRange(seedLabel, 3, 0, profile.inclinationMaxDeg);
            const eccentricity = seededRange(seedLabel, 4, 0.01, profile.eccentricityMax);

            const body: UniverseBody = {
                name: bodyName,
                kind: profile.kind,
                massKg: seededRange(seedLabel, 5, profile.massMinKg, profile.massMaxKg),
                radiusMeters: seededRange(seedLabel, 6, profile.radiusMinMeters, profile.radiusMaxMeters),
                colorHex: profile.colorHex,
                position: { ...parent.position },
                velocity: { ...parent.velocity },
                alive: true,
                parentName: parent.name,
                isHypothesis: false,
            };

            pushCatalogBody(body, {
                sources: profile.sources,
                description: `${profile.note} Parent ${profile.parentName}.`,
            });
            syntheticGalaxyBodyNames.add(bodyName);

            registerDynamicOrbit(
                bodyName,
                parent.name,
                semiMajorMeters,
                periodDays,
                inclinationDeg,
                eccentricity,
                `${bodyName}:orbit`,
            );
        }
    }
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
    addSyntheticPlanetarySystems();

    nasaCatalogEntries = nasaCatalogBodies.length;
    addLocalEvent(`Model sintetis galaksi+tata surya diperbarui: +${syntheticGalaxyBodyNames.size} objek dinamis.`);
}

function updateDynamicCatalogBodies(dtMs: number): void {
    if (dynamicCatalogOrbits.size === 0 || !uiState.running) {
        return;
    }

    const isDestructibleMinor = (body: UniverseBody): boolean =>
        body.kind === "comet"
        || body.kind === "meteor"
        || body.name.startsWith("Asteroid-")
        || body.name.startsWith("Kuiper-")
        || body.name.includes("Meteoroid")
        || body.name.includes("Comet-");

    const captureRadiusForTarget = (body: UniverseBody): number => {
        const baseRadius = Math.max(body.radiusMeters, 1);
        if (body.kind === "black-hole") {
            return baseRadius * 10;
        }
        if (body.kind === "star") {
            return baseRadius * 1.4;
        }
        if (body.kind === "planet" || body.kind === "dwarf") {
            return baseRadius * 7;
        }
        if (body.kind === "moon") {
            return baseRadius * 5;
        }
        return baseRadius * 3;
    };

    const dtSec = (dtMs / 1000) * clamp(engine.currentTimeScale / 120, 2, 64);
    const bodyIndex = new Map<string, UniverseBody>();
    engine.getMajorBodies().forEach((body) => bodyIndex.set(body.name, body));
    engine.getContextBodies().forEach((body) => bodyIndex.set(body.name, body));
    nasaCatalogBodies.forEach((body) => bodyIndex.set(body.name, body));
    const sinkTargets = Array.from(bodyIndex.values()).filter((body) =>
        body.alive
        && (body.kind === "star"
            || body.kind === "planet"
            || body.kind === "moon"
            || body.kind === "dwarf"
            || body.kind === "black-hole"),
    );
    const capturedBodies = new Map<string, string>();

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

        if (!isDestructibleMinor(body)) {
            continue;
        }

        for (const target of sinkTargets) {
            if (!target.alive || target.name === body.name) {
                continue;
            }
            const distance = Math.hypot(
                body.position.x - target.position.x,
                body.position.y - target.position.y,
                body.position.z - target.position.z,
            );
            if (distance <= captureRadiusForTarget(target)) {
                body.alive = false;
                capturedBodies.set(body.name, target.name);
                break;
            }
        }
    }

    if (capturedBodies.size > 0) {
        for (const bodyName of capturedBodies.keys()) {
            dynamicCatalogOrbits.delete(bodyName);
        }

        for (let i = nasaCatalogBodies.length - 1; i >= 0; i -= 1) {
            if (!nasaCatalogBodies[i].alive) {
                nasaCatalogBodies.splice(i, 1);
            }
        }

        const samples = Array.from(capturedBodies.entries())
            .slice(0, 3)
            .map(([bodyName, targetName]) => `${bodyName} -> ${targetName}`)
            .join(", ");
        const extraCount = capturedBodies.size - 3;
        addLocalEvent(
            `Objek minor tersedot gravitasi dan hancur: ${samples}${extraCount > 0 ? ` (+${extraCount} lainnya)` : ""}.`,
        );
    }
}

function stabilizeMajorMoonOrbits(): void {
    const majorBodies = engine.getMajorBodies();
    if (majorBodies.length === 0) {
        return;
    }

    const bodyIndex = new Map<string, UniverseBody>();
    for (const body of majorBodies) {
        bodyIndex.set(body.name, body);
    }

    const guideIndex = new Map<string, UniverseOrbitGuide>();
    for (const guide of engine.getOrbitGuides(true)) {
        guideIndex.set(guide.bodyName, guide);
    }

    for (const moon of majorBodies) {
        if (moon.kind !== "moon" || !moon.parentName || !moon.alive) {
            continue;
        }

        const parent = bodyIndex.get(moon.parentName);
        if (!parent || !parent.alive) {
            continue;
        }

        const guide = guideIndex.get(moon.name);
        if (!guide || guide.parentName !== parent.name) {
            continue;
        }

        const semiMajor = Math.max(guide.semiMajorMeters, 1);
        const eccentricity = clamp(guide.eccentricity, 0, 0.86);
        const periapsis = semiMajor * (1 - eccentricity);
        const apoapsis = semiMajor * (1 + eccentricity);
        const minDistance = periapsis * 0.985;
        const maxDistance = apoapsis * 1.015;

        const dx = moon.position.x - parent.position.x;
        const dy = moon.position.y - parent.position.y;
        const dz = moon.position.z - parent.position.z;
        const distance = Math.hypot(dx, dy, dz);
        if (!Number.isFinite(distance) || distance <= 1e-9) {
            continue;
        }

        const clampedDistance = clamp(distance, minDistance, maxDistance);
        if (Math.abs(clampedDistance - distance) <= semiMajor * 0.0025) {
            continue;
        }

        const nx = dx / distance;
        const ny = dy / distance;
        const nz = dz / distance;

        moon.position = {
            x: parent.position.x + nx * clampedDistance,
            y: parent.position.y + ny * clampedDistance,
            z: parent.position.z + nz * clampedDistance,
        };

        const rvx = moon.velocity.x - parent.velocity.x;
        const rvy = moon.velocity.y - parent.velocity.y;
        const rvz = moon.velocity.z - parent.velocity.z;
        const radialDot = rvx * nx + rvy * ny + rvz * nz;

        let tx = rvx - nx * radialDot;
        let ty = rvy - ny * radialDot;
        let tz = rvz - nz * radialDot;
        let tangentMag = Math.hypot(tx, ty, tz);

        if (tangentMag <= 1e-9) {
            const refX = Math.abs(ny) < 0.92 ? 0 : 1;
            const refY = Math.abs(ny) < 0.92 ? 1 : 0;
            const refZ = 0;
            tx = refY * nz - refZ * ny;
            ty = refZ * nx - refX * nz;
            tz = refX * ny - refY * nx;
            tangentMag = Math.max(Math.hypot(tx, ty, tz), 1e-9);
        }

        const tnx = tx / tangentMag;
        const tny = ty / tangentMag;
        const tnz = tz / tangentMag;

        const mu = constants.gravitationalConstant * Math.max(parent.massKg + moon.massKg, 1);
        const visVivaTerm = Math.max(0, 2 / clampedDistance - 1 / semiMajor);
        const orbitalSpeed = Math.sqrt(Math.max(mu * visVivaTerm, 0));

        moon.velocity = {
            x: parent.velocity.x + tnx * orbitalSpeed,
            y: parent.velocity.y + tny * orbitalSpeed,
            z: parent.velocity.z + tnz * orbitalSpeed,
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

function installHintText(): string {
    const t = i18n[uiState.language];
    return t.installUnavailable;
}

function updateInstallButtonState(): void {
    const t = i18n[uiState.language];
    if (pwaInstalled) {
        installButton.disabled = true;
        installButton.hidden = false;
        installButton.textContent = t.installDone;
        installButton.title = t.installDone;
        return;
    }

    installButton.textContent = t.install;
    if (deferredInstallPrompt) {
        installButton.disabled = false;
        installButton.hidden = false;
        installButton.title = t.install;
        return;
    }

    installButton.disabled = true;
    installButton.hidden = false;
    installButton.title = installHintText();
}

function permissionSummary(label: string, result: PermissionProbeResult): string {
    if (result === "granted") {
        return `${label}: diizinkan`;
    }
    if (result === "denied") {
        return `${label}: ditolak`;
    }
    return `${label}: tidak didukung`;
}

function permissionReportLines(capabilities: PermissionCapabilityState): string[] {
    return [
        permissionSummary("Virtual reality", capabilities.virtualReality),
        permissionSummary("Augmented reality", capabilities.augmentedReality),
        permissionSummary("Your device use", capabilities.deviceUse),
        permissionSummary("Akses kamera AR", capabilities.camera),
        permissionSummary("Notifikasi", capabilities.notifications),
        permissionSummary("Penyimpanan offline", capabilities.persistentStorage),
        permissionSummary("Aktifkan layar saat simulasi", capabilities.wakeLock),
    ];
}

function hasGrantedCapability(capabilities: PermissionCapabilityState): boolean {
    return Object.values(capabilities).some((value) => value === "granted");
}

async function requestRelatedAppsPermission(): Promise<PermissionProbeResult> {
    if (!window.isSecureContext) {
        return "unsupported";
    }

    const nav = window.navigator as NavigatorWithInstalledRelatedApps;
    if (typeof nav.getInstalledRelatedApps !== "function") {
        return "unsupported";
    }

    try {
        await nav.getInstalledRelatedApps();
        return "granted";
    } catch {
        return "denied";
    }
}

async function requestXrSessionPermission(mode: XrSessionMode): Promise<PermissionProbeResult> {
    if (!window.isSecureContext) {
        return "unsupported";
    }

    const nav = window.navigator as NavigatorWithInstalledRelatedApps;
    const xr = nav.xr;
    if (!xr || typeof xr.requestSession !== "function") {
        return "unsupported";
    }

    try {
        if (typeof xr.isSessionSupported === "function") {
            const supported = await xr.isSessionSupported(mode);
            if (!supported) {
                return "unsupported";
            }
        }

        const session = await xr.requestSession(mode, {
            optionalFeatures: ["local-floor", "bounded-floor", "anchors", "hit-test", "dom-overlay"],
            domOverlay: { root: document.body },
        });
        await session.end?.();
        return "granted";
    } catch {
        return "denied";
    }
}

async function requestCameraPermissionForAr(): Promise<PermissionProbeResult> {
    if (!window.isSecureContext || !("mediaDevices" in navigator) || !navigator.mediaDevices?.getUserMedia) {
        return "unsupported";
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment" },
            audio: false,
        });
        stream.getTracks().forEach((track) => track.stop());
        return "granted";
    } catch {
        return "denied";
    }
}

async function requestNotificationPermissionForPwa(): Promise<PermissionProbeResult> {
    if (!window.isSecureContext || !("Notification" in window)) {
        return "unsupported";
    }

    try {
        const nextPermission = Notification.permission === "default"
            ? await Notification.requestPermission()
            : Notification.permission;
        return nextPermission === "granted" ? "granted" : "denied";
    } catch {
        return "denied";
    }
}

async function requestPersistentStoragePermission(): Promise<PermissionProbeResult> {
    if (!("storage" in navigator) || !("persist" in navigator.storage)) {
        return "unsupported";
    }

    try {
        const persisted = await navigator.storage.persist();
        return persisted ? "granted" : "denied";
    } catch {
        return "denied";
    }
}

async function requestScreenWakeLockPermission(): Promise<PermissionProbeResult> {
    if (!window.isSecureContext || document.hidden) {
        return "unsupported";
    }

    if (wakeLockHandle) {
        return "granted";
    }

    const nav = window.navigator as NavigatorWithWakeLock;
    if (!nav.wakeLock || typeof nav.wakeLock.request !== "function") {
        return "unsupported";
    }

    try {
        wakeLockHandle = await nav.wakeLock.request("screen");
        return "granted";
    } catch {
        return "denied";
    }
}

async function requestInstallAccessPermissions(): Promise<PermissionCapabilityState> {
    const virtualReality = await requestXrSessionPermission("immersive-vr");
    const augmentedReality = await requestXrSessionPermission("immersive-ar");
    const deviceUse = await requestRelatedAppsPermission();
    const camera = await requestCameraPermissionForAr();
    const notifications = await requestNotificationPermissionForPwa();
    const persistentStorage = await requestPersistentStoragePermission();
    const wakeLock = await requestScreenWakeLockPermission();

    return {
        virtualReality,
        augmentedReality,
        deviceUse,
        camera,
        notifications,
        persistentStorage,
        wakeLock,
    };
}

async function applyPermissionDrivenOptimizations(capabilities: PermissionCapabilityState, trigger: string): Promise<void> {
    if (capabilities.virtualReality === "granted" || capabilities.augmentedReality === "granted") {
        renderer.xr.enabled = true;
    }

    if (capabilities.persistentStorage === "granted") {
        void predownloadOfflineDatabaseAssets();
    }

    if (hasGrantedCapability(capabilities)) {
        activateLowLagProfile(trigger);
    }
}

async function predownloadOfflineDatabaseAssets(): Promise<void> {
    const base = new URL(import.meta.env.BASE_URL, window.location.origin);
    const absoluteUrls = PWA_DB_FILES.map((path) => new URL(path, base).toString());

    await Promise.all(absoluteUrls.map(async (url) => {
        try {
            await fetch(url, { cache: "reload" });
        } catch {
            // Retry on next install/open.
        }
    }));

    if ("serviceWorker" in navigator) {
        try {
            const registration = await navigator.serviceWorker.ready;
            registration.active?.postMessage({ type: "CACHE_DB_NOW" });
        } catch {
            // Ignore if service worker is not active yet.
        }
    }

    addLocalEvent("Database offline dipersiapkan agar akses PWA lebih cepat.");
}

async function registerPwaServiceWorker(): Promise<void> {
    if (!("serviceWorker" in navigator)) {
        return;
    }

    try {
        const base = new URL(import.meta.env.BASE_URL, window.location.origin);
        const swUrl = new URL("sw.js", base).toString();
        await navigator.serviceWorker.register(swUrl, { scope: base.pathname });
    } catch {
        addLocalEvent("Service worker gagal didaftarkan. Mode offline terbatas.");
    }
}

function setupPwaSupport(): void {
    if (pwaListenersBound) {
        return;
    }
    pwaListenersBound = true;

    void registerPwaServiceWorker();

    window.addEventListener("beforeinstallprompt", (event) => {
        event.preventDefault();
        deferredInstallPrompt = event as DeferredInstallPromptEvent;
        updateInstallButtonState();
        addLocalEvent("Install PWA siap. Gunakan tombol INSTALL APP.");
    });

    window.addEventListener("appinstalled", () => {
        pwaInstalled = true;
        deferredInstallPrompt = null;
        updateInstallButtonState();
        addLocalEvent("PWA terpasang. Mulai sinkronisasi database offline.");
        void predownloadOfflineDatabaseAssets();
    });

    if (pwaInstalled) {
        void predownloadOfflineDatabaseAssets();
    }

    updateInstallButtonState();
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
    applyRendererPixelRatioCaps();
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
            const nearBoost = clamp(1.3 - zoomFactor / 1200, 0.96, 1.24);
            const focusBoost = body.name === uiState.focusName ? 1.08 : 1;
            const earthBoost = body.name === "Bumi" ? 1.08 : 1;
            return clamp(base * nearBoost * focusBoost * earthBoost, 0.12, 0.98);
        }
        return base;
    }

    if (body.kind === "moon") {
        const base = clamp(0.05 + (logRadius - 5.15) * 0.11, 0.028, 0.24);
        if (isSolarSystemBody(body)) {
            const nearBoost = clamp(1.22 - zoomFactor / 1750, 0.9, 1.18);
            const focusBoost = body.name === uiState.focusName
                ? 1.12
                : body.parentName === uiState.focusName
                    ? 1.08
                    : 1;
            let radius = base * nearBoost * focusBoost;

            if (body.parentName) {
                const parent = findExistingBodyByName(body.parentName);
                if (parent && parent.name !== body.name && parent.kind !== "moon") {
                    const parentRadius = toRenderRadius(parent, zoomSpan);
                    if (body.name === "Bulan" && body.parentName === "Bumi") {
                        radius = clamp(radius, parentRadius * 0.2, parentRadius * 0.36);
                    } else {
                        radius = Math.min(radius, parentRadius * 0.52);
                    }
                }
            }

            return clamp(radius, 0.028, 0.46);
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

    if (body.kind === "meteor") {
        const base = clamp(0.07 + (logRadius - 3.3) * 0.14, 0.05, 0.28);
        if (body.parentName && solarSystemAnchors.has(body.parentName)) {
            const parentFocusBoost = body.parentName === uiState.focusName ? 2.4 : 2.0;
            return clamp(base * parentFocusBoost, 0.11, 0.58);
        }
        return base;
    }

    if (body.kind === "comet") {
        const base = clamp(0.08 + (logRadius - 3.6) * 0.16, 0.06, 0.32);
        if (body.parentName && solarSystemAnchors.has(body.parentName)) {
            const parentFocusBoost = body.parentName === uiState.focusName ? 2.2 : 1.9;
            return clamp(base * parentFocusBoost, 0.12, 0.64);
        }
        return base;
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

        const structureBody = body.kind === "galaxy" || body.kind === "cluster" || body.kind === "nebula";
        const focusSolar = !!(focusBody && isSolarSystemBody(focusBody));

        if (focusSolar) {
            if (solarBody) {
                if (body.kind === "star") {
                    return distanceFromFocus < (zoomSpan < 700 ? 2800 : 9000);
                }
                if (body.kind === "planet" || body.kind === "moon") {
                    const cap = zoomSpan < 220 ? 900 : zoomSpan < 700 ? 2800 : zoomSpan < 1400 ? 9000 : 18000;
                    return distanceFromFocus < cap;
                }
                if (bodyLooksRocky(body) || bodyLooksComet(body) || body.kind === "meteor") {
                    const cap = zoomSpan < 220 ? 620 : zoomSpan < 700 ? 1800 : zoomSpan < 1400 ? 6200 : 14000;
                    return distanceFromFocus < cap;
                }
                return distanceFromFocus < (zoomSpan < 1400 ? 9000 : 22000);
            }

            if (structureBody || branch.ancestor) {
                if (zoomSpan < 1250) {
                    return false;
                }
                if (zoomSpan < 2100) {
                    return body.name === structureRoot.name && body.kind === "galaxy";
                }
                if (body.kind === "cluster") {
                    return zoomSpan >= 2400;
                }
                if (body.kind === "nebula") {
                    return zoomSpan >= 3000;
                }
                return true;
            }

            if (body.kind === "star" || body.kind === "black-hole") {
                if (zoomSpan < 760) {
                    return false;
                }
                if (zoomSpan < 1500) {
                    return distanceFromFocus < 2200;
                }
                return distanceFromFocus < 9000;
            }

            if (body.kind === "planet" || body.kind === "moon") {
                const cap = zoomSpan < 260 ? 460 : zoomSpan < 700 ? 1300 : zoomSpan < 1500 ? 3300 : 6800;
                return distanceFromFocus < cap;
            }

            if (bodyLooksRocky(body) || bodyLooksComet(body) || body.kind === "meteor") {
                const cap = zoomSpan < 260 ? 290 : zoomSpan < 700 ? 860 : zoomSpan < 1500 ? 2300 : 5200;
                return distanceFromFocus < cap;
            }

            return distanceFromFocus < (zoomSpan < 1500 ? 6200 : 14000);
        }

        if (zoomSpan < 160) {
            if (branch.ancestor) {
                return body.kind === "cluster" || body.kind === "galaxy";
            }
            if (structureBody && body.name !== structureRoot.name) {
                return false;
            }
            if (body.kind === "planet" || body.kind === "moon") {
                return branch.descendant && distanceFromFocus < 420;
            }
            if (bodyLooksRocky(body) || bodyLooksComet(body) || body.kind === "meteor") {
                return branch.descendant && distanceFromFocus < 260;
            }
            if (body.kind === "star" || body.kind === "black-hole") {
                return branch.descendant && distanceFromFocus < 760;
            }
            return branch.descendant;
        }

        if (zoomSpan < 620) {
            if (bodyLooksRocky(body) || bodyLooksComet(body) || body.kind === "meteor") {
                return branch.descendant && distanceFromFocus < 760;
            }
            if (body.kind === "planet" || body.kind === "moon") {
                return branch.descendant && distanceFromFocus < 1300;
            }
            return true;
        }

        if (zoomSpan < 2200) {
            if (body.kind === "planet" || body.kind === "moon" || bodyLooksRocky(body) || bodyLooksComet(body) || body.kind === "meteor") {
                return branch.descendant && distanceFromFocus < 5600;
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
infoPreviewRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, infoPreviewPixelRatioCap));
infoPreviewRenderer.outputColorSpace = THREE.SRGBColorSpace;
infoPreviewRenderer.setClearColor(0x000000, 0);

function applyRendererPixelRatioCaps(): void {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, rendererPixelRatioCap));
    infoPreviewRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, infoPreviewPixelRatioCap));
}

function persistRuntimeProfile(profile: RuntimeProfile): void {
    try {
        window.localStorage.setItem(RUNTIME_PROFILE_STORAGE_KEY, profile);
    } catch {
        // Ignore storage errors in privacy mode.
    }
}

function loadRuntimeProfile(): RuntimeProfile {
    try {
        return window.localStorage.getItem(RUNTIME_PROFILE_STORAGE_KEY) === "low-lag"
            ? "low-lag"
            : "default";
    } catch {
        return "default";
    }
}

function activateLowLagProfile(reason: string): void {
    if (lowLagModeActive) {
        return;
    }

    lowLagModeActive = true;
    rendererPixelRatioCap = 1.25;
    infoPreviewPixelRatioCap = 1.1;
    dynamicSimStepMs = 72;
    dynamicHudIntervalMs = 240;
    dynamicEventsIntervalMs = 620;
    dynamicSpawnIntervalMs = 8500;
    dynamicTrailPointLimit = 140;
    dynamicLabelLimitCompact = 7;
    dynamicLabelLimitWide = 12;

    applyRendererPixelRatioCaps();
    setCanvasSize();
    persistRuntimeProfile("low-lag");
    addLocalEvent(`Mode anti-lag aktif (${reason}).`);
}

function restoreRuntimeProfileFromStorage(): void {
    const profile = loadRuntimeProfile();
    if (profile === "low-lag") {
        activateLowLagProfile("profil tersimpan");
    }
}

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

    if (body.kind === "meteor") {
        return true;
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
        "Phobos (Mars)",
        "Deimos (Mars)",
        "Io (Jupiter)",
        "Europa (Jupiter)",
        "Ganymede (Jupiter)",
        "Callisto (Jupiter)",
        "Titan (Saturnus)",
        "Enceladus (Saturnus)",
        "Triton (Neptunus)",
    ]);

    if (priorityNames.has(body.name)) {
        return true;
    }

    if (body.kind === "moon" && body.parentName && solarSystemAnchors.has(body.parentName)) {
        const zoom = cameraZoomSpan();
        if (body.name === uiState.focusName) {
            return true;
        }
        if (body.parentName === uiState.focusName) {
            return zoom < 720;
        }
        return zoom < 260;
    }

    if ((body.kind === "comet" || body.kind === "meteor") && body.parentName && solarSystemAnchors.has(body.parentName)) {
        return body.parentName === uiState.focusName || body.name === uiState.focusName;
    }

    return body.name === uiState.focusName || body.kind === "black-hole";
}

type LabelDeclutterEntry = {
    node: BodyNode;
    screenX: number;
    screenY: number;
    radiusPx: number;
    score: number;
};

function labelPriorityScore(body: UniverseBody): number {
    let score = 0;
    if (body.name === uiState.focusName) score += 200;
    if (body.name === "Matahari") score += 180;
    if (body.kind === "black-hole") score += 170;
    if (body.parentName === uiState.focusName) score += 120;
    if (body.kind === "planet") score += 70;
    if (body.kind === "moon") score += 40;
    return score;
}

function applySmartLabelDeclutter(nodes: BodyNode[]): void {
    const width = Math.max(renderer.domElement.clientWidth, 1);
    const height = Math.max(renderer.domElement.clientHeight, 1);
    const candidates: LabelDeclutterEntry[] = [];

    for (const node of nodes) {
        if (!node.label || !node.label.visible || !node.mesh.visible) {
            continue;
        }

        const projected = node.mesh.position.clone().project(camera);
        if (projected.z < -1 || projected.z > 1) {
            node.label.visible = false;
            continue;
        }

        const screenX = (projected.x * 0.5 + 0.5) * width;
        const screenY = (-projected.y * 0.5 + 0.5) * height;
        const radiusPx = node.body.kind === "moon" ? 38 : 52;
        const distancePenalty = camera.position.distanceTo(node.mesh.position) * 0.03;

        candidates.push({
            node,
            screenX,
            screenY,
            radiusPx,
            score: labelPriorityScore(node.body) - distancePenalty,
        });
    }

    candidates.sort((a, b) => b.score - a.score);
    const kept: LabelDeclutterEntry[] = [];
    const maxLabels = width < 900 ? dynamicLabelLimitCompact : dynamicLabelLimitWide;

    for (const entry of candidates) {
        const mustKeep = entry.node.body.name === uiState.focusName || entry.node.body.name === "Matahari";
        const overlaps = kept.some((placed) => {
            const dx = Math.abs(entry.screenX - placed.screenX);
            const dy = Math.abs(entry.screenY - placed.screenY);
            return dx < (entry.radiusPx + placed.radiusPx) * 0.72 && dy < 22;
        });

        if (!mustKeep && (overlaps || kept.length >= maxLabels)) {
            if (entry.node.label) {
                entry.node.label.visible = false;
            }
            continue;
        }

        kept.push(entry);
    }
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
    } else if (body.kind === "comet") {
        fillRadial("#d9e7f7", "#4e6d8a");
        ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
        ctx.beginPath();
        ctx.ellipse(108, 108, 56, 44, -0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(126, 166, 218, 0.4)";
        for (let i = 0; i < 9; i += 1) {
            ctx.beginPath();
            ctx.ellipse(
                98 + i * 14,
                122 + ((i % 3) - 1) * 8,
                16 + i * 2,
                6 + (i % 4),
                -0.22,
                0,
                Math.PI * 2,
            );
            ctx.fill();
        }
        ctx.fillStyle = "rgba(92, 102, 114, 0.54)";
        for (let i = 0; i < 11; i += 1) {
            ctx.beginPath();
            ctx.arc(((seed + i * 19) % 194) + 28, ((seed + i * 27) % 180) + 34, 3 + (i % 4), 0, Math.PI * 2);
            ctx.fill();
        }
    } else if (body.kind === "meteor") {
        fillRadial("#bea588", "#665041");
        ctx.fillStyle = "rgba(72, 54, 44, 0.5)";
        for (let i = 0; i < 18; i += 1) {
            ctx.beginPath();
            ctx.arc(((seed + i * 17) % 210) + 20, ((seed + i * 31) % 210) + 20, 4 + (i % 5), 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.strokeStyle = "rgba(160, 136, 106, 0.34)";
        ctx.lineWidth = 2;
        for (let i = 0; i < 7; i += 1) {
            const sx = seededRange(body.name, 990 + i, 18, 238);
            const sy = seededRange(body.name, 1090 + i, 18, 238);
            const ex = seededRange(body.name, 1190 + i, 18, 238);
            const ey = seededRange(body.name, 1290 + i, 18, 238);
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(ex, ey);
            ctx.stroke();
        }
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

    let geometry: THREE.BufferGeometry;
    if (body.kind === "meteor") {
        geometry = new THREE.DodecahedronGeometry(1, 0);
    } else if (body.kind === "comet") {
        geometry = new THREE.IcosahedronGeometry(1, 0);
    } else {
        geometry = new THREE.SphereGeometry(1, detail, detail);
    }
    const texture = textureForBody(body);
    const material = new THREE.MeshStandardMaterial({
        color,
        map: texture,
        roughness: diffuseStructure ? 0.94 : body.kind === "star" ? 0.22 : body.kind === "meteor" ? 0.92 : body.kind === "comet" ? 0.84 : 0.66,
        metalness: diffuseStructure ? 0.01 : body.kind === "black-hole" ? 0.42 : body.kind === "meteor" ? 0.03 : 0.07,
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
    if (body.kind === "meteor" || body.kind === "comet") {
        mesh.rotation.y = ((hashString(body.name) % 360) * Math.PI) / 180;
    }
    mesh.userData.bodyKey = key;
    scene.add(mesh);

    const extras: THREE.Object3D[] = [];
    if (body.kind === "comet") {
        const coma = new THREE.Mesh(
            new THREE.SphereGeometry(1, 16, 16),
            new THREE.MeshBasicMaterial({
                color: 0xbadfff,
                transparent: true,
                opacity: 0.16,
                depthWrite: false,
                blending: THREE.NormalBlending,
            }),
        );
        coma.userData.cometRole = "coma";
        scene.add(coma);
        extras.push(coma);

        const tail = new THREE.Mesh(
            new THREE.ConeGeometry(0.72, 4.6, 16, 1, true),
            new THREE.MeshBasicMaterial({
                color: 0x9fd9ff,
                transparent: true,
                opacity: 0.2,
                side: THREE.DoubleSide,
                depthWrite: false,
                blending: THREE.NormalBlending,
            }),
        );
        tail.userData.cometRole = "tail";
        scene.add(tail);
        extras.push(tail);
    }

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
        extras,
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

    node.extras.forEach((extra) => {
        scene.remove(extra);
        if (extra instanceof THREE.Mesh) {
            extra.geometry.dispose();
            const mat = extra.material;
            if (Array.isArray(mat)) {
                mat.forEach((m: THREE.Material) => m.dispose());
            } else {
                mat.dispose();
            }
        }
    });

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

    const ordered = [...major, ...small, ...context, ...nasaBodies];
    const seenKeys = new Set<string>();
    const uniqueBodies: UniverseBody[] = [];

    for (const body of ordered) {
        if (!shouldRenderBody(body)) {
            continue;
        }

        const key = bodyKey(body);
        if (seenKeys.has(key)) {
            continue;
        }

        seenKeys.add(key);
        uniqueBodies.push(body);
    }

    return uniqueBodies;
}

function updateCometExtras(node: BodyNode, body: UniverseBody, position: THREE.Vector3, radius: number): void {
    if (body.kind !== "comet" || node.extras.length === 0) {
        return;
    }

    const coma = node.extras.find((extra) => extra.userData.cometRole === "coma") as THREE.Mesh | undefined;
    const tail = node.extras.find((extra) => extra.userData.cometRole === "tail") as THREE.Mesh | undefined;
    if (!coma || !tail) {
        return;
    }

    const showCometFX = (body.name === uiState.focusName || body.parentName === uiState.focusName) && viewState.showComets;
    coma.visible = showCometFX;
    tail.visible = showCometFX;
    if (!showCometFX || !node.mesh.visible) {
        return;
    }

    const sun = bodyByNameAny("Matahari");
    let awayVector = new THREE.Vector3(0, 1, 0);
    if (sun) {
        awayVector.set(
            body.position.x - sun.position.x,
            body.position.y - sun.position.y,
            body.position.z - sun.position.z,
        );
    }
    if (awayVector.lengthSq() < 1e-12) {
        awayVector.set(body.velocity.x, body.velocity.y, body.velocity.z);
    }
    if (awayVector.lengthSq() < 1e-12) {
        awayVector.set(0, 1, 0);
    }
    awayVector.normalize();

    const speed = Math.max(Math.hypot(body.velocity.x, body.velocity.y, body.velocity.z), 1);
    const sunDistanceAu = sun
        ? Math.max(
            Math.hypot(
                body.position.x - sun.position.x,
                body.position.y - sun.position.y,
                body.position.z - sun.position.z,
            ) / constants.auMeters,
            0.08,
        )
        : 1;

    const tailBoost = clamp(1.4 + speed / 18000 + 1 / Math.sqrt(sunDistanceAu), 1.6, 4.4);
    const comaScale = radius * clamp(1.9 + tailBoost * 0.12, 1.9, 3.4);
    const tailLength = radius * clamp(2.2 + tailBoost * 0.55, 2.7, 9.2);
    const tailRadius = radius * clamp(0.62 + tailBoost * 0.11, 0.68, 1.8);

    coma.position.copy(position);
    coma.scale.setScalar(comaScale);
    const comaMaterial = coma.material as THREE.MeshBasicMaterial;
    comaMaterial.opacity = clamp(0.24 - sunDistanceAu * 0.02, 0.08, 0.22);

    tail.position.copy(position).addScaledVector(awayVector, radius * 1.1 + tailLength * 0.48);
    tail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), awayVector);
    tail.scale.set(tailRadius, tailLength, tailRadius);
    const tailMaterial = tail.material as THREE.MeshBasicMaterial;
    tailMaterial.opacity = clamp(0.3 - sunDistanceAu * 0.02, 0.08, 0.24);
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
    const focusIsSolar = !!(focusBody && isSolarSystemBody(focusBody));
    const labelCandidates: BodyNode[] = [];

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
            if (body.kind === "meteor") {
                node.mesh.scale.set(radius * 1.55, radius * 1.16, radius * 1.34);
            } else if (body.kind === "comet") {
                node.mesh.scale.set(radius * 1.34, radius * 1.05, radius * 1.18);
            } else {
                node.mesh.scale.setScalar(radius);
            }
        }

        const visibleByZoom = shouldDisplayBodyAtZoom(body, key, position, focusPosition, zoomSpan, focusBody, bodyIndex, structureRoot);
        node.mesh.visible = visibleByZoom;
        node.extras.forEach((extra) => {
            extra.visible = visibleByZoom;
        });
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
            let structureOpacity = body.kind === "galaxy" ? 0.42 : body.kind === "cluster" ? 0.34 : 0.28;
            if (focusIsSolar) {
                if (body.kind === "galaxy") {
                    structureOpacity *= clamp((zoomSpan - 1050) / 920, 0, 1);
                } else if (body.kind === "cluster") {
                    structureOpacity *= clamp((zoomSpan - 2000) / 1000, 0, 1);
                } else {
                    structureOpacity *= clamp((zoomSpan - 2500) / 1200, 0, 1);
                }
            }
            meshMaterial.opacity = structureOpacity;
            if (structureOpacity < 0.012) {
                node.mesh.visible = false;
                if (node.ring) {
                    node.ring.visible = false;
                }
                if (node.label) {
                    node.label.visible = false;
                }
                if (node.trail) {
                    node.trail.visible = false;
                }
                continue;
            }
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
        } else if (body.kind === "comet") {
            meshMaterial.emissive = new THREE.Color(nextColor).multiplyScalar(0.16);
        } else if (body.kind === "meteor") {
            meshMaterial.emissive = new THREE.Color(nextColor).multiplyScalar(0.08);
        } else {
            meshMaterial.emissive = new THREE.Color(0x000000);
        }

        updateCometExtras(node, body, position, radius);

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
            if (node.label.visible) {
                labelCandidates.push(node);
            }
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
            if (node.trailPoints.length > dynamicTrailPointLimit) {
                node.trailPoints.splice(0, node.trailPoints.length - dynamicTrailPointLimit);
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

    applySmartLabelDeclutter(labelCandidates);

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
    const major = engine.getMajorBodies().find((body) => body.name === name && body.alive);
    if (major) {
        return major;
    }

    const small = engine.getSmallBodies().find((body) => body.name === name && body.alive);
    if (small) {
        return small;
    }

    const context = engine.getContextBodies().find((body) => body.name === name && body.alive);
    if (context) {
        return context;
    }

    const catalog = nasaCatalogBodies.find((body) => body.name === name && body.alive);
    if (catalog) {
        return catalog;
    }

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
        resetInfoArCard();
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
    void updateInfoArCard(body);

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

function formatOrbitDistance(distanceMeters: number): string {
    const safe = Math.max(distanceMeters, 0);
    const au = safe / constants.auMeters;
    if (au < 0.02) {
        return `${(safe / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })} km`;
    }
    if (au < 3000) {
        return `${au.toFixed(3)} AU`;
    }

    const ly = safe / LIGHT_YEAR_METERS;
    if (ly < 1000) {
        return `${ly.toFixed(3)} ly`;
    }
    if (ly < 1_000_000) {
        return `${(ly / 1000).toFixed(3)} kly`;
    }
    return `${(ly / 1_000_000).toFixed(3)} Mly`;
}

type ArMarkerProfile = {
    markerLabel: string;
    markerHint: string;
    markerImageUrl: string;
};

function markerProfileForObject(objectName?: string): ArMarkerProfile {
    return {
        markerLabel: "Hiro",
        markerHint: "marker Hiro",
        markerImageUrl: HIRO_MARKER_URL,
    };
}

function applyMarkerProfileToInfoUi(profile: ArMarkerProfile): void {
    infoPreviewMarker.src = profile.markerImageUrl;
    infoPreviewMarker.alt = `Marker ${profile.markerLabel}`;
}

function arViewerUrlForObject(objectName?: string): string {
    const baseUrl = new URL(".", window.location.href);
    const arUrl = new URL("ar-view.html", baseUrl);
    const trimmed = objectName?.trim();
    if (trimmed) {
        arUrl.searchParams.set("model", trimmed);
    }
    arUrl.searchParams.set("from", "qr");
    arUrl.searchParams.set("build", APP_BUILD_HASH);
    return arUrl.toString();
}

function resetInfoArCard(): void {
    const profile = markerProfileForObject();
    infoArQrCurrentUrl = "";
    infoArQrPendingUrl = "";
    infoArQrRenderToken += 1;
    infoArCard.classList.remove("is-loading");
    infoArCard.classList.remove("is-open");
    infoArQr.removeAttribute("src");
    infoArQr.alt = "QR AR belum tersedia";
    applyMarkerProfileToInfoUi(profile);
    infoArTrigger.title = `QR AR + ${profile.markerLabel}`;
    infoArTrigger.setAttribute("aria-label", `Lihat QR AR dan ${profile.markerHint}`);
    infoArCaption.textContent = "Hover/click ikon AR, scan QR, lalu gunakan marker objek.";
    infoArLink.textContent = "Buka AR di HP";
    infoArLink.href = arViewerUrlForObject();
}

async function updateInfoArCard(body: UniverseBody): Promise<void> {
    const arUrl = arViewerUrlForObject(body.name);
    const profile = markerProfileForObject(body.name);
    infoArLink.href = arUrl;
    infoArLink.textContent = `Buka AR ${body.name}`;
    applyMarkerProfileToInfoUi(profile);
    infoArTrigger.title = `QR AR + ${profile.markerLabel}`;
    infoArTrigger.setAttribute("aria-label", `Lihat QR AR ${body.name} dan ${profile.markerHint}`);
    infoArCaption.textContent = `Scan QR HP, lalu arahkan ke ${profile.markerHint}.`;
    infoArQr.alt = `QR AR untuk ${body.name}`;

    if (infoArQrCurrentUrl === arUrl && !!infoArQr.getAttribute("src")) {
        return;
    }
    if (infoArQrPendingUrl === arUrl) {
        return;
    }

    infoArQrPendingUrl = arUrl;
    infoArCard.classList.add("is-loading");
    const token = ++infoArQrRenderToken;
    try {
        const qrDataUrl = await QRCode.toDataURL(arUrl, {
            width: 152,
            margin: 1,
            errorCorrectionLevel: "M",
            color: {
                dark: "#082557",
                light: "#f6f9ff",
            },
        });

        if (token !== infoArQrRenderToken) {
            return;
        }

        infoArQrPendingUrl = "";
        infoArQr.src = qrDataUrl;
        infoArQrCurrentUrl = arUrl;
        infoArCard.classList.remove("is-loading");
    } catch {
        if (token !== infoArQrRenderToken) {
            return;
        }
        infoArQrPendingUrl = "";
        infoArCard.classList.remove("is-loading");
        infoArCaption.textContent = "QR gagal dibuat. Gunakan tombol Buka AR di HP.";
    }
}

function fallbackParentNameForBody(body: UniverseBody): string | null {
    if (body.parentName) {
        return body.parentName;
    }

    if (body.name === "Matahari" && bodyByNameAny("Bima Sakti")) {
        return "Bima Sakti";
    }
    if (body.kind === "galaxy" && bodyByNameAny("Grup Lokal")) {
        return "Grup Lokal";
    }
    if (body.kind === "cluster" && body.name !== "Laniakea" && bodyByNameAny("Laniakea")) {
        return "Laniakea";
    }
    return null;
}

function hoverCardBody(): UniverseBody | null {
    if (uiState.pointedKey) {
        return bodyNodes.get(uiState.pointedKey)?.body ?? null;
    }
    return null;
}

function updateHoverCard(): void {
    const body = hoverCardBody();
    if (!uiState.pointerInsideCanvas || !body) {
        hoverCard.classList.add("is-hidden");
        return;
    }

    const parentName = fallbackParentNameForBody(body);
    const parentBody = parentName ? bodyByNameAny(parentName) : null;
    const orbitDistanceMeters = parentBody
        ? Math.hypot(
            body.position.x - parentBody.position.x,
            body.position.y - parentBody.position.y,
            body.position.z - parentBody.position.z,
        )
        : null;

    hoverCardName.textContent = `${body.name} [${body.kind}]`;
    hoverCardParent.textContent = `Orbit ke: ${parentName ?? "root / tanpa parent"}`;
    hoverCardDistance.textContent = orbitDistanceMeters === null
        ? "Jarak orbit: n/a"
        : `Jarak orbit: ${formatOrbitDistance(orbitDistanceMeters)}`;

    hoverCard.classList.remove("is-hidden");

    const cardWidth = hoverCard.offsetWidth || 260;
    const cardHeight = hoverCard.offsetHeight || 108;
    const pad = 16;
    let left = uiState.pointerClientX + pad;
    let top = uiState.pointerClientY + pad;

    if (left + cardWidth > window.innerWidth - 8) {
        left = uiState.pointerClientX - cardWidth - pad;
    }
    if (top + cardHeight > window.innerHeight - 8) {
        top = uiState.pointerClientY - cardHeight - pad;
    }

    left = clamp(left, 8, Math.max(8, window.innerWidth - cardWidth - 8));
    top = clamp(top, 8, Math.max(8, window.innerHeight - cardHeight - 8));

    hoverCard.style.left = `${left}px`;
    hoverCard.style.top = `${top}px`;
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
    deviceAccessButton.textContent = t.deviceAccess;
    deviceAccessButton.title = t.deviceAccessHint;
    helpButton.textContent = uiState.showHelp ? t.helpOn : t.helpOff;
    languageButton.textContent = t.lang;
    bottomHint.textContent = t.bottomHint;
    searchInput.placeholder = t.searchPlaceholder;
    updateInstallButtonState();
}

function updatePanelVisibility(): void {
    searchPanel.classList.toggle("is-hidden", !uiState.showSearch);
    helpPanel.classList.toggle("is-hidden", !uiState.showHelp);
    if (!uiState.showInfo) {
        infoPanel.classList.remove("is-visible");
    }
}

function currentNodeTargets(): BodyNode[] {
    return Array.from(bodyNodes.values())
        .filter((node) => node.mesh.visible);
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
    let fallbackKey: string | null = null;
    let fallbackDistance = Number.POSITIVE_INFINITY;
    const zoomSpan = cameraZoomSpan();
    const maxNdcDistance = zoomSpan < 120 ? 0.14 : zoomSpan < 500 ? 0.11 : 0.085;

    for (const node of candidates) {
        const projected = node.mesh.position.clone().project(camera);
        if (projected.z < -1 || projected.z > 1) {
            continue;
        }

        const dx = projected.x - pointer.x;
        const dy = projected.y - pointer.y;
        const ndcDistance = Math.hypot(dx, dy);
        if (ndcDistance < fallbackDistance) {
            fallbackDistance = ndcDistance;
            fallbackKey = node.key;
        }
        const distanceCamera = Math.max(camera.position.distanceTo(node.mesh.position), 1);
        const worldRadius = Math.max(node.mesh.scale.length() / Math.sqrt(3), 0.04);
        const projectedRadiusNdc = clamp((worldRadius / distanceCamera) * 6.2, 0.012, 0.11);
        const allowedNdc = Math.max(maxNdcDistance, projectedRadiusNdc * 3.0);
        if (ndcDistance > allowedNdc) {
            continue;
        }

        const shellPenalty = node.mesh.userData.structureShell === true
            ? (zoomSpan < 220 ? 0.03 : 0.012)
            : 0;
        const score = (ndcDistance / Math.max(allowedNdc, 1e-6)) + (projected.z + 1) * 0.002 + shellPenalty;
        if (score < bestScore) {
            bestScore = score;
            bestKey = node.key;
        }
    }

    if (bestKey) {
        return bestKey;
    }

    if (fallbackKey && fallbackDistance < 0.21) {
        return fallbackKey;
    }

    return null;
}

function updateHoverByRaycast(): void {
    if (pointer.x > 1 || pointer.y > 1) {
        if (!uiState.infoPinned) {
            uiState.hoverKey = null;
        }
        uiState.pointedKey = null;
        canvas.style.cursor = "default";
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
    uiState.pointedKey = key;

    if (!uiState.infoPinned) {
        uiState.hoverKey = key;
    }
    canvas.style.cursor = key ? "pointer" : "default";
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

    installButton.addEventListener("click", async () => {
        if (pwaInstalled) {
            void predownloadOfflineDatabaseAssets();
            return;
        }

        if (!deferredInstallPrompt) {
            addLocalEvent(installHintText());
            return;
        }

        const permissionCapabilities = await requestInstallAccessPermissions();
        addLocalEvent(permissionReportLines(permissionCapabilities).join(" | "));
        await applyPermissionDrivenOptimizations(permissionCapabilities, "akses install");

        const promptEvent = deferredInstallPrompt;
        deferredInstallPrompt = null;
        updateInstallButtonState();

        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;

        if (choice.outcome === "accepted") {
            addLocalEvent("Install PWA disetujui. Menyiapkan cache offline.");
            void predownloadOfflineDatabaseAssets();
        } else {
            addLocalEvent("Install PWA dibatalkan oleh pengguna.");
        }

        updateInstallButtonState();
    });

    deviceAccessButton.addEventListener("click", async () => {
        deviceAccessButton.disabled = true;
        try {
            const permissionCapabilities = await requestInstallAccessPermissions();
            addLocalEvent(permissionReportLines(permissionCapabilities).join(" | "));
            await applyPermissionDrivenOptimizations(permissionCapabilities, "akses manual");
        } finally {
            deviceAccessButton.disabled = false;
            updateActionButtons();
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

    infoArTrigger.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        infoArCard.classList.toggle("is-open");
    });

    infoArCard.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
    });

    document.addEventListener("pointerdown", (event) => {
        const target = event.target;
        if (!(target instanceof Node)) {
            return;
        }
        if (infoArCard.contains(target) || infoArTrigger.contains(target)) {
            return;
        }
        infoArCard.classList.remove("is-open");
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
        uiState.pointerClientX = event.clientX;
        uiState.pointerClientY = event.clientY;
        uiState.pointerInsideCanvas = true;
    });

    canvas.addEventListener("pointerleave", () => {
        pointer.x = 2;
        pointer.y = 2;
        uiState.pointerInsideCanvas = false;
        uiState.pointedKey = null;
        if (!uiState.infoPinned) {
            uiState.hoverKey = null;
            updateInfoPanel();
        }
        updateHoverCard();
    });

    canvas.addEventListener("click", () => {
        const targetKey = uiState.pointedKey ?? uiState.hoverKey;
        if (targetKey) {
            const hoveredBody = bodyNodes.get(targetKey)?.body;
            if (hoveredBody) {
                const selectedBody = normalizeClickedFocusBody(hoveredBody);
                const preferredDistance = preferredFocusDistance(selectedBody);
                setFocusBody(selectedBody, { pinInfo: true, preferredDistance, durationMs: 760 });
            } else {
                uiState.selectedKey = targetKey;
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
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && lowLagModeActive) {
            void requestScreenWakeLockPermission();
        }
    });
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

function animate(now: number): void {
    const dtMs = now - lastFrame;
    lastFrame = now;

    starfield.rotation.y += 0.000032;

    if (uiState.running) {
        simAccumulator += dtMs;
        spawnAccumulator += dtMs;

        while (simAccumulator >= dynamicSimStepMs) {
            engine.step(2);
            simAccumulator -= dynamicSimStepMs;
        }

        if (spawnAccumulator >= dynamicSpawnIntervalMs) {
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

    stabilizeMajorMoonOrbits();
    updateDynamicCatalogBodies(dtMs);
    updateNodes(dtMs);
    rebuildOrbitGuides();
    updateHoverByRaycast();
    updateHoverCard();
    updateFocusTarget();
    updateCameraFlight(now);
    updateEventPulses(dtMs);

    controls.update();
    renderer.render(scene, camera);
    animateInfoPreview(dtMs);

    hudAccumulator += dtMs;
    if (hudAccumulator >= dynamicHudIntervalMs) {
        updateHudPanel();
        updateInfoPanel();
        hudAccumulator = 0;
    }

    eventsAccumulator += dtMs;
    if (eventsAccumulator >= dynamicEventsIntervalMs) {
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
    setupPwaSupport();
    restoreRuntimeProfileFromStorage();

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
