/**
 * Session restore — the data the Keep chapter's restore widget reads.
 *
 * Two parts, both from the start screen's side of the feature
 * (`docs/internals/session-restore.md`): launch reopens nothing on its own, so
 * the board offers the previous session as one `Last session` line, and only
 * its `Reopen` runs the restore. Nothing is claimed about what comes back
 * beyond what the app does: each pane types its agent's own resume command;
 * scrollback and unsaved edits never restore.
 *
 * The line a restored pane gets is built by the app's own functions, not typed
 * out: `buildResumeCommand` (`src/lib/agent-resume.ts:79`) picks the CLI's
 * exact-resume form from the agent's file (`agents/claude.ts:31`,
 * `agents/codex.ts:46`, `agents/opencode.ts:32`), then `applyResumeFlags`
 * (`src/lib/launch-command.ts:100`) puts back the flags the pane was launched
 * with — Claude's only (its flags are global options that sit beside
 * `--resume`; the other two take theirs in positions it does not model) — and
 * the launch command it reads is the catalog's own default, recorded on every
 * pane that launched without a preset (`tab-manager.ts:1269-1285`). Codex's
 * `-c tui.animations=false` rides every command Deck types, resume included
 * (`agents/codex.ts:13-14`). So a restored Claude pane gets
 * `claude --resume <id> --dangerously-skip-permissions`, and a restored Codex
 * pane `codex resume <id> -c tui.animations=false` with no bypass flag.
 * Signal adapters are off by default (`settings-schema.ts:269`), so nothing
 * is appended at arm time.
 *
 * The session ids are shortened to fit a card; the command around them is not.
 */

import { agentLaunchCommand, applyResumeFlags } from "../../../../../src/lib/launch-command.ts";
import { buildResumeCommand } from "../../../../../src/lib/agent-resume.ts";

/** The previous session: three tabs across two projects, one pane each. */
const LAST_SESSION_TABS = 3;
const LAST_SESSION_WORKSPACES = ["spacevibe-deck", "spacevibe-api"];

/** `lastSessionMeta`, `src/open-board/board-composer.tsx:70-76`: `3 tabs · a, b`. */
export const LAST_SESSION_META = `${LAST_SESSION_TABS} tabs · ${LAST_SESSION_WORKSPACES.join(", ")}`;

const SESSIONS = [
  { agent: "claude", id: "0f3a91c2" },
  { agent: "codex", id: "019a4f1c" },
  { agent: "opencode", id: "3b77ae" },
];

/** What `session-restore.ts:214-218` types into each surviving pane. */
export const RESUME_LINES = SESSIONS.map(({ agent, id }) => ({
  agent,
  command: applyResumeFlags(
    buildResumeCommand(agent, { kind: "id", id }, []),
    agentLaunchCommand(agent, [], {}),
  ),
}));
