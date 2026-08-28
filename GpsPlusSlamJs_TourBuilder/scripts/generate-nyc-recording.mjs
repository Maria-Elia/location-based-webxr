#!/usr/bin/env node
/**
 * Generates a synthetic NYC walk recording that road-follows real OpenStreetMap
 * street centerlines and takes two real corners, instead of a straight line
 * between two endpoints.
 *
 * WHY THIS EXISTS: the previous fixture
 * (recordings/2026-08-28_14-00-00utc_nyc-42nd-street-walk.zip, notes:
 * "Synthetic: real device motion, GPS relabeled onto a 42nd St, Manhattan
 * walk") had its GPS track bow up to ~103 m off the straight line between its
 * start/end points — nowhere near the real road. There was no generator
 * script for it in the repo to fix, so this one rebuilds the fixture from
 * scratch, in the same production zip format (see zip-export.ts.md), with a
 * route whose vertices are pulled from real road geometry.
 *
 * Route: West 42nd Street (8th Ave -> 6th Ave), turn north onto 6th Avenue
 * (42nd -> 43rd), turn east onto 43rd Street (6th Ave -> 5th Ave). Two real
 * corners. Waypoints below are literal OSM way-geometry coordinates, fetched
 * via the Overpass API on 2026-08-28 (query: highway ways named "West 42nd
 * Street" / "6th Avenue" / "West 43rd Street" / "East 43rd Street" in a
 * bounding box around Bryant Park; corner points are the numeric segment
 * intersections). Bryant Park spans the full block between 40th/42nd and
 * 5th/6th, so 41st/40th Streets do NOT cross between 5th and 6th Ave there —
 * 43rd Street was picked deliberately because it does.
 *
 * Simplifying assumption: the device's AR/visual-inertial tracking is
 * simulated as perfect (identity alignment) — odometry is the exact NUE
 * offset of the true route position from the zero reference, so the ONLY
 * noise in the fixture is realistic GPS jitter (~4-7 m std) around the true,
 * road-following position. `odomRotation` is a yaw-only quaternion aligned to
 * the direction of travel — a plausible placeholder, not a physically
 * simulated IMU.
 *
 * Images are real photos reused (cycled) from the previous recording's
 * captures (scripts/nyc-recording-assets/ph-*.jpg) purely as valid, small
 * JPEG payloads for gpsData/add2dImage — they do not depict this route.
 *
 * Usage: node scripts/generate-nyc-recording.mjs
 */
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ZipWriter,
  Uint8ArrayWriter,
  TextReader,
  Uint8ArrayReader,
} from "@zip.js/zip.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const ASSETS_DIR = path.join(__dirname, "nyc-recording-assets");
const OUTPUT_DIR = path.join(REPO_ROOT, "recordings");

// ---------------------------------------------------------------------------
// Route: real OSM road centerlines (Overpass API, retrieved 2026-08-28)
// ---------------------------------------------------------------------------

/** West 42nd Street, from 8th Ave to 6th Ave. */
const LEG1 = [
  [40.7572335, -73.9897914],
  [40.7571772, -73.9896581],
  [40.7567704, -73.9886922],
  [40.7566978, -73.9885199],
  [40.7566551, -73.9884184],
  [40.756617, -73.988328],
  [40.7562616, -73.9874841],
  [40.7561464, -73.9872107],
  [40.7560868, -73.9870695],
  [40.7560361, -73.9869489],
  [40.7558193, -73.9864249],
  [40.7557622, -73.9862894],
  [40.7556525, -73.9860306],
  [40.7556053, -73.9859192],
  [40.7554706, -73.9856013],
  [40.7549032, -73.9842621],
  [40.754842, -73.984118],
];
/** 6th Avenue, from 42nd St to 43rd St (turn 1: north). */
const LEG2 = [
  [40.754842, -73.984118],
  [40.75494, -73.98405],
  [40.75496, -73.98403],
  [40.75545, -73.98367],
  [40.755516, -73.983624],
];
/** West/East 43rd Street, from 6th Ave to 5th Ave (turn 2: east). */
const LEG3 = [
  [40.755516, -73.983624],
  [40.7554619, -73.9834958],
  [40.7548731, -73.9821009],
  [40.7542195, -73.9805207],
  [40.7541655, -73.9803921],
];

const ROUTE_LATLON = [...LEG1, ...LEG2.slice(1), ...LEG3.slice(1)];

// ---------------------------------------------------------------------------
// Local ENU (metres) <-> lat/lon, anchored at the route's first point.
// Same equirectangular approximation the framework/osm packages use
// (see GpsPlusSlamJs_Osm/src/mesh/enu.ts) — accurate to well under 1% at
// this ~1 km scale.
// ---------------------------------------------------------------------------
const ORIGIN = { lat: ROUTE_LATLON[0][0], lon: ROUTE_LATLON[0][1] };
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);

function toEnu([lat, lon]) {
  return [
    (lon - ORIGIN.lon) * M_PER_DEG_LON,
    (lat - ORIGIN.lat) * M_PER_DEG_LAT,
  ];
}
function toLatLon([x, y]) {
  return [ORIGIN.lat + y / M_PER_DEG_LAT, ORIGIN.lon + x / M_PER_DEG_LON];
}

// ---------------------------------------------------------------------------
// Corner rounding: Chaikin corner-cutting on the ENU polyline. Endpoints of
// the whole route are preserved; every interior vertex (including the two
// real street corners) gets rounded — a pedestrian doesn't walk a perfect
// right angle. Vertices that are already near-collinear (the gentle bends
// inside the real road polyline) are barely affected.
// ---------------------------------------------------------------------------
function chaikinSmooth(points, iterations) {
  let pts = points;
  for (let iter = 0; iter < iterations; iter++) {
    const next = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      next.push([x0 + 0.25 * (x1 - x0), y0 + 0.25 * (y1 - y0)]);
      next.push([x0 + 0.75 * (x1 - x0), y0 + 0.75 * (y1 - y0)]);
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  return pts;
}

function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(
      points[i][0] - points[i - 1][0],
      points[i][1] - points[i - 1][1],
    );
  }
  return total;
}

/** Resamples a polyline at fixed arc-length spacing, returning ENU points. */
function resampleByArcLength(points, spacingM) {
  const total = pathLength(points);
  const out = [];
  let target = 0;
  let segIndex = 0;
  let segAccumulated = 0;
  out.push(points[0]);
  target += spacingM;
  while (target < total) {
    while (segIndex < points.length - 1) {
      const [x0, y0] = points[segIndex];
      const [x1, y1] = points[segIndex + 1];
      const segLen = Math.hypot(x1 - x0, y1 - y0);
      if (segAccumulated + segLen >= target) {
        const t = segLen === 0 ? 0 : (target - segAccumulated) / segLen;
        out.push([x0 + t * (x1 - x0), y0 + t * (y1 - y0)]);
        break;
      }
      segAccumulated += segLen;
      segIndex++;
    }
    target += spacingM;
  }
  out.push(points[points.length - 1]);
  return out;
}

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) + Box-Muller gaussian — reproducible fixture.
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeGaussian(rng) {
  let spare = null;
  return () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u, v, s;
    do {
      u = rng() * 2 - 1;
      v = rng() * 2 - 1;
      s = u * u + v * v;
    } while (s === 0 || s >= 1);
    const mul = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * mul;
    return u * mul;
  };
}

// ---------------------------------------------------------------------------
// Build the walk
// ---------------------------------------------------------------------------
const WALK_SPEED_M_S = 1.2; // realistic pedestrian pace
const SAMPLE_DT_S = 0.5; // 2 Hz recordGpsEvent, matches original recording's density
const IMAGE_INTERVAL_S = 2.0;
// A tiny, LOW-PASS-FILTERED wander, not independent per-sample jitter — see
// "Denoising" below. The raw std feeds an EMA filter, so the actual visible
// wander is much smaller than this number by itself.
const GPS_NOISE_RAW_STD_M = 1.5;
const GPS_NOISE_EMA_ALPHA = 0.06; // ~8-sample (4s) time constant at 2 Hz
const START_EPOCH_MS = Date.UTC(2026, 7, 28, 16, 0, 0); // 2026-08-28T16:00:00Z

const rng = mulberry32(20260828);
const gaussian = makeGaussian(rng);

const routeEnu = ROUTE_LATLON.map(toEnu);
const smoothedEnu = chaikinSmooth(routeEnu, 3);
const spacing = WALK_SPEED_M_S * SAMPLE_DT_S;
const samplesEnu = resampleByArcLength(smoothedEnu, spacing);

function headingDeg(prev, next) {
  const dx = next[0] - prev[0];
  const dy = next[1] - prev[1];
  // Bearing from north, clockwise (compass convention): atan2(east, north).
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
  return (deg + 360) % 360;
}

// ---------------------------------------------------------------------------
// Denoising: earlier revision added independent per-sample gaussian jitter to
// each GPS fix, which is realistic for a real receiver but produces a visibly
// wobbly breadcrumb trail when connected point-to-point — every sample was an
// uncorrelated coin flip. What actually matters here is that whatever draws
// breadcrumbs/waypoints from this recording later gets a SMOOTH path. So the
// wander is generated once as a slow-moving offset (EMA-filtered gaussian,
// ~4s time constant) rather than resampled independently every tick — it
// drifts gently instead of jumping. `heading`/`speed` are then derived from
// the resulting smoothed path itself (central difference / distance-over-
// time) instead of carrying their own separate noise, so they stay exactly
// consistent with the positions a consumer would see — no jitter mismatch
// between "where the dot is" and "which way it's facing".
// ---------------------------------------------------------------------------
function emaSmooth(values, alpha) {
  const out = new Array(values.length);
  out[0] = values[0];
  for (let i = 1; i < values.length; i++) {
    out[i] = alpha * values[i] + (1 - alpha) * out[i - 1];
  }
  return out;
}

const rawNoiseE = samplesEnu.map(() => gaussian() * GPS_NOISE_RAW_STD_M);
const rawNoiseN = samplesEnu.map(() => gaussian() * GPS_NOISE_RAW_STD_M);
const noiseE = emaSmooth(rawNoiseE, GPS_NOISE_EMA_ALPHA);
const noiseN = emaSmooth(rawNoiseN, GPS_NOISE_EMA_ALPHA);

const noisyEnu = samplesEnu.map(([x, y], i) => [x + noiseE[i], y + noiseN[i]]);

const samples = samplesEnu.map((enu, i) => {
  const prevTrue = samplesEnu[Math.max(0, i - 1)];
  const nextTrue = samplesEnu[Math.min(samplesEnu.length - 1, i + 1)];
  const [lat, lon] = toLatLon(enu);

  const noisy = noisyEnu[i];
  const prevNoisy = noisyEnu[Math.max(0, i - 1)];
  const nextNoisy = noisyEnu[Math.min(noisyEnu.length - 1, i + 1)];
  const [noisyLat, noisyLon] = toLatLon(noisy);
  const dt = Math.min(i, 1) + Math.min(samplesEnu.length - 1 - i, 1); // 1 or 2 half-steps
  const stepSeconds = (dt || 1) * SAMPLE_DT_S;
  const speed =
    Math.hypot(nextNoisy[0] - prevNoisy[0], nextNoisy[1] - prevNoisy[1]) /
    stepSeconds;

  return {
    t: i * SAMPLE_DT_S,
    enu,
    lat,
    lon,
    headingTrue: headingDeg(prevTrue, nextTrue),
    noisyLat,
    noisyLon,
    headingNoisy: headingDeg(prevNoisy, nextNoisy),
    speedNoisy: speed,
  };
});

const totalDurationS = samples[samples.length - 1].t;
const routeLengthM = pathLength(routeEnu);
console.log(
  `Route: ${ROUTE_LATLON.length} OSM waypoints, ${routeLengthM.toFixed(1)} m, ` +
    `2 corners -> ${samples.length} samples over ${totalDurationS.toFixed(1)} s`,
);

// ---------------------------------------------------------------------------
// Assemble Redux actions in the production recording format
// (see GpsPlusSlamJs_AppFramework/src/storage/zip-export.ts.md,
// src/storage/zip-reader.ts, and RecordGpsEventPayload / RawGpsPoint in
// gps-plus-slam-js).
// ---------------------------------------------------------------------------
const actions = [];
let imageCount = 0;

actions.push({
  type: "recording/startSession",
  payload: {
    scenarioName: "Default Scenario",
    sessionName: "recording-2026-08-28_16-00-00utc",
    startTime: START_EPOCH_MS,
    deviceInfo:
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36",
    notes:
      "Synthetic: road-following walk, real OSM street centerlines (West 42nd St -> 6th Ave -> West/East 43rd St), 2 real corners",
    recordingOptions: {
      depth: { enabled: false, intervalMs: 1000, gridSize: 16, rgb: true },
      images: {
        enabled: true,
        intervalMs: 2000,
        quality: 0.7,
        resolutionDivisor: 1,
      },
      arCrashIsolation: {
        enableDomOverlay: true,
        enableCameraAccess: true,
        enableDepthSensingFeature: true,
        enableCss3dRenderer: true,
        enableCameraTextureAcquisition: true,
        applyChromiumProjectionLayerWorkaround: true,
      },
    },
  },
});

actions.push({
  type: "gpsData/setZeroPos",
  payload: { lat: ORIGIN.lat, lon: ORIGIN.lon },
});

actions.push({ type: "refPoints/setImportedRefPointEntries", payload: [] });

let nextImageAt = 0;
const imageWrites = []; // { imageFile, sourceAssetIndex }

for (let i = 0; i < samples.length; i++) {
  const s = samples[i];
  const [trueE, trueN] = s.enu;

  // Odometry: identity alignment — the exact NUE offset of the true position
  // from the zero reference. NUE = [North, Up, East]. Up = phone height with
  // a small gait bob.
  const up = 1.4 + 0.05 * Math.sin((2 * Math.PI * s.t) / 1.0);
  const odomPosition = [trueN, up, trueE];

  const headingRad = (s.headingTrue * Math.PI) / 180;
  const odomRotation = [
    0,
    Math.sin(headingRad / 2),
    0,
    Math.cos(headingRad / 2),
  ];

  actions.push({
    type: "gpsData/recordGpsEvent",
    payload: {
      odomPosition,
      odomRotation,
      rawGpsPoint: {
        id: `gps-${i + 1}`,
        latitude: s.noisyLat,
        longitude: s.noisyLon,
        altitude: 12.0,
        latLongAccuracy: 4 + rng() * 3,
        heading: s.headingNoisy,
        speed: s.speedNoisy,
        compassAbsolute: false,
        timestamp: START_EPOCH_MS + s.t * 1000,
      },
    },
  });

  if (s.t >= nextImageAt) {
    imageCount++;
    const imageFile = `images/frame-${String(imageCount).padStart(6, "0")}.jpg`;
    actions.push({
      type: "gpsData/add2dImage",
      payload: {
        imageFile,
        position: odomPosition,
        rotation: odomRotation,
        screenRotation: 0,
        capturedAt: START_EPOCH_MS + s.t * 1000,
        width: 864,
        height: 1920,
      },
    });
    imageWrites.push({ imageFile, sourceAssetIndex: (imageCount - 1) % 12 });
    nextImageAt += IMAGE_INTERVAL_S;
  }
}

console.log(
  `Actions: ${actions.length} total (${samples.length} gpsData/recordGpsEvent, ${imageCount} gpsData/add2dImage)`,
);

// ---------------------------------------------------------------------------
// Write the zip in the production layout: session.json, actions/NNNNNN.json,
// images/frame-NNNNNN.jpg — store mode (no compression), matching zip-export.ts.
// ---------------------------------------------------------------------------
async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const placeholderNames = (await readdir(ASSETS_DIR))
    .filter((f) => f.endsWith(".jpg"))
    .sort();
  const placeholders = await Promise.all(
    placeholderNames.map((f) => readFile(path.join(ASSETS_DIR, f))),
  );
  if (placeholders.length === 0) {
    throw new Error(`No placeholder images found in ${ASSETS_DIR}`);
  }

  const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 0 });

  const startedAt = new Date(START_EPOCH_MS).toISOString();
  const endedAt = new Date(
    START_EPOCH_MS + totalDurationS * 1000,
  ).toISOString();
  const sessionJson = {
    version: 1,
    odomCoordVersion: 5,
    startedAt,
    endedAt,
    contextTag:
      "NYC 42nd St -> 6th Ave -> 43rd St walk (synthetic, road-following)",
    actionCount: actions.length,
    frameCount: imageCount,
    userAgent: "synthetic-stitched-recording",
    build: {
      commitHash: "synthetic",
      appVersion: "0.1.0",
      libraryVersion: "1.3.0",
      frameworkVersion: "1.3.0",
      buildTime: startedAt,
    },
    pageUrl: "synthetic://nyc-42nd-6th-43rd-turn-walk",
  };
  await writer.add(
    "session.json",
    new TextReader(JSON.stringify(sessionJson, null, 2)),
  );

  for (let i = 0; i < actions.length; i++) {
    const filename = `actions/${String(i + 1).padStart(6, "0")}.json`;
    await writer.add(
      filename,
      new TextReader(JSON.stringify(actions[i], null, 2)),
    );
  }

  for (const { imageFile, sourceAssetIndex } of imageWrites) {
    await writer.add(
      imageFile,
      new Uint8ArrayReader(placeholders[sourceAssetIndex]),
    );
  }

  const zipBytes = await writer.close();
  const outputPath = path.join(
    OUTPUT_DIR,
    "2026-08-28_16-00-00utc_nyc-42nd-6th-43rd-turn-walk.zip",
  );
  await writeFile(outputPath, zipBytes);
  console.log(
    `Wrote ${outputPath} (${(zipBytes.length / 1024 / 1024).toFixed(2)} MB)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
