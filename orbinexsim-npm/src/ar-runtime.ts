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

export interface ArRequestParseOptions {
    modelParamKeys?: string[];
    defaultModel?: string;
    defaultAltModel?: string;
    defaultBuildToken?: string;
}

export interface ArRequestSummary {
    model: string;
    altModel: string;
    buildToken: string;
}

export interface ArMarkerConfig {
    id?: string;
    preset?: string;
    model?: string;
    markerLabel?: string;
    markerImage?: string;
    markerLink?: string;
    smooth?: boolean;
    smoothCount?: number;
    smoothTolerance?: number;
    smoothThreshold?: number;
}

export interface EnsureArMarkersOptions {
    createMissing?: boolean;
    ensureModelRoot?: boolean;
}

export interface ArMarkerHintSummary {
    markerImage: string;
    markerLink: string;
    markerLabel: string;
}

export interface ArMarkerDetectionSummary {
    markerId: string;
    markerLabel: string;
    markerModel: string;
    markerNode: HTMLElement;
    visibleCount: number;
    isAnyVisible: boolean;
}

export interface MarkerTrackingHandlers {
    onMarkerFound?: (summary: ArMarkerDetectionSummary) => void;
    onMarkerLost?: (summary: ArMarkerDetectionSummary) => void;
    onVisibilityChange?: (summary: ArMarkerDetectionSummary) => void;
}

export interface CatalogObjectEntry {
    name: string;
    kind?: string;
    massKg?: number;
    radiusMeters?: number;
    color?: string;
    parentName?: string | null;
    semiMajorMeters?: number | null;
    periodDays?: number | null;
    rotationHours?: number | null;
    inclinationDeg?: number | null;
    markerId?: string;
    markerPreset?: string;
    markerLabel?: string;
    markerImage?: string;
    markerLink?: string;
    markerModel?: string;
}

export interface CatalogProxyLoadOptions {
    requestInit?: RequestInit;
    timeoutMs?: number;
}

export interface PrimitiveModelCreateOptions {
    includeLabel?: boolean;
    radiusScale?: number;
    defaultColor?: string;
    position?: string;
}

const DEFAULT_CATALOG_PROXY_PARAM_KEYS = ["catalogProxy", "catalog", "proxy", "db", "catalogUrl"];

const MARKER_HIRO_URL = "https://raw.githubusercontent.com/AR-js-org/AR.js/master/data/images/hiro.png";
const MARKER_KANJI_URL = "https://raw.githubusercontent.com/AR-js-org/AR.js/master/data/images/kanji.png";

const DEFAULT_PERMISSION_SUMMARY: PermissionRequestSummary = {
    camera: "unsupported",
    microphone: "unsupported",
    geolocation: "unsupported",
    motionSensors: "unsupported",
};

function normalizePermissionResult(value: unknown): PermissionResult {
    return value === "granted" || value === "denied" || value === "unsupported"
        ? value
        : "unsupported";
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object") {
        return null;
    }
    return value as Record<string, unknown>;
}

function readFirstString(source: Record<string, unknown>, keys: string[]): string {
    for (const key of keys) {
        const raw = source[key];
        if (typeof raw === "string" && raw.trim()) {
            return raw.trim();
        }
    }
    return "";
}

function readFirstNumber(source: Record<string, unknown>, keys: string[]): number | null {
    for (const key of keys) {
        const raw = source[key];
        const next = typeof raw === "number"
            ? raw
            : typeof raw === "string"
                ? Number(raw)
                : NaN;

        if (Number.isFinite(next)) {
            return next;
        }
    }

    return null;
}

function toOptionalNumber(value: number | null): number | undefined {
    return value === null ? undefined : value;
}

function toOptionalNullableNumber(value: number | null): number | null | undefined {
    if (value === null) {
        return undefined;
    }
    return value;
}

function toOptionalText(value: string): string | undefined {
    return value ? value : undefined;
}

async function requestCameraPermission(): Promise<PermissionResult> {
    if (!window.isSecureContext || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
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

async function requestMicrophonePermission(): Promise<PermissionResult> {
    if (!window.isSecureContext || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
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
    if (!window.isSecureContext || !("geolocation" in navigator) || !navigator.geolocation) {
        return "unsupported";
    }

    return new Promise<PermissionResult>((resolve) => {
        navigator.geolocation.getCurrentPosition(
            () => resolve("granted"),
            () => resolve("denied"),
            {
                enableHighAccuracy: false,
                timeout: 7000,
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

function resolveHostNode(target: string | Element | Document): Element {
    if (typeof target !== "string") {
        if (target instanceof Document) {
            return target.documentElement;
        }
        return target;
    }

    const found = document.querySelector(target);
    if (!found) {
        throw new Error(`Target element not found for selector: ${target}`);
    }

    return found;
}

function normalizeMarkerConfig(config: ArMarkerConfig): Required<Omit<ArMarkerConfig, "model">> & { model: string } {
    const preset = (config.preset || "hiro").trim() || "hiro";
    const markerImage = (config.markerImage || (preset === "kanji" ? MARKER_KANJI_URL : MARKER_HIRO_URL)).trim();
    const markerLink = (config.markerLink || markerImage).trim();
    const markerLabel = (config.markerLabel || (preset === "kanji" ? "Kanji" : "Hiro")).trim();
    const id = (config.id || `orbinex-marker-${preset}`).trim();

    return {
        id,
        preset,
        model: (config.model || "Bumi").trim() || "Bumi",
        markerLabel,
        markerImage,
        markerLink,
        smooth: config.smooth ?? true,
        smoothCount: config.smoothCount ?? 8,
        smoothTolerance: config.smoothTolerance ?? 0.01,
        smoothThreshold: config.smoothThreshold ?? 5,
    };
}

function ensureModelRoot(markerEl: Element): void {
    if (markerEl.querySelector("[data-model-root]")) {
        return;
    }

    const modelRoot = document.createElement("a-entity");
    modelRoot.setAttribute("data-model-root", "");
    modelRoot.setAttribute("position", "0 0 0");
    markerEl.appendChild(modelRoot);
}

function ensureMarkerPlane(markerEl: Element): void {
    if (markerEl.querySelector("a-plane")) {
        return;
    }

    const plane = document.createElement("a-plane");
    plane.setAttribute("width", "1.08");
    plane.setAttribute("height", "1.08");
    plane.setAttribute("position", "0 0.003 0");
    plane.setAttribute("rotation", "-90 0 0");
    plane.setAttribute(
        "material",
        "shader: flat; color: #f3f6fb; opacity: 0.94; transparent: true; side: double; depthTest: false; depthWrite: false",
    );
    markerEl.appendChild(plane);
}

function applyMarkerDataset(markerEl: HTMLElement, marker: ReturnType<typeof normalizeMarkerConfig>): void {
    markerEl.id = marker.id;
    markerEl.dataset.model = marker.model;
    markerEl.dataset.markerLabel = marker.markerLabel;
    markerEl.dataset.markerImage = marker.markerImage;
    markerEl.dataset.markerLink = marker.markerLink;

    markerEl.setAttribute("preset", marker.preset);
    markerEl.setAttribute("emitevents", "true");
    markerEl.setAttribute("smooth", marker.smooth ? "true" : "false");
    markerEl.setAttribute("smoothCount", String(marker.smoothCount));
    markerEl.setAttribute("smoothTolerance", String(marker.smoothTolerance));
    markerEl.setAttribute("smoothThreshold", String(marker.smoothThreshold));
}

export function resolveObjectNameForMarker(markerNode: Element | null | undefined, fallbackModel = "Bumi"): string {
    const markerModel = (markerNode?.getAttribute("data-model") || markerNode?.getAttribute("data-object") || "").trim();
    return markerModel || fallbackModel;
}

function buildMarkerDetectionSummary(
    markerNode: HTMLElement,
    visibilityState: Map<string, boolean>,
): ArMarkerDetectionSummary {
    const markerId = markerNode.id || markerNode.dataset.markerLabel || markerNode.dataset.model || "marker";
    const markerLabel = (markerNode.dataset.markerLabel || markerId).trim() || markerId;
    const markerModel = resolveObjectNameForMarker(markerNode, "Bumi");
    const visibleCount = Array.from(visibilityState.values()).filter(Boolean).length;

    return {
        markerId,
        markerLabel,
        markerModel,
        markerNode,
        visibleCount,
        isAnyVisible: visibleCount > 0,
    };
}

export function bindMarkerTracking(
    markerTargets: Iterable<Element>,
    handlers: MarkerTrackingHandlers = {},
): () => void {
    const markerNodes = Array.from(markerTargets)
        .filter((node): node is HTMLElement => node instanceof HTMLElement);
    const visibilityState = new Map<string, boolean>();
    const disposers: Array<() => void> = [];

    markerNodes.forEach((markerNode, index) => {
        const markerId = markerNode.id || `marker-${index + 1}`;
        visibilityState.set(markerId, false);

        const onFound = () => {
            visibilityState.set(markerId, true);
            const summary = buildMarkerDetectionSummary(markerNode, visibilityState);
            handlers.onMarkerFound?.(summary);
            handlers.onVisibilityChange?.(summary);
        };

        const onLost = () => {
            visibilityState.set(markerId, false);
            const summary = buildMarkerDetectionSummary(markerNode, visibilityState);
            handlers.onMarkerLost?.(summary);
            handlers.onVisibilityChange?.(summary);
        };

        markerNode.addEventListener("markerFound", onFound);
        markerNode.addEventListener("markerLost", onLost);

        disposers.push(() => {
            markerNode.removeEventListener("markerFound", onFound);
            markerNode.removeEventListener("markerLost", onLost);
        });
    });

    return () => {
        disposers.forEach((dispose) => dispose());
    };
}

export function resolveCatalogProxyUrl(
    search: string | URLSearchParams = window.location.search,
    paramKeys = DEFAULT_CATALOG_PROXY_PARAM_KEYS,
): string {
    const params = typeof search === "string"
        ? new URLSearchParams(search)
        : search;

    for (const key of paramKeys) {
        const value = (params.get(key) || "").trim();
        if (!value) {
            continue;
        }

        try {
            return new URL(value, window.location.href).toString();
        } catch {
            // Ignore malformed URL value and keep searching.
        }
    }

    return "";
}

function normalizeCatalogEntry(value: unknown): CatalogObjectEntry | null {
    const source = asRecord(value);
    if (!source) {
        return null;
    }

    const name = readFirstString(source, ["name", "label", "title", "objectName", "id"]);
    if (!name) {
        return null;
    }

    const kind = readFirstString(source, ["kind", "type", "category", "class"]);
    const markerPreset = readFirstString(source, ["markerPreset", "marker", "preset", "markerType"]);

    return {
        name,
        kind: toOptionalText(kind),
        massKg: toOptionalNumber(readFirstNumber(source, ["massKg", "mass_kg", "mass", "kgMass"])),
        radiusMeters: toOptionalNumber(readFirstNumber(source, ["radiusMeters", "radius_m", "radius", "sizeMeters"])),
        color: toOptionalText(readFirstString(source, ["color", "hexColor", "colour", "markerColor"])),
        parentName: toOptionalText(readFirstString(source, ["parentName", "parent", "orbitParent", "parent_name"])),
        semiMajorMeters: toOptionalNullableNumber(readFirstNumber(source, ["semiMajorMeters", "semi_major_m", "semiMajor", "semiMajorAxis"])),
        periodDays: toOptionalNullableNumber(readFirstNumber(source, ["periodDays", "period_days", "orbitalPeriodDays", "period"])),
        rotationHours: toOptionalNullableNumber(readFirstNumber(source, ["rotationHours", "rotation_hours", "rotationPeriodHours", "rotation"])),
        inclinationDeg: toOptionalNullableNumber(readFirstNumber(source, ["inclinationDeg", "inclination_deg", "inclination"])),
        markerId: toOptionalText(readFirstString(source, ["markerId", "idMarker", "marker_id"])),
        markerPreset: toOptionalText(markerPreset),
        markerLabel: toOptionalText(readFirstString(source, ["markerLabel", "markerName", "labelMarker", "marker_label"])),
        markerImage: toOptionalText(readFirstString(source, ["markerImage", "marker_image", "markerUrl", "image"])),
        markerLink: toOptionalText(readFirstString(source, ["markerLink", "marker_link", "link"])),
        markerModel: toOptionalText(readFirstString(source, ["markerModel", "model", "target", "object"])),
    };
}

function pickCatalogArrayCandidate(payload: unknown): unknown[] {
    if (Array.isArray(payload)) {
        return payload;
    }

    const source = asRecord(payload);
    if (!source) {
        return [];
    }

    const preferredKeys = ["entries", "items", "catalog", "objects", "bodies", "data", "results"];
    for (const key of preferredKeys) {
        const value = source[key];
        if (Array.isArray(value)) {
            return value;
        }
    }

    for (const value of Object.values(source)) {
        if (Array.isArray(value)) {
            return value;
        }
    }

    return [];
}

export function extractCatalogEntriesFromPayload(payload: unknown): CatalogObjectEntry[] {
    const rawItems = pickCatalogArrayCandidate(payload);
    const normalized = rawItems
        .map((item) => normalizeCatalogEntry(item))
        .filter((item): item is CatalogObjectEntry => !!item);

    const dedupedByName = new Map<string, CatalogObjectEntry>();
    normalized.forEach((entry) => {
        dedupedByName.set(entry.name.toLowerCase(), entry);
    });

    return Array.from(dedupedByName.values());
}

export async function loadCatalogFromProxy(
    proxyUrl: string,
    options: CatalogProxyLoadOptions = {},
): Promise<CatalogObjectEntry[]> {
    const timeoutMs = options.timeoutMs ?? 12000;
    const supportsAbort = typeof AbortController !== "undefined";
    const abortController = supportsAbort ? new AbortController() : null;
    const timeoutId = supportsAbort
        ? window.setTimeout(() => abortController?.abort(), timeoutMs)
        : 0;

    try {
        const response = await fetch(proxyUrl, {
            ...options.requestInit,
            cache: "no-store",
            signal: abortController ? abortController.signal : undefined,
        });

        if (!response.ok) {
            return [];
        }

        const payload: unknown = await response.json();
        return extractCatalogEntriesFromPayload(payload);
    } catch {
        return [];
    } finally {
        if (supportsAbort) {
            window.clearTimeout(timeoutId);
        }
    }
}

export function createMarkersFromCatalog(
    entries: CatalogObjectEntry[],
    fallbackMarkers: ArMarkerConfig[] = [],
): ArMarkerConfig[] {
    const markerMap = new Map<string, ArMarkerConfig>();

    const addMarker = (markerConfig: ArMarkerConfig) => {
        const marker = normalizeMarkerConfig(markerConfig);
        markerMap.set(marker.id || marker.preset, marker);
    };

    fallbackMarkers.forEach(addMarker);

    entries.forEach((entry) => {
        const markerPreset = (entry.markerPreset || "").trim();
        const markerId = (entry.markerId || "").trim();
        if (!markerPreset && !markerId) {
            return;
        }

        addMarker({
            id: markerId || undefined,
            preset: markerPreset || undefined,
            model: entry.markerModel || entry.name,
            markerLabel: entry.markerLabel || entry.name,
            markerImage: entry.markerImage,
            markerLink: entry.markerLink || entry.markerImage,
        });
    });

    return Array.from(markerMap.values());
}

export function createPrimitiveModelFromCatalogEntry(
    target: string | Element,
    entry: CatalogObjectEntry,
    options: PrimitiveModelCreateOptions = {},
): HTMLElement {
    const hostNode = resolveHostNode(target);
    const wrapper = document.createElement("a-entity");
    const radiusScale = options.radiusScale ?? 1;
    const radiusMeters = Number.isFinite(entry.radiusMeters) ? Number(entry.radiusMeters) : 6.371e6;
    const radius = clamp((0.08 + Math.log10(Math.max(radiusMeters, 1)) * 0.04) * radiusScale, 0.03, 0.68);
    const color = (entry.color || options.defaultColor || "#84aee4").trim() || "#84aee4";

    wrapper.setAttribute("position", options.position || "0 0 0");
    wrapper.setAttribute("data-proxy-object", entry.name);

    const bodyEntity = document.createElement("a-entity");
    bodyEntity.setAttribute("geometry", `primitive: sphere; radius: ${radius.toFixed(4)}`);
    bodyEntity.setAttribute("material", `shader: flat; color: ${color}; side: double; depthTest: false; depthWrite: false`);
    wrapper.appendChild(bodyEntity);

    if (options.includeLabel !== false) {
        const labelEntity = document.createElement("a-text");
        labelEntity.setAttribute("value", entry.name);
        labelEntity.setAttribute("align", "center");
        labelEntity.setAttribute("width", "2.5");
        labelEntity.setAttribute("color", "#d7e7ff");
        labelEntity.setAttribute("position", `0 ${(radius * 1.85).toFixed(4)} 0`);
        labelEntity.setAttribute("side", "double");
        wrapper.appendChild(labelEntity);
    }

    hostNode.appendChild(wrapper);
    return wrapper;
}

export function parseArRequestFromSearch(
    search: string | URLSearchParams = window.location.search,
    options: ArRequestParseOptions = {},
): ArRequestSummary {
    const params = typeof search === "string"
        ? new URLSearchParams(search)
        : search;

    const modelParamKeys = options.modelParamKeys ?? ["model", "object", "target", "name"];
    const defaultModel = (options.defaultModel || "Bumi").trim() || "Bumi";
    const defaultAltModel = (options.defaultAltModel || "Mars").trim() || "Mars";
    const defaultBuildToken = (options.defaultBuildToken || "latest").trim() || "latest";

    let model = "";
    for (const key of modelParamKeys) {
        const value = (params.get(key) || "").trim();
        if (value) {
            model = value;
            break;
        }
    }

    return {
        model: model || defaultModel,
        altModel: (params.get("altModel") || defaultAltModel).trim() || defaultAltModel,
        buildToken: (params.get("build") || defaultBuildToken).trim() || defaultBuildToken,
    };
}

export function createDefaultArMarkers(model = "Bumi", altModel = "Mars"): ArMarkerConfig[] {
    return [
        {
            id: "orbinex-marker-hiro",
            preset: "hiro",
            model,
            markerLabel: "Hiro",
            markerImage: MARKER_HIRO_URL,
            markerLink: MARKER_HIRO_URL,
        },
        {
            id: "orbinex-marker-kanji",
            preset: "kanji",
            model: altModel,
            markerLabel: "Kanji",
            markerImage: MARKER_KANJI_URL,
            markerLink: MARKER_KANJI_URL,
        },
    ];
}

export function ensureArMarkers(
    sceneTarget: string | Element,
    markerConfigs: ArMarkerConfig[],
    options: EnsureArMarkersOptions = {},
): HTMLElement[] {
    const sceneEl = resolveHostNode(sceneTarget);
    const createMissing = options.createMissing ?? true;
    const ensureModelRootEnabled = options.ensureModelRoot ?? true;
    const ensuredMarkers: HTMLElement[] = [];

    markerConfigs.forEach((config) => {
        const marker = normalizeMarkerConfig(config);
        let markerEl = sceneEl.querySelector<HTMLElement>(`#${CSS.escape(marker.id)}`);

        if (!markerEl && marker.preset) {
            markerEl = sceneEl.querySelector<HTMLElement>(`a-marker[preset="${marker.preset}"]`);
        }

        if (!markerEl && createMissing) {
            markerEl = document.createElement("a-marker");
            sceneEl.appendChild(markerEl);
            ensureMarkerPlane(markerEl);
        }

        if (!markerEl) {
            return;
        }

        applyMarkerDataset(markerEl, marker);
        if (ensureModelRootEnabled) {
            ensureModelRoot(markerEl);
        }

        ensuredMarkers.push(markerEl);
    });

    return ensuredMarkers;
}

export function resolveArMarkerHint(
    markerNode: Element | null | undefined,
    fallbackUrl = MARKER_HIRO_URL,
): ArMarkerHintSummary {
    const markerImage = (markerNode?.getAttribute("data-marker-image") || fallbackUrl).trim() || fallbackUrl;
    const markerLink = (markerNode?.getAttribute("data-marker-link") || markerImage).trim() || markerImage;
    const markerLabel = (markerNode?.getAttribute("data-marker-label") || "Hiro").trim() || "Hiro";

    return {
        markerImage,
        markerLink,
        markerLabel,
    };
}

export async function requestRuntimePermissions(
    options: PermissionRequestOptions = {},
): Promise<PermissionRequestSummary> {
    const wantsCamera = options.camera ?? false;
    const wantsMicrophone = options.microphone ?? false;
    const wantsGeolocation = options.geolocation ?? false;
    const wantsMotionSensors = options.motionSensors ?? false;

    const [camera, microphone, geolocation, motionSensors] = await Promise.all([
        wantsCamera ? requestCameraPermission() : Promise.resolve(DEFAULT_PERMISSION_SUMMARY.camera),
        wantsMicrophone ? requestMicrophonePermission() : Promise.resolve(DEFAULT_PERMISSION_SUMMARY.microphone),
        wantsGeolocation ? requestGeolocationPermission() : Promise.resolve(DEFAULT_PERMISSION_SUMMARY.geolocation),
        wantsMotionSensors ? requestMotionSensorPermission() : Promise.resolve(DEFAULT_PERMISSION_SUMMARY.motionSensors),
    ]);

    return {
        camera: normalizePermissionResult(camera),
        microphone: normalizePermissionResult(microphone),
        geolocation: normalizePermissionResult(geolocation),
        motionSensors: normalizePermissionResult(motionSensors),
    };
}
