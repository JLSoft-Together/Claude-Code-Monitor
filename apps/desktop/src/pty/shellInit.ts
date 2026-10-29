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

// OSC 633;E payload escaping as VS Code does: `\`, `;` and newlines as \xNN, other control characters dropped.
const POSIX_ESCAPE = [
  '  __orrery_esc() {',
  "    local s=\"$1\" x=$'\\\\x' bs=$'\\\\' nl=$'\\n' cr=$'\\r' tab=$'\\t'",
  '    s=${s//"$bs"/${x}5c}',
  '    s=${s//";"/${x}3b}',
  '    s=${s//"$nl"/${x}0a}',
  '    s=${s//"$cr"/${x}0d}',
  '    s=${s//"$tab"/${x}09}',
  '    s=${s//[[:cntrl:]]/}',
  "    builtin printf '%s' \"$s\"",
  '  }',
]

/** Command marks for zsh, run after the user's .zshrc; only when the pane asked for them (nonce in the env). */
export const ZSH_INTEGRATION = [
  'if [[ -n "$ORRERY_SI_NONCE" ]]; then',
  "  typeset -g __orrery_nonce=\"$ORRERY_SI_NONCE\" __orrery_ran=''",
  '  unset ORRERY_SI_NONCE',
  ...POSIX_ESCAPE,
  '  __orrery_precmd() {',
  '    local s=$?',
  "    [[ -n $__orrery_ran ]] && builtin printf '\\e]633;D;%s\\a' \"$s\"",
  "    __orrery_ran=''",
  '  }',
  // Runs last, after themes (starship, powerlevel10k) rebuilt PS1 for this prompt.
  '  __orrery_prompt() {',
  "    [[ $PS1 == *$'\\e]633;B'* ]] || PS1=$'%{\\e]633;A\\a%}'\"$PS1\"$'%{\\e]633;B\\a%}'",
  '  }',
  '  __orrery_preexec() {',
  '    __orrery_ran=1',
  "    builtin printf '\\e]633;E;%s;%s\\a\\e]633;C\\a' \"$(__orrery_esc \"${1[1,2000]}\")\" \"$__orrery_nonce\"",
  '  }',
  '  precmd_functions=(__orrery_precmd $precmd_functions __orrery_prompt)',
  '  add-zsh-hook preexec __orrery_preexec',
  'fi',
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
    ZSH_INTEGRATION,
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

export const BASH_INIT_FILE = 'orrery-bash.sh'

/**
 * `bash --init-file` replaces the login sequence, so it reads the same files `bash -l` would, then wraps
 * PROMPT_COMMAND (status first, user's commands with `$?` restored) and adds the executed mark through PS0
 * (bash ≥ 4.4; older bash keeps running unhooked). The command line comes from history only when a new
 * entry appeared, so an ignored command never reports the previous one.
 */
export const BASH_INIT = [
  'if [ -r /etc/profile ]; then . /etc/profile; fi',
  'for __orrery_f in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do',
  '  if [ -r "$__orrery_f" ]; then . "$__orrery_f"; break; fi',
  'done',
  'unset __orrery_f',
  'if [[ -n "${ORRERY_SI_NONCE:-}" ]] && (( BASH_VERSINFO[0] > 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4) )); then',
  '  __orrery_nonce="$ORRERY_SI_NONCE"',
  '  __orrery_orig=("${PROMPT_COMMAND[@]}")',
  "  __orrery_hist=''",
  ...POSIX_ESCAPE,
  "  __orrery_histline() { HISTTIMEFORMAT='' builtin history 1 2>/dev/null; }",
  '  __orrery_preexec() {',
  '    local h',
  '    h="$(__orrery_histline)"',
  '    if [[ -n "$h" && "$h" != "$__orrery_hist" && "$h" =~ ^[[:space:]]*[0-9]+[*]?[[:space:]]+(.*)$ ]]; then',
  "      builtin printf '\\e]633;E;%s;%s\\a' \"$(__orrery_esc \"${BASH_REMATCH[1]:0:2000}\")\" \"$__orrery_nonce\"",
  '    fi',
  "    builtin printf '\\e]633;C\\a'",
  '  }',
  '  __orrery_precmd() {',
  '    local s=$? c',
  "    builtin printf '\\e]633;D;%s\\a' \"$s\"",
  '    for c in "${__orrery_orig[@]}"; do (exit "$s"); eval "$c"; done',
  '    __orrery_hist="$(__orrery_histline)"',
  "    [[ \"$PS1\" == *'633;B'* ]] || PS1='\\[\\e]633;A\\a\\]'\"$PS1\"'\\[\\e]633;B\\a\\]'",
  '  }',
  "  PS0=\"${PS0:-}\"'$(__orrery_preexec)'",
  '  unset PROMPT_COMMAND',
  '  PROMPT_COMMAND=__orrery_precmd',
  'fi',
  'unset ORRERY_SI_NONCE',
  '',
].join('\n')

const INIT_FILES: Record<string, string> = { ...ZSH_FILES, [BASH_INIT_FILE]: BASH_INIT }

/** Writes the zsh wrappers and the bash init file (only when changed); false when the folder is not writable, so shells run unhooked. */
export function writeShellInit(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true })
    for (const [name, body] of Object.entries(INIT_FILES)) {
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
