/**
 * Settings → Agents — the data the Launch chapter's catalog widget reads, and
 * the installed set the Quick Launch widget offers.
 *
 * Nothing here is typed in by hand. The commands come out of the app's own
 * resolution, `agentLaunchCommand` (`src/lib/launch-command.ts:66`), the
 * function the launch path and `LaunchProfileEditor`'s `effectiveCommand` both
 * call (`src/ui/settings/launch-profile-editor.tsx:101`), so the row prints
 * what a pane types: the catalog's shipped `defaultCommand`, else the bare
 * binary. The split into a binary and its flags is `CommandLine`'s own
 * (`commandAgentId` / `commandFlags`, :79). The Install / Get answer is
 * `installOffer` (`src/lib/agent-install.ts:43-60`) asked for macOS: every
 * active agent has a verified macOS command, so every missing row reads
 * `Install`; `Get` shows only where a platform has none (Amp and Vibe on
 * Windows).
 *
 * The app stopped drawing a star, a "Set default" control and a ↗ link on
 * installed rows on 2026-08-19 (`launch-profile-editor.tsx:55-58`); a row
 * carries an on/off switch (`EnabledToggle`, :109) and, when the agent is
 * missing, `Install` or `Get`. The headers are `n detected` and `n agents`
 * (:492, :516).
 */

import { AGENT_MARKS } from "../../agent-strip.js";
import { installOffer } from "../../../../../src/lib/agent-install.ts";
import { BUILTIN_AGENTS } from "../../../../../src/lib/agent-catalog.ts";
import { agentLaunchCommand } from "../../../../../src/lib/launch-command.ts";
import { commandAgentId, commandFlags } from "../../../../../src/lib/launch-profile.ts";

/** The imaginary machine's probe: these three binaries are on `$PATH`. */
const INSTALLED_IDS = new Set(["claude", "codex", "opencode"]);

const BUILTIN_BY_ID = new Map(BUILTIN_AGENTS.map((agent) => [agent.id, agent]));

function toRow(mark) {
  const found = INSTALLED_IDS.has(mark.id);
  const command = agentLaunchCommand(mark.id, [], {}) ?? mark.id;
  const offer = installOffer({
    agent: BUILTIN_BY_ID.get(mark.id),
    platform: "macos",
    available: true,
    probed: true,
    enabled: true,
    found,
  });

  return {
    id: mark.id,
    label: mark.label,
    mark,
    found,
    binary: commandAgentId(command),
    flags: commandFlags(command),
    offer: offer.kind,
  };
}

const ROWS = AGENT_MARKS.map(toRow);

/** `installed` in the registry's order — the digit-key contract, never re-sorted. */
export const INSTALLED = ROWS.filter((row) => row.found);

/** `available`, every agent Deck can launch that the probe did not find. */
export const AVAILABLE = ROWS.filter((row) => !row.found);
