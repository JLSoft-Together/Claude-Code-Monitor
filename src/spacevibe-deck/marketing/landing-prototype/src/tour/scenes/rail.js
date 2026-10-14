/**
 * The Watch chapter's rail widget: a slice of the 2.10 tree rail, in the
 * cluster shape `stage-tree.js` draws (`renderCluster`) — project → checkout →
 * session row — so the widget is the hero's rail, not a second drawing of it.
 *
 * Naming follows the app, not the folders (`buildCardEntries`,
 * `src/ui/agent-rail-card-model.ts:237-250`): a row's first line is its task
 * label, or the agent's name where the agent has no prompt source; its second
 * opens with the agent's name, then the agent's last sentence — or, when it
 * has said nothing the rail can read, the state word (`stateWord`, :141-152).
 *
 * Only Claude Code, Codex and OpenCode produce a sentence
 * (`docs/internals/agent-rail.md:147-150`). Gemini and Antigravity have no
 * session scan, so their rows carry no `sentence`: the renderer falls back to
 * the state word, `Gemini · Needs you`, exactly as the app prints it.
 *
 * One row per state the badge paints (`working`, `done`, `failed`, `asked`),
 * and the same afternoon the hero shows: the focused Claude row is the one
 * inverted block (DL-27.22), and nothing here has an `id` because a widget
 * mounts no stream.
 */

import { deepFreeze } from "../../product-stage.js";

export const RAIL_CLUSTERS = deepFreeze([
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
            agent: "codex",
            label: "Run the e2e suite before merge",
            sentence: "e2e · 3 failed in pane-detach.spec",
            state: "failed",
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
        rows: [{ agent: "gemini", state: "asked" }],
      },
    ],
  },
]);
