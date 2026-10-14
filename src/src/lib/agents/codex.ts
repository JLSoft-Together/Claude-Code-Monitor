import { toggle, valued, type AgentDefinition } from "./agent-definition";

const SANDBOX = ["--sandbox", "-s"];
const APPROVAL = ["--ask-for-approval", "-a"];

/**
 * Codex 0.154's TUI animates while idle: a startup spinner and a starfield
 * behind the composer, repainted ~12 times a second for as long as the pane
 * sits at its prompt (measured 2026-09-18, DECK-121). Deck's sustained-output
 * heuristic cannot tell that from a working agent, so every Codex row showed
 * the busy bars before the first prompt and kept them after the last reply.
 * `tui.animations=false` is Codex's own switch for it; with it the pane goes
 * silent 2.6 s after launch and stays silent at the prompt. Carried on every
 * command Deck types, resume included, so a restored pane behaves the same.
 * A user-written launch command does not inherit it — the `quiet` control
 * below and `docs/user/agents.md` say what to add.
 */
const NO_ANIMATIONS_FORM = ["-c", "tui.animations=false"] as const;
const NO_ANIMATIONS = NO_ANIMATIONS_FORM.join(" ");

/**
 * Codex. Launch flags read off `codex --help` 0.154.0 on 2026-09-11; model on
 * 2026-08-24 (`-m, --model <MODEL>`, no effort flag).
 */
export const CODEX: AgentDefinition = {
  id: "codex",
  label: "Codex",
  defaultCommand: `codex --dangerously-bypass-approvals-and-sandbox ${NO_ANIMATIONS}`,
  url: "https://developers.openai.com/codex/cli",
  // The README's standalone installers; npm and Homebrew were the alternatives.
  install: {
    macos: {
      command: "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
      source: "https://github.com/openai/codex/blob/main/README.md",
      checked: "2026-10-10",
    },
    windows: {
      command:
        'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"',
      source: "https://github.com/openai/codex/blob/main/README.md",
      checked: "2026-10-10",
    },
  },
  dotColor: "var(--green)",
  resume: {
    id: (id) => `codex resume ${id} ${NO_ANIMATIONS}`,
    latest: `codex resume --last ${NO_ANIMATIONS}`,
    bare: `codex ${NO_ANIMATIONS}`,
  },
  runtime: { modelFlag: "--model", models: [], effortFlag: null, efforts: [] },
  launchFlags: [
    toggle(
      "bypass",
      "No approvals or sandbox",
      "Skip every approval and run commands without a sandbox.",
      ["--dangerously-bypass-approvals-and-sandbox"],
    ),
    toggle("approveForMe", "Auto review", "Route approval requests through automatic review.", [
      "--approve-for-me",
    ]),
    {
      id: "sandbox",
      label: "Sandbox",
      desc: "Where model-generated commands may write.",
      kind: "menu",
      options: [
        valued(SANDBOX, "read-only", "Read only"),
        valued(SANDBOX, "workspace-write", "Workspace write"),
        valued(SANDBOX, "danger-full-access", "Full access"),
      ],
    },
    {
      id: "approval",
      label: "Approval policy",
      desc: "When Codex stops to ask before running a command.",
      kind: "menu",
      options: [valued(APPROVAL, "on-request", "On request"), valued(APPROVAL, "never", "Never")],
    },
    toggle("search", "Web search", "Let the model search the web without asking.", ["--search"]),
    toggle("inline", "Inline mode", "Keep terminal scrollback instead of an alternate screen.", [
      "--no-alt-screen",
    ]),
    toggle(
      "quiet",
      "No idle animations",
      "Turn off the startup spinner and the prompt background, which Deck would otherwise read as work in progress.",
      NO_ANIMATIONS_FORM,
      ["--config", "tui.animations=false"],
    ),
  ],
};
