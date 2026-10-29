export const BACKUP_SECTIONS = ['appearance', 'settings', 'workspace', 'notes', 'names', 'devices', 'run', 'updates', 'github'] as const
export type BackupSectionId = (typeof BACKUP_SECTIONS)[number]

export interface BackupSectionInfo {
  id: BackupSectionId
  count: number
  /** Absolute paths in this section that do not exist on this machine (preview only, capped). */
  missingPaths: string[]
}

export type BackupErrorCode = 'denied' | 'cancelled' | 'invalid' | 'too-large' | 'read' | 'write' | 'expired'
export type BackupFailure = { ok: false; error: BackupErrorCode }

export type BackupExportResult = { ok: true; file: string; sections: BackupSectionInfo[] } | BackupFailure

export type BackupPreview =
  | { ok: true; token: string; file: string; app: string; platform: string; createdAt: string; sections: BackupSectionInfo[]; github: string[] }
  | BackupFailure

/** `local` = the `ccm.*` localStorage entries of the chosen sections; the page writes them, then asks for the restart. */
export type BackupApplyResult = { ok: true; local: Record<string, string>; github: string[] } | BackupFailure
