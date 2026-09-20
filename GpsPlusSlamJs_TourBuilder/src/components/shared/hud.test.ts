/**
 * `mountHud` DOM wiring tests.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { mountHud } from "./hud.js";

function query(root: HTMLElement, testid: string): HTMLElement | null {
  return root.querySelector(`[data-testid="${testid}"]`);
}

describe("mountHud", () => {
  let container: HTMLElement;

  afterEach(() => {
    container.remove();
  });

  function setup(
    withAutopilot = true,
    options: {
      withOsmBuildings?: boolean;
      withMap?: boolean;
      withEndTour?: boolean;
    } = {},
  ) {
    const { withOsmBuildings, withMap = true, withEndTour = true } = options;
    container = document.createElement("div");
    document.body.append(container);
    const onToggleMap = vi.fn();
    const onEndTour = vi.fn();
    const onToggleAutopilot = vi.fn();
    const onToggleOsmBuildings = vi.fn();
    const onToggleWayfinding = vi.fn();
    const hud = mountHud(container, {
      ...(withMap ? { onToggleMap } : {}),
      ...(withEndTour ? { onEndTour } : {}),
      ...(withAutopilot ? { onToggleAutopilot } : {}),
      ...(withOsmBuildings ? { onToggleOsmBuildings } : {}),
      onToggleWayfinding,
    });
    return {
      hud,
      onToggleMap,
      onEndTour,
      onToggleAutopilot,
      onToggleOsmBuildings,
      onToggleWayfinding,
    };
  }

  it("renders no map/end-tour buttons when their handlers are omitted", () => {
    setup(true, { withMap: false, withEndTour: false });
    expect(query(container, "viewing-map-toggle")).toBeNull();
    expect(query(container, "viewing-end-tour")).toBeNull();
  });

  it("clicking Map/End tour calls their handlers when given", () => {
    const { onToggleMap, onEndTour } = setup();
    query(container, "viewing-map-toggle")!.click();
    query(container, "viewing-end-tour")!.click();
    expect(onToggleMap).toHaveBeenCalledOnce();
    expect(onEndTour).toHaveBeenCalledOnce();
  });

  it("setMapActive is a harmless no-op without a map toggle", () => {
    const { hud } = setup(true, { withMap: false });
    expect(() => hud.setMapActive(true)).not.toThrow();
    expect(query(container, "viewing-map-toggle")).toBeNull();
  });

  it("renders no autopilot button or hint when onToggleAutopilot is omitted", () => {
    setup(false);
    expect(query(container, "viewing-autopilot")).toBeNull();
    expect(query(container, "viewing-autopilot-hint")).toBeNull();
  });

  it("shows the Auto-walk hint on mount, visible (not hidden)", () => {
    setup();
    const hint = query(container, "viewing-autopilot-hint")!;
    expect(hint).not.toBeNull();
    expect(hint.hidden).toBe(false);
  });

  it("the hint's own × button dismisses it", () => {
    setup();
    const hint = query(container, "viewing-autopilot-hint")!;
    const close = hint.querySelector<HTMLButtonElement>(".hud-hint-close")!;

    close.click();

    expect(hint.hidden).toBe(true);
  });

  it("dismissAutopilotHint() hides the hint (the toggle button's own click path)", () => {
    const { hud } = setup();
    const hint = query(container, "viewing-autopilot-hint")!;

    hud.dismissAutopilotHint();

    expect(hint.hidden).toBe(true);
  });

  it("dismissAutopilotHint() is a harmless no-op when there is no autopilot toggle", () => {
    const { hud } = setup(false);
    expect(() => hud.dismissAutopilotHint()).not.toThrow();
  });

  it("clicking Auto-walk calls onToggleAutopilot", () => {
    const { onToggleAutopilot } = setup();
    query(container, "viewing-autopilot")!.click();
    expect(onToggleAutopilot).toHaveBeenCalledOnce();
  });

  it("the hint auto-dismisses after its timeout, and destroy() cancels a still-pending timer", () => {
    vi.useFakeTimers();
    try {
      const { hud } = setup();
      const hint = query(container, "viewing-autopilot-hint")!;

      vi.advanceTimersByTime(7999);
      expect(hint.hidden).toBe(false);
      vi.advanceTimersByTime(1);
      expect(hint.hidden).toBe(true);

      // A second setup, destroyed before its timer fires: must not throw
      // when that timer's callback would otherwise later touch a removed
      // element.
      const { hud: hud2 } = setup();
      hud2.destroy();
      expect(() => vi.advanceTimersByTime(10000)).not.toThrow();
      void hud;
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the Wayfinding hint on mount, visible (not hidden)", () => {
    setup();
    const hint = query(container, "viewing-wayfinding-hint")!;
    expect(hint).not.toBeNull();
    expect(hint.hidden).toBe(false);
  });

  it("the Wayfinding hint's own × button dismisses it", () => {
    setup();
    const hint = query(container, "viewing-wayfinding-hint")!;
    const close = hint.querySelector<HTMLButtonElement>(".hud-hint-close")!;

    close.click();

    expect(hint.hidden).toBe(true);
  });

  it("dismissWayfindingHint() hides the hint (the toggle button's own click path)", () => {
    const { hud } = setup();
    const hint = query(container, "viewing-wayfinding-hint")!;

    hud.dismissWayfindingHint();

    expect(hint.hidden).toBe(true);
  });

  it("clicking Wayfinding calls onToggleWayfinding", () => {
    const { onToggleWayfinding } = setup();
    query(container, "viewing-wayfinding")!.click();
    expect(onToggleWayfinding).toHaveBeenCalledOnce();
  });

  it("the Wayfinding hint auto-dismisses after its timeout", () => {
    vi.useFakeTimers();
    try {
      setup();
      const hint = query(container, "viewing-wayfinding-hint")!;
      vi.advanceTimersByTime(7999);
      expect(hint.hidden).toBe(false);
      vi.advanceTimersByTime(1);
      expect(hint.hidden).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("setStatus/showNotice update their elements", () => {
    const { hud } = setup();
    hud.setStatus("hello");
    expect(query(container, "viewing-hud-status")!.textContent).toBe("hello");
    expect(query(container, "viewing-hud-status")!.hidden).toBe(false);

    hud.showNotice("careful");
    expect(query(container, "viewing-hud-notice")!.textContent).toBe("careful");
    expect(query(container, "viewing-hud-notice")!.hidden).toBe(false);
  });

  it("toggle buttons start inactive and their label + aria-pressed follow the state setters", () => {
    const { hud } = setup(true, { withOsmBuildings: true });
    const map = query(container, "viewing-map-toggle")!;
    const autopilot = query(container, "viewing-autopilot")!;
    const wayfinding = query(container, "viewing-wayfinding")!;

    expect(map.getAttribute("aria-label")).toBe("Show map");
    expect(map.getAttribute("aria-pressed")).toBe("false");

    hud.setMapActive(true);
    expect(map.getAttribute("aria-label")).toBe("Hide map");
    expect(map.getAttribute("aria-pressed")).toBe("true");

    hud.setAutopilotActive(true);
    expect(autopilot.getAttribute("aria-label")).toBe("Stop auto-walk");
    expect(autopilot.getAttribute("aria-pressed")).toBe("true");
    hud.setAutopilotActive(false);
    expect(autopilot.getAttribute("aria-label")).toBe("Auto-walk");

    hud.setWayfindingActive(true);
    expect(wayfinding.getAttribute("aria-label")).toBe("Stop wayfinding");
    expect(wayfinding.getAttribute("aria-pressed")).toBe("true");
    hud.setWayfindingActive(false);
    expect(wayfinding.getAttribute("aria-label")).toBe("Wayfinding");
  });

  it("destroy() removes the whole HUD from the DOM", () => {
    const { hud } = setup();
    expect(query(container, "viewing-hud")).not.toBeNull();
    hud.destroy();
    expect(query(container, "viewing-hud")).toBeNull();
  });

  it("renders no buildings button when onToggleOsmBuildings is omitted", () => {
    setup();
    expect(query(container, "viewing-osm-buildings-toggle")).toBeNull();
  });

  it("renders a Buildings button, defaulting to the off state, when onToggleOsmBuildings is given", () => {
    setup(true, { withOsmBuildings: true });
    const button = query(container, "viewing-osm-buildings-toggle");
    expect(button).not.toBeNull();
    expect(button!.getAttribute("aria-label")).toBe("Show buildings");
    expect(button!.getAttribute("aria-pressed")).toBe("false");
  });

  it("clicking the buildings button calls onToggleOsmBuildings", () => {
    const { onToggleOsmBuildings } = setup(true, { withOsmBuildings: true });
    query(container, "viewing-osm-buildings-toggle")!.click();
    expect(onToggleOsmBuildings).toHaveBeenCalledOnce();
  });

  it("setOsmBuildingsStatus maps each status to label + aria-pressed, and is a no-op without the toggle", () => {
    const { hud } = setup(true, { withOsmBuildings: true });
    const button = query(container, "viewing-osm-buildings-toggle")!;

    hud.setOsmBuildingsStatus("loaded");
    expect(button.getAttribute("aria-label")).toBe("Hide buildings");
    expect(button.getAttribute("aria-pressed")).toBe("true");

    hud.setOsmBuildingsStatus("loading");
    expect(button.getAttribute("aria-label")).toBe("Loading buildings…");
    expect(button.getAttribute("aria-pressed")).toBe("false");

    hud.setOsmBuildingsStatus("failed");
    expect(button.getAttribute("aria-label")).toBe(
      "Buildings failed — tap to retry",
    );

    const { hud: hudNoToggle } = setup(true, { withOsmBuildings: false });
    expect(() => hudNoToggle.setOsmBuildingsStatus("failed")).not.toThrow();
  });
});
