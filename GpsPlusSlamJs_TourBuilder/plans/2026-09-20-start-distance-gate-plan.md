# 2026-09-20 — Start-distance gate on the entry screen (plan)

## Context

The demo tour is a real route at a real place. A visitor with an AR-capable
phone who opens the demo link from anywhere else gets a dead experience: real
GPS puts them kilometers from every waypoint, so nothing ever leaves `IDLE`
(proximity is world-space, D17) and the visitor concludes the app is broken.

The desktop preview (component 11) already runs the _same_ scene on a pinned
frame, and `&preview=1` already offers it on AR phones. What is missing is the
**decision point**: nothing tells a far-away visitor that preview is the right
mode, and nothing stops them entering AR at home.

This plan adds that decision to the AR entry screen — no new mode, no new
component. The visitor ends up in exactly one of the two existing modes:

| Distance visitor → tour start | Entry screen                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------- |
| under 50 m                    | Unchanged: **Enter AR**, no notice                                              |
| 50–300 m                      | "The start of this tour is 140 m away." **Enter AR** and **Preview here**       |
| over 300 m                    | "You're far from the start of this tour." **Preview here** only — AR is removed |
| unknown (see SG4)             | Unchanged: both offered, no notice                                              |

Preview is the existing desktop-preview session: W A S D + drag-to-look on a
keyboard, Auto-walk from the HUD (touch-primary phones already default into
the autopilot via `isTouchPrimaryDevice`, `viewing-app.ts`).

Applies to **every** tour opened through `?tour=`, not only the landing-page
demo: anyone opening any tour link from home has the same problem, and it is the
same code. The landing page and `DEMO_TOUR_URL` are untouched.

**Out of scope**, all deliberately rejected or deferred:

- _Rebasing_ the tour onto the visitor's position ("bring the tour to me"), a
  fake-GPS source, a QR-anchored or tabletop demo — more modes than the two we
  have. Revisit only if preview proves too weak a demo.
- A recorded demo video on the landing page — independent of this change.
- An `&ar=1` override that keeps AR available when far. The confidence rules
  (SG4) make it unnecessary; add it only if a real visitor is ever wrongly
  locked out.
- Re-evaluating distance while the entry screen stays open (see SG7).

---

## Reuse — what's already built and must not be reinvented

| Need                                                           | Reused from                                                                                                                    | Why not reinvent                                                                                                                                                                                                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| lat/lon → metres                                               | `calcRelativeCoordsInMeters` from `gps-plus-slam-app-framework/core`, already imported by `ar-seams.ts` and `preview-frame.ts` | CLAUDE.md: no haversine anywhere. `app/viewing/` is a place where the single geo step already lives (`ar-seams.ts`); this check is the same kind of one-off geo→metres conversion, and takes the horizontal X/Z hypot (D17), not a 3D distance.       |
| "where does the tour start"                                    | `computePreviewStart` in `desktop-preview/core/preview-start.ts` — trailhead (`breadcrumb[0]`), else the first waypoint        | The preview already starts the visitor there. Gate and preview must agree on "the start", or "Preview here" would begin somewhere other than the point the notice measured. Extract the existing `trailhead ?? firstStop` rule, do not copy it (SG2). |
| Showing/hiding the preview entry and AR-status feedback        | `TourEntryScreen.setPreviewOffered` / `setEnterArEnabled` / `setArStatus` in `screens.ts`                                      | The entry screen is already the single place that reflects device capability. Distance is one more input to the same function, not a second UI.                                                                                                       |
| Permission state, so a fix can be read without a second prompt | The onboarding gate (`mountGate`) — geolocation permission is granted before `mountEntry` runs                                 | The landing page needs no permissions and cannot do this check; the entry screen, after the gate, can.                                                                                                                                                |
| Dependency injection for anything touching the browser         | `ViewingAppDeps` in `viewing-app.ts`                                                                                           | Same seam every other browser-facing dependency uses; keeps `viewing-app.test.ts` in jsdom with no real geolocation.                                                                                                                                  |

**Deliberately not reused:** the framework's `startGpsWatch` (`sensors/gps.ts`).
It is a module-level singleton that clears any existing watch on every call, so
a distance check using it would fight whoever starts the real GPS watch when AR
begins. The distance check uses its own `navigator.geolocation.watchPosition`
handle and clears it when done.

---

## Decisions

| #    | Decision                                                                                                                                                                                                                                                                                                                                          | Rationale                                                                                                                                                                                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SG1  | **Two tiers plus unknown**: `NEAR_M = 50`, `FAR_M = 300`. Constants, tunable. Under `NEAR_M` → unchanged; over `FAR_M` → AR removed; in between → both offered with a distance notice.                                                                                                                                                            | Agreed with the user in the 2026-09-20 session. 300 m is far enough above GPS noise that a real on-site visitor never lands there; 50 m keeps the notice from nagging someone already at the trailhead.                                                                                    |
| SG2  | **"Start" = `trailhead ?? firstWaypoint`**, exported as `tourStartCoord(tour)` from `preview-start.ts` and used by both `computePreviewStart` and the gate. Refactor lands as its own `refactor` commit, before the feature.                                                                                                                      | One definition of the start. Prevents the gate and the preview drifting apart; CLAUDE.md asks for refactors in a separate commit from behaviour changes.                                                                                                                                   |
| SG3  | **Distance = horizontal hypot of the NUE north/east components** from `calcRelativeCoordsInMeters(fix, start, 0, 0)`. Altitude is never read.                                                                                                                                                                                                     | D17: altitude is the noisiest GPS axis. Pure, no Three.js, no DOM.                                                                                                                                                                                                                         |
| SG4  | **"Far" needs only a lower bound; everything else needs a decent fix.** Far when `distance − accuracy > FAR_M`. Otherwise, if `accuracy > MAX_TRUSTED_ACCURACY_M` (50 m) → **unknown**. Otherwise near (`distance < NEAR_M`) or mid.                                                                                                              | **Adjusts the "accuracy cutoff 50 m" rule agreed in chat.** A flat "accuracy > 50 → unknown" would leave a visitor indoors at home (Wi-Fi fix, ±80 m, 4,000 km away) still offered AR. If even the best case is beyond 300 m the answer is certain, so accuracy only matters for near/mid. |
| SG5  | **AR is removed only on a confident far reading; a missing fix never removes it.** No fix within the timeout, an error, or no `navigator.geolocation` → unknown → today's behaviour.                                                                                                                                                              | A cold-start city fix can be off by hundreds of metres. Locking a genuine on-site visitor out of AR is the worst failure this feature can cause; wrongly _offering_ AR to a far visitor costs them one tap and is what happens today.                                                      |
| SG6  | **Settle early, cap the wait.** While locating: banner "Checking how far you are from the start…", Enter AR disabled (the same treatment as the existing "Checking AR support…"). Resolve on the first _decisive_ fix (far-proven, or accuracy ≤ 50 m), else at `LOCATE_TIMEOUT_MS = 8000` with the best classification so far (usually unknown). | Outdoors with a warm fix the wait is under a second; the worst case is bounded, and it never blocks AR entry indefinitely.                                                                                                                                                                 |
| SG7  | **Decided once per entry-screen mount.** Leaving preview back to the entry screen re-runs the check (`mountEntry` runs again); walking toward the start while the screen stays open does not update it.                                                                                                                                           | A live-updating notice would flicker buttons under the visitor's thumb. The mid-tier visitor is walking with the map already.                                                                                                                                                              |
| SG8  | **Skip the check when the controller reports AR `unsupported`.** They only get preview anyway; no permission-dependent GPS read, no wait.                                                                                                                                                                                                         | Desktops keep today's instant entry screen.                                                                                                                                                                                                                                                |
| SG9  | **One label, "Preview here"**, replacing "Walk it on this screen" everywhere. When AR is removed the button becomes `primary`; otherwise it stays `secondary`.                                                                                                                                                                                    | The label appears only in `screens.ts` (no test or doc depends on it); one string, one meaning, for both the desktop and the far-away phone.                                                                                                                                               |
| SG10 | **Distance wording never depends on a huge number being exact.** `< 1000 m` → "140 m" (rounded to 10); `1–100 km` → "about 4 km"; `≥ 100 km` → "more than 100 km". The verdict (far) is what matters at that range.                                                                                                                               | An equirectangular-style conversion is trustworthy at hundreds of metres, not necessarily across continents or the ±180° meridian. The tests pin the verdict there, not the digits.                                                                                                        |

---

## Architecture

### `app/viewing/start-distance.ts` — pure (no DOM, no Three.js)

```ts
export const NEAR_M = 50;
export const FAR_M = 300;
export const MAX_TRUSTED_ACCURACY_M = 50;

export interface VisitorFix {
  readonly lat: number;
  readonly lon: number;
  readonly accuracy: number; // metres, as reported by the Geolocation API
}

export type StartProximity =
  | { readonly kind: "unknown" }
  | { readonly kind: "near" }
  | { readonly kind: "mid"; readonly distanceM: number }
  | { readonly kind: "far"; readonly distanceM: number };

/** Horizontal metres from the fix to the tour's start (SG3). */
export function distanceToStartM(fix: VisitorFix, start: TourCoord): number;

/** SG1 + SG4. Pure numbers in, verdict out. */
export function classifyStartDistance(
  distanceM: number,
  accuracyM: number,
): StartProximity;

/** SG6: worth stopping the wait for — far-proven, or accuracy good enough. */
export function isDecisive(fix: VisitorFix, start: TourCoord): boolean;

/** SG10. */
export function formatStartDistance(distanceM: number): string;

export interface EntryView {
  readonly arVisible: boolean;
  readonly arEnabled: boolean;
  readonly previewOffered: boolean;
  readonly message: {
    readonly text: string;
    readonly tone: "info" | "error";
  } | null;
}

/** The whole entry-screen policy in one testable place: controller status ×
 *  `&preview=1` × distance verdict → what the screen shows. */
export function deriveEntryView(input: {
  readonly controllerStatus: ControllerStatus; // the enable-GPS-AR controller's `status`
  readonly controllerError: string | null;
  readonly forcePreview: boolean;
  readonly proximity: StartProximity | "locating";
}): EntryView;
```

`deriveEntryView` replaces the body of `applyControllerState` so the existing
controller-status copy moves, unchanged, into a table-tested function instead
of being interleaved with a second input. Precedence: `far` beats a controller
`error` (AR is gone, so the AR error is moot); `unsupported` beats everything
(SG8); `locating` disables AR and shows the checking banner.

### `app/viewing/locate-visitor.ts` — thin browser adapter, injected

```ts
export interface LocateHandle {
  readonly result: Promise<VisitorFix | null>; // null = no usable fix in time
  cancel(): void; // clears the watch; safe to call twice
}
export function locateVisitor(opts: {
  timeoutMs: number;
  isDecisive: (fix: VisitorFix) => boolean;
}): LocateHandle;
```

Own `watchPosition` handle (see "Deliberately not reused"), `enableHighAccuracy:
true`, `maximumAge` small. Resolves with the first decisive fix, or the last fix
seen at the timeout, or `null` with no fix / error / no API. Always clears its
watch before resolving.

### Changes to existing files

- `desktop-preview/core/preview-start.ts` — export `tourStartCoord(tour)`;
  `computePreviewStart` calls it (SG2, own commit).
- `viewing/screens.ts` — add `setEnterArVisible(visible)` to `TourEntryScreen`
  (hides the button and promotes "Preview here" to `primary`); rename the preview
  label (SG9). `setPreviewOffered` and friends unchanged.
- `viewing/viewing-app.ts` — add `locateVisitor` to `ViewingAppDeps` (default:
  the real one); hold a `proximity` value and a `LocateHandle` for the current
  entry screen; `mountEntry` starts the locate (unless SG8), `clearScreen`/
  `destroy` cancels it; replace `applyControllerState` with one
  `applyEntryState(entry)` that calls `deriveEntryView` and drives the four
  screen setters.
- `viewing/README.md` — module table gets the two new files; the flow diagram
  and the paragraph on the desktop preview mention the distance decision.

---

## Testing

**Unit — `start-distance.test.ts`** (node-only; numbers and hand-picked coords):

- `classifyStartDistance` at the boundaries: 49.9 → near; 50 → mid; 300 → mid;
  300.1 with accuracy 0 → far.
- SG4: accuracy 51 at 100 m → unknown; accuracy 51 at 10 m → unknown, not near;
  accuracy 5,000 at 4,000 km → far (lower bound); accuracy 200 at 350 m → not
  far (lower bound 150) and unknown (accuracy > 50).
- `distanceToStartM`: a coordinate 100 m north and one 100 m east both ≈ 100 m;
  altitude on either side changes nothing; a pair straddling ±180° longitude and
  a transatlantic pair both classify as **far** (verdict only — SG10).
- `isDecisive`: far-proven with poor accuracy → true; accuracy ≤ 50 → true;
  neither → false.
- `formatStartDistance`: 140 → "140 m", 1,400 → "about 1 km", 4,200,000 → "more
  than 100 km".
- `deriveEntryView`: table over controller status × `forcePreview` × each
  proximity kind, including "far beats controller error", "unsupported skips
  everything", "locating disables AR".

**Unit — `locate-visitor.test.ts`** (fake `navigator.geolocation`): resolves on a
decisive fix and clears the watch; resolves with the last fix at the timeout;
`null` on error / no API / no fix; `cancel()` clears the watch and is
idempotent.

**Unit — `preview-start.test.ts`:** `tourStartCoord` is the trailhead when a
breadcrumb exists, else the first waypoint, else `undefined`; `computePreviewStart`
output is unchanged (regression).

**jsdom — `viewing-app.test.ts`** (injected `locateVisitor`): near → Enter AR
enabled, no banner, no preview button; mid → both buttons and the distance
banner; far → Enter AR hidden, "Preview here" primary; unknown → both buttons,
no banner; locating → Enter AR disabled, checking banner; `unsupported` never
calls `locateVisitor`; tapping "Preview here" enters the preview; returning from
preview re-runs the check; `destroy()` cancels an in-flight locate.

**Replay e2e — `viewing-replay.e2e.test.ts` (if the harness exposes recorded GPS
samples):** feed the first recorded fix as the visitor and assert `near` against
a tour built from that recording, and `far` against the same tour shifted to
another city. Skip, and say so in the README, if the harness only exposes
world-space poses — the gate is a lat/lon check, and inventing a GPS path for it
would be a mock, not a replay.

---

## Tooling notes

- Two new files in an existing, already-allowed directory (`app/viewing/`); no
  new dependency-cruiser rule, tsconfig `include`, or Vite entry. `app/` →
  `components/` is the allowed direction; nothing under `components/` imports the
  new files.
- `start-distance.ts` is pure and imports only `gps-plus-slam-app-framework/core`
  and store types, the same as `ar-seams.ts` does.
- TourBuilder is not in the root gate; run `pnpm test` from inside
  `GpsPlusSlamJs_TourBuilder/` (format + lint + typecheck + unit + `check:all`).

---

## Risks

- **Cold-start fix wrong by hundreds of metres.** Mitigated by SG4/SG5 — a fix
  must _prove_ far, and anything less leaves AR available.
- **8 s worst-case wait on a poor-GPS phone.** Enter AR is disabled while
  locating (SG6), so a visitor with a weak fix waits up to 8 s before either
  button appears. Bounded, and the banner says why. Tune `LOCATE_TIMEOUT_MS`
  after outdoor testing; if it feels slow, enable Enter AR during the wait and
  accept a late removal instead.
- **Preview on a phone is Auto-walk + drag-look, not a joystick.** Acceptable for
  a demo; a virtual joystick is a separate follow-up if testers want manual
  walking on phones.

---

## Next steps

1. Iterate this plan with an LLM as critical reviewer; commit meaningful
   revisions.
2. `refactor(tourbuilder)`: extract `tourStartCoord` (SG2), tests first.
3. `feat(tourbuilder)`: `start-distance.ts` + tests → `locate-visitor.ts` +
   tests → `screens.ts` → `viewing-app.ts` wiring + jsdom tests → README.
4. Manual check outdoors on a phone at three distances (on the start, ~150 m
   away, and from home), and once with location denied/slow.
5. Stop here. Any "bring the tour to me" mode, demo video or virtual joystick is
   a separate plan.
