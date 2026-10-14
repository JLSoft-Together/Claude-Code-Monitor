import { unreadAgent } from "./agent-definition";

/**
 * Kiro CLI, successor to Amazon Q Developer CLI. The binary is `kiro-cli`. Added 2026-10-03 without its CLI installed, so
 * no flag is read off `kiro-cli --help`: see `unreadAgent`.
 */
export const KIRO = unreadAgent({
  id: "kiro-cli",
  label: "Kiro",
  url: "https://kiro.dev/cli",
  // The install scripts; the page's Homebrew cask was the alternative.
  install: {
    macos: {
      command: "curl -fsSL https://cli.kiro.dev/install | bash",
      source: "https://kiro.dev/docs/getting-started/installation/",
      checked: "2026-10-10",
    },
    windows: {
      command: "irm 'https://cli.kiro.dev/install.ps1' | iex",
      source: "https://kiro.dev/docs/getting-started/installation/",
      checked: "2026-10-10",
    },
  },
});
