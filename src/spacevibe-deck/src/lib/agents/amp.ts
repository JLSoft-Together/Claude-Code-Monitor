import { unreadAgent } from "./agent-definition";

/**
 * Amp, Sourcegraph's coding agent. Added 2026-10-03 without its CLI installed,
 * so no flag is read off `amp --help`: see `unreadAgent`.
 */
export const AMP = unreadAgent({
  id: "amp",
  label: "Amp",
  url: "https://ampcode.com",
  install: {
    macos: {
      command: "curl -fsSL https://ampcode.com/install.sh | bash",
      source: "https://ampcode.com/docs/cli",
      checked: "2026-10-10",
    },
    // null: the page says the CLI runs on Windows through WSL, and its Windows tab is not
    // in the served page, so no native command could be read.
    windows: null,
  },
});
