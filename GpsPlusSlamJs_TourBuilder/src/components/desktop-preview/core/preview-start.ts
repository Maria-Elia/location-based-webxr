/**
 * Where a preview of a given tour should begin.
 *
 * The AR session gets this for free — the visitor is standing somewhere real.
 * A preview has to choose, and the choice decides whether the preview is
 * usable at all: start on top of the first stop and the whole tour activates
 * (and is marked visited) in the first second; start facing the wrong way and
 * the visitor sees an empty field and concludes the tour is broken.
 *
 * So: begin where the author began walking when the tour has a breadcrumb, and
 * otherwise stand back from the first stop — outside its active radius, inside
 * sight of it — looking straight at it.
 */

import type { Tour, TourCoord } from "../../../store/types.js";
import { createPreviewFrame } from "./preview-frame.js";
import type { WalkPose } from "./walk-simulator.js";

/** How far back to stand from the first stop when there is no breadcrumb. */
const STAND_BACK_M = 18;

export interface PreviewStart {
  /** The GPS zero reference the preview world is pinned to. */
  readonly origin: { readonly lat: number; readonly lon: number };
  /** The walker's opening pose, in the preview's world metres. */
  readonly start: WalkPose;
  /** The breadcrumb the autopilot walks. Empty when the tour has none. */
  readonly route: readonly TourCoord[];
}

/**
 * Where the tour starts: the author's trailhead when there is a breadcrumb,
 * otherwise the first stop. The preview starts here, and the viewing entry
 * screen measures the visitor's distance to it — one definition for both.
 */
export function tourStartCoord(tour: Tour): TourCoord | undefined {
  return tour.breadcrumb[0] ?? tour.waypoints[0]?.position;
}

export function computePreviewStart(tour: Tour): PreviewStart {
  const trailhead = tour.breadcrumb[0];
  const firstStop = tour.waypoints[0]?.position;

  if (trailhead === undefined && firstStop === undefined) {
    return {
      origin: { lat: 0, lon: 0 },
      start: { x: 0, z: 0, headingRad: 0 },
      route: [],
    };
  }

  const anchorCoord = tourStartCoord(tour)!;
  const origin = { lat: anchorCoord.lat, lon: anchorCoord.lon };
  const frame = createPreviewFrame(origin);

  if (firstStop === undefined) {
    return {
      origin,
      start: { x: 0, z: 0, headingRad: 0 },
      route: tour.breadcrumb,
    };
  }

  const target = frame.toWorld(firstStop);

  if (trailhead !== undefined) {
    // Standing at the trailhead, turned toward the first stop.
    return {
      origin,
      start: { x: 0, z: 0, headingRad: Math.atan2(target.z, target.x) },
      route: tour.breadcrumb,
    };
  }

  // No breadcrumb: the origin IS the first stop, so back off due south of it
  // and look north — any direction would do, and north keeps it predictable.
  return {
    origin,
    start: { x: target.x - STAND_BACK_M, z: target.z, headingRad: 0 },
    route: [],
  };
}
