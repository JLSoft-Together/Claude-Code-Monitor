/**
 * The TabManager side of an Install press: where the install pane opens, what
 * its space is called, and how it is brought on screen. App builds one from
 * the live manager on Electron and lends it to
 * [`agent-install-store`](./agent-install-store.ts), which owns everything the
 * surfaces read.
 *
 * The pane is a plain shell that runs the vendor's command through the
 * `install` launch override, so it is never recorded or counted
 * ([terminal internals](../../docs/internals/terminal.md)). Settings, the launch
 * page and the Open board cover the stage, so a spawned pane closes them
 * before it takes focus; a failure closes nothing, which keeps the message
 * visible next to the button.
 */
import { BUILTIN_AGENTS } from "../lib/agent-catalog";
import type {
  AgentLaunchReceipt,
  AgentLaunchResult,
  AgentLaunchTarget,
} from "../terminal/agent-launch-target";
import { tabViews } from "../terminal/tabs-store";
import type { TabManager } from "../terminal/tab-manager-types";
import type { AgentInstallHost } from "./agent-install-store";

const OPEN_FAILED = "Couldn't open a terminal for the install. Try again.";

/**
 * A new space of the active workspace, else the home folder (decision 4). A
 * folder with no tab yet takes the `first-pane` target as captured; any other
 * capture becomes a space of its own, so the user's panes are left alone.
 */
export function installTarget(
  activeWorkspace: string | null,
  homeDir: string,
  capture: (workspacePath: string) => AgentLaunchTarget | null,
): AgentLaunchTarget | null {
  const workspacePath = activeWorkspace ?? homeDir;
  if (workspacePath === "") return null;
  const target = capture(workspacePath);
  if (target === null) return null;
  return target.kind === "first-pane" ? target : { kind: "new-space", workspacePath };
}

export interface AgentInstallHostDeps {
  readonly manager: Pick<
    TabManager,
    | "activeWorkspacePath"
    | "captureAgentLaunchTarget"
    | "launchAgentAtTarget"
    | "focusAgentLaunch"
    | "renameTab"
  >;
  readonly checkoutRoots: () => readonly string[];
  readonly homeDir: () => string;
  /** Closes Settings, the launch page and the Open board so the pane can be seen. */
  readonly revealStage: () => void;
  readonly nextFrame: (run: () => void) => void;
}

function failed(reason: unknown): AgentLaunchResult {
  console.error("Install pane did not open:", reason);
  return { kind: "failed", message: OPEN_FAILED };
}

export function createAgentInstallHost(deps: AgentInstallHostDeps): AgentInstallHost {
  const { manager } = deps;

  function reveal(receipt: AgentLaunchReceipt): void {
    deps.revealStage();
    deps.nextFrame(() => manager.focusAgentLaunch(receipt));
  }

  return {
    async open(agentId, command) {
      try {
        const target = installTarget(manager.activeWorkspacePath(), deps.homeDir(), (path) =>
          manager.captureAgentLaunchTarget(path, deps.checkoutRoots()),
        );
        if (target === null) return failed("no folder to open the install pane in");
        const result = await manager.launchAgentAtTarget(
          target,
          agentId,
          () => true,
          deps.checkoutRoots,
          { kind: "install", command },
        );
        if (result.kind === "failed") return failed(result.message);
        if (result.kind === "spawned") {
          const index = tabViews.value.findIndex((tab) => tab.key === result.receipt.tabKey);
          const label = BUILTIN_AGENTS.find((agent) => agent.id === agentId)?.label ?? agentId;
          if (index >= 0) manager.renameTab(index, `Install ${label}`);
          reveal(result.receipt);
        }
        return result;
      } catch (error) {
        return failed(error);
      }
    },
    focus: reveal,
  };
}
