import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// Each wrapper sources the user's own file with ZDOTDIR pointing at the user's folder, so their config sees
// the usual value. .zshrc hands ZDOTDIR back for good (the user's .zlogin then loads normally) and adds the hook.
const passThrough = (file: string): string =>
  [
    '__agent_monitor_dir="$ZDOTDIR"',
    'ZDOTDIR="${AGENT_MONITOR_ZDOTDIR:-$HOME}"',
    `[[ -r "$ZDOTDIR/${file}" ]] && builtin source "$ZDOTDIR/${file}"`,
    'AGENT_MONITOR_ZDOTDIR="$ZDOTDIR"',
    'ZDOTDIR="$__agent_monitor_dir"',
    'unset __agent_monitor_dir',
    '',
  ].join('\n')

export const ZSH_FILES: Record<string, string> = {
  '.zshenv': passThrough('.zshenv'),
  '.zprofile': passThrough('.zprofile'),
  '.zshrc': [
    'ZDOTDIR="${AGENT_MONITOR_ZDOTDIR:-$HOME}"',
    'unset AGENT_MONITOR_ZDOTDIR',
    '[[ -r "$ZDOTDIR/.zshrc" ]] && builtin source "$ZDOTDIR/.zshrc"',
    "__agent_monitor_cwd() { builtin printf '\\e]7;file://%s%s\\e\\\\' \"$HOST\" \"$PWD\" }",
    'autoload -Uz add-zsh-hook && add-zsh-hook precmd __agent_monitor_cwd',
    '',
  ].join('\n'),
  // Only reached by a non-interactive login shell, where .zshrc never ran to hand ZDOTDIR back.
  '.zlogin': [
    'ZDOTDIR="${AGENT_MONITOR_ZDOTDIR:-$HOME}"',
    'unset AGENT_MONITOR_ZDOTDIR',
    '[[ -r "$ZDOTDIR/.zlogin" ]] && builtin source "$ZDOTDIR/.zlogin"',
    '',
  ].join('\n'),
}

/** Writes the zsh wrappers (only when changed); false when the folder is not writable, so zsh runs unhooked. */
export function writeShellInit(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true })
    for (const [name, body] of Object.entries(ZSH_FILES)) {
      const file = path.join(dir, name)
      let current = ''
      try {
        current = readFileSync(file, 'utf8')
      } catch {
        // first run
      }
      if (current !== body) writeFileSync(file, body, { mode: 0o644 })
    }
    return true
  } catch {
    return false
  }
}
