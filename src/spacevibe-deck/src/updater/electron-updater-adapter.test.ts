import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  electronRelaunch: vi.fn(async () => undefined),
}));

vi.mock("../host/bridge", () => ({
  invoke: mocks.invoke,
}));
vi.mock("../host/shell-host", () => ({
  relaunch: mocks.electronRelaunch,
}));

import { checkForUpdate, relaunchDeck, reportUpdateError } from "./electron-updater-adapter";
import { UPDATE_UNSUPPORTED } from "./update-controller";

describe("checkForUpdate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("__deckHost", undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves to null with no host bridge at all", async () => {
    // Browser `npm run dev`. The shared renderer paints there, and an update
    // error thrown at a preview shell helps nobody.
    await expect(checkForUpdate()).resolves.toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("says unsupported rather than up to date when the host has no updater", async () => {
    vi.stubGlobal("__deckHost", { invoke: vi.fn(), listen: vi.fn() });
    mocks.invoke.mockResolvedValue({ status: "unsupported" });

    await expect(checkForUpdate()).resolves.toBe(UPDATE_UNSUPPORTED);
    expect(mocks.invoke).toHaveBeenCalledWith("update_check");
  });

  it("resolves to null when the host is already current", async () => {
    vi.stubGlobal("__deckHost", { invoke: vi.fn(), listen: vi.fn() });
    mocks.invoke.mockResolvedValue({
      status: "current",
      currentVersion: "0.12.3",
    });

    await expect(checkForUpdate()).resolves.toBeNull();
  });

  it("wires an available update to the download and install channels", async () => {
    vi.stubGlobal("__deckHost", { invoke: vi.fn(), listen: vi.fn() });
    mocks.invoke.mockResolvedValue({
      status: "available",
      currentVersion: "0.12.3",
      version: "0.13.0",
      notes: "Fixes the thing.",
    });

    const update = await checkForUpdate();

    expect(update).toMatchObject({
      currentVersion: "0.12.3",
      version: "0.13.0",
      notes: "Fixes the thing.",
    });
    if (update === null || update === UPDATE_UNSUPPORTED) {
      throw new Error("expected a pending update");
    }
    await update.download();
    expect(mocks.invoke).toHaveBeenCalledWith("update_download");
    mocks.invoke.mockResolvedValueOnce({
      status: "install-failed",
      retryable: false,
      message: "staging failed",
    });
    await expect(update.install()).rejects.toMatchObject({
      message: "staging failed",
      retryable: false,
    });
    expect(mocks.invoke).toHaveBeenCalledWith("update_install");
  });

  it("throws on a reply it cannot read instead of inventing 'up to date'", async () => {
    vi.stubGlobal("__deckHost", { invoke: vi.fn(), listen: vi.fn() });
    mocks.invoke.mockResolvedValue({ status: "available", version: "0.13.0" });

    await expect(checkForUpdate()).rejects.toThrow("missing a version");

    mocks.invoke.mockResolvedValue("nope");
    await expect(checkForUpdate()).rejects.toThrow("not an object");

    mocks.invoke.mockResolvedValue({ status: "shrug" });
    await expect(checkForUpdate()).rejects.toThrow("unknown status");
  });
});

describe("relaunchDeck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("__deckHost", undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("routes through app_relaunch", async () => {
    vi.stubGlobal("__deckHost", { invoke: vi.fn(), listen: vi.fn() });

    await relaunchDeck();

    expect(mocks.electronRelaunch).toHaveBeenCalledOnce();
  });
});

describe("reportUpdateError", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("__deckHost", {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.invoke.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ["Update check failed", "check"],
    ["Update download failed", "download"],
    ["Could not record the update attempt", "install"],
  ])("forwards %s to local logging", (message, operation) => {
    reportUpdateError(message, new TypeError("offline"));
    expect(mocks.invoke).toHaveBeenCalledWith("update_report_error", {
      operation,
      name: "TypeError",
      message: `${message}: offline`,
    });
  });
  it("bounds renderer fields before IPC", () => {
    reportUpdateError("Update check failed", new Error("x".repeat(5000)));
    expect(mocks.invoke.mock.calls[0][1].message).toHaveLength(2048);
  });
  it("keeps browser diagnostics out of Electron IPC", () => {
    vi.stubGlobal("__deckHost", undefined);
    reportUpdateError("Update check failed", new Error("offline"));
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it.each(["reject", "throw"])(
    "contains an IPC %s without breaking error handling",
    async (mode) => {
      const error = new Error("logging unavailable");
      if (mode === "reject") mocks.invoke.mockRejectedValue(error);
      else
        mocks.invoke.mockImplementation(() => {
          throw error;
        });
      expect(() => reportUpdateError("Update check failed", new Error("offline"))).not.toThrow();
      await Promise.resolve();
      expect(console.error).toHaveBeenCalledWith("Could not persist updater error:", error);
    },
  );
});
