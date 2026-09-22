# HUD icon buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the text buttons in the in-session HUD with round icon buttons (phone AR view + desktop preview), and confirm before ending a tour.

**Architecture:** A new shared `icon-button` helper builds the round button. A new pure `hud-state` module owns all toggle wording, so `hud.ts` exposes state setters (`setMapActive`, …) instead of free-text label setters. `hud.ts` swaps its five text buttons for icon buttons, shows hint bubbles one at a time, and hosts a `confirm-dialog` for End tour. `hud.css` becomes the single source of HUD styling (it is stale today) and is linked from both the composed app and the desktop-preview demo.

**Tech Stack:** TypeScript (strict), plain DOM, inline SVG, CSS, Vitest + jsdom, pnpm. No new dependencies.

**Spec:** `plans/2026-09-20-hud-icon-buttons-plan.md` (revision 2). Read it first; this plan implements it.

## Global Constraints

- Package: `GpsPlusSlamJs_TourBuilder`. Run every command from that directory. Source paths below are relative to `GpsPlusSlamJs_TourBuilder/src`.
- One design for mobile and desktop: same DOM and CSS. Size 48px under `@media (pointer: coarse)`, 40px otherwise.
- All five buttons stay visible in the existing horizontal bottom row. No drawer.
- Icons are inline SVG, 24px viewBox, stroke, `currentColor`. No icon library.
- `aria-label` and `title` are always identical, and name the action the tap performs (`Show map` / `Hide map`, `Auto-walk` / `Stop auto-walk`, `Wayfinding` / `Stop wayfinding`).
- Keep `data-testid` values on the same elements: `viewing-map-toggle`, `viewing-end-tour`, `viewing-autopilot`, `viewing-wayfinding`, `viewing-osm-buildings-toggle`.
- Buildings has four states (spec §2b): `off` → `Show buildings`; `idle`/`loading` → busy, `Loading buildings…`; `loaded` → pressed, `Hide buildings`; `failed` → error, `Buildings failed — tap to retry`. The button stays clickable while busy.
- One hint bubble at a time. Auto-walk hint shows on mount; Wayfinding hint waits for it. No Auto-walk button → Wayfinding hint shows on mount. Both hints are one-time.
- End tour uses `<dialog>` opened **without** `showModal()` (WebXR DOM overlay). Escape, backdrop tap and focus trap are ours.
- The HUD's four label setters are removed (knip fails on dead code): `setMapToggleLabel`, `setAutopilotLabel`, `setWayfindingLabel`, `setOsmBuildingsLabel`.
- TDD: red → green → refactor. Conventional Commits. Commit trailer: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Per-directory READMEs are the sidecar docs (ADR 0001). Update them.
- Out of scope: landing, viewing entry screens, authoring panel, pack-and-share panel.

## Findings that shape this plan

1. **The composed app does not load `hud.css`.** `app/index.html` links only `app.css`. So today HUD buttons in the app get the generic `button` skin from `app.css:104`, and hint styles come from `app.css:622+`. `components/desktop-preview/index.html` links `hud.css`, which still styles the old `.autopilot-wrap`/`.autopilot-hint*` names, so the demo renders hints unstyled. Task 5 makes `hud.css` the single source and links it from both HTML files.
2. **CSS specificity.** `app.css` has `button:hover:not(:disabled)` (0,2,1), which beats `.icon-btn` (0,1,0). Pressed/hover rules for `.icon-btn` must use `:not(:disabled)` too so they reach (0,3,0).
3. **jsdom has no `dialog.show()`/`showModal()`.** Set `dialog.open = true/false` (reflected attribute). It works in jsdom and real browsers, and renders non-modal.
4. **`OsmBuildingStatus` lives in `components/desktop-preview/view/`.** `hud.ts` must not import it (the HUD is shared and the boundary is one-way). `hud-state.ts` declares an identical `HudBuildingsStatus` union; TypeScript's structural typing lets callers pass an `OsmBuildingStatus`.
5. **Knip.** `icon-button.ts` is unused by production code until Task 5, so `pnpm run check:deadcode` fails between Tasks 1 and 5. Run per-task checks (below), and the full gate at Task 7. Do not push before Task 7.
6. **Deviation from spec §"Commits":** hint sequencing (§3b) is its own commit (Task 4) before the icon swap. Task 2 is a refactor commit whose text buttons get new wording (`Show map`, `Hide buildings`, …) because the HUD now owns the wording; say so in its commit body.

## Per-task check command

Unless a step says otherwise, "run the checks" means:

```bash
pnpm exec prettier --write src && pnpm run typecheck && pnpm run typecheck:tests && pnpm run lint
```

and the vitest files named in the step.

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `components/shared/icon-button.ts` | Create | `createIconButton` — round `<button>` from SVG + label; pressed/busy/error setters |
| `components/shared/icon-button.css` | Create | Round button skin, sizes, pressed fill + badge, danger, busy ring, error ring |
| `components/shared/icon-button.test.ts` | Create | Unit tests for the helper |
| `components/shared/hud-state.ts` | Create | Pure: toggle labels, `HudBuildingsStatus`, `buildingsAppearance` |
| `components/shared/hud-state.test.ts` | Create | Unit tests for the table in spec §2b |
| `components/shared/hud-icons.ts` | Create | `HUD_ICONS` — five 24px SVG strings |
| `components/shared/confirm-dialog.ts` | Create | Non-modal `<dialog>` confirm with Escape / backdrop / focus trap |
| `components/shared/confirm-dialog.test.ts` | Create | Unit tests for the dialog |
| `components/shared/hud.ts` | Modify | State setters, hint sequencing, icon buttons, End-tour dialog |
| `components/shared/hud.css` | Modify | Single source for HUD styling (bar, hints, dialog) |
| `components/shared/hud.test.ts` | Modify | Follow the new API; add new behavior tests |
| `app/app.css` | Modify | Delete `.ar-hud*` / `.hud-hint*` rules now owned by `hud.css` |
| `app/index.html` | Modify | Link `hud.css` and `icon-button.css` |
| `components/desktop-preview/index.html` | Modify | Link `icon-button.css` |
| `app/viewing/viewing-app.ts` | Modify | Use state setters, `setMapVisible` helper; delete `osmBuildingsLabel` |
| `app/viewing/viewing-app.test.ts` | Modify | New labels, map pressed state, End-tour confirm click |
| `components/desktop-preview/demo.ts` | Modify | Same migration as `viewing-app.ts` |
| `components/shared/README.md`, `app/viewing/README.md` | Modify | Docs |

---

### Task 1: Icon button helper

**Files:**
- Create: `components/shared/icon-button.ts`, `components/shared/icon-button.css`
- Test: `components/shared/icon-button.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type IconButtonVariant = "default" | "danger";
  export interface IconButtonOptions {
    readonly icon: string;            // inline SVG markup
    readonly label: string;           // aria-label + title
    readonly pressed?: boolean;       // defined → toggle, gets aria-pressed
    readonly variant?: IconButtonVariant;
  }
  export interface IconButton {
    readonly element: HTMLButtonElement;
    setLabel(label: string): void;
    setPressed(pressed: boolean): void; // no-op unless created with `pressed`
    setBusy(busy: boolean): void;
    setError(error: boolean): void;
  }
  export function createIconButton(options: IconButtonOptions): IconButton;
  ```
  Classes: `icon-btn`, `icon-btn--danger`, `icon-btn--busy`, `icon-btn--error`. Glyph wrapper: `span.icon-btn-glyph`.

- [ ] **Step 1: Write the failing test**

Create `components/shared/icon-button.test.ts`:

```ts
/**
 * `createIconButton` DOM tests.
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";

import { createIconButton } from "./icon-button.js";

const SVG = '<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>';

describe("createIconButton", () => {
  it("builds a type=button with the icon, and label on aria-label and title", () => {
    const { element } = createIconButton({ icon: SVG, label: "Show map" });
    expect(element.tagName).toBe("BUTTON");
    expect(element.type).toBe("button");
    expect(element.classList.contains("icon-btn")).toBe(true);
    expect(element.getAttribute("aria-label")).toBe("Show map");
    expect(element.title).toBe("Show map");
    expect(element.querySelector("svg")).not.toBeNull();
    expect(element.querySelector(".icon-btn-glyph")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("setLabel updates aria-label and title together", () => {
    const button = createIconButton({ icon: SVG, label: "Show map" });
    button.setLabel("Hide map");
    expect(button.element.getAttribute("aria-label")).toBe("Hide map");
    expect(button.element.title).toBe("Hide map");
  });

  it("has aria-pressed only when created as a toggle", () => {
    const action = createIconButton({ icon: SVG, label: "End tour" });
    expect(action.element.hasAttribute("aria-pressed")).toBe(false);
    action.setPressed(true); // no-op for a plain action
    expect(action.element.hasAttribute("aria-pressed")).toBe(false);

    const toggle = createIconButton({ icon: SVG, label: "Map", pressed: false });
    expect(toggle.element.getAttribute("aria-pressed")).toBe("false");
    toggle.setPressed(true);
    expect(toggle.element.getAttribute("aria-pressed")).toBe("true");
  });

  it("danger variant adds its class", () => {
    const { element } = createIconButton({ icon: SVG, label: "End", variant: "danger" });
    expect(element.classList.contains("icon-btn--danger")).toBe(true);
  });

  it("busy sets aria-busy and its class, and keeps the button enabled", () => {
    const button = createIconButton({ icon: SVG, label: "Buildings", pressed: false });
    button.setBusy(true);
    expect(button.element.getAttribute("aria-busy")).toBe("true");
    expect(button.element.classList.contains("icon-btn--busy")).toBe(true);
    expect(button.element.disabled).toBe(false);
    button.setBusy(false);
    expect(button.element.hasAttribute("aria-busy")).toBe(false);
    expect(button.element.classList.contains("icon-btn--busy")).toBe(false);
  });

  it("error toggles its class", () => {
    const button = createIconButton({ icon: SVG, label: "Buildings", pressed: false });
    button.setError(true);
    expect(button.element.classList.contains("icon-btn--error")).toBe(true);
    button.setError(false);
    expect(button.element.classList.contains("icon-btn--error")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/shared/icon-button.test.ts`
Expected: FAIL — cannot resolve `./icon-button.js`.

- [ ] **Step 3: Write the helper**

Create `components/shared/icon-button.ts`:

```ts
/**
 * Round icon button (HUD plan 2026-09-20).
 *
 * Builds a `<button>` from an inline SVG and a label. Pure DOM, no store, no
 * Three.js. Styling lives in `icon-button.css` and keys off `aria-pressed`, so
 * the DOM state and the visual state cannot drift apart.
 *
 * `label` is written to both `aria-label` and `title` (identical): a sighted
 * mouse user gets the tooltip, assistive tech gets the name.
 */

export type IconButtonVariant = "default" | "danger";

export interface IconButtonOptions {
  /** Inline SVG markup. Use `currentColor` so CSS controls the color. */
  readonly icon: string;
  /** Written to `aria-label` and `title`. Name the action the tap performs. */
  readonly label: string;
  /** When defined the button is a toggle and carries `aria-pressed`. */
  readonly pressed?: boolean;
  /** `danger` = permanently red-tinted (a destructive action). */
  readonly variant?: IconButtonVariant;
}

export interface IconButton {
  readonly element: HTMLButtonElement;
  setLabel(label: string): void;
  /** No-op unless the button was created with `pressed`. */
  setPressed(pressed: boolean): void;
  /** Spinning ring + `aria-busy`. Does NOT disable the button. */
  setBusy(busy: boolean): void;
  /** Transient red ring + icon (distinct from the permanent `danger` variant). */
  setError(error: boolean): void;
}

export function createIconButton(options: IconButtonOptions): IconButton {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "icon-btn";
  if (options.variant === "danger") element.classList.add("icon-btn--danger");

  const glyph = document.createElement("span");
  glyph.className = "icon-btn-glyph";
  glyph.setAttribute("aria-hidden", "true");
  glyph.innerHTML = options.icon;
  element.appendChild(glyph);

  const isToggle = options.pressed !== undefined;
  if (options.pressed !== undefined) {
    element.setAttribute("aria-pressed", String(options.pressed));
  }

  const button: IconButton = {
    element,
    setLabel(label) {
      element.setAttribute("aria-label", label);
      element.title = label;
    },
    setPressed(pressed) {
      if (!isToggle) return;
      element.setAttribute("aria-pressed", String(pressed));
    },
    setBusy(busy) {
      element.classList.toggle("icon-btn--busy", busy);
      if (busy) element.setAttribute("aria-busy", "true");
      else element.removeAttribute("aria-busy");
    },
    setError(error) {
      element.classList.toggle("icon-btn--error", error);
    },
  };
  button.setLabel(options.label);
  return button;
}
```

- [ ] **Step 4: Write the CSS**

Create `components/shared/icon-button.css`:

```css
/*
 * Round icon button (`icon-button.ts`). Tokens use `var(--token, fallback)` so
 * it renders the same with or without app.css's design tokens.
 *
 * Specificity note: app.css has a generic `button:hover:not(:disabled)`
 * (0,2,1). Every state rule below that must beat it carries `:not(:disabled)`
 * so it reaches (0,3,0). Pressed comes AFTER hover so a pressed+hovered button
 * stays accent-filled.
 */

.icon-btn {
  --icon-btn-size: 40px;
  position: relative;
  display: inline-grid;
  place-items: center;
  box-sizing: border-box;
  width: var(--icon-btn-size);
  height: var(--icon-btn-size);
  min-height: 0; /* beat app.css's generic button min-height: 44px */
  padding: 0;
  border-radius: 50%;
  background: #1b2338;
  border: 1px solid var(--border, #2a3550);
  color: #9aa6bf;
  cursor: pointer;
  transition:
    background var(--duration-base, 200ms)
      var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
    border-color var(--duration-base, 200ms)
      var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
    color var(--duration-base, 200ms)
      var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

@media (pointer: coarse) {
  .icon-btn {
    --icon-btn-size: 48px;
  }
}

.icon-btn-glyph {
  display: grid;
  place-items: center;
  line-height: 0;
}

.icon-btn svg {
  width: 24px;
  height: 24px;
}

.icon-btn:focus-visible {
  outline: 2px solid var(--accent, #9ec1ff);
  outline-offset: 2px;
}

.icon-btn:hover:not(:disabled) {
  background: var(--surface-hover, rgb(255 255 255 / 6%));
  border-color: var(--border-strong, #3d5488);
}

/* On: solid accent fill + white icon + badge dot. Three cues (fill, badge,
   aria-pressed) so colour is never the only signal. */
.icon-btn[aria-pressed="true"]:not(:disabled) {
  background: var(--primary, #3d5488);
  border-color: var(--primary-hover, #4d6bb0);
  color: #fff;
  box-shadow: 0 0 0 2px rgb(158 193 255 / 40%);
}

.icon-btn[aria-pressed="true"]::after {
  content: "";
  position: absolute;
  top: -2px;
  right: -2px;
  width: 10px;
  height: 10px;
  box-sizing: border-box;
  border-radius: 50%;
  background: #fff;
  border: 2px solid var(--primary, #3d5488);
}

.icon-btn--danger:not(:disabled) {
  color: var(--error, #f87171);
}

.icon-btn--error:not(:disabled) {
  color: var(--error, #f87171);
  border-color: var(--error, #f87171);
  box-shadow: 0 0 0 2px rgb(248 113 113 / 35%);
}

.icon-btn--busy::before {
  content: "";
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  border: 2px solid transparent;
  border-top-color: var(--accent, #9ec1ff);
  animation: icon-btn-spin 900ms linear infinite;
}

@keyframes icon-btn-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .icon-btn--busy::before {
    animation: none;
  }
}
```

- [ ] **Step 5: Run test to verify it passes, then the checks**

Run: `pnpm exec vitest run src/components/shared/icon-button.test.ts` → PASS (6 tests).
Then the per-task checks (skip `check:deadcode`).

- [ ] **Step 6: Commit**

```bash
git add src/components/shared/icon-button.ts src/components/shared/icon-button.css src/components/shared/icon-button.test.ts
git commit -m "feat(tourbuilder): add shared round icon-button" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: HUD owns toggle wording (state setters)

Refactor: text buttons still render. The HUD derives their text from state.

**Files:**
- Create: `components/shared/hud-state.ts`, `components/shared/hud-state.test.ts`
- Modify: `components/shared/hud.ts`, `components/shared/hud.test.ts`, `app/viewing/viewing-app.ts` (lines ~217, 618, 701, 734), `app/viewing/viewing-app.test.ts` (lines ~686, 714, 720), `components/desktop-preview/demo.ts` (lines ~41, 118-131, 217, 229, 236, 238)

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  // hud-state.ts
  export type HudBuildingsStatus = "idle" | "loading" | "loaded" | "failed" | "off";
  export function mapLabel(active: boolean): string;        // "Hide map" | "Show map"
  export function autopilotLabel(active: boolean): string;  // "Stop auto-walk" | "Auto-walk"
  export function wayfindingLabel(active: boolean): string; // "Stop wayfinding" | "Wayfinding"
  export interface BuildingsAppearance {
    readonly pressed: boolean; readonly busy: boolean; readonly error: boolean; readonly label: string;
  }
  export function buildingsAppearance(status: HudBuildingsStatus): BuildingsAppearance;

  // Hud (hud.ts) — replaces the four label setters
  setMapActive(active: boolean): void;
  setAutopilotActive(active: boolean): void;
  setWayfindingActive(active: boolean): void;
  setOsmBuildingsStatus(status: HudBuildingsStatus): void;
  ```

- [ ] **Step 1: Write the failing `hud-state` test**

Create `components/shared/hud-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  autopilotLabel,
  buildingsAppearance,
  mapLabel,
  wayfindingLabel,
  type HudBuildingsStatus,
} from "./hud-state.js";

describe("toggle labels name the action the tap performs", () => {
  it("map", () => {
    expect(mapLabel(false)).toBe("Show map");
    expect(mapLabel(true)).toBe("Hide map");
  });
  it("autopilot", () => {
    expect(autopilotLabel(false)).toBe("Auto-walk");
    expect(autopilotLabel(true)).toBe("Stop auto-walk");
  });
  it("wayfinding", () => {
    expect(wayfindingLabel(false)).toBe("Wayfinding");
    expect(wayfindingLabel(true)).toBe("Stop wayfinding");
  });
});

describe("buildingsAppearance (spec §2b)", () => {
  const cases: ReadonlyArray<
    [HudBuildingsStatus, boolean, boolean, boolean, string]
  > = [
    ["off", false, false, false, "Show buildings"],
    ["idle", false, true, false, "Loading buildings…"],
    ["loading", false, true, false, "Loading buildings…"],
    ["loaded", true, false, false, "Hide buildings"],
    ["failed", false, false, true, "Buildings failed — tap to retry"],
  ];
  it.each(cases)("%s", (status, pressed, busy, error, label) => {
    expect(buildingsAppearance(status)).toEqual({ pressed, busy, error, label });
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm exec vitest run src/components/shared/hud-state.test.ts` → FAIL (module missing).

- [ ] **Step 3: Write `hud-state.ts`**

```ts
/**
 * Pure wording/state mapping for the HUD's toggles (plan 2026-09-20-hud-icon-buttons).
 *
 * The HUD, not its caller, owns the wording: an icon-only button must never
 * carry a label that contradicts its icon or `aria-pressed`. Labels name the
 * action the tap performs.
 *
 * `HudBuildingsStatus` is structurally identical to the desktop-preview's
 * `OsmBuildingStatus` (components/desktop-preview/view/osm-building-layer.ts).
 * It is redeclared here so the shared HUD does not import from a sibling
 * component; callers can pass an `OsmBuildingStatus` directly.
 */

export type HudBuildingsStatus =
  | "idle"
  | "loading"
  | "loaded"
  | "failed"
  | "off";

export function mapLabel(active: boolean): string {
  return active ? "Hide map" : "Show map";
}

export function autopilotLabel(active: boolean): string {
  return active ? "Stop auto-walk" : "Auto-walk";
}

export function wayfindingLabel(active: boolean): string {
  return active ? "Stop wayfinding" : "Wayfinding";
}

export interface BuildingsAppearance {
  readonly pressed: boolean;
  /** Spinner ring while the layer loads. The button stays clickable. */
  readonly busy: boolean;
  /** Red ring: the fetch failed and a tap retries. */
  readonly error: boolean;
  readonly label: string;
}

export function buildingsAppearance(
  status: HudBuildingsStatus,
): BuildingsAppearance {
  switch (status) {
    case "off":
      return { pressed: false, busy: false, error: false, label: "Show buildings" };
    case "idle": // only ever seen momentarily — the session loads straight away
    case "loading":
      return { pressed: false, busy: true, error: false, label: "Loading buildings…" };
    case "loaded":
      return { pressed: true, busy: false, error: false, label: "Hide buildings" };
    case "failed":
      return {
        pressed: false,
        busy: false,
        error: true,
        label: "Buildings failed — tap to retry",
      };
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run src/components/shared/hud-state.test.ts` → PASS.

- [ ] **Step 5: Rewrite the affected `hud.test.ts` tests (red)**

In `components/shared/hud.test.ts`, replace these three tests.

(a) The test `"setMapToggleLabel is a harmless no-op without a map toggle"`:

```ts
  it("setMapActive is a harmless no-op without a map toggle", () => {
    const { hud } = setup(true, { withMap: false });
    expect(() => hud.setMapActive(true)).not.toThrow();
    expect(query(container, "viewing-map-toggle")).toBeNull();
  });
```

(b) The test `"setStatus/showNotice/setMapToggleLabel/setAutopilotLabel update their elements"`:

```ts
  it("setStatus/showNotice update their elements", () => {
    const { hud } = setup();
    hud.setStatus("hello");
    expect(query(container, "viewing-hud-status")!.textContent).toBe("hello");
    expect(query(container, "viewing-hud-status")!.hidden).toBe(false);

    hud.showNotice("careful");
    expect(query(container, "viewing-hud-notice")!.textContent).toBe("careful");
    expect(query(container, "viewing-hud-notice")!.hidden).toBe(false);
  });

  it("toggle buttons start inactive and their label + aria-pressed follow the state setters", () => {
    const { hud } = setup(true, { withOsmBuildings: true });
    const map = query(container, "viewing-map-toggle")!;
    const autopilot = query(container, "viewing-autopilot")!;
    const wayfinding = query(container, "viewing-wayfinding")!;

    expect(map.getAttribute("aria-label")).toBe("Show map");
    expect(map.getAttribute("aria-pressed")).toBe("false");

    hud.setMapActive(true);
    expect(map.getAttribute("aria-label")).toBe("Hide map");
    expect(map.getAttribute("aria-pressed")).toBe("true");

    hud.setAutopilotActive(true);
    expect(autopilot.getAttribute("aria-label")).toBe("Stop auto-walk");
    expect(autopilot.getAttribute("aria-pressed")).toBe("true");
    hud.setAutopilotActive(false);
    expect(autopilot.getAttribute("aria-label")).toBe("Auto-walk");

    hud.setWayfindingActive(true);
    expect(wayfinding.getAttribute("aria-label")).toBe("Stop wayfinding");
    expect(wayfinding.getAttribute("aria-pressed")).toBe("true");
    hud.setWayfindingActive(false);
    expect(wayfinding.getAttribute("aria-label")).toBe("Wayfinding");
  });
```

(c) The two tests `"renders a Buildings button, defaulting to that label…"` and `"setOsmBuildingsLabel updates the button's text…"`:

```ts
  it("renders a Buildings button, defaulting to the off state, when onToggleOsmBuildings is given", () => {
    setup(true, { withOsmBuildings: true });
    const button = query(container, "viewing-osm-buildings-toggle");
    expect(button).not.toBeNull();
    expect(button!.getAttribute("aria-label")).toBe("Show buildings");
    expect(button!.getAttribute("aria-pressed")).toBe("false");
  });

  it("setOsmBuildingsStatus maps each status to label + aria-pressed, and is a no-op without the toggle", () => {
    const { hud } = setup(true, { withOsmBuildings: true });
    const button = query(container, "viewing-osm-buildings-toggle")!;

    hud.setOsmBuildingsStatus("loaded");
    expect(button.getAttribute("aria-label")).toBe("Hide buildings");
    expect(button.getAttribute("aria-pressed")).toBe("true");

    hud.setOsmBuildingsStatus("loading");
    expect(button.getAttribute("aria-label")).toBe("Loading buildings…");
    expect(button.getAttribute("aria-pressed")).toBe("false");

    hud.setOsmBuildingsStatus("failed");
    expect(button.getAttribute("aria-label")).toBe(
      "Buildings failed — tap to retry",
    );

    const { hud: hudNoToggle } = setup(true, { withOsmBuildings: false });
    expect(() => hudNoToggle.setOsmBuildingsStatus("failed")).not.toThrow();
  });
```

Run: `pnpm exec vitest run src/components/shared/hud.test.ts` → FAIL (setters missing / typecheck).

- [ ] **Step 6: Change `hud.ts`**

(a) Add the import under the header comment:

```ts
import {
  autopilotLabel,
  buildingsAppearance,
  mapLabel,
  wayfindingLabel,
  type HudBuildingsStatus,
} from "./hud-state.js";
```

(b) In `interface Hud`, delete `setMapToggleLabel`, `setAutopilotLabel`, `setOsmBuildingsLabel`, `setWayfindingLabel` and add:

```ts
  /** No-op unless the HUD was mounted with a map toggle. */
  setMapActive(active: boolean): void;
  /** No-op unless the HUD was mounted with an autopilot toggle. */
  setAutopilotActive(active: boolean): void;
  setWayfindingActive(active: boolean): void;
  /** No-op unless the HUD was mounted with an OSM buildings toggle. */
  setOsmBuildingsStatus(status: HudBuildingsStatus): void;
```

(c) Add module-level (above `mountHud`):

```ts
/** A HUD toggle whose visible wording the HUD derives from state. */
interface Toggle {
  readonly element: HTMLButtonElement;
  set(label: string, pressed: boolean): void;
}

function textToggle(testid: string, label: string): Toggle {
  const element = document.createElement("button");
  element.dataset.testid = testid;
  const toggle: Toggle = {
    element,
    set(next, pressed) {
      element.textContent = next;
      element.setAttribute("aria-label", next);
      element.setAttribute("aria-pressed", String(pressed));
    },
  };
  toggle.set(label, false);
  return toggle;
}
```

(d) Replace the four `document.createElement("button")` blocks for map / autopilot / wayfinding / buildings. `endTour` stays as is. New code:

```ts
  const mapToggle = textToggle("viewing-map-toggle", mapLabel(false));
  if (options.onToggleMap) {
    mapToggle.element.addEventListener("click", () => options.onToggleMap?.());
  }
```
```ts
  const autopilot = textToggle("viewing-autopilot", autopilotLabel(false));

  const wayfinding = textToggle("viewing-wayfinding", wayfindingLabel(false));
  wayfinding.element.addEventListener("click", () =>
    options.onToggleWayfinding(),
  );
```
```ts
  const osmBuildingsToggle = textToggle(
    "viewing-osm-buildings-toggle",
    buildingsAppearance("off").label,
  );
  if (options.onToggleOsmBuildings) {
    osmBuildingsToggle.element.addEventListener("click", () =>
      options.onToggleOsmBuildings?.(),
    );
    controls.appendChild(osmBuildingsToggle.element);
  }
```

(e) Fix the remaining uses: `mountHintedToggle(autopilot.element, …)`, `autopilot.element.addEventListener("click", …)`, `controls.appendChild(mapToggle.element)`, `mountHintedToggle(wayfinding.element, …)`.

(f) Replace the four setters in the returned object:

```ts
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
    setOsmBuildingsStatus(status) {
      if (!options.onToggleOsmBuildings) return;
      const appearance = buildingsAppearance(status);
      osmBuildingsToggle.set(appearance.label, appearance.pressed);
    },
```

Update the file header comment: it says the HUD "pushes text in" — say the caller now pushes *state* in.

- [ ] **Step 7: Migrate `viewing-app.ts`**

- Delete the function `osmBuildingsLabel` **and its one-line docblock** (`/** viewing-app.ts computes the label from status; … */`, lines ~216-228). The `isTouchPrimaryDevice` docblock above it then sits directly on `isTouchPrimaryDevice` again — that is correct.
- `hud?.setWayfindingLabel(wayfindingEnabled ? "Stop wayfinding" : "Wayfinding");` → `hud?.setWayfindingActive(wayfindingEnabled);`
- `hud?.setAutopilotLabel(next ? "Stop auto-walk" : "Auto-walk");` → `hud?.setAutopilotActive(next);`
- `hud?.setOsmBuildingsLabel(osmBuildingsLabel(status));` → `hud?.setOsmBuildingsStatus(status);`
- Keep `import type { OsmBuildingStatus }` (still the parameter type of `applyOsmBuildingsStatus`).

- [ ] **Step 8: Migrate `desktop-preview/demo.ts`**

- Delete `osmBuildingsLabel` and its docblock (lines ~118-131).
- `hud?.setAutopilotLabel(next ? "Stop auto-walk" : "Auto-walk");` → `hud?.setAutopilotActive(next);`
- `hud?.setWayfindingLabel(wayfindingEnabled ? "Stop wayfinding" : "Wayfinding");` → `hud?.setWayfindingActive(wayfindingEnabled);`
- `hud?.setOsmBuildingsLabel(osmBuildingsLabel(buildingStatus));` → `hud?.setOsmBuildingsStatus(buildingStatus);`
- `hud.setOsmBuildingsLabel(osmBuildingsLabel(session.getOsmBuildingsStatus()));` → `hud.setOsmBuildingsStatus(session.getOsmBuildingsStatus());`
- Remove `import type { OsmBuildingStatus } from "./view/osm-building-layer.js";` (line ~41) if `grep -n OsmBuildingStatus src/components/desktop-preview/demo.ts` now shows only the import.

- [ ] **Step 9: Update `viewing-app.test.ts` expectations**

The three assertions on the buildings button change from `textContent` to `aria-label`:

- line ~686: `expect(query(root, "viewing-osm-buildings-toggle")!.getAttribute("aria-label")).toBe("Loading buildings…");`
- line ~714: `… .toBe("Hide buildings");`
- line ~720: `… .toBe("Buildings failed — tap to retry");`

The notice assertions in that test stay (`hidden === true` on failure) — Task 5 flips them.

- [ ] **Step 10: Run checks and tests**

```bash
pnpm exec prettier --write src && pnpm run typecheck && pnpm run typecheck:tests && pnpm run lint
pnpm exec vitest run src/components/shared src/app/viewing/viewing-app.test.ts
```
Expected: PASS. If typecheck reports a leftover `set*Label` use, `grep -rn "Label(" src | grep -i "hud"` and fix.

- [ ] **Step 11: Commit**

```bash
git add -A src
git commit -m "refactor(tourbuilder): HUD owns toggle wording via state setters" -m "Free-text set*Label setters become setMapActive/setAutopilotActive/setWayfindingActive/setOsmBuildingsStatus. Text buttons still render; their wording now comes from hud-state (e.g. 'Show map', 'Hide buildings'). osmBuildingsLabel is deleted from viewing-app and the desktop-preview demo." -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Report map open/closed state to the HUD

**Files:**
- Modify: `app/viewing/viewing-app.ts` (lines ~272, 435, 603, 633), `components/desktop-preview/demo.ts` (lines ~169, 205, 236), `components/shared/hud.test.ts`, `app/viewing/viewing-app.test.ts`

**Interfaces:**
- Consumes: `Hud.setMapActive(active: boolean)` (Task 2).
- Produces: `setMapVisible(visible: boolean): void` — local helper in both files that owns `mapVisible`, shows/hides the map, and pushes the state into the HUD.

- [ ] **Step 1: Write the failing tests**

In `hud.test.ts` add (map state is already covered by the Task 2 test; this one pins "open before mount"):

```ts
  it("a map opened before the HUD mounted can be reflected straight after mount", () => {
    const { hud } = setup();
    const map = query(container, "viewing-map-toggle")!;
    expect(map.getAttribute("aria-pressed")).toBe("false");
    hud.setMapActive(true);
    expect(map.getAttribute("aria-pressed")).toBe("true");
    hud.setMapActive(false);
    expect(map.getAttribute("aria-pressed")).toBe("false");
  });
```

In `viewing-app.test.ts`, add next to the preview-flow tests (copy the setup from the test `"updates the buildings label as the layer's status changes…"` ~line 660: `fakeController({ status: "unsupported" })`, `fakePreviewSession()`, `completeOnboarding`, click `viewing-enter-preview`):

```ts
  it("the Map button reflects the map's open/closed state", async () => {
    const { controller } = fakeController({ status: "unsupported" });
    const preview = fakePreviewSession();
    const createPreviewSession = vi.fn(() => preview);

    mountViewingApp(root, "https://host.example/tour.zip", {
      ...testDeps({
        createPreviewSession:
          createPreviewSession as unknown as ViewingAppDeps["createPreviewSession"],
      }),
      createController: () => controller as never,
    });

    await vi.waitFor(() => {
      expect(query(root, "grant-access")).not.toBeNull();
    });
    await completeOnboarding(root);
    query(root, "viewing-enter-preview")!.click();
    await vi.waitFor(() => {
      expect(query(root, "viewing-map-toggle")).not.toBeNull();
    });

    const mapButton = query(root, "viewing-map-toggle") as HTMLButtonElement;
    // The session shell opens the map, so the button starts pressed.
    expect(mapButton.getAttribute("aria-pressed")).toBe("true");
    expect(mapButton.getAttribute("aria-label")).toBe("Hide map");

    mapButton.click();
    expect(mapButton.getAttribute("aria-pressed")).toBe("false");
    expect(mapButton.getAttribute("aria-label")).toBe("Show map");

    mapButton.click();
    expect(mapButton.getAttribute("aria-pressed")).toBe("true");
  });
```

- [ ] **Step 2: Run to verify the viewing-app test fails**

Run: `pnpm exec vitest run src/app/viewing/viewing-app.test.ts -t "Map button reflects"`
Expected: FAIL — `aria-pressed` is `"false"` on mount (nothing pushes state yet).

- [ ] **Step 3: Add `setMapVisible` in `viewing-app.ts`**

Directly after `let mapVisible = false;` (line ~272) add:

```ts
  /** The one place `mapVisible` changes: shows/hides the map and tells the HUD. */
  function setMapVisible(visible: boolean): void {
    mapVisible = visible;
    if (visible) {
      map?.show();
      map?.resize();
    } else {
      map?.hide();
    }
    hud?.setMapActive(visible);
  }
```

Then replace the three assignments:

- Entry screen (~line 432-435): replace
  ```ts
  map?.show();
  map?.resize();
  mapVisible = true;
  ```
  with `setMapVisible(true);` (no HUD exists here, `hud?.` is a no-op).
- `onToggleMap` (~line 602): replace the whole body with `setMapVisible(!mapVisible);`
- End of `mountSessionShell` (~line 631-633): replace
  ```ts
  map?.show();
  map?.resize();
  mapVisible = true;
  ```
  with `setMapVisible(true);`

- [ ] **Step 4: Same in `desktop-preview/demo.ts`**

Replace `let mapVisible = true;` (line ~169) with:

```ts
let mapVisible = true;

function setMapVisible(visible: boolean): void {
  mapVisible = visible;
  if (visible) {
    map?.show();
    map?.resize();
  } else {
    map?.hide();
  }
  hud?.setMapActive(visible);
}
```

Replace the body of `onToggleMap` with `setMapVisible(!mapVisible);`. Replace the post-mount block (comment "mapHost was already attached…" through `map?.resize();`, keep the comment) — `map?.show(); map?.resize();` → `setMapVisible(true);`.

(`hud` is declared before use in `demo.ts` — `hud = mountHud(...)` assigns a `let hud`; if the typecheck complains about use-before-declare, hoist the `let hud` declaration above `setMapVisible`.)

- [ ] **Step 5: Run checks and tests**

```bash
pnpm exec prettier --write src && pnpm run typecheck && pnpm run typecheck:tests && pnpm run lint
pnpm exec vitest run src/components/shared/hud.test.ts src/app/viewing/viewing-app.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A src
git commit -m "feat(tourbuilder): report map open/closed state to the HUD" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Show HUD hints one at a time

**Files:**
- Modify: `components/shared/hud.ts`, `components/shared/hud.test.ts`

**Interfaces:**
- Consumes: Task 2's `hud.ts`.
- Produces: `mountHintedToggle(button, testid, text, timeoutMs, onGone?)` returns `{ wrap: HTMLDivElement; show: () => void; dismiss: () => void }`. A hint starts hidden ("queued"); `show()` reveals it and starts its own timeout; `dismiss()` ends it for good and calls `onGone`.

- [ ] **Step 1: Rewrite the hint tests (red)**

In `hud.test.ts`, replace every existing test whose title mentions the hint (`"shows the Auto-walk hint on mount…"` through `"the Wayfinding hint auto-dismisses after its timeout"`) with the block below. Keep `"renders no autopilot button or hint when onToggleAutopilot is omitted"`, `"clicking Auto-walk calls onToggleAutopilot"` and `"clicking Wayfinding calls onToggleWayfinding"` unchanged.

```ts
  describe("hint bubbles show one at a time", () => {
    const autopilotHint = () => query(container, "viewing-autopilot-hint")!;
    const wayfindingHint = () => query(container, "viewing-wayfinding-hint")!;
    const close = (hint: HTMLElement) =>
      hint.querySelector<HTMLButtonElement>(".hud-hint-close")!.click();

    it("on mount only the Auto-walk hint is visible", () => {
      setup();
      expect(autopilotHint().hidden).toBe(false);
      expect(wayfindingHint().hidden).toBe(true);
    });

    it("the Wayfinding hint appears after the Auto-walk hint's close button", () => {
      setup();
      close(autopilotHint());
      expect(autopilotHint().hidden).toBe(true);
      expect(wayfindingHint().hidden).toBe(false);
    });

    it("the Wayfinding hint appears after dismissAutopilotHint()", () => {
      const { hud } = setup();
      hud.dismissAutopilotHint();
      expect(wayfindingHint().hidden).toBe(false);
    });

    it("the Wayfinding hint appears when the Auto-walk hint times out, and its own 8s starts then", () => {
      vi.useFakeTimers();
      try {
        setup();
        vi.advanceTimersByTime(8000);
        expect(autopilotHint().hidden).toBe(true);
        expect(wayfindingHint().hidden).toBe(false);

        vi.advanceTimersByTime(7999);
        expect(wayfindingHint().hidden).toBe(false);
        vi.advanceTimersByTime(1);
        expect(wayfindingHint().hidden).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it("with no Auto-walk button the Wayfinding hint is visible on mount", () => {
      setup(false);
      expect(wayfindingHint().hidden).toBe(false);
    });

    it("dismissWayfindingHint() while queued means it never appears", () => {
      const { hud } = setup();
      hud.dismissWayfindingHint();
      hud.dismissAutopilotHint();
      expect(wayfindingHint().hidden).toBe(true);
    });

    it("the Wayfinding hint's own × dismisses it, and nothing re-appears", () => {
      const { hud } = setup(false);
      close(wayfindingHint());
      expect(wayfindingHint().hidden).toBe(true);
      hud.dismissAutopilotHint(); // harmless: no autopilot
      expect(wayfindingHint().hidden).toBe(true);
    });

    it("dismissWayfindingHint() hides a shown hint", () => {
      const { hud } = setup(false);
      hud.dismissWayfindingHint();
      expect(wayfindingHint().hidden).toBe(true);
    });

    it("dismissAutopilotHint() is a harmless no-op when there is no autopilot toggle", () => {
      const { hud } = setup(false);
      expect(() => hud.dismissAutopilotHint()).not.toThrow();
    });

    it("destroy() cancels pending timers", () => {
      vi.useFakeTimers();
      try {
        const { hud } = setup();
        hud.destroy();
        expect(() => vi.advanceTimersByTime(20000)).not.toThrow();
      } finally {
        vi.useRealTimers();
      }
    });
  });
```

Run: `pnpm exec vitest run src/components/shared/hud.test.ts` → FAIL (wayfinding hint visible on mount, etc.).

- [ ] **Step 2: Rewrite `mountHintedToggle` in `hud.ts`**

Replace the whole function (and update its docblock to say hints are sequenced by the caller) with:

```ts
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
```

- [ ] **Step 3: Rewrite the hint mounting block and control order**

Replace everything from `let hideAutopilotHint …` through `controls.appendChild(wayfindingWrap);` and the buildings `controls.appendChild` with the following. Order is now: Buildings, Auto-walk, Wayfinding, Map, End tour (End tour last, so the destructive control is at the edge).

```ts
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
```

Delete the old block that appended `osmBuildingsToggle` inside its own `if` (now merged above — make sure `osmBuildingsToggle` is appended exactly once). Update the returned object:

```ts
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
```

Also replace the deleted "Map + End tour sit between…" comment — its reason is gone.

- [ ] **Step 4: Run checks and tests**

```bash
pnpm exec prettier --write src && pnpm run typecheck && pnpm run typecheck:tests && pnpm run lint
pnpm exec vitest run src/components/shared/hud.test.ts src/app/viewing/viewing-app.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat(tourbuilder): show HUD hint bubbles one at a time" -m "Wayfinding's hint waits for Auto-walk's to go away (close, 8s timeout or use). With no Auto-walk button it shows on mount. Control order is no longer constrained by bubble width." -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Use icon buttons in the HUD

**Files:**
- Create: `components/shared/hud-icons.ts`
- Modify: `components/shared/hud.ts`, `components/shared/hud.css`, `components/shared/hud.test.ts`, `app/app.css`, `app/index.html`, `components/desktop-preview/index.html`, `app/viewing/viewing-app.test.ts`

**Interfaces:**
- Consumes: `createIconButton` (Task 1), `buildingsAppearance` (Task 2).
- Produces: `HUD_ICONS: { map, walk, wayfinding, buildings, exit }` (SVG strings). `Toggle.set(label, pressed, flags?)` where `flags?: { busy?: boolean; error?: boolean }`.

- [ ] **Step 1: Write the failing tests**

In `hud.test.ts` add:

```ts
  describe("icon buttons", () => {
    it("every HUD button is a round icon button with an icon, and keeps its testid", () => {
      setup(true, { withOsmBuildings: true });
      for (const id of [
        "viewing-map-toggle",
        "viewing-end-tour",
        "viewing-autopilot",
        "viewing-wayfinding",
        "viewing-osm-buildings-toggle",
      ]) {
        const button = query(container, id)!;
        expect(button.classList.contains("icon-btn"), id).toBe(true);
        expect(button.querySelector("svg"), id).not.toBeNull();
        expect(button.textContent, id).toBe("");
        expect(button.title, id).toBe(button.getAttribute("aria-label"));
      }
    });

    it("End tour is a danger action with no pressed state", () => {
      setup();
      const endTour = query(container, "viewing-end-tour")!;
      expect(endTour.classList.contains("icon-btn--danger")).toBe(true);
      expect(endTour.hasAttribute("aria-pressed")).toBe(false);
      expect(endTour.getAttribute("aria-label")).toBe("End tour");
    });

    it("the hint's × close button is not an icon button", () => {
      setup();
      const close = query(container, "viewing-autopilot-hint")!.querySelector(
        ".hud-hint-close",
      )!;
      expect(close.classList.contains("icon-btn")).toBe(false);
    });

    it("Buildings: busy while loading, error when failed, title mirrors aria-label", () => {
      const { hud } = setup(true, { withOsmBuildings: true });
      const button = query(container, "viewing-osm-buildings-toggle")!;

      hud.setOsmBuildingsStatus("loading");
      expect(button.getAttribute("aria-busy")).toBe("true");
      expect(button.classList.contains("icon-btn--error")).toBe(false);
      expect((button as HTMLButtonElement).disabled).toBe(false);

      hud.setOsmBuildingsStatus("failed");
      expect(button.hasAttribute("aria-busy")).toBe(false);
      expect(button.classList.contains("icon-btn--error")).toBe(true);
      expect(button.title).toBe("Buildings failed — tap to retry");

      hud.setOsmBuildingsStatus("loaded");
      expect(button.classList.contains("icon-btn--error")).toBe(false);
      expect(button.getAttribute("aria-pressed")).toBe("true");
    });

    it("failed raises a one-shot notice; leaving failed clears exactly that notice", () => {
      const { hud } = setup(true, { withOsmBuildings: true });
      const notice = query(container, "viewing-hud-notice")!;

      hud.setOsmBuildingsStatus("loading");
      expect(notice.hidden).toBe(true);

      hud.setOsmBuildingsStatus("failed");
      expect(notice.hidden).toBe(false);
      expect(notice.textContent).toBe(
        "Buildings couldn't load. Tap the buildings button to retry.",
      );

      hud.setOsmBuildingsStatus("loading"); // the visitor retried
      expect(notice.hidden).toBe(true);
    });

    it("a repeated 'failed' does not re-raise a dismissed notice, and an unrelated notice is left alone", () => {
      const { hud } = setup(true, { withOsmBuildings: true });
      const notice = query(container, "viewing-hud-notice")!;

      hud.showNotice("Tap the screen once to allow this story to play.");
      hud.setOsmBuildingsStatus("failed");
      hud.setOsmBuildingsStatus("loading");
      // The audio notice was overwritten by the buildings one; clearing must
      // only hide a notice that still shows the buildings text.
      expect(notice.hidden).toBe(true);

      hud.showNotice("Tap the screen once to allow this story to play.");
      hud.setOsmBuildingsStatus("loaded");
      expect(notice.hidden).toBe(false);
    });
  });
```

Run: `pnpm exec vitest run src/components/shared/hud.test.ts -t "icon buttons"` → FAIL.

- [ ] **Step 2: Create `hud-icons.ts`**

```ts
/**
 * The five HUD control icons (plan 2026-09-20-hud-icon-buttons). Hand-authored
 * 24px stroke icons, `currentColor`-driven — same conventions as `icons.ts`,
 * but at HUD size. Judge them by eye in the desktop preview and adjust paths
 * freely; nothing depends on the exact geometry.
 */
const OPEN =
  '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">';

export const HUD_ICONS = {
  map: `${OPEN}<path d="M9 4 L3 6.5 V20 L9 17.5 L15 20 L21 17.5 V4 L15 6.5 Z"/><path d="M9 4 V17.5 M15 6.5 V20"/></svg>`,
  walk: `${OPEN}<circle cx="13" cy="4.5" r="1.8"/><path d="M10 21 L11.5 15 L9 12.5 L11 8.5 L14.5 10 L16.5 13"/><path d="M11.5 15 L14 18 L14 21"/></svg>`,
  wayfinding: `${OPEN}<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5 L13.5 13.5 L8.5 15.5 L10.5 10.5 Z"/></svg>`,
  buildings: `${OPEN}<rect x="5" y="3" width="8" height="18" rx="1"/><rect x="13" y="9" width="6" height="12" rx="1"/><path d="M8 7 H10 M8 11 H10 M8 15 H10 M15.5 13 H16.5 M15.5 17 H16.5"/></svg>`,
  exit: `${OPEN}<path d="M10 4 H5 V20 H10"/><path d="M14 8 L18 12 L14 16 M18 12 H9"/></svg>`,
} as const;
```

- [ ] **Step 3: Swap the factory in `hud.ts`**

Imports:

```ts
import { createIconButton } from "./icon-button.js";
import { HUD_ICONS } from "./hud-icons.js";
```

Replace `interface Toggle`, and `textToggle` with:

```ts
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
```

Change the four factory calls:

```ts
  const mapToggle = iconToggle("viewing-map-toggle", HUD_ICONS.map, mapLabel(false));
  const autopilot = iconToggle("viewing-autopilot", HUD_ICONS.walk, autopilotLabel(false));
  const wayfinding = iconToggle("viewing-wayfinding", HUD_ICONS.wayfinding, wayfindingLabel(false));
  const osmBuildingsToggle = iconToggle(
    "viewing-osm-buildings-toggle",
    HUD_ICONS.buildings,
    buildingsAppearance("off").label,
  );
```

Replace the `endTour` block:

```ts
  const endTour = createIconButton({
    icon: HUD_ICONS.exit,
    label: "End tour",
    variant: "danger",
  }).element;
  endTour.dataset.testid = "viewing-end-tour";
```

Update `setOsmBuildingsStatus` and add the notice handling. Add a module constant and a `lastBuildingsStatus` variable:

```ts
const BUILDINGS_FAILED_NOTICE =
  "Buildings couldn't load. Tap the buildings button to retry.";
```
```ts
  let lastBuildingsStatus: HudBuildingsStatus = "off";
```
```ts
    setOsmBuildingsStatus(status) {
      if (!options.onToggleOsmBuildings) return;
      const { label, pressed, busy, error } = buildingsAppearance(status);
      osmBuildingsToggle.set(label, pressed, { busy, error });
      // The red ring alone is not readable at a glance outdoors, so the
      // transition INTO failed also raises a notice. Leaving failed clears it,
      // but only while it still shows this text (never someone else's notice).
      if (status === "failed" && lastBuildingsStatus !== "failed") {
        notice.textContent = BUILDINGS_FAILED_NOTICE;
        notice.hidden = false;
      } else if (
        status !== "failed" &&
        notice.textContent === BUILDINGS_FAILED_NOTICE
      ) {
        notice.hidden = true;
      }
      lastBuildingsStatus = status;
    },
```

Remove the now-unused `textToggle`.

- [ ] **Step 4: Rewrite `hud.css`**

`hud.css` becomes the single source of HUD styling. Keep the header comment (update it to say the composed app links it too), the `.ar-hud`, `.ar-hud > *`, `.status-banner`, `.error-banner` blocks. Then:

1. Replace `.ar-hud-controls` with:
   ```css
   .ar-hud-controls {
     display: flex;
     align-items: flex-end;
     gap: var(--space-2, 8px);
     justify-content: flex-end;
   }
   ```
2. **Delete** the button-skin blocks (`.ar-hud-controls > button, … > .autopilot-wrap > button` and its `:hover`) and the whole stale `.autopilot-wrap` / `.autopilot-hint*` / `@keyframes autopilot-hint-in` section.
3. **Add** the hint rules, copied from `app/app.css:622-710` with tokens given fallbacks (same values as the old `.autopilot-*` rules). Use class names `.hud-hint-wrap`, `.hud-hint`, `.hud-hint[hidden]`, `.hud-hint-close`, `.hud-hint-close::before`, `.hud-hint-close:hover`, `.hud-hint-arrow`, `@keyframes hud-hint-in`. Take `.hud-hint`'s `max-width: min(220px, calc(100vw - 24px))` and its "Wraps rather than a fixed nowrap line" comment from `app.css`. Keep the `[hidden]` rule and its comment.

Do this by moving the text, not retyping: `sed -n '622,710p' src/app/app.css` and paste, then wrap every `var(--x)` as `var(--x, <fallback>)` using the fallbacks already present in the old hud.css rules.

- [ ] **Step 5: Remove the duplicates from `app/app.css`**

Delete `.ar-hud`, `.ar-hud > *`, `.ar-hud-controls` and the `.hud-hint*` / `@keyframes hud-hint-in` rules (lines ~596-710, up to but not including the `/* Desktop preview: … */` comment that starts `.preview-canvas`). Before deleting, confirm `.ar-hud` matches `hud.css`:

```bash
sed -n '590,615p' src/app/app.css
```
Expected: same declarations as `hud.css`'s `.ar-hud` (`position: fixed; inset: auto 0 0; z-index: 10; display: flex; flex-direction: column; gap; padding; background: linear-gradient…; pointer-events: none`). If `app.css` has a declaration `hud.css` lacks, copy it into `hud.css` first.

- [ ] **Step 6: Link the CSS**

`app/index.html`, after `<link rel="stylesheet" href="./app.css" />`:

```html
    <link rel="stylesheet" href="../components/shared/hud.css" />
    <link rel="stylesheet" href="../components/shared/icon-button.css" />
```

`components/desktop-preview/index.html`, after its `hud.css` link:

```html
    <link rel="stylesheet" href="../shared/icon-button.css" />
```

- [ ] **Step 7: Flip the viewing-app "no notice" assertions**

In the test `"updates the buildings label as the layer's status changes, with no notice on failure"` (rename to `"…as the layer's status changes, and raises a notice on failure"`): the `loaded` step still expects `notice.hidden === true`; the `failed` step now expects:

```ts
    preview._emitOsmStatus("failed");
    expect(query(root, "viewing-osm-buildings-toggle")!.getAttribute("aria-label")).toBe(
      "Buildings failed — tap to retry",
    );
    expect(query(root, "viewing-hud-notice")!.hidden).toBe(false);
```

- [ ] **Step 8: Run checks and tests**

```bash
pnpm exec prettier --write src && pnpm run typecheck && pnpm run typecheck:tests && pnpm run lint && pnpm run lint:css
pnpm exec vitest run src/components/shared src/app/viewing/viewing-app.test.ts
```
Expected: PASS. Then `pnpm run check:deadcode` — `icon-button.ts` and `hud-icons.ts` are now used, so it should pass.

- [ ] **Step 9: Look at it**

```bash
pnpm run dev
```
Open the desktop preview page (`/src/components/desktop-preview/index.html`). Check: five round buttons; hover; toggle Wayfinding (accent fill + badge dot); Buildings spinner while loading; hint bubble one at a time and styled (this page was unstyled before). Then the composed app (`/src/app/index.html`) preview. Emulate touch in devtools: buttons become 48px. Fix any CSS surprises before committing.

- [ ] **Step 10: Commit**

```bash
git add -A src
git commit -m "feat(tourbuilder): use icon buttons in the HUD" -m "Round icon buttons replace the text buttons in the in-session HUD. hud.css is now the single source for HUD styling (bar + hint bubbles) and is linked from both the composed app and the desktop-preview page; the stale .autopilot-* rules and duplicated app.css rules are removed. Buildings failing also raises a notice." -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Confirm dialog before ending a tour

**Files:**
- Create: `components/shared/confirm-dialog.ts`, `components/shared/confirm-dialog.test.ts`
- Modify: `components/shared/hud.ts`, `components/shared/hud.css`, `components/shared/hud.test.ts`, `app/viewing/viewing-app.test.ts` (lines ~587, 804, 995)

**Interfaces:**
- Consumes: `IconButton` End-tour element from Task 5.
- Produces:
  ```ts
  export interface ConfirmDialogOptions {
    readonly testid: string;        // base: `${testid}-dialog|-confirm|-cancel`
    readonly title: string;
    readonly confirmLabel: string;
    readonly cancelLabel: string;
    readonly onConfirm: () => void;
  }
  export interface ConfirmDialog {
    readonly element: HTMLElement;
    open(returnFocusTo?: HTMLElement): void;
    close(): void;
    destroy(): void;
  }
  export function createConfirmDialog(options: ConfirmDialogOptions): ConfirmDialog;
  ```
  HUD testids: `viewing-end-tour-dialog`, `viewing-end-tour-confirm`, `viewing-end-tour-cancel`.

- [ ] **Step 1: Write the failing dialog test**

Create `components/shared/confirm-dialog.test.ts`:

```ts
/**
 * `createConfirmDialog` DOM tests.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createConfirmDialog, type ConfirmDialog } from "./confirm-dialog.js";

describe("createConfirmDialog", () => {
  let dialog: ConfirmDialog;
  let opener: HTMLButtonElement;

  function setup() {
    opener = document.createElement("button");
    document.body.append(opener);
    const onConfirm = vi.fn();
    dialog = createConfirmDialog({
      testid: "t",
      title: "End tour?",
      confirmLabel: "End",
      cancelLabel: "Cancel",
      onConfirm,
    });
    document.body.append(dialog.element);
    const q = (id: string) =>
      dialog.element.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
    return { onConfirm, cancel: q("t-cancel"), confirm: q("t-confirm"), box: q("t-dialog") };
  }

  afterEach(() => {
    dialog.destroy();
    opener.remove();
  });

  it("starts closed", () => {
    const { box } = setup();
    expect(dialog.element.hidden).toBe(true);
    expect((box as HTMLDialogElement).open).toBe(false);
  });

  it("open() shows it, labels it, and focuses Cancel", () => {
    const { box, cancel } = setup();
    dialog.open(opener);
    expect(dialog.element.hidden).toBe(false);
    expect((box as HTMLDialogElement).open).toBe(true);
    expect(box.getAttribute("role")).toBe("alertdialog");
    expect(box.textContent).toContain("End tour?");
    expect(document.activeElement).toBe(cancel);
  });

  it("Cancel closes without confirming, and returns focus to the opener", () => {
    const { onConfirm, cancel } = setup();
    dialog.open(opener);
    cancel.click();
    expect(dialog.element.hidden).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);
  });

  it("Confirm calls onConfirm once and closes", () => {
    const { onConfirm, confirm } = setup();
    dialog.open(opener);
    confirm.click();
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(dialog.element.hidden).toBe(true);
  });

  it("Escape cancels", () => {
    const { onConfirm } = setup();
    dialog.open(opener);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(dialog.element.hidden).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("a backdrop tap cancels", () => {
    const { onConfirm } = setup();
    dialog.open(opener);
    dialog.element.querySelector<HTMLElement>(".hud-confirm-backdrop")!.click();
    expect(dialog.element.hidden).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("Tab and Shift+Tab wrap inside the dialog", () => {
    const { cancel, confirm } = setup();
    dialog.open(opener);

    confirm.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(document.activeElement).toBe(cancel);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true }));
    expect(document.activeElement).toBe(confirm);
  });

  it("Tab from outside the dialog pulls focus back in", () => {
    const { cancel } = setup();
    dialog.open(opener);
    opener.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(document.activeElement).toBe(cancel);
  });

  it("stops listening for keys once closed", () => {
    const { cancel } = setup();
    dialog.open(opener);
    dialog.close();
    opener.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(document.activeElement).toBe(opener);
    void cancel;
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm exec vitest run src/components/shared/confirm-dialog.test.ts` → FAIL (module missing).

- [ ] **Step 3: Write `confirm-dialog.ts`**

```ts
/**
 * A small confirm dialog for the HUD (plan 2026-09-20-hud-icon-buttons §4).
 *
 * Uses a real `<dialog>` but opens it by setting `open` — NOT `showModal()`.
 * In WebXR DOM-overlay mode only elements inside the overlay root render, and
 * top-layer rendering is not guaranteed, so the dialog must live in the HUD
 * tree. A non-modal `<dialog>` gives no Escape, no light dismiss and no focus
 * trap, so all three are implemented here: Escape and a backdrop tap cancel,
 * Tab wraps between the two buttons, Cancel takes focus on open.
 *
 * Pure DOM; knows nothing about the HUD or the store.
 */

export interface ConfirmDialogOptions {
  /** Base testid: `${testid}-dialog`, `${testid}-confirm`, `${testid}-cancel`. */
  readonly testid: string;
  readonly title: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly onConfirm: () => void;
}

export interface ConfirmDialog {
  /** Mount this into the HUD root. Hidden until `open()`. */
  readonly element: HTMLElement;
  /** `returnFocusTo` gets focus back on close. */
  open(returnFocusTo?: HTMLElement): void;
  close(): void;
  destroy(): void;
}

export function createConfirmDialog(
  options: ConfirmDialogOptions,
): ConfirmDialog {
  const root = document.createElement("div");
  root.className = "hud-confirm";
  root.hidden = true;

  const backdrop = document.createElement("div");
  backdrop.className = "hud-confirm-backdrop";

  const dialog = document.createElement("dialog");
  dialog.className = "hud-confirm-dialog";
  dialog.dataset.testid = `${options.testid}-dialog`;
  dialog.setAttribute("role", "alertdialog");
  dialog.setAttribute("aria-modal", "true");

  const heading = document.createElement("h2");
  heading.className = "hud-confirm-title";
  heading.id = `${options.testid}-title`;
  heading.textContent = options.title;
  dialog.setAttribute("aria-labelledby", heading.id);

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.dataset.testid = `${options.testid}-cancel`;
  cancel.textContent = options.cancelLabel;

  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "hud-confirm-confirm";
  confirm.dataset.testid = `${options.testid}-confirm`;
  confirm.textContent = options.confirmLabel;

  const actions = document.createElement("div");
  actions.className = "hud-confirm-actions";
  actions.append(cancel, confirm);

  dialog.append(heading, actions);
  root.append(backdrop, dialog);

  let opener: HTMLElement | null = null;

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const active = document.activeElement;
    if (!dialog.contains(active)) {
      event.preventDefault();
      cancel.focus();
    } else if (event.shiftKey && active === cancel) {
      event.preventDefault();
      confirm.focus();
    } else if (!event.shiftKey && active === confirm) {
      event.preventDefault();
      cancel.focus();
    }
  }

  function close(): void {
    if (root.hidden) return;
    root.hidden = true;
    dialog.open = false;
    document.removeEventListener("keydown", onKeydown);
    opener?.focus();
    opener = null;
  }

  cancel.addEventListener("click", close);
  backdrop.addEventListener("click", close);
  confirm.addEventListener("click", () => {
    close();
    options.onConfirm();
  });

  return {
    element: root,
    open(returnFocusTo) {
      if (!root.hidden) return;
      opener = returnFocusTo ?? null;
      root.hidden = false;
      dialog.open = true;
      document.addEventListener("keydown", onKeydown);
      cancel.focus(); // the safe default
    },
    close,
    destroy() {
      document.removeEventListener("keydown", onKeydown);
      root.remove();
    },
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm exec vitest run src/components/shared/confirm-dialog.test.ts` → PASS (9 tests).

- [ ] **Step 5: Write the failing HUD tests**

In `hud.test.ts`, replace `"clicking Map/End tour calls their handlers when given"` with:

```ts
  it("clicking Map calls onToggleMap", () => {
    const { onToggleMap } = setup();
    query(container, "viewing-map-toggle")!.click();
    expect(onToggleMap).toHaveBeenCalledOnce();
  });

  describe("End tour confirm", () => {
    it("clicking End tour opens the dialog and does NOT end the tour", () => {
      const { onEndTour } = setup();
      const dialog = query(container, "viewing-end-tour-dialog") as HTMLDialogElement;
      expect(dialog.open).toBe(false);

      query(container, "viewing-end-tour")!.click();

      expect(dialog.open).toBe(true);
      expect(onEndTour).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(query(container, "viewing-end-tour-cancel"));
    });

    it("Cancel closes without ending", () => {
      const { onEndTour } = setup();
      query(container, "viewing-end-tour")!.click();
      query(container, "viewing-end-tour-cancel")!.click();
      expect((query(container, "viewing-end-tour-dialog") as HTMLDialogElement).open).toBe(false);
      expect(onEndTour).not.toHaveBeenCalled();
    });

    it("End calls onEndTour once and closes", () => {
      const { onEndTour } = setup();
      query(container, "viewing-end-tour")!.click();
      query(container, "viewing-end-tour-confirm")!.click();
      expect(onEndTour).toHaveBeenCalledOnce();
      expect((query(container, "viewing-end-tour-dialog") as HTMLDialogElement).open).toBe(false);
    });

    it("Escape cancels", () => {
      const { onEndTour } = setup();
      query(container, "viewing-end-tour")!.click();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect((query(container, "viewing-end-tour-dialog") as HTMLDialogElement).open).toBe(false);
      expect(onEndTour).not.toHaveBeenCalled();
    });

    it("has no dialog when onEndTour is omitted, and destroy() removes it", () => {
      setup(true, { withEndTour: false });
      expect(query(container, "viewing-end-tour-dialog")).toBeNull();
    });
  });
```

In `viewing-app.test.ts`, add a helper next to `query` (top of file, or where `completeOnboarding` is defined):

```ts
/** End tour now asks for confirmation: click the button, then confirm. */
function endTour(root: HTMLElement): void {
  (query(root, "viewing-end-tour") as HTMLButtonElement).click();
  (query(root, "viewing-end-tour-confirm") as HTMLButtonElement).click();
}
```
and replace the three `(query(root, "viewing-end-tour") as HTMLButtonElement).click();` calls at lines ~587, ~804 and ~995 with `endTour(root);`. (Line ~992's `expect(query(root, "viewing-end-tour")).not.toBeNull()` stays.)

Run: `pnpm exec vitest run src/components/shared/hud.test.ts src/app/viewing/viewing-app.test.ts` → FAIL.

- [ ] **Step 6: Wire the dialog into `hud.ts`**

Import: `import { createConfirmDialog } from "./confirm-dialog.js";`

After the `endTour` button is created, replace its old click listener (`if (options.onEndTour) { endTour.addEventListener("click", () => options.onEndTour?.()); }`) with:

```ts
  const endDialog = options.onEndTour
    ? createConfirmDialog({
        testid: "viewing-end-tour",
        title: "End tour?",
        confirmLabel: "End",
        cancelLabel: "Cancel",
        onConfirm: () => options.onEndTour?.(),
      })
    : undefined;
  endTour.addEventListener("click", () => endDialog?.open(endTour));
```

Mount it: `element.append(status, notice, controls);` → add `if (endDialog) element.append(endDialog.element);` right after. In `destroy()` add `endDialog?.destroy();` before `element.remove()`.

- [ ] **Step 7: Add the dialog CSS to `hud.css`**

```css
/* End-tour confirm (confirm-dialog.ts). Non-modal <dialog> inside the HUD
   tree (WebXR DOM overlay), so the backdrop is our own element. */
.hud-confirm {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  padding: var(--space-4, 16px);
}

.hud-confirm[hidden] {
  display: none;
}

.hud-confirm-backdrop {
  position: absolute;
  inset: 0;
  background: rgb(0 0 0 / 55%);
}

/* Undo the UA's absolutely-centred <dialog> box; the grid centres it. */
.hud-confirm-dialog {
  position: relative;
  inset: auto;
  margin: 0;
  width: min(320px, 100%);
  box-sizing: border-box;
  padding: var(--space-4, 16px);
  background: #151b2b;
  color: var(--text, #e9eef7);
  border: 1px solid var(--border, #2a3550);
  border-radius: var(--radius-md, 10px);
}

.hud-confirm-title {
  margin: 0 0 var(--space-4, 16px);
  font-size: 16px;
}

.hud-confirm-actions {
  display: flex;
  gap: var(--space-2, 8px);
  justify-content: flex-end;
}

/* Skin the two buttons here too: the desktop-preview page does not load
   app.css's generic `button` rule. */
.hud-confirm-actions button {
  font: inherit;
  font-size: 14px;
  min-height: 44px;
  padding: var(--space-2, 8px) var(--space-4, 16px);
  background: #1b2338;
  border: 1px solid var(--border, #2a3550);
  border-radius: var(--radius-sm, 6px);
  color: var(--text, #e9eef7);
  cursor: pointer;
}

.hud-confirm-actions .hud-confirm-confirm {
  background: #7f1d1d;
  border-color: var(--error, #f87171);
}

.hud-confirm-actions button:focus-visible {
  outline: 2px solid var(--accent, #9ec1ff);
  outline-offset: 2px;
}
```

- [ ] **Step 8: Run checks and tests**

```bash
pnpm exec prettier --write src && pnpm run typecheck && pnpm run typecheck:tests && pnpm run lint && pnpm run lint:css
pnpm exec vitest run src/components/shared src/app/viewing
```
Expected: PASS. If `viewing-replay.e2e.test.ts` clicks End tour, update it the same way (`grep -rn "viewing-end-tour" src`).

- [ ] **Step 9: Look at it (WebXR risk check)**

`pnpm run dev`, desktop preview and composed app preview: click End tour → dialog centred over a dimmed backdrop, above the map; Cancel focused; Escape / backdrop / Cancel dismiss; End ends the preview; Tab cycles. Note in the final report that dialog rendering inside a real WebXR DOM overlay on a phone was **not** verified.

- [ ] **Step 10: Commit**

```bash
git add -A src
git commit -m "feat(tourbuilder): confirm dialog before ending a tour" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Docs, full gate, final report

**Files:**
- Modify: `components/shared/README.md`, `app/viewing/README.md`, `plans/2026-09-20-hud-icon-buttons-plan.md` (status line)

- [ ] **Step 1: Update `components/shared/README.md`**

In the `hud.ts` / `hud.css` section (~line 65-80): replace the mention of "map/autopilot/OSM-buildings/end-tour control bar" with the icon-button description, and document:

- State setters replacing label setters: `setMapActive`, `setAutopilotActive`, `setWayfindingActive`, `setOsmBuildingsStatus(HudBuildingsStatus)`. The HUD owns wording; callers push state, never text.
- Toggle-state contract: three cues (fill, badge dot, `aria-pressed`); `aria-label` and `title` identical and name the action.
- Buildings' four states (table from spec §2b) and the failed notice.
- Hint sequencing rule (§3b).
- End-tour confirm (non-modal `<dialog>`, own Escape/backdrop/focus trap).
- `hud.css` is now linked by both `app/index.html` and the desktop-preview page and owns the hint + dialog styles.

Add three new sections in the same style as neighbours: `icon-button.ts` / `icon-button.css` (API from Task 1 Interfaces), `hud-state.ts`, `hud-icons.ts`, `confirm-dialog.ts` (API from Task 6 Interfaces). Also mention the new test files in the README's tests paragraph (~line 108).

- [ ] **Step 2: Update `app/viewing/README.md`**

Near line 31-33 (the HUD paragraph) add: the app pushes state into the HUD (`setMapVisible` keeps `mapVisible` and the Map button in sync; `setOsmBuildingsStatus` replaces the old label helper), and End tour now needs a confirm click. In the table at ~line 117, add a row: `Buildings failed to load | HUD notice: "Buildings couldn't load. Tap the buildings button to retry."`.

- [ ] **Step 3: Mark the spec implemented**

In `plans/2026-09-20-hud-icon-buttons-plan.md` change `Status: approved in discussion, not yet implemented` to `Status: implemented (see plans/2026-09-20-hud-icon-buttons-impl-plan.md)`.

- [ ] **Step 4: Full gate**

Run, from `GpsPlusSlamJs_TourBuilder/`:

```bash
pnpm test
```
Expected: format, lint, lint:css, check:all (jscpd, dpdm, dependency-cruiser, knip), typecheck, unit — all pass. Likely failure points and fixes:
- jscpd: the two `Toggle`/hint blocks or the CSS-free TS duplicates in `viewing-app.ts` vs `demo.ts` `setMapVisible`. If flagged, leave them (they are two apps) and add nothing — first check `config/.jscpd.json` thresholds; only refactor if it fails.
- knip: an unused export (e.g. `IconButtonVariant`, `ConfirmDialogOptions`, `ToggleFlags`). Un-export types nothing else imports.
- typecheck:tests: leftover `set*Label` in a test.

- [ ] **Step 5: Commit**

```bash
git add -A ..
git status --short   # only README/plan files expected
git commit -m "docs(tourbuilder): document HUD icon buttons and state setters" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
(If Step 4 forced code fixes, commit those first as `fix(tourbuilder): …` or `refactor(tourbuilder): …`.)

- [ ] **Step 6: Final report to the user**

State plainly:
- What shipped (five commits + hints commit + docs).
- Verified: unit tests, full gate, desktop preview in a browser (list what was actually looked at).
- **Not verified:** the confirm dialog and icon buttons inside a real WebXR DOM overlay on a phone; `pointer: coarse` sizing on real hardware (only devtools emulation).
- Behavior changes worth knowing: map button wording changes (`Map` → `Show map`/`Hide map`), Buildings wording changes, End tour needs a confirm, hint order, notice on Buildings failure (cleared on retry).
- Open items left for a later round from the spec: End-tour spacing decision, landing/authoring adopting `icon-button`.

---

## Self-Review

**Spec coverage**

| Spec section | Task |
| --- | --- |
| §1 icon-button helper (label, pressed, variant, busy, error) | 1 |
| §2 toggle cues (fill, badge, aria-pressed); labels flip | 1 (CSS), 2 (`hud-state`), 5 (wired) |
| §2b Buildings four states + failed notice | 2 (table, text), 5 (busy/error/notice) |
| §3 HUD swap, testids, optional buttons, hint close not skinned | 5 |
| §3 map open/closed wiring, three sites + demo, single helper | 3 |
| §3 stale `hud.css` selectors | 5 (steps 4–6) |
| §3b one hint at a time (+ no-autopilot, dismiss-while-queued, timeout from show) | 4 |
| §4 End-tour `<dialog>`, `show`-style, own backdrop/Escape/trap, Cancel focus | 6 |
| §5 setter replacement, call sites, knip | 2 |
| Testing list | Tasks 1, 2, 3, 4, 5, 6 |
| Existing tests to update (`hud.test.ts` 68/186/237/63, `viewing-app.test.ts` 587/804/995) | 2, 6 |
| Docs (ADR 0001 READMEs) | 7 |
| Known risks: non-modal dialog behaviors; stale `hud.css` | 6, 5 |
| Open items (icons, order) | icons in 5; order decided in 4 (End tour last) |

**Placeholder scan:** no TBD/TODO; every code step has code. Two steps say "move the text" (Task 5 step 4–5) with an exact source range and command instead of retyping ~90 lines of CSS — the source is in the repo, and retyping would risk drift.

**Type consistency:** `HudBuildingsStatus`, `buildingsAppearance`, `mapLabel`/`autopilotLabel`/`wayfindingLabel` (Task 2) are used unchanged in Tasks 5–6. `Toggle.set(label, pressed, flags?)` gains `flags` in Task 5 only; Task 2's `textToggle` has the 2-arg form and is deleted in Task 5. `createIconButton`'s `setLabel/setPressed/setBusy/setError` match Task 5's `iconToggle`. `mountHintedToggle` returns `{ wrap, show, dismiss }` (Task 4) and Task 5/6 do not change it. Dialog testids `viewing-end-tour-dialog|-confirm|-cancel` match between Task 6's HUD tests and `createConfirmDialog({ testid: "viewing-end-tour" })`.

**Known deviation from spec:** six code commits instead of five (hint sequencing split out); Task 2's commit changes button wording despite being a refactor (called out in its message).
