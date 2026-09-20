# 2026-06-26 — Shared Contract Plan (tour.json + Redux store + asset-provider)

**Status:** agreed in a design grilling on 2026-06-26 (Maria & Nico). This is the
single contract every Goal-1 component (§2.3) and the Goal-2 composition (§2.4)
talk to. Pin this down **before** splitting component work — components 3, 4, 5,
6, 8 and 10 are all written against it.

This file is the destination contract, not an implementation. It captures the
TypeScript interfaces for `tour.json` and the Redux slices, the asset-provider
interface, and — importantly — the **decisions and the deviations from the
written §2.2 spec** so the product-owner review can see what was chosen on
purpose.

---

## 0. Decisions at a glance (and deviations from §2.2)

| # | Decision | Note |
|---|----------|------|
| D1 | One `Waypoint` entity. "POI" is a map rendering role, not a separate type. | — |
| D2 | Proximity radii (`prefetchRadius`, `activeRadius`) are **per-waypoint fields in `tour.json`** (§2.2-literal). Only the **hysteresis margin** stays a config constant — it's a debounce implementation detail, not authorable content. | No deviation. |
| D3 | Top-level `assets` map; each entry is `{ id, type, filename }`. | — |
| D4 | Waypoint content uses **structured slots**, not a flat id array. `model?`/`sprite?` kept separate with an **at-most-one** invariant (validator-enforced). `transcript` is **inline text**, `audio` is an asset id. | — |
| D5 | Positions use core `{ lat, lon, altitude? }` (`TourCoord`), structurally assignable to `LatLong`/`LatLongAlt`. Map converts to Leaflet `lng` on its side. | Avoids a lat/lon transposition bug at the one anchoring seam. |
| D6 | `altitude` persisted but **not yet consumed** (framework floor-Y deferred). | In the live AR session "not consumed" means every stop is placed on the **visitor's floor** (camera height minus phone height), not at `y = 0`: GPS-world `y` is absolute altitude there, so `0` is the ellipsoid. The desktop preview's floor is `y = 0`, so it uses `0`. |
| D7 | `breadcrumb` is a **flat** `TourCoord[]` polyline, position-only. Segmentation is a view-time derivation. | — |
| D8 | Waypoint order = **array order**. Stable `id` for identity. No `order` field. | — |
| D9 | **No `schemaVersion`.** A validate-on-load step still runs (validation ≠ versioning). | Not a spec deviation — §2.2 never asks for versioning. Trade-off only: future format changes can't be detected/migrated cleanly. Acceptable for the prototype. |
| D10 | Three viewing slices: `tour`, `tourProgress`, `zones`. Authoring slice: `authoring`. | — |
| D11 | **No app-owned user-position slice.** Proximity & map read the live world-space pose from the framework. Only **zone transitions** are dispatched. | High-frequency in, low-frequency out. |
| D12 | `authoring` is a **persisted/recordable** slice (replayable authoring walks). `selectExportedTour` bridges draft → `Tour`. | Mirrors recorder's `refPoints` persistence. |
| D13 | Two store factories selected at bootstrap from the `?tour=` URL param. **Mode is not a slice.** | — |
| D14 | Asset-provider: `getAssetUrl(id) → Promise<url>` + `release(id)`, **ref-counted**, **reject-on-error**, blob-tier only, one interface / three backings, **injected not stored**. | Parsed-model LRU (tier 2) lives in component 8, not the provider. |
| D15 | Component 4 writes the `zones` slice **only** — never imports the asset-provider or THREE.js. Consumers (component 8) subscribe to `zones` and own all asset/scene side effects, reacting to zone **edges**. Transitions are **monotonic single-step** in both directions (never IDLE↔ACTIVE directly). | Keeps component 4 pure/GPS-free/reusable (upstream-PR candidate); the single-step guarantee is what lets a consumer assume prefetch precedes activation (§2.5.3 anti-jank). |
| D16 | Hysteresis margin is **fractional**: enter at `radius`, exit at `radius·(1+h)`, one global `h`. Supersedes the fixed-metre `HYSTERESIS_MARGIN_M` (§4). | Scales with each waypoint's own radius; never inverts on small radii (e.g. `activeRadius` 6). Grilled 2026-07-14. |
| D17 | Proximity distance is **horizontal (X/Z)**, not full 3D `distanceTo`. | Altitude is the noisiest GPS axis and two sample waypoints omit it; tour is single-plane. Grilled 2026-07-14. |

---

## 1. `tour.json` schema (part 1 of the contract)

The on-disk / on-wire format. Authoring writes it; viewing reads it. Lat/lon is
only how a location is **persisted** — at runtime everything works in world-space
meters (§2.5.1); geo coordinates legitimately appear only here and in the single
framework anchoring step.

```ts
// ── Coordinates ──────────────────────────────────────────────────────────────
// Structurally assignable to the core `LatLong` / `LatLongAlt` so a TourCoord
// drops straight into `createGpsAnchor({ gpsPoint })` with ZERO field mapping.
// (core uses `lon` + `altitude`, NOT Leaflet `lng`.)
interface TourCoord {
  readonly lat: number;
  readonly lon: number;
  readonly altitude?: number; // persisted but not yet consumed (D6)
}

// ── Assets ───────────────────────────────────────────────────────────────────
type AssetId = string;
type AssetType = 'sprite' | 'model' | 'audio'; // image | GLTF/GLB | MP3/OGG

interface AssetEntry {
  readonly id: AssetId;
  readonly type: AssetType;
  readonly filename: string; // path inside the tour.zip (central-directory key)
}

// ── Waypoint content ─────────────────────────────────────────────────────────
interface WaypointContent {
  readonly model?: AssetId;   // ┐ invariant (validator-enforced, D4):
  readonly sprite?: AssetId;  // ┘ at most one of { model, sprite } is set
  readonly audio?: AssetId;   // tap-to-play story (the scene's tap trigger)
  readonly transcript?: string; // inline floating text (component 2); NOT a file
}

interface Waypoint {
  readonly id: string;             // stable identity (cache key, visited tracking)
  readonly position: TourCoord;
  readonly prefetchRadius: number; // meters, IDLE → PREFETCHING (D2)
  readonly activeRadius: number;   // meters, PREFETCHING → ACTIVE  (D2)
  readonly content: WaypointContent; // may be empty (pure breadcrumb-only stop)
}

// ── Tour envelope ────────────────────────────────────────────────────────────
interface Tour {
  readonly id: string;
  readonly name: string;
  readonly description: string;                 // may be ""
  readonly assets: readonly AssetEntry[];       // central registry, referenced by id
  readonly waypoints: readonly Waypoint[];       // ORDERED (array order = tour order)
  readonly breadcrumb: readonly TourCoord[];     // flat polyline, recording order
}
```

### Invariants (enforced by `validateTour(raw): Tour` on load)

1. Every `AssetId` referenced by a waypoint (`model`/`sprite`/`audio`) exists in
   `assets`.
2. At most one of `content.model` / `content.sprite` per waypoint.
3. Every `AssetEntry.filename` is present in the zip (checked by packaging
   component 5; the loader validates the reference graph).
4. `id`s are unique within their collection (`assets`, `waypoints`).
5. Per waypoint, `prefetchRadius > activeRadius > 0` (the PREFETCH zone must
   enclose the ACTIVE zone, §2.5.3).
6. The loader **rejects** a malformed tour.json rather than letting the store
   hold partial data. (No `schemaVersion` — D9.)

### Open / minor conventions (correct in review)

- **Id generation** is authoring's concern — short unique strings (e.g. nanoid or
  `wp-<n>` / `asset-<n>`). The contract only requires "stable + unique".
- `filename` convention: e.g. `assets/<id>.<ext>`. Packaging owns the exact
  layout; the loader only uses it as the central-directory lookup key.

---

## 2. Redux store slices (part 2 of the contract)

Both the 2D DOM UI and the Three.js/WebXR scene subscribe to the store; business
logic/state is separated from views (Phase-1 lesson). All app slices plug into
`createSlamAppStore({ extraReducers })` exactly like the recorder plugs in
`refPoints`/`routing`/`scenario`/`qrDetected`.

### 2.1 Slice inventory

```ts
type ZoneState = 'IDLE' | 'PREFETCHING' | 'ACTIVE';

// ── Viewing ──────────────────────────────────────────────────────────────────
interface TourSliceState {            // slice key: `tour`
  readonly tour: Tour | null;         // set once on load, then immutable
}

interface TourProgressSliceState {    // slice key: `tourProgress`
  readonly visitedWaypointIds: readonly string[];
  // current target is derived (selectNextUnvisitedWaypoint), not stored
}

interface ZonesSliceState {           // slice key: `zones`
  readonly byWaypointId: Readonly<Record<string, ZoneState>>; // component 4 output
}

// ── Authoring ────────────────────────────────────────────────────────────────
interface AuthoringSliceState {       // slice key: `authoring`
  // draft has its OWN shape (not a partial Tour). Asset BYTES live behind the
  // asset-provider (FilesAssetProvider); the slice holds id/type/filename only.
  readonly name: string;
  readonly description: string;
  readonly assets: readonly AssetEntry[];
  readonly waypoints: readonly Waypoint[];
  readonly breadcrumb: readonly TourCoord[];
}
```

> `tourProgress` is intentionally **separate** from `tour` (decision a in Q7):
> progress churns, the loaded tour does not.

### 2.2 Frequency contract (D11)

- Nothing app-owned dispatches at frame rate.
- The user's world-space position is **read live from the framework**
  (camera/`arWorldGroup` world pose via the per-frame loop) by the two consumers
  that need it — the proximity driver (component 4) and the map (component 7).
  It is **never** mirrored into a slice.
- The only frame-rate→Redux bridge is component 4 emitting **zone transitions**
  into `zones` (rare, hysteresis-gated). Raw position never hits Redux.
- "Live GPS/device state" in the store = the framework's existing
  `gpsData` / `tracking` slices, not an app slice.

### 2.3 Selectors & actions (owned by component 3 / component 10)

```ts
// Viewing selectors (component 3 — pure, no Three.js/DOM)
selectTour(state): Tour | null
selectOrderedWaypoints(state): readonly Waypoint[]
selectNextUnvisitedWaypoint(state): Waypoint | null
selectTourProgress(state): { visited: number; total: number }
selectWaypointZone(state, id): ZoneState
selectActiveWaypointIds(state): readonly string[]
selectWaypointVisual(wp): { kind: 'model' | 'sprite'; assetId: AssetId } | null // resolves the at-most-one slot

// Viewing actions
tour:         loadTour(tour: Tour)
tourProgress: markWaypointVisited(id: string)
zones:        setWaypointZone({ id, zone })   // dispatched by the component-4 driver

// Authoring actions (persisted — whitelisted via persistedExtraPrefixes)
authoring: setTourMeta({ name, description })
authoring: addWaypoint({ id, position })
authoring: attachAsset({ waypointId, slot, asset })   // slot: model|sprite|audio|transcript
authoring: addBreadcrumbPoint(point: TourCoord)
// + selectExportedTour(state): Tour    (bridge draft → canonical Tour for packaging)
```

#### 2.3.1 Selector contract (Component 3)

All components that read store state **must** use the selectors in
`store/selectors.ts`; a component needing a new read **adds its selector there**
rather than selecting inline. This keeps state-shape knowledge in one file so a
slice refactor touches one place. `selectWaypointVisual` takes a `Waypoint` (not
`state`) — the caller already has it from `selectOrderedWaypoints`.

#### 2.3.2 Implemented surface (Component 3) — additive to the above

The implementation adds the following beyond the §2.3 list. They are **supersets**
(the agreed names above are unchanged) needed by editing (component 10), the
proximity driver (component 4), and tour reloading:

```ts
// Viewing actions
tour:         clearTour()                        // reset; tourProgress + zones listen and reset too
zones:        initZones(waypointIds: string[])   // seed all → IDLE at load (component-4 bootstrap)

// Authoring actions
authoring: updateWaypoint({ id, changes })       // changes.content is merged (transcript edited here)
authoring: removeWaypoint(id)
authoring: removeAsset(id)                        // also clears any waypoint slot referencing it
authoring: clearAuthoring()

// Additive selectors
selectAssets(state): readonly AssetEntry[]        // loaded tour's assets
selectWaypointById(state, id): Waypoint | undefined
selectIsWaypointVisited(state, id): boolean
selectVisitedWaypointIds(state): readonly string[]
selectAuthoringWaypoints(state) / selectAuthoringName(state) / selectAuthoringDescription(state)
```

Clarification on `attachAsset`: its `slot` is an **asset-backed** slot
(`model | sprite | audio`) and its payload carries an `AssetEntry` (registered in
`assets` + wired to the waypoint, model/sprite kept mutually exclusive).
`transcript` is inline text (D4), edited via `updateWaypoint({ content })`, not
`attachAsset`.

### 2.4 Store factories (D13)

```ts
// bootstrap reads ?tour= once:
const mode = new URL(location.href).searchParams.has('tour') ? 'viewing' : 'authoring';

createViewingStore()   // = createSlamAppStore({ extraReducers: { tour, tourProgress, zones } })
createAuthoringStore() // = createSlamAppStore({
                       //     extraReducers: { authoring },
                       //     persistedExtraPrefixes: [ slicePrefixOf(addWaypoint.type) ] })
```

Both share the framework base (`gpsData`/`tracking`/`recording`), so one replay
recording can drive either mode's e2e test.

### 2.5 Zone-state consumer contract (component 4 → store → consumers, D15)

Component 4 is the **only writer** of `zones.byWaypointId`. It writes zone *state*
and nothing else — no asset-provider, no THREE.js, no timers (pure world-space
distance → zone). Every lifecycle side effect belongs to the **consumer** that
subscribes to the slice (component 8 in composition; the standalone demo just
logs). Consumers react to the **edges** (diff previous vs next zone), and each
`ZoneState` maps to a concrete memory/visibility tier:

| ZoneState | Meaning | Consumer action on **entering** |
|---|---|---|
| `IDLE` | nothing loaded | dispose GPU (tier 2) + `release()` Blob (tier 1) |
| `PREFETCHING` | model parsed + instantiated, **invisible** | `getAssetUrl` → parse/instantiate, keep `visible = false` |
| `ACTIVE` | in view | `visible = true` |

Guarantees component 4 gives its consumers:

- **Monotonic single-step edges.** Between two updates a waypoint moves at most
  one zone (`IDLE↔PREFETCHING↔ACTIVE`, never `IDLE↔ACTIVE` directly), in both
  directions. So `PREFETCHING` (fetch+parse) always fires and gets ≥1 tick before
  `ACTIVE` (visible) — this is what hides the GLTF parse jank (§2.5.3). Even on a
  GPS teleport, activation lags by ≤1 tick (imperceptible).
- **Downward through `PREFETCHING` keeps the model warm.** `ACTIVE→PREFETCHING`
  only flips `visible = false`; the parsed model stays resident. Dispose+release
  happen solely at `PREFETCHING→IDLE`, gated behind the outer hysteresis band, so
  a visitor pacing on the active line never churns the GPU.
- **Hysteresis-gated & frame-decoupled.** Enter at `radius`, exit at
  `radius·(1+h)` (D16); positions jittering on a boundary emit no edge. Raw
  position is read live from the framework and **never** hits Redux (D11).

The slice is seeded by `initZones(waypointIds)` (all → `IDLE`) at tour load, and
reset by `clearTour`. Consumers may assume every loaded waypoint has an entry.

---

## 3. Asset-provider interface (part 3 of the contract)

The store holds asset **ids** only; bytes flow through this interface. Hiding the
bytes here is what lets the loading policy (§2.5.4 remote→local switch) change
without touching the store or the scene.

```ts
interface AssetProvider {
  /** Resolve an asset id to a Blob URL. Ref-counted: each call must be balanced
   *  by exactly one release(). Rejects on missing/corrupt asset. */
  getAssetUrl(id: AssetId): Promise<string>;

  /** Balance one getAssetUrl(). The underlying Blob URL is revokeObjectURL'd
   *  only when the ref-count for `id` reaches 0. */
  release(id: AssetId): void;
}
```

### Semantics

- **Ref-counted (D14a):** safe for assets reused across waypoints (e.g. the same
  audio id on two stops). Invariant: `getAssetUrl`/`release` calls balance.
- **Reject-on-error (D14b):** the proximity-driven loader (component 8) catches a
  rejection, leaves that waypoint without its visual, logs a warning — one bad
  asset never crashes the tour (frame-decoder soft-fail philosophy).
- **Blob tier only (D14c):** the parsed-model LRU and GPU dispose() (tier 2 of
  §2.5's two memory tiers) live in component 8's scene, NOT here. This keeps the
  provider THREE.js-free and reusable.
- **Injected, never in the store.** The app composition constructs the provider
  and passes it to the scene/loader.

### Backings (D14d) — one interface, three implementations

| Implementation | Mode | Source |
|---|---|---|
| `RangeZipAssetProvider` | viewing | byte-range zip reader + remote→local cache switch (§2.5.4) |
| `FilesAssetProvider` | authoring | the author's picked `File`s |
| `StaticAssetProvider` | tests/demos | fixed fixtures (lets components 1/2/8 demo without a zip or network) |

### Two-tier memory model (§2.5), for clarity

- **Tier 1 — Blob / Blob URL:** owned by the `AssetProvider` (this contract).
  Freed by `release()` → `revokeObjectURL` at ref-count 0.
- **Tier 2 — parsed THREE.js GPU resources** (geometry/material/texture) + small
  LRU of parsed models: owned by component 8. Freed by `dispose()` when a
  waypoint drops back to `IDLE`.

---

## 4. Global config constants (D2)

Radii are **per-waypoint** in `tour.json` (`Waypoint.prefetchRadius` /
`activeRadius`). The only proximity constant in config is the hysteresis margin —
a debounce detail component 4 owns, never persisted, not authorable. The margin
is **fractional** (D16), so it scales with each waypoint's own radius and never
inverts on small radii:

```ts
// config.ts
export const HYSTERESIS_FRACTION = 0.15; // exit band = radius·(1+h); component 4 internal, never persisted

// authoring defaults (suggested values written onto each new waypoint at drop time;
// the author can edit them — they are real per-waypoint data once written):
export const DEFAULT_PREFETCH_RADIUS_M = 25; // IDLE → PREFETCHING
export const DEFAULT_ACTIVE_RADIUS_M   = 10; // PREFETCHING → ACTIVE
```

Component 4 reads each waypoint's own `prefetchRadius` / `activeRadius` directly
from the store. Per boundary: **enter** when horizontal distance `≤ radius`,
**exit** when `> radius·(1 + HYSTERESIS_FRACTION)` (D16, D17).

---

## 5. What this contract deliberately leaves to the components

- **Distance/proximity math** — component 4 (pure, world-space `Vector3`,
  **horizontal X/Z** distance, not full 3D `distanceTo` (D17); no geo math,
  §2.5.1).
- **Geo→world anchoring** — the framework's single `createGpsAnchor` step. The
  only place a `TourCoord` becomes a world position.
- **Trail segmentation** ("which orbs lead to the next waypoint") — view-time in
  component 8, not persisted.
- **Parsed-model LRU + GPU dispose** — component 8 (tier 2).
- **Loading policy** (range fetch, background warm, remote→local switch,
  CORS/Range fallback) — component 6, hidden behind `AssetProvider`.

---

## 6. Next steps

1. Review this contract with the team / product owner. No deviations from §2.2
   remain; the only judgement call is **D9** (no `schemaVersion`) — a trade-off
   the spec is silent on, not a deviation.
2. Land the TypeScript interfaces as the first committed artifact of component 3
   (tour data model + store), with a hand-written sample `tour.json` fixture +
   `validateTour` unit tests.
3. Only then split component work — each component codes against these types.
