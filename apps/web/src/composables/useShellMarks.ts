import { computed, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { ClipboardCopy, Copy, RotateCw, SendHorizontal } from 'lucide-vue-next'
import type { IDecoration, IDisposable, IMarker, Terminal } from '@xterm/xterm'
import { shortPath } from '../lib/format'
import type { MenuEntry, Rect } from '../lib/menu'
import { handoffPaneFor } from '../lib/runUi'
import { CommandTracker, elapsedText, LONG_COMMAND_MS, outputPrompt, parseMark, type ShellCommand } from '../lib/shellMarks'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import { useWorkspaceStore } from '../stores/workspace'

export interface ShellMarksHost {
  paneKey: () => string
  paneTitle: () => string
  cwd: () => string | null | undefined
  running: () => boolean
  visible: () => boolean
  focused: () => boolean
  write: (text: string) => void
  notice: (text: string) => void
}

type Cmd = ShellCommand<IMarker> & { deco?: IDecoration }

// A reconnect replays the scrollback: commands in it end instantly, with no real duration and no notification.
const REPLAY_MS = 1500
const ICON_OK = '<path d="M20 6 9 17l-5-5"/>'
const ICON_FAIL = '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'

/** Command marks (OSC 633) of a shell pane: gutter decorations, ⌘/Ctrl+↑↓ jumps, per-command actions. */
export function useShellMarks(host: ShellMarksHost) {
  const { t } = useI18n()
  const settings = useSettingsStore()
  const workspace = useWorkspaceStore()
  const ui = useUiStore()

  let term: Terminal | null = null
  let nonce: string | null = null
  let replayUntil = 0
  let atPrompt = false
  const handlers: IDisposable[] = []
  const active = ref(false)
  const menu = shallowRef<{ at: Rect; cmd: Cmd; trigger: HTMLElement } | null>(null)
  const tracker = new CommandTracker<IMarker>(undefined, (c) => {
    ;(c as Cmd).deco?.dispose()
    if (menu.value?.cmd === c) menu.value = null
  })

  function install(t: Terminal): void {
    term = t
    const onOsc = (data: string): boolean => (active.value ? (onMark(data), true) : false)
    handlers.push(t.parser.registerOscHandler(633, onOsc), t.parser.registerOscHandler(133, onOsc))
  }

  /** From the host's `ready`: the shell was started with marks keyed to this nonce. */
  function attach(si: string | undefined, replay: boolean): void {
    nonce = si ?? null
    active.value = !!nonce
    replayUntil = replay ? Date.now() + REPLAY_MS : 0
  }

  function reset(): void {
    tracker.clear()
    menu.value = null
    atPrompt = false
    nonce = null
    active.value = false
  }

  function dispose(): void {
    reset()
    for (const h of handlers.splice(0)) h.dispose()
    term = null
  }

  function marker(): IMarker | null {
    return term?.registerMarker(0) ?? null
  }

  function onMark(data: string): void {
    const mark = parseMark(data)
    const b = term?.buffer.active
    if (!mark || !term || !b || b.type !== 'normal') return
    if (mark.kind === 'commandLine') return tracker.commandLine(mark.command, !!nonce && mark.nonce === nonce)
    const m = marker()
    if (!m) return
    if (mark.kind === 'promptStart') {
      atPrompt = true
      tracker.promptStart(m)
    } else if (mark.kind === 'commandStart') {
      atPrompt = true
      tracker.commandStart(m, b.cursorX)
    } else if (mark.kind === 'executed') {
      atPrompt = false
      tracker.executed(m, Date.now(), () => typedText(m))
    } else {
      const cmd = tracker.finished(mark.exitCode, m, Date.now(), Date.now() < replayUntil) as Cmd | null
      if (!cmd) return
      decorate(cmd)
      cmd.output?.onDispose(() => tracker.drop(cmd))
      maybeNotify(cmd)
    }
  }

  function typedText(executed: IMarker): string {
    const cur = tracker.current
    const start = cur?.start
    return start && !start.isDisposed ? rangeText(start.line, executed.line, cur.startX) : ''
  }

  function rangeText(from: number, to: number, fromX = 0): string {
    const b = term?.buffer.active
    if (!b || from < 0) return ''
    let out = ''
    for (let y = from; y < Math.max(to, from + 1); y++) {
      const line = b.getLine(y)
      if (!line) continue
      if (y > from && !line.isWrapped) out += '\n'
      out += line.translateToString(true, y === from ? fromX : 0)
    }
    return out
  }

  function outputOf(cmd: Cmd): string {
    if (!cmd.output || cmd.output.isDisposed || !cmd.end || cmd.end.isDisposed) return ''
    return rangeText(cmd.output.line, cmd.end.line).replace(/\s+$/, '')
  }

  function statusText(cmd: Cmd): string {
    const time = cmd.elapsedMs !== undefined ? elapsedText(cmd.elapsedMs) : null
    if (cmd.exitCode === 0) return time ? t('shellMarks.ok', { time }) : t('shellMarks.okNoTime')
    return time ? t('shellMarks.failed', { code: cmd.exitCode, time }) : t('shellMarks.failedNoTime', { code: cmd.exitCode })
  }

  function decorate(cmd: Cmd): void {
    const anchor = cmd.prompt ?? cmd.start ?? cmd.output
    if (!term || !anchor || anchor.isDisposed) return
    const deco = term.registerDecoration({ marker: anchor, width: 1, height: 1 })
    if (!deco) return
    cmd.deco = deco
    deco.onRender((el) => {
      // xterm re-applies `left` from the column on every render.
      el.style.left = '-14px'
      if (el.dataset.mark) return
      const ok = cmd.exitCode === 0
      el.dataset.mark = ok ? 'ok' : 'fail'
      el.setAttribute('data-shell-mark', '')
      el.setAttribute('role', 'button')
      const label = t('shellMarks.markLabel', { cmd: cmd.command.slice(0, 120), status: statusText(cmd) })
      el.setAttribute('aria-label', label)
      el.title = `${cmd.command.slice(0, 300)}\n${statusText(cmd)}`
      Object.assign(el.style, { width: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', pointerEvents: 'auto', color: ok ? 'var(--ccm-ansi-10)' : 'var(--ccm-ansi-9)' })
      el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ok ? ICON_OK : ICON_FAIL}</svg>`
      el.addEventListener('mousedown', (e) => e.stopPropagation())
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        openMenu(cmd, el)
      })
    })
  }

  function openMenu(cmd: Cmd, el: HTMLElement): void {
    if (menu.value?.cmd === cmd) return void (menu.value = null)
    const r = el.getBoundingClientRect()
    menu.value = { at: { left: r.left, right: r.right, top: r.top, bottom: r.bottom }, cmd, trigger: el }
  }

  const entries = computed<MenuEntry[]>(() => {
    const cmd = menu.value?.cmd
    if (!cmd) return []
    const multiline = cmd.command.includes('\n')
    const runHint = !cmd.trusted ? t('shellMarks.runAgainUntrusted') : multiline ? t('shellMarks.runAgainMultiline') : !atPrompt || !host.running() ? t('shellMarks.runAgainBusy') : undefined
    return [
      { id: 'copyCommand', label: t('shellMarks.copyCommand'), icon: Copy },
      { id: 'copyOutput', label: t('shellMarks.copyOutput'), icon: ClipboardCopy },
      { id: 'fillAgent', label: t('shellMarks.fillAgent'), icon: SendHorizontal, hint: t('shellMarks.fillAgentHint') },
      { separator: true },
      { id: 'runAgain', label: t('shellMarks.runAgain'), icon: RotateCw, disabled: !!runHint, hint: runHint },
    ]
  })

  function copy(text: string, done: string): void {
    void navigator.clipboard.writeText(text).then(
      () => host.notice(done),
      () => undefined,
    )
  }

  function pick(id: string): void {
    const cmd = menu.value?.cmd
    menu.value = null
    if (!cmd) return
    if (id === 'copyCommand') copy(cmd.command, t('shellMarks.copied'))
    else if (id === 'copyOutput') {
      const out = outputOf(cmd)
      if (out) copy(out, t('shellMarks.copiedOutput'))
      else host.notice(t('shellMarks.noOutput'))
    } else if (id === 'fillAgent') {
      const cwd = host.cwd() ?? null
      const pane = handoffPaneFor(workspace.panes, cwd)
      if (!pane) return host.notice(t('shellMarks.noAgent'))
      workspace.insertInto(pane.key, outputPrompt(cmd, outputOf(cmd), cwd ? shortPath(cwd) : ''))
    } else if (id === 'runAgain' && cmd.trusted && !cmd.command.includes('\n') && atPrompt && host.running()) {
      // The owner's own shell, on an explicit click: typed and run like any keystrokes, never an agent prompt.
      host.write(`${cmd.command}\r`)
      term?.scrollToBottom()
      term?.focus()
    }
  }

  function closeMenu(): void {
    const el = menu.value?.trigger
    menu.value = null
    if (el?.isConnected) term?.focus()
  }

  /** Scrolls to the previous / next command; false when there is nothing to jump to (the key goes to the shell). */
  function jump(dir: -1 | 1): boolean {
    const b = term?.buffer.active
    if (!term || !b || b.type !== 'normal' || !tracker.done.length) return false
    const target = tracker.near(b.viewportY, dir)
    if (target) term.scrollToLine((target.prompt ?? target.start ?? target.output)!.line)
    else if (dir > 0) term.scrollToBottom()
    return true
  }

  function maybeNotify(cmd: Cmd): void {
    if (cmd.elapsedMs === undefined || cmd.elapsedMs < LONG_COMMAND_MS) return
    if (host.visible() && host.focused() && document.hasFocus()) return
    if (!settings.notifyEnabled || !settings.notifyDone) return
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const key = host.paneKey()
    const name = cmd.command.length > 60 ? `${cmd.command.slice(0, 59)}…` : cmd.command
    try {
      const n = new Notification(t('shellMarks.toastTitle', { cmd: name }), {
        body: t('shellMarks.toastBody', { code: cmd.exitCode, time: elapsedText(cmd.elapsedMs), pane: host.paneTitle() }),
        tag: `ccm-shell-${key}`,
        icon: '/favicon.svg',
      })
      n.onclick = () => {
        window.focus()
        if (ui.view !== 'workspace') ui.setView('workspace')
        workspace.activate(key)
        n.close()
      }
    } catch {
      // Notifications unavailable; the mark in the gutter still shows the result.
    }
  }

  return { active, menu, entries, install, attach, reset, dispose, pick, closeMenu, jump }
}
