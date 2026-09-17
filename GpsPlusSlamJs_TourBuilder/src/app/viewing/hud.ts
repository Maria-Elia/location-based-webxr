/**
 * The in-session HUD (plan VC9, VC23, VC24, VC15f).
 *
 * Mounted into the AR container, i.e. the WebXR DOM Overlay root, so it
 * composites over the camera feed. Holds the map toggle, the wayfinding guide
 * toggle, the End-tour control, the alignment/tracking coaching line, and a
 * one-shot notice channel for things the visitor must be told (audio
 * blocked, map tiles unavailable).
 *
 * Knows nothing about the store or the scene — `viewing-app.ts` pushes text
 * in and reacts to the callbacks.
 */

/** How long a callout hint stays up before it dismisses itself. */
const AUTOPILOT_HINT_TIMEOUT_MS = 8000;
const WAYFINDING_HINT_TIMEOUT_MS = 8000;

/** A small downward-pointing chevron — the hint bubble sits above the
 *  button and needs to visually point down at it. */
const DOWN_ARROW_SVG =
  '<svg width="14" height="14" viewBox="0 0 12 12"><path d="M2 4 L6 9 L10 4" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export interface HudOptions {
  readonly onToggleMap: () => void;
  readonly onEndTour: () => void;
  /** Preview mode only: walk the breadcrumb automatically (VC25). */
  readonly onToggleAutopilot?: () => void;
  /** Show/hide the single wayfinding guide indicator — available in both
   *  AR and preview, unlike autopilot (plan 2026-09-17-breadcrumb-wayfinding). */
  readonly onToggleWayfinding: () => void;
}

export interface Hud {
  /** The alignment/tracking coaching line (plan VC23). Empty string hides it. */
  setStatus(message: string): void;
  /** One-shot notice: audio blocked, tiles offline, a failed asset. */
  showNotice(message: string): void;
  setMapToggleLabel(label: string): void;
  /** No-op unless the HUD was mounted with an autopilot toggle. */
  setAutopilotLabel(label: string): void;
  /** Hides the one-time "try Auto-walk" callout, if it's still showing.
   *  No-op once already dismissed or when there's no autopilot toggle. */
  dismissAutopilotHint(): void;
  setWayfindingLabel(label: string): void;
  /** Hides the one-time "try Wayfinding" callout, if it's still showing. */
  dismissWayfindingHint(): void;
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

  const wayfinding = document.createElement("button");
  wayfinding.textContent = "Wayfinding";
  wayfinding.dataset.testid = "viewing-wayfinding";
  wayfinding.addEventListener("click", () => options.onToggleWayfinding());

  /**
   * A one-time callout above a toggle button rather than turning the
   * feature on by itself: the visitor stays in control from the first
   * frame, but still finds out the feature exists instead of only via the
   * status line's prose. Shared by autopilot and the wayfinding guide —
   * same bubble, same dismiss/close/auto-timeout behavior, different text.
   */
  function mountHintedToggle(
    button: HTMLButtonElement,
    hintTestid: string,
    hintText: string,
    timeoutMs: number,
  ): { readonly wrap: HTMLDivElement; dismiss: () => void } {
    const wrap = document.createElement("div");
    wrap.className = "hud-hint-wrap";

    const hint = document.createElement("div");
    hint.className = "hud-hint";
    hint.dataset.testid = hintTestid;

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

    const dismiss = (): void => {
      if (hint.hidden) return;
      hint.hidden = true;
      clearTimeout(timer);
    };
    hintClose.addEventListener("click", dismiss);
    const timer = setTimeout(dismiss, timeoutMs);

    wrap.append(hint, button);
    return { wrap, dismiss };
  }

  let hideAutopilotHint: (() => void) | undefined;
  if (options.onToggleAutopilot) {
    const { wrap, dismiss } = mountHintedToggle(
      autopilot,
      "viewing-autopilot-hint",
      "Try Auto-walk to move hands-free",
      AUTOPILOT_HINT_TIMEOUT_MS,
    );
    hideAutopilotHint = dismiss;
    autopilot.addEventListener("click", () => options.onToggleAutopilot?.());
    controls.appendChild(wrap);
  }

  // Map + End tour sit between the two hinted toggles on purpose: both
  // hint bubbles are much wider than their own button and both show on
  // mount, so placing Auto-walk and Wayfinding directly adjacent makes
  // the two callouts overlap.
  controls.append(mapToggle, endTour);

  const { wrap: wayfindingWrap, dismiss: hideWayfindingHint } =
    mountHintedToggle(
      wayfinding,
      "viewing-wayfinding-hint",
      "Try Wayfinding to find your way",
      WAYFINDING_HINT_TIMEOUT_MS,
    );
  controls.appendChild(wayfindingWrap);

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
    dismissAutopilotHint() {
      hideAutopilotHint?.();
    },
    setWayfindingLabel(label) {
      wayfinding.textContent = label;
    },
    dismissWayfindingHint() {
      hideWayfindingHint();
    },
    destroy() {
      hideAutopilotHint?.();
      hideWayfindingHint();
      element.remove();
    },
  };
}
