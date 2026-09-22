# HUD icon buttons — spec / plan

Date: 2026-09-20
Package: `GpsPlusSlamJs_TourBuilder`
Status: implemented (see plans/2026-09-20-hud-icon-buttons-impl-plan.md)
Revision 2 (2026-09-20): after a UX review — Buildings keeps its four states (§2b), the map's open/closed state is wired up (§3), hints show one at a time (§3b), and the HUD's label setters become state setters (§5).

## Goal

Replace the text buttons in the in-session HUD (`components/shared/hud.ts`) with round icon buttons, on both the phone AR view and the desktop preview. Add a confirmation dialog before ending a tour.

## Scope

In scope: the HUD control bar only (Map, Auto-walk, Wayfinding, Buildings, End tour).

Out of scope: landing screen, viewing screens (Enter AR, Preview here, Restart tour), authoring panel, pack-and-share panel. Primary call-to-action buttons stay text buttons. These can reuse the icon-button helper in a later round.

## Decisions

- **One design for mobile and desktop.** Same DOM and CSS. Only the size differs: 48px under `@media (pointer: coarse)`, 40px otherwise. The HUD is already shared between the phone AR view and the desktop preview.
- **No drawer.** All five buttons stay visible in the existing horizontal bottom row. Five 48px circles plus gaps come to about 270px, which fits a 360px-wide phone.
- **Icons are inline SVG.** No icon library.
- **Labels are kept** as `aria-label` and `title` (desktop tooltip). Existing `data-testid` values stay on the same elements so current selectors keep working.
- **End tour uses a native `<dialog>`.** `window.confirm` is not used.
- **Buildings is a four-state control, not a toggle.** `OsmBuildingStatus` is `idle | loading | loaded | off | failed`, and the current text button says so (`viewing-app.ts`'s `osmBuildingsLabel`). An icon-only button must keep that distinction: a spinner ring while loading, an error tint when failed, and an `aria-label` that changes with the status. See §2b.
- **The `aria-label` carries the state; the `title` does not.** Toggles today have action labels (`Stop auto-walk` vs `Auto-walk`). Losing them would leave a sighted mouse user with no text cue at all, since `aria-pressed` only reaches assistive tech. So `aria-label` (and the `title` mirroring it) is updated on every state change, and reads as the action the tap performs.
- **One hint bubble at a time.** The row stays as it is and the bubbles keep their width; the Wayfinding hint waits for the Auto-walk hint to go away instead of sharing the screen with it. See §3b.
- **The HUD's label setters become state setters.** Free-text `setXLabel(string)` does not survive the move to icons — the HUD, not the caller, now owns the wording. See §5.

## Components

### 1. Icon button helper

Files: `components/shared/icon-button.ts`, `components/shared/icon-button.css`, plus a README entry.

Builds a round `<button type="button">` from an SVG string and a label.

Inputs:
- `icon`: inline SVG markup.
- `label`: used for `aria-label` and `title`.
- `pressed?`: when defined, the button is a toggle and gets `aria-pressed`. Omit it for plain actions.
- `variant?`: `"default"` or `"danger"` (red-tinted icon, used by End tour).

Exposes a way to set the pressed state after creation, and a way to set the label after creation (writing both `aria-label` and `title`, which stay identical).

It also exposes a `busy` flag and an `error` flag, used only by Buildings (§2b) but kept on the shared helper so the styling lives in one place:

- `busy`: adds a spinning ring around the circle and sets `aria-busy="true"`. The button stays clickable.
- `error`: adds a red-tinted ring and icon. Distinct from `variant: "danger"`, which is a permanent property of a destructive action (End tour) rather than a transient state.

### 2. Toggled vs untoggled state

Three cues, so color is never the only signal:

1. **Fill.** Off: dark surface (`#1b2338`), muted-grey icon, thin border. On: solid accent fill (`--primary`), white icon, brighter ring.
2. **Badge.** On shows a small dot in the top-right corner of the circle. This helps color-blind users and bright outdoor screens.
3. **Semantics.** `aria-pressed="true"` or `"false"`. The CSS keys off `[aria-pressed="true"]`, so the DOM state and the visual state cannot drift apart.

Toggles: Map, Auto-walk, Wayfinding. Buildings is a toggle with two extra transient states (§2b). End tour is a plain action with no pressed state.

The `aria-label` and the `title` (which are the same string) name the action the tap performs, and therefore change with state: `Show map` / `Hide map`, `Auto-walk` / `Stop auto-walk`, `Wayfinding` / `Stop wayfinding`. This preserves the wording the text buttons carry today, for both hover tooltips and screen readers.

### 2b. Buildings' four states

`OsmBuildingStatus` drives one icon button. The status→appearance mapping replaces `osmBuildingsLabel` in both `app/viewing/viewing-app.ts` and `components/desktop-preview/demo.ts` (which duplicates it today); the HUD owns it now, so the duplication goes away.

| Status | `aria-pressed` | Extra state | Label (`aria-label`/`title`) |
| --- | --- | --- | --- |
| `off` | `false` | — | `Show buildings` |
| `idle`, `loading` | `false` | `busy` (spinner ring, `aria-busy`) | `Loading buildings…` |
| `loaded` | `true` | — | `Hide buildings` |
| `failed` | `false` | `error` (red ring + icon) | `Buildings failed — tap to retry` |

The failure case is the one that icon-only styling would otherwise swallow: a plain grey circle gives the visitor no hint that buildings are missing because a fetch failed, nor that tapping retries. The red ring says something is wrong, and the label says what to do. Backstop: on the transition into `failed`, also push a one-shot `hud.showNotice("Buildings couldn't load. Tap the buildings button to retry.")`, because the ring alone is not readable at a glance outdoors.

`busy` does not disable the button — the current behavior lets the visitor toggle mid-load, and we keep it.

### 3. HUD changes

Files: `components/shared/hud.ts`, `components/shared/hud.css`.

- Swap the five text buttons for icon buttons. Keep the horizontal `.ar-hud-controls` row.
- Keep the `data-testid`s: `viewing-map-toggle`, `viewing-end-tour`, `viewing-autopilot`, `viewing-wayfinding`, `viewing-osm-buildings-toggle`.
- Keep the optional-button behavior: Auto-walk and Buildings are only mounted when their callbacks are configured.
- Keep the one-time hint bubbles for Auto-walk and Wayfinding, pointing at the icon buttons — but show them one at a time, see §3b.
- Sync `aria-pressed` with the existing toggle callbacks and state.
- **Wire the map's real open/closed state.** Today `setMapToggleLabel` is called nowhere outside tests: the Map button is static text and never reflects whether the map is open. An icon toggle that is always `aria-pressed="false"` while the map is open is worse than the text button it replaces, so the state has to be fed in. `viewing-app.ts` already tracks it in the `mapVisible` local (declared at `viewing-app.ts:272`), and every assignment becomes a push into the HUD:
  - `viewing-app.ts:603` — the `onToggleMap` callback itself.
  - `viewing-app.ts:435` and `viewing-app.ts:633` — the two places that open the map without going through the button (the pre-AR entry screen and the session shell mount).

  `components/desktop-preview/demo.ts:205` has its own `onToggleMap` and gets the same treatment. Do it by calling the new setter from one small helper that owns `mapVisible`, rather than adding a fourth ad-hoc assignment.
- The existing CSS selectors `.ar-hud-controls > button` and `.ar-hud-controls > .autopilot-wrap > button` are replaced by the `.icon-btn` styles. The hint's own `×` close button must not pick up the icon-button skin.

### 3b. One hint bubble at a time

Shrinking the buttons breaks the spacing hack the hints rely on today. `hud.ts` places Map and End tour *between* Auto-walk and Wayfinding on purpose, because both callouts show on mount and each is much wider than its own button. With text buttons there is roughly 233px between the two hinted buttons' centres; with 48px circles and 8px gaps there is about 168px, while each `white-space: nowrap` bubble is about 200px wide. The two bubbles would overlap by ~30px.

Fix: only one hint is on screen at a time, so bubble width stops mattering and nothing has to be narrowed or re-ordered.

- Auto-walk's hint shows on mount, exactly as today.
- Wayfinding's hint is queued. It shows when the Auto-walk hint goes away — by its close button, by its 8s timeout, or by `dismissAutopilotHint()` (which fires when the visitor uses Auto-walk). Its own 8s timeout starts then, not at mount.
- **When there is no Auto-walk button, the Wayfinding hint shows immediately.** Auto-walk is preview-only (`onToggleAutopilot` is not set in AR), so in the phone AR session there is nothing to queue behind and no reason to make the visitor wait 8s for the only hint they get.
- A hint that is dismissed before it was ever shown stays unshown. `dismissWayfindingHint()` already fires when the visitor toggles Wayfinding on; if that happens while the hint is still queued, the queue entry is dropped rather than popped later.
- Both hints are still one-time only: nothing re-shows after dismissal.

Implementation note: this is a small change to `mountHintedToggle` — it gains a "show now" vs "show when released" mode and returns the release hook, rather than starting its timer at mount unconditionally.

Consequence: the control order no longer needs the Map/End-tour spacer between the two toggles, and the comment in `hud.ts` explaining it must be updated, since the reason it gives is gone.

### 4. End tour confirm dialog

- Tapping End tour opens a `<dialog>` inside the HUD root: "End tour?", with Cancel and End buttons.
- Cancel is the default focus. Escape and a backdrop tap cancel.
- `onEndTour` fires only on End.
- **WebXR risk.** In DOM-overlay mode only elements inside the overlay root render, and top-layer rendering is not guaranteed. Mount the dialog inside the HUD root, open it with `show()` (not `showModal()`), and draw our own backdrop. Verify in the desktop preview. State plainly in the final report what could not be verified on a real phone.

### 5. HUD interface change

The four free-text label setters go away. They exist because the caller owned the wording; with icons the HUD owns it (§2, §2b), so passing a string in would let the caller write a label that contradicts the icon and the `aria-pressed` state. Replace them with state setters:

| Removed | Replacement |
| --- | --- |
| `setMapToggleLabel(label: string)` | `setMapActive(active: boolean)` |
| `setAutopilotLabel(label: string)` | `setAutopilotActive(active: boolean)` |
| `setWayfindingLabel(label: string)` | `setWayfindingActive(active: boolean)` |
| `setOsmBuildingsLabel(label: string)` | `setOsmBuildingsStatus(status: OsmBuildingStatus)` |

Each keeps the no-op-when-the-button-was-not-mounted behavior the label setters have today.

Call sites to migrate: `app/viewing/viewing-app.ts:618, 701, 734` and `components/desktop-preview/demo.ts:217, 229, 236, 238`, plus the new map wiring above. `osmBuildingsLabel` is deleted from both files.

This matters for the gate as well as for design: leaving the label setters in place unused would fail `knip`.

## Testing (TDD, red then green)

Unit tests, written first:
- icon-button: label to `aria-label` and `title`; the label setter updates both; `aria-pressed` present only for toggles; pressed setter updates the attribute; danger variant class; `busy` sets `aria-busy` and keeps the button enabled; `error` sets its class.
- hud: each button keeps its `data-testid`; `aria-pressed` follows the toggle state; the labels flip with state (`Show map` ↔ `Hide map`, and the two `Stop …` variants); optional buttons are absent when their callbacks are not set; hint close button is not styled as an icon button.
- Buildings status: each of the five `OsmBuildingStatus` values maps to the `aria-pressed` / `busy` / `error` / label row in §2b; `failed` also raises the notice.
- Map state: `setMapActive(true/false)` flips `aria-pressed`, and the button opens the session already pressed when the map was opened before the HUD mounted.
- Hint sequencing (§3b), with fake timers: only the Auto-walk hint is visible on mount; the Wayfinding hint appears after the first one's close click, after its 8s timeout, and after `dismissAutopilotHint()`; its own timeout is measured from when it appeared, not from mount; with no `onToggleAutopilot` the Wayfinding hint is visible on mount; `dismissWayfindingHint()` while queued means it never appears; neither hint re-appears after being dismissed.
- End tour dialog: click opens it; Cancel closes without calling `onEndTour`; End calls `onEndTour` once and closes; Escape cancels; Cancel is focused on open.

Existing tests to update: `components/shared/hud.test.ts` (the label-setter tests at lines 68, 186, 237 now assert state setters), and the End-tour clicks that now need a confirm click — `app/viewing/viewing-app.test.ts:587, 804, 995` and `hud.test.ts:63`. No Playwright e2e touches `viewing-end-tour`.

Gate: run `pnpm test` inside `GpsPlusSlamJs_TourBuilder/` (format, lint, typecheck, unit, `check:all`).

## Docs

Update the HUD entries in the relevant per-directory READMEs (per ADR 0001): `components/shared/` and `app/viewing/`. Document the icon-button API and the toggle-state contract.

## Commits

Conventional Commits, one per logical step, for example:
1. `feat(tourbuilder): add shared round icon-button`
2. `refactor(tourbuilder): HUD owns toggle wording via state setters`
3. `feat(tourbuilder): report map open/closed state to the HUD`
4. `feat(tourbuilder): use icon buttons in the HUD`
5. `feat(tourbuilder): confirm dialog before ending a tour`

Step 2 is a pure refactor (the text buttons still render, the HUD just derives their text), so it lands separately from the behavior change in step 4, per the repo's refactor/behavior split.

## Open items

- Icon choices for each button (map, walk, compass or route, buildings, exit). Pick simple 24px stroke icons during implementation.
- Whether the landing and authoring screens adopt the helper is a later round.
- Control order is now free (§3b removed the spacing constraint). Worth considering putting End tour at one end of the bar with a wider gap, so the destructive control is not tap-adjacent to four same-size toggles — but that is a separate call, not part of this round unless decided.

## Known risks, not yet designed

Raised in review, deliberately left for the implementation round rather than settled here:

- **A non-modal `<dialog>` gives no Escape and no light dismiss.** §4 chooses `show()` over `showModal()` for WebXR DOM-overlay reasons, but that means the Escape key, the backdrop tap, and the focus trap promised there are all ours to implement.
- **`hud.css` is stale.** It still styles `.autopilot-wrap` / `.autopilot-hint*`, while `hud.ts` emits `.hud-hint-wrap` / `.hud-hint*` and `app/app.css:622+` styles those. So `components/desktop-preview/index.html`, which links `hud.css` and not `app.css`, currently renders Auto-walk, Wayfinding and the hint bubble unstyled. Since this round rewrites exactly those selectors, fix it here — otherwise the icon buttons appear in the app and not in the demo that is supposed to demonstrate them.
