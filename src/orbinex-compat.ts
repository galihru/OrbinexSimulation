import {
    constants as npmConstants,
    circularOrbitSpeed,
    createOrbitSample,
    equatorialToCartesian,
    generateSimulationReport,
    orbitalPeriodFromSemiMajorAxis,
} from "@galihru/orbinex";

export const constants = Object.freeze({
    ...npmConstants,
    parsecMeters: npmConstants.parsecMeters,
    lightYearMeters: 9.4607304725808e15,
    speedOfLightMps: 299792458,
});

const YEAR_SECONDS = 365.25 * 86400;

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function assertPositiveFinite(value: number, name: string): void {
    if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive finite number`);
    }
}

function vec3(x = 0, y = 0, z = 0): Vector3 {
    return { x, y, z };
}

function cloneVec3(v: Vector3): Vector3 {
    return { x: v.x, y: v.y, z: v.z };
}

function addVec3(a: Vector3, b: Vector3): Vector3 {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subVec3(a: Vector3, b: Vector3): Vector3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scaleVec3(v: Vector3, k: number): Vector3 {
    return { x: v.x * k, y: v.y * k, z: v.z * k };
}

function magVec3(v: Vector3): number {
    return Math.hypot(v.x, v.y, v.z);
}

function normalizeVec3(v: Vector3): Vector3 {
    const m = magVec3(v);
    if (m <= 1e-15) {
        return vec3();
    }
    return scaleVec3(v, 1 / m);
}

export function gravitationalParameter(primaryMassKg: number, g = constants.gravitationalConstant): number {
    assertPositiveFinite(primaryMassKg, "primaryMassKg");
    assertPositiveFinite(g, "g");
    return g * primaryMassKg;
}

export interface Vector3 {
    x: number;
    y: number;
    z: number;
}

export type UniverseBodyKind =
    | "star"
    | "planet"
    | "moon"
    | "dwarf"
    | "meteor"
    | "comet"
    | "black-hole"
    | "galaxy"
    | "cluster"
    | "nebula"
    | "hypothesis"
    | "other";

export interface UniverseBody {
    name: string;
    kind: UniverseBodyKind;
    massKg: number;
    radiusMeters: number;
    colorHex: string;
    position: Vector3;
    velocity: Vector3;
    alive: boolean;
    parentName: string | null;
    isHypothesis: boolean;
}

export interface UniverseSimulationEvent {
    id: number;
    kind: string;
    message: string;
    timeYears: number;
    location: Vector3;
    bodyA: string;
    bodyB: string;
    relSpeedMps: number;
}

export interface UniverseForecast {
    kind: string;
    message: string;
    etaYears: number;
    bodyA: string;
    bodyB: string;
    confidence: number;
}

export interface UniverseRecommendation {
    priority: "critical" | "high" | "medium";
    title: string;
    action: string;
    rationale: string;
    relatedBodies: string[];
}

export interface UniverseCounts {
    majorBodies: number;
    smallBodies: number;
    contextBodies: number;
    allBodies: number;
    terrestrial: number;
    jovian: number;
    dwarf: number;
    moon: number;
    asteroid: number;
    kuiper: number;
    comet: number;
    meteor: number;
    blackHole: number;
    nebula: number;
    galaxy: number;
    onlineCatalog: number;
}

export interface UniverseStateSnapshot {
    yearsElapsed: number;
    simulatedSeconds: number;
    paused: boolean;
    baseDtSeconds: number;
    timeScale: number;
    speedOfLightSimulationMps: number;
    collisionCount: number;
    counts: UniverseCounts;
    latestEvents: UniverseSimulationEvent[];
    latestForecasts: UniverseForecast[];
}

export interface UniverseStepSummary {
    performedSteps: number;
    simulatedSeconds: number;
    yearsElapsed: number;
    bodyCount: number;
    collisionCount: number;
    eventCount: number;
    forecastCount: number;
}

export interface UniverseEngineOptions {
    includePlanetNine?: boolean;
    includeHypothesisObjects?: boolean;
    initialAsteroids?: number;
    initialKuiperObjects?: number;
    initialComets?: number;
    baseDtSeconds?: number;
    timeScale?: number;
    seed?: number;
}

interface OrbitState {
    bodyName: string;
    parentName: string;
    radiusMeters: number;
    omegaRadPerSec: number;
    inclinationRad: number;
    phaseRad: number;
}

interface DynamicBody {
    body: UniverseBody;
    ttlSec: number;
}

class SeededRandom {
    private state: number;

    constructor(seed: number) {
        this.state = Math.floor(Math.abs(seed || 1)) >>> 0;
        if (this.state === 0) {
            this.state = 0x9e3779b9;
        }
    }

    next(): number {
        let x = this.state;
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        this.state = x >>> 0;
        return (this.state + 0.5) / 4294967296;
    }

    range(min: number, max: number): number {
        return min + (max - min) * this.next();
    }
}

class UniverseEngine {
    private readonly options: Required<UniverseEngineOptions>;
    private readonly random: SeededRandom;

    private readonly majorBodies: UniverseBody[] = [];
    private readonly contextBodies: UniverseBody[] = [];
    private readonly smallBodies: DynamicBody[] = [];
    private readonly orbitStates = new Map<string, OrbitState>();

    private readonly events: UniverseSimulationEvent[] = [];
    private readonly forecasts: UniverseForecast[] = [];

    private paused = false;
    private simTimeSec = 0;
    private baseDtSec: number;
    private timeScaleValue: number;
    private collisions = 0;
    private nextEventId = 1;
    private supernovaTriggered = false;

    constructor(options: UniverseEngineOptions = {}) {
        this.options = {
            includePlanetNine: options.includePlanetNine ?? true,
            includeHypothesisObjects: options.includeHypothesisObjects ?? true,
            initialAsteroids: options.initialAsteroids ?? 120,
            initialKuiperObjects: options.initialKuiperObjects ?? 80,
            initialComets: options.initialComets ?? 20,
            baseDtSeconds: options.baseDtSeconds ?? 22,
            timeScale: options.timeScale ?? 1200,
            seed: options.seed ?? 77,
        };

        this.random = new SeededRandom(this.options.seed);
        this.baseDtSec = this.options.baseDtSeconds;
        this.timeScaleValue = this.options.timeScale;

        this.initializeBodies();
        this.initializeSmallBodies();
        this.updateForecasts();

        this.addEvent("info", "Engine initialized from npm compatibility layer.", vec3(), "system", "", 0);
    }

    get isPaused(): boolean {
        return this.paused;
    }

    get currentTimeScale(): number {
        return this.timeScaleValue;
    }

    setPaused(value: boolean): void {
        this.paused = value;
    }

    setTimeScale(value: number): void {
        assertPositiveFinite(value, "timeScale");
        this.timeScaleValue = value;
    }

    setBaseDtSeconds(value: number): void {
        assertPositiveFinite(value, "baseDtSeconds");
        this.baseDtSec = value;
    }

    getMajorBodies(): UniverseBody[] {
        return this.majorBodies.map(this.cloneBody);
    }

    getContextBodies(): UniverseBody[] {
        return this.contextBodies.map(this.cloneBody);
    }

    getSmallBodies(): UniverseBody[] {
        return this.smallBodies.map((entry) => this.cloneBody(entry.body));
    }

    getBodies(): UniverseBody[] {
        return this.allBodies().map((body) => this.cloneBody(body));
    }

    getEvents(limit = 20): UniverseSimulationEvent[] {
        const count = Math.max(0, Math.floor(limit));
        return this.events
            .slice(Math.max(0, this.events.length - count))
            .reverse()
            .map((event) => ({ ...event, location: cloneVec3(event.location) }));
    }

    getForecasts(limit = 12): UniverseForecast[] {
        return this.forecasts.slice(0, Math.max(0, Math.floor(limit))).map((forecast) => ({ ...forecast }));
    }

    spawnMeteorShower(count: number): void {
        const total = Math.max(1, Math.floor(count));
        const earth = this.findBody("Bumi") || this.findBody("Matahari");
        if (!earth) {
            return;
        }

        for (let i = 0; i < total; i += 1) {
            const angle = this.random.range(0, Math.PI * 2);
            const radius = this.random.range(0.85 * constants.auMeters, 1.2 * constants.auMeters);
            const pos = vec3(
                radius * Math.cos(angle),
                this.random.range(-0.02, 0.02) * radius,
                radius * Math.sin(angle),
            );
            const velocityMag = this.random.range(22000, 45000);
            const tangent = normalizeVec3(vec3(-Math.sin(angle), 0, Math.cos(angle)));
            const body: UniverseBody = {
                name: `Meteor-${this.nextEventId}-${i + 1}`,
                kind: "meteor",
                massKg: this.random.range(1e7, 5e9),
                radiusMeters: this.random.range(20, 400),
                colorHex: "#ffaf7a",
                position: pos,
                velocity: scaleVec3(tangent, velocityMag),
                alive: true,
                parentName: "Matahari",
                isHypothesis: false,
            };
            this.smallBodies.push({ body, ttlSec: this.random.range(5 * 86400, 20 * 86400) });
        }

        this.addEvent("meteor-shower", `Spawned meteor shower count=${total}.`, earth.position, "Matahari", "Bumi", 0);
    }

    spawnCometWave(count: number): void {
        const total = Math.max(1, Math.floor(count));
        for (let i = 0; i < total; i += 1) {
            const angle = this.random.range(0, Math.PI * 2);
            const radius = this.random.range(8 * constants.auMeters, 45 * constants.auMeters);
            const pos = vec3(radius * Math.cos(angle), this.random.range(-0.2, 0.2) * radius, radius * Math.sin(angle));
            const target = this.findBody("Matahari")?.position ?? vec3();
            const direction = normalizeVec3(subVec3(target, pos));
            const body: UniverseBody = {
                name: `Comet-${this.nextEventId}-${i + 1}`,
                kind: "comet",
                massKg: this.random.range(2e12, 8e14),
                radiusMeters: this.random.range(1200, 12000),
                colorHex: "#9fd1ff",
                position: pos,
                velocity: scaleVec3(direction, this.random.range(9000, 18000)),
                alive: true,
                parentName: "Matahari",
                isHypothesis: false,
            };
            this.smallBodies.push({ body, ttlSec: this.random.range(300 * 86400, 1500 * 86400) });
        }
        this.addEvent("comet-wave", `Spawned comet wave count=${total}.`, vec3(), "Matahari", "", 0);
    }

    triggerSupernova(starName: string): boolean {
        const star = this.findBody(starName);
        if (!star) {
            return false;
        }
        this.supernovaTriggered = true;
        this.addEvent("supernova", `${starName} supernova trigger registered.`, star.position, starName, "", 0);
        this.updateForecasts();
        return true;
    }

    step(subSteps: number): UniverseStepSummary {
        const steps = Math.max(0, Math.floor(subSteps));
        if (steps === 0 || this.paused) {
            return {
                performedSteps: 0,
                simulatedSeconds: this.simTimeSec,
                yearsElapsed: this.simTimeSec / YEAR_SECONDS,
                bodyCount: this.allBodies().length,
                collisionCount: this.collisions,
                eventCount: this.events.length,
                forecastCount: this.forecasts.length,
            };
        }

        const dt = this.baseDtSec * this.timeScaleValue;
        for (let i = 0; i < steps; i += 1) {
            this.simTimeSec += dt;
            this.updateOrbits(dt);
            this.updateSmallBodies(dt);
            if (i % 2 === 0) {
                this.detectCloseApproaches();
            }
        }

        this.updateForecasts();

        return {
            performedSteps: steps,
            simulatedSeconds: this.simTimeSec,
            yearsElapsed: this.simTimeSec / YEAR_SECONDS,
            bodyCount: this.allBodies().length,
            collisionCount: this.collisions,
            eventCount: this.events.length,
            forecastCount: this.forecasts.length,
        };
    }

    getAiRecommendations(limit = 5): UniverseRecommendation[] {
        const recommendations = this.getForecasts(Math.max(10, limit * 2)).map((forecast) => {
            const isCritical = forecast.kind.includes("collision") || forecast.kind.includes("supernova");
            return {
                priority: isCritical ? "critical" : forecast.confidence > 0.75 ? "high" : "medium",
                title: isCritical ? "Immediate risk monitoring" : "Trajectory watch",
                action: isCritical
                    ? "Increase simulation cadence and prepare mitigation scenarios for affected bodies."
                    : "Track this encounter and keep adaptive time-step during close pass interval.",
                rationale: `${forecast.message} eta=${forecast.etaYears.toFixed(4)} years confidence=${(forecast.confidence * 100).toFixed(1)}%.`,
                relatedBodies: [forecast.bodyA, forecast.bodyB].filter(Boolean),
            } as UniverseRecommendation;
        });

        if (recommendations.length === 0) {
            recommendations.push({
                priority: "medium",
                title: "Nominal stability",
                action: "Continue routine simulation checks.",
                rationale: "No high-impact forecast currently detected.",
                relatedBodies: [],
            });
        }

        return recommendations.slice(0, Math.max(1, Math.floor(limit)));
    }

    getStateSnapshot(): UniverseStateSnapshot {
        return {
            yearsElapsed: this.simTimeSec / YEAR_SECONDS,
            simulatedSeconds: this.simTimeSec,
            paused: this.paused,
            baseDtSeconds: this.baseDtSec,
            timeScale: this.timeScaleValue,
            speedOfLightSimulationMps: constants.speedOfLightMps,
            collisionCount: this.collisions,
            counts: this.getCounts(),
            latestEvents: this.getEvents(8),
            latestForecasts: this.getForecasts(8),
        };
    }

    private initializeBodies(): void {
        const sun: UniverseBody = {
            name: "Matahari",
            kind: "star",
            massKg: constants.solarMassKg,
            radiusMeters: 6.9634e8,
            colorHex: "#ffdb83",
            position: vec3(),
            velocity: vec3(),
            alive: true,
            parentName: null,
            isHypothesis: false,
        };
        this.majorBodies.push(sun);

        const planetDefs: Array<[string, UniverseBodyKind, number, number, number, number, string, string, boolean, number]> = [
            ["Merkurius", "planet", 3.3011e23, 2.4397e6, 0.3871, 87.97, "#a9a8a2", "Matahari", false, 7.0],
            ["Venus", "planet", 4.8675e24, 6.0518e6, 0.7233, 224.7, "#eac384", "Matahari", false, 3.4],
            ["Bumi", "planet", 5.9722e24, 6.371e6, 1.0, 365.256, "#46aaff", "Matahari", false, 0.0],
            ["Mars", "planet", 6.4171e23, 3.3895e6, 1.5237, 686.98, "#ff7554", "Matahari", false, 1.85],
            ["Jupiter", "planet", 1.89813e27, 6.9911e7, 5.2044, 4332.59, "#d7b07f", "Matahari", false, 1.3],
            ["Saturnus", "planet", 5.6834e26, 5.8232e7, 9.5826, 10759.2, "#e0c787", "Matahari", false, 2.5],
            ["Uranus", "planet", 8.6810e25, 2.5362e7, 19.201, 30688.5, "#96dcdc", "Matahari", false, 0.8],
            ["Neptunus", "planet", 1.02413e26, 2.4622e7, 30.047, 60182.0, "#5a87ff", "Matahari", false, 1.8],
            ["Bulan", "moon", 7.3476e22, 1.7374e6, 384_400_000 / constants.auMeters, 27.3217, "#e4e4e4", "Bumi", false, 5.1],
            ["Io", "moon", 8.9319e22, 1.8216e6, 4.217e8 / constants.auMeters, 1.769, "#f0d782", "Jupiter", false, 0.04],
            ["Europa", "moon", 4.7998e22, 1.5608e6, 6.711e8 / constants.auMeters, 3.55, "#dcd6c0", "Jupiter", false, 0.47],
            ["Ganymede", "moon", 1.4819e23, 2.6341e6, 1.0704e9 / constants.auMeters, 7.15, "#cabfaa", "Jupiter", false, 0.2],
            ["Callisto", "moon", 1.0759e23, 2.4103e6, 1.8827e9 / constants.auMeters, 16.69, "#b5aa9e", "Jupiter", false, 0.28],
            ["Titan", "moon", 1.3452e23, 2.5747e6, 1.2219e9 / constants.auMeters, 15.95, "#e5c182", "Saturnus", false, 0.35],
            ["Rhea", "moon", 2.3065e21, 7.638e5, 5.271e8 / constants.auMeters, 4.52, "#d7d2cd", "Saturnus", false, 0.35],
            ["Iapetus", "moon", 1.8056e21, 7.345e5, 3.5608e9 / constants.auMeters, 79.32, "#b6a591", "Saturnus", false, 15.5],
            ["Enceladus", "moon", 1.0802e20, 2.521e5, 2.3802e8 / constants.auMeters, 1.37, "#ebebf0", "Saturnus", false, 0.02],
            ["Ceres", "dwarf", 9.393e20, 4.73e5, 2.77, 1680.0, "#bec0c3", "Matahari", false, 10.6],
            ["Pluto", "dwarf", 1.303e22, 1.1883e6, 39.48, 90560.0, "#cebabb", "Matahari", false, 17.2],
            ["Eris", "dwarf", 1.6466e22, 1.163e6, 67.67, 203830.0, "#d2d2d2", "Matahari", false, 44.0],
            ["Haumea", "dwarf", 4.006e21, 8.2e5, 43.13, 103410.0, "#c4d7e8", "Matahari", false, 28.2],
            ["Makemake", "dwarf", 3.1e21, 7.15e5, 45.79, 112900.0, "#dfc49a", "Matahari", false, 29.0],
            ["Planet Nine?", "hypothesis", 5.0 * 5.9722e24, 2.8e7, 500.0, 365.0 * 10000.0, "#aa82ff", "Matahari", true, 20.0],
        ];

        for (const [name, kind, mass, radius, radiusAU, periodDays, color, parentName, isHypothesis, inclDeg] of planetDefs) {
            if (name === "Planet Nine?" && !this.options.includePlanetNine) {
                continue;
            }
            if (isHypothesis && !this.options.includeHypothesisObjects) {
                continue;
            }
            const parent = this.findBody(parentName);
            if (!parent) {
                continue;
            }
            const phase = this.random.range(0, Math.PI * 2);
            const inclinationRad = (inclDeg * Math.PI) / 180;
            const body: UniverseBody = {
                name,
                kind,
                massKg: mass,
                radiusMeters: radius,
                colorHex: color,
                position: cloneVec3(parent.position),
                velocity: vec3(),
                alive: true,
                parentName,
                isHypothesis,
            };
            this.majorBodies.push(body);
            this.orbitStates.set(name, {
                bodyName: name,
                parentName,
                radiusMeters: radiusAU * constants.auMeters,
                omegaRadPerSec: (2 * Math.PI) / Math.max(1, periodDays * 86400),
                inclinationRad,
                phaseRad: phase,
            });
        }

        this.contextBodies.push(
            this.createContextBody("Sirius A", "star", 2.063 * constants.solarMassKg, 1.711 * 6.9634e8, "#bde0ff", 8.6),
            this.createContextBody("Proxima Centauri", "star", 0.1221 * constants.solarMassKg, 0.1542 * 6.9634e8, "#f8a46f", 4.24),
            this.createContextBody("Betelgeuse", "star", 16.5 * constants.solarMassKg, 764 * 6.9634e8, "#ff8e70", 548),
            this.createContextBody("Andromeda (M31)", "galaxy", 1.5e12 * constants.solarMassKg, 1.0e21, "#9ab4ff", 2537000),
            this.createContextBody("Triangulum (M33)", "galaxy", 5.0e10 * constants.solarMassKg, 3.0e20, "#88b2ff", 2730000),
            this.createContextBody("Awan Magellan Besar", "galaxy", 1.5e10 * constants.solarMassKg, 8.0e19, "#8fd5ff", 163000),
            this.createContextBody("Awan Magellan Kecil", "galaxy", 7.0e9 * constants.solarMassKg, 6.0e19, "#99ddff", 200000),
            this.createContextBody("M87 Galaxy", "galaxy", 2.4e12 * constants.solarMassKg, 1.2e21, "#a2b8d8", 53000000),
            this.createContextBody("Whirlpool (M51)", "galaxy", 1.6e11 * constants.solarMassKg, 3.8e20, "#8dbdd4", 31000000),
            this.createContextBody("Sombrero (M104)", "galaxy", 8.0e11 * constants.solarMassKg, 4.0e20, "#b7c5db", 29000000),
            this.createContextBody("Bima Sakti", "galaxy", 1.1e12 * constants.solarMassKg, 5.0e20, "#8bc1ff", 28000),
            this.createContextBody("Grup Lokal", "cluster", 3.0e12 * constants.solarMassKg, 1.5e22, "#8eb4bf", 1500000),
            this.createContextBody("Laniakea", "cluster", 3.0e13 * constants.solarMassKg, 1.6e24, "#9de0d0", 500000000),
            this.createContextBody("Pleiades (M45)", "cluster", 8.0e4 * constants.solarMassKg, 2.0e17, "#8ec8ff", 444),
            this.createContextBody("Omega Centauri", "cluster", 4.0e6 * constants.solarMassKg, 2.4e18, "#b7d4ff", 15800),
            this.createContextBody("Sagittarius A*", "black-hole", 4.154e6 * constants.solarMassKg, 1.227e10, "#8f8fff", 26000),
            this.createContextBody("M87*", "black-hole", 6.5e9 * constants.solarMassKg, 1.9e13, "#9f7dff", 53000000),
            this.createContextBody("Cygnus X-1", "black-hole", 21.2 * constants.solarMassKg, 6.3e4, "#7598ff", 6070),
            this.createContextBody("TON 618", "black-hole", 6.6e10 * constants.solarMassKg, 2.0e14, "#7d8eff", 10400000000),
            this.createContextBody("3C 273", "other", 2.0e9 * constants.solarMassKg, 1.2e13, "#ac94ff", 2440000000),
            this.createContextBody("Orion Nebula (M42)", "nebula", 2.0e4 * constants.solarMassKg, 1.2e17, "#76b5ff", 1344),
            this.createContextBody("Eagle Nebula (M16)", "nebula", 8.0e4 * constants.solarMassKg, 7.5e17, "#6dbfca", 7000),
            this.createContextBody("Carina Nebula (NGC 3372)", "nebula", 1.0e5 * constants.solarMassKg, 1.4e18, "#71c4ac", 7500),
            this.createContextBody("Crab Nebula (M1)", "nebula", 1.0e4 * constants.solarMassKg, 5.7e16, "#99bde8", 6500),
            this.createContextBody("Helix Nebula (NGC 7293)", "nebula", 1.0e3 * constants.solarMassKg, 2.4e16, "#8fd8d0", 655),
            this.createContextBody("Ring Nebula (M57)", "nebula", 2.0e3 * constants.solarMassKg, 1.7e16, "#95bbd6", 2567),
            this.createContextBody("SN 1987A Remnant", "nebula", 1.0e3 * constants.solarMassKg, 3.0e16, "#b995d4", 168000),
            this.createContextBody("Cassiopeia A", "nebula", 1.0e3 * constants.solarMassKg, 8.0e16, "#c09db9", 11000),
            this.createContextBody("Tycho SNR", "nebula", 1.0e3 * constants.solarMassKg, 6.0e16, "#b8a7cb", 11000),
            this.createContextBody("Filamen Kosmik", "other", 1.0e14 * constants.solarMassKg, 3.0e24, "#7ca7bf", 300000000),
            this.createContextBody("Heliosfer", "other", 1.0e3 * constants.solarMassKg, 1.8e13, "#78c4ff", 0.0015),
            this.createContextBody("Heliopause", "other", 1.0e3 * constants.solarMassKg, 1.9e13, "#76a9ff", 0.0017),
            this.createContextBody("Awan Oort", "other", 2.0e2 * constants.solarMassKg, 7.5e15, "#8f95bf", 1.0),
        );

        if (this.options.includeHypothesisObjects) {
            this.contextBodies.push(
                this.createContextBody("Halo Materi Gelap", "hypothesis", 1.0e13 * constants.solarMassKg, 1.2e21, "#6e5aa5", 350000),
                this.createContextBody("Latar Energi Gelap", "hypothesis", 1.0e10 * constants.solarMassKg, 3.0e24, "#6f68d8", 1000000000),
            );
        }

        this.updateOrbits(0);
    }

    private initializeSmallBodies(): void {
        const cometSeed = Math.max(0, Math.floor(this.options.initialComets / 12));
        const meteorSeed = Math.max(0, Math.floor(this.options.initialAsteroids / 60));
        this.spawnCometWave(Math.max(1, cometSeed));
        this.spawnMeteorShower(Math.max(1, meteorSeed));
    }

    private createContextBody(
        name: string,
        kind: UniverseBodyKind,
        massKg: number,
        radiusMeters: number,
        colorHex: string,
        distanceLightYear: number,
    ): UniverseBody {
        const phase = this.random.range(0, Math.PI * 2);
        const distance = distanceLightYear * constants.lightYearMeters;
        return {
            name,
            kind,
            massKg,
            radiusMeters,
            colorHex,
            position: vec3(distance * Math.cos(phase), this.random.range(-0.03, 0.03) * distance, distance * Math.sin(phase)),
            velocity: vec3(),
            alive: true,
            parentName: "Matahari",
            isHypothesis: kind === "hypothesis",
        };
    }

    private updateOrbits(dtSec: number): void {
        for (const orbit of this.orbitStates.values()) {
            const body = this.findBody(orbit.bodyName);
            const parent = this.findBody(orbit.parentName);
            if (!body || !parent || !body.alive) {
                continue;
            }

            orbit.phaseRad += orbit.omegaRadPerSec * dtSec;
            const cp = Math.cos(orbit.phaseRad);
            const sp = Math.sin(orbit.phaseRad);
            const ci = Math.cos(orbit.inclinationRad);
            const si = Math.sin(orbit.inclinationRad);

            const relativePos = vec3(
                orbit.radiusMeters * cp,
                orbit.radiusMeters * sp * ci,
                orbit.radiusMeters * sp * si,
            );

            body.position = addVec3(parent.position, relativePos);

            const speed = circularOrbitSpeed(Math.max(parent.massKg, constants.solarMassKg * 1e-4), Math.max(orbit.radiusMeters, 1));
            const tangent = normalizeVec3(vec3(-sp, cp * ci, cp * si));
            body.velocity = addVec3(parent.velocity, scaleVec3(tangent, speed));
        }
    }

    private updateSmallBodies(dtSec: number): void {
        const sun = this.findBody("Matahari");
        const earth = this.findBody("Bumi");
        if (!sun) {
            return;
        }

        for (const dyn of this.smallBodies) {
            if (!dyn.body.alive) {
                continue;
            }

            const toSun = subVec3(sun.position, dyn.body.position);
            const dist = Math.max(magVec3(toSun), sun.radiusMeters);
            const gravAcc = gravitationalParameter(sun.massKg) / (dist * dist);
            dyn.body.velocity = addVec3(dyn.body.velocity, scaleVec3(normalizeVec3(toSun), gravAcc * dtSec));
            dyn.body.position = addVec3(dyn.body.position, scaleVec3(dyn.body.velocity, dtSec));
            dyn.ttlSec -= dtSec;

            if (earth) {
                const rel = magVec3(subVec3(dyn.body.position, earth.position));
                if (rel <= earth.radiusMeters * 8) {
                    this.collisions += 1;
                    dyn.body.alive = false;
                    this.addEvent("impact", `${dyn.body.name} impacted near Earth corridor.`, earth.position, dyn.body.name, "Bumi", magVec3(dyn.body.velocity));
                }
            }

            if (dist <= sun.radiusMeters * 1.4) {
                this.collisions += 1;
                dyn.body.alive = false;
                this.addEvent("accretion", `${dyn.body.name} accreted into Matahari.`, sun.position, dyn.body.name, "Matahari", magVec3(dyn.body.velocity));
            }

            if (dyn.ttlSec <= 0) {
                dyn.body.alive = false;
            }
        }

        for (let i = this.smallBodies.length - 1; i >= 0; i -= 1) {
            if (!this.smallBodies[i].body.alive) {
                this.smallBodies.splice(i, 1);
            }
        }
    }

    private detectCloseApproaches(): void {
        const watchPairs: Array<[string, string]> = [
            ["Bumi", "Bulan"],
            ["Bumi", "Mars"],
            ["Jupiter", "Io"],
            ["Saturnus", "Titan"],
            ["Matahari", "Merkurius"],
        ];

        for (const [nameA, nameB] of watchPairs) {
            const a = this.findBody(nameA);
            const b = this.findBody(nameB);
            if (!a || !b) {
                continue;
            }
            const dist = magVec3(subVec3(a.position, b.position));
            const relV = magVec3(subVec3(a.velocity, b.velocity));
            if (dist < Math.max(a.radiusMeters + b.radiusMeters, constants.auMeters * 0.003)) {
                this.addEvent("close-pass", `${nameA} close pass with ${nameB}.`, a.position, nameA, nameB, relV);
            }
        }
    }

    private updateForecasts(): void {
        const candidates: UniverseForecast[] = [];
        const forecastPairs: Array<[string, string]> = [
            ["Bumi", "Bulan"],
            ["Bumi", "Mars"],
            ["Jupiter", "Europa"],
            ["Saturnus", "Titan"],
            ["Matahari", "Merkurius"],
        ];

        for (const [nameA, nameB] of forecastPairs) {
            const a = this.findBody(nameA);
            const b = this.findBody(nameB);
            if (!a || !b) {
                continue;
            }

            const relPos = subVec3(a.position, b.position);
            const relVel = subVec3(a.velocity, b.velocity);
            const dist = magVec3(relPos);
            const speed = Math.max(magVec3(relVel), 1);
            const etaYears = clamp((dist / speed) / YEAR_SECONDS, 1e-7, 5000);
            const closeFactor = 1 / (1 + dist / constants.auMeters);
            const confidence = clamp(0.45 + 0.5 * closeFactor, 0.45, 0.98);
            const kind = dist < constants.auMeters * 0.01 ? "potential-collision" : "close-pass";

            candidates.push({
                kind,
                message: `${nameA} and ${nameB} projected ${kind}.`,
                etaYears,
                bodyA: nameA,
                bodyB: nameB,
                confidence,
            });
        }

        if (this.supernovaTriggered) {
            candidates.push({
                kind: "supernova-alert",
                message: "Betelgeuse supernova trigger is active in simulation.",
                etaYears: 0.0001,
                bodyA: "Betelgeuse",
                bodyB: "Local Group",
                confidence: 0.99,
            });
        }

        this.forecasts.length = 0;
        this.forecasts.push(...candidates.sort((a, b) => a.etaYears - b.etaYears).slice(0, 14));
    }

    private getCounts(): UniverseCounts {
        const all = this.allBodies();
        const terrestrial = new Set(["Merkurius", "Venus", "Bumi", "Mars"]);
        const jovian = new Set(["Jupiter", "Saturnus", "Uranus", "Neptunus"]);

        return {
            majorBodies: this.majorBodies.length,
            smallBodies: this.smallBodies.length,
            contextBodies: this.contextBodies.length,
            allBodies: all.length,
            terrestrial: this.majorBodies.filter((body) => terrestrial.has(body.name)).length,
            jovian: this.majorBodies.filter((body) => jovian.has(body.name)).length,
            dwarf: this.majorBodies.filter((body) => body.kind === "dwarf").length,
            moon: this.majorBodies.filter((body) => body.kind === "moon").length,
            asteroid: 0,
            kuiper: 0,
            comet: this.smallBodies.filter((body) => body.body.kind === "comet").length,
            meteor: this.smallBodies.filter((body) => body.body.kind === "meteor").length,
            blackHole: all.filter((body) => body.kind === "black-hole").length,
            nebula: all.filter((body) => body.kind === "nebula").length,
            galaxy: all.filter((body) => body.kind === "galaxy").length,
            onlineCatalog: 0,
        };
    }

    private findBody(name: string): UniverseBody | undefined {
        return this.allBodies().find((body) => body.name === name);
    }

    private allBodies(): UniverseBody[] {
        return [
            ...this.majorBodies,
            ...this.contextBodies,
            ...this.smallBodies.map((body) => body.body),
        ];
    }

    private addEvent(
        kind: string,
        message: string,
        location: Vector3,
        bodyA: string,
        bodyB: string,
        relSpeedMps: number,
    ): void {
        this.events.push({
            id: this.nextEventId,
            kind,
            message,
            timeYears: this.simTimeSec / YEAR_SECONDS,
            location: cloneVec3(location),
            bodyA,
            bodyB,
            relSpeedMps,
        });
        this.nextEventId += 1;

        if (this.events.length > 220) {
            this.events.splice(0, this.events.length - 220);
        }
    }

    private cloneBody(body: UniverseBody): UniverseBody {
        return {
            ...body,
            position: cloneVec3(body.position),
            velocity: cloneVec3(body.velocity),
        };
    }
}

export function createUniverseEngine(options: UniverseEngineOptions = {}): UniverseEngine {
    return new UniverseEngine(options);
}

export function generateUniverseStateReport(snapshot: UniverseStateSnapshot): string {
    return [
        "Orbinex Universe State Snapshot",
        `yearsElapsed=${snapshot.yearsElapsed.toFixed(6)}`,
        `simulatedSeconds=${snapshot.simulatedSeconds.toFixed(2)}`,
        `baseDtSeconds=${snapshot.baseDtSeconds.toFixed(2)} timeScale=${snapshot.timeScale.toFixed(2)}`,
        `collisionCount=${snapshot.collisionCount}`,
        `counts major=${snapshot.counts.majorBodies} small=${snapshot.counts.smallBodies} context=${snapshot.counts.contextBodies} all=${snapshot.counts.allBodies}`,
        `planetary terrestrial=${snapshot.counts.terrestrial} jovian=${snapshot.counts.jovian} dwarf=${snapshot.counts.dwarf} moon=${snapshot.counts.moon}`,
    ].join("\n");
}

export function generateRecommendationReport(recommendations: UniverseRecommendation[]): string {
    if (recommendations.length === 0) {
        return "No recommendations available.";
    }

    return recommendations
        .map((recommendation, index) => {
            return [
                `${index + 1}. [${recommendation.priority}] ${recommendation.title}`,
                `   action=${recommendation.action}`,
                `   rationale=${recommendation.rationale}`,
                `   related=${recommendation.relatedBodies.join(", ") || "none"}`,
            ].join("\n");
        })
        .join("\n");
}

export {
    circularOrbitSpeed,
    createOrbitSample,
    equatorialToCartesian,
    generateSimulationReport,
    orbitalPeriodFromSemiMajorAxis,
};
