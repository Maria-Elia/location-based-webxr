# 2026-09-17 — Trail Coverage Check (implementation plan)

## Context

Waypoints can be created two ways: walk-there-and-press (`dropWaypoint()` with
no override, [authoring-session.ts:69](../src/components/authoring/view/authoring-session.ts))
or drag/tap on the authoring map ([tour-map.ts](../src/components/map/view/tour-map.ts),
`dropWaypoint(position)` with an explicit override). Breadcrumb recording is a
separate, always-on background stream tied to live GPS movement (AU3, the
2026-08-07 authoring plan) — it has no relationship to how or when a waypoint
was created. A drag-placed waypoint can therefore have **zero real breadcrumb
points anywhere near it**, and the current trail renderer
(`selectTrailWindow`, [trail-window.ts](../src/components/ar-scene/core/trail-window.ts))
has no way to know that; it just silently shows no orbs there.

This plan covers **only the pure signal**: a function that answers "does this
waypoint have real, physically-recorded trail nearby?" Two things are
explicitly **out of scope** here, both deferred:

- **The visual fallback** (an arrow to the next waypoint when a segment has no
  trail) — the actual UI/UX work, picked up later.
- **Flood-fill / junk-breadcrumb pruning** — rejected as a way to solve this
  problem. A 25 m flood-fill hop radius against 3 m breadcrumb spacing
  (`MIN_BREADCRUMB_DISTANCE_M`) means any two points on one continuous walk
  chain-connect almost automatically — it answers "is this breadcrumb
  connected to *some* recorded walk" (useful for a separate, later
  "prune disconnected recording artifacts" feature), not "does *this specific
  waypoint* have trail nearby." A GPS dropout (tunnel, bridge, tree cover)
  can also make the hop-chain falsely snap on real trail. Doing this
  destructively at export time (baked into the shipped zip) was rejected:
  the only consumer of `tour.breadcrumb` is the AR trail visual (waypoint
  position/content/radius/proximity are all independent of it, per D2), so a
  bad prune is cosmetic, not data-loss in the tour-completion sense — but
  it's still an unforced, avoidable risk when a live/derived check costs
  nothing and can be retuned freely. If a noise-pruning feature is ever
  built, it must run live/non-destructively, never mutate the exported
  `tour.json`.

No `tour.json` schema change. **D7** (Shared-Contract.md) already establishes
that `breadcrumb` is a flat, position-only polyline and that "segmentation is
a view-time derivation" — this is exactly that: a pure function over already-
persisted data, not a new field on `Waypoint`.

---

## Reuse — what's already built and must not be reinvented

| Need | Reused from | Why not reinvent |
|---|---|---|
| Radius-squared distance-within check on nullable world-space points | `trail-window.ts` `selectTrailWindow`'s inner loop | Same `{x, z}` horizontal metric (D17), same `null`-skip convention for a point not yet anchored — this function is the presence-only sibling of that loop, not a new metric. |
| Trail render radius | `ar-scene/config.ts` `TRAIL_WINDOW_RADIUS_M` (15 m) | The question this answers is "will this waypoint ever actually show orbs" — using a different radius than the renderer itself would make the check and the render disagree. Caller passes it in; not hardcoded here. |
| lat/lon → world-space conversion | `adapter.toWorldPositions(coords)` (already called in `tour-scene.ts` for the breadcrumb array) | The future arrow-feature reuses the same call for the waypoint's own position — no new conversion primitive. |

**Correction from earlier discussion:** the check works in **world-space X/Z
(`HorizontalPoint`)**, not raw `lat`/`lon`. CLAUDE.md is explicit that scene/
proximity logic must not do geo math — only authoring time gets that
exception (AU2, nothing anchored yet). This function is consumed at viewing
time, so it belongs next to `trail-window.ts` and must speak the same
anchored-world-space language it does, not reintroduce haversine math into
`ar-scene/core`.

---

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| TC1 | **Pure derived check, not stored.** No new `Waypoint`/`Tour` field, nothing written at export time. | Matches D7 ("segmentation is a view-time derivation"); zero schema/migration footprint, works on old recordings unchanged, always re-tunable. |
| TC2 | **World-space (`HorizontalPoint`), reusing `TRAIL_WINDOW_RADIUS_M`** as the caller-supplied radius, not a new lat/lon distance calc. | Keeps `ar-scene/core` geo-math-free (CLAUDE.md); keeps the check and the renderer answering the same question with the same number. |
| TC3 | **`MIN_TRAIL_COVERAGE_COUNT = 10`**, open/tunable constant, same spirit as `MIN_BREADCRUMB_DISTANCE_M` (AU4). | At the 3 m sample spacing, 10 points ≈ 30 m of continuous nearby trail — a reasonable "this is a real stretch, not noise" floor. No stronger justification available yet; tune after real outdoor testing, same as AU4 was left tunable. |
| TC4 | **Lives in `ar-scene/core/trail-coverage.ts`**, next to `trail-window.ts`. | Same role D7 anticipates (a view-time derivation over the flat breadcrumb polyline), same coordinate space, same test style (node-only, no THREE/DOM). |
| TC5 | **No demo page.** | Precedent: other `ar-scene/core` modules (`zone-commands.ts`, `trail-window.ts`, `model-cache.ts`, …) have no standalone demo — they're internal pure units exercised by `ar-scene`'s own demo/tests, not user-facing components in their own right. |
| TC6 | **Arrow-fallback UI deferred**, tracked as follow-up, not built here. This plan ships only the boolean signal, unit-tested and ready to import. | Explicit user decision this session — avoids blocking the smaller, immediately useful piece on the larger UI design/build. |

---

## Architecture

### `components/ar-scene/core/trail-coverage.ts`

```ts
import type { HorizontalPoint } from "./trail-window.js";

export const MIN_TRAIL_COVERAGE_COUNT = 10;

/**
 * True when at least `minCount` breadcrumb points fall within `radiusM`
 * (horizontal X/Z, D17) of `waypointPos`. `null` entries (not yet
 * convertible to world space) are skipped, same convention as
 * `selectTrailWindow`. Early-exits once the count is reached.
 */
export function hasNearbyTrail(
  waypointPos: HorizontalPoint,
  points: readonly (HorizontalPoint | null)[],
  radiusM: number,
  minCount: number = MIN_TRAIL_COVERAGE_COUNT,
): boolean;
```

Implementation mirrors `selectTrailWindow`'s inner loop (squared-distance
check against `radiusM * radiusM`) but only counts and early-exits — no
sorting, no pool-slot assignment, since this isn't choosing which points to
render, only answering yes/no.

Future call site (not built here): the arrow-feature converts a waypoint's
`TourCoord` alongside `currentTour.breadcrumb` through the same
`adapter.toWorldPositions(...)` already used in `tour-scene.ts:373`, then
calls `hasNearbyTrail(waypointWorld, breadcrumbWorld, TRAIL_WINDOW_RADIUS_M)`
per waypoint to decide trail-vs-arrow.

---

## Testing

Unit — `trail-coverage.test.ts`, node-only, mirrors `trail-window.test.ts`'s
style:

- empty `points` array → `false`.
- exactly `minCount` points within `radiusM` → `true`.
- `minCount - 1` points within radius → `false`.
- points outside `radiusM` are never counted, even if there are many of them.
- a mix of `null` and in-range points counts only the non-null in-range ones.
- points exactly at the radius boundary count (inclusive, matches
  `selectTrailWindow`'s `<=` convention).
- default `minCount` is `MIN_TRAIL_COVERAGE_COUNT` when omitted.

---

## Tooling notes

- New file only in an existing, already-allowed directory
  (`ar-scene/core/`) — no new dependency-cruiser rule, no new tsconfig
  `include` entry, no new Vite gallery/demo entry.
- No new import of `gps-plus-slam-app-framework/geo` anywhere — stays
  consistent with `ar-scene/core` never doing lat/lon math.

---

## Next steps

1. Iterate this plan with an LLM as critical reviewer; commit meaningful
   revisions.
2. `core/trail-coverage.ts` + `core/trail-coverage.test.ts` (TDD, red → green
   → refactor).
3. Sidecar `ar-scene/core/README.md` — add the module entry (same shape as
   the existing `trail-window.ts` entry).
4. Stop here. Arrow-fallback UI and any breadcrumb-pruning feature are
   separate, future plans — not part of this one.
