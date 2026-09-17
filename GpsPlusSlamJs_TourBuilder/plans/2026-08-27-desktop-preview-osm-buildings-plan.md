# 2026-08-27 — Desktop-preview OSM buildings (implementation plan)

## Context

Component 11's desktop preview (`components/desktop-preview/`) renders the
real AR viewing scene (component 8) inside a stand-in world — see
`preview-session.ts`'s `buildWorld()`. That world is currently deliberately
plain: a sky dome, a flat green `CircleGeometry`, a `GridHelper`, fog. It
reads as "outdoors" but not as the tour's actual place, and an author
previewing a tour sees an empty field instead of the street their waypoints
sit on.

`gps-plus-slam-osm` (sibling workspace package, Apache-2.0, part of this same
fork) already extrudes real OSM building volumes from Overpass data
(`mesh/buildings.ts`). `GpsPlusSlamJs_OsmDemo` proves the concept at full
scale — live terrain, incremental tile loading as the user walks, a worker —
but that machinery is built for an unbounded walking session and is far more
than a bounded desktop preview needs.

**Scope, decided in conversation:**

- **Desktop preview only.** The real AR viewing scene (`ar-scene`,
  phone/WebXR) is untouched — it must stay usable with no network beyond the
  tour package itself (packaging/QR goal, TASK.md). Desktop preview already
  runs online in a normal browser tab, so a live Overpass call at session
  start is in scope there and only there.
- **One-shot, not incremental.** The preview's area is small and fixed (one
  tour, one origin) — no walking-triggered re-fetch, no terrain lattice, no
  worker. Fetch once around the tour's origin when the preview session
  starts.
- **Buildings sit on the flat plane, v1.** No elevation/DEM integration.
  `buildBuildings`'s `groundHeightM` defaults to 0 everywhere when omitted —
  exactly what "flat plane" needs, no extra code.
- **`OSM_ATTRIBUTION` kept simple.** `gps-plus-slam-osm` exports the constant
  `OSM_ATTRIBUTION = "© OpenStreetMap contributors"`
  (`source/osm-data-source.ts`). Render that literal string as a small,
  always-on credit line whenever the building layer is active — no per-tile
  or per-source dynamic attribution logic.

---

## What gets reused from `gps-plus-slam-osm`

| Piece | Role |
|---|---|
| `OverpassSource` | Overpass HTTP client — retries, backoff, endpoint rotation, rate-limit handling. Requires `userAgent`. |
| `ensureAreaLoaded(source, centre, radiusMetres, options)` | One-shot "download this area" — the prefetch policy (rate limit throws, not deferred). Returns `{ loaded, deferred, failed }`, each `OsmTileResult.features: OsmFeature[]`. |
| `enuFrameAt(origin)` | WGS84 → local ENU metres frame, anchored at the tour origin. |
| `buildBuildings(features, { frame })` | OSM building/`building:part` features → `BuildingVolume[]`, each carrying a `THREE.Mesh` (heights honoured, flat ground by default). |
| `OSM_ATTRIBUTION` | The literal credit string. |
| `FixtureSource` | A canned `OsmDataSource` over a captured fixture — used for deterministic unit tests, no network. |

Not reused: `CachingSource`/OPFS persistence, `DemoPipeline` (rule-table /
affordance scoring — irrelevant, we only want building footprints), the
terrain lattice / elevation package, the worker, H3-based incremental tiling
beyond what `ensureAreaLoaded` already does internally.

---

## New dependencies

`GpsPlusSlamJs_TourBuilder/package.json` `dependencies`:

```jsonc
"gps-plus-slam-osm": "workspace:*",
"h3-js": "^4.4.0"   // hard runtime dep of gps-plus-slam-osm's area-loader (tile indexing)
```

Both are imported **only** from `components/desktop-preview/view/`, so they
land in the desktop-preview Vite chunk/demo entry, not in `ar-scene`'s. This
is enforced the same way the existing per-directory boundary rules are (`dependency-cruiser`
config) — add a rule forbidding `components/ar-scene/**` and `app/viewing/**`
(the live/phone path) from importing `gps-plus-slam-osm` or `h3-js`, so a
future import mistake fails the gate instead of silently growing the phone
bundle.

---

## Design

New module, following the existing `core/` (pure) vs `view/` (Three.js/DOM,
network) split:

```
components/desktop-preview/
  view/osm-building-layer.ts       # new — fetch + build + own the Group
  view/osm-building-layer.test.ts  # new — FixtureSource, no network
  view/preview-session.ts          # edited — wires the layer in
  view/preview-session.test.ts     # edited — injects a fake layer
```

### `view/osm-building-layer.ts`

```ts
export interface OsmBuildingLayerOptions {
  readonly origin: { readonly lat: number; readonly lon: number };
  readonly radiusM?: number;       // default: 300 (DEFAULT_OSM_BUILDING_RADIUS_M)
  readonly signal?: AbortSignal;   // caller-owned timeout / dispose-cancel
  readonly source?: OsmDataSource; // test seam — defaults to a real OverpassSource
}

export interface OsmBuildingLayer {
  readonly group: THREE.Group;     // empty until load() resolves; caller adds it to the scene immediately
  load(): Promise<void>;           // never rejects — degrades to an empty group on any failure/timeout
  dispose(): void;                 // disposes geometries/materials, clears the group
}

export function createOsmBuildingLayer(options: OsmBuildingLayerOptions): OsmBuildingLayer;
```

- `load()` calls `ensureAreaLoaded(source, origin, radiusM, { signal })`,
  flattens every returned tile's `features`, runs `buildBuildings(features, {
  frame: enuFrameAt(origin) })`, adds each volume's `mesh` to `group`.
- **Fails soft, always.** A thrown `RateLimitedError`, a network error, an
  abort, or simply zero buildings in the area all land on the same path: log
  once to console, leave `group` empty. The known operational reality
  (`overpass-source.ts.md`: public instances measured 75–130 s, frequent
  504s) means "no buildings" is a normal outcome, not an edge case — the flat
  plane is always an acceptable fallback, which is the whole reason a
  fallback isn't optional here.
- Caller (`preview-session.ts`) is responsible for the timeout: build an
  `AbortController`, pass its `signal`, and abort after N seconds so a slow
  Overpass instance never blocks the preview from being walkable (the
  session must render and be controllable immediately — the buildings pop in
  later, or don't).

### `view/preview-session.ts` changes

- `buildWorld()` unchanged (still builds the fallback flat ground/sky/fog —
  the layer supplements it, never replaces it).
- After `buildWorld()`: construct the layer with `options.origin`, add
  `layer.group` to `scene` immediately (empty), call `layer.load()`
  fire-and-forget.
- `dispose()`: call `layer.dispose()` alongside the existing cleanup.
- New `PreviewSessionOptions` field: `osmBuildings?: OsmBuildingLayer` (test
  seam, mirrors the existing `createRenderer`/`controls` injection pattern —
  `preview-session.test.ts` already runs the whole session in jsdom with
  everything except WebGL injected; a fake layer with a synchronous `load()`
  keeps that property).
- Attribution: a small fixed `<div>` ("© OpenStreetMap contributors"),
  inserted once alongside the canvas, always visible while desktop preview is
  open (not conditioned on whether buildings actually loaded — simplest
  correct reading of the ODbL obligation, and matches "keep it simple").

---

## Consequences

- **Bundle**: `gps-plus-slam-osm` + `h3-js` only load in the desktop-preview
  chunk. `ar-scene`/live-AR/phone bundle is unaffected — enforced by a new
  dependency-cruiser rule, not just convention.
- **Network dependency, desktop-preview only.** Preview now requires
  internet access to show buildings (it already needed it for nothing before
  — this is new). No effect on the packaged/QR-loaded viewing app.
- **Overpass is slow and occasionally down** (documented operational
  reality in `gps-plus-slam-osm`). Expect buildings to sometimes not appear,
  or to pop in several seconds after the preview starts. This is accepted,
  not a bug to chase, given the fail-soft design — revisit only if it proves
  actually annoying in practice.
- **ODbL attribution is a legal obligation, not a nicety** — the credit line
  must ship whenever the layer is wired in, unconditionally.
- **No elevation in v1.** Buildings sit on a flat base (`groundHeightM`
  defaults to 0), matching the flat preview ground. On real terrain with
  relief this will look wrong (buildings floating/sunk) — acceptable now,
  revisit only if a preview site turns out to be hilly enough to notice.
- **No caching across sessions in v1.** Every preview session re-fetches
  Overpass from scratch (no OPFS/`CachingSource`). Fine for an authoring
  tool's traffic level; add caching later if repeated `pnpm dev` reloads
  during authoring turn out to be annoying or quota-costly.
- **`userAgent` is required and does not reach the server from a browser**
  (forbidden header) — set something identifying anyway, per the package's
  own convention (`"gps-plus-slam-osm-demo (github.com/cs-util-com)"` in
  `GpsPlusSlamJs_OsmDemo`), for the Node/dev-server path where it does apply.
- **TourBuilder stays outside the root test gate** (existing, deliberate —
  CLAUDE.md) — this change doesn't touch `scripts/test-timing/projects.mjs`
  or `build:site`.

---

## Decided parameters

1. **Radius: 300 m as a guarantee, not a fetch parameter (revised
   2026-08-28).** Originally implemented as `ensureAreaLoaded(origin, 300,
   …)`, but that always rounds any non-zero radius up to a full 1-ring
   (7-tile) disk (`tilesWithin`'s `Math.ceil`) — for a real origin this
   dispatched 7 sequential Overpass requests per preview session (measured
   86 s total), and repeated dev-server reloads tripped public Overpass's
   per-client rate limit (429s). Switched to fetching the single `FETCH_RES`
   (7) tile containing the origin directly (`loadTiles(source, [tile], …)`,
   `tile = latLngToCell(origin.lat, origin.lng, FETCH_RES)`), since that
   tile's ~1406 m edge already covers 300 m on every side with room to
   spare. Measured live: 1 request, 13.5 s, ~7x fewer requests for the same
   effective coverage — the 300 m figure now documents the guaranteed floor,
   not something threaded through to the fetch call.
2. **Timeout: 120 s (revised from the original 20 s, 2026-08-28).** The
   original 20 s figure was based on `overpass-source.ts.md`'s single-tile
   worst case, but a 300 m radius spans multiple fetch tiles (7, for a real
   origin) that `area-loader.ts`'s `loadTiles` fetches SEQUENTIALLY by
   design — so the real latency is per-tile time × tile count, not one
   tile's. Measured live (Munich, 300 m, 2026-08-28): 7/7 tiles succeeded,
   zero retries, zero rate-limiting, in 86 s total. A 20 s timeout aborted
   every real load before completion, which is what "buildings never
   appear" actually was in practice — not the accepted "sometimes times
   out" tradeoff this was meant to be. 120 s comfortably covers the 86 s
   measurement with headroom; a walkable preview still starts immediately
   either way (buildings pop in later, or don't) — only the odds of them
   appearing at all changes. `OverpassSource` calls are free (no billing,
   no API key) but run on shared, rate-limited, volunteer infrastructure
   with no SLA.
3. **No demo/fixture split.** There is no dedicated demo page for this
   feature and no fixture-vs-live branching in the shipped code — **every**
   desktop preview, whether opened from a real shared tour link or the
   component's own dev entry, uses live `OverpassSource` with the same 300 m
   / 20 s / fail-soft behaviour. `FixtureSource` appears only inside
   `osm-building-layer.test.ts` as the deterministic no-network test double —
   it is not a runtime code path.

---

## Verification

1. `cd GpsPlusSlamJs_TourBuilder && pnpm exec vitest run src/components/desktop-preview` —
   `osm-building-layer.test.ts` (against `FixtureSource`: buildings appear in
   the group; a thrown/aborted load leaves the group empty and does not
   reject) and the edited `preview-session.test.ts` (layer wired in via the
   injection seam, disposed on session `dispose()`).
2. `pnpm test` (TourBuilder's own full gate — format/lint/jscpd/cycles/
   boundaries/deadcode/typecheck/unit) green, including the new
   dependency-cruiser boundary rule.
3. Manual: `pnpm run dev` → desktop-preview demo pointed at a real
   coordinate with known OSM building coverage → buildings appear on the
   flat ground within the timeout, attribution line visible, and pulling the
   network (devtools offline) still leaves a walkable flat-ground preview
   with no error surfaced to the user.

---

## Deliverable ordering

1. `feat(tourbuilder): add osm building layer for desktop preview` —
   `osm-building-layer.ts` + test (FixtureSource-based), `package.json`
   deps, dependency-cruiser boundary rule.
2. `feat(tourbuilder): render osm buildings + attribution in desktop preview` —
   wire into `preview-session.ts`, attribution element, updated
   `preview-session.test.ts`, README update (`components/desktop-preview/README.md`
   module table).

Both land on `explore/osm-scene-integration` (this branch, based on
`feat/preview-improvement`) as an experiment — not yet aimed at an upstream
PR, unlike the framework-extraction plans.
