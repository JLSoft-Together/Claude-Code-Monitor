import type { ChangeEntry } from './preview'

export type CompareMode = 'side' | 'slider' | 'onion'
export const COMPARE_MODES: readonly CompareMode[] = ['side', 'slider', 'onion']

const IMAGE = /\.(?:png|jpe?g|gif|webp|svg|bmp)$/i

export const isImagePath = (path: string): boolean => IMAGE.test(path)

/** Which versions exist: the HEAD copy (under `origPath` after a rename) and / or the working copy. */
export function imageSides(entry: Pick<ChangeEntry, 'kind' | 'path' | 'origPath'>): { old: string | null; new: boolean } {
  switch (entry.kind) {
    case 'added':
    case 'untracked':
      return { old: null, new: true }
    case 'deleted':
      return { old: entry.path, new: false }
    case 'renamed':
      return { old: entry.origPath ?? entry.path, new: true }
    default:
      return { old: entry.path, new: true }
  }
}

export const clampPercent = (n: number): number => (Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 50)

export const readMode = (raw: string | null): CompareMode => (COMPARE_MODES.includes(raw as CompareMode) ? (raw as CompareMode) : 'side')
