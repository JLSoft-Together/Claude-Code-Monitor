import { unreadAgent } from "./agent-definition";

/**
 * Moonshot AI's Kimi Code CLI. Added 2026-10-03 without its CLI installed, so
 * no flag is read off `kimi --help`: see `unreadAgent`.
 */
export const KIMI = unreadAgent({
  id: "kimi",
  label: "Kimi Code",
  url: "https://www.kimi.com/code",
  // The Kimi Code CLI repository's official script; npm and Homebrew were the alternatives.
  install: {
    macos: {
      command: "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash",
      source: "https://github.com/MoonshotAI/kimi-code/blob/main/README.md",
      checked: "2026-10-10",
    },
    windows: {
      command: "irm https://code.kimi.com/kimi-code/install.ps1 | iex",
      source: "https://github.com/MoonshotAI/kimi-code/blob/main/README.md",
      checked: "2026-10-10",
    },
  },
});
