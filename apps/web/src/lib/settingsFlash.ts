const HIDDEN_ROWS = new Set(['disk', 'phone'])
const TRIES = 25
const EVERY_MS = 40
const FLASH_MS = 1400

/** Settings opens on its page a tick or two after the request, so the row is awaited rather than assumed. */
export function flashSettingRow(id: string, root: ParentNode = document): void {
  let tries = 0
  const look = (): void => {
    if (HIDDEN_ROWS.has(id)) root.querySelector<HTMLElement>('[data-notify-more][aria-expanded="false"]')?.click()
    const row = root.querySelector<HTMLElement>(`[data-setting-row="${id}"]`)
    if (!row) {
      if (++tries < TRIES) window.setTimeout(look, EVERY_MS)
      return
    }
    row.scrollIntoView({ block: 'center' })
    row.classList.add('ccm-setting-flash')
    window.setTimeout(() => row.classList.remove('ccm-setting-flash'), FLASH_MS)
  }
  window.setTimeout(look, EVERY_MS)
}
