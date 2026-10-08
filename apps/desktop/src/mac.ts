import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { app, dialog, Menu } from 'electron'
import type { Strings } from './strings'

const MARK = '__CCM_PATH__'

/** Finder/Dock launches get launchd's minimal PATH; borrow the login shell's so node, git, code and claude resolve. */
export function adoptLoginShellPath(): void {
  const shell = process.env.SHELL || '/bin/zsh'
  const res = spawnSync(shell, ['-ilc', `printf '${MARK}%s${MARK}' "$PATH"`], {
    encoding: 'utf8',
    timeout: 5_000,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const found = new RegExp(`${MARK}(.*?)${MARK}`).exec(res.stdout ?? '')?.[1]
  if (!found) return
  const merged = new Set([...found.split(path.delimiter), ...(process.env.PATH ?? '').split(path.delimiter)].filter(Boolean))
  process.env.PATH = [...merged].join(path.delimiter)
}

/** Without an app menu macOS has no Cmd+C/V/Q/W. */
export function setMacMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]))
}

// Run from the mounted DMG or a translocated Downloads copy, the exe path baked into the status line bridge vanishes later.
/** True when the app moved itself and is relaunching from /Applications. */
export async function offerMoveToApplications(t: Strings): Promise<boolean> {
  if (!app.isPackaged || app.isInApplicationsFolder()) return false
  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: [t.moveConfirm, t.moveLater],
    defaultId: 0,
    cancelId: 1,
    message: t.moveTitle,
    detail: t.moveDetail,
  })
  if (response !== 0) return false
  try {
    return app.moveToApplicationsFolder()
  } catch {
    // Denied or failed: keep running from where we are.
    return false
  }
}
