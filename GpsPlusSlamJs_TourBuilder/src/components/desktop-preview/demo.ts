/**
 * Standalone demo for component 11 — the desktop preview.
 *
 * A tour written in real lat/lon, walked on a desktop with no phone, no GPS
 * and no WebXR: the preview session supplies the world (camera, world group,
 * frame loop, pinned frame) and component 8's real scene runs inside it, so
 * proximity, asset loading, the transcript and the spatialised audio are all
 * the production code paths.
 *
 * Verify: walk with W A S D (shift to run), drag to look around; the knight
 * appears as you come within its active radius and its story plays; clicking
 * it toggles playback; "Auto-walk" follows the breadcrumb by itself.
 */

import { AudioListener } from "three";

import { createViewingStore } from "../../store/viewing-store.js";
import { loadTour } from "../../store/tour-slice.js";
import type { AssetId, AssetProvider, Tour } from "../../store/types.js";
import { RefCountedAssetProvider } from "../cloud-loader/core/asset-provider.js";
import { createTourScene } from "../ar-scene/runtime/tour-scene.js";
import { createThreeSceneAdapter } from "../ar-scene/view/three-scene-adapter.js";
import { TRAIL_ORB_POOL_SIZE } from "../ar-scene/config.js";
import { computePreviewStart } from "./core/preview-start.js";
import { createPreviewSession } from "./view/preview-session.js";

const HYSTERESIS_FRACTION = 0.15; // contract D16 default

const ASSET_URLS: Readonly<Record<AssetId, string>> = {
  "asset-knight": "/ar-scene/knight.glb",
  "asset-banner": "/ar-scene/banner.png",
  "asset-story-1": "/ar-scene/story-1.wav",
  "asset-story-2": "/ar-scene/story-2.wav",
};

/** A short walk north from a trailhead, with a stop on either side of it. */
const TRAILHEAD = { lat: 48.137, lon: 11.575 };
const metresNorth = (m: number): number => TRAILHEAD.lat + m / 111_320;
const metresEast = (m: number): number =>
  TRAILHEAD.lon + m / (111_320 * Math.cos((TRAILHEAD.lat * Math.PI) / 180));

const tour: Tour = {
  id: "tour-preview-demo",
  name: "Preview demo walk",
  description: "Two stops, walked on a desktop.",
  assets: [
    { id: "asset-knight", type: "model", filename: "knight.glb" },
    { id: "asset-banner", type: "sprite", filename: "banner.png" },
    { id: "asset-story-1", type: "audio", filename: "story-1.wav" },
    { id: "asset-story-2", type: "audio", filename: "story-2.wav" },
  ],
  waypoints: [
    {
      id: "wp-knight",
      position: { lat: metresNorth(35), lon: TRAILHEAD.lon },
      prefetchRadius: 40,
      activeRadius: 12,
      content: {
        model: "asset-knight",
        audio: "asset-story-1",
        transcript:
          "Sir Aldric held this gate for thirty winters, and never once slept " +
          "in the tower.",
      },
    },
    {
      id: "wp-banner",
      position: { lat: metresNorth(70), lon: metresEast(25) },
      prefetchRadius: 40,
      activeRadius: 12,
      content: {
        sprite: "asset-banner",
        audio: "asset-story-2",
        transcript: "The market banner flew here every spring until 1643.",
      },
    },
  ],
  breadcrumb: [
    TRAILHEAD,
    { lat: metresNorth(35), lon: TRAILHEAD.lon },
    { lat: metresNorth(70), lon: metresEast(25) },
  ],
};

const container = document.querySelector<HTMLDivElement>("#canvas-root")!;
const status = document.querySelector<HTMLElement>("#status")!;
const startButton = document.querySelector<HTMLButtonElement>("#start")!;
const autopilotButton =
  document.querySelector<HTMLButtonElement>("#autopilot")!;

const assetProvider: AssetProvider = new RefCountedAssetProvider({
  loadAssetBlob: async (id: AssetId) => {
    const url = ASSET_URLS[id];
    if (url === undefined) throw new Error(`unknown asset ${id}`);
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`${url}: HTTP ${String(response.status)}`);
    return response.blob();
  },
});

// Creating the store activates gps-plus-slam-js's license; must happen
// before any call into its math (computePreviewStart -> toWorld).
const store = createViewingStore();

const { origin, start, route } = computePreviewStart(tour);
const session = createPreviewSession({
  container,
  origin,
  start,
  route,
  onPositionChange: (position) => {
    status.textContent = `${position.lat.toFixed(6)}, ${position.lon.toFixed(6)}`;
  },
});

const camera = session.runtime.getCamera()!;
const audioListener = new AudioListener();
camera.add(audioListener);

const adapter = createThreeSceneAdapter({
  parent: session.runtime.getArWorldGroup()!,
  camera,
  audioListener,
  createAnchor: (object3D, coord) =>
    session.seams.createAnchor(object3D, coord),
  toWorld: (coord) => session.seams.toWorld(coord),
  getUserWorldPos: () => session.seams.getUserWorldPos(),
  orbPoolSize: TRAIL_ORB_POOL_SIZE,
  domElement: session.domElement,
});

const tourScene = createTourScene({
  store,
  adapter,
  assetProvider,
  hysteresisFraction: HYSTERESIS_FRACTION,
  onAudioBlocked: () => {
    status.textContent = "Audio is blocked — press Start first.";
  },
  // The demo is a diagnosis tool: surface scene warnings where you can see them.
  // eslint-disable-next-line no-console
  log: (message) => console.warn(message),
});

store.dispatch(loadTour(tour));
session.runtime.registerFrameUpdate((dt) => {
  tourScene.tick(dt);
});

startButton.addEventListener("click", () => {
  // The click is the user gesture the Web Audio autoplay policy demands
  // (§2.5.7); the composed app gets it from the onboarding gate instead.
  void audioListener.context.resume();
  startButton.disabled = true;
  status.textContent = "Walk with W A S D · shift to run · drag to look";
});

autopilotButton.addEventListener("click", () => {
  const next = !session.isAutopilot();
  session.setAutopilot(next);
  autopilotButton.textContent = next ? "Stop auto-walk" : "Auto-walk";
});

status.textContent = "Press Start, then walk with W A S D.";
