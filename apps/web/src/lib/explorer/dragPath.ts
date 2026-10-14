/** Explorer rows dragged onto a terminal pane: absolute paths, one per line, under an app-only type. */
export const PATH_MIME = 'application/x-ccm-path'

type Transfer = Pick<DataTransfer, 'setData' | 'getData' | 'types' | 'effectAllowed'>

export function setDragPath(dt: Transfer | null, path: string): void {
  if (!dt) return
  dt.setData(PATH_MIME, path)
  dt.setData('text/plain', path)
  dt.effectAllowed = 'copy'
}

/** Only `types` is readable before the drop. */
export const hasDragPath = (dt: Pick<DataTransfer, 'types'> | null | undefined): boolean => !!dt && Array.from(dt.types).includes(PATH_MIME)

export function dragPaths(dt: Pick<DataTransfer, 'getData'> | null | undefined): string[] {
  if (!dt) return []
  return dt
    .getData(PATH_MIME)
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean)
}
