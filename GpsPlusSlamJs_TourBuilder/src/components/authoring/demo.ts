/**
 * Standalone demo for component 10 (TASK.md §2.3): drop a couple of
 * waypoints with attached assets while the position moves — live from a real
 * device, or replayed from any recording zip in `recordings/` (the RAW
 * recorded GPS fixes, not a fused path — plan AU8), picked from a dropdown —
 * then export a real `tour.zip` via component 5's already-approved
 * `packTour`.
 *
 * No Three.js, no canvas (plan AU1) — a plain DOM page, same spirit as
 * packaging's demo. `mountAuthoringView` renders the tour-details/waypoints/
 * export sections; this file wires the position source, the store, a
 * read-only map (component 7, visualization only — plan
 * 2026-08-07-authoring-demo-ux-plan.md U2/U3), and what "Export" does.
 */

import "leaflet/dist/leaflet.css";

import { buildMapData } from "gps-plus-slam-app-framework/visualization/map-data";
import { downloadZip } from "gps-plus-slam-app-framework/storage";
import {
  replayRecording,
  selectGpsPositions,
} from "gps-plus-slam-app-framework/state";

import { authoringReducer } from "../../store/authoring-slice.js";
import type { AuthoringSliceState } from "../../store/authoring-slice.js";
import { PackagingError } from "../packaging/core/pack-tour.js";
import { packTour } from "../packaging/core/pack-tour.js";
import { createPlaybackLoop } from "../shared/playback-loop.js";
import { computeMarkerViewModels } from "../map/core/map-marker-state.js";
import { createTourMap } from "../map/view/tour-map.js";
import { createAuthoringSession } from "./view/authoring-session.js";
import { createFilesAssetProvider } from "./view/files-asset-provider.js";
import { createLiveGpsPositionSource } from "./view/gps-position-source.js";
import { mountAuthoringView } from "./view/authoring-view.js";
import type { PositionSource } from "./view/gps-position-source.js";
import type { TourCoord } from "../../store/types.js";

const el = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const statusEl = el<HTMLParagraphElement>("status");
const exportStatusEl = el<HTMLParagraphElement>("export-status");
const authoringRoot = el<HTMLDivElement>("authoring-root");
const playPauseButton = el<HTMLButtonElement>("play-pause");
const scrubInput = el<HTMLInputElement>("scrub");
const recordingSelect = el<HTMLSelectElement>("recording-select");
const modeInputs = Array.from(
  document.querySelectorAll<HTMLInputElement>('input[name="mode"]'),
);

// ── Recording picker — every `*.zip` in `recordings/` (repo root of this
// package), statically enumerated by Vite at dev/build time. `eager` +
// `query: "?url"` gives us just the served URL per file, not its (possibly
// huge) contents, so listing recordings costs nothing until one is picked. ──
const recordingUrlsByPath = import.meta.glob<string>("/recordings/*.zip", {
  eager: true,
  query: "?url",
  import: "default",
});
const recordingEntries = Object.entries(recordingUrlsByPath)
  .map(([path, url]) => ({ name: path.replace("/recordings/", ""), url }))
  .sort((a, b) => a.name.localeCompare(b.name));

for (const { name, url } of recordingEntries) {
  const option = document.createElement("option");
  option.value = url;
  option.textContent = name;
  recordingSelect.append(option);
}

// ── A minimal hand-rolled store over the real authoringReducer (same spirit
// as components 1/4's own dispatch loops — no full Redux store needed for a
// standalone demo). ──────────────────────────────────────────────────────
let authoringState: AuthoringSliceState = authoringReducer(undefined, {
  type: "@@INIT",
});
const listeners = new Set<() => void>();
function dispatch(action: Parameters<typeof authoringReducer>[1]): void {
  authoringState = authoringReducer(authoringState, action);
  for (const l of listeners) l();
}
const store = {
  getState: () => ({ authoring: authoringState }),
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  dispatch,
};

// ── Map (component 7) — read-only visualization, not part of component 10's
// own scope (plan U2). Composed here purely for the demo. ─────────────────
const mapHost = el<HTMLDivElement>("map-host");
const tourMap = createTourMap(mapHost)!;
tourMap.show();

function refreshMapWaypoints(): void {
  tourMap.setWaypoints(
    computeMarkerViewModels(authoringState.waypoints, [], null),
  );
}
function updateMapPosition(pos: TourCoord): void {
  tourMap.setGpsPosition(pos.lat, pos.lon);
  tourMap.render(
    buildMapData({ userPosition: { lat: pos.lat, lng: pos.lon } }),
  );
}
listeners.add(refreshMapWaypoints);
refreshMapWaypoints();

// ── Position source: swappable between live GPS and the replayed track.
// Wrapped so every fix (live or replayed) also updates the map, without
// authoring-session.ts knowing the map exists. ────────────────────────────
let positionListener: ((pos: TourCoord) => void) | null = null;
const replaySource: PositionSource = {
  subscribe(onPosition) {
    positionListener = onPosition;
    return () => {
      positionListener = null;
    };
  },
};
const liveSource = createLiveGpsPositionSource();

function withMapSync(source: PositionSource): PositionSource {
  return {
    subscribe(onPosition) {
      return source.subscribe((pos) => {
        updateMapPosition(pos);
        onPosition(pos);
      });
    },
  };
}

const filesAssetProvider = createFilesAssetProvider();
let session = createAuthoringSession({
  positionSource: withMapSync(replaySource),
  dispatch,
  getState: store.getState,
  filesAssetProvider,
});

let currentMode: "live" | "replay" = "live";

function switchMode(mode: "live" | "replay"): void {
  currentMode = mode;
  session.destroy();
  session = createAuthoringSession({
    positionSource: withMapSync(mode === "live" ? liveSource : replaySource),
    dispatch,
    getState: store.getState,
    filesAssetProvider,
  });
  statusEl.textContent =
    mode === "live"
      ? "Waiting for a live GPS fix…"
      : `Replaying ${recordingSelect.selectedOptions[0]?.textContent ?? "recording"}.`;
  view.destroy();
  view = mountAuthoringView(authoringRoot, viewDeps());
}

function viewDeps() {
  return {
    session,
    subscribe: store.subscribe,
    getState: store.getState,
    dispatch,
    onExport: async (
      result: Awaited<ReturnType<typeof session.exportTour>>,
    ) => {
      try {
        const blob = await packTour(result.tour, new Map(result.assetFiles));
        await downloadZip(blob, "tour.zip");
        exportStatusEl.textContent = `Packed tour.zip — ${blob.size.toLocaleString()} bytes, ${result.tour.waypoints.length} waypoint(s).`;
        exportStatusEl.dataset["state"] = "ok";
      } catch (error) {
        exportStatusEl.textContent =
          error instanceof PackagingError && error.message
            ? error.message
            : error instanceof Error
              ? error.message
              : String(error);
        exportStatusEl.dataset["state"] = "error";
      }
    },
  };
}

let view = mountAuthoringView(authoringRoot, viewDeps());

// ── Track loading — fetches the selected recording zip, replays it through
// the real framework reducers, and pulls out the RAW GPS fixes (component 10
// consumes pre-anchoring lat/lon, not the fused path — plan AU2). The
// playback loop is rebuilt every time a different recording is picked, since
// its length depends on the track. ─────────────────────────────────────────
let track: TourCoord[] = [];
function buildLoop(): ReturnType<typeof createPlaybackLoop> {
  return createPlaybackLoop({
    length: track.length,
    samplesPerSec: 5,
    onSeek: (index) => {
      scrubInput.value = String(index);
      const p = track[index]!;
      positionListener?.(p);
      statusEl.textContent = `Replaying: sample ${index + 1}/${track.length} — ${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`;
    },
    onPlayStateChange: (playing) => {
      playPauseButton.textContent = playing ? "Pause" : "Play";
    },
  });
}
let loop = buildLoop();

async function loadRecording(url: string): Promise<void> {
  loop.stop();
  if (currentMode === "replay") statusEl.textContent = "Loading recording…";
  const response = await fetch(url);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const state = await replayRecording(bytes);
  track = selectGpsPositions(state).map((p) =>
    p.altitude === undefined
      ? { lat: p.latitude, lon: p.longitude }
      : { lat: p.latitude, lon: p.longitude, altitude: p.altitude },
  );
  scrubInput.max = String(Math.max(track.length - 1, 0));
  scrubInput.value = "0";
  loop = buildLoop();
  if (currentMode === "replay") {
    statusEl.textContent =
      track.length > 0
        ? `Loaded ${track.length} GPS fixes. Ready to replay.`
        : "This recording has no GPS fixes.";
  }
}

playPauseButton.addEventListener("click", () => loop.toggle());
scrubInput.addEventListener("input", () =>
  loop.seekTo(Number(scrubInput.value)),
);
recordingSelect.addEventListener("change", () => {
  loadRecording(recordingSelect.value).catch((error: unknown) => {
    statusEl.textContent = `Failed to load recording: ${error instanceof Error ? error.message : String(error)}`;
  });
});

for (const input of modeInputs) {
  input.addEventListener("change", () => {
    if (!input.checked) return;
    switchMode(input.value as "live" | "replay");
  });
}

if (recordingEntries.length > 0) {
  loadRecording(recordingEntries[0]!.url).catch((error: unknown) => {
    statusEl.textContent = `Failed to load recording: ${error instanceof Error ? error.message : String(error)}`;
  });
}

statusEl.textContent = "Waiting for a live GPS fix…";
