/**
 * The hero's window as Deck 2.10 draws it in the middle of a working day
 * (owner, 2026-10-12: "a session in focus, with many workspaces at work"):
 * four projects in the rail, two checkouts of the one in front, and the
 * focused space's three agents on the stage.
 *
 * Read by `stage-tree.js`'s renderers through the hero. English-only, like
 * every stage fixture: the window mirrors the released app whatever the page
 * locale.
 *
 * Naming follows the app, not the folders. A row's first line is its task
 * label — the session's first prompt for Claude Code and Codex, the agent's
 * name for an agent with no prompt source (OpenCode, Gemini) — and its second
 * opens with the agent's name (`buildCardEntries`). The focused space is
 * unnamed, so the strip prints the project once and ends on the focused
 * session's prompt (`space-bar.tsx`).
 *
 * Motion budget (2026-10-10, kept): the focused Claude row is the one working
 * row and its pane holds a mid-run frame; every other row rests at done, and
 * the hero's beat only ever turns one of them `asked` and back. Rows with an
 * `id` are the ones the beat writes; the focused space's rows have none, so a
 * pane on the stage never disagrees with its own row.
 */

import { deepFreeze, stagePanes } from "./stage-data.js";

export const sessionRail = deepFreeze([
  {
    project: "spacevibe-deck",
    checkouts: [
      {
        name: "main",
        rows: [
          {
            agent: "claude",
            label: "Fix the pane divider drift on resize",
            sentence: "The ratio rounds to integer cells before the flex pass.",
            state: "working",
            focused: true,
          },
          {
            agent: "codex",
            label: "Stop the flicker when a pane closes",
            sentence: "96 passed · 0 failed",
            state: "done",
          },
          {
            agent: "opencode",
            sentence: "typecheck clean · the branch follows cwd now",
            state: "done",
          },
        ],
      },
      {
        name: "feat/detach",
        worktree: true,
        rows: [
          {
            id: "detach-codex",
            agent: "codex",
            label: "Run the e2e suite before merge",
            sentence: "e2e · 48 passed",
            state: "done",
          },
          {
            id: "detach-claude",
            agent: "claude",
            label: "Detach a pane into its own window",
            sentence: "Moved the PTY handoff behind one IPC call.",
            state: "done",
          },
        ],
      },
    ],
  },
  {
    project: "spacevibe-api",
    checkouts: [
      {
        name: "main",
        rows: [
          {
            id: "api-claude",
            agent: "claude",
            label: "Batch the artifact uploads",
            sentence: "Uploads now go out in one R2 write.",
            state: "done",
          },
          {
            agent: "codex",
            label: "Rename the leaderboard export columns",
            sentence: "Renamed 6 columns · the migration is ready.",
            state: "done",
          },
          { agent: "gemini", state: "done" },
        ],
      },
    ],
  },
  { project: "spacevibe-hub", collapsed: true, needs: 1 },
  { project: "spacevibe-bench", collapsed: true },
]);

/** The rail foot's one usage line: each agent's window closest to its limit. */
export const sessionUsage = deepFreeze([
  { agent: "Claude", percent: 42, window: "5h" },
  { agent: "Codex", percent: 18, window: "7d" },
]);

/** The strip for the focused space: `spacevibe-deck › main › <its first prompt>`. */
export const sessionStrip = deepFreeze({
  crumbs: ["spacevibe-deck", "main"],
  session: "Fix the pane divider drift on resize",
  servers: 2,
});

const [claudeScript, codexScript, opencodeScript] = stagePanes;

/** The step index of Claude's last `think`: its frame holds the test run in progress. */
const CLAUDE_TESTING = claudeScript.steps.findLastIndex((step) => step.kind === "think") + 1;

/**
 * The focused space's panes, left column top to bottom, then the right one.
 * `header` is the pane's sentence, the same text its rail row prints.
 * `history` is the earlier turn each session printed above its script: these
 * are sessions an hour into the day, so their panes are full and scrolled,
 * not fresh.
 */
export const sessionPanes = deepFreeze([
  {
    pane: claudeScript,
    agent: "claude",
    header: "The ratio rounds to integer cells before the flex pass.",
    focused: true,
    until: CLAUDE_TESTING,
    history: [
      { text: "● Done — the tab strip no longer jumps when a chip closes.", cls: "t-body" },
      { text: "  ⎿ 3 files changed · 41 tests passed", cls: "t-dim" },
      { text: "> fix the pane divider drift on resize", cls: "t-user" },
    ],
  },
  {
    pane: codexScript,
    agent: "codex",
    header: "96 passed · 0 failed",
    history: [
      { text: "› add a test for the close path", cls: "t-user" },
      { text: "codex", cls: "t-agent" },
      { text: "Added pane-lifecycle.test.ts with the close and detach cases.", cls: "t-body" },
      { text: "✓ 94 passed · 0 failed", cls: "t-ok" },
    ],
  },
  {
    pane: opencodeScript,
    agent: "opencode",
    header: "typecheck clean · the branch follows cwd now",
    maxLines: 24,
    history: [
      { text: "> where does the branch label get its value?", cls: "t-user" },
      { text: "From the git watcher: it reads HEAD and publishes", cls: "t-body" },
      { text: "head-changed; the status bar subscribes to it.", cls: "t-body" },
      { text: "read src/lib/git-watch.ts", cls: "t-tool" },
      { text: "read src/ui/status-bar.tsx", cls: "t-tool" },
      { text: "> rename the git watcher's events to match the store", cls: "t-user" },
      { text: "Renamed four events and updated both subscribers.", cls: "t-body" },
      { text: "edit src/lib/git-watch.ts", cls: "t-tool" },
      { text: "  ~ head-changed → branch-changed", cls: "t-dim" },
      { text: "✓ typecheck clean", cls: "t-ok" },
      { text: "> run the store tests too", cls: "t-user" },
      { text: "✓ 37 passed · 0 failed", cls: "t-ok" },
      { text: "> what still reads the old branch field?", cls: "t-user" },
      { text: "Only the status bar and one test fixture.", cls: "t-body" },
      { text: "grep branchName src/", cls: "t-tool" },
      { text: "  2 matches in 2 files", cls: "t-dim" },
    ],
  },
]);
