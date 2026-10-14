// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdateAction } from "./update-action";
import type { UpdateView } from "./update-controller";

const base: UpdateView = {
  phase: "available",
  currentVersion: "0.9.0",
  availableVersion: "0.10.0",
  notes: "Plain release notes",
};

function mount(view: UpdateView, platform: "macos" | "windows" = "macos") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const actions = {
    onCheck: vi.fn(),
    onDownload: vi.fn(),
    onInstall: vi.fn(),
    onRelaunch: vi.fn(),
  };
  act(() => render(<UpdateAction platform={platform} view={view} {...actions} />, host));
  return { host, actions, button: host.querySelector("button") };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("UpdateAction", () => {
  it("renders nothing while hidden", () => {
    expect(mount({ ...base, phase: "hidden" }).button).toBeNull();
  });

  it.each([
    ["check-failed", "Update check failed · Retry", false],
    ["available", "Update", false],
    ["downloading", "Downloading…", true],
    ["downloaded", "Install & Relaunch", false],
    ["installing", "Installing…", true],
    ["download-failed", "Retry Update", false],
    ["install-failed", "Retry Install", false],
    ["relaunch-failed", "Relaunch", false],
  ] as const)("maps %s to its action label", (phase, label, disabled) => {
    const { button } = mount({ ...base, phase });
    expect(button?.textContent).toContain(label);
    expect(button?.disabled).toBe(disabled);
    expect(button?.getAttribute("aria-busy")).toBe(disabled ? "true" : null);
  });

  it("routes download, install, and relaunch as separate actions", () => {
    const available = mount(base);
    available.button?.click();
    expect(available.actions.onDownload).toHaveBeenCalledTimes(1);

    const downloaded = mount({ ...base, phase: "downloaded" });
    downloaded.button?.click();
    expect(downloaded.actions.onInstall).toHaveBeenCalledTimes(1);

    const failed = mount({ ...base, phase: "relaunch-failed" });
    failed.button?.click();
    expect(failed.actions.onRelaunch).toHaveBeenCalledTimes(1);
  });

  it("routes check-failed to a new check without claiming an available version", () => {
    const { button, actions } = mount({ ...base, phase: "check-failed", availableVersion: "" });
    button?.click();
    expect(actions.onCheck).toHaveBeenCalledOnce();
    expect(actions.onDownload).not.toHaveBeenCalled();
    expect(button?.classList.contains("update-action--failed")).toBe(true);
    expect(button?.getAttribute("aria-label")).not.toContain("current");
  });

  it.each(["macos", "windows"] as const)(
    "names the manual path on %s and never offers a second handover",
    (platform) => {
      const { button, host, actions } = mount(
        { ...base, phase: "install-failed", installRetryable: false },
        platform,
      );
      expect(button?.textContent).toBe("Install failed · Reopen Deck");
      expect(button?.getAttribute("aria-disabled")).toBe("true");
      expect(button?.title).toContain("Release Notes");
      expect(button?.title).toContain(platform === "macos" ? "app menu" : "Settings → About");
      expect(host.querySelector("[aria-live]")?.textContent).not.toContain("Retry");
      button?.click();
      expect(actions.onInstall).not.toHaveBeenCalled();
    },
  );

  it("keeps a full accessible name and plain bounded tooltip", () => {
    const { button } = mount({ ...base, phase: "downloaded" });
    expect(button?.getAttribute("aria-label")).toBe(
      "Install update 0.10.0 and relaunch Deck (current 0.9.0)",
    );
    expect(button?.title).toContain("Plain release notes");
    expect(button?.querySelector(".update-action__compact")?.textContent).toBe("Relaunch");
  });

  it("announces state changes through a polite live region", () => {
    const { host } = mount({ ...base, phase: "download-failed" });
    const live = host.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toContain("Update download failed. Retry available.");
    expect(live?.textContent).toContain("Release Notes");
  });
});
