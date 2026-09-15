# src/app/landing — root-URL entry screen

Mounted by `main.ts` whenever `resolveAppMode` resolves to Authoring (no
`?tour=`, contract D13) — the screen shown before that decision used to
jump straight into the onboarding gate. A real tour visitor almost never
sees this: they arrive already carrying `?tour=` from a shared link or QR,
which routes straight to Viewing mode. This screen is for whoever lands on
the bare root URL instead.

## `landing-screen.ts`

```ts
mountLandingScreen(root: HTMLElement, deps?: { navigate?(url: string): void }): { destroy(): void }
```

Three real entry points plus one dev escape hatch:

| Action                    | What it does                                                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Create your own tour**   | The primary action (only reason to land here). Swaps into the existing `mountAuthoringApp` flow (onboarding gate → tools → export). |
| **I have a tour link**     | Fallback for a `?tour=` link that reached someone as plain text (a screenshot, a printed sign) instead of a live hyperlink/QR — expands a paste field. Accepts either a full share link (its own `?tour=`, followed unchanged) or a raw hosted `tour.zip` URL, wrapped via the same `prepareHostedZipUrl`/`buildTourUrl` pair the author's own share panel uses (`pack-and-share-panel.ts`). |
| **View a demo tour**       | The same secondary chip (`.demo-tour-chip`) this project already established for this exact purpose — moved here from `authoring-app.ts`, which used to render it directly. |
| **View separate components** | Dev/instructor-only. Plain, visually quiet link to the root component gallery (`index.html`, one level above `src/app/`) that lists every component's own standalone demo. Never a visitor path. |

`navigate` defaults to a real `location.href` assignment; injectable so
tests can assert on the computed URL instead of navigating jsdom.

## Tests

`landing-screen.test.ts` (`@vitest-environment jsdom`) — every rendered
entry point, the link form's reveal/collapse and both its accepted paste
shapes (full share link vs. raw hosted URL) plus its rejection path, and
the real swap into `mountAuthoringApp` (mocked framework permission
functions only, same as `authoring/authoring-app.test.ts`).
