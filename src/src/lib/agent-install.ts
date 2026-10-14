/**
 * Whether a missing built-in agent offers `Install`, `Get` or nothing. Pure —
 * no signals, no host, no DOM — so every surface asks one function and the
 * rules below cannot drift apart between them.
 */
import type { BuiltinAgent } from "./agents/agent-definition";
import type { DesktopPlatform } from "./platform";

export type InstallOffer =
  | { readonly kind: "install"; readonly command: string }
  | { readonly kind: "get"; readonly url: string }
  | { readonly kind: "none" };

/** The agent's command for this OS, or null (`unsupported`, no `install`, or `null` entry). */
export function installCommandFor(agent: BuiltinAgent, platform: DesktopPlatform): string | null {
  if (platform === "unsupported") {
    return null;
  }
  return agent.install?.[platform]?.command ?? null;
}

export interface InstallOfferInput {
  /** The active built-in with this id, or undefined (custom, stale or withdrawn id). */
  readonly agent: BuiltinAgent | undefined;
  readonly platform: DesktopPlatform;
  /** The host can open the install pane. */
  readonly available: boolean;
  /** A probe has settled (`agentsProbed`). */
  readonly probed: boolean;
  /** Not in `settings.disabledAgents`. */
  readonly enabled: boolean;
  /** The probe found this agent's binary. */
  readonly found: boolean;
  /** E2E seam result; replaces a NON-null command only. */
  readonly commandOverride?: string;
}

/**
 * `none` unless: agent is a built-in, platform is `macos` or `windows`, available,
 * probed, enabled and not found. Then `install` with the (overridden) command when
 * one exists for the platform, else `get` with `agent.url`.
 */
export function installOffer(input: InstallOfferInput): InstallOffer {
  const { agent, platform } = input;
  if (
    agent === undefined ||
    platform === "unsupported" ||
    !input.available ||
    !input.probed ||
    !input.enabled ||
    input.found
  ) {
    return { kind: "none" };
  }
  const command = installCommandFor(agent, platform);
  if (command === null) {
    return { kind: "get", url: agent.url };
  }
  return { kind: "install", command: input.commandOverride ?? command };
}
