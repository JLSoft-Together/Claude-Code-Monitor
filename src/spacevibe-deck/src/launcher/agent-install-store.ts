/**
 * Installs started from Deck: who may offer one, which are running, and how
 * Deck notices the result.
 *
 * The press itself is the host's job (App owns the TabManager and lends the
 * two operations it needs through `registerAgentInstallHost`). What lives here
 * is everything a surface needs to read or react to:
 *
 * - **The offer** for one agent id, from the live probe, settings and platform
 *   signals, decided by [`installOffer`](../lib/agent-install.ts). With no host
 *   registered (Tauri, the browser preview) it is always `none`.
 * - **A pending install**, from the moment its pane spawns until the probe
 *   finds the agent. Deck never reads how the installer exits, so while one is
 *   pending a window `focus` and any agent list being shown force a fresh probe
 *   past the 30 s freshness window — the two moments the user comes back.
 * - **One pane per agent.** A second press while the earlier pane is still open
 *   focuses it instead of typing the installer twice.
 * - **A found install is pinned** to quick launch, so the agent the user just
 *   asked for is one press away.
 *
 * Window-scoped module store (R5): state dies with the window, which is also
 * what ends a pending install.
 */
import { computed, effect, signal, untracked, type ReadonlySignal } from "@preact/signals";
import { BUILTIN_AGENTS, probeNames } from "../lib/agent-catalog";
import { installOffer, type InstallOffer } from "../lib/agent-install";
import { getDesktopEnvironment } from "../lib/platform";
import { settings, updateSettings } from "../settings/settings-store";
import {
  agentsProbed,
  detectedAgents,
  ensureAgentsDetected,
} from "../terminal/agent-detection-store";
import type { AgentLaunchReceipt, AgentLaunchResult } from "../terminal/agent-launch-target";
import type { DetectedAgent } from "../terminal/pty-client";

/** What App lends the store: the two operations that need the TabManager. */
export interface AgentInstallHost {
  /** Open the install pane and type `command`. Resolves; never rejects. */
  open(agentId: string, command: string): Promise<AgentLaunchResult>;
  /** Reveal and focus a pane an earlier press opened. */
  focus(receipt: AgentLaunchReceipt): void;
}

const OPEN_FAILED = "Couldn't open a terminal for the install. Try again.";

const hostSignal = signal<AgentInstallHost | null>(null);
const opening = signal<ReadonlySet<string>>(new Set());
const errors = signal<ReadonlyMap<string, string>>(new Map());
/** The last `spawned` receipt per agent, for the one-pane-per-agent dedup. */
const receipts = new Map<string, AgentLaunchReceipt>();
/** Agents whose install pane spawned and whose binary has not been found yet. */
const pending = new Set<string>();
let stopWatching: (() => void) | null = null;

/** Registers the host; returns the unregister function. Only App calls it, only on Electron. */
export function registerAgentInstallHost(host: AgentInstallHost): () => void {
  hostSignal.value = host;
  return () => {
    if (hostSignal.value === host) {
      hostSignal.value = null;
    }
  };
}

/** True while a host is registered: the host can open the install pane. */
export const agentInstallAvailable: ReadonlySignal<boolean> = computed(
  () => hostSignal.value !== null,
);

/** Agents whose press is opening a pane right now (disable the button). */
export const agentInstallOpening: ReadonlySignal<ReadonlySet<string>> = opening;

/** The message of the last press that failed before its pane existed, per agent. */
export const agentInstallErrors: ReadonlySignal<ReadonlyMap<string, string>> = errors;

/**
 * E2E-only seam: the E2E run builds with this variable set so every Install
 * press types a harmless command instead of a real vendor installer. Read on
 * every call, not into a constant, so a test's `vi.stubEnv` is seen; Vite
 * inlines it statically, so an ordinary build carries `undefined` and this
 * branch is dead. Lives here and not in `src/lib/agents/`, which the main
 * process compiles and which cannot see `import.meta.env`.
 */
function e2eCommandOverride(agentId: string): string | undefined {
  const seam: unknown = import.meta.env.VITE_DECK_E2E_INSTALL_COMMAND;
  return typeof seam === "string" && seam !== "" ? seam.replaceAll("{id}", agentId) : undefined;
}

/** The offer for one agent id, from the live signals plus the E2E seam. */
export function installOfferFor(agentId: string): InstallOffer {
  return installOffer({
    agent: BUILTIN_AGENTS.find((agent) => agent.id === agentId),
    platform: getDesktopEnvironment().platform,
    available: agentInstallAvailable.value,
    probed: agentsProbed.value,
    enabled: !settings.value.disabledAgents.includes(agentId),
    found: detectedAgents.value.some((agent) => agent.name === agentId),
    commandOverride: e2eCommandOverride(agentId),
  });
}

/** A forced probe with the boot probe's full name list, built-ins and custom agents alike. */
export function probeAgentsNow(): Promise<readonly DetectedAgent[]> {
  return ensureAgentsDetected(probeNames(settings.value.customAgents), { force: true });
}

/** An agent list became visible; forces a full-list probe while an install is pending. */
export function noteAgentListShown(): void {
  if (pending.size > 0) {
    void probeAgentsNow();
  }
}

function onWindowFocus(): void {
  void probeAgentsNow();
}

/**
 * Add a just-installed agent to the saved quick-agent picks. With no saved
 * picks (`null`) quick launch already offers every available agent, and
 * writing a list there would freeze today's automatic set, so nothing is saved.
 */
function pinInstalledAgent(agentId: string): void {
  const ids = settings.value.quickAgentIds;
  if (ids === null || ids.includes(agentId)) {
    return;
  }
  updateSettings({ quickAgentIds: [...ids, agentId] });
}

function startWatching(): void {
  if (stopWatching !== null) {
    return;
  }
  globalThis.addEventListener("focus", onWindowFocus);
  const stopEffect = effect(() => {
    const found = detectedAgents.value;
    for (const id of [...pending]) {
      if (found.some((agent) => agent.name === id)) {
        pending.delete(id);
        // Untracked: reading settings here must not re-run this effect on every settings write.
        untracked(() => pinInstalledAgent(id));
      }
    }
    if (pending.size === 0 && stopWatching !== null) {
      stopWatching();
    }
  });
  stopWatching = () => {
    globalThis.removeEventListener("focus", onWindowFocus);
    stopEffect();
    stopWatching = null;
  };
  // The effect ran once before `stopWatching` existed, so settle an empty set here.
  if (pending.size === 0) {
    stopWatching();
  }
}

function setOpening(agentId: string, on: boolean): void {
  const next = new Set(opening.value);
  if (on) {
    next.add(agentId);
  } else {
    next.delete(agentId);
  }
  opening.value = next;
}

function setError(agentId: string, message: string | null): void {
  const next = new Map(errors.value);
  if (message === null) {
    next.delete(agentId);
  } else {
    next.set(agentId, message);
  }
  errors.value = next;
}

/** The Install press. Dedups to `host.focus` while the earlier pane can be focused. */
export async function startAgentInstall(agentId: string): Promise<void> {
  const host = hostSignal.value;
  if (host === null || opening.value.has(agentId)) {
    return;
  }
  const offer = installOfferFor(agentId);
  if (offer.kind !== "install") {
    return;
  }
  const earlier = receipts.get(agentId);
  if (earlier?.canFocus()) {
    host.focus(earlier);
    return;
  }
  setOpening(agentId, true);
  setError(agentId, null);
  try {
    const result = await host.open(agentId, offer.command);
    if (result.kind === "spawned") {
      receipts.set(agentId, result.receipt);
      pending.add(agentId);
      startWatching();
    } else if (result.kind === "failed") {
      setError(agentId, result.message);
    }
  } catch (cause) {
    console.error("Install host failed:", cause);
    setError(agentId, OPEN_FAILED);
  } finally {
    setOpening(agentId, false);
  }
}

/** Test seam. The app never calls this; the suite clears module state. */
export function resetAgentInstallForTests(): void {
  stopWatching?.();
  hostSignal.value = null;
  opening.value = new Set();
  errors.value = new Map();
  receipts.clear();
  pending.clear();
}
