/**
 * Goal-2 composition, Authoring mode (plan
 * `plans/2026-08-14-authoring-composition-plan.md`).
 *
 * Sequences the approved components into the real Authoring flow: onboarding
 * gate (9) → authoring tools (10, live GPS only — the replay-track toggle in
 * `components/authoring/demo.ts` is demo-only scaffolding, not part of
 * `mountAuthoringView`'s real contract) → export. Uses the real
 * `createAuthoringStore()`, not a hand-rolled reducer loop.
 *
 */
import "leaflet/dist/leaflet.css";

import {
  checkCameraPermission,
  checkGeolocationPermission,
  requestCameraPermission,
  requestGeolocationPermission,
} from "gps-plus-slam-app-framework/sensors";
import { buildMapData } from "gps-plus-slam-app-framework/visualization/map-data";

import { createAuthoringStore } from "../../store/authoring-store.js";
import type { TourCoord } from "../../store/types.js";
import { ICONS } from "../../components/shared/icons.js";
import { mountOnboardingGate } from "../../components/onboarding/view/onboarding-view.js";
import { createLiveGpsPositionSource } from "../../components/authoring/view/gps-position-source.js";
import { createFilesAssetProvider } from "../../components/authoring/view/files-asset-provider.js";
import { createAuthoringSession } from "../../components/authoring/view/authoring-session.js";
import { mountAuthoringView } from "../../components/authoring/view/authoring-view.js";
import { computeMarkerViewModels } from "../../components/map/core/map-marker-state.js";
import { createTourMap } from "../../components/map/view/tour-map.js";
import { mountPackAndSharePanel } from "./pack-and-share-panel.js";
import { packTour } from "../../components/packaging/core/pack-tour.js";
import { downloadZip } from "gps-plus-slam-app-framework/storage";
import { swapScreen } from "./screen-transition.js";
import {
  disableBeforeUnloadWarning,
  enableBeforeUnloadWarning,
} from "./unload-guard.js";
import { requestWakeLock, type WakeLockHandle } from "../wake-lock.js";
import {
  beginDurableAuthoringSession,
  discardDraft,
  findResumableDraft,
  restoreAuthoringDraft,
} from "./restore-authoring-draft.js";

/**
 * A real, publicly-shared tour, offered so a visitor who lands on the root
 * URL (no `?tour=`, so Authoring mode per D13) can see a finished tour
 * instead of only the authoring tool. Hosted on the tour creator's own
 * OneDrive share, not this repo.
 */
const DEMO_TOUR_URL =
  "https://my.microsoftpersonalcontent.com/personal/339942fd8b9cbd18/_layouts/15/download.aspx?share=IQCA5LWk0FVsQI4yCdiTHSqBAexdK1msWdmNSotvGQ1QmRw";

/** Mounts the composed Authoring-mode flow into `root`. */
export function mountAuthoringApp(root: HTMLElement): { destroy(): void } {
  const demoLink = document.createElement("a");
  demoLink.className = "demo-tour-chip";
  demoLink.dataset["testid"] = "view-demo-tour";
  demoLink.href = `${location.pathname}?tour=${encodeURIComponent(DEMO_TOUR_URL)}`;
  demoLink.innerHTML = `${ICONS.pin}<span>View a demo tour</span>`;
  root.appendChild(demoLink);

  const gateHost = document.createElement("div");
  gateHost.className = "gate-card";
  root.appendChild(gateHost);

  const gate = mountOnboardingGate(gateHost, {
    checkCameraPermission,
    checkGeolocationPermission,
    requestCameraPermission,
    requestGeolocationPermission,
    createAudioContext: () => new AudioContext(),
    onComplete: () => {
      demoLink.remove();
      swapScreen(gateHost, () => {
        gate.destroy();
        void startAuthoringFlow(root);
      });
    },
  });

  return {
    destroy() {
      demoLink.remove();
      gate.destroy();
      gateHost.remove();
    },
  };
}

/** AC10: offers to resume an interrupted draft before the tools screen mounts. */
async function startAuthoringFlow(root: HTMLElement): Promise<void> {
  const resumableSessionName = await findResumableDraft();
  if (!resumableSessionName) {
    await mountAuthoringTools(root);
    return;
  }

  const promptHost = document.createElement("div");
  promptHost.className = "resume-prompt";

  const message = document.createElement("p");
  message.textContent =
    "An interrupted authoring session was found. Resume it, or discard and start fresh?";
  const actions = document.createElement("div");
  actions.className = "resume-prompt-actions";
  const resumeButton = document.createElement("button");
  resumeButton.className = "primary";
  resumeButton.textContent = "Resume previous draft";
  const discardButton = document.createElement("button");
  discardButton.textContent = "Discard and start fresh";
  actions.append(resumeButton, discardButton);
  promptHost.append(message, actions);
  root.appendChild(promptHost);

  resumeButton.addEventListener("click", () => {
    swapScreen(promptHost, () => {
      void mountAuthoringTools(root, resumableSessionName);
    });
  });
  discardButton.addEventListener("click", () => {
    swapScreen(promptHost, () => {
      void discardDraft(resumableSessionName).then(() =>
        mountAuthoringTools(root),
      );
    });
  });
}

async function mountAuthoringTools(
  root: HTMLElement,
  resumeSessionName?: string,
): Promise<void> {
  const toolsHost = document.createElement("div");
  toolsHost.className = "tools-shell screen-enter";
  root.appendChild(toolsHost);

  const store = createAuthoringStore();

  // AC10: continue (or start) durable draft persistence, then rehydrate the
  // store from a resumed session's log using the PLAIN dispatch — actions
  // already on disk must not be re-written under new indices.
  const durable = await beginDurableAuthoringSession(resumeSessionName);
  if (resumeSessionName) {
    await restoreAuthoringDraft(store.dispatch, durable.sessionName);
  }
  const dispatch = durable.wrapDispatch(store.dispatch);

  // AC11: keep the screen awake while the author is actively walking the
  // route — a sleeping screen silently stalls the live GPS position source.
  // Re-requested on visibilitychange, since the OS releases the lock
  // whenever the tab is hidden.
  let wakeLockHandle: WakeLockHandle | null = null;
  let exported = false;
  void requestWakeLock().then((handle) => {
    wakeLockHandle = handle;
  });
  function onVisibilityChange(): void {
    if (document.visibilityState !== "visible" || exported) return;
    void requestWakeLock().then((handle) => {
      wakeLockHandle = handle;
    });
  }
  document.addEventListener("visibilitychange", onVisibilityChange);

  // AC12: warn before leaving with an unexported, non-empty draft.
  enableBeforeUnloadWarning(() => {
    if (exported) return false;
    const draft = store.getState().authoring;
    return draft.waypoints.length > 0 || draft.breadcrumb.length > 0;
  });

  // `.map-shell` never touches Leaflet's own DOM subtree — the GPS badge is
  // its sibling, not a child of `.map-card`, so Leaflet's internal rendering
  // can never clobber it. `.map-card` stays the direct element passed to
  // createTourMap, exactly as before (see tour-map.ts / app.css).
  const mapShell = document.createElement("div");
  mapShell.className = "map-shell";
  toolsHost.appendChild(mapShell);

  const mapHost = document.createElement("div");
  mapHost.className = "map-card map-card-flush";
  mapShell.appendChild(mapHost);
  // Non-interactive: this map is a live-position preview while authoring,
  // not something to pan/zoom, and leaving Leaflet's touch dragging on
  // means a swipe starting over the map pans the map instead of scrolling
  // the page (see tour-map.ts's `interactive` option).
  const tourMap = createTourMap(mapHost, { interactive: false });
  tourMap?.show();

  // AC13: explicit waiting state until the first live GPS fix arrives —
  // Drop Waypoint has nothing to drop at until then.
  const gpsBadge = document.createElement("div");
  gpsBadge.className = "map-badge map-badge-waiting";
  gpsBadge.dataset["testid"] = "gps-status";
  gpsBadge.textContent = "Waiting for GPS…";
  mapShell.appendChild(gpsBadge);

  function refreshMapWaypoints(): void {
    tourMap?.setWaypoints(
      computeMarkerViewModels(store.getState().authoring.waypoints, [], null),
    );
  }
  store.subscribe(refreshMapWaypoints);
  refreshMapWaypoints();

  let hasGpsFix = false;
  function updateMapPosition(pos: TourCoord): void {
    if (!hasGpsFix) {
      hasGpsFix = true;
      gpsBadge.className = "map-badge map-badge-live";
      gpsBadge.textContent = "Live";
    }
    tourMap?.setGpsPosition(pos.lat, pos.lon);
    tourMap?.render(
      buildMapData({ userPosition: { lat: pos.lat, lng: pos.lon } }),
    );
  }

  const positionSource = createLiveGpsPositionSource();
  const withMapSync = {
    subscribe(onPosition: (pos: TourCoord) => void) {
      return positionSource.subscribe((pos) => {
        updateMapPosition(pos);
        onPosition(pos);
      });
    },
  };

  const filesAssetProvider = createFilesAssetProvider();
  const session = createAuthoringSession({
    positionSource: withMapSync,
    dispatch,
    getState: store.getState,
    filesAssetProvider,
  });

  const authoringRoot = document.createElement("div");
  authoringRoot.className = "authoring-sections";
  toolsHost.appendChild(authoringRoot);

  const view = mountAuthoringView(authoringRoot, {
    session,
    subscribe: store.subscribe,
    getState: store.getState,
    dispatch,
    packAndDownload: async (tour, assetFiles) => {
      const blob = await packTour(tour, new Map(assetFiles));
      await downloadZip(blob, "tour.zip");
    },
    // The share panel needs neither the tour nor the asset files (only
    // packaging did, and that already ran in packAndDownload above), so
    // the parameter below is intentionally unused.
    onExport: (_result: ReturnType<typeof session.exportTour>) => {
      exported = true;
      disableBeforeUnloadWarning();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      wakeLockHandle?.release();
      void durable.discard(); // packed successfully — nothing left to resume
      swapScreen(authoringRoot, () => {
        view.destroy();
        const shareHost = mountPackAndSharePanel(toolsHost);
        shareHost.root.classList.add("screen-enter");
      });
    },
  });
}
