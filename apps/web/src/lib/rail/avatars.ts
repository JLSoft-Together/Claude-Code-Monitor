/** Two letters for a project avatar: the last word of the name (`spacevibe-deck` → `De`). */
export function avatarInitials(name: string): string {
  const word = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean).pop()
  if (!word) return '?'
  return word[0]!.toUpperCase() + (word[1] ?? '').toLowerCase()
}
