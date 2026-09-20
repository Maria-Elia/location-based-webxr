/**
 * The in-session HUD (plan VC9, VC23, VC24, VC15f).
 *
 * Mounted into the AR container, i.e. the WebXR DOM Overlay root, so it
 * composites over the camera feed. Holds the map toggle, the wayfinding guide
 * toggle, the End-tour control, the alignment/tracking coaching line, and a
 * one-shot notice channel for things the visitor must be told (audio
 * blocked, map tiles unavailable).
 *
 * Knows nothing about the store or the scene — the caller (`viewing-app.ts`,
 * or the desktop-preview demo) pushes state in (`setMapActive`, …; the HUD
 * owns the wording) and reacts to the callbacks.
 * Shared under `components/` rather than `app/viewing/` because the
 * standalone desktop-preview demo (component 11) mounts the same HUD, and a
 * component may not import from `src/app/` (dependency-cruiser).
 */

import { HUD_ICONS } from "./hud-icons.js";
import {
  autopilotLabel,
  buildingsAppearance,
  mapLabel,
  wayfindingLabel,
  type HudBuildingsStatus,
} from "./hud-state.js";
import { createIconButton } from "./icon-button.js";

/** How long a callout hint stays up before it dismisses itself. */
const AUTOPILOT_HINT_TIMEOUT_MS = 8000;
const WAYFINDING_HINT_TIMEOUT_MS = 8000;

/** A small downward-pointing chevron — the hint bubble sits above the
 *  button and needs to visually point down at it. */
const DOWN_ARROW_SVG =
  '<svg width="14" height="14" viewBox="0 0 12 12"><path d="M2 4 L6 9 L10 4" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export interface HudOptions {
  /** No map toggle button unless a handler is given (e.g. the desktop-preview demo has no map). */
  readonly onToggleMap?: () => void;
  /** No End-tour button unless a handler is given. */
  readonly onEndTour?: () => void;
  /** Preview mode only: walk the breadcrumb automatically (VC25). */
  readonly onToggleAutopilot?: () => void;
  /** Desktop-preview only: toggle the OSM building layer on/off. */
  readonly onToggleOsmBuildings?: () => void;
  /** Show/hide the single wayfinding guide indicator — available in both
   *  AR and preview, unlike autopilot (plan 2026-09-17-breadcrumb-wayfinding). */
  readonly onToggleWayfinding: () => void;
}

export interface Hud {
  /** The alignment/tracking coaching line (plan VC23). Empty string hides it. */
  setStatus(message: string): void;
  /** One-shot notice: audio blocked, tiles offline, a failed asset. */
  showNotice(message: string): void;
  /** No-op unless the HUD was mounted with a map toggle. */
  setMapActive(active: boolean): void;
  /** No-op unless the HUD was mounted with an autopilot toggle. */
  setAutopilotActive(active: boolean): void;
  setWayfindingActive(active: boolean): void;
  /** No-op unless the HUD was mounted with an OSM buildings toggle. */
  setOsmBuildingsStatus(status: HudBuildingsStatus): void;
  /** Hides the one-time "try Auto-walk" callout, if it's still showing.
   *  No-op once already dismissed or when there's no autopilot toggle. */
  dismissAutopilotHint(): void;
  /** Hides the one-time "try Wayfinding" callout, if it's still showing. */
  dismissWayfindingHint(): void;
  destroy(): void;
}

interface ToggleFlags {
  readonly busy?: boolean;
  readonly error?: boolean;
}

/** A HUD toggle whose wording and look the HUD derives from state. */
interface Toggle {
  readonly element: HTMLButtonElement;
  set(label: string, pressed: boolean, flags?: ToggleFlags): void;
}

function iconToggle(testid: string, icon: string, label: string): Toggle {
  const button = createIconButton({ icon, label, pressed: false });
  button.element.dataset.testid = testid;
  return {
    element: button.element,
    set(next, pressed, flags = {}) {
      button.setLabel(next);
      button.setPressed(pressed);
      button.setBusy(flags.busy === true);
      button.setError(flags.error === true);
    },
  };
}

const BUILDINGS_FAILED_NOTICE =
  "Buildings couldn't load. Tap the buildings button to retry.";

export function mountHud(container: HTMLElement, options: HudOptions): Hud {
  const element = document.createElement("div");
  element.className = "ar-hud";
  element.dataset.testid = "viewing-hud";

  const status = document.createElement("p");
  status.className = "status-banner";
  status.dataset.testid = "viewing-hud-status";
  status.hidden = true;

  const notice = document.createElement("p");
  notice.className = "error-banner";
  notice.dataset.testid = "viewing-hud-notice";
  notice.hidden = true;

  let lastBuildingsStatus: HudBuildingsStatus = "off";

  const controls = document.createElement("div");
  controls.className = "ar-hud-controls";

  const mapToggle = iconToggle(
    "viewing-map-toggle",
    HUD_ICONS.map,
    mapLabel(false),
  );
  if (options.onToggleMap) {
    mapToggle.element.addEventListener("click", () => options.onToggleMap?.());
  }

  const endTour = createIconButton({
    icon: HUD_ICONS.exit,
    label: "End tour",
    variant: "danger",
  }).element;
  endTour.dataset.testid = "viewing-end-tour";
  if (options.onEndTour) {
    endTour.addEventListener("click", () => options.onEndTour?.());
  }

  const autopilot = iconToggle(
    "viewing-autopilot",
    HUD_ICONS.walk,
    autopilotLabel(false),
  );

  const wayfinding = iconToggle(
    "viewing-wayfinding",
    HUD_ICONS.wayfinding,
    wayfindingLabel(false),
  );
  wayfinding.element.addEventListener("click", () =>
    options.onToggleWayfinding(),
  );

  /**
   * A one-time callout above a toggle button rather than turning the
   * feature on by itself: the visitor stays in control from the first
   * frame, but still finds out the feature exists. Starts hidden ("queued");
   * `show()` reveals it and starts its own timeout, `dismiss()` ends it for
   * good (a dismissed-while-queued hint never appears) and fires `onGone`
   * so a hint waiting behind this one can take its turn.
   */
  function mountHintedToggle(
    button: HTMLButtonElement,
    hintTestid: string,
    hintText: string,
    timeoutMs: number,
    onGone?: () => void,
  ): {
    readonly wrap: HTMLDivElement;
    readonly show: () => void;
    readonly dismiss: () => void;
  } {
    const wrap = document.createElement("div");
    wrap.className = "hud-hint-wrap";

    const hint = document.createElement("div");
    hint.className = "hud-hint";
    hint.dataset.testid = hintTestid;
    hint.hidden = true;

    const hintTextEl = document.createElement("span");
    hintTextEl.textContent = hintText;
    const hintClose = document.createElement("button");
    hintClose.type = "button";
    hintClose.className = "hud-hint-close";
    hintClose.setAttribute("aria-label", "Dismiss");
    hintClose.textContent = "×";
    const hintArrow = document.createElement("span");
    hintArrow.className = "hud-hint-arrow";
    hintArrow.innerHTML = DOWN_ARROW_SVG;

    hint.append(hintTextEl, hintClose, hintArrow);

    let phase: "queued" | "shown" | "gone" = "queued";
    let timer: ReturnType<typeof setTimeout> | undefined;

    const dismiss = (): void => {
      if (phase === "gone") return;
      phase = "gone";
      hint.hidden = true;
      clearTimeout(timer);
      onGone?.();
    };
    const show = (): void => {
      if (phase !== "queued") return;
      phase = "shown";
      hint.hidden = false;
      timer = setTimeout(dismiss, timeoutMs);
    };
    hintClose.addEventListener("click", dismiss);

    wrap.append(hint, button);
    return { wrap, show, dismiss };
  }

  const osmBuildingsToggle = iconToggle(
    "viewing-osm-buildings-toggle",
    HUD_ICONS.buildings,
    buildingsAppearance("off").label,
  );

  // Wayfinding's hint is created first so Auto-walk's can release it.
  const wayfindingHint = mountHintedToggle(
    wayfinding.element,
    "viewing-wayfinding-hint",
    "Try Wayfinding to find your way",
    WAYFINDING_HINT_TIMEOUT_MS,
  );
  const autopilotHint = options.onToggleAutopilot
    ? mountHintedToggle(
        autopilot.element,
        "viewing-autopilot-hint",
        "Try Auto-walk to move hands-free",
        AUTOPILOT_HINT_TIMEOUT_MS,
        wayfindingHint.show,
      )
    : undefined;

  if (options.onToggleOsmBuildings) {
    osmBuildingsToggle.element.addEventListener("click", () =>
      options.onToggleOsmBuildings?.(),
    );
    controls.appendChild(osmBuildingsToggle.element);
  }
  if (autopilotHint) {
    autopilot.element.addEventListener("click", () =>
      options.onToggleAutopilot?.(),
    );
    controls.appendChild(autopilotHint.wrap);
  }
  controls.appendChild(wayfindingHint.wrap);
  if (options.onToggleMap) controls.appendChild(mapToggle.element);
  if (options.onEndTour) controls.appendChild(endTour);

  // Only one bubble is on screen at a time, so bubble width no longer
  // constrains control order. Auto-walk goes first; with no Auto-walk button
  // (the phone AR session) Wayfinding has nothing to queue behind.
  (autopilotHint ?? wayfindingHint).show();

  element.append(status, notice, controls);
  container.appendChild(element);

  return {
    setStatus(message) {
      status.textContent = message;
      status.hidden = message === "";
    },
    showNotice(message) {
      notice.textContent = message;
      notice.hidden = false;
    },
    setMapActive(active) {
      if (!options.onToggleMap) return;
      mapToggle.set(mapLabel(active), active);
    },
    setAutopilotActive(active) {
      autopilot.set(autopilotLabel(active), active);
    },
    setWayfindingActive(active) {
      wayfinding.set(wayfindingLabel(active), active);
    },
    setOsmBuildingsStatus(buildingStatus) {
      if (!options.onToggleOsmBuildings) return;
      const { label, pressed, busy, error } =
        buildingsAppearance(buildingStatus);
      osmBuildingsToggle.set(label, pressed, { busy, error });
      // The red ring alone is not readable at a glance outdoors, so the
      // transition INTO failed also raises a notice. Leaving failed clears it,
      // but only while it still shows this text (never someone else's notice).
      if (buildingStatus === "failed" && lastBuildingsStatus !== "failed") {
        notice.textContent = BUILDINGS_FAILED_NOTICE;
        notice.hidden = false;
      } else if (
        buildingStatus !== "failed" &&
        notice.textContent === BUILDINGS_FAILED_NOTICE
      ) {
        notice.hidden = true;
      }
      lastBuildingsStatus = buildingStatus;
    },
    dismissAutopilotHint() {
      autopilotHint?.dismiss();
    },
    dismissWayfindingHint() {
      wayfindingHint.dismiss();
    },
    destroy() {
      // Wayfinding first: dismissing Auto-walk would otherwise release it.
      wayfindingHint.dismiss();
      autopilotHint?.dismiss();
      element.remove();
    },
  };
}
