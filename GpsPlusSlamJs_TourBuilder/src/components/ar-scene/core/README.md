# ar-scene/core — the pure decisions

No THREE, no DOM, no store, no clock. Everything here is a function or a small
reducer, which is why the awkward parts of component 8 (async races, memory
budgets) are ordinary unit tests instead of things you find out about outdoors.

## Modules

### `zone-commands.ts` — zone edges → scene commands

`diffZones(prev, next) → ZoneCommand[]` turns two `zones` snapshots into
`build` / `show` / `hide` / `teardown`. This is TASK §2.3.8's "given the store's
per-object zone states, decide which knights should currently be visible"
(`selectVisibleWaypointIds` is the literal form of it).

Component 4 guarantees single-step transitions, so `IDLE→ACTIVE` should never
arrive — an illegal skip is nonetheless **expanded into its two legal steps**
rather than throwing, keeping "build before show" intact even when upstream
misbehaves.

### `trail-window.ts` — which breadcrumb points get an orb

`selectTrailWindow(points, userPos, { maxOrbs, radiusM })` returns the nearest
indices within the radius, by horizontal X/Z distance (contract D17), capped at
the pool size and returned in ascending order so the result is stable frame to
frame. No trail order and no direction — accepted consequence: on a route that
doubles back, orbs from both passes show at once.

`assignOrbSlots(prev, selected, poolSize)` maps those indices onto pool slots,
keeping an orb that is still selected in the slot it already occupies. That is
purely to avoid churn: re-pointing an anchor is the cost worth avoiding, so a
typical frame moves one orb rather than sixteen.

### `trail-coverage.ts` — does a waypoint have real trail nearby

`hasNearbyTrail(waypointPos, points, radiusM, minCount = MIN_TRAIL_COVERAGE_COUNT)`
— true once at least `minCount` breadcrumb points fall within `radiusM`
(horizontal X/Z, D17) of the waypoint. Same coordinate space and `null`-skip
convention as `selectTrailWindow`; not a new metric. A drag/tap-placed
waypoint can have zero recorded breadcrumbs near it — this is the pure signal
a future arrow-fallback feature uses to tell that apart from a real gap in an
otherwise-walked route. See plans/2026-09-17-trail-coverage-plan.md.

### `visual-lifecycle.ts` — the generation-guarded async machine

The reason a knight never appears on a waypoint the visitor already left. A load
captures the waypoint's `generation`; teardown bumps it; a load resolving with a
stale generation yields `discard` (dispose + release) instead of `attach`.

Two rules that are easy to get wrong and are pinned here:

- `ACTIVE` can arrive **before** the load resolves — component 4 promises
  `PREFETCHING` gets a tick first, not that the network finished. So `show` on an
  unloaded visual records `wantVisible` and the attach honours it.
- `onLoadFailed` emits **no** `discard`: a rejected `getAssetUrl` never took a
  reference (contract D14b), so releasing it would be a double-release.

### `model-cache.ts` — the tier-2 LRU with ref-counting

Generic over an opaque handle with an injected `onEvict`, so eviction order and
ref-counting are testable with `T = string`. A template is freed only when its
ref-count is zero **and** it is evicted; an entry still referenced is never
evicted, so the cache may briefly exceed capacity rather than free something
that is on screen. Ref-counting is what makes the same asset id on two waypoints
parse once and free once.

### `parse-queue.ts` — the concurrency cap

FIFO with a concurrency limit (2 by default). Several waypoints can cross the
prefetch line in one update and `parseAsync` is main-thread; without the cap the
PREFETCH zone stops hiding the jank it exists to hide. `drain()` rejects
not-yet-started work with `QueueDrainedError` at teardown; already-running tasks
are left to finish, since the lifecycle's generation guard makes their late
results harmless.

### `story-session.ts` — one story at a time

A reducer over `{ playingId, paused }`: tapping another knight stops the current
one, tapping the playing knight toggles pause/resume (never a restart), leaving
`ACTIVE` or the audio ending clears the session.

## Tests

One `*.test.ts` per module, all node-only. The interesting ones are
`visual-lifecycle.test.ts` (resolve-after-idle, active-before-load,
dispose-in-flight, re-enter-while-loading) and `model-cache.test.ts` (never
evicting a referenced template, freeing a duplicate when two loads raced).
`trail-coverage.test.ts` pins the radius-boundary-inclusive and
`null`-skipping behavior against `selectTrailWindow`'s own conventions.
