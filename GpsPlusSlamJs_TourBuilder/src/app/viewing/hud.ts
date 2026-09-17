/**
 * The in-session HUD (plan VC9, VC23, VC24, VC15f).
 *
 * Mounted into the AR container, i.e. the WebXR DOM Overlay root, so it
 * composites over the camera feed. Holds the map toggle, the End-tour control,
 * the alignment/tracking coaching line, and a one-shot notice channel for
 * things the visitor must be told (audio blocked, map tiles unavailable).
 *
 * Knows nothing about the store or the scene — `viewing-app.ts` pushes text
 * in and reacts to the callbacks.
 */

/** How long the autopilot hint stays up before it dismisses itself. */
const AUTOPILOT_HINT_TIMEOUT_MS = 8000;

/** A small downward-pointing chevron — the hint bubble sits above the
 *  button and needs to visually point down at it. */
const DOWN_ARROW_SVG =
  '<svg width="14" height="14" viewBox="0 0 12 12"><path d="M2 4 L6 9 L10 4" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export interface HudOptions {
  readonly onToggleMap: () => void;
  readonly onEndTour: () => void;
  /** Preview mode only: walk the breadcrumb automatically (VC25). */
  readonly onToggleAutopilot?: () => void;
  /** Desktop-preview only: toggle the OSM building layer on/off. */
  readonly onToggleOsmBuildings?: () => void;
}

export interface Hud {
  /** The alignment/tracking coaching line (plan VC23). Empty string hides it. */
  setStatus(message: string): void;
  /** One-shot notice: audio blocked, tiles offline, a failed asset. */
  showNotice(message: string): void;
  setMapToggleLabel(label: string): void;
  /** No-op unless the HUD was mounted with an autopilot toggle. */
  setAutopilotLabel(label: string): void;
  /** No-op unless the HUD was mounted with an OSM buildings toggle. */
  setOsmBuildingsLabel(label: string): void;
  /** Hides the one-time "try Auto-walk" callout, if it's still showing.
   *  No-op once already dismissed or when there's no autopilot toggle. */
  dismissAutopilotHint(): void;
  destroy(): void;
}

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

  const controls = document.createElement("div");
  controls.className = "ar-hud-controls";

  const mapToggle = document.createElement("button");
  mapToggle.textContent = "Map";
  mapToggle.dataset.testid = "viewing-map-toggle";
  mapToggle.addEventListener("click", () => options.onToggleMap());

  const endTour = document.createElement("button");
  endTour.textContent = "End tour";
  endTour.dataset.testid = "viewing-end-tour";
  endTour.addEventListener("click", () => options.onEndTour());

  const autopilot = document.createElement("button");
  autopilot.textContent = "Auto-walk";
  autopilot.dataset.testid = "viewing-autopilot";

  // A one-time callout above the button rather than turning autopilot on
  // by itself: the visitor stays in control of how they move from the
  // first frame, but still finds out this exists instead of only via the
  // status line's prose.
  let autopilotHintTimer: ReturnType<typeof setTimeout> | undefined;
  let hideAutopilotHint: (() => void) | undefined;

  if (options.onToggleAutopilot) {
    const autopilotWrap = document.createElement("div");
    autopilotWrap.className = "autopilot-wrap";

    const hint = document.createElement("div");
    hint.className = "autopilot-hint";
    hint.dataset.testid = "viewing-autopilot-hint";

    const hintText = document.createElement("span");
    hintText.textContent = "Try Auto-walk to move hands-free";
    const hintClose = document.createElement("button");
    hintClose.type = "button";
    hintClose.className = "autopilot-hint-close";
    hintClose.setAttribute("aria-label", "Dismiss");
    hintClose.textContent = "×";
    const hintArrow = document.createElement("span");
    hintArrow.className = "autopilot-hint-arrow";
    hintArrow.innerHTML = DOWN_ARROW_SVG;

    hint.append(hintText, hintClose, hintArrow);

    hideAutopilotHint = () => {
      if (hint.hidden) return;
      hint.hidden = true;
      clearTimeout(autopilotHintTimer);
    };
    hintClose.addEventListener("click", hideAutopilotHint);
    autopilotHintTimer = setTimeout(
      hideAutopilotHint,
      AUTOPILOT_HINT_TIMEOUT_MS,
    );

    autopilot.addEventListener("click", () => options.onToggleAutopilot?.());
    autopilotWrap.append(hint, autopilot);
    controls.appendChild(autopilotWrap);
  }

  const osmBuildingsToggle = document.createElement("button");
  osmBuildingsToggle.textContent = "Buildings";
  osmBuildingsToggle.dataset.testid = "viewing-osm-buildings-toggle";
  if (options.onToggleOsmBuildings) {
    osmBuildingsToggle.addEventListener("click", () =>
      options.onToggleOsmBuildings?.(),
    );
    controls.appendChild(osmBuildingsToggle);
  }

  controls.append(mapToggle, endTour);
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
    setMapToggleLabel(label) {
      mapToggle.textContent = label;
    },
    setAutopilotLabel(label) {
      autopilot.textContent = label;
    },
    setOsmBuildingsLabel(label) {
      if (!options.onToggleOsmBuildings) return;
      osmBuildingsToggle.textContent = label;
    },
    dismissAutopilotHint() {
      hideAutopilotHint?.();
    },
    destroy() {
      clearTimeout(autopilotHintTimer);
      element.remove();
    },
  };
}
