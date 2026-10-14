import { unreadAgent } from "./agent-definition";

/**
 * GitHub Copilot CLI (npm `@github/copilot`). Not `gh copilot`, which is a
 * different tool. Added 2026-10-03 without its CLI installed, so no flag is
 * read off `copilot --help`: see `unreadAgent`.
 */
export const COPILOT = unreadAgent({
  id: "copilot",
  label: "GitHub Copilot",
  url: "https://docs.github.com/copilot/concepts/agents/about-copilot-cli",
  // macOS: the install script. Windows has no script; npm is first in Deck's order, WinGet
  // (`winget install GitHub.Copilot`) is the documented alternative.
  install: {
    macos: {
      command: "curl -fsSL https://gh.io/copilot-install | bash",
      source: "https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli",
      checked: "2026-10-10",
    },
    windows: {
      command: "npm install -g @github/copilot",
      source: "https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli",
      checked: "2026-10-10",
    },
  },
});
