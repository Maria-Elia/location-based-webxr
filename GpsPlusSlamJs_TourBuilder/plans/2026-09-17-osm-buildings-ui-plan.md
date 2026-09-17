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
export type OsmBuildingStatus = "loading" | "loaded" | "failed" | "off";
```

- `OsmBuildingLayerOptions.enabled?: boolean` — default `true`. When `false`,
  `load()` does not fetch; status is `"off"` from construction.
- `OsmBuildingLayer` gains:
  - `getStatus(): OsmBuildingStatus`
  - `onStatusChange(cb: (status: OsmBuildingStatus) => void): () => void` —
    returns an unsubscribe function; fires on every transition (including the
    initial synchronous one if relevant to a listener attached before
    `load()`).
  - `setEnabled(enabled: boolean): void`
    - `false`: aborts any in-flight fetch, disposes meshes
      (`disposeObject3D`), clears the group, status → `"off"`.
    - `true` from `"off"`: re-invokes the same load path used by `load()`.
      This is also the retry path from `"failed"` (a failed layer's status is
      NOT `"off"`, so retry is `setEnabled(true)` called while status is
      already `"failed"` — treat `"failed"` the same as `"off"` for the
      purposes of "does calling setEnabled(true) start a new fetch").
- `load()` keeps its existing signature/behavior (never rejects) for the
  existing tests; it now also drives the status transitions
  (`"loading"` → `"loaded"` | `"failed"`) and is a no-op when constructed
  disabled.

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
  stays free of the status enum.
- On a transition into `"failed"`, `viewing-app.ts` also calls the existing
  `hud.showNotice("Couldn't load real buildings; showing flat ground.")` —
  reuses the current one-shot error banner, no new DOM element.

No new CSS beyond what a plain button already gets from `ar-hud-controls`.

### 4. `viewing-app.ts` — wiring (`enterPreview`)

- Subscribe to `session.onOsmBuildingsStatusChange` right after
  `createPreviewSession(...)` returns; unsubscribe on `leavePreview()`
  alongside the other preview teardown.
- Label mapping:
  - `"off"` → `"Buildings: Off"`
  - `"loading"` → `"Buildings: Loading…"`
  - `"loaded"` → `"Buildings: On"`
  - `"failed"` → `"Buildings: Failed (tap to retry)"`
- `mountSessionShell`'s preview call site passes
  `onToggleOsmBuildings: () => { … }`, which flips a local `boolean` (default
  `true`, matching the "on by default" requirement) and calls
  `preview.setOsmBuildingsEnabled(next)`. Clicking while `"failed"` calls
  `setOsmBuildingsEnabled(true)`, which is the retry per the layer's design
  above.
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
- Toggling off mid-fetch aborts cleanly (existing `AbortController` in
  `osm-building-layer.ts` already supports this from `dispose()`; `setEnabled
  (false)` reuses the same abort path without fully disposing the layer,
  since the layer must survive to be re-enabled later).
- Toggling on again after `"failed"` always attempts a fresh fetch — no
  cached-failure short-circuit, so a transient Overpass outage recovers on
  the next toggle without needing to leave and re-enter preview.

## Testing

All within existing files, no new files:

- `osm-building-layer.test.ts`: status sequence for success/failure/off;
  `setEnabled(false)` mid-fetch aborts and clears group;
  `setEnabled(true)` after `"failed"` re-fetches; `onStatusChange`
  subscribe/unsubscribe.
- `preview-session.test.ts`: `osmBuildingsEnabled: false` forwards to the
  layer; the three new session methods delegate correctly (fake layer test
  double).
- `hud.test.ts`: button renders only with `onToggleOsmBuildings`; label
  updates via `setOsmBuildingsLabel`; click fires the callback.
- `viewing-app.test.ts`: `enterPreview` wires status → label + notice on
  failure; toggle click calls `setOsmBuildingsEnabled` with the flipped
  value; button absent from the AR (phone) HUD mount.

Run: `pnpm exec vitest run src/components/desktop-preview src/app/viewing/hud.test.ts src/app/viewing/viewing-app.test.ts` from `GpsPlusSlamJs_TourBuilder/`, then the package's full `pnpm test` gate before merge.
