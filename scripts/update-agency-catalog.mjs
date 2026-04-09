import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(__dirname, "..", "public", "data", "agency-catalog.json");

const fallbackNasaRows = [
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
    st_rad: 1.11
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
    st_rad: 0.12
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
    st_rad: 0.154
  },
  {
    pl_name: "LHS 1140 b",
    hostname: "LHS 1140",
    ra: 0,
    dec: -15.27,
    sy_dist: 14.99,
    pl_orbsmax: 0.093,
    pl_orbper: 24.7,
    pl_bmasse: 6.98,
    pl_rade: 1.73,
    st_mass: 0.18,
    st_rad: 0.21
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
    st_rad: 1.63
  }
];

const esaFallbackEntries = [
  {
    name: "Gaia BH1",
    kind: "black-hole",
    raDeg: 262.47,
    decDeg: -5.34,
    distancePc: 480,
    colorHex: "#8ba0ff",
    description: "Objek kandidat black hole dari observasi Gaia (referensi sains ESA).",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/Black_hole_-_Messier_87_crop_max_res.jpg/640px-Black_hole_-_Messier_87_crop_max_res.jpg"
  },
  {
    name: "K2-18 b",
    kind: "planet",
    raDeg: 172.11,
    decDeg: 7.59,
    distancePc: 38.7,
    colorHex: "#9ec7ff",
    description: "Eksoplanet kandidat layak huni yang sering dirujuk pada materi eksoplanet ESA.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8e/Exoplanet_Comparison_K2-18b.png/640px-Exoplanet_Comparison_K2-18b.png"
  },
  {
    name: "Gaia DR3 Anchor",
    kind: "cluster",
    raDeg: 56.75,
    decDeg: 24.12,
    distancePc: 120,
    colorHex: "#9fd6ff",
    description: "Anchor cluster sintetis untuk menampilkan ingest ESA/Gaia pada simulasi web.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Pleiades_large.jpg/640px-Pleiades_large.jpg"
  }
];

const jaxaFallbackEntries = [
  {
    name: "MAXI J1820+070",
    kind: "black-hole",
    raDeg: 275.09,
    decDeg: 7.18,
    distancePc: 960,
    colorHex: "#7e8bff",
    description: "Sumber sinar-X biner yang aktif pada observasi misi MAXI/JAXA.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Artist%E2%80%99s_impression_of_Cygnus_X-1.jpg/640px-Artist%E2%80%99s_impression_of_Cygnus_X-1.jpg"
  },
  {
    name: "Hitomi Legacy Field",
    kind: "nebula",
    raDeg: 83.63,
    decDeg: 22.01,
    distancePc: 2000,
    colorHex: "#8fc8d8",
    description: "Area referensi observasi spektrum energi tinggi yang dikurasi dari publikasi JAXA.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/Orion_Nebula_-_Hubble_2006_mosaic_18000.jpg/640px-Orion_Nebula_-_Hubble_2006_mosaic_18000.jpg"
  },
  {
    name: "Hayabusa Corridor",
    kind: "other",
    raDeg: 187.4,
    decDeg: -5.1,
    distancePc: 4,
    colorHex: "#b9c8e8",
    description: "Koridor lintasan sintetis misi Hayabusa/Hayabusa2 untuk meniru ingest JAXA pada HUD.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Hayabusa2_at_Ryugu_%28artist%27s_impression%29.jpg/640px-Hayabusa2_at_Ryugu_%28artist%27s_impression%29.jpg"
  }
];

const nedFallbackEntries = [
  {
    name: "NGC 1300",
    kind: "galaxy",
    raDeg: 49.92,
    decDeg: -19.41,
    distancePc: 19000000,
    colorHex: "#9cb8e2",
    description: "Galaksi spiral berbatang dari katalog NED/IPAC (fallback kurasi).",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c4/NGC_1300_HST.jpg/640px-NGC_1300_HST.jpg"
  },
  {
    name: "NGC 4993",
    kind: "galaxy",
    raDeg: 197.45,
    decDeg: -23.38,
    distancePc: 40000000,
    colorHex: "#93afd4",
    description: "Galaksi host dari event gelombang gravitasi GW170817 yang tercantum pada NED.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/07/NGC_4993_Hubble_WFC3.jpg/640px-NGC_4993_Hubble_WFC3.jpg"
  },
  {
    name: "Centaurus A",
    kind: "galaxy",
    raDeg: 201.37,
    decDeg: -43.02,
    distancePc: 3800000,
    colorHex: "#9db7cf",
    description: "Galaksi radio aktif populer di basis data ekstragalaksi NED.",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Centaurus_A.jpg/640px-Centaurus_A.jpg"
  }
];

function withTimeout(signalMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), signalMs);
  return { controller, timeout };
}

async function fetchJson(url, timeoutMs = 12000) {
  const { controller, timeout } = withTimeout(timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json,text/plain,*/*",
        "User-Agent": "OrbinexSimulationCatalogUpdater/1.0"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function probe(url, timeoutMs = 9000) {
  const { controller, timeout } = withTimeout(timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "text/plain,text/html,application/xml,*/*",
        "User-Agent": "OrbinexSimulationCatalogUpdater/1.0"
      },
      signal: controller.signal
    });

    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchNasaRows() {
  const query = encodeURIComponent(
    "select top 120 pl_name,hostname,ra,dec,sy_dist,pl_orbsmax,pl_orbper,pl_bmasse,pl_rade,st_mass,st_rad from pscomppars where ra is not null and dec is not null and sy_dist is not null"
  );
  const url = `https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=${query}&format=json`;

  const rows = await fetchJson(url, 14000);
  if (Array.isArray(rows) && rows.length > 0) {
    return {
      mode: "online",
      note: `NASA TAP fetched rows=${rows.length}`,
      rows
    };
  }

  return {
    mode: "fallback",
    note: "NASA TAP unavailable, fallback rows used",
    rows: fallbackNasaRows
  };
}

function createPayload(nasa, esaOnline, jaxaOnline, nedOnline) {
  return {
    generatedAt: new Date().toISOString(),
    nasa,
    agencies: {
      ESA: {
        mode: esaOnline ? "online" : "fallback",
        note: esaOnline ? "ESA endpoint reachable during build" : "ESA endpoint unreachable, curated fallback used",
        entries: esaFallbackEntries
      },
      JAXA: {
        mode: jaxaOnline ? "online" : "fallback",
        note: jaxaOnline ? "JAXA endpoint reachable during build" : "JAXA endpoint unreachable, curated fallback used",
        entries: jaxaFallbackEntries
      },
      NED: {
        mode: nedOnline ? "online" : "fallback",
        note: nedOnline ? "NED endpoint reachable during build" : "NED endpoint unreachable, curated fallback used",
        entries: nedFallbackEntries
      }
    }
  };
}

async function run() {
  const nasa = await fetchNasaRows();
  const [esaOnline, jaxaOnline, nedOnline] = await Promise.all([
    probe("https://www.esa.int/rssfeed/Our_Activities/Space_Science"),
    probe("https://global.jaxa.jp/feeds/news/index.xml"),
    probe("https://ned.ipac.caltech.edu/")
  ]);

  const payload = createPayload(nasa, esaOnline, jaxaOnline, nedOnline);
  await mkdir(resolve(__dirname, "..", "public", "data"), { recursive: true });
  await writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");

  console.log(
    `[catalog:update] ok nasa=${payload.nasa.mode} esa=${payload.agencies.ESA.mode} jaxa=${payload.agencies.JAXA.mode} ned=${payload.agencies.NED.mode}`
  );
}

run().catch(async (error) => {
  const payload = createPayload(
    {
      mode: "fallback",
      note: "Unexpected updater error, fallback rows used",
      rows: fallbackNasaRows
    },
    false,
    false,
    false
  );

  await mkdir(resolve(__dirname, "..", "public", "data"), { recursive: true });
  await writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");
  console.error("[catalog:update] error, fallback file written", error);
  process.exitCode = 0;
});
