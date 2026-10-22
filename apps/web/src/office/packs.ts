import type { RoomTheme } from '@ccm/habblaud/client/src/art/api'
import { parseRoomThemes } from '@ccm/habblaud/client/src/art/theme'

export const CLASSIC_PACK = 'classic'
export const OFFICE_PACK_KEY = 'ccm.office.pack'
export const PACK_INDEX_URL = '/assets/themes/index.json'

const PACK_ID = /^[a-z0-9-]{3,24}$/
const PREVIEW = /^themes\/[a-z0-9-]{3,24}\/[a-z0-9-]+\.png$/
const NAME_MAX = 40

export interface OfficePackEntry {
  id: string
  name: { en: string; vi: string }
  preview: string | null
}

export interface LoadedOfficePack {
  id: string
  assetPack: string | undefined
  rooms: RoomTheme[] | null
}

export const isPackId = (v: unknown): v is string => typeof v === 'string' && PACK_ID.test(v)

export function readOfficePack(): string {
  try {
    const raw = localStorage.getItem(OFFICE_PACK_KEY)
    return isPackId(raw) ? raw : CLASSIC_PACK
  } catch {
    return CLASSIC_PACK
  }
}

function packName(raw: unknown): { en: string; vi: string } | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const ok = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= NAME_MAX
  return ok(o.en) && ok(o.vi) ? { en: o.en.trim(), vi: o.vi.trim() } : null
}

export function parsePackIndex(raw: unknown): OfficePackEntry[] {
  if (!Array.isArray(raw)) return []
  const out: OfficePackEntry[] = []
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue
    const o = e as Record<string, unknown>
    if (!isPackId(o.id) || o.id === CLASSIC_PACK || out.some((p) => p.id === o.id)) continue
    const name = packName(o.name)
    if (!name) continue
    const preview = typeof o.preview === 'string' && PREVIEW.test(o.preview) ? `/assets/${o.preview}` : null
    out.push({ id: o.id, name, preview })
  }
  return out
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  try {
    const res = await fetch(url, { signal, cache: 'no-cache' })
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null
    return (await res.json()) as unknown
  } catch {
    return null
  }
}

export async function fetchPackIndex(signal?: AbortSignal): Promise<OfficePackEntry[]> {
  return parsePackIndex(await getJson(PACK_INDEX_URL, signal))
}

export function resolvePack(id: string, index: readonly OfficePackEntry[]): string {
  return id !== CLASSIC_PACK && index.some((p) => p.id === id) ? id : CLASSIC_PACK
}

export async function loadOfficePack(id: string, signal?: AbortSignal): Promise<LoadedOfficePack> {
  if (id === CLASSIC_PACK || !isPackId(id)) return { id: CLASSIC_PACK, assetPack: undefined, rooms: null }
  const theme = await getJson(`/assets/themes/${id}/theme.json`, signal)
  const rooms = theme && typeof theme === 'object' ? parseRoomThemes((theme as Record<string, unknown>).rooms) : null
  return { id, assetPack: `themes/${id}`, rooms }
}
