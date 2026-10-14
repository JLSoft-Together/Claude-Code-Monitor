import { unreadAgent } from "./agent-definition";

/**
 * Mistral Vibe CLI. It installs through `uv`, so classifying its process by
 * binary name is unverified. Added 2026-10-03 without its CLI installed, so no
 * flag is read off `vibe --help`: see `unreadAgent`.
 */
export const VIBE = unreadAgent({
  id: "vibe",
  label: "Mistral Vibe",
  url: "https://docs.mistral.ai/vibe/code/cli/",
  install: {
    macos: {
      command: "curl -LsSf https://mistral.ai/vibe/install.sh | bash",
      source: "https://github.com/mistralai/mistral-vibe/blob/main/README.md",
      checked: "2026-10-10",
    },
    // null: the README's Windows route is two steps (install uv, then `uv tool install
    // mistral-vibe`), not one vendor command, and the second needs the first's PATH change.
    windows: null,
  },
});
