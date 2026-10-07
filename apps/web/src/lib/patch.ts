export function applyPatch<T extends object>(target: T, patch: object): void {
  const record = target as Record<string, unknown>
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'id') continue
    if (value === null || value === undefined) delete record[key]
    else record[key] = value
  }
}
