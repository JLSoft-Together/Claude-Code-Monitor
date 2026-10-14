import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentLaunchReceipt, AgentLaunchResult } from "../terminal/agent-launch-target";
import { tabViews, type TabView } from "../terminal/tabs-store";
import {
  createAgentInstallHost,
  installTarget,
  type AgentInstallHostDeps,
} from "./agent-install-host";

const receipt: AgentLaunchReceipt = { tabKey: 7, paneId: 3, canFocus: () => true };
const COMMAND = "curl -fsSL https://example.test/i.sh | bash";

function tabView(key: number): TabView {
  return {
    key,
    process: null,
    name: null,
    dotColor: null,
    workspacePath: "/Users/dev/app",
    agents: [],
    agentBusy: false,
    unread: false,
  };
}

function setup(
  options: {
    active?: string | null;
    home?: string;
    captured?: "first-pane" | "split" | "none";
    result?: AgentLaunchResult | Error;
  } = {},
) {
  const { active = "/Users/dev/app", home = "/Users/dev", captured = "split" } = options;
  const result = options.result ?? { kind: "spawned", receipt };
  const calls: string[] = [];
  const manager = {
    activeWorkspacePath: vi.fn(() => active),
    captureAgentLaunchTarget: vi.fn((path: string) =>
      captured === "none"
        ? null
        : captured === "first-pane"
          ? ({ kind: "first-pane", workspacePath: path } as const)
          : ({ kind: "split", workspacePath: path, tabKey: 1, paneId: 1 } as const),
    ),
    launchAgentAtTarget: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
    focusAgentLaunch: vi.fn(() => void calls.push("focus")),
    renameTab: vi.fn(),
  };
  const roots = () => ["/Users/dev/app"];
  const deps: AgentInstallHostDeps = {
    manager,
    checkoutRoots: roots,
    homeDir: () => home,
    revealStage: vi.fn(() => void calls.push("reveal")),
    nextFrame: (run) => {
      calls.push("frame");
      run();
    },
  };
  return { host: createAgentInstallHost(deps), manager, deps, calls, roots };
}

beforeEach(() => {
  tabViews.value = [tabView(5), tabView(7)];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  tabViews.value = [];
  vi.restoreAllMocks();
});

describe("installTarget", () => {
  const capture = (kind: "first-pane" | "split" | "new-space") => (path: string) =>
    kind === "first-pane"
      ? ({ kind, workspacePath: path } as const)
      : kind === "new-space"
        ? ({ kind, workspacePath: path } as const)
        : ({ kind, workspacePath: path, tabKey: 1, paneId: 1 } as const);

  it("turns a split capture into a new space of the active workspace", () => {
    expect(installTarget("/w", "/h", capture("split"))).toEqual({
      kind: "new-space",
      workspacePath: "/w",
    });
  });

  it("keeps a first-pane capture, falling back to the home folder", () => {
    expect(installTarget(null, "/h", capture("first-pane"))).toEqual({
      kind: "first-pane",
      workspacePath: "/h",
    });
  });

  it("opens a new space in home when home already has a tab", () => {
    expect(installTarget(null, "/h", capture("split"))).toEqual({
      kind: "new-space",
      workspacePath: "/h",
    });
  });

  it("has no target without a workspace or a home folder, or when capture refuses", () => {
    expect(installTarget(null, "", capture("split"))).toBeNull();
    expect(installTarget("/w", "/h", () => null)).toBeNull();
  });
});

describe("createAgentInstallHost", () => {
  it("opens a new space with the install override, names it, then reveals and focuses", async () => {
    const { host, manager, calls, roots } = setup();
    const result = await host.open("amp", COMMAND);
    expect(result).toEqual({ kind: "spawned", receipt });
    expect(manager.launchAgentAtTarget).toHaveBeenCalledWith(
      { kind: "new-space", workspacePath: "/Users/dev/app" },
      "amp",
      expect.any(Function),
      roots,
      { kind: "install", command: COMMAND },
    );
    expect(manager.renameTab).toHaveBeenCalledWith(1, "Install Amp");
    expect(calls).toEqual(["reveal", "frame", "focus"]);
    expect(manager.focusAgentLaunch).toHaveBeenCalledWith(receipt);
  });

  it("opens the home folder's first pane with no workspace open", async () => {
    const { host, manager } = setup({ active: null, captured: "first-pane" });
    await host.open("amp", COMMAND);
    expect(manager.launchAgentAtTarget).toHaveBeenCalledWith(
      { kind: "first-pane", workspacePath: "/Users/dev" },
      "amp",
      expect.any(Function),
      expect.any(Function),
      { kind: "install", command: COMMAND },
    );
  });

  it("opens a new space in home when home already has a tab but is not active", async () => {
    const { host, manager } = setup({ active: null, captured: "split" });
    await host.open("amp", COMMAND);
    expect(manager.launchAgentAtTarget).toHaveBeenCalledWith(
      { kind: "new-space", workspacePath: "/Users/dev" },
      "amp",
      expect.any(Function),
      expect.any(Function),
      expect.anything(),
    );
  });

  it("fails without launching when there is no workspace and no home folder", async () => {
    const { host, manager, deps } = setup({ active: null, home: "" });
    const result = await host.open("amp", COMMAND);
    expect(result).toEqual({
      kind: "failed",
      message: "Couldn't open a terminal for the install. Try again.",
    });
    expect(manager.launchAgentAtTarget).not.toHaveBeenCalled();
    expect(deps.revealStage).not.toHaveBeenCalled();
  });

  it("shows the install wording, logs the original and leaves the stage alone on a failure", async () => {
    const { host, deps } = setup({
      result: { kind: "failed", message: "Go back and try again." },
    });
    const result = await host.open("amp", COMMAND);
    expect(result).toEqual({
      kind: "failed",
      message: "Couldn't open a terminal for the install. Try again.",
    });
    expect(console.error).toHaveBeenCalledWith(
      "Install pane did not open:",
      "Go back and try again.",
    );
    expect(deps.revealStage).not.toHaveBeenCalled();
  });

  it("maps a thrown launch to the same failure", async () => {
    const { host, deps } = setup({ result: new Error("boom") });
    const result = await host.open("amp", COMMAND);
    expect(result.kind).toBe("failed");
    expect(deps.revealStage).not.toHaveBeenCalled();
  });

  it("passes a cancelled launch through untouched", async () => {
    const { host, deps } = setup({ result: { kind: "cancelled" } });
    expect(await host.open("amp", COMMAND)).toEqual({ kind: "cancelled" });
    expect(deps.revealStage).not.toHaveBeenCalled();
  });

  it("falls back to the id for an agent that is not a built-in", async () => {
    const { host, manager } = setup();
    await host.open("nope", COMMAND);
    expect(manager.renameTab).toHaveBeenCalledWith(1, "Install nope");
  });

  it("reveals and focuses the given receipt", () => {
    const { host, manager, calls } = setup();
    host.focus(receipt);
    expect(calls).toEqual(["reveal", "frame", "focus"]);
    expect(manager.focusAgentLaunch).toHaveBeenCalledWith(receipt);
  });
});
