import { constants, createOrbitSample, type OrbitSample } from "@galihru/orbinex";

export type OrbinexMode = "desktop" | "ar";
export type PermissionResult = "granted" | "denied" | "unsupported";

export interface PermissionRequestOptions {
    camera?: boolean;
    microphone?: boolean;
    geolocation?: boolean;
    motionSensors?: boolean;
}

export interface PermissionRequestSummary {
    camera: PermissionResult;
    microphone: PermissionResult;
    geolocation: PermissionResult;
    motionSensors: PermissionResult;
}

export interface OrbinexSimOptions {
    baseUrl?: string;
    mode?: OrbinexMode;
    model?: string;
    width?: string;
    height?: string;
    autoAppend?: boolean;
    autoRequestAccess?: boolean;
    iframeClassName?: string;
}

export interface LaunchArOptions extends PermissionRequestOptions {
    model?: string;
}

const DEFAULT_BASE_URL = "https://galihru.github.io/OrbinexSimulation/";

function toPermissionResult(value: boolean): PermissionResult {
    return value ? "granted" : "denied";
}

async function requestCameraPermission(): Promise<PermissionResult> {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
        return "unsupported";
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: "environment",
            },
            audio: false,
        });
        stream.getTracks().forEach((track) => track.stop());
        return "granted";
    } catch {
        return "denied";
    }
}

async function requestMicrophonePermission(): Promise<PermissionResult> {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
        return "unsupported";
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        stream.getTracks().forEach((track) => track.stop());
        return "granted";
    } catch {
        return "denied";
    }
}

async function requestGeolocationPermission(): Promise<PermissionResult> {
    if (!navigator.geolocation || !window.isSecureContext) {
        return "unsupported";
    }

    return new Promise<PermissionResult>((resolve) => {
        navigator.geolocation.getCurrentPosition(
            () => resolve("granted"),
            () => resolve("denied"),
            {
                timeout: 7000,
                enableHighAccuracy: false,
                maximumAge: 0,
            },
        );
    });
}

async function requestMotionSensorPermission(): Promise<PermissionResult> {
    const motionApi = window.DeviceMotionEvent as unknown as {
        requestPermission?: () => Promise<"granted" | "denied">;
    };

    if (!motionApi || typeof motionApi.requestPermission !== "function") {
        return "unsupported";
    }

    try {
        const result = await motionApi.requestPermission();
        return result === "granted" ? "granted" : "denied";
    } catch {
        return "denied";
    }
}

function resolveContainer(target: string | HTMLElement): HTMLElement {
    if (typeof target !== "string") {
        return target;
    }

    const found = document.querySelector<HTMLElement>(target);
    if (!found) {
        throw new Error(`Container not found for selector: ${target}`);
    }

    return found;
}

function normalizeBaseUrl(baseUrl: string): string {
    const trimmed = baseUrl.trim();
    if (!trimmed) {
        return DEFAULT_BASE_URL;
    }

    return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function ensureIframeStyle(iframe: HTMLIFrameElement, width: string, height: string): void {
    iframe.style.width = width;
    iframe.style.height = height;
    iframe.style.border = "0";
    iframe.style.display = "block";
    iframe.style.background = "#000";
}

export class OrbinexSim {
    private readonly container: HTMLElement;

    private readonly iframe: HTMLIFrameElement;

    private baseUrl: string;

    private mode: OrbinexMode;

    private model: string;

    constructor(target: string | HTMLElement, options: OrbinexSimOptions = {}) {
        this.container = resolveContainer(target);
        this.baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
        this.mode = options.mode ?? "desktop";
        this.model = options.model ?? "Bumi";

        this.iframe = document.createElement("iframe");
        this.iframe.title = "Orbinex Simulation";
        this.iframe.allow = "camera; microphone; geolocation; accelerometer; gyroscope; magnetometer; xr-spatial-tracking; fullscreen";
        this.iframe.referrerPolicy = "strict-origin-when-cross-origin";

        if (options.iframeClassName) {
            this.iframe.className = options.iframeClassName;
        }

        ensureIframeStyle(this.iframe, options.width ?? "100%", options.height ?? "72vh");
        this.iframe.src = this.buildUrl();

        if (options.autoAppend !== false) {
            this.mount();
        }

        if (options.autoRequestAccess) {
            void this.requestAccess({
                camera: true,
                geolocation: true,
                motionSensors: true,
            });
        }
    }

    mount(): void {
        if (!this.iframe.isConnected) {
            this.container.appendChild(this.iframe);
        }
    }

    destroy(): void {
        this.iframe.remove();
    }

    getElement(): HTMLIFrameElement {
        return this.iframe;
    }

    setMode(mode: OrbinexMode): void {
        this.mode = mode;
        this.refresh();
    }

    setModel(model: string): void {
        this.model = model || "Bumi";
        this.refresh();
    }

    setBaseUrl(baseUrl: string): void {
        this.baseUrl = normalizeBaseUrl(baseUrl);
        this.refresh();
    }

    openInNewTab(): Window | null {
        return window.open(this.buildUrl(), "_blank", "noopener,noreferrer");
    }

    async requestAccess(options: PermissionRequestOptions = {}): Promise<PermissionRequestSummary> {
        const wantsCamera = options.camera ?? false;
        const wantsMic = options.microphone ?? false;
        const wantsGeo = options.geolocation ?? false;
        const wantsMotion = options.motionSensors ?? false;
        const unsupported: PermissionResult = "unsupported";

        const [camera, microphone, geolocation, motionSensors] = await Promise.all([
            wantsCamera ? requestCameraPermission() : Promise.resolve(unsupported),
            wantsMic ? requestMicrophonePermission() : Promise.resolve(unsupported),
            wantsGeo ? requestGeolocationPermission() : Promise.resolve(unsupported),
            wantsMotion ? requestMotionSensorPermission() : Promise.resolve(unsupported),
        ]);

        return {
            camera,
            microphone,
            geolocation,
            motionSensors,
        };
    }

    async launchAr(options: LaunchArOptions = {}): Promise<PermissionRequestSummary> {
        const model = options.model ?? this.model;
        const permissions = await this.requestAccess({
            camera: options.camera ?? true,
            microphone: options.microphone ?? false,
            geolocation: options.geolocation ?? false,
            motionSensors: options.motionSensors ?? true,
        });

        this.setModel(model);
        this.setMode("ar");

        return permissions;
    }

    createOrbitPreviewSample(radiusMeters: number, primaryMassKg = constants.solarMassKg): OrbitSample {
        return createOrbitSample(primaryMassKg, radiusMeters);
    }

    buildQuickReport(radiusMeters: number): string {
        const sample = this.createOrbitPreviewSample(radiusMeters);
        return [
            `radius=${radiusMeters.toFixed(0)}m`,
            `speed=${sample.circularSpeedMps.toFixed(2)}m/s`,
            `periodDays=${sample.orbitalPeriodDays.toFixed(2)}`,
        ].join(" | ");
    }

    private refresh(): void {
        this.iframe.src = this.buildUrl();
    }

    private buildUrl(): string {
        const path = this.mode === "ar" ? "ar-view.html" : "";
        const url = new URL(path, this.baseUrl);
        url.searchParams.set("from", "orbinexsim");
        url.searchParams.set("model", this.model);
        if (this.mode === "desktop") {
            url.searchParams.set("desktop", "1");
        }
        return url.toString();
    }
}

export function createOrbinexSim(target: string | HTMLElement, options: OrbinexSimOptions = {}): OrbinexSim {
    return new OrbinexSim(target, options);
}

export async function requestRuntimePermissions(options: PermissionRequestOptions): Promise<PermissionRequestSummary> {
    const simulator = document.createElement("div");
    const instance = new OrbinexSim(simulator, { autoAppend: false });
    return instance.requestAccess(options);
}

export function orbitSampleFromAu(au: number): OrbitSample {
    return createOrbitSample(constants.solarMassKg, Math.max(au, 0.001) * constants.auMeters);
}

export {
    bindMarkerTracking,
    createMarkersFromCatalog,
    createPrimitiveModelFromCatalogEntry,
    createDefaultArMarkers,
    extractCatalogEntriesFromPayload,
    ensureArMarkers,
    parseArRequestFromSearch,
    resolveCatalogProxyUrl,
    resolveObjectNameForMarker,
    loadCatalogFromProxy,
    requestRuntimePermissions as requestArRuntimePermissions,
    resolveArMarkerHint,
} from "./ar-runtime";

export { constants };
