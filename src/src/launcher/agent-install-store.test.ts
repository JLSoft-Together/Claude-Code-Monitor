// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BuiltinAgent } from "../lib/agents/agent-definition";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { settings } from "../settings/settings-store";
import {
  agentsProbed,
  detectedAgents,
  resetAgentDetectionForTests,
} from "../terminal/agent-detection-store";
import type { AgentLaunchReceipt, AgentLaunchResult } from "../terminal/agent-launch-target";
import type { DetectedAgent } from "../terminal/pty-client";
import {
  agentInstallAvailable,
  agentInstallErrors,
  agentInstallOpening,
  installOfferFor,
  noteAgentListShown,
  probeAgentsNow,
  registerAgentInstallHost,
  resetAgentInstallForTests,
  startAgentInstall,
  type AgentInstallHost,
} from "./agent-install-store";

const FIXTURE_AGENTS = vi.hoisted<BuiltinAgent[]>(() => [
  {
    id: "amp",
    label: "Amp",
    url: "https://example.test/amp",
    install: {
      macos: { command: "amp-mac", source: "https://example.test/docs", checked: "2026-10-10" },
      windows: null,
    },
  },
  {
    id: "kimi",
    label: "Kimi",
    url: "https://example.test/kimi",
    install: { macos: null, windows: null },
  },
]);

vi.mock("../lib/agent-catalog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/agent-catalog")>()),
  BUILTIN_AGENTS: FIXTURE_AGENTS,
}));

const pty = vi.hoisted(() => ({
  detectAgents: vi.fn<(names: readonly string[]) => Promise<DetectedAgent[]>>(),
}));

vi.mock("../terminal/pty-client", () => ({
  defaultPtyClient: { detectAgents: (names: readonly string[]) => pty.detectAgents(names) },
}));

const AMP_FOUND: DetectedAgent = { name: "amp", path: "/usr/bin/amp" };

interface FakeHost extends AgentInstallHost {
  open: ReturnType<typeof vi.fn<AgentInstallHost["open"]>>;
  focus: ReturnType<typeof vi.fn<AgentInstallHost["focus"]>>;
}

function receipt(canFocus: () => boolean): AgentLaunchReceipt {
  return { tabKey: 1, paneId: 2, canFocus };
}

function fakeHost(result: AgentLaunchResult): FakeHost {
  return { open: vi.fn(async () => result), focus: vi.fn() };
}

describe("agent install store", () => {
  beforeEach(() => {
    resetDesktopEnvironmentForTests();
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
    resetAgentDetectionForTests();
    resetAgentInstallForTests();
    settings.value = DEFAULT_SETTINGS;
    agentsProbed.value = true;
    pty.detectAgents.mockReset();
    pty.detectAgents.mockResolvedValue([]);
  });

  afterEach(() => {
    resetAgentInstallForTests();
    resetDesktopEnvironmentForTests();
    vi.unstubAllEnvs();
  });

  describe("the offer", () => {
    it("is none with no host, install once one registers, none again after it leaves", () => {
      expect(agentInstallAvailable.value).toBe(false);
      expect(installOfferFor("amp")).toEqual({ kind: "none" });

      const unregister = registerAgentInstallHost(fakeHost({ kind: "cancelled" }));
      expect(agentInstallAvailable.value).toBe(true);
      expect(installOfferFor("amp")).toEqual({ kind: "install", command: "amp-mac" });

      unregister();
      expect(installOfferFor("amp")).toEqual({ kind: "none" });
    });

    it("is none for a custom agent id and offers Get when the command is null", () => {
      registerAgentInstallHost(fakeHost({ kind: "cancelled" }));

      expect(installOfferFor("custom:mine")).toEqual({ kind: "none" });
      expect(installOfferFor("kimi")).toEqual({ kind: "get", url: "https://example.test/kimi" });
    });

    it("reads a disabled agent and a found agent as none", () => {
      registerAgentInstallHost(fakeHost({ kind: "cancelled" }));

      settings.value = { ...DEFAULT_SETTINGS, disabledAgents: ["amp"] };
      expect(installOfferFor("amp")).toEqual({ kind: "none" });

      settings.value = DEFAULT_SETTINGS;
      detectedAgents.value = [AMP_FOUND];
      expect(installOfferFor("amp")).toEqual({ kind: "none" });
    });

    it("swaps in the E2E command, only where a command exists", () => {
      registerAgentInstallHost(fakeHost({ kind: "cancelled" }));
      vi.stubEnv("VITE_DECK_E2E_INSTALL_COMMAND", "sh /tmp/x {id}");

      expect(installOfferFor("amp")).toEqual({ kind: "install", command: "sh /tmp/x amp" });
      expect(installOfferFor("kimi")).toEqual({ kind: "get", url: "https://example.test/kimi" });
    });
  });

  describe("the press", () => {
    it("opens the platform command, and a second press focuses the open pane", async () => {
      let open = true;
      const earlier = receipt(() => open);
      const host = fakeHost({ kind: "spawned", receipt: earlier });
      registerAgentInstallHost(host);

      await startAgentInstall("amp");
      expect(host.open).toHaveBeenCalledWith("amp", "amp-mac");

      await startAgentInstall("amp");
      expect(host.open).toHaveBeenCalledTimes(1);
      expect(host.focus).toHaveBeenCalledWith(earlier);

      open = false;
      await startAgentInstall("amp");
      expect(host.open).toHaveBeenCalledTimes(2);
    });

    it("ignores a press with no install offer", async () => {
      const host = fakeHost({ kind: "cancelled" });
      registerAgentInstallHost(host);

      await startAgentInstall("kimi");
      await startAgentInstall("custom:mine");

      expect(host.open).not.toHaveBeenCalled();
    });

    it("stores a failure for the button, clears it on the next press, ignores a cancel", async () => {
      const host = fakeHost({ kind: "failed", message: "No room for another pane" });
      registerAgentInstallHost(host);

      await startAgentInstall("amp");
      expect(agentInstallErrors.value.get("amp")).toBe("No room for another pane");

      host.open.mockResolvedValue({ kind: "cancelled" });
      await startAgentInstall("amp");
      expect(agentInstallErrors.value.has("amp")).toBe(false);
    });

    it("logs a thrown host error and shows the generic text", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const host = fakeHost({ kind: "cancelled" });
      host.open.mockRejectedValue(new Error("boom"));
      registerAgentInstallHost(host);

      await startAgentInstall("amp");

      expect(error).toHaveBeenCalled();
      expect(agentInstallErrors.value.get("amp")).toBe(
        "Couldn't open a terminal for the install. Try again.",
      );
      expect(agentInstallOpening.value.has("amp")).toBe(false);
      error.mockRestore();
    });

    it("opens once for a double press and holds the agent as opening meanwhile", async () => {
      let finish!: (result: AgentLaunchResult) => void;
      const host = fakeHost({ kind: "cancelled" });
      host.open.mockImplementation(
        () =>
          new Promise<AgentLaunchResult>((resolve) => {
            finish = resolve;
          }),
      );
      registerAgentInstallHost(host);

      const first = startAgentInstall("amp");
      expect(agentInstallOpening.value.has("amp")).toBe(true);
      await startAgentInstall("amp");
      finish({ kind: "cancelled" });
      await first;

      expect(host.open).toHaveBeenCalledTimes(1);
      expect(agentInstallOpening.value.has("amp")).toBe(false);
    });
  });

  describe("noticing the new CLI", () => {
    async function spawnInstall(): Promise<void> {
      registerAgentInstallHost(fakeHost({ kind: "spawned", receipt: receipt(() => true) }));
      await startAgentInstall("amp");
      pty.detectAgents.mockClear();
    }

    it("forces a full-list probe when the window regains focus", async () => {
      settings.value = {
        ...DEFAULT_SETTINGS,
        customAgents: [{ id: "custom:mine", label: "Mine", command: "mine-cli --flag" }],
      };
      await spawnInstall();

      window.dispatchEvent(new Event("focus"));

      expect(pty.detectAgents).toHaveBeenCalledTimes(1);
      const names = pty.detectAgents.mock.calls[0][0];
      expect(names).toContain("mine-cli");
      expect(names).toContain("claude");
    });

    it("forces the same probe when an agent list is shown, only while pending", async () => {
      registerAgentInstallHost(fakeHost({ kind: "spawned", receipt: receipt(() => true) }));
      noteAgentListShown();
      window.dispatchEvent(new Event("focus"));
      expect(pty.detectAgents).not.toHaveBeenCalled();

      await startAgentInstall("amp");
      noteAgentListShown();
      expect(pty.detectAgents).toHaveBeenCalledTimes(1);
    });

    it("stops probing once the agent is found", async () => {
      await spawnInstall();
      const detach = vi.spyOn(globalThis, "removeEventListener");
      detectedAgents.value = [AMP_FOUND];

      window.dispatchEvent(new Event("focus"));
      noteAgentListShown();

      expect(pty.detectAgents).not.toHaveBeenCalled();
      expect(detach).toHaveBeenCalledWith("focus", expect.any(Function));
      detach.mockRestore();
    });

    it("does not re-arm after a later uninstall", async () => {
      await spawnInstall();
      detectedAgents.value = [AMP_FOUND];
      detectedAgents.value = [];

      noteAgentListShown();
      window.dispatchEvent(new Event("focus"));

      expect(pty.detectAgents).not.toHaveBeenCalled();
    });

    it("pins a found install to the saved quick agents, once", async () => {
      settings.value = { ...DEFAULT_SETTINGS, quickAgentIds: ["claude"] };
      await spawnInstall();

      detectedAgents.value = [AMP_FOUND];
      detectedAgents.value = [AMP_FOUND, { name: "codex", path: "/usr/bin/codex" }];

      expect(settings.value.quickAgentIds).toEqual(["claude", "amp"]);
    });

    it("leaves automatic quick agents and an existing pin alone", async () => {
      await spawnInstall();
      detectedAgents.value = [AMP_FOUND];
      expect(settings.value.quickAgentIds).toBeNull();

      resetAgentInstallForTests();
      resetAgentDetectionForTests();
      settings.value = { ...DEFAULT_SETTINGS, quickAgentIds: ["amp", "claude"] };
      await spawnInstall();
      detectedAgents.value = [AMP_FOUND];
      expect(settings.value.quickAgentIds).toEqual(["amp", "claude"]);
    });

    it("does not pin an agent found without an install from Deck", () => {
      settings.value = { ...DEFAULT_SETTINGS, quickAgentIds: ["claude"] };
      registerAgentInstallHost(fakeHost({ kind: "spawned", receipt: receipt(() => true) }));

      detectedAgents.value = [AMP_FOUND];

      expect(settings.value.quickAgentIds).toEqual(["claude"]);
    });

    it("does not watch the window for an install that never spawned", async () => {
      registerAgentInstallHost(fakeHost({ kind: "failed", message: "no" }));
      await startAgentInstall("amp");

      window.dispatchEvent(new Event("focus"));

      expect(pty.detectAgents).not.toHaveBeenCalled();
    });

    it("probeAgentsNow forces the full list even inside the freshness window", async () => {
      settings.value = {
        ...DEFAULT_SETTINGS,
        customAgents: [{ id: "custom:mine", label: "Mine", command: "mine-cli" }],
      };

      await probeAgentsNow();
      await probeAgentsNow();

      expect(pty.detectAgents).toHaveBeenCalledTimes(2);
      expect(pty.detectAgents.mock.calls[1][0]).toContain("mine-cli");
    });
  });
});
