declare module "*.css";

declare const __BUILD_HASH__: string;

interface ImportMetaEnv {
    readonly BASE_URL: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}

declare module "@galihru/orbinex" {
    export const constants: {
        gravitationalConstant: number;
        solarMassKg: number;
        auMeters: number;
        parsecMeters: number;
        [key: string]: number;
    };

    export function circularOrbitSpeed(primaryMassKg: number, orbitalRadiusMeters: number): number;

    export function createOrbitSample(primaryMassKg: number, orbitalRadiusMeters: number): unknown;

    export function equatorialToCartesian(input: {
        rightAscensionDeg: number;
        declinationDeg: number;
        distanceParsec: number;
    }): {
        xMeters: number;
        yMeters: number;
        zMeters: number;
    };

    export function generateSimulationReport(sample: unknown): string;

    export function orbitalPeriodFromSemiMajorAxis(
        semiMajorAxisMeters: number,
        primaryMassKg: number,
    ): number;
}
