import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { ExtInstallRequest, ExtRemoveRequest, ExtResult, ExtSourceRequest, ExtStatus, McpServerRow } from '@ccm/shared'
import { desktop, hasTerminals } from '../lib/desktop'
import { useUiStore } from './ui'
import { useWorkspaceStore } from './workspace'

export type ExtMode = 'global' | 'project'

const KEY = 'ccm.ext'
/** Same charset ccm:ext-login accepts; the name is typed into a shell. */
const SERVER_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/
/** `claude mcp list` health-checks every server (seconds): coming back to the tab reuses a result this young. */
const MCP_FRESH_MS = 5 * 60_000

function load(): { mode: ExtMode; project: string | null } {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { mode?: unknown; project?: unknown }
    return { mode: raw.mode === 'project' ? 'project' : 'global', project: typeof raw.project === 'string' ? raw.project : null }
  } catch {
    return { mode: 'global', project: null }
  }
}

export const useExtensionsStore = defineStore('extensions', () => {
  const saved = load()
  const mode = ref<ExtMode>(saved.mode)
  const project = ref<string | null>(saved.project)
  watch([mode, project], () => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ mode: mode.value, project: project.value }))
    } catch {
      // not persisted
    }
  })

  const status = ref<ExtStatus | null>(null)
  const loading = ref(false)
  const failed = ref(false)
  const mcp = ref<McpServerRow[] | null>(null)
  const mcpAt = ref<number | null>(null)
  const mcpLoading = ref(false)
  /** Key of the running change (entry id / server / plugin id); one at a time, like the main process. */
  const busy = ref<string | null>(null)
  /** Last result per key, shown on the card until the next action. */
  const results = ref<Record<string, ExtResult>>({})

  /** Folder the project scopes act on; null in the global view or before one is picked. */
  const dir = computed(() => (mode.value === 'project' ? project.value : null))
  let gen = 0
  const mcpByDir = new Map<string, { servers: McpServerRow[]; at: number }>()
  /** Set when a change happened outside `act` (sign-in in a terminal): next refresh re-checks. */
  let mcpDirty = false

  async function refresh(fresh = false): Promise<void> {
    if (!desktop?.extStatus) return
    if (mode.value === 'project' && !project.value) {
      status.value = null
      mcp.value = null
      return
    }
    const my = ++gen
    const d = dir.value ?? undefined
    const hit = mcpByDir.get(d ?? '')
    mcp.value = hit?.servers ?? null
    mcpAt.value = hit?.at ?? null
    const recheck = fresh || mcpDirty || !hit || Date.now() - hit.at >= MCP_FRESH_MS
    loading.value = true
    mcpLoading.value = recheck
    failed.value = false
    const fast = desktop
      .extStatus(d)
      .then((s) => {
        if (my !== gen) return
        status.value = s
        failed.value = s === null
      })
      .catch(() => my === gen && (failed.value = true))
      .finally(() => my === gen && (loading.value = false))
    if (!recheck) return void (await fast)
    const force = fresh || mcpDirty
    mcpDirty = false
    const slow = (desktop.extMcp?.(d, force) ?? Promise.resolve(null))
      .then((m) => {
        if (m) mcpByDir.set(d ?? '', m)
        if (my !== gen) return
        mcp.value = m?.servers ?? null
        mcpAt.value = m?.at ?? null
      })
      .catch(() => undefined)
      .finally(() => my === gen && (mcpLoading.value = false))
    await Promise.all([fast, slow])
  }

  async function act(key: string, call: () => Promise<ExtResult | null | undefined>): Promise<ExtResult> {
    if (busy.value) return { ok: false, code: 'busy' }
    busy.value = key
    let res: ExtResult
    try {
      res = (await call()) ?? { ok: false, code: 'failed' }
    } catch {
      res = { ok: false, code: 'failed' }
    } finally {
      busy.value = null
    }
    results.value = { ...results.value, [key]: res }
    if (res.ok) void refresh(true)
    return res
  }

  const withDir = <T extends { scope: string; dir?: string }>(req: T): T => (req.scope === 'user' ? req : { ...req, dir: project.value ?? undefined })

  const install = (req: ExtInstallRequest) => act(req.id, () => desktop!.extInstall!(withDir(req)))
  const remove = (key: string, req: ExtRemoveRequest) => act(key, () => desktop!.extRemove!(withDir(req)))
  /** `claude mcp login` needs a TTY (OAuth prompt), so it runs in a workspace terminal the user can see and answer. */
  function login(key: string, name: string): Promise<ExtResult> {
    if (!hasTerminals || !SERVER_NAME.test(name)) return act(key, () => desktop!.extLogin!(name, dir.value ?? undefined))
    clearResult(key)
    mcpDirty = true
    useWorkspaceStore().runScript(dir.value ?? undefined, `claude mcp login ${name}`)
    useUiStore().setView('workspace')
    return Promise.resolve({ ok: true })
  }
  const source = (key: string, req: ExtSourceRequest) =>
    act(key, () => desktop!.extSource!(req.type === 'marketplace' ? req : withDir(req)).then((r) => r ?? { ok: false as const, code: 'failed' as const }))

  /** Marketplace add returns its plugins; kept for the add-source sheet. */
  async function addMarketplace(repo: string) {
    if (busy.value || !desktop?.extSource) return null
    busy.value = `source:${repo}`
    try {
      const res = await desktop.extSource({ type: 'marketplace', repo })
      if (res?.ok) void refresh(true)
      return res
    } catch {
      return null
    } finally {
      busy.value = null
    }
  }

  function clearResult(key: string): void {
    if (!(key in results.value)) return
    const next = { ...results.value }
    delete next[key]
    results.value = next
  }

  return { mode, project, dir, status, loading, failed, mcp, mcpAt, mcpLoading, busy, results, refresh, install, remove, login, source, addMarketplace, clearResult }
})
