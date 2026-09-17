# src/components/shared — cross-component building blocks

Small, framework-free modules reused by more than one component demo. This is
**not a runnable component** — it has no `demo.ts` / `index.html`; it is only
imported by the components under `src/components/*/`.

It exists so shared logic is defined **once** (the gate's jscpd duplication check
forbids copy-pasting ≥50 tokens across components) while keeping each component
independently demoable — importing a shared helper is fine, but one component
importing another component's internals is not.

## Modules

### `billboard-math.ts` — face-the-user math (pure)

`computeBillboardYaw(billboard, camera, fallback = 0)`: the single Y-rotation
(radians) that turns a plane's **+Z front face** toward the camera in the XZ
plane while keeping it upright (pitch/roll never written). Height is ignored by
design; a camera directly overhead returns `fallback`. Used by the clickable
billboard (component 1) and the in-world-text label (component 2). Upstream-PR
candidate (GPS-free, dependency-free).

### `clamp.ts` — `clamp01` (pure)

Clamp a value into the inclusive `[0, 1]` range. Used by the transport reducer's
`seek`, the panel-layout seek mapping (component 1), and text sizing (component 2).

### `panel-geometry.ts` — UV rectangles + hit test (pure)

The `Rect` type (normalized UV space, origin bottom-left per `PlaneGeometry`
intersection UVs) and `contains(rect, u, v)` (edges inclusive). Each component
builds its own `hitTo…Intent` mapping on top of this primitive.

### `canvas-panel.ts` — canvas draw helpers (view)

`toPx(rect, canvasW, canvasH)` converts a UV rect (origin bottom-left) to a
canvas pixel rect (origin top-left); `roundRect(ctx, x, y, w, h, r)` begins a
radius-clamped rounded-rect path. View-layer (touches a canvas context) but
framework-free.

### `resize.ts` — demo window-resize helper (view)

`attachResize(camera, renderer, container)` keeps a perspective camera +
renderer in sync with `container`'s (the `#canvas-root` element) size on
window resize. Shared by the component demos so the boilerplate lives once.

### `tap-gate.ts` — tap-vs-drag predicate (pure)

`isTap(down, up)` over `PointerSample` (`{ x, y, timeMs }`): true when the
pointer moved ≤ 5 px and was released within 400 ms — the one decision that
tells a select-tap apart from an OrbitControls camera-drag or a long-press.
Pure so the thresholds are pinned by unit tests.

### `pointer-tap-picker.ts` — tap-gated raycast picking (view)

`createPointerTapPicker({ domElement, camera, getPickTargets, onTap })`: the
DOM listeners + NDC + `Raycaster.intersectObjects` mechanics shared by the
billboard (component 1) and in-world-text (component 2) click interactions.
Tracks a single potential-tap pointer by `pointerId`; a second concurrent
finger (pinch) or a `pointercancel` invalidates the gesture, so no phantom
taps on touch. The tap decision itself is `tap-gate.ts`. Each component's own
`*-interaction.ts` wraps this and interprets the returned `Intersection`'s
`userData` — this module never looks at `userData` itself.

### `hud.ts` / `hud.css` — the in-session HUD (view)

`mountHud(container, options)`: the map/autopilot/OSM-buildings/end-tour
control bar, status line, and one-shot notice channel. Used by the composed
viewing app (`src/app/viewing/viewing-app.ts`) for the real AR/preview
sessions, and by the desktop-preview demo (component 11) for its own preview
session — the one exception to "no `demo.ts`/`index.html` here" is that this
module has neither itself but is mounted _into_ another component's demo.
`onToggleMap`/`onEndTour`/`onToggleAutopilot`/`onToggleOsmBuildings` are all
optional: a caller only gets the buttons it wires a handler for. Lives here
rather than `src/app/viewing/` because a component may not import from
`src/app/` (dependency-cruiser's `components-and-store-not-to-app` rule).
`hud.css` uses `var(--token, fallback)` throughout so it renders identically
whether or not the composed app's design tokens (`app.css`'s `:root`) are
loaded.

### `demo.css` — shared canvas-demo styles

Base styles for the canvas-overlay demo pages (`:root`, `html/body`,
`.page-header`, `#canvas-root`, `#hud`, `#status`) — billboard, in-world-text,
ar-scene, plus (with the `html/body` scroll override each already carries)
authoring and onboarding. `.page-header` (`h1` + `p.lead`) gives every demo the
same on-page title as the control-panel demos' `main h1`/`p.lead`
(`panel-demo.css`); `#canvas-root` fills the space below it rather than the
whole viewport. Each demo's `index.html` links it and keeps only
component-specific tweaks inline.

### `panel-demo.css` — shared control-panel demo styles

Base styles for the two-column data/control-panel demo pages (`main`, `.cols`,
`section.panel`, `.buttons`, `button`, `pre`, …) — store, packaging. A separate
sheet from `demo.css` because these demos aren't a canvas overlay; each demo's
`index.html` links it and keeps only component-specific tweaks (and any `pre`
`max-height` override) inline.

## Tests

`billboard-math.test.ts`, `panel-geometry.test.ts`, and `tap-gate.test.ts`
cover the pure modules (`clamp.ts` is exercised transitively; the
`canvas-panel.ts` helpers are view-layer and covered via each component's
panel). `pointer-tap-picker.test.ts` covers the stateful picking headlessly —
synthetic pointer events against a fake element, real `Raycaster`/meshes —
pinning the multi-touch/cancel invalidation, the tap-vs-drag/long-press gate
wiring, the client→NDC mapping, and nearest-hit selection. `hud.test.ts`
(jsdom) covers `mountHud`'s DOM wiring: conditional buttons, label/notice
updates, the autopilot hint lifecycle, `destroy()`. Run `pnpm test:unit`.
