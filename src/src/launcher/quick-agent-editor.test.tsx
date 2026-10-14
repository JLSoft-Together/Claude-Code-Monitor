// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import { quickAgentChoices } from "../settings/quick-agent-choices";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { settings } from "../settings/settings-store";
import { agentsProbed, detectedAgents } from "../terminal/agent-detection-store";
import { registerAgentInstallHost, resetAgentInstallForTests } from "./agent-install-store";
import { QuickAgentEditor } from "./quick-agent-editor";

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

let host: HTMLDivElement;
const open = vi.fn();
const onToggle = vi.fn();

beforeEach(() => {
  initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
  settings.value = DEFAULT_SETTINGS;
  detectedAgents.value = [{ name: "claude", path: "/bin/claude" }];
  agentsProbed.value = true;
  open.mockReset();
  open.mockResolvedValue({ kind: "cancelled" });
  onToggle.mockReset();
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  resetAgentInstallForTests();
  resetDesktopEnvironmentForTests();
  settings.value = DEFAULT_SETTINGS;
  detectedAgents.value = [];
  agentsProbed.value = false;
});

function mount() {
  act(() => render(<QuickAgentEditor choices={quickAgentChoices()} onToggle={onToggle} />, host));
}
function row(label: string): HTMLLIElement {
  return [...host.querySelectorAll("li")].find((li) => li.textContent?.includes(label))!;
}

describe("QuickAgentEditor install control", () => {
  beforeEach(() => registerAgentInstallHost({ open, focus: vi.fn() }));

  it("puts Install beside the label, never inside it, and presses without toggling", () => {
    mount();
    const button = row("Amp").querySelector<HTMLButtonElement>("button")!;
    expect(button.textContent).toBe("Install");
    expect(button.closest("label")).toBeNull();
    expect(button.closest("li")).toBe(row("Amp"));
    act(() => button.click());
    expect(open).toHaveBeenCalledExactlyOnceWith("amp", "amp-installer");
    expect(onToggle).not.toHaveBeenCalled();
    expect(row("Amp").querySelector<HTMLInputElement>("input")!.disabled).toBe(true);
  });

  it("replaces the Not installed text with the control, and shows Get when no command", () => {
    mount();
    expect(row("Amp").textContent).not.toContain("Not installed");
    expect(row("Kimi Code").querySelector("a")?.textContent).toBe("Get");
    expect(row("Kimi Code").textContent).not.toContain("Not installed");
    expect(row("Claude Code").querySelector("button, a")).toBeNull();
  });

  it("keeps today's Not installed text when the host cannot install", () => {
    resetAgentInstallForTests();
    mount();
    expect(row("Amp").textContent).toContain("Not installed");
    expect(host.querySelector("button")).toBeNull();
    expect(host.querySelector("a")).toBeNull();
  });
});
