# Breadcrumb Wayfinding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guide a tour visitor to the nearest not-yet-visited breadcrumb, marking it visited on arrival and advancing to the next, using the framework's existing `createWayfindingHud` presenter for the actual arrow/ring/label rendering.

**Architecture:** A pure selection function (`advanceBreadcrumbProgress`) picks the nearest unvisited breadcrumb index each tick and detects arrival; a new Redux slice records which indices are visited (not persisted); a new `SceneAdapter` port method carries the current target index+coord to the view layer, where a small new module (`breadcrumb-guide.ts`) owns one `createWayfindingHud` instance and re-points it.

**Tech Stack:** TypeScript, Redux Toolkit, Three.js, Vitest. Framework: `gps-plus-slam-app-framework/visualization` (`createWayfindingHud`).

## Global Constraints

- No `tour.json` schema change — this is viewing-side runtime progress, not persisted content (design plan, "Context").
- World-space (`HorizontalPoint`, `{x, z}`) only in `ar-scene` — never lat/lon math outside authoring time or the framework's own anchoring step (CLAUDE.md; design plan BW2).
- Visited-breadcrumb progress is **not persisted** to `localStorage` (design plan BW5) — unlike `tourProgress`.
- One-way latch: a visited breadcrumb index never un-visits (design plan BW3).
- New module names avoid the word "wayfinding" as a literal identifier where the framework already exports an identically-named type, to prevent an import collision in the same file (see Task 4).
- Every numeric threshold is an exported constant in `ar-scene/config.ts`, never inline (that file's own header rule).
- TDD: red → green → refactor, every step. Commit after each task.

---

### Task 1: Pure core — nearest-unvisited-breadcrumb selection

**Files:**
- Create: `GpsPlusSlamJs_TourBuilder/src/components/ar-scene/core/breadcrumb-progress.ts`
- Test: `GpsPlusSlamJs_TourBuilder/src/components/ar-scene/core/breadcrumb-progress.test.ts`
- Modify: `GpsPlusSlamJs_TourBuilder/src/components/ar-scene/core/README.md`

**Interfaces:**
- Produces: `advanceBreadcrumbProgress(points: readonly (HorizontalPoint | null)[], visited: ReadonlySet<number>, userPos: HorizontalPoint | null, arrivalRadiusM: number): { next: number | null; newlyVisited: number | null }` — consumed by Task 6 (`tour-scene.ts`).
- Consumes: `HorizontalPoint` type from `./trail-window.js` (already exists — `{ readonly x: number; readonly z: number }`).

- [ ] **Step 1: Write the failing tests**

```ts
// GpsPlusSlamJs_TourBuilder/src/components/ar-scene/core/breadcrumb-progress.test.ts
import { describe, expect, it } from "vitest";

import { advanceBreadcrumbProgress } from "./breadcrumb-progress.js";
import type { HorizontalPoint } from "./trail-window.js";

const ORIGIN: HorizontalPoint = { x: 0, z: 0 };
const RADIUS_M = 5;

/** Points laid out along +X at the given distances from the origin. */
function pointsAt(...distances: number[]): HorizontalPoint[] {
  return distances.map((x) => ({ x, z: 0 }));
}

describe("advanceBreadcrumbProgress", () => {
  it("returns null/null when there is no user position", () => {
    const result = advanceBreadcrumbProgress(
      pointsAt(1, 2),
      new Set(),
      null,
      RADIUS_M,
    );
    expect(result).toEqual({ next: null, newlyVisited: null });
  });

  it("returns null/null for an empty points array", () => {
    const result = advanceBreadcrumbProgress([], new Set(), ORIGIN, RADIUS_M);
    expect(result).toEqual({ next: null, newlyVisited: null });
  });

  it("returns null/null when every point is already visited", () => {
    const points = pointsAt(1, 2);
    const result = advanceBreadcrumbProgress(
      points,
      new Set([0, 1]),
      ORIGIN,
      RADIUS_M,
    );
    expect(result).toEqual({ next: null, newlyVisited: null });
  });

  it("picks the nearest unvisited point when it is beyond the arrival radius", () => {
    const points = pointsAt(20, 10, 30); // nearest unvisited is index 1 (10 m)
    const result = advanceBreadcrumbProgress(points, new Set(), ORIGIN, RADIUS_M);
    expect(result).toEqual({ next: 1, newlyVisited: null });
  });

  it("ignores already-visited points even when they are nearest (BW3 one-way latch)", () => {
    const points = pointsAt(10, 20); // index 0 is nearest but visited
    const result = advanceBreadcrumbProgress(
      points,
      new Set([0]),
      ORIGIN,
      RADIUS_M,
    );
    expect(result).toEqual({ next: 1, newlyVisited: null });
  });

  it("marks arrival and advances to the following point in the same call (BW4)", () => {
    const points = pointsAt(3, 10); // index 0 within the 5 m radius
    const result = advanceBreadcrumbProgress(points, new Set(), ORIGIN, RADIUS_M);
    expect(result).toEqual({ next: 1, newlyVisited: 0 });
  });

  it("marks arrival with nothing left to advance to", () => {
    const points = pointsAt(3);
    const result = advanceBreadcrumbProgress(points, new Set(), ORIGIN, RADIUS_M);
    expect(result).toEqual({ next: null, newlyVisited: 0 });
  });

  it("treats a point exactly at the arrival radius as arrived (inclusive, matches trail-window's <=)", () => {
    const points = pointsAt(5, 10);
    const result = advanceBreadcrumbProgress(points, new Set(), ORIGIN, RADIUS_M);
    expect(result).toEqual({ next: 1, newlyVisited: 0 });
  });

  it("skips points that could not be converted to world space", () => {
    const points: (HorizontalPoint | null)[] = [null, { x: 3, z: 0 }];
    const result = advanceBreadcrumbProgress(points, new Set(), ORIGIN, RADIUS_M);
    expect(result).toEqual({ next: null, newlyVisited: 1 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run src/components/ar-scene/core/breadcrumb-progress.test.ts` (from `GpsPlusSlamJs_TourBuilder/`)
Expected: FAIL — `Cannot find module './breadcrumb-progress.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// GpsPlusSlamJs_TourBuilder/src/components/ar-scene/core/breadcrumb-progress.ts
/**
 * Nearest-unvisited-breadcrumb selection (plan 2026-09-17-breadcrumb-wayfinding).
 *
 * Distinct from `selectNextUnvisitedWaypoint` (store/selectors.ts), which
 * walks tour order (D8) over waypoints. This is distance-nearest, over
 * breadcrumbs, which have no stable id (D7) — keyed by array index, same
 * convention `trail-window.ts` uses.
 *
 * One-way latch (BW3): a visited index is a permanent fact, never re-checked
 * against a hysteresis margin. Re-picks `next` in the same call when arrival
 * triggers (BW4), so the guide advances immediately rather than pointing at
 * the spot the visitor is already standing on for one extra tick.
 */

import type { HorizontalPoint } from "./trail-window.js";

interface NearestResult {
  readonly index: number;
  readonly distSq: number;
}

function nearestUnvisited(
  points: readonly (HorizontalPoint | null)[],
  isExcluded: (index: number) => boolean,
  userPos: HorizontalPoint,
): NearestResult | null {
  let best: NearestResult | null = null;
  for (let i = 0; i < points.length; i++) {
    if (isExcluded(i)) continue;
    const p = points[i];
    if (p === null || p === undefined) continue;
    const dx = p.x - userPos.x;
    const dz = p.z - userPos.z;
    const distSq = dx * dx + dz * dz;
    if (best === null || distSq < best.distSq) {
      best = { index: i, distSq };
    }
  }
  return best;
}

export function advanceBreadcrumbProgress(
  points: readonly (HorizontalPoint | null)[],
  visited: ReadonlySet<number>,
  userPos: HorizontalPoint | null,
  arrivalRadiusM: number,
): { next: number | null; newlyVisited: number | null } {
  if (userPos === null) return { next: null, newlyVisited: null };

  const nearest = nearestUnvisited(points, (i) => visited.has(i), userPos);
  if (nearest === null) return { next: null, newlyVisited: null };

  const arrivalRadiusSq = arrivalRadiusM * arrivalRadiusM;
  if (nearest.distSq > arrivalRadiusSq) {
    return { next: nearest.index, newlyVisited: null };
  }

  const following = nearestUnvisited(
    points,
    (i) => visited.has(i) || i === nearest.index,
    userPos,
  );
  return {
    next: following === null ? null : following.index,
    newlyVisited: nearest.index,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/components/ar-scene/core/breadcrumb-progress.test.ts`
Expected: PASS, 9/9.

- [ ] **Step 5: Update the sidecar README**

In `GpsPlusSlamJs_TourBuilder/src/components/ar-scene/core/README.md`, add a new module entry (placed after the existing `trail-coverage.ts` entry, before `visual-lifecycle.ts`):

```markdown
### `breadcrumb-progress.ts` — nearest-unvisited-breadcrumb selection

`advanceBreadcrumbProgress(points, visited, userPos, arrivalRadiusM)` — the
nearest not-yet-visited breadcrumb by horizontal X/Z distance (D17), or
`null` when none remain. When the nearest point is within `arrivalRadiusM`
it becomes `newlyVisited` and `next` is re-picked as if it were already
visited, so the guide advances within the same call instead of lagging a
tick. One-way latch: a visited index is never reselected. Distinct from
`selectNextUnvisitedWaypoint` (store/selectors.ts) — that one walks tour
order over waypoints; this one is distance-nearest over breadcrumbs (no
stable id, D7 — keyed by array index like `trail-window.ts`).
```

And in the `## Tests` paragraph at the bottom, append:

```markdown
`breadcrumb-progress.test.ts` pins the one-way latch (a visited index is
never reselected even when nearest), the same-call re-advance on arrival,
and the radius-boundary-inclusive convention shared with `trail-window.ts`.
```

- [ ] **Step 6: Commit**

```bash
git add src/components/ar-scene/core/breadcrumb-progress.ts src/components/ar-scene/core/breadcrumb-progress.test.ts src/components/ar-scene/core/README.md
git commit -m "feat(tourbuilder): add nearest-unvisited-breadcrumb selection"
```

---

### Task 2: Store slice — visited breadcrumb indices

**Files:**
- Create: `GpsPlusSlamJs_TourBuilder/src/store/breadcrumb-progress-slice.ts`
- Modify: `GpsPlusSlamJs_TourBuilder/src/store/viewing-store.ts`
- Modify: `GpsPlusSlamJs_TourBuilder/src/store/selectors.ts`
- Modify: `GpsPlusSlamJs_TourBuilder/src/store/store.test.ts`
- Modify: `GpsPlusSlamJs_TourBuilder/src/store/README.md`

**Interfaces:**
- Produces: `markBreadcrumbVisited(index: number)` action, `breadcrumbProgressReducer`, `BreadcrumbProgressSliceState { readonly visitedIndices: readonly number[] }`, `selectVisitedBreadcrumbIndices(state: ViewingStateShape): readonly number[]` — consumed by Task 6.
- Consumes: `clearTour` from `./tour-slice.js` (already exists).

- [ ] **Step 1: Write the failing tests**

Add to `GpsPlusSlamJs_TourBuilder/src/store/store.test.ts` (near the existing zones/tourProgress reducer tests, e.g. after the block ending at the current line 161):

```ts
import {
  breadcrumbProgressReducer,
  markBreadcrumbVisited,
} from "./breadcrumb-progress-slice.js";
// (add to the existing import block, alongside zonesReducer / tourProgressReducer)
```

```ts
describe("breadcrumbProgressReducer", () => {
  it("marks an index visited idempotently", () => {
    let s = breadcrumbProgressReducer(undefined, markBreadcrumbVisited(2));
    s = breadcrumbProgressReducer(s, markBreadcrumbVisited(2));
    s = breadcrumbProgressReducer(s, markBreadcrumbVisited(5));
    expect(s.visitedIndices).toEqual([2, 5]);
  });

  it("resets to empty on clearTour", () => {
    const s = breadcrumbProgressReducer(undefined, markBreadcrumbVisited(2));
    expect(breadcrumbProgressReducer(s, clearTour()).visitedIndices).toEqual(
      [],
    );
  });
});
```

Also add, in the selectors test area (alongside the existing `selectVisitedWaypointIds`-style assertions):

```ts
describe("selectVisitedBreadcrumbIndices", () => {
  it("reads the breadcrumbProgress slice", () => {
    const state = {
      ...viewingState(),
      breadcrumbProgress: { visitedIndices: [1, 3] },
    };
    expect(selectVisitedBreadcrumbIndices(state)).toEqual([1, 3]);
  });
});
```

Add `selectVisitedBreadcrumbIndices` to the existing selectors import block, and check the `viewingState()` test helper (already defined earlier in `store.test.ts` for the other selector tests) — add `breadcrumbProgress: { visitedIndices: [] }` to its returned shape so every other existing selector test that spreads `viewingState()` keeps typechecking against the widened `ViewingStateShape`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run src/store/store.test.ts`
Expected: FAIL — `Cannot find module './breadcrumb-progress-slice.js'`.

- [ ] **Step 3: Write the slice**

```ts
// GpsPlusSlamJs_TourBuilder/src/store/breadcrumb-progress-slice.ts
/**
 * `breadcrumbProgress` slice — which breadcrumbs the visitor has passed.
 *
 * NOT persisted (design plan BW5) — unlike `tourProgress`, re-showing a
 * couple of already-passed breadcrumbs after a reload is cosmetic, not a
 * real loss. `markBreadcrumbVisited` is idempotent so the orchestrator's
 * per-tick check can re-fire safely. Resets on `clearTour`.
 *
 * @see plans/2026-09-17-breadcrumb-wayfinding-plan.md (BW3, BW5)
 */

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { clearTour } from "./tour-slice.js";

export interface BreadcrumbProgressSliceState {
  readonly visitedIndices: readonly number[];
}

const initialState: BreadcrumbProgressSliceState = { visitedIndices: [] };

const breadcrumbProgressSlice = createSlice({
  name: "breadcrumbProgress",
  initialState,
  reducers: {
    markBreadcrumbVisited(state, action: PayloadAction<number>) {
      if (!state.visitedIndices.includes(action.payload)) {
        state.visitedIndices.push(action.payload);
      }
    },
  },
  extraReducers: (builder) => {
    builder.addCase(clearTour, (state) => {
      state.visitedIndices = [];
    });
  },
});

export const { markBreadcrumbVisited } = breadcrumbProgressSlice.actions;
export const breadcrumbProgressReducer = breadcrumbProgressSlice.reducer;
```

- [ ] **Step 4: Wire the slice into `viewing-store.ts`**

```ts
// GpsPlusSlamJs_TourBuilder/src/store/viewing-store.ts
// add to the existing imports:
import {
  breadcrumbProgressReducer,
  type BreadcrumbProgressSliceState,
} from "./breadcrumb-progress-slice.js";
```

```ts
// extend ViewingRootState:
export interface ViewingRootState extends SlamAppRootState {
  tour: TourSliceState;
  tourProgress: TourProgressSliceState;
  zones: ZonesSliceState;
  breadcrumbProgress: BreadcrumbProgressSliceState;
}
```

```ts
// extend ViewingExtraReducers:
type ViewingExtraReducers = {
  tour: typeof tourReducer;
  tourProgress: typeof tourProgressReducer;
  zones: typeof zonesReducer;
  breadcrumbProgress: typeof breadcrumbProgressReducer;
};
```

```ts
// extend the createSlamAppStore call's extraReducers:
extraReducers: {
  tour: tourReducer,
  tourProgress: tourProgressReducer,
  zones: zonesReducer,
  breadcrumbProgress: breadcrumbProgressReducer,
},
```

- [ ] **Step 5: Add the selector**

```ts
// GpsPlusSlamJs_TourBuilder/src/store/selectors.ts
// add to the existing type imports:
import type { BreadcrumbProgressSliceState } from "./breadcrumb-progress-slice.js";
```

```ts
// extend ViewingStateShape:
export interface ViewingStateShape {
  readonly tour: TourSliceState;
  readonly tourProgress: TourProgressSliceState;
  readonly zones: ZonesSliceState;
  readonly breadcrumbProgress: BreadcrumbProgressSliceState;
}
```

```ts
// add near selectVisitedWaypointIds:
export function selectVisitedBreadcrumbIndices(
  state: ViewingStateShape,
): readonly number[] {
  return state.breadcrumbProgress.visitedIndices;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/store/store.test.ts`
Expected: PASS. If any other existing test in `store.test.ts` now fails to typecheck because it builds a `ViewingStateShape`-shaped object literal without `breadcrumbProgress`, add `breadcrumbProgress: { visitedIndices: [] }` to that literal too (the compiler error names the exact line).

- [ ] **Step 7: Update the sidecar README**

In `GpsPlusSlamJs_TourBuilder/src/store/README.md`:

Add a new subsection after the existing `### \`zones-slice.ts\`` entry:

```markdown
### `breadcrumb-progress-slice.ts` — visited breadcrumbs (viewing)

`{ visitedIndices: readonly number[] }`. `markBreadcrumbVisited(index)` is
idempotent. **Not persisted** (unlike `tourProgress`) — re-showing a couple
of already-passed breadcrumbs after a reload is cosmetic. Resets on
`clearTour`. Selection logic (which index is nearest) lives in
`ar-scene/core/breadcrumb-progress.ts` — this slice only stores the result,
same split as `zones-slice.ts`.
```

Update the `### selectors.ts` paragraph's selector list to mention
`selectVisitedBreadcrumbIndices` alongside `selectVisitedWaypointIds`, and
the `viewing-store.ts` paragraph to say it composes
`tour`/`tourProgress`/`zones`/`breadcrumbProgress` (four slices, not three).

- [ ] **Step 8: Commit**

```bash
git add src/store/breadcrumb-progress-slice.ts src/store/viewing-store.ts src/store/selectors.ts src/store/store.test.ts src/store/README.md
git commit -m "feat(tourbuilder): add breadcrumbProgress viewing slice"
```

---

### Task 3: `SceneAdapter` port addition + fake

**Files:**
- Modify: `GpsPlusSlamJs_TourBuilder/src/components/ar-scene/runtime/scene-adapter.ts`
- Modify: `GpsPlusSlamJs_TourBuilder/src/components/ar-scene/runtime/fake-scene-adapter.ts`

**Interfaces:**
- Produces: `BreadcrumbTarget { readonly index: number; readonly coord: TourCoord }` type and `SceneAdapter.setWayfindingTarget(target: BreadcrumbTarget | null): void` method — consumed by Task 5 (real adapter) and Task 6 (orchestrator wiring). `FakeSceneAdapter.wayfindingTarget: BreadcrumbTarget | null` getter — consumed by Task 6's test.
- Consumes: `TourCoord` from `../../../store/types.js` (already imported in both files).

This task adds a type/method to an interface and its test double. There is no new pure logic to unit-test in isolation yet (the behavior becomes observable once Task 6 wires a real caller) — verification here is `pnpm run typecheck`, which confirms every implementer of `SceneAdapter` (the fake, and — until Task 5 lands — a temporary gap) still satisfies the interface, plus that no existing test regressed.

**Named `BreadcrumbTarget`, not `WayfindingTarget`:** the framework's own `createWayfindingHud` already exports a type called `WayfindingTarget` (its `getTargets()` element type). Task 4's module imports both types in the same file — reusing the name would collide. This port type is intentionally named apart (Global Constraints).

- [ ] **Step 1: Add the type and method to the port**

In `GpsPlusSlamJs_TourBuilder/src/components/ar-scene/runtime/scene-adapter.ts`, add after the `TapHit` interface (before `export interface SceneAdapter`):

```ts
/**
 * A breadcrumb index + its coordinate to guide the visitor toward, or `null`
 * to show nothing. Carries the index (not just the coordinate) so the
 * concrete adapter can give the framework's wayfinding presenter a fresh
 * per-target id on every swap — reusing the same id across two different
 * breadcrumbs would carry over that presenter's own arrival/hysteresis
 * state from the wrong target.
 */
export interface BreadcrumbTarget {
  readonly index: number;
  readonly coord: TourCoord;
}
```

Add this method to the `SceneAdapter` interface, in the `// ── Anchoring (A1) ──` section right after `setOrbCoords` (they are the two breadcrumb-derived scene effects):

```ts
  /** The single "walk here next" guide target (plan 2026-09-17). */
  setWayfindingTarget(target: BreadcrumbTarget | null): void;
```

- [ ] **Step 2: Implement it on the fake**

In `GpsPlusSlamJs_TourBuilder/src/components/ar-scene/runtime/fake-scene-adapter.ts`, add `BreadcrumbTarget` to the existing type-only import from `./scene-adapter.js`:

```ts
import type {
  BreadcrumbTarget,
  SceneAdapter,
  TapHit,
  TemplateHandle,
  VisualHandle,
  WaypointHandle,
} from "./scene-adapter.js";
```

Add to the `FakeSceneAdapter` interface (near `readonly orbCount: number;`):

```ts
  readonly wayfindingTarget: BreadcrumbTarget | null;
```

Add a `let wayfindingTarget: BreadcrumbTarget | null = null;` next to the existing `let orbCount = 0;`, a getter next to the existing `get orbCount() { return orbCount; }`, and the method implementation next to `setOrbCoords`:

```ts
    get wayfindingTarget() {
      return wayfindingTarget;
    },
```

```ts
    setWayfindingTarget(target: BreadcrumbTarget | null): void {
      wayfindingTarget = target;
    },
```

- [ ] **Step 3: Run the typecheck and full unit suite to confirm no regression**

Run: `pnpm run typecheck && pnpm run test:unit`
Expected: both PASS — `FakeSceneAdapter` now satisfies the widened `SceneAdapter` interface; no behavior changed for any existing consumer.

- [ ] **Step 4: Commit**

```bash
git add src/components/ar-scene/runtime/scene-adapter.ts src/components/ar-scene/runtime/fake-scene-adapter.ts
git commit -m "feat(tourbuilder): add setWayfindingTarget to the SceneAdapter port"
```

---

### Task 4: View module — `breadcrumb-guide.ts`

**Files:**
- Create: `GpsPlusSlamJs_TourBuilder/src/components/ar-scene/view/breadcrumb-guide.ts`
- Test: `GpsPlusSlamJs_TourBuilder/src/components/ar-scene/view/breadcrumb-guide.test.ts`

**Interfaces:**
- Produces: `createBreadcrumbGuide(options: BreadcrumbGuideOptions): BreadcrumbGuide`, where `BreadcrumbGuide { setTarget(target: BreadcrumbTarget | null): void; update(dtSeconds: number): void; dispose(): void }` — consumed by Task 5.
- Consumes: `BreadcrumbTarget` from `../runtime/scene-adapter.js` (Task 3); `OrbAnchor`, `OrbAnchorFactory`-shaped anchor factory from `./breadcrumb-orbs.js` (already exists — reused rather than duplicated, same DRY reasoning as everywhere else in this codebase); `createWayfindingHud` from `gps-plus-slam-app-framework/visualization`; `TourCoord` from `../../../store/types.js`.

**Why a new small module, not inline in `three-scene-adapter.ts`:** matches the existing `createBreadcrumbOrbs` precedent — `three-scene-adapter.ts` delegates each breadcrumb-derived scene effect to its own focused file rather than growing inline.

**Why `autoRegisterFrameUpdate: false`:** the framework's own guidance for this option is "set false for hosts that own their render loop (desktop simulators, replay scenes...)" — exactly TourBuilder's `SceneAdapter.update(dtSeconds)` hook, which is already called deterministically every tick in both real-AR and desktop-preview/replay modes (`tour-scene.ts`'s `tick()` calls `adapter.update(dtSeconds)` unconditionally). Relying on the framework's own ambient frame-loop registry instead would behave differently between modes and wouldn't run at all under the replay e2e's fake-adapter path.

**Why the id changes per breadcrumb index:** `createWayfindingHud` keys its per-target hysteresis state by `id ?? index`. If the returned target list always used the same constant id (or always sat at array index 0), swapping to a genuinely different, farther breadcrumb would incorrectly inherit the *previous* breadcrumb's placement state (e.g. `'hidden'` right after arrival) — per the framework's own invariant, a `'hidden'` target shows nothing again until `distance ≥ distanceMax`, which could leave the new target invisible for a while for no correct reason. A fresh `id: \`bc-${index}\`` on every swap makes each breadcrumb genuinely register as a new target, which the placement seam treats as a fresh spawn (visible immediately once `distance ≥ distanceMin`).

- [ ] **Step 1: Write the failing test**

```ts
// GpsPlusSlamJs_TourBuilder/src/components/ar-scene/view/breadcrumb-guide.test.ts
/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { Group, PerspectiveCamera } from "three";

import type { TourCoord } from "../../../store/types.js";
import type { OrbAnchor } from "./breadcrumb-orbs.js";
import { createBreadcrumbGuide } from "./breadcrumb-guide.js";

/** Identity anchor: reports its coordinate as the world position directly
 *  (lat -> x, lon -> z), same convention `fake-scene-adapter.ts` uses. */
function identityAnchorFactory() {
  const calls: string[] = [];
  return {
    calls,
    factory: (object3D: { position: { set(x: number, y: number, z: number): void } }, coord: TourCoord) => {
      calls.push(`create:${coord.lat},${coord.lon}`);
      object3D.position.set(coord.lat, 0, coord.lon);
      const anchor: OrbAnchor = {
        setGpsPoint: (c) => {
          calls.push(`setGpsPoint:${c.lat},${c.lon}`);
          object3D.position.set(c.lat, 0, c.lon);
        },
        markMovedExternally: () => calls.push("markMovedExternally"),
        dispose: () => calls.push("dispose"),
      };
      return anchor;
    },
  };
}

function findIndicator(camera: PerspectiveCamera) {
  return camera.children.find(
    (c) => c.name === "wayfinding-arrow" || c.name === "wayfinding-circle",
  );
}

describe("createBreadcrumbGuide", () => {
  it("shows no indicator before any target is set", () => {
    const parent = new Group();
    const camera = new PerspectiveCamera();
    const { factory } = identityAnchorFactory();
    const guide = createBreadcrumbGuide({
      parent,
      camera,
      anchorFactory: factory,
      distanceMinM: 0,
      distanceMaxM: 50,
    });
    guide.update(1 / 60);
    expect(findIndicator(camera)).toBeUndefined();
    guide.dispose();
  });

  it("shows an indicator once a target is set, straight ahead of the camera", () => {
    const parent = new Group();
    const camera = new PerspectiveCamera();
    const { factory } = identityAnchorFactory();
    const guide = createBreadcrumbGuide({
      parent,
      camera,
      anchorFactory: factory,
      distanceMinM: 0,
      distanceMaxM: 50,
    });
    // Camera at the origin looking down -Z; a target at (0, 0, -5) is 5 m
    // directly ahead — on-screen, so it renders as the circle indicator.
    guide.setTarget({ index: 3, coord: { lat: 0, lon: -5 } });
    guide.update(1 / 60);
    const indicator = findIndicator(camera);
    expect(indicator?.name).toBe("wayfinding-circle");
    guide.dispose();
  });

  it("re-points the SAME anchor when the target coordinate changes, rather than creating a new one", () => {
    const parent = new Group();
    const camera = new PerspectiveCamera();
    const { factory, calls } = identityAnchorFactory();
    const guide = createBreadcrumbGuide({
      parent,
      camera,
      anchorFactory: factory,
      distanceMinM: 0,
      distanceMaxM: 50,
    });
    guide.setTarget({ index: 0, coord: { lat: 0, lon: -5 } });
    guide.setTarget({ index: 1, coord: { lat: 0, lon: -8 } });
    expect(calls.filter((c) => c.startsWith("create:"))).toHaveLength(1);
    expect(calls).toContain("setGpsPoint:0,-8");
    expect(calls).toContain("markMovedExternally");
    guide.dispose();
  });

  it("hides the indicator again when the target is cleared to null", () => {
    const parent = new Group();
    const camera = new PerspectiveCamera();
    const { factory } = identityAnchorFactory();
    const guide = createBreadcrumbGuide({
      parent,
      camera,
      anchorFactory: factory,
      distanceMinM: 0,
      distanceMaxM: 50,
    });
    guide.setTarget({ index: 0, coord: { lat: 0, lon: -5 } });
    guide.update(1 / 60);
    expect(findIndicator(camera)).toBeDefined();
    guide.setTarget(null);
    guide.update(1 / 60);
    expect(findIndicator(camera)).toBeUndefined();
    guide.dispose();
  });

  it("disposes its anchor and detaches its indicator on dispose", () => {
    const parent = new Group();
    const camera = new PerspectiveCamera();
    const { factory, calls } = identityAnchorFactory();
    const guide = createBreadcrumbGuide({
      parent,
      camera,
      anchorFactory: factory,
      distanceMinM: 0,
      distanceMaxM: 50,
    });
    guide.setTarget({ index: 0, coord: { lat: 0, lon: -5 } });
    guide.update(1 / 60);
    guide.dispose();
    expect(calls).toContain("dispose");
    expect(findIndicator(camera)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/components/ar-scene/view/breadcrumb-guide.test.ts` (from `GpsPlusSlamJs_TourBuilder/`)
Expected: FAIL — `Cannot find module './breadcrumb-guide.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// GpsPlusSlamJs_TourBuilder/src/components/ar-scene/view/breadcrumb-guide.ts
/**
 * The single "walk here next" guide (plan 2026-09-17-breadcrumb-wayfinding).
 *
 * Owns one `createWayfindingHud` instance (the framework's arrow/ring/label
 * presenter) pointed at exactly one target at a time: the current nearest
 * unvisited breadcrumb, re-pointed as the orchestrator advances it. The
 * target's world position tracks the same GPS anchor + alignment machinery
 * `breadcrumb-orbs.ts` uses for the orb trail (not a one-shot `toWorld`
 * snapshot) — a visitor can spend 10-30 s walking toward a target, during
 * which the alignment lerper keeps adjusting, and the target must drift
 * with it exactly like every other anchored object in the scene.
 *
 * `autoRegisterFrameUpdate: false` — ticked manually via `update()` from
 * `SceneAdapter.update()`, which every host (real AR, desktop preview,
 * replay) already calls deterministically once per orchestrator tick.
 *
 * A fresh `id: \`bc-${index}\`` is given on every swap so the framework's
 * per-target hysteresis state never carries over from the previous, unrelated
 * breadcrumb (see the plan's Task 4 notes).
 */

import { Object3D, Vector3 } from "three";
import type { PerspectiveCamera } from "three";
import {
  createWayfindingHud,
  type WayfindingHud,
} from "gps-plus-slam-app-framework/visualization";

import type { TourCoord } from "../../../store/types.js";
import type { BreadcrumbTarget } from "../runtime/scene-adapter.js";
import type { OrbAnchor } from "./breadcrumb-orbs.js";

type AnchorFactory = (object3D: Object3D, coord: TourCoord) => OrbAnchor;

export interface BreadcrumbGuideOptions {
  readonly parent: Object3D;
  readonly camera: PerspectiveCamera;
  readonly anchorFactory: AnchorFactory;
  readonly distanceMinM: number;
  readonly distanceMaxM: number;
}

export interface BreadcrumbGuide {
  setTarget(target: BreadcrumbTarget | null): void;
  update(dtSeconds: number): void;
  dispose(): void;
}

export function createBreadcrumbGuide(
  options: BreadcrumbGuideOptions,
): BreadcrumbGuide {
  const marker = new Object3D();
  options.parent.add(marker);

  let anchor: OrbAnchor | null = null;
  let currentIndex: number | null = null;
  let currentCoord: TourCoord | null = null;

  const hud: WayfindingHud = createWayfindingHud({
    camera: options.camera,
    getTargets: () =>
      currentIndex === null
        ? []
        : [
            {
              id: `bc-${currentIndex}`,
              position: marker.getWorldPosition(new Vector3()),
            },
          ],
    distanceMin: options.distanceMinM,
    distanceMax: options.distanceMaxM,
    autoRegisterFrameUpdate: false,
  });

  return {
    setTarget(target: BreadcrumbTarget | null): void {
      if (target === null) {
        currentIndex = null;
        currentCoord = null;
        return;
      }
      if (currentCoord === target.coord && currentIndex === target.index) {
        return; // already pointed here
      }
      currentIndex = target.index;
      currentCoord = target.coord;
      if (anchor === null) {
        anchor = options.anchorFactory(marker, target.coord);
      } else {
        anchor.setGpsPoint(target.coord);
        anchor.markMovedExternally();
      }
    },

    update(dtSeconds: number): void {
      hud.update(dtSeconds);
    },

    dispose(): void {
      hud.dispose();
      anchor?.dispose();
      marker.removeFromParent();
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/components/ar-scene/view/breadcrumb-guide.test.ts`
Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add src/components/ar-scene/view/breadcrumb-guide.ts src/components/ar-scene/view/breadcrumb-guide.test.ts
git commit -m "feat(tourbuilder): add the breadcrumb wayfinding guide view module"
```

---

### Task 5: Wire `breadcrumb-guide.ts` into `three-scene-adapter.ts`

**Files:**
- Modify: `GpsPlusSlamJs_TourBuilder/src/components/ar-scene/view/three-scene-adapter.ts`
- Modify: `GpsPlusSlamJs_TourBuilder/src/components/ar-scene/config.ts`
- Modify: `GpsPlusSlamJs_TourBuilder/src/components/ar-scene/view/three-scene-adapter.test.ts`
- Modify: `GpsPlusSlamJs_TourBuilder/src/components/ar-scene/view/README.md`

**Interfaces:**
- Consumes: `createBreadcrumbGuide` (Task 4), `BreadcrumbTarget` + `setWayfindingTarget` (Task 3).
- Produces: real `SceneAdapter.setWayfindingTarget` behavior — consumed end-to-end starting Task 6.

**Included here — a targeted type fix this work exposed:** `ThreeSceneAdapterOptions.camera` is currently typed as the base `Camera`, but `createWayfindingHud` requires a real `PerspectiveCamera`. Checked against every real construction site (`app/viewing/ar-scene-runtime.ts`, `components/ar-scene/demo.ts`, `components/desktop-preview/demo.ts`, and the adapter's own test harness) — all four already only ever pass a `PerspectiveCamera` (the framework's `getCamera(): PerspectiveCamera | null`, or a literal `new PerspectiveCamera()`). Narrowing the option's type to what every caller already provides is a direct, justified prerequisite for this task, not an unrelated refactor: without it, passing `options.camera` into `createBreadcrumbGuide` will not typecheck.

- [ ] **Step 1: Add the two config constants**

In `GpsPlusSlamJs_TourBuilder/src/components/ar-scene/config.ts`, add near `TRAIL_WINDOW_RADIUS_M`:

```ts
/**
 * The wayfinding guide's own visual show/hide deadband (plan
 * 2026-09-17-breadcrumb-wayfinding, BW7) — deliberately permissive. The
 * orchestrator itself decides when a breadcrumb is "done" (arrival radius,
 * `BREADCRUMB_ARRIVAL_RADIUS_M`) and swaps to a fresh target id at that
 * moment; these two just need to avoid the framework presenter's OWN
 * distance gate fighting that decision. 0 means a freshly assigned target is
 * never hidden for being "too close"; 50 m is comfortably beyond any
 * realistic distance to the next breadcrumb.
 */
export const BREADCRUMB_GUIDE_DISTANCE_MIN_M = 0;
export const BREADCRUMB_GUIDE_DISTANCE_MAX_M = 50;
```

- [ ] **Step 2: Narrow the camera type and wire the guide into the adapter**

In `GpsPlusSlamJs_TourBuilder/src/components/ar-scene/view/three-scene-adapter.ts`:

```ts
// change the import:
import { Vector3, type AudioListener, type PerspectiveCamera } from "three";
```

```ts
// change the option field:
export interface ThreeSceneAdapterOptions {
  readonly parent: Object3D;
  readonly camera: PerspectiveCamera;
  // ...unchanged fields below...
```

Add the import for the new module and constants:

```ts
import {
  createBreadcrumbGuide,
  type BreadcrumbGuide,
} from "./breadcrumb-guide.js";
import {
  BREADCRUMB_GUIDE_DISTANCE_MIN_M,
  BREADCRUMB_GUIDE_DISTANCE_MAX_M,
} from "../config.js";
import type { BreadcrumbTarget } from "../runtime/scene-adapter.js";
```

Construct the guide alongside `orbs` (right after the existing `const orbs: BreadcrumbOrbs = createBreadcrumbOrbs({...})` block):

```ts
  const breadcrumbGuide: BreadcrumbGuide = createBreadcrumbGuide({
    parent: options.parent,
    camera: options.camera,
    anchorFactory: (object3D, coord) => options.createAnchor(object3D, coord),
    distanceMinM: BREADCRUMB_GUIDE_DISTANCE_MIN_M,
    distanceMaxM: BREADCRUMB_GUIDE_DISTANCE_MAX_M,
  });
```

Add the port method implementation right after `setOrbCoords`:

```ts
    setWayfindingTarget(target: BreadcrumbTarget | null): void {
      breadcrumbGuide.setTarget(target);
    },
```

Add the tick call in `update()`, alongside `orbs.update(dtSeconds)`:

```ts
      orbs.update(dtSeconds);
      breadcrumbGuide.update(dtSeconds);
```

Add the disposal in `dispose()`, alongside `orbs.dispose()`:

```ts
      orbs.dispose();
      breadcrumbGuide.dispose();
```

- [ ] **Step 3: Write the failing integration test**

Add to `GpsPlusSlamJs_TourBuilder/src/components/ar-scene/view/three-scene-adapter.test.ts`, a new `describe` block (the file already imports `PerspectiveCamera`, `Vector3`, and has the `setup()` harness from Task-agnostic context read earlier in this plan):

```ts
describe("wayfinding guide (plan 2026-09-17)", () => {
  it("renders an indicator once setWayfindingTarget is called, and clears it on null", () => {
    const h = setup();
    const findIndicator = () =>
      h.camera.children.find(
        (c) => c.name === "wayfinding-arrow" || c.name === "wayfinding-circle",
      );

    expect(findIndicator()).toBeUndefined();

    h.adapter.setWayfindingTarget({ index: 0, coord: COORD });
    h.adapter.update(1 / 60);
    expect(findIndicator()).toBeDefined();

    h.adapter.setWayfindingTarget(null);
    h.adapter.update(1 / 60);
    expect(findIndicator()).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run the tests to verify the new one fails, then passes**

Run: `pnpm exec vitest run src/components/ar-scene/view/three-scene-adapter.test.ts`
Expected first (before Step 2's wiring, if run standalone): FAIL — `setWayfindingTarget is not a function`. After Step 2's wiring is in place: PASS, including all pre-existing tests in the file (the camera-type narrowing must not break the `tap classification` or `transcript billboarding` describe blocks, which already construct a real `PerspectiveCamera` and pass it as `camera` — confirm by running the full file, not just the new block).

- [ ] **Step 5: Run the full package gate**

Run: `pnpm test` (from `GpsPlusSlamJs_TourBuilder/`)
Expected: PASS — format, lint, typecheck, unit, jscpd/dpdm/dependency-cruiser all clean. The camera-type narrowing is the one change here with any blast radius beyond this file; this step is what confirms it.

- [ ] **Step 6: Update the sidecar README**

In `GpsPlusSlamJs_TourBuilder/src/components/ar-scene/view/README.md`, add a `breadcrumb-guide.ts` entry next to the existing `breadcrumb-orbs.ts` entry (read that file's current entry for the exact heading style before writing this one, so the new entry matches its neighbors) describing: one `createWayfindingHud` instance, re-pointed via a re-usable anchor (same anchor-reuse pattern as the orb pool, but a single target instead of a pool), fresh id per breadcrumb index to avoid inheriting stale hysteresis state, manually ticked (`autoRegisterFrameUpdate: false`) from the adapter's own `update()`.

- [ ] **Step 7: Commit**

```bash
git add src/components/ar-scene/view/three-scene-adapter.ts src/components/ar-scene/config.ts src/components/ar-scene/view/three-scene-adapter.test.ts src/components/ar-scene/view/README.md
git commit -m "feat(tourbuilder): wire the breadcrumb guide into the real scene adapter"
```

---

### Task 6: Orchestrator wiring — `tour-scene.ts`

**Files:**
- Modify: `GpsPlusSlamJs_TourBuilder/src/components/ar-scene/config.ts`
- Modify: `GpsPlusSlamJs_TourBuilder/src/components/ar-scene/runtime/tour-scene.ts`
- Modify: `GpsPlusSlamJs_TourBuilder/src/components/ar-scene/runtime/tour-scene.test.ts`
- Modify: `GpsPlusSlamJs_TourBuilder/src/components/ar-scene/README.md`

**Interfaces:**
- Consumes: `advanceBreadcrumbProgress` (Task 1), `markBreadcrumbVisited` + `BreadcrumbProgressSliceState` (Task 2), `setWayfindingTarget` + `BreadcrumbTarget` (Task 3).

- [ ] **Step 1: Add the arrival-radius constant**

In `GpsPlusSlamJs_TourBuilder/src/components/ar-scene/config.ts`, add near `TRAIL_WINDOW_RADIUS_M`:

```ts
/**
 * How close counts as "arrived" at a breadcrumb (plan
 * 2026-09-17-breadcrumb-wayfinding, BW6) — a bit past the 3 m breadcrumb
 * sampling grain (`MIN_BREADCRUMB_DISTANCE_M`) so ordinary GPS jitter
 * reliably crosses it without the visitor needing to stand exactly on the
 * point. Tunable, same posture as every other threshold here — no stronger
 * justification available before real outdoor testing.
 */
export const BREADCRUMB_ARRIVAL_RADIUS_M = 5;
```

- [ ] **Step 2: Write the failing test**

Add to `GpsPlusSlamJs_TourBuilder/src/components/ar-scene/runtime/tour-scene.test.ts`, inside the existing `describe("the breadcrumb trail", ...)` block (right after its current single test, reusing the same `setup()`/`TOUR` fixture already in the file — breadcrumbs at world `(0,0,0)`, `(0,0,5)`, `(0,0,200)` per the fake's lat→x/lon→z mapping):

```ts
  it("guides toward the nearest unvisited breadcrumb and marks it visited on arrival", () => {
    const h = setup();
    // Stand right on breadcrumb 0 (0,0,0) — within the 5 m arrival radius —
    // so it should be marked visited and the guide should advance to
    // breadcrumb 1 at (0,0,5).
    h.adapter.setUserPosition(new Vector3(0, 0, 0));
    h.scene.tick(1); // > the 0.25 s trail interval

    expect(h.store.getState().breadcrumbProgress.visitedIndices).toEqual([0]);
    expect(h.adapter.wayfindingTarget).toEqual({
      index: 1,
      coord: { lat: 0, lon: 5 },
    });
  });

  it("never re-visits an already-visited breadcrumb, even standing on it again", () => {
    const h = setup();
    h.adapter.setUserPosition(new Vector3(0, 0, 0));
    h.scene.tick(1);
    expect(h.store.getState().breadcrumbProgress.visitedIndices).toEqual([0]);

    // Walk away and back to the same spot.
    h.adapter.setUserPosition(new Vector3(50, 0, 0));
    h.scene.tick(1);
    h.adapter.setUserPosition(new Vector3(0, 0, 0));
    h.scene.tick(1);

    expect(h.store.getState().breadcrumbProgress.visitedIndices).toEqual([0]);
    expect(h.adapter.wayfindingTarget).toEqual({
      index: 1,
      coord: { lat: 0, lon: 5 },
    });
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm exec vitest run src/components/ar-scene/runtime/tour-scene.test.ts`
Expected: FAIL — `h.store.getState().breadcrumbProgress` is `undefined` (the slice exists in the store from Task 2, but nothing dispatches into it yet), and/or `h.adapter.wayfindingTarget` stays `null`.

- [ ] **Step 4: Wire it into the orchestrator**

In `GpsPlusSlamJs_TourBuilder/src/components/ar-scene/runtime/tour-scene.ts`:

```ts
// add to the existing imports:
import { advanceBreadcrumbProgress } from "../core/breadcrumb-progress.js";
import { markBreadcrumbVisited } from "../../../store/breadcrumb-progress-slice.js";
import { BREADCRUMB_ARRIVAL_RADIUS_M } from "../config.js";
```

Extend `updateTrail()`:

```ts
  function updateTrail(): void {
    if (currentTour === null) return;
    const coords: readonly TourCoord[] = currentTour.breadcrumb;
    if (coords.length === 0) return;

    const world: readonly (Vector3 | null)[] = adapter.toWorldPositions(coords);
    const selected = selectTrailWindow(world, adapter.getUserPosition(), {
      maxOrbs: poolSize,
      radiusM: trailRadiusM,
    });
    orbSlots = assignOrbSlots(orbSlots, selected, poolSize);
    adapter.setOrbCoords(
      orbSlots.map((index) =>
        index === null ? null : (coords[index] ?? null),
      ),
    );

    const visited = new Set(store.getState().breadcrumbProgress.visitedIndices);
    const { next, newlyVisited } = advanceBreadcrumbProgress(
      world,
      visited,
      adapter.getUserPosition(),
      BREADCRUMB_ARRIVAL_RADIUS_M,
    );
    if (newlyVisited !== null) {
      store.dispatch(markBreadcrumbVisited(newlyVisited));
    }
    const nextCoord = next === null ? null : coords[next] ?? null;
    adapter.setWayfindingTarget(
      next === null || nextCoord === null ? null : { index: next, coord: nextCoord },
    );
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/components/ar-scene/runtime/tour-scene.test.ts`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 6: Run the full package gate**

Run: `pnpm test` (from `GpsPlusSlamJs_TourBuilder/`)
Expected: PASS.

- [ ] **Step 7: Update `ar-scene/README.md`**

Read the file's current description of the orchestrator's responsibilities (component 8's own summary) and add one sentence noting it also drives the single breadcrumb wayfinding guide (arrival detection + target advancement), pointing at `plans/2026-09-17-breadcrumb-wayfinding-plan.md` for the design rationale — match the file's existing sentence style rather than inventing a new heading.

- [ ] **Step 8: Commit**

```bash
git add src/components/ar-scene/config.ts src/components/ar-scene/runtime/tour-scene.ts src/components/ar-scene/runtime/tour-scene.test.ts src/components/ar-scene/README.md
git commit -m "feat(tourbuilder): drive breadcrumb wayfinding from the AR scene orchestrator"
```

---

### Task 7: Replay e2e — real recorded walk

**Files:**
- Modify: `GpsPlusSlamJs_TourBuilder/src/components/ar-scene/runtime/tour-scene-replay.e2e.test.ts`

**Interfaces:**
- Consumes: `FakeSceneAdapter.wayfindingTarget` (Task 3), the real `createTourScene` (unchanged signature) driven by `replayRecording` (existing framework utility, already used by this file).

This task has no new production code — it only extends an existing e2e test, so there is no separate red/green pair on new source; the "red" step is the assertion itself failing against the current (already-passing-for-other-reasons) replay run.

- [ ] **Step 1: Read the existing file's structure**

Before writing anything, read `GpsPlusSlamJs_TourBuilder/src/components/ar-scene/runtime/tour-scene-replay.e2e.test.ts` in full to find: which recording it replays (`recordings/2026-06-22_16-06-59utc.zip` per the authoring plan's precedent, but confirm against this file directly), how it steps the replay (a loop calling `scene.tick(dt)` per recorded frame), and what tour fixture's `breadcrumb` array is loaded alongside it (it must be non-empty and derived from real recorded positions for this assertion to mean anything — if the file's existing fixture tour has an empty `breadcrumb` array, this task also needs to populate one from the same recording's own position stream before the assertion is meaningful; confirm this against the file's actual content rather than assuming).

- [ ] **Step 2: Add the assertion**

Add a new `it(...)` block (exact placement and surrounding fixture setup depends on Step 1's findings — follow the file's existing pattern for stepping the replay and reading `h.adapter`/`FakeSceneAdapter`-equivalent state) that:
  - Collects `adapter.wayfindingTarget?.index ?? null` after every replayed tick into an array.
  - Asserts the sequence of non-null indices is monotonically non-decreasing (never regresses to an earlier index) — `for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);` over the non-null entries only.
  - Asserts at least one index transition happened (`new Set(seen.filter((i) => i !== null)).size > 1`) — proving the guide actually advanced at least once over the real walk, not just sat on the first breadcrumb.

- [ ] **Step 3: Run the e2e test**

Run: `pnpm run test:unit -- src/components/ar-scene/runtime/tour-scene-replay.e2e.test.ts` (or the file's own established e2e run command — confirm against `package.json`'s scripts, since replay e2e tests in this package may be grouped under a different script than plain unit tests)
Expected: PASS.

- [ ] **Step 4: Run the full package gate**

Run: `pnpm test` (from `GpsPlusSlamJs_TourBuilder/`)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ar-scene/runtime/tour-scene-replay.e2e.test.ts
git commit -m "test(tourbuilder): assert breadcrumb wayfinding advances over a real recorded walk"
```

---

## Self-Review Notes

- **Spec coverage:** every BW1-BW8 decision from the design plan has a task: BW1 (alongside, not replacing) — no change to `selectTrailWindow`/orb rendering anywhere in this plan. BW2 (world-space) — Task 1, 4. BW3 (one-way latch) — Task 1's tests. BW4 (same-call re-advance) — Task 1. BW5 (not persisted) — Task 2 (no `localStorage` code added). BW6 (arrival radius constant) — Task 6. BW7 (HUD deadband) — Task 5. BW8 (naming) — Task 3/4 (`BreadcrumbTarget`, `breadcrumb-guide.ts`, `breadcrumb-progress.ts`).
- **Corrections made while writing this plan** (not in the original design plan, found by pinning exact types/signatures): `createWayfindingHud` needs a real `THREE.PerspectiveCamera`, which `tour-scene.ts` may never import — moved the HUD instance into a new `view/breadcrumb-guide.ts` module behind the port (design plan already anticipated this and was corrected there); the framework's own `WayfindingTarget` type collides by name with the port's target type — renamed the port's to `BreadcrumbTarget`; a constant/index-0 target id would inherit stale per-target hysteresis state across swaps — fixed by keying the id on the breadcrumb index; `autoRegisterFrameUpdate` defaulting to `true` would tick inconsistently across real-AR vs. desktop-preview/replay modes — set to `false` and ticked manually from the adapter's existing `update()` hook; `ThreeSceneAdapterOptions.camera`'s type is wider (`Camera`) than every real caller's actual value (`PerspectiveCamera`) — narrowed it, confirmed safe against all four real call sites.
- **Placeholder scan:** none found — every step has literal code, exact file paths, exact commands.
- **Type consistency:** `BreadcrumbTarget { index, coord }` is defined once (Task 3, `scene-adapter.ts`) and imported by name everywhere else it's used (Tasks 4, 5, 6) — no redefinition. `advanceBreadcrumbProgress`'s return shape (`{ next, newlyVisited }`) is identical between Task 1's definition and Task 6's consumption.
