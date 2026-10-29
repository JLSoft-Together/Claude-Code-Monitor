import type { BackupApplyResult, BackupExportResult, BackupPreview, BackupSectionId } from '@ccm/shared'
import { desktop } from './desktop'

/** v74 Settings › Backup bridge (`ccmDesktop.backup`); main reads localStorage and the data folder itself. */
interface BackupBridge {
  export: () => Promise<BackupExportResult>
  pick: () => Promise<BackupPreview>
  apply: (token: string, sections: BackupSectionId[]) => Promise<BackupApplyResult>
  relaunch: () => Promise<boolean>
}

export const backupBridge: BackupBridge | undefined = (desktop as unknown as { backup?: BackupBridge } | undefined)?.backup
export const hasBackup = typeof backupBridge?.export === 'function'

export const TOKEN_REMINDER_KEY = 'ccm.backup.tokenReminder'

/** Writes only `ccm.*` keys that are not the backup's own; returns how many were written. */
export function writeLocal(entries: Record<string, string>, storage: Pick<Storage, 'setItem'> = localStorage): number {
  let n = 0
  for (const [k, v] of Object.entries(entries)) {
    if (!k.startsWith('ccm.') || k.startsWith('ccm.backup.') || typeof v !== 'string') continue
    try {
      storage.setItem(k, v)
      n++
    } catch {
      // quota: the rest still goes in
    }
  }
  return n
}

export function readReminder(storage: Pick<Storage, 'getItem'> = localStorage): string[] {
  try {
    const v: unknown = JSON.parse(storage.getItem(TOKEN_REMINDER_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 20) : []
  } catch {
    return []
  }
}

export function toggleSection(selected: ReadonlySet<BackupSectionId>, id: BackupSectionId): Set<BackupSectionId> {
  const next = new Set(selected)
  if (!next.delete(id)) next.add(id)
  return next
}
