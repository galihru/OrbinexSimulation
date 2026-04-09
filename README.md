# OrbinexSimulation

OrbinexSimulation adalah website simulasi semesta 3D (bukan tutorial page) yang mengkonsumsi modul npm publik `@galihru/orbinex` untuk mendukung dependency graph dan target `Used by`.

## Fokus proyek

- Simulasi 3D aktif dengan objek kosmik: planet, bulan, dwarf planet, asteroid, kuiper object, komet, meteor, nebula, galaksi, cluster, black hole.
- Kontrol real-time: run/pause, step, spawn meteor/comet, trigger supernova, camera focus.
- Forecasting dan recommendation panel (state report, forecast, event, AI recommendation).
- Command terminal interaktif di halaman web.
- Aksesibilitas dan SEO baseline: skip-link, semantic landmarks, ARIA live region, Open Graph, Twitter cards, JSON-LD.

## Catatan kompatibilitas npm

Versi npmjs saat ini masih `@galihru/orbinex@0.1.0`, sehingga API simulasi website dipetakan lewat adapter lokal [src/orbinex-compat.ts](src/orbinex-compat.ts). Adapter tetap memakai formula dari package publish `@galihru/orbinex` lalu menambahkan API engine untuk website.

## Menjalankan lokal

1. Install dependency:

```bash
npm install
```

2. Jalankan dev mode:

```bash
npm run dev
```

3. Build production:

```bash
npm run build
```

## Deploy GitHub Pages

Workflow Pages sudah disediakan di [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml).

Langkah aktivasi:

1. Buat repository publik `galihru/OrbinexSimulation`.
2. Push isi project ini ke branch `main`.
3. Di repository settings, aktifkan Pages dengan source: `GitHub Actions`.
4. Push berikutnya ke `main` akan otomatis build dan deploy.

Target URL live:

- `https://galihru.github.io/OrbinexSimulation/`

## Kontribusi ke Used by

Agar repo utama package menampilkan consumer ini pada tab `Used by`, pastikan file [package.json](package.json) tetap memiliki dependency npm publik berikut:

```json
"dependencies": {
  "@galihru/orbinex": "^0.1.0"
}
```

Setelah repository public dan terindeks oleh GitHub dependency graph, entry `Used by` akan muncul otomatis.
