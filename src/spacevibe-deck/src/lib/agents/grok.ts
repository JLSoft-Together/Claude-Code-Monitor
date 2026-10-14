import { unreadAgent } from "./agent-definition";

/**
 * xAI's Grok Build. Its installer also links a second command, `agent`, to the
 * same binary; Deck probes only `grok`. Added 2026-10-03 without its CLI
 * installed, so no flag is read off `grok --help`: see `unreadAgent`.
 */
export const GROK = unreadAgent({
  id: "grok",
  label: "Grok Build",
  url: "https://x.ai/cli",
  // Read off the vendor's repository README: x.ai/cli answers 403 to a scripted fetch.
  install: {
    macos: {
      command: "curl -fsSL https://x.ai/cli/install.sh | bash",
      source: "https://github.com/xai-org/grok-build/blob/main/README.md",
      checked: "2026-10-10",
    },
    windows: {
      command: "irm https://x.ai/cli/install.ps1 | iex",
      source: "https://github.com/xai-org/grok-build/blob/main/README.md",
      checked: "2026-10-10",
    },
  },
});
