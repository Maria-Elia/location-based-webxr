/**
 * Share step of composed Authoring mode (plan
 * `plans/2026-08-14-authoring-composition-plan.md`, AC5, revised by
 * plans/2026-09-02-authoring-composition-ui-refresh-design.md). Packing and
 * downloading now happen on the authoring view's own Export button (see
 * `authoring-view.ts`'s `packAndDownload` dependency); by the time this
 * panel mounts, `tour.zip` has already been packed and downloaded. This
 * panel's only job is turning the URL the author uploads it to into a
 * scannable link, using packaging's `core/` (`buildTourUrl`, `generateQr`)
 * and `view/renderQrSvg`. It no longer needs the `Tour`/asset files
 * themselves at all (only packaging ever used them, and that now happens
 * earlier, in `authoring-view.ts`), so it takes no deps beyond `root`.
 */
import { buildTourUrl } from "../../components/packaging/core/build-tour-url.js";
import { generateQr } from "../../components/packaging/core/generate-qr.js";
import { renderQrSvg } from "../../components/packaging/view/qr-view.js";
import { prepareHostedZipUrl } from "../../components/shared/hosted-zip-url.js";
import { buildLabeledField } from "../../components/shared/labeled-field.js";

export function mountPackAndSharePanel(root: HTMLElement): {
  destroy(): void;
  root: HTMLElement;
} {
  const section = document.createElement("section");
  section.className = "panel";

  const heading = document.createElement("h2");
  heading.textContent = "Share link";
  section.appendChild(heading);

  const appBaseInput = document.createElement("input");
  appBaseInput.type = "url";
  appBaseInput.value = `${location.origin}${location.pathname}`;
  section.append(
    buildLabeledField("App base URL", appBaseInput, "app-base-url"),
  );

  const zipUrlInput = document.createElement("input");
  zipUrlInput.type = "url";
  zipUrlInput.placeholder = "Paste the shared link after uploading tour.zip";
  const zipUrlField = buildLabeledField(
    "OneDrive / Dropbox link",
    zipUrlInput,
    "zip-url",
  );
  section.append(zipUrlField);

  const generateButton = document.createElement("button");
  generateButton.className = "primary";
  generateButton.dataset["testid"] = "generate-qr";
  generateButton.textContent = "Generate QR";
  section.appendChild(generateButton);

  const qrStatus = document.createElement("p");
  qrStatus.dataset["testid"] = "qr-status";
  section.appendChild(qrStatus);

  const qrHost = document.createElement("div");
  qrHost.className = "qr-host";
  section.appendChild(qrHost);

  generateButton.addEventListener("click", () => {
    void (async () => {
      qrStatus.textContent = "";
      qrStatus.dataset["state"] = "";
      zipUrlField.classList.remove("field-error");
      qrHost.classList.remove("qr-host-show");
      qrHost.textContent = "";

      // AC13: buildTourUrl only validates appBaseUrl — a garbage zipUrl would
      // otherwise silently produce a QR pointing at a broken "?tour=" link.
      try {
        new URL(zipUrlInput.value);
      } catch {
        qrStatus.textContent = "Enter a shared link first.";
        qrStatus.dataset["state"] = "error";
        zipUrlField.classList.add("field-error");
        return;
      }

      // The proxy-routing decision is entirely an implementation detail —
      // the author can't act on it, so its notes never reach the UI.
      const prepared = prepareHostedZipUrl(
        zipUrlInput.value,
        import.meta.env.DEV,
      );
      if (prepared.notes.length > 0) {
        console.info("[pack-and-share]", prepared.notes.join(" | "));
      }

      try {
        const url = buildTourUrl(appBaseInput.value, prepared.url);
        renderQrSvg(qrHost, await generateQr(url));
        qrHost.classList.add("qr-host-show");
        // A real link, not just displayed text: the author (or whoever they
        // forward this to) can tap it directly instead of only scanning.
        const link = document.createElement("a");
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = url;
        qrStatus.textContent = "";
        qrStatus.appendChild(link);
        qrStatus.dataset["state"] = "ok";
      } catch (error) {
        qrStatus.textContent =
          error instanceof Error ? error.message : String(error);
        qrStatus.dataset["state"] = "error";
        zipUrlField.classList.add("field-error");
      }
    })();
  });

  root.appendChild(section);

  return {
    root: section,
    destroy() {
      section.remove();
    },
  };
}
