import { toggle, type AgentDefinition } from "./agent-definition";

/**
 * OpenCode. Launch flags read off `opencode --help` 1.18.30 on 2026-09-11;
 * model on 2026-08-24 (`-m, --model provider/model`, no effort flag).
 *
 * No default flag: opencode's `--auto` is opt-in per session and its prompts
 * are already coarse enough that skipping them is not the default anyone
 * wants. Its `--port`/`--hostname` are left out of the flags on purpose — the
 * signal adapter pins the port (`launch-augment.ts`).
 */
export const OPENCODE: AgentDefinition = {
  id: "opencode",
  label: "OpenCode",
  url: "https://opencode.ai",
  // macOS: the page's install script. Windows: the page recommends WSL and lists Chocolatey,
  // Scoop and npm for native; npm is the first of Deck's order (script, npm, other manager).
  install: {
    macos: {
      command: "curl -fsSL https://opencode.ai/install | bash",
      source: "https://opencode.ai/docs",
      checked: "2026-10-10",
    },
    windows: {
      command: "npm install -g opencode-ai",
      source: "https://opencode.ai/docs",
      checked: "2026-10-10",
    },
  },
  dotColor: "var(--yellow)",
  resume: {
    id: (id) => `opencode -s ${id}`,
    latest: "opencode -c",
    bare: "opencode",
  },
  runtime: { modelFlag: "--model", models: [], effortFlag: null, efforts: [] },
  launchFlags: [
    toggle("auto", "Auto-approve", "Approve permissions that are not explicitly denied.", [
      "--auto",
    ]),
    toggle("pure", "Without plugins", "Run without external plugins.", ["--pure"]),
    toggle("mini", "Minimal interface", "Start the minimal interactive interface.", ["--mini"]),
  ],
};
