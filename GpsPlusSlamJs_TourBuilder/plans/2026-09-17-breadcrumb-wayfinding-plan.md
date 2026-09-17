# 2026-09-17 — Breadcrumb Wayfinding (implementation plan)

## Context

A visitor following a tour today only sees the ambient orb trail
(`selectTrailWindow`, [trail-window.ts](../src/components/ar-scene/core/trail-window.ts))
— the nearest recorded breadcrumbs around them, no direction, no order
(deliberate, per its own doc comment). There is no single "walk this way
next" cue.

This plan adds one: point at the **nearest not-yet-visited breadcrumb**,
mark it visited on arrival, advance to the next. Explicitly not the same
concept as the existing `selectNextUnvisitedWaypoint`
([selectors.ts:57](../src/store/selectors.ts:57)), which walks **tour order**
(D8) over **waypoints**. This one is **distance-nearest**, over
**breadcrumbs**, which have no stable id (D7) — keyed by array index, same
convention `trail-window.ts` already uses.

`GpsPlusSlamJs_WayfindingHudDemo` and the framework module it demos
(`gps-plus-slam-app-framework/visualization` → `createWayfindingHud`,
[wayfinding-hud.ts.md](../../GpsPlusSlamJs_AppFramework/src/visualization/wayfinding-hud.ts.md))
are the reason this is small: a mature, already-tested per-target presenter
(edge arrow off-screen, ring on-screen, distance label, anti-flicker
hysteresis, camera-child) already exists. It has no "visited" or
"nearest-of-many" concept — the demo only feeds it static example points.
That selection/bookkeeping logic is the only new work.

**Decided this session:** runs **alongside** the existing orb trail, not a
replacement — orbs stay ambient path decoration, this HUD is the single
"walk here next" cue.

## Rejected approaches

- **Highlight one orb in `trail-window.ts`'s own render** instead of a
  second HUD instance. Rejected: throws away everything
  `wayfinding-hud.ts` already solved (off-screen arrow, hysteresis, label) —
  orbs are dumb position markers, not directional cues. Would mean
  reimplementing a chunk of an already-mature module for no benefit.
- **No visited-tracking; always point at the globally nearest breadcrumb.**
  Rejected: once the visitor is near one, it stays nearest forever — the
  pointer never advances. Fails the actual requirement ("guide me forward").

No `tour.json` schema change, no new Waypoint/Tour field — this is
viewing-side runtime progress, same category as `zones` (D10), not persisted
`tour.json` content.

---

## Reuse — what's already built and must not be reinvented

| Need | Reused from | Why not reinvent |
|---|---|---|
| Per-target presenter (arrow/ring/label/hysteresis) | `gps-plus-slam-app-framework/visualization` `createWayfindingHud` | Mature, tested (option validation, placement, lifecycle, property tests) — see its sidecar. This plan only ever calls it with a single-element target list. |
| Horizontal X/Z squared-distance-within pattern | `ar-scene/core/trail-window.ts` (`selectTrailWindow`'s inner loop), already mirrored once in `trail-coverage.ts` | Same metric (D17) everywhere in `ar-scene`; no lat/lon math introduced here either (CLAUDE.md: no geo math in scene logic). |
| lat/lon → world-space conversion | `adapter.toWorldPositions(coords)`, already called in `tour-scene.ts:373` for the orb trail | Reuse the SAME conversion pass for both the orbs and this feature — no second pass over `currentTour.breadcrumb` per tick. |
| Visited-set slice shape | `store/zones-slice.ts` / `store/tour-progress-slice.ts` (idempotent action, `extraReducers` reset on `clearTour`) | Same pattern, same file shape, same test style — nothing novel about the plumbing, only the selection rule inside it. |
| Refresh cadence | `TRAIL_UPDATE_INTERVAL_S = 0.25` (`ar-scene/runtime/tour-scene.ts:68`) | Same "breadcrumbs are metres apart, not pixels" rationale already justifies this cadence for the orb trail; the new nearest-unvisited scan piggybacks on the same interval tick, not a new one. |

---

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| BW1 | **Alongside the orb trail, not a replacement.** | User decision this session — no regression to existing, working orb rendering; two cues with two distinct jobs. |
| BW2 | **World-space (`HorizontalPoint`), not lat/lon.** Same convention as `trail-window.ts`/`trail-coverage.ts`. | CLAUDE.md: no geo math in scene/proximity logic; this runs at viewing time. |
| BW3 | **One-way latch, not the zone/hysteresis machine (D16).** A breadcrumb, once visited, never un-visits — no fractional-margin exit logic, unlike `zones`. | The zone machine solves a two-way "am I currently near this" question; this is a permanent "have I passed this" fact. Reusing D16's machine would be the wrong shape. |
| BW4 | **`advanceBreadcrumbProgress` re-picks `next` in the same call when arrival triggers**, rather than waiting a tick. | Avoids a one-frame flash where the arrow points at the spot the visitor is already standing on. |
| BW5 | **New 4th viewing slice, `breadcrumbProgress`, NOT persisted** (unlike `tourProgress`, which is `localStorage`-backed because losing waypoint progress mid-walk is a real loss, per its own doc comment). | Re-showing a couple of already-passed breadcrumbs after a reload is cosmetic — not worth a second persistence scheme at hundreds-to-thousands-of-entries scale. Explicit user decision. |
| BW6 | **`BREADCRUMB_ARRIVAL_RADIUS_M = 5`** in `ar-scene/config.ts`, tunable like every other threshold here (`MIN_BREADCRUMB_DISTANCE_M = 3`, `TRAIL_WINDOW_RADIUS_M = 15`). | A bit past the 3 m sampling grain so ordinary GPS jitter reliably crosses it without needing to stand exactly on the point. No stronger justification available pre-field-test — tune after real outdoor use, same posture as AU4. |
| BW7 | **The HUD's own `distanceMin`/`distanceMax` (its visual show/hide deadband) stay small/generous**, not tied to the arrival radius's job. | We swap the HUD's target ourselves the instant arrival happens (BW4) rather than relying on the HUD's own hide/reactivate cycle to do that — the deadband only needs to avoid flicker on a single stable target, not gate progression. |
| BW8 | **Naming avoids "wayfinding" collision.** New module is `breadcrumb-progress.ts` / `breadcrumbProgress` slice, not `wayfinding-*` — that name is the framework's presenter. | Two different "wayfinding" concepts in one codebase (framework presenter vs. our next-breadcrumb selection) must not share a name a future reader could conflate. |

---

## Architecture

### `components/ar-scene/core/breadcrumb-progress.ts`

```ts
import type { HorizontalPoint } from "./trail-window.js";

export function advanceBreadcrumbProgress(
  points: readonly (HorizontalPoint | null)[],
  visited: ReadonlySet<number>,
  userPos: HorizontalPoint,
  arrivalRadiusM: number,
): { next: number | null; newlyVisited: number | null };
```

Scans non-visited, non-null points for the nearest by X/Z squared-distance
(BW2). If that nearest point's distance is `<= arrivalRadiusM`, it becomes
`newlyVisited`, and `next` is recomputed treating it as already visited
(BW4). Pure, no THREE, no store — same shape as `trail-window.ts`.

### `store/breadcrumb-progress-slice.ts`

```ts
export interface BreadcrumbProgressSliceState {
  readonly visitedIndices: readonly number[];
}
const initialState: BreadcrumbProgressSliceState = { visitedIndices: [] };

// reducers:
markBreadcrumbVisited(state, action: PayloadAction<number>): void; // idempotent (BW3)
// extraReducers: resets to [] on clearTour (same pattern as zones/tourProgress)
```

Wired into `store/viewing-store.ts`'s `extraReducers` map alongside
`tourProgress`/`zones`; `ViewingStateShape` in `store/selectors.ts` gains
`breadcrumbProgress: BreadcrumbProgressSliceState`. New selector
`selectVisitedBreadcrumbIndices(state) → readonly number[]` next to
`selectVisitedWaypointIds`.

### `ar-scene/config.ts`

```ts
export const BREADCRUMB_ARRIVAL_RADIUS_M = 5; // BW6
```

### Port addition — `runtime/scene-adapter.ts`

Checked against the real interface: `SceneAdapter` deliberately never hands
back a raw THREE object ("a port that handed back `THREE.Object3D` would
leak the rendering layer straight back into the orchestrator", its own doc
comment) — every existing method takes/returns opaque handles, `Vector3`
(type-only), or `TourCoord`. `createWayfindingHud` needs a real
`THREE.PerspectiveCamera`, so it cannot be constructed in `tour-scene.ts`
(which "imports no THREE and no DOM" by design, same reason the replay e2e
can drive it in Node with no WebGL). It has to live behind the port, same as
`setOrbCoords` already does for the orb trail:

```ts
/** The single "walk here next" target, or null to show nothing. Mirrors
 *  setOrbCoords's TourCoord-in convention — the adapter owns the world-space
 *  conversion and the HUD instance internally. */
setWayfindingTarget(coord: TourCoord | null): void;
```

### `view/three-scene-adapter.ts` (the real implementation)

Owns one `createWayfindingHud` instance, created once at adapter
construction (it already holds the real camera for anchoring/rendering).
`setWayfindingTarget` updates a closure variable the HUD's `getTargets`
reads:

```ts
const hud = createWayfindingHud({
  camera,
  getTargets: () =>
    currentTarget === null ? [] : [{ id: "bc-next", position: currentTarget }],
  distanceMin: /* small, BW7 */,
  distanceMax: /* generous, BW7 */,
});
```

Self-ticks via its own `autoRegisterFrameUpdate` (default `true`) — nothing
calls `hud.update()` manually. Disposed in the adapter's own `dispose()`.

The fake `SceneAdapter` test double (used by `tour-scene.test.ts` and the
replay e2e) gains the same method — recording the last target set, same
pattern as its existing `setOrbCoords` recording.

### `ar-scene/runtime/tour-scene.ts` wiring

Inside the existing `updateTrail()` (same 0.25 s interval, same `world`
array already computed for orbs at line 373):

1. Read `visitedIndices` from the store, build the `Set`.
2. `const { next, newlyVisited } = advanceBreadcrumbProgress(world, visited, adapter.getUserPosition(), BREADCRUMB_ARRIVAL_RADIUS_M)`.
3. `if (newlyVisited !== null) store.dispatch(markBreadcrumbVisited(newlyVisited))`.
4. `adapter.setWayfindingTarget(next === null ? null : currentTour.breadcrumb[next])` —
   pass the raw `TourCoord` looked up by index, same convention `setOrbCoords`
   already uses; the adapter re-derives world space itself. `world` (already
   computed this tick) is only for the orchestrator's OWN selection math in
   step 2, never sent to the adapter directly.

---

## Error handling

- Empty breadcrumb array or all-visited → `next: null` → empty target list
  → HUD already tested/tolerant of zero targets (renders nothing, no
  special-casing needed here).
- A breadcrumb that doesn't yet convert to world space (`null`, no anchor
  yet) is skipped from candidate selection — same convention as
  `trail-window.ts`.
- Tour reload → `clearTour` resets `visitedIndices` to `[]`, same as
  `zones`/`tourProgress`.

---

## Testing

- `breadcrumb-progress.test.ts` (mirrors `trail-window.test.ts` style):
  nearest-unvisited selection correctness; a visited index is never
  reselected even standing on it again (BW3, one-way latch); arrival
  advances `next` to the following point within the same call (BW4);
  `null` entries skipped; empty array → `next: null`; radius-boundary
  inclusive (`<=`, matches `trail-window.ts`'s own convention).
- `breadcrumb-progress-slice` reducer test (mirrors `store.test.ts`'s
  zones/tourProgress cases): idempotent mark, reset on `clearTour`.
- Extend `runtime/tour-scene-replay.e2e.test.ts` (real Task 1 recording,
  already used by the existing ar-scene replay e2e) to assert the HUD's
  target index advances monotonically as the replayed walk passes recorded
  breadcrumbs, and never regresses to an earlier index.

---

## Tooling notes

- New file `store/breadcrumb-progress-slice.ts` — same dir, no new
  dependency-cruiser rule.
- `store/viewing-store.ts`, `store/selectors.ts`: add the 4th slice's type
  + wiring (mechanical, same shape as the existing three).
- `ar-scene/config.ts`: one new exported constant.
- Sidecar docs to update per CLAUDE.md's per-file-docs rule:
  `ar-scene/core/README.md` (new `breadcrumb-progress.ts` entry),
  `store/README.md` (4th slice + new selector), `ar-scene/README.md`
  (mention the new HUD instance in the orchestrator's responsibilities, if
  it enumerates them — confirm against current content when implementing).
- `scene-adapter.ts`'s fake test double needs the new `setWayfindingTarget`
  method added wherever it's defined (used by `tour-scene.test.ts` and the
  replay e2e) — confirm its exact file location when implementing.

---

## Next steps

1. Iterate this plan with an LLM as critical reviewer; commit meaningful
   revisions.
2. `core/breadcrumb-progress.ts` + its test (TDD, red → green → refactor).
3. `store/breadcrumb-progress-slice.ts` + its test; wire into
   `viewing-store.ts` / `selectors.ts`.
4. `ar-scene/config.ts` constant.
5. `scene-adapter.ts` port addition (`setWayfindingTarget`) + fake test
   double update.
6. `three-scene-adapter.ts`: own the `createWayfindingHud` instance
   (create at construction, update on `setWayfindingTarget`, dispose in
   `dispose()`).
7. `tour-scene.ts` wiring: extend `updateTrail()` to call
   `adapter.setWayfindingTarget(...)`.
8. Extend the replay e2e.
9. Sidecar README updates.
