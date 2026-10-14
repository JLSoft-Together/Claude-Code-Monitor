import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerAgentInstallHost,
  resetAgentInstallForTests,
} from "../launcher/agent-install-store";
import { BUILTIN_AGENTS } from "../lib/agent-catalog";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import { agentsProbed, detectedAgents } from "../terminal/agent-detection-store";
import { quickAgentChoices, toggleQuickAgent } from "./quick-agent-choices";
import { DEFAULT_SETTINGS } from "./settings-schema";
import { settings } from "./settings-store";

// Track B's real commands are not the subject here: `amp` has one, every other agent has none.
vi.mock("../lib/agent-catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/agent-catalog")>();
  const amp = {
    macos: { command: "amp-installer", source: "https://example.test", checked: "2026-10-10" },
    windows: null,
  };
  return {
    ...actual,
    BUILTIN_AGENTS: actual.BUILTIN_AGENTS.map((agent) => ({
      ...agent,
      install: agent.id === "amp" ? amp : { macos: null, windows: null },
    })),
  };
});

const choice = (id: string) => quickAgentChoices().find((candidate) => candidate.id === id)!;

beforeEach(() => {
  settings.value = DEFAULT_SETTINGS;
  detectedAgents.value = BUILTIN_AGENTS.map((agent) => ({
    name: agent.id,
    path: `/bin/${agent.id}`,
  }));
  agentsProbed.value = true;
});
afterEach(() => {
  resetAgentInstallForTests();
  resetDesktopEnvironmentForTests();
  settings.value = DEFAULT_SETTINGS;
  detectedAgents.value = [];
  agentsProbed.value = false;
});

describe("quickAgentChoices", () => {
  it("lists every built-in and pins them all by default", () => {
    const choices = quickAgentChoices();
    expect(choices.map((entry) => entry.id)).toEqual(BUILTIN_AGENTS.map((agent) => agent.id));
    expect(choices.every((entry) => entry.pinned)).toBe(true);
  });

  it("explains why an agent cannot be pinned", () => {
    detectedAgents.value = detectedAgents.value.filter((agent) => agent.name !== "droid");
    expect(choice("droid")).toMatchObject({ blocked: "Not installed", toggleable: false });
    expect(choice(BUILTIN_AGENTS[0].id)).toMatchObject({ blocked: null, toggleable: true });
  });

  it("unpins and re-pins an agent and persists the list", () => {
    const [first, ...rest] = BUILTIN_AGENTS.map((agent) => agent.id);
    toggleQuickAgent(first);
    expect(settings.value.quickAgentIds).toEqual(rest);
    toggleQuickAgent(first);
    expect(settings.value.quickAgentIds).toEqual([...rest, first]);
  });
});

describe("quickAgentChoices install offer", () => {
  const host = { open: vi.fn(), focus: vi.fn() };
  beforeEach(() => {
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
    registerAgentInstallHost(host);
    detectedAgents.value = detectedAgents.value.filter(
      (agent) => agent.name !== "amp" && agent.name !== "kimi",
    );
  });

  it("offers Install for a missing enabled built-in and Get when it has no command", () => {
    expect(choice("amp").offer).toEqual({ kind: "install", command: "amp-installer" });
    expect(choice("kimi").offer).toMatchObject({ kind: "get" });
    expect(choice("claude").offer).toEqual({ kind: "none" });
  });

  it("offers nothing for a disabled agent, before the probe, for a custom agent or with no host", () => {
    settings.value = { ...DEFAULT_SETTINGS, disabledAgents: ["amp"] };
    expect(choice("amp").offer).toEqual({ kind: "none" });

    settings.value = {
      ...DEFAULT_SETTINGS,
      customAgents: [{ id: "custom:aider", label: "Aider", command: "aider" }],
    };
    expect(choice("custom:aider").offer).toEqual({ kind: "none" });

    agentsProbed.value = false;
    expect(choice("amp").offer).toEqual({ kind: "none" });

    agentsProbed.value = true;
    resetAgentInstallForTests();
    expect(choice("amp").offer).toEqual({ kind: "none" });
  });
});
