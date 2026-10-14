import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerUpdater } from "./register-updater";

const mocks = vi.hoisted(() => ({
  root: "",
  handlers: new Map<string, (event: unknown, payload?: unknown) => unknown>(),
  events: new Map<string, (error?: Error) => void>(),
  updater: {
    on: vi.fn(),
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    logger: null as null | { error(value: unknown): void },
  },
}));
vi.mock("electron", () => ({
  app: { isPackaged: true, getVersion: () => "1.2.0", getPath: () => mocks.root },
  ipcMain: {
    handle: (name: string, callback: (event: unknown, payload?: unknown) => unknown) =>
      mocks.handlers.set(name, callback),
  },
}));
vi.mock("electron-updater", () => ({ autoUpdater: mocks.updater }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.root = mkdtempSync(join(tmpdir(), "deck-updater-ipc-"));
  mocks.handlers.clear();
  mocks.events.clear();
  mocks.updater.on.mockImplementation((name, callback) => mocks.events.set(name, callback));
  mocks.updater.checkForUpdates.mockResolvedValue({
    isUpdateAvailable: true,
    updateInfo: { version: "1.2.1" },
  });
  mocks.updater.downloadUpdate.mockResolvedValue([]);
});
afterEach(() => rmSync(mocks.root, { recursive: true, force: true }));

function invoke(name: string, payload?: unknown): unknown {
  const handler = mocks.handlers.get(name);
  if (!handler) throw new Error(`Missing handler: ${name}`);
  return handler(null, payload);
}
function setup() {
  return registerUpdater({
    labelOf: () => "main",
    prepareForInstall: async () => {},
    countOutcome: () => {},
  });
}

describe("updater IPC diagnostics", () => {
  it("returns a non-retryable reply after late staging failure and logs it", async () => {
    const handle = setup();
    await invoke("update_check");
    await invoke("update_download");
    const installing = invoke("update_install");
    await vi.waitFor(() => expect(mocks.updater.quitAndInstall).toHaveBeenCalledOnce());
    mocks.events.get("error")?.(new Error("signature invalid"));
    await expect(installing).resolves.toEqual({
      status: "install-failed",
      retryable: false,
      message: "signature invalid",
    });
    expect(handle.isInstalling()).toBe(false);
    await expect(invoke("update_install")).resolves.toMatchObject({ retryable: false });
    expect(mocks.updater.quitAndInstall).toHaveBeenCalledOnce();
    expect(readFileSync(join(mocks.root, "updater.log"), "utf8")).toContain("signature invalid");
  });

  it("connects host, renderer and provider errors to the same local file", async () => {
    setup();
    mocks.updater.checkForUpdates.mockRejectedValueOnce(new Error("feed unavailable"));
    await expect(invoke("update_check")).rejects.toThrow("feed unavailable");
    await invoke("update_check");
    mocks.updater.downloadUpdate.mockRejectedValueOnce(new Error("disk full"));
    await expect(invoke("update_download")).rejects.toThrow("disk full");
    invoke("update_report_error", {
      operation: "install",
      name: "Error",
      message: "Could not record attempt",
    });
    mocks.updater.logger?.error(new Error("provider failed"));
    const content = readFileSync(join(mocks.root, "updater.log"), "utf8");
    for (const message of [
      "feed unavailable",
      "disk full",
      "Could not record attempt",
      "provider failed",
    ]) {
      expect(content).toContain(message);
    }
    expect(() => invoke("update_report_error", { operation: "shell", message: "invalid" })).toThrow(
      "Invalid updater log operation",
    );
  });
});
