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
 * breadcrumb (see plans/2026-09-17-breadcrumb-wayfinding-implementation-plan.md,
 * Task 4).
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
    getTargets: () => {
      if (currentIndex === null) return [];
      // The anchor may have moved `marker` since the last render tick (real
      // AR mode updates it via the alignment lerp loop, which runs before
      // this, but nothing guarantees that ordering in every host) — force
      // the world matrix current rather than reading a stale one.
      marker.updateWorldMatrix(true, false);
      return [
        {
          id: `bc-${currentIndex}`,
          position: marker.getWorldPosition(new Vector3()),
        },
      ];
    },
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
