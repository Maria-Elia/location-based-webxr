// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from "vitest";
import type * as StorageModule from "gps-plus-slam-app-framework/storage";

vi.mock("gps-plus-slam-app-framework/storage", async () => {
  const actual = await vi.importActual<typeof StorageModule>(
    "gps-plus-slam-app-framework/storage",
  );
  return {
    ...actual,
    normalizeShareUrl: (raw: string) => raw,
  };
});

vi.mock("../../components/packaging/core/generate-qr.js", () => ({
  generateQr: vi.fn((url: string) => Promise.resolve(`QR-DATA(${url})`)),
}));

vi.mock("../../components/packaging/view/qr-view.js", () => ({
  renderQrSvg: vi.fn((host: HTMLElement, data: string) => {
    host.textContent = String(data);
  }),
}));

import { mountPackAndSharePanel } from "./pack-and-share-panel.js";

function setup() {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const panel = mountPackAndSharePanel(root);
  const urlInputs =
    root.querySelectorAll<HTMLInputElement>('input[type="url"]');
  const zipUrlInput = urlInputs[1]!;
  const zipField = zipUrlInput.closest(".field")!;
  const qrStatus = root.querySelector<HTMLParagraphElement>(
    '[data-testid="qr-status"]',
  )!;
  const generateButton = root.querySelector<HTMLButtonElement>(
    '[data-testid="generate-qr"]',
  )!;
  return { root, panel, zipUrlInput, zipField, qrStatus, generateButton };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("mountPackAndSharePanel", () => {
  it("has no pack/download controls left — it opens directly on the share step", () => {
    const { root } = setup();
    expect(root.querySelector('[data-testid="pack-tour"]')).toBeNull();
    expect(root.querySelector('[data-testid="pack-status"]')).toBeNull();
    expect(root.querySelector('[data-testid="url-notes"]')).toBeNull();
  });

  it("labels the zip-url field for a non-technical author", () => {
    const { zipField } = setup();
    expect(zipField.textContent).toContain("OneDrive / Dropbox link");
  });

  it("shows no error and builds the link unchanged for an ordinary host", async () => {
    const { zipUrlInput, qrStatus, generateButton } = setup();
    zipUrlInput.value = "https://example.com/tour.zip";
    generateButton.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(qrStatus.dataset["state"]).toBe("ok");
    expect(qrStatus.textContent).toContain(
      encodeURIComponent("https://example.com/tour.zip"),
    );
  });

  it("routes a Dropbox URL through the dev proxy without showing an explanatory note", async () => {
    const original = import.meta.env.DEV;
    (import.meta.env as { DEV: boolean }).DEV = true;
    try {
      const { root, zipUrlInput, qrStatus, generateButton } = setup();
      const raw = "https://dl.dropboxusercontent.com/scl/fi/abc/tour.zip";
      zipUrlInput.value = raw;
      generateButton.click();
      await Promise.resolve();
      await Promise.resolve();

      expect(qrStatus.textContent).toContain(
        encodeURIComponent(`/tour-proxy?u=${encodeURIComponent(raw)}`),
      );
      // The routing itself is fine to see baked into the generated link
      // (that's just the URL); what must never appear is a *note explaining*
      // it, which is why there's no url-notes element at all any more.
      expect(root.querySelector('[data-testid="url-notes"]')).toBeNull();
    } finally {
      (import.meta.env as { DEV: boolean }).DEV = original;
    }
  });

  it("rejects an invalid link before building a URL", async () => {
    const { zipUrlInput, qrStatus, generateButton } = setup();
    zipUrlInput.value = "not-a-url";
    generateButton.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(qrStatus.dataset["state"]).toBe("error");
    expect(qrStatus.textContent).toBe("Enter a shared link first.");
  });

  it("exposes its top-level element as .root, for the caller's entrance transition", () => {
    const { panel, root } = setup();
    expect(panel.root.parentElement).toBe(root);
  });
});
