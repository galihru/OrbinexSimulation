# @galihru/orbinexsim

OrbinexSim adalah wrapper tingkat tinggi agar kamu bisa pakai Orbinex desktop + AR tanpa menulis ribuan baris kode.

## Install

```bash
npm i @galihru/orbinexsim
```

## Pemakaian Paling Ringkas

```ts
import { createOrbinexSim } from "@galihru/orbinexsim";

const sim = createOrbinexSim("#app", {
  mode: "desktop",
  model: "Bumi",
  autoRequestAccess: true,
});

// pindah ke AR kapan saja
await sim.launchAr({ camera: true, motionSensors: true });
```

## API Inti

- `createOrbinexSim(target, options)`
- `sim.setMode("desktop" | "ar")`
- `sim.setModel("Bumi")`
- `sim.launchAr({ camera: true })`
- `sim.requestAccess({ camera: true, geolocation: true })`
- `sim.buildQuickReport(radiusMeters)`

## API AR Runtime (Marker + Permission)

```ts
import {
  bindMarkerTracking,
  createMarkersFromCatalog,
  createPrimitiveModelFromCatalogEntry,
  parseArRequestFromSearch,
  resolveCatalogProxyUrl,
  loadCatalogFromProxy,
  resolveObjectNameForMarker,
  createDefaultArMarkers,
  ensureArMarkers,
  resolveArMarkerHint,
  requestRuntimePermissions,
} from "@galihru/orbinexsim/ar-runtime";

const request = parseArRequestFromSearch(window.location.search);
const markers = createDefaultArMarkers(request.model, request.altModel);
const markerEls = ensureArMarkers("#ar-scene", markers, {
  createMissing: true,
  ensureModelRoot: true,
});

const stopMarkerTracking = bindMarkerTracking(markerEls, {
  onMarkerFound: (summary) => {
    console.log("found", summary.markerModel, summary.markerLabel);
  },
});

const catalogProxyUrl = resolveCatalogProxyUrl(window.location.search);
const proxyEntries = catalogProxyUrl ? await loadCatalogFromProxy(catalogProxyUrl) : [];
const proxyMarkers = createMarkersFromCatalog(proxyEntries, markers);
ensureArMarkers("#ar-scene", proxyMarkers, { createMissing: true, ensureModelRoot: true });

if (proxyEntries[0]) {
  createPrimitiveModelFromCatalogEntry("#model-root-hiro", proxyEntries[0], {
    includeLabel: true,
    radiusScale: 1,
  });
}

const hint = resolveArMarkerHint(markerEls[0]);
const objectName = resolveObjectNameForMarker(markerEls[0], request.model);
const permissions = await requestRuntimePermissions({
  camera: true,
  motionSensors: true,
  geolocation: true,
  microphone: true,
});
```

- `parseArRequestFromSearch(...)`: parse `model`, `altModel`, dan `build`.
- `createDefaultArMarkers(...)`: generate konfigurasi marker Hiro + Kanji.
- `ensureArMarkers(...)`: auto create marker jika belum ada di scene.
- `bindMarkerTracking(...)`: helper scan AR marker (`markerFound`/`markerLost`) + object detection summary.
- `resolveObjectNameForMarker(...)`: baca object target dari marker.
- `resolveArMarkerHint(...)`: ambil URL marker + label dari elemen marker.
- `requestRuntimePermissions(...)`: helper permission runtime tanpa bikin instance iframe.
- `resolveCatalogProxyUrl(...)`: baca URL proxy catalog dari query string.
- `loadCatalogFromProxy(...)`: fetch database/catalog object dari proxy link.
- `createMarkersFromCatalog(...)`: auto map catalog proxy -> marker config.
- `extractCatalogEntriesFromPayload(...)`: parse payload proxy ke format catalog module.
- `createPrimitiveModelFromCatalogEntry(...)`: auto create model 3D primitive dari data catalog.

## Catatan

- Module ini menggunakan `@galihru/orbinex` untuk kalkulasi dasar orbit.
- Untuk mode AR, browser/user tetap bisa menolak permission kamera/sensor.
- Default host viewer: `https://galihru.github.io/OrbinexSimulation/`

## Publish

```bash
npm run build
npm publish --access public
```
