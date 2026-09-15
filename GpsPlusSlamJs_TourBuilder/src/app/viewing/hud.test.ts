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

  function setup(withAutopilot = true) {
    container = document.createElement("div");
    document.body.append(container);
    const onToggleMap = vi.fn();
    const onEndTour = vi.fn();
    const onToggleAutopilot = vi.fn();
    const hud = mountHud(container, {
      onToggleMap,
      onEndTour,
      ...(withAutopilot ? { onToggleAutopilot } : {}),
    });
    return { hud, onToggleMap, onEndTour, onToggleAutopilot };
  }

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
    const close = hint.querySelector<HTMLButtonElement>(
      ".autopilot-hint-close",
    )!;

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

  it("setStatus/showNotice/setMapToggleLabel/setAutopilotLabel update their elements", () => {
    const { hud } = setup();
    hud.setStatus("hello");
    expect(query(container, "viewing-hud-status")!.textContent).toBe("hello");
    expect(query(container, "viewing-hud-status")!.hidden).toBe(false);

    hud.showNotice("careful");
    expect(query(container, "viewing-hud-notice")!.textContent).toBe("careful");
    expect(query(container, "viewing-hud-notice")!.hidden).toBe(false);

    hud.setMapToggleLabel("Hide map");
    expect(query(container, "viewing-map-toggle")!.textContent).toBe(
      "Hide map",
    );

    hud.setAutopilotLabel("Stop auto-walk");
    expect(query(container, "viewing-autopilot")!.textContent).toBe(
      "Stop auto-walk",
    );
  });

  it("destroy() removes the whole HUD from the DOM", () => {
    const { hud } = setup();
    expect(query(container, "viewing-hud")).not.toBeNull();
    hud.destroy();
    expect(query(container, "viewing-hud")).toBeNull();
  });
});
