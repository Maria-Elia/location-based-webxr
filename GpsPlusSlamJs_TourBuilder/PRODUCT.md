# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Real-world visitors on a phone browser, outdoors, at or near a physical
location (a museum grounds, a campus, a city district). Two roles:

- **Tour visitors** — walk the physical route wearing/holding a phone,
  expect a location-triggered AR audio-guide experience (billboards,
  spoken narration, in-world text) as they approach each stop.
- **Tour creators/authors** — walk the same physical route once to place
  waypoints, attach media (model/picture/audio/transcript) per stop, then
  export and share the tour (zip/link/QR) for others to visit.

## Product Purpose

A location-based AR audio tour-guide: content is anchored to real GPS
positions and only appears in AR when the visitor's phone is physically at
that spot. Success = a visitor completing a route and experiencing every
waypoint's content in the right place, and a creator producing a shareable
tour without writing code.

## Positioning

Content is proximity-gated to real-world position via GPS+IMU sensor
fusion (`gps-plus-slam-js`), not a generic map-pin app — the AR content
literally will not appear until the visitor's body is at the anchored
spot. Authoring happens by physically walking the route, not by dragging
pins on a desktop map.

## Operating Context

- Outdoor, phone-in-hand, natural light, walking — not a desk/mouse
  context.
- Two app modes chosen once at bootstrap by URL (`?tour=` present →
  Viewing; absent → Authoring), see `src/app/mode.ts`.
- A tour is packaged as a self-contained zip (`tour.json` + assets) and
  distributed via a share link or QR code.
- Existing entry point mounts straight into the onboarding
  permission gate / authoring tools with no landing screen first (being
  added now).

## Capabilities and Constraints

- Viewing a tour currently requires a `?tour=<url-or-code>` link/QR — no
  in-app browsing/discovery of tours exists.
- A "view a demo tour" entry already exists as a chip inside the
  Authoring screen, linking to one real hosted demo tour
  (`authoring-app.ts`'s `DEMO_TOUR_URL`).
- Camera + geolocation (+ audio) permissions are requested via the
  existing onboarding gate; a landing page precedes that gate and itself
  needs neither permission.
- Mobile-first; must hold up down to a 320px-wide phone viewport (existing
  fluid-token system in `app.css`).

## Brand Commitments

No fixed product name/logo beyond the npm package name
(`gps-plus-slam-tour-builder`) — no confirmed public-facing brand name yet.
Existing dark UI (`--bg: #10131a`, `--accent: #9ec1ff`) is the incumbent
visual system (see `src/app/app.css`).

## Evidence on Hand

One real hosted demo tour (OneDrive-shared zip, linked as `DEMO_TOUR_URL`
in `authoring-app.ts`). No testimonials, press, or case studies — none
should be fabricated.

## Product Principles

- Physical presence is the gate: never fake or shortcut the
  walk-to-unlock mechanic in copy or flow.
- Creators are also visitors: authoring and viewing share one visual
  language, not two products bolted together.
- Sharing is a link/QR, not an account — no login, no app-store install.
- Every screen must survive a 320px phone in bright outdoor light
  (contrast, tap targets ≥44px already established).

## Accessibility & Inclusion

No product-specific requirement established beyond the existing
44px min tap-target / focus-visible outline conventions already in
`app.css`.
