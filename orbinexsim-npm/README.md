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

## Catatan

- Module ini menggunakan `@galihru/orbinex` untuk kalkulasi dasar orbit.
- Untuk mode AR, browser/user tetap bisa menolak permission kamera/sensor.
- Default host viewer: `https://galihru.github.io/OrbinexSimulation/`

## Publish

```bash
npm run build
npm publish --access public
```
