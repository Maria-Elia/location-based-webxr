# OSM buildings: toggle + status UI — plan

Status: approved design, ready for implementation plan.

## Problem

`osm-building-layer.ts` (component 11, desktop-preview) fetches real OSM
buildings/roads/plates around a tour's origin and drops them onto the flat
preview ground. It loads silently: no loading indicator, no way to tell a
timeout/Overpass-down failure from "this area just has no buildings", and no
way to turn it off. Failures only surface as a `console.warn`.

## Goal

Give the visitor: a per-session on/off toggle (on by default), and visible
loading/loaded/failed status, inside the composed viewing app's HUD
(`hud.ts`) — not the standalone `demo.ts` page, which is left untouched (see
Scope below).

## Design

### 1. `osm-building-layer.ts` — status + enable/disable

```ts
export type OsmBuildingStatus =
  | "idle" // enabled, load() not called yet
  | "loading"
  | "loaded"
  | "failed"
  | "off";
```

- `OsmBuildingLayerOptions.enabled?: boolean` — default `true`. Initial
  status: `"idle"` when enabled, `"off"` when not. `"idle"` exists so the
  status before the first `load()` is defined rather than implied (a layer
  that is constructed but never loaded must not claim `"loading"`).
- `OsmBuildingLayer` gains:
  - `getStatus(): OsmBuildingStatus`
  - `onStatusChange(cb: (status: OsmBuildingStatus) => void): () => void` —
    returns an unsubscribe function; fires on every *subsequent* transition
    only. **No replay** of the current status on subscribe: a caller that
    needs the current value reads `getStatus()` right after subscribing (see
    §4). Fires only when the status actually changes (no `x → x` events).
  - `setEnabled(enabled: boolean): void`
    - `false`: aborts the current run's controller, disposes meshes
      (`disposeObject3D`), clears the group, status → `"off"`
      **synchronously**. No-op when already `"off"`.
    - `true` from `"off"` or `"failed"`: starts a new load run (below). This
      is the retry path — a failed layer's status is not `"off"`, so
      `"failed"` is treated like `"off"` here.
    - `true` from `"idle"`, `"loading"` or `"loaded"`: **no-op** (no second
      fetch, no duplicate meshes). From `"idle"`, the pending `load()` call is
      still what starts the fetch.
- `load()` keeps its existing signature/behavior (never rejects) for the
  existing tests. It starts a load run **only from `"idle"`**; from any
  other status it resolves immediately without fetching (so a disabled
  layer's `load()` is a no-op, and a repeated `load()` can't double the
  meshes). Retry/re-enable goes through `setEnabled(true)`, not `load()`.
- **A load run** (shared by `load()` and `setEnabled(true)`):
  1. Bump a `generation` counter and capture it as this run's token.
  2. Clear the group first (`disposeObject3D` + `group.clear()`) — a
     previous run that failed part-way, or a partial load, may have left
     meshes behind, and a retry must not stack a second copy on top.
  3. Create this run's `AbortController` + timeout (below); status →
     `"loading"`.
  4. After every `await`, and in `catch`/`finally`, check
     `token === generation && !disposed`. A **stale** run (superseded by
     `setEnabled(false)`, a newer run, or `dispose()`) adds no meshes, emits
     no status, and does not `console.warn` — it just clears its own timer
     and returns. This is what makes off → on during a slow fetch safe: the
     first run's late rejection/resolution can't overwrite the second run's
     status or add meshes alongside it.
  5. `setEnabled(false)` and `dispose()` both bump `generation`, so any
     in-flight run becomes stale at that moment.
- **An abort we caused is never a failure.** Only a run that is still
  current can reach `"failed"`. Toggle-off sets `"off"` itself (step above)
  and the aborted run is stale, so the user sees no failure notice and no
  warn. The timeout is the one abort that *does* count — it aborts a run
  that is still current, so that run lands in `"failed"`.
- **`dispose()` is silent.** It sets `disposed`, bumps `generation`, aborts
  the current controller, clears the group, and **drops all status
  listeners** without emitting anything. Leaving the preview must never
  trigger a "couldn't load" notice on a HUD that is being torn down.
- **Failure is decided from `loadTiles`' result, not only from a thrown
  error.** `loadTiles` (`gps-plus-slam-osm` `area-loader.ts`) does NOT throw
  on per-tile failures — a down/erroring Overpass lands every tile in
  `failed`, a rate-limited one in `deferred`, and the call resolves normally.
  Only an abort (incl. our timeout) throws. So the rule is:
  - thrown error (timeout abort) → `"failed"`.
  - resolved with `loaded.length === 0` and
    `failed.length + deferred.length > 0` → `"failed"` (nothing arrived and
    at least one tile errored — an outage, not an empty area).
  - resolved with `loaded.length > 0` → `"loaded"`, even if some tiles
    failed/deferred (partial coverage beats flat ground); the partial
    failures still go to `console.warn`.
  - resolved with every tile loaded but zero features → `"loaded"` (a
    genuinely empty area).
- **One `AbortController` per load, not per layer.** Today a single
  controller is created at construction and shared by the timeout and
  `dispose()`; once aborted, every later `loadTiles` call sees an
  already-aborted signal and throws immediately, so retry-after-timeout and
  off→on would always fail. Instead, each load run creates a fresh
  `AbortController` (held as `currentController`) and its own timeout timer
  aborting that controller. `setEnabled(false)` and `dispose()` abort
  `currentController`; the next load starts with a new one.

### 2. `preview-session.ts` — passthrough

- `PreviewSessionOptions.osmBuildingsEnabled?: boolean` (default `true`),
  forwarded to `createOsmBuildingLayer({ enabled: ... })`.
- `PreviewSession` gains:
  - `getOsmBuildingsStatus(): OsmBuildingStatus`
  - `onOsmBuildingsStatusChange(cb): () => void`
  - `setOsmBuildingsEnabled(enabled: boolean): void`

  All three delegate directly to the underlying `osmBuildings` layer instance
  already held by the session.

### 3. `hud.ts` — the control

Preview-mode only, same optional-callback pattern as the existing
`onToggleAutopilot` button:

- `HudOptions.onToggleOsmBuildings?: () => void` — button rendered only when
  provided.
- `Hud.setOsmBuildingsLabel(label: string): void` — sets the button's text.
  `viewing-app.ts` computes the label from status (see below), `hud.ts`
  stays free of the status enum. No-op when the HUD was mounted without the
  toggle (same as `setAutopilotLabel`).
- Default button text is `"Buildings"`. The HUD is mounted before the
  preview session exists (`mountSessionShell` runs first in
  `enterPreview`), so there is a brief moment before `viewing-app.ts` pushes
  the first status-derived label; the button must not be blank then.
- On a transition into `"failed"`, `viewing-app.ts` also calls the existing
  `hud.showNotice("Couldn't load real buildings; showing flat ground.")` —
  reuses the current one-shot error banner, no new DOM element.

No new CSS beyond what a plain button already gets from `ar-hud-controls`.

### 4. `viewing-app.ts` — wiring (`enterPreview`)

- Subscribe to `session.onOsmBuildingsStatusChange` right after
  `createPreviewSession(...)` returns, **then immediately apply
  `session.getOsmBuildingsStatus()`** through the same handler.
  `createPreviewSession` calls `load()` synchronously, so the
  `"idle"` → `"loading"` transition has already happened before the
  subscription exists, and `onStatusChange` does not replay (§1). The
  handler only calls `showNotice` for a `"failed"` it receives as a
  transition *or* reads on this initial apply — either way once per entry
  into `"failed"`.
- Store the unsubscribe in a `unsubscribeOsmBuildings` variable next to
  `unsubscribeProgress`. Call it (and null it) **before**
  `preview.dispose()` in **both** teardown paths: `leavePreview()` and the
  app's `destroy()`. `dispose()` is already silent (§1), so this is
  belt-and-braces, but it keeps the handler from ever touching a HUD that
  is being destroyed.
- Label mapping:
  - `"off"` → `"Buildings: Off"`
  - `"idle"` / `"loading"` → `"Buildings: Loading…"` (`"idle"` is only ever
    seen momentarily; the session loads straight away)
  - `"loaded"` → `"Buildings: On"`
  - `"failed"` → `"Buildings: Failed (tap to retry)"`
- `mountSessionShell`'s preview call site passes
  `onToggleOsmBuildings: () => { … }`. There is **no local boolean** — the
  layer's status is the single source of truth (a separate flag would still
  read `true` after a failure, so a click would flip it to `false` and turn
  buildings off instead of retrying). The click derives the target from the
  current status:

  ```ts
  const status = preview.getOsmBuildingsStatus();
  preview.setOsmBuildingsEnabled(status === "off" || status === "failed");
  ```

  - `"off"` → enable (fresh fetch).
  - `"failed"` → enable = retry (fresh fetch, per the layer's design above).
  - `"idle"` / `"loading"` / `"loaded"` → disable (aborts an in-flight
    fetch / clears meshes).

  "On by default" comes from the layer's own `enabled` default, not from
  app-side state.
- The AR (phone) HUD instance (`mountSessionShell({ onEndTour: ... })` at the
  top of `enterAr`) does not pass `onToggleOsmBuildings` — buildings are
  desktop-preview-only, so the button never appears there. Mirrors how
  `onToggleAutopilot` is preview-only today.

## Scope: `demo.ts` is untouched

Component 11's own standalone demo page (`desktop-preview/demo.ts`) has no
HUD today and is not part of this change. It keeps calling
`createOsmBuildingLayer` (via `createPreviewSession`) at the new default
(`enabled: true`), so its current behavior is unchanged. The toggle/status
surface is scoped to the composed viewing app per the approved design.

## Error handling

- Fetch failure/timeout: unchanged fail-soft behavior at the fetch layer
  (flat ground stays), but now the failure is observable (`"failed"` status)
  instead of only a `console.warn`. The `console.warn` stays as-is (dev-facing
  signal); the HUD notice is the visitor-facing one.
- Toggling off mid-fetch aborts that run's own `AbortController` (see
  §1: one controller per load) without disposing the layer, since the layer
  must survive to be re-enabled later with a fresh controller. The aborted
  run is stale, so it produces no `"failed"`, no notice and no
  `console.warn` — only a timeout (an abort of a still-current run) counts
  as a failure.
- Off → on while the first fetch is still pending: the first run's late
  result is discarded by the generation check; only the newest run
  decides status and meshes.
- Leaving the preview (`dispose()`) emits no status and drops listeners, so
  no failure notice appears during teardown.
- Toggling on again after `"failed"` always attempts a fresh fetch — no
  cached-failure short-circuit, so a transient Overpass outage recovers on
  the next toggle without needing to leave and re-enter preview.

## Testing

All within existing files, no new files:

- `osm-building-layer.test.ts`: status sequence for success/failure/off;
  `setEnabled(false)` mid-fetch aborts and clears group;
  `setEnabled(true)` after `"failed"` re-fetches; `onStatusChange`
  subscribe/unsubscribe. Failure classification: every tile erroring →
  `"failed"`; every tile rate-limited (deferred) → `"failed"`; some tiles
  loaded + some failed → `"loaded"` with those meshes; all tiles loaded but
  empty → `"loaded"`. Fresh controller: after a timeout-`"failed"`,
  `setEnabled(true)` actually reaches the source again (the fake source sees
  a non-aborted signal); same for off → on.
  Lifecycle: initial status `"idle"` (enabled) / `"off"` (disabled);
  `onStatusChange` does not replay on subscribe and emits no duplicate
  events. Stale runs: off → on mid-fetch, then the first fetch settles
  (reject *and* resolve variants) → status and meshes come only from the
  second run. Toggle-off mid-fetch → `"off"`, never `"failed"`, no
  `console.warn`. `dispose()` mid-fetch → no status event, listeners
  dropped. Idempotence: `setEnabled(true)` while `"loading"`/`"loaded"`
  and a second `load()` don't re-fetch or duplicate meshes;
  `setEnabled(false)` while `"off"` emits nothing. Retry clears first: a
  partial load followed by `setEnabled(false)`/`setEnabled(true)` ends with
  exactly one copy of the meshes.
- `preview-session.test.ts`: `osmBuildingsEnabled: false` forwards to the
  layer; the three new session methods delegate correctly (fake layer test
  double).
- `hud.test.ts`: button renders only with `onToggleOsmBuildings`; label
  updates via `setOsmBuildingsLabel`; click fires the callback.
- `viewing-app.test.ts`: `enterPreview` wires status → label + notice on
  failure; toggle click calls `setOsmBuildingsEnabled` with the value
  derived from status (`"off"`/`"failed"` → `true`, `"loading"`/`"loaded"` →
  `false`); button absent from the AR (phone) HUD mount. Initial label is
  applied from `getOsmBuildingsStatus()` without waiting for an event
  (fake session already `"loading"` / already `"failed"` on creation →
  label + notice). Unsubscribe runs before `preview.dispose()` on both
  `leavePreview()` and `destroy()`.

Run: `pnpm exec vitest run src/components/desktop-preview src/app/viewing/hud.test.ts src/app/viewing/viewing-app.test.ts` from `GpsPlusSlamJs_TourBuilder/`, then the package's full `pnpm test` gate before merge.
