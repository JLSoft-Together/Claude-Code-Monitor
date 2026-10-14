// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryPtyClient } from "./pty-client";
import { settings } from "../settings/settings-store";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { activeTabIndex, tabViews } from "./tabs-store";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import { freshWindowFocusController, wire, processInfo } from "./tab-manager.fixtures";

vi.mock("../lib/native-notification", () => ({
  sendAgentNotification: vi.fn(),
}));

vi.mock("../telemetry/usage-counters", () => ({
  countAgentLaunch: vi.fn(),
}));

let windowFocus = freshWindowFocusController();

vi.mock("../host/window-host", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
  getCurrentWindow: () => ({
    scaleFactor: async () => 1,
    close: async () => {},
    isFocused: async () => windowFocus.initialFocused,
    onFocusChanged: async (handler: (event: { payload: boolean }) => void) => {
      windowFocus.emitFocusChanged = (focused) => handler({ payload: focused });
      return windowFocus.unlistenFocus;
    },
  }),
}));

import { detectedAgents } from "./agent-detection-store";
import { countAgentLaunch } from "../telemetry/usage-counters";

const INSTALL = "curl -fsSL https://example.test/i.sh | bash";

function shellPty(...ids: number[]) {
  return createMemoryPtyClient({
    nextId: 1,
    infos: new Map(ids.map((id) => [id, processInfo(id, "/repo", "zsh", "idle-shell", null)])),
  });
}

describe("install launch override", () => {
  beforeEach(() => {
    windowFocus = freshWindowFocusController();
    vi.useFakeTimers();
    vi.mocked(countAgentLaunch).mockClear();
    settings.value = DEFAULT_SETTINGS;
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
    tabViews.value = [];
    activeTabIndex.value = -1;
    // The agent being installed is, by definition, not detected.
    detectedAgents.value = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    resetDesktopEnvironmentForTests();
  });

  it("types the command verbatim into a new space for an agent that is not installed", async () => {
    const pty = shellPty(1, 2);
    const { tm } = wire(pty);
    await tm.openQuickAgent(null, "/repo");
    const result = await tm.launchAgentAtTarget(
      { kind: "new-space", workspacePath: "/repo" },
      "amp",
      () => true,
      undefined,
      { kind: "install", command: INSTALL },
    );
    expect(result.kind).toBe("spawned");
    if (result.kind !== "spawned") throw new Error("Expected spawned pane");
    expect(tabViews.value.map((tab) => tab.workspacePath)).toEqual(["/repo", "/repo"]);
    expect(result.receipt.tabKey).toBe(tabViews.value[1]?.key);
    expect(pty.writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(pty.writes).toEqual([{ id: result.receipt.paneId, data: `${INSTALL}\r` }]);
    tm.dispose();
  });

  it("keeps the install out of the journal and out of the launch count", async () => {
    const pty = shellPty(1, 2);
    const { tm } = wire(pty);
    await tm.openQuickAgent(null, "/repo");
    const result = await tm.launchAgentAtTarget(
      { kind: "new-space", workspacePath: "/repo" },
      "amp",
      () => true,
      undefined,
      { kind: "install", command: INSTALL },
    );
    if (result.kind !== "spawned") throw new Error("Expected spawned pane");
    await vi.advanceTimersByTimeAsync(3000);
    expect(tm.launchCommandFor(result.receipt.paneId)).toBeNull();
    const journal = tm.captureSession();
    expect(journal.flatMap((tab) => tab.panes).map((pane) => pane.launchCommand)).toEqual([
      null,
      null,
    ]);
    expect(JSON.stringify(journal)).not.toContain("example.test");
    expect(countAgentLaunch).not.toHaveBeenCalled();
    tm.dispose();
  });

  it("still records and counts the same launch without an override", async () => {
    detectedAgents.value = [{ name: "amp", path: "/bin/amp" }];
    const pty = shellPty(1, 2);
    const { tm } = wire(pty);
    await tm.openQuickAgent(null, "/repo");
    const result = await tm.launchAgentAtTarget(
      { kind: "new-space", workspacePath: "/repo" },
      "amp",
      () => true,
    );
    if (result.kind !== "spawned") throw new Error("Expected spawned pane");
    expect(tm.launchCommandFor(result.receipt.paneId)).toBe("amp");
    expect(countAgentLaunch).toHaveBeenCalledOnce();
    expect(countAgentLaunch).toHaveBeenCalledWith("amp");
    tm.dispose();
  });

  it("opens the home folder as a first pane when no tab exists", async () => {
    const pty = shellPty(1);
    const { tm } = wire(pty);
    const target = tm.captureAgentLaunchTarget("/Users/dev");
    expect(target?.kind).toBe("first-pane");
    const result = await tm.launchAgentAtTarget(target!, "amp", () => true, undefined, {
      kind: "install",
      command: INSTALL,
    });
    expect(result.kind).toBe("spawned");
    expect(tabViews.value.map((tab) => tab.workspacePath)).toEqual(["/Users/dev"]);
    tm.dispose();
  });

  it("adds no signal flags to an install command, though it would to a launch", async () => {
    detectedAgents.value = [{ name: "codex", path: "/bin/codex" }];
    settings.value = {
      ...DEFAULT_SETTINGS,
      agentSignalAdapters: { ...DEFAULT_SETTINGS.agentSignalAdapters, codex: true },
    };
    const pty = shellPty(1, 2, 3);
    const { tm } = wire(pty, {
      signalConfig: async () => ({
        claudeSettingsPath: "/settings",
        hookPort: 1,
        hooksSupported: true,
      }),
    });
    await tm.openQuickAgent(null, "/repo");
    const target = { kind: "new-space", workspacePath: "/repo" } as const;
    const installed = await tm.launchAgentAtTarget(target, "codex", () => true, undefined, {
      kind: "install",
      command: "codex --version",
    });
    const launched = await tm.launchAgentAtTarget(target, "codex", () => true);
    if (installed.kind !== "spawned" || launched.kind !== "spawned")
      throw new Error("Expected spawned panes");
    await vi.advanceTimersByTimeAsync(3000);
    const typed = (paneId: number) => pty.writes.find((write) => write.id === paneId)?.data;
    expect(typed(installed.receipt.paneId)).toBe("codex --version\r");
    expect(typed(launched.receipt.paneId)).toContain("tui.notification_condition=always");
    tm.dispose();
  });

  it.each(["", "   ", "echo a\nrm -rf x", "echo a\r"])(
    "refuses the command %j before any pane exists",
    async (command) => {
      const pty = shellPty(1);
      const { tm } = wire(pty);
      await tm.openQuickAgent(null, "/repo");
      const result = await tm.launchAgentAtTarget(
        { kind: "new-space", workspacePath: "/repo" },
        "amp",
        () => true,
        undefined,
        { kind: "install", command },
      );
      expect(result).toEqual({ kind: "failed", message: "This install command cannot be run." });
      expect(tm.allPaneIds()).toEqual([1]);
      await vi.advanceTimersByTimeAsync(3000);
      expect(pty.writes).toEqual([]);
      tm.dispose();
    },
  );

  it("does not ask whether the agent is installed", async () => {
    // `detectedAgents` is empty, so a plain launch of `amp` is refused ...
    const pty = shellPty(1, 2);
    const { tm } = wire(pty);
    await tm.openQuickAgent(null, "/repo");
    const target = { kind: "new-space", workspacePath: "/repo" } as const;
    expect((await tm.launchAgentAtTarget(target, "amp", () => true)).kind).toBe("failed");
    // ... while the same agent's install is not.
    const result = await tm.launchAgentAtTarget(target, "amp", () => true, undefined, {
      kind: "install",
      command: INSTALL,
    });
    expect(result.kind).toBe("spawned");
    tm.dispose();
  });

  it("cancels an install once the caller no longer commits", async () => {
    const pty = shellPty(1);
    const { tm } = wire(pty);
    await tm.openQuickAgent(null, "/repo");
    const result = await tm.launchAgentAtTarget(
      { kind: "new-space", workspacePath: "/repo" },
      "amp",
      () => false,
      undefined,
      { kind: "install", command: INSTALL },
    );
    expect(result.kind).toBe("cancelled");
    expect(tm.allPaneIds()).toEqual([1]);
    tm.dispose();
  });
});
