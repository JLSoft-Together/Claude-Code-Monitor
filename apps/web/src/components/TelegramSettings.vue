<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Activity, ChevronRight, GripVertical, Unlink, CircleCheck, CircleDashed, Copy, ExternalLink, Eye, FileUp, Folder, FolderPlus, Hash, Link2, MessageSquare, Pin, Plus, Radio, RefreshCw, Send, ShieldAlert, ShieldCheck, Terminal, Trash2, TriangleAlert, UserCheck, UserPlus, Users } from 'lucide-vue-next'
import {
  DEFAULT_TELEGRAM_QUIET,
  DEFAULT_TELEGRAM_SUMMARY,
  isHhmm,
  isSessionId,
  parseTopicLink,
  TELEGRAM_DONE_CHOICES,
  TELEGRAM_MEMBERS_MAX,
  type TelegramChat,
  type TelegramError,
  type TelegramMember,
  type TelegramMemberLevel,
  type TelegramStrangerSeen,
  type TelegramQuiet,
  type TelegramRoute,
  type TelegramSessionRoute,
  type TelegramSetResult,
  type TelegramSummary,
  type TelegramTopic,
} from '@ccm/shared'
import { desktop } from '../lib/desktop'
import { openExternal } from '../lib/preview'
import { pinLeaving } from '../lib/motion'
import { now, relativeTime, startClock } from '../lib/format'
import { countdown, projectChoices, projectLabel, suggestTopic, suggestTopics, topicText, topicUrl } from '../lib/telegram'
import { useTelegramStore } from '../stores/telegram'
import { useTerminalsStore } from '../stores/terminals'
import { useToastsStore } from '../stores/toasts'
import { useUiStore } from '../stores/ui'
import { isTerm, useWorkspaceStore, workCwd } from '../stores/workspace'
import { agentLive } from '../composables/useTelegramInbound'
import { usePaneInfo } from '../composables/usePaneInfo'
import { useSessionLive, type SessionLive } from '../composables/useTelegramLinks'
import AppSelect from './AppSelect.vue'
import SegmentedControl from './ui/SegmentedControl.vue'
import TelegramAccountScan from './TelegramAccountScan.vue'
import StatusIcon from './StatusIcon.vue'
import ToggleSwitch from './ToggleSwitch.vue'

const props = defineProps<{ open: boolean }>()

const { t, locale } = useI18n()
const tg = useTelegramStore()
const terminals = useTerminalsStore()
const workspace = useWorkspaceStore()
const ui = useUiStore()
const toasts = useToastsStore()

onMounted(() => {
  tg.start()
  startClock()
})
const token = ref('')
const confirmClear = ref(false)
let confirmTimer: ReturnType<typeof setTimeout> | null = null
function resetConfirm(): void {
  if (confirmTimer) clearTimeout(confirmTimer)
  confirmTimer = null
  confirmClear.value = false
}
watch(
  () => props.open,
  (open) => {
    if (open) void tg.reload()
    else {
      token.value = ''
      resetConfirm()
    }
  },
)

const state = computed(() => tg.state)
const note = ref<{ text: string; error: boolean } | null>(null)
const testing = ref<string | null>(null)
const scanning = computed(() => tg.scanning)
const scanError = ref<string | null>(null)

const say = (text: string, error = false): void => {
  note.value = { text, error }
}
const setFail = (res: TelegramSetResult): boolean => {
  if (res.ok) return false
  say(t(`telegram.setError.${res.error}`), true)
  return true
}

const status = computed(() =>
  state.value?.configured ? (state.value.bot ? t('telegram.tokenSaved', { bot: state.value.bot }) : t('telegram.tokenSavedNoName')) : t('telegram.tokenNone'),
)
const lastError = computed(() => (state.value?.lastError && !(state.value.pollConflict && state.value.lastError === 'conflict') ? t(`telegram.error.${state.value.lastError}`) : null))
const doneOptions = computed(() => TELEGRAM_DONE_CHOICES.map((n) => ({ value: n as number, label: n === 0 ? t('telegram.doneAlways') : t('telegram.doneMin', { n }) })))

async function saveToken(): Promise<void> {
  const res = await tg.set({ token: token.value.trim() })
  if (setFail(res)) return
  token.value = ''
  note.value = null
}

function askClear(): void {
  confirmClear.value = true
  if (confirmTimer) clearTimeout(confirmTimer)
  confirmTimer = setTimeout(resetConfirm, 6000)
}

async function clearToken(): Promise<void> {
  resetConfirm()
  if (!setFail(await tg.set({ token: '' }))) note.value = null
}

const TG_APPS_URL = 'https://my.telegram.org/apps'
const apiId = ref('')
const apiHash = ref('')
const bigKeys = computed(() => !!state.value?.bigFiles.apiId && !!state.value?.bigFiles.hasHash)
const canSaveBig = computed(() => /^\d{1,10}$/.test(apiId.value.trim()) && /^[0-9a-f]{32}$/i.test(apiHash.value.trim()))

async function saveBig(): Promise<void> {
  if (setFail(await tg.set({ apiId: Number(apiId.value.trim()), apiHash: apiHash.value.trim(), bigFiles: true }))) return
  apiId.value = ''
  apiHash.value = ''
  note.value = null
}

async function patch(p: Parameters<typeof tg.set>[0]): Promise<void> {
  if (!setFail(await tg.set(p))) note.value = null
}

const members = computed(() => state.value?.members ?? [])
const membersFull = computed(() => members.value.length >= TELEGRAM_MEMBERS_MAX)
const levelOptions = computed(() => [
  { value: 'read' as TelegramMemberLevel, label: t('telegram.members.read'), icon: Eye },
  { value: 'full' as TelegramMemberLevel, label: t('telegram.members.full'), icon: ShieldCheck },
])
const setMembers = (list: TelegramMember[]): Promise<void> => patch({ members: list })
const setLevel = (id: number, level: TelegramMemberLevel): Promise<void> => setMembers(members.value.map((m) => (m.id === id ? { ...m, level } : m)))
const removeMember = (id: number): Promise<void> => setMembers(members.value.filter((m) => m.id !== id))
function addMember(s: TelegramStrangerSeen, level: TelegramMemberLevel): Promise<void> {
  if (membersFull.value || members.value.some((m) => m.id === s.id)) return Promise.resolve()
  return setMembers([...members.value, { id: s.id, name: s.name, level }])
}

async function test(project?: string, session?: string): Promise<void> {
  testing.value = session ?? project ?? ''
  const res = await tg.test(project, session)
  testing.value = null
  say(res.ok ? t('telegram.testOk', { bot: res.bot }) : t(`telegram.error.${res.error}`), !res.ok)
}

async function scan(): Promise<void> {
  scanError.value = null
  const res = await tg.discover()
  if (!res.ok) scanError.value = t(`telegram.error.${res.error}`)
}

const chatOptions = computed(() => (tg.chats ?? []).map((c) => ({ value: c.chatId, label: c.title })))
const pickChat = (id: string | null): void => {
  tg.chatId = id
}

const topicName = (r: Pick<TelegramRoute, 'chatId' | 'threadId'>): string => {
  if (r.threadId === null) return t('telegram.general')
  const name = tg.chats?.find((c) => c.chatId === r.chatId)?.topics.find((x) => x.threadId === r.threadId)?.name
  return name ?? t('telegram.topicUnknown', { id: r.threadId })
}
const chatTitle = (id: string): string => tg.chats?.find((c) => c.chatId === id)?.title ?? id
// Who already uses each topic, so a picker shows it before a session takes a topic over.
const topicUsers = computed(() => {
  const m = new Map<string, string[]>()
  const add = (r: { chatId: string; threadId: number | null }, name: string) => {
    const key = `${r.chatId}:${r.threadId}`
    m.set(key, [...(m.get(key) ?? []), name])
  }
  for (const r of state.value?.routes ?? []) add(r, r.label || projectLabel(r.project))
  for (const r of state.value?.sessionRoutes ?? []) add(r, r.name)
  return m
})
const usersHint = (chatId: string, threadId: number | null): string | undefined => topicUsers.value.get(`${chatId}:${threadId}`)?.join(', ')
const topicOptions = (c: TelegramChat | null) =>
  c
    ? [
        { value: null as number | null, label: t('telegram.general'), hint: usersHint(c.chatId, null) },
        ...c.topics.map((x) => ({ value: x.threadId as number | null, label: x.name, hint: usersHint(c.chatId, x.threadId) })),
      ]
    : []
const chatTopicOptions = computed(() => topicOptions(tg.chat))

const routes = computed(() => state.value?.routes ?? [])
const routeName = (r: TelegramRoute): string => r.label || projectLabel(r.project)

const PICK = '\u0000pick'
const known = computed(() =>
  projectChoices(
    [...terminals.list.map((x) => x.cwd), ...workspace.panes.map((p) => (isTerm(p) ? workCwd(p) : p.cwd)), ...workspace.recentDirs],
    routes.value.map((r) => r.project),
  ),
)
const picked = ref<string | null>(null)
const canPickFolder = typeof desktop?.pickFolder === 'function'
const projectOptions = computed(() => {
  const list = [...known.value, ...(picked.value && !known.value.includes(picked.value) ? [picked.value] : [])]
  return [...list.map((d) => ({ value: d as string | null, label: projectLabel(d), hint: d })), ...(canPickFolder ? [{ value: PICK as string | null, label: t('telegram.projectFolder') }] : [])]
})
const newProject = ref<string | null>(null)
const newTopic = ref<number | null>(null)

function setNewProject(dir: string | null): void {
  newProject.value = dir
  const hint = dir && tg.chat ? suggestTopic(freeTopics.value, projectLabel(dir)) : null
  if (hint) newTopic.value = hint.threadId
}

async function chooseProject(v: string | null): Promise<void> {
  if (v !== PICK) return setNewProject(v)
  const dir = await desktop?.pickFolder(newProject.value ?? workspace.recentDirs[0])
  if (!dir) return
  picked.value = dir
  setNewProject(dir)
}

async function addRoute(): Promise<void> {
  const project = newProject.value
  if (!project || !tg.chat) return
  const res = await tg.routeSet({ project, chatId: tg.chat.chatId, threadId: newTopic.value, label: projectLabel(project) })
  if (setFail(res)) return
  note.value = null
  newProject.value = null
  newTopic.value = null
}

async function moveRoute(r: TelegramRoute, threadId: number | null): Promise<void> {
  if (!tg.chat) return
  setFail(await tg.routeSet({ project: r.project, chatId: tg.chat.chatId, threadId, label: r.label || projectLabel(r.project) }))
}

const creating = ref<string | null>(null)
async function createTopic(project: string): Promise<void> {
  creating.value = project
  const res = await tg.createTopic(project, projectLabel(project))
  creating.value = null
  if (!res.ok) {
    say(res.error === 'invalid-project' ? t('telegram.setError.invalid-project') : t(`telegram.error.${res.error}`), true)
    return
  }
  say(t('telegram.created', { name: res.topic.name }))
  if (newProject.value === project) {
    newProject.value = null
    newTopic.value = null
  }
}

async function removeRoute(project: string): Promise<void> {
  if (!setFail(await tg.routeRemove(project))) note.value = null
}

type SessionLink = TelegramSessionRoute & { pane?: string; live: SessionLive | null }
interface TopicGroup {
  key: string
  chatId: string
  threadId: number | null
  where: string
  broken: boolean
  /** Signed-in scan lists every topic, so a topic missing from it is gone (deleted). */
  gone: boolean
  lastSentAt?: number
  lastError?: TelegramError
  projects: TelegramRoute[]
  sessions: SessionLink[]
}

const liveOf = useSessionLive()
const sessionLinks = computed((): SessionLink[] =>
  (state.value?.sessionRoutes ?? []).map((r) => {
    const live = liveOf(r.session)
    return { ...r, pane: live?.pane.key, live }
  }),
)
const closedLinks = computed(() => sessionLinks.value.filter((r) => !r.pane))
const topicRows = computed(() => (state.value?.routes.length ?? 0) + sessionLinks.value.length)
const scannedTopics = computed(() => (tg.chats ?? []).reduce((n, c) => n + c.topics.length, 0))
const whereText = (r: { chatId: string; threadId: number | null; where?: string }): string => r.where ?? (tg.chats ? `${chatTitle(r.chatId)} · ${topicName(r)}` : topicText(r, t('telegram.general')))
const inChat = (r: { chatId: string }): boolean => !!tg.chat && r.chatId === tg.chat.chatId

const topicGone = (r: { chatId: string; threadId: number | null }): boolean => {
  if (r.threadId === null || !state.value?.userAccount || !tg.fresh) return false
  const c = tg.chats?.find((x) => x.chatId === r.chatId)
  return !!c && !c.topics.some((x) => x.threadId === r.threadId)
}

// One block per topic, so a topic shared by a project and a session (the session wins) shows up in one place.
const topicGroups = computed((): TopicGroup[] => {
  const groups = new Map<string, TopicGroup>()
  const at = (r: { chatId: string; threadId: number | null; where?: string; broken?: boolean; lastSentAt?: number; lastError?: TelegramError }): TopicGroup => {
    const key = `${r.chatId}:${r.threadId}`
    let g = groups.get(key)
    if (!g) groups.set(key, (g = { key, chatId: r.chatId, threadId: r.threadId, where: whereText(r), broken: false, gone: topicGone(r), projects: [], sessions: [] }))
    if (r.broken) g.broken = true
    if (r.lastSentAt && r.lastSentAt > (g.lastSentAt ?? 0)) g.lastSentAt = r.lastSentAt
    if (r.lastError) g.lastError = r.lastError
    return g
  }
  for (const r of routes.value) at(r).projects.push(r)
  for (const r of sessionLinks.value) at(r).sessions.push(r)
  return [...groups.values()]
})

type TopicFilter = 'all' | 'waiting' | 'broken' | 'open' | 'closed'
const topicQuery = ref('')
const topicFilter = ref<TopicFilter>('all')
const asking = (r: SessionLink): boolean => r.live?.state === 'asked'
// Waiting / broken / closed only show up while something is in them, so the bar stays short.
const topicFilterOptions = computed(() => {
  const n: Record<TopicFilter, number> = {
    all: topicGroups.value.length,
    waiting: sessionLinks.value.filter(asking).length,
    broken: topicGroups.value.filter((g) => g.broken || g.gone).length,
    open: sessionLinks.value.length - closedLinks.value.length,
    closed: closedLinks.value.length,
  }
  return (['all', 'waiting', 'broken', 'open', 'closed'] as const)
    .filter((v) => v === 'all' || v === 'open' || n[v] > 0 || topicFilter.value === v)
    .map((v) => ({ value: v, label: n[v] && v !== 'all' ? `${t(`telegram.topicMap.filter.${v}`)} ${n[v]}` : t(`telegram.topicMap.filter.${v}`) }))
})
// A broken topic goes first: it is the one that needs a fix.
const shownGroups = computed((): TopicGroup[] => {
  const q = topicQuery.value.trim().toLowerCase()
  const f = topicFilter.value
  const hit = (v: string) => !q || v.toLowerCase().includes(q)
  return topicGroups.value
    .flatMap((g) => {
      if (f === 'broken' && !g.broken && !g.gone) return []
      const all = hit(g.where)
      const projects = f === 'open' || f === 'closed' || f === 'waiting' ? [] : g.projects.filter((r) => all || hit(routeName(r)) || hit(r.project))
      const sessions = g.sessions.filter((r) => (f !== 'open' || !!r.pane) && (f !== 'closed' || !r.pane) && (f !== 'waiting' || asking(r)) && (all || hit(r.name) || hit(r.project)))
      return projects.length || sessions.length ? [{ ...g, projects, sessions }] : []
    })
    .sort((a, b) => Number(b.broken || b.gone) - Number(a.broken || a.gone))
})

const { sessionOf, labelOf } = usePaneInfo()
const dirKey = (d: string): string => d.replace(/[\\/]+$/, '').toLowerCase()
const sameOrUnder = (dir: string, root: string): boolean => {
  const d = dirKey(dir)
  const r = dirKey(root)
  return d === r || d.startsWith(`${r}\\`) || d.startsWith(`${r}/`)
}
interface Unrouted {
  project: string
  sessions: { key: string; name: string; live: SessionLive }[]
  suggest: TelegramTopic | null
}
// One project, one topic: running projects that report nowhere yet, each with the topic named like it when there is one.
const unrouted = computed((): Unrouted[] => {
  const linked = new Set((state.value?.sessionRoutes ?? []).map((r) => r.session))
  const byDir = new Map<string, Unrouted>()
  for (const p of workspace.panes) {
    if (!isTerm(p) || !isSessionId(p.agentSessionId) || !agentLive(p)) continue
    const session = p.agentSessionId.toLowerCase()
    const project = workCwd(p)
    const live = liveOf(session)
    if (linked.has(session) || !project || !live || routes.value.some((r) => sameOrUnder(project, r.project))) continue
    let u = byDir.get(dirKey(project))
    if (!u) byDir.set(dirKey(project), (u = { project, sessions: [], suggest: tg.chat ? suggestTopic(freeTopics.value, projectLabel(project)) : null }))
    u.sessions.push({ key: p.key, name: sessionOf(p) ? labelOf(p) : workspace.tabOf(p.key)?.name || projectLabel(project), live })
  }
  return [...byDir.values()]
})
const freeTopics = computed(() => (tg.chat?.topics ?? []).filter((x) => !usersHint(tg.chat!.chatId, x.threadId)))
const GENERAL = 'general'
const pickTopicOptions = computed(() => chatTopicOptions.value.map((o) => ({ ...o, value: o.value === null ? GENERAL : String(o.value) })))
async function routeProject(project: string, threadId: number | null): Promise<void> {
  if (!tg.chat) return
  if (!setFail(await tg.routeSet({ project, chatId: tg.chat.chatId, threadId, label: projectLabel(project) }))) note.value = null
}
const bulkSuggest = computed(() => (tg.chat ? suggestTopics(unrouted.value, freeTopics.value, (u) => projectLabel(u.project)) : []))
const bulkBusy = ref(false)
async function routeAllSuggested(): Promise<void> {
  const chat = tg.chat
  if (!chat || bulkBusy.value) return
  bulkBusy.value = true
  const done: string[] = []
  for (const { project, topic } of bulkSuggest.value) {
    const res = await tg.routeSet({ project: project.project, chatId: chat.chatId, threadId: topic.threadId, label: projectLabel(project.project) })
    if (setFail(res)) break
    done.push(project.project)
  }
  bulkBusy.value = false
  if (done.length) moved(t('telegram.unrouted.allDone', { n: done.length }, done.length), async () => {
    for (const d of done) await tg.routeRemove(d)
  })
}

// A topic deleted in Telegram: offer the free topic named like the project in the same group.
const goneFix = (g: TopicGroup): { route: TelegramRoute; topic: TelegramTopic } | null => {
  const route = g.projects[0]
  const c = tg.chats?.find((x) => x.chatId === g.chatId)
  if (!g.gone || !route || !c) return null
  const topic = suggestTopic(c.topics.filter((x) => !usersHint(c.chatId, x.threadId)), routeName(route))
  return topic ? { route, topic } : null
}
async function applyGoneFix(g: TopicGroup): Promise<void> {
  const fix = goneFix(g)
  if (!fix) return
  const { route: r, topic } = fix
  const res = await tg.routeSet({ project: r.project, chatId: r.chatId, threadId: topic.threadId, label: r.label || routeName(r) })
  if (!setFail(res)) moved(t('telegram.drag.moved', { name: routeName(r), topic: topic.name }), () => tg.routeSet({ project: r.project, chatId: r.chatId, threadId: r.threadId, label: r.label || routeName(r) }))
}
const openTopic = (x: Target): void => {
  const url = topicUrl(x.chatId, x.threadId)
  if (url) void openExternal(url)
}

interface Target {
  chatId: string
  threadId: number | null
}
type DragItem = { kind: 'project'; project: string; name: string } | { kind: 'session'; route: SessionLink }
const dragging = ref<DragItem | null>(null)
const dropOver = ref<string | null>(null)
const UNLINK = 'unlink'
const targetKey = (x: Target): string => `${x.chatId}:${x.threadId}`
interface TreeTopic extends Target {
  key: string
  name: string
  group: TopicGroup | null
}
interface TreeChat {
  chatId: string
  title: string
  admin: boolean | null
  topics: TreeTopic[]
  linked: number
  total: number
}
const filtering = computed(() => !!topicQuery.value.trim() || topicFilter.value !== 'all')
const readPref = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const writePref = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // per-viewer convenience only
  }
}
const hideEmpty = ref(readPref('ccm.telegram.hideEmpty') === '1')
watch(hideEmpty, (v) => writePref('ccm.telegram.hideEmpty', v ? '1' : '0'))
const collapsed = ref<string[]>((() => {
  try {
    const v = JSON.parse(readPref('ccm.telegram.collapsed') ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 50) : []
  } catch {
    return []
  }
})())
watch(collapsed, (v) => writePref('ccm.telegram.collapsed', JSON.stringify(v)))
const isCollapsed = (chatId: string): boolean => collapsed.value.includes(chatId)
const toggleChat = (chatId: string): void => {
  collapsed.value = isCollapsed(chatId) ? collapsed.value.filter((x) => x !== chatId) : [...collapsed.value, chatId]
}
const expandChat = (chatId: string): void => {
  if (isCollapsed(chatId)) collapsed.value = collapsed.value.filter((x) => x !== chatId)
}
const topicRank = (x: TreeTopic): number => (x.group?.gone || x.group?.broken ? 0 : x.group ? 1 : 2)
// Group › topic tree: every scanned topic shows, so the whole layout is visible and any topic is a drop target.
const tree = computed((): TreeChat[] => {
  const shown = new Map(shownGroups.value.map((g) => [g.key, g]))
  const chats = new Map<string, Omit<TreeChat, 'linked' | 'total'>>()
  for (const c of tg.chats ?? []) {
    const list = [{ threadId: null as number | null, name: t('telegram.general') }, ...c.topics.map((x) => ({ threadId: x.threadId as number | null, name: x.name }))]
    chats.set(c.chatId, {
      chatId: c.chatId,
      title: c.title,
      admin: c.botAdmin,
      topics: list.map((x) => {
        const key = `${c.chatId}:${x.threadId}`
        return { key, chatId: c.chatId, threadId: x.threadId, name: x.name, group: shown.get(key) ?? null }
      }),
    })
  }
  for (const g of shownGroups.value) {
    let c = chats.get(g.chatId)
    if (!c) chats.set(g.chatId, (c = { chatId: g.chatId, title: chatTitle(g.chatId), admin: null, topics: [] }))
    if (!c.topics.some((x) => x.key === g.key)) c.topics.push({ key: g.key, chatId: g.chatId, threadId: g.threadId, name: g.where.split(' › ').pop() || topicName(g), group: g })
  }
  const q = topicFilter.value === 'all' ? topicQuery.value.trim().toLowerCase() : ''
  const nameHit = (c: { title: string }, x: TreeTopic): boolean => !!q && (x.name.toLowerCase().includes(q) || c.title.toLowerCase().includes(q))
  return [...chats.values()]
    .map((c) => {
      const topics = c.topics.filter((x) => x.group || (!filtering.value && !hideEmpty.value) || nameHit(c, x)).sort((a, b) => topicRank(a) - topicRank(b))
      return { ...c, topics, linked: c.topics.filter((x) => x.group).length, total: c.topics.length }
    })
    .filter((c) => c.topics.length || (!filtering.value && !hideEmpty.value))
})
const allCollapsed = computed(() => tree.value.length > 0 && tree.value.every((c) => isCollapsed(c.chatId)))
const collapseAll = (): void => {
  collapsed.value = allCollapsed.value ? [] : tree.value.map((c) => c.chatId)
}
const dragLinked = computed(() => {
  const d = dragging.value
  return !!d && (d.kind === 'session' || routes.value.some((r) => r.project === d.project))
})

let dragTimer: ReturnType<typeof setTimeout> | null = null
// Chromium drops a drag whose source moves during dragstart, so the strip and row styles change a frame later.
function onDragStart(e: DragEvent, item: DragItem): void {
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', item.kind === 'project' ? item.name : item.route.name)
  }
  if (dragTimer) clearTimeout(dragTimer)
  dragTimer = setTimeout(() => {
    dragTimer = null
    dragging.value = item
  }, 0)
}
function onDragEnd(): void {
  if (dragTimer) clearTimeout(dragTimer)
  dragTimer = null
  dragging.value = null
  dropOver.value = null
}
function onDragOver(e: DragEvent, key: string): void {
  if (!dragging.value) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dropOver.value = key
}
function onDragLeave(e: DragEvent, key: string): void {
  const into = e.relatedTarget as Node | null
  if (dropOver.value === key && !(into && (e.currentTarget as HTMLElement).contains(into))) dropOver.value = null
}

function moved(text: string, undo: () => Promise<unknown>): void {
  toasts.push({ id: 'tg-move', kind: 'undo', text, timeoutMs: 6000, actions: [{ label: t('telegram.drag.undo'), primary: true, run: () => void undo() }] })
}
const placeName = (x: Target): string => (x.threadId === null ? t('telegram.general') : (tg.chats?.find((c) => c.chatId === x.chatId)?.topics.find((y) => y.threadId === x.threadId)?.name ?? topicName(x)))

async function onDrop(e: DragEvent, to: Target | typeof UNLINK): Promise<void> {
  e.preventDefault()
  const d = dragging.value
  onDragEnd()
  if (!d) return
  if (d.kind === 'project') {
    const prev = routes.value.find((r) => r.project === d.project)
    if (to !== UNLINK && prev && targetKey(prev) === targetKey(to)) return
    const back = () => (prev ? tg.routeSet({ project: prev.project, chatId: prev.chatId, threadId: prev.threadId, label: prev.label || d.name }) : tg.routeRemove(d.project))
    const res = to === UNLINK ? (prev ? await tg.routeRemove(d.project) : null) : await tg.routeSet({ project: d.project, chatId: to.chatId, threadId: to.threadId, label: prev?.label || d.name })
    if (res && !setFail(res)) moved(to === UNLINK ? t('telegram.drag.unlinked', { name: d.name }) : t('telegram.drag.moved', { name: d.name, topic: placeName(to) }), back)
    return
  }
  const r = d.route
  if (to !== UNLINK && targetKey(r) === targetKey(to)) return
  const back = () => tg.sessionRouteSet({ session: r.session, name: r.name, project: r.project, chatId: r.chatId, threadId: r.threadId, keep: !!r.keep })
  const res = to === UNLINK ? await tg.sessionRouteRemove(r.session) : await tg.sessionRouteSet({ session: r.session, name: r.name, project: r.project, chatId: to.chatId, threadId: to.threadId, keep: !!r.keep })
  if (!setFail(res)) moved(to === UNLINK ? t('telegram.drag.unlinked', { name: r.name }) : t('telegram.drag.moved', { name: r.name, topic: placeName(to) }), back)
}

async function moveSession(r: SessionLink, threadId: number | null): Promise<void> {
  if (!tg.chat) return
  setFail(await tg.sessionRouteSet({ session: r.session, name: r.name, project: r.project, chatId: tg.chat.chatId, threadId }))
}

async function setKeep(r: SessionLink): Promise<void> {
  setFail(await tg.sessionRouteSet({ session: r.session, name: r.name, project: r.project, chatId: r.chatId, threadId: r.threadId, keep: !r.keep }))
}

async function removeClosed(): Promise<void> {
  for (const r of closedLinks.value) if (setFail(await tg.sessionRouteRemove(r.session))) return
  note.value = null
}

function showSession(pane: string): void {
  workspace.activate(pane)
  ui.setView('workspace')
  ui.settingsOpen = false
}

async function removeSessionLink(session: string): Promise<void> {
  if (!setFail(await tg.sessionRouteRemove(session))) note.value = null
}

const link = ref('')
const parsedLink = computed(() => (link.value.trim() ? parseTopicLink(link.value) : null))
const linkView = computed(() => {
  if (!link.value.trim()) return null
  const p = parsedLink.value
  return p ? { ok: true, text: t('telegram.linkOk', { chat: p.chatId, topic: p.threadId === null ? t('telegram.general') : `#${p.threadId}` }) } : { ok: false, text: t('telegram.linkBad') }
})

async function addByLink(): Promise<void> {
  const project = newProject.value
  if (!project || !parsedLink.value) return
  const res = await tg.routeSet({ project, link: link.value.trim(), label: projectLabel(project) })
  if (setFail(res)) return
  note.value = null
  link.value = ''
  newProject.value = null
}

const installing = ref(false)
async function installCommand(): Promise<void> {
  installing.value = true
  const res = await tg.installCommand()
  installing.value = false
  if (res.ok) say(t('telegram.commandOk'))
  else if (res.error === 'failed') say(t('telegram.setError.failed'), true)
}

const quiet = computed(() => state.value?.quiet ?? DEFAULT_TELEGRAM_QUIET)
const summary = computed(() => state.value?.summary ?? DEFAULT_TELEGRAM_SUMMARY)
function setQuiet(p: Partial<TelegramQuiet>): void {
  void patch({ quiet: { ...quiet.value, ...p } })
}
function setSummary(p: Partial<TelegramSummary>): void {
  void patch({ summary: { ...summary.value, ...p } })
}
function onQuietTime(field: 'from' | 'to', e: Event): void {
  const input = e.target as HTMLInputElement
  if (isHhmm(input.value)) setQuiet({ [field]: input.value })
  else input.value = quiet.value[field]
}
function onSummaryTime(e: Event): void {
  const input = e.target as HTMLInputElement
  if (isHhmm(input.value)) setSummary({ at: input.value })
  else input.value = summary.value.at
}
const actions = computed(() => (['permission', 'finished', 'stop', 'screen', 'files', 'new', 'resume', 'run', 'all', 'last', 'buildLog'] as const).map((k) => ({ key: k, text: t(`telegram.receive.actions.${k}`, { bot: botName.value }) })))

const healthNow = ref(Date.now())
let healthTimer: ReturnType<typeof setInterval> | null = null
function syncHealthTimer(): void {
  const run = props.open && document.visibilityState === 'visible'
  if (run && !healthTimer) {
    healthNow.value = Date.now()
    healthTimer = setInterval(() => (healthNow.value = Date.now()), 30_000)
  } else if (!run && healthTimer) {
    clearInterval(healthTimer)
    healthTimer = null
  }
}
watch(() => props.open, syncHealthTimer, { immediate: true })
document.addEventListener('visibilitychange', syncHealthTimer)
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', syncHealthTimer)
  resetConfirm()
  if (healthTimer) clearInterval(healthTimer)
  healthTimer = null
})
watch(
  () => state.value?.health,
  () => (healthNow.value = Date.now()),
)
// "Not delivering" already says what is wrong when the topic is broken or gone; the health line covers the other errors (network, rate limit…).
const topicSentAgo = (g: { lastSentAt?: number }): string => (g.lastSentAt ? t('telegram.topicMap.sentAgo', { when: ago(g.lastSentAt) }) : '')
const topicErrorText = (g: { lastError?: TelegramError }): string => (g.lastError ? t(`telegram.topicMap.errors.${g.lastError}`) : '')
const topicFailing = (g: { lastError?: TelegramError; broken: boolean; gone: boolean }): boolean => !!g.lastError && !g.broken && !g.gone
const ago = (ms: number | null | undefined): string => (ms ? (relativeTime(Math.min(ms, healthNow.value), locale.value, healthNow.value) ?? t('telegram.health.never')) : t('telegram.health.never'))
const healthRows = computed(() => {
  const h = state.value?.health
  if (!h) return []
  return [
    { key: 'sent', label: t('telegram.health.sent'), value: ago(h.lastSentAt) },
    ...(state.value?.receiving ? [{ key: 'received', label: t('telegram.health.received'), value: ago(h.lastReceivedAt) }] : []),
    { key: 'poll', label: t('telegram.health.poll'), value: ago(h.lastPollAt) },
  ]
})

const botName = computed(() => state.value?.bot ?? t('telegram.receive.botFallback'))
const pairCommand = computed(() => (state.value?.pairCode ? `@${botName.value} pair ${state.value.pairCode}` : ''))
const pairLeft = computed(() => countdown(state.value?.pairUntil ?? null, now.value))
const pairExpired = computed(() => !!state.value?.pairUntil && state.value.pairUntil <= now.value)
const pairing = ref(false)
async function pair(on: boolean): Promise<void> {
  if (on) startClock()
  pairing.value = true
  const res = await tg.pair(on)
  pairing.value = false
  if (!setFail(res)) note.value = null
}
async function unpair(): Promise<void> {
  if (!setFail(await tg.unpair())) note.value = null
}
async function setReceiving(on: boolean): Promise<void> {
  if (!setFail(await tg.setReceiving(on))) note.value = null
}
async function copyPair(): Promise<void> {
  try {
    await navigator.clipboard.writeText(pairCommand.value)
    say(t('telegram.receive.copied'))
  } catch {
    say(t('telegram.receive.copyFailed'), true)
  }
}
const installingReceive = ref(false)
async function installReceive(): Promise<void> {
  installingReceive.value = true
  const res = await tg.installReceive()
  installingReceive.value = false
  if (res.ok) say(t('telegram.commandOk'))
  else if (res.error === 'failed') say(t('telegram.setError.failed'), true)
}

const guide = computed(() => (['bot', 'token', 'group', 'scan', 'route'] as const).map((k) => ({ key: k, text: t(`telegram.guide.${k}`) })))

type TgTab = 'connect' | 'topics' | 'receive' | 'report'
const TAB_KEY = 'ccm.telegram.tab'
const readTab = (): TgTab | null => {
  try {
    const v = localStorage.getItem(TAB_KEY)
    return v === 'connect' || v === 'topics' || v === 'receive' || v === 'report' ? v : null
  } catch {
    return null
  }
}
const tab = ref<TgTab>(readTab() ?? 'connect')
watch(tab, (v) => {
  try {
    localStorage.setItem(TAB_KEY, v)
  } catch {
    // per-viewer convenience only
  }
})
watch(
  () => state.value?.configured,
  (ok) => {
    if (ok === false) tab.value = 'connect'
  },
  { immediate: true },
)
watch(
  () => props.open && tab.value === 'topics' && !!state.value?.configured && !tg.fresh,
  (go) => {
    if (go) void tg.ensureChats()
  },
  { immediate: true },
)
const linkCount = computed(() => (state.value?.routes.length ?? 0) + (state.value?.sessionRoutes.length ?? 0))
const tabOptions = computed(() =>
  (['connect', 'topics', 'receive', 'report'] as const).map((v) => ({ value: v, label: v === 'topics' && linkCount.value ? `${t('telegram.tabs.topics')} · ${linkCount.value}` : t(`telegram.tabs.${v}`) })),
)
// Each step opens the tab where it is done, so the strip doubles as a setup checklist.
const steps = computed(() => {
  const s = state.value
  if (!s) return []
  return [
    { key: 'bot', ok: s.configured, tab: 'connect' as const },
    { key: 'group', ok: !!tg.chat || linkCount.value > 0, tab: 'connect' as const },
    { key: 'topics', ok: linkCount.value > 0, tab: 'topics' as const },
    { key: 'paired', ok: !!s.owner, tab: 'receive' as const },
    { key: 'receiving', ok: s.receiving, tab: 'receive' as const },
  ].map((x) => ({ ...x, label: t(`telegram.steps.${x.key}`) }))
})
const overview = computed(() => {
  const s = state.value
  if (!s?.configured) return t('telegram.setup.start')
  const parts = [t('telegram.setup.routes', { n: s.routes.length }, s.routes.length)]
  parts.push(s.owner ? t('telegram.setup.paired', { name: s.owner.name }) : t('telegram.setup.unpaired'))
  if (s.bigFiles.enabled && s.bigFiles.apiId && s.bigFiles.hasHash) parts.push(t('telegram.setup.big'))
  return parts.join(' · ')
})
</script>

<template>
  <section v-if="state" :aria-label="t('telegram.section')" data-telegram-settings>
    <div class="ccm-group flex items-center gap-3 px-3 py-2.5" data-telegram-overview>
      <Send :size="16" class="shrink-0" :class="state.configured ? 'text-accent-ink' : 'text-ink-faint'" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-medium" data-telegram-overview-bot>{{ state.bot ? `@${state.bot}` : t('telegram.setup.noBot') }}</p>
        <p class="truncate text-2xs text-ink-faint" :title="overview" data-telegram-overview-line>{{ overview }}</p>
        <div class="mt-1.5 flex flex-wrap gap-1" data-telegram-steps>
          <button
            v-for="st in steps"
            :key="st.key"
            type="button"
            class="inline-flex items-center gap-1 rounded-full bg-fill px-1.5 py-px text-2xs hover:bg-fill-strong"
            :class="st.ok ? 'text-success' : 'text-ink-muted'"
            :aria-label="`${st.label}: ${t(st.ok ? 'telegram.steps.done' : 'telegram.steps.todo')}`"
            :aria-current="tab === st.tab ? 'page' : undefined"
            :data-telegram-step="st.key"
            @click="tab = st.tab"
          >
            <CircleCheck v-if="st.ok" :size="12" aria-hidden="true" /><CircleDashed v-else :size="12" aria-hidden="true" />{{ st.label }}
          </button>
        </div>
      </div>
    </div>
    <div v-if="state.pollConflict" class="ccm-group mt-2 flex items-center gap-3 px-3 py-2.5" role="alert" data-telegram-conflict>
      <p class="min-w-0 flex-1 text-2xs text-st-error">{{ t('telegram.setup.conflict') }}</p>
      <button type="button" class="ccm-btn shrink-0" data-telegram-conflict-retry @click="patch({ receiving: true })">{{ t('telegram.setup.retry') }}</button>
    </div>
    <div class="ccm-group mt-2 overflow-hidden">
        <ToggleSwitch
          :model-value="state.enabled"
          :label="t('telegram.enable')"
          :hint="state.configured ? t('telegram.enableHint') : t('telegram.needToken')"
          :disabled="!state.configured"
          class="px-3"
          data-telegram-enable
          @update:model-value="(on: boolean) => patch({ enabled: on })"
        />
    </div>
    <SegmentedControl v-model="tab" :options="tabOptions" :label="t('telegram.section')" fill class="mt-4 w-full" data-telegram-tabs />

    <div v-show="tab === 'connect'" class="mt-4" data-telegram-tab="connect">
      <h4 class="mb-1.5 px-3 text-2xs font-semibold text-ink-muted">{{ t('telegram.setup.bot') }}</h4>
      <div class="ccm-group divide-y divide-line overflow-hidden">
        <form class="flex flex-col gap-2 px-3 py-2" autocomplete="off" @submit.prevent="saveToken">
          <div class="flex items-center gap-2 text-xs">
            <span class="text-ink-muted">{{ t('telegram.token') }}</span>
            <Transition name="ccm-swap" mode="out-in">
              <span :key="status" class="inline-flex min-w-0 items-center gap-1 truncate" :class="state.configured ? 'text-success' : 'text-ink-faint'" data-telegram-token-status>
                <CircleCheck v-if="state.configured" :size="13" class="shrink-0" aria-hidden="true" /><CircleDashed v-else :size="13" class="shrink-0" aria-hidden="true" />{{ status }}
              </span>
            </Transition>
          </div>
          <input
            v-model="token"
            type="password"
            spellcheck="false"
            maxlength="200"
            :aria-label="t('telegram.token')"
            :placeholder="t('telegram.tokenPlaceholder')"
            :disabled="!state.keychain"
            class="ccm-field font-mono text-xs"
            data-telegram-token
          />
          <p class="text-2xs text-ink-faint">{{ t('telegram.tokenHint') }}</p>
          <div class="flex flex-wrap items-center gap-2">
            <button type="submit" class="ccm-btn" :disabled="!token.trim() || !state.keychain" data-telegram-save>{{ t('telegram.save') }}</button>
            <Transition name="ccm-swap" mode="out-in">
              <span v-if="state.configured && confirmClear" key="sure" class="inline-flex flex-wrap items-center gap-1" role="group" :aria-label="t('telegram.clearAsk')" data-telegram-clear-confirm>
                <span class="inline-flex items-center gap-1 text-2xs text-st-error"><TriangleAlert :size="12" class="shrink-0" aria-hidden="true" />{{ t('telegram.clearAsk') }}</span>
                <button type="button" class="ccm-btn-plain text-xs text-st-error" data-telegram-clear-yes @click="clearToken">{{ t('telegram.clearYes') }}</button>
                <button type="button" class="ccm-btn-plain text-xs" data-telegram-clear-no @click="resetConfirm">{{ t('telegram.clearNo') }}</button>
              </span>
              <button v-else-if="state.configured" key="ask" type="button" class="ccm-btn-plain text-xs" data-telegram-clear @click="askClear">{{ t('telegram.clear') }}</button>
            </Transition>
            <button type="button" class="ccm-btn ml-auto" :disabled="!state.configured || testing !== null" data-telegram-test @click="test()">
              <Send :size="13" aria-hidden="true" />{{ testing === '' ? t('telegram.testing') : t('telegram.test') }}
            </button>
          </div>
        </form>
        <details class="group px-3 py-2" data-telegram-guide>
          <summary class="flex cursor-pointer list-none items-center gap-1 text-xs text-ink-muted [&::-webkit-details-marker]:hidden">
            <ChevronRight :size="13" class="transition-transform duration-(--ccm-dur-fast) group-open:rotate-90" aria-hidden="true" />{{ t('telegram.guideTitle') }}
          </summary>
          <ol class="mt-2 flex list-decimal flex-col gap-1 pl-8 text-2xs leading-relaxed text-ink-muted">
            <li v-for="s in guide" :key="s.key">{{ s.text }}</li>
          </ol>
        </details>
        <div class="flex flex-col gap-2 px-3 py-2" data-telegram-big>
          <div class="flex items-start gap-2">
            <FileUp :size="15" class="mt-0.5 shrink-0 text-ink-muted" aria-hidden="true" />
            <ToggleSwitch :model-value="state.bigFiles.enabled && bigKeys" :label="t('telegram.big.title')" :hint="t(bigKeys ? 'telegram.big.hint' : 'telegram.big.needKeys')" :disabled="!bigKeys" class="min-w-0 flex-1" data-telegram-big-toggle @update:model-value="(on: boolean) => patch({ bigFiles: on })" />
          </div>
          <p v-if="bigKeys" class="flex flex-wrap items-center gap-2 pl-6 text-2xs" data-telegram-big-keys>
            <span class="inline-flex items-center gap-1 text-success"><CircleCheck :size="12" aria-hidden="true" />{{ t('telegram.big.saved', { id: state.bigFiles.apiId }) }}</span>
            <button type="button" class="ccm-btn-plain text-xs text-st-error" data-telegram-big-clear @click="patch({ bigFiles: false, apiId: null, apiHash: '' })">{{ t('telegram.big.clear') }}</button>
          </p>
          <form v-else class="flex flex-col gap-2 pl-6" autocomplete="off" @submit.prevent="saveBig">
            <ol class="flex list-decimal flex-col gap-0.5 pl-4 text-2xs leading-relaxed text-ink-muted">
              <li>{{ t('telegram.big.step1') }}</li>
              <li>{{ t('telegram.big.step2') }}</li>
              <li>{{ t('telegram.big.step3') }}</li>
            </ol>
            <button type="button" class="ccm-btn-plain self-start text-xs" data-telegram-big-open @click="openExternal(TG_APPS_URL)"><ExternalLink :size="12" aria-hidden="true" />my.telegram.org/apps</button>
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-[8rem_minmax(0,1fr)]">
              <input v-model="apiId" inputmode="numeric" spellcheck="false" maxlength="10" aria-label="api_id" placeholder="api_id" :disabled="!state.keychain" class="ccm-field font-mono text-xs" data-telegram-api-id />
              <input v-model="apiHash" type="password" spellcheck="false" maxlength="32" aria-label="api_hash" placeholder="api_hash" :disabled="!state.keychain" class="ccm-field font-mono text-xs" data-telegram-api-hash />
            </div>
            <p class="text-2xs text-ink-faint">{{ t('telegram.big.keysHint') }}</p>
            <button type="submit" class="ccm-btn self-start" :disabled="!canSaveBig || !state.keychain" data-telegram-big-save>{{ t('telegram.big.save') }}</button>
          </form>
        </div>
      </div>
      <h4 class="mt-4 mb-1.5 px-3 text-2xs font-semibold text-ink-muted">{{ t('telegram.groups') }}</h4>
      <div class="ccm-group divide-y divide-line overflow-hidden" data-telegram-groups>
        <div class="flex flex-col gap-2 px-3 py-2">
          <div class="flex flex-wrap items-center gap-2">
            <button type="button" class="ccm-btn" :disabled="!state.configured || scanning" data-telegram-scan @click="scan">
              <RefreshCw :size="13" :class="scanning ? 'ccm-spin' : ''" aria-hidden="true" />{{ scanning ? t('telegram.scanning') : t('telegram.scan') }}
            </button>
            <AppSelect v-if="chatOptions.length > 1" :model-value="tg.chatId" :options="chatOptions" :label="t('telegram.groups')" size="sm" class="min-w-0" data-telegram-chat @update:model-value="pickChat" />
          </div>
          <p class="text-2xs leading-relaxed text-ink-faint">{{ state.userAccount ? t('telegram.account.scanHint') : t('telegram.scanHint') }}</p>
          <p v-if="scanError" class="text-2xs text-st-error" role="alert">{{ scanError }}</p>
          <p v-else-if="tg.chats && !tg.chats.length" class="text-2xs text-ink-muted" data-telegram-no-chats>{{ t('telegram.noChats') }}</p>
        </div>
        <TelegramAccountScan />
        <Transition name="ccm-swap" mode="out-in">
          <div v-if="tg.chat" :key="tg.chat.chatId" class="flex flex-col gap-1.5 px-3 py-2" data-telegram-chat-info>
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="min-w-0 truncate text-sm font-medium" :title="tg.chat.title">{{ tg.chat.title }}</span>
              <span class="rounded-full bg-fill px-1.5 py-px text-2xs text-ink-muted">{{ tg.chat.isForum ? t('telegram.forum') : t('telegram.notForum') }}</span>
              <span v-if="tg.chat.botAdmin" class="inline-flex items-center gap-1 rounded-full bg-fill px-1.5 py-px text-2xs text-success" data-telegram-admin>
                <ShieldCheck :size="12" aria-hidden="true" />{{ t('telegram.admin') }}
              </span>
              <span v-else class="inline-flex items-center gap-1 rounded-full bg-fill px-1.5 py-px text-2xs text-warning" data-telegram-not-admin>
                <ShieldAlert :size="12" aria-hidden="true" />{{ t('telegram.notAdmin') }}
              </span>
              <span class="ml-auto text-2xs text-ink-faint tabular-nums">{{ t('telegram.topicsCount', { n: tg.chat.topics.length }) }}</span>
            </div>
            <p v-if="!tg.chat.botAdmin" class="text-2xs leading-relaxed text-ink-muted">{{ t('telegram.notAdminHint') }}</p>
          </div>
        </Transition>
      </div>
    </div>

    <div v-show="tab === 'topics'" class="mt-4" data-telegram-tab="topics">
      <div class="mb-1.5 flex items-center gap-2 px-3">
        <h4 class="text-2xs font-semibold text-ink-muted">{{ t('telegram.topicMap.title') }}</h4>
        <button v-if="tree.length" type="button" class="ccm-btn-plain ml-auto text-2xs" :aria-pressed="hideEmpty" :class="hideEmpty ? 'text-accent-ink' : ''" data-telegram-tree-hide-empty @click="hideEmpty = !hideEmpty">
          {{ t('telegram.tree.hideEmpty') }}
        </button>
        <button v-if="tree.length > 1" type="button" class="ccm-btn-plain text-2xs" data-telegram-tree-collapse-all @click="collapseAll">
          {{ allCollapsed ? t('telegram.tree.expandAll') : t('telegram.tree.collapseAll') }}
        </button>
        <button v-if="closedLinks.length" type="button" class="ccm-btn-plain text-2xs" data-telegram-remove-closed @click="removeClosed">
          <Trash2 :size="12" aria-hidden="true" />{{ t('telegram.topicMap.removeClosed', { n: closedLinks.length }, closedLinks.length) }}
        </button>
      </div>
      <div v-if="topicRows > 3 || scannedTopics > 8" class="mb-2 flex flex-wrap items-center gap-2 px-3" data-telegram-topic-filter>
        <input v-model="topicQuery" type="search" spellcheck="false" maxlength="80" :aria-label="t('telegram.topicMap.search')" :placeholder="t('telegram.topicMap.search')" class="ccm-field min-w-0 flex-1 basis-40 text-xs" data-telegram-topic-search />
        <SegmentedControl v-model="topicFilter" :options="topicFilterOptions" :label="t('telegram.topicMap.filterLabel')" data-telegram-topic-chips />
      </div>
      <p v-if="topicGroups.length || unrouted.length || tree.length" class="mb-1.5 flex items-start gap-1.5 px-3 text-2xs leading-relaxed text-ink-faint" data-telegram-drag-hint>
        <GripVertical :size="12" class="mt-0.5 shrink-0" aria-hidden="true" />{{ t('telegram.drag.howto') }}
      </p>
      <Transition name="ccm-swap">
        <div v-if="dragging" class="sticky top-0 z-10 mb-2 flex flex-wrap items-center gap-1.5 rounded-inner border border-dashed border-accent bg-surface px-2 py-1.5 shadow-sm" data-telegram-drop-strip>
          <span class="text-2xs text-ink-faint">{{ t('telegram.tree.dropHint') }}</span>
          <span
            v-if="dragLinked"
            class="ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs transition-colors"
            :class="dropOver === UNLINK ? 'border-st-error bg-fill text-st-error' : 'border-line bg-fill text-ink-muted'"
            data-telegram-drop-unlink
            @dragover="onDragOver($event, UNLINK)"
            @dragleave="onDragLeave($event, UNLINK)"
            @drop="onDrop($event, UNLINK)"
          >
            <Unlink :size="11" aria-hidden="true" />{{ t('telegram.drag.unlink') }}
          </span>
        </div>
      </Transition>
      <div class="ccm-group overflow-hidden" data-telegram-routes>
        <p v-if="!tree.length" class="px-3 py-2 text-2xs text-ink-muted" data-telegram-routes-empty>{{ filtering ? t('telegram.topicMap.noMatch') : t('telegram.topicMap.empty') }}</p>
        <ul class="divide-y divide-line" data-telegram-tree>
          <li v-for="c in tree" :key="c.chatId" data-telegram-tree-chat>
            <button
              type="button"
              class="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left hover:bg-fill"
              :aria-expanded="filtering || !isCollapsed(c.chatId)"
              data-telegram-tree-toggle
              @click="toggleChat(c.chatId)"
              @dragover="dragging && expandChat(c.chatId)"
            >
              <ChevronRight :size="13" class="shrink-0 text-ink-faint transition-transform duration-(--ccm-dur-fast)" :class="!filtering && isCollapsed(c.chatId) ? '' : 'rotate-90'" aria-hidden="true" />
              <Users :size="13" class="shrink-0 text-ink-muted" aria-hidden="true" />
              <span class="min-w-0 truncate text-sm font-medium" :title="c.title">{{ c.title }}</span>
              <span class="shrink-0 text-2xs text-ink-faint tabular-nums">{{ t('telegram.tree.count', { linked: c.linked, total: c.total }) }}</span>
              <span v-if="c.admin === false" class="ml-auto inline-flex shrink-0 items-center gap-1 text-2xs text-warning" :title="t('telegram.notAdminHint')"><ShieldAlert :size="12" aria-hidden="true" />{{ t('telegram.notAdmin') }}</span>
            </button>
            <ul v-show="filtering || !isCollapsed(c.chatId)" class="divide-y divide-line border-t border-line">
              <li
                v-for="x in c.topics"
                :key="x.key"
                class="group/topic transition-colors"
                :class="dragging && dropOver === x.key ? 'bg-accent-soft shadow-[inset_0_0_0_1.5px_var(--color-accent)]' : ''"
                data-telegram-topic
                :data-linked="x.group ? 'true' : 'false'"
                @dragover="onDragOver($event, x.key)"
                @dragleave="onDragLeave($event, x.key)"
                @drop="onDrop($event, x)"
              >
                <div class="flex min-w-0 items-center gap-1.5 py-1.5 pr-3 pl-7">
                  <Hash :size="12" class="shrink-0 text-ink-faint" aria-hidden="true" />
                  <span class="min-w-0 truncate text-xs" :class="x.group ? 'font-medium text-ink' : 'text-ink-muted'" :title="x.name">{{ x.name }}</span>
                  <span v-if="x.group?.gone" class="inline-flex shrink-0 items-center gap-1 rounded-full bg-fill px-1.5 py-px text-2xs text-warning" :title="t('telegram.topicMap.goneHint')" data-telegram-topic-gone>
                    <TriangleAlert :size="12" aria-hidden="true" />{{ t('telegram.topicMap.gone') }}
                  </span>
                  <span v-if="x.group?.broken" class="inline-flex shrink-0 items-center gap-1 rounded-full bg-fill px-1.5 py-px text-2xs text-warning" :title="t('telegram.topicMap.brokenHint')" data-telegram-topic-broken>
                    <TriangleAlert :size="12" aria-hidden="true" />{{ t('telegram.topicMap.broken') }}
                  </span>
                  <span v-if="x.group && topicFailing(x.group)" class="inline-flex shrink-0 items-center gap-1 rounded-full bg-fill px-1.5 py-px text-2xs text-warning" :title="t('telegram.topicMap.errorHint')" data-telegram-topic-error>
                    <TriangleAlert :size="12" aria-hidden="true" />{{ t('telegram.topicMap.lastError', { error: topicErrorText(x.group) }) }}
                  </span>
                  <span v-else-if="x.group && topicSentAgo(x.group) && !x.group.broken && !x.group.gone" class="inline-flex shrink-0 items-center gap-1 text-2xs text-ink-faint" data-telegram-topic-sent>
                    <Send :size="11" aria-hidden="true" />{{ topicSentAgo(x.group) }}
                  </span>
                  <span v-if="x.group?.projects.length && x.group.sessions.length" class="ml-auto shrink-0 text-2xs text-ink-faint">{{ t('telegram.topicMap.sessionFirst') }}</span>
                  <span v-if="!x.group" class="ml-auto shrink-0 text-2xs text-ink-faint opacity-0 transition-opacity group-hover/topic:opacity-100" :class="dragging ? 'opacity-100' : ''">{{ t('telegram.tree.dropHere') }}</span>
                  <button
                    v-if="topicUrl(x.chatId, x.threadId) && !x.group?.gone"
                    type="button"
                    class="ccm-btn-plain shrink-0 px-1 opacity-0 transition-opacity group-hover/topic:opacity-100 focus-visible:opacity-100"
                    :class="x.group && !(x.group.projects.length && x.group.sessions.length) ? 'ml-auto' : ''"
                    :aria-label="t('telegram.topicMap.open', { topic: x.name })"
                    :title="t('telegram.topicMap.open', { topic: x.name })"
                    data-telegram-topic-open
                    @click="openTopic(x)"
                  >
                    <ExternalLink :size="12" aria-hidden="true" />
                  </button>
                </div>
                <div v-if="x.group?.gone" class="flex flex-wrap items-center gap-x-2 pr-3 pb-1 pl-12 text-2xs leading-relaxed text-ink-muted" data-telegram-topic-gone-hint>
                  <span class="min-w-0 flex-1 basis-60">{{ t('telegram.topicMap.goneHint') }}</span>
                  <button v-if="goneFix(x.group)" type="button" class="ccm-btn text-2xs" data-telegram-topic-gone-fix @click="applyGoneFix(x.group)">
                    <Link2 :size="12" aria-hidden="true" />{{ t('telegram.topicMap.goneFix', { topic: goneFix(x.group)!.topic.name }) }}
                  </button>
                </div>
                <div v-if="x.group?.broken" class="flex flex-wrap items-center gap-x-2 pr-3 pb-1 pl-12 text-2xs leading-relaxed text-ink-muted" data-telegram-topic-fix>
                  <span class="min-w-0 flex-1 basis-60">{{ t('telegram.topicMap.brokenHint') }}</span>
                  <button
                    type="button"
                    class="ccm-btn-plain text-2xs"
                    :disabled="testing !== null"
                    data-telegram-topic-retest
                    @click="x.group.sessions[0] ? test(x.group.sessions[0].project, x.group.sessions[0].session) : test(x.group.projects[0]?.project)"
                  >
                    <Send :size="12" aria-hidden="true" />{{ t('telegram.topicMap.retest') }}
                  </button>
                </div>
                <div v-if="x.group && topicFailing(x.group)" class="flex flex-wrap items-center gap-x-2 pr-3 pb-1 pl-12 text-2xs leading-relaxed text-ink-muted" data-telegram-topic-error-fix>
                  <span class="min-w-0 flex-1 basis-60">{{ t('telegram.topicMap.errorHint') }}</span>
                  <button
                    type="button"
                    class="ccm-btn-plain text-2xs"
                    :disabled="testing !== null"
                    data-telegram-topic-retest
                    @click="x.group.sessions[0] ? test(x.group.sessions[0].project, x.group.sessions[0].session) : test(x.group.projects[0]?.project)"
                  >
                    <Send :size="12" aria-hidden="true" />{{ t('telegram.topicMap.retest') }}
                  </button>
                </div>
                <ul v-if="x.group">
                  <li
                    v-for="r in x.group.projects"
                    :key="`p:${r.project}`"
                    draggable="true"
                    class="group/row relative flex w-full cursor-grab flex-wrap items-center gap-x-2 gap-y-1 py-1.5 pr-3 pl-12 active:cursor-grabbing"
                    :class="dragging?.kind === 'project' && dragging.project === r.project ? 'opacity-50' : ''"
                    :title="t('telegram.drag.rowHint')"
                    data-telegram-route
                    @dragstart="onDragStart($event, { kind: 'project', project: r.project, name: routeName(r) })"
                    @dragend="onDragEnd"
                  >
                    <GripVertical :size="12" class="absolute top-1/2 left-7 -translate-y-1/2 text-ink-faint opacity-60 transition-opacity group-hover/row:opacity-100" aria-hidden="true" />
                    <Folder :size="13" class="shrink-0 text-ink-faint" :aria-label="t('telegram.project')" />
                    <div class="min-w-0 flex-1 basis-40">
                      <p class="truncate text-sm" :title="r.project">{{ routeName(r) }}</p>
                      <p class="truncate font-mono text-2xs text-ink-faint" :title="r.project">{{ r.project }}</p>
                    </div>
                    <AppSelect
                      v-if="inChat(r)"
                      :model-value="r.threadId"
                      :options="chatTopicOptions"
                      :label="t('telegram.topic')"
                      :display="topicName(r)"
                      size="sm"
                      data-telegram-route-topic
                      @update:model-value="(v: number | null) => moveRoute(r, v)"
                    />
                    <button
                      v-if="tg.chat?.canManageTopics"
                      type="button"
                      class="ccm-btn-plain px-1.5 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100"
                      :disabled="creating !== null"
                      :aria-label="t('telegram.createTopicTitle')"
                      :title="t('telegram.createTopicTitle')"
                      data-telegram-route-create
                      @click="createTopic(r.project)"
                    >
                      <FolderPlus :size="13" aria-hidden="true" />
                    </button>
                    <button type="button" class="ccm-btn-plain px-1.5 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100" :disabled="testing !== null" :aria-label="t('telegram.testRow')" :title="t('telegram.testRow')" data-telegram-route-test @click="test(r.project)">
                      <Send :size="13" :class="testing === r.project ? 'ccm-pulse' : ''" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      class="ccm-btn-plain px-1.5 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 text-st-error"
                      :aria-label="t('telegram.removeTitle', { name: routeName(r) })"
                      :title="t('telegram.removeTitle', { name: routeName(r) })"
                      data-telegram-route-remove
                      @click="removeRoute(r.project)"
                    >
                      <Trash2 :size="13" aria-hidden="true" />
                    </button>
                  </li>
                  <li
                    v-for="r in x.group.sessions"
                    :key="`s:${r.session}`"
                    draggable="true"
                    class="group/row relative flex w-full cursor-grab flex-wrap items-center gap-x-2 gap-y-1 py-1.5 pr-3 pl-12 active:cursor-grabbing"
                    :class="dragging?.kind === 'session' && dragging.route.session === r.session ? 'opacity-50' : ''"
                    :title="t('telegram.drag.rowHint')"
                    data-telegram-session-link
                    @dragstart="onDragStart($event, { kind: 'session', route: r })"
                    @dragend="onDragEnd"
                  >
                    <GripVertical :size="12" class="absolute top-1/2 left-7 -translate-y-1/2 text-ink-faint opacity-60 transition-opacity group-hover/row:opacity-100" aria-hidden="true" />
                    <MessageSquare :size="13" class="shrink-0 text-ink-faint" :aria-label="t('telegram.connect.session')" />
                    <div class="min-w-0 flex-1 basis-40">
                      <button v-if="r.pane" type="button" class="block max-w-full truncate text-left text-sm hover:underline" :title="t('telegram.sessionLinks.show', { name: r.name })" data-telegram-session-link-name @click="showSession(r.pane)">{{ r.name }}</button>
                      <p v-else class="truncate text-sm text-ink-muted" :title="r.name">{{ r.name }}</p>
                      <p class="truncate font-mono text-2xs text-ink-faint" :title="r.project">{{ r.project }}</p>
                    </div>
                    <span
                      class="inline-flex max-w-40 items-center gap-1 rounded-full bg-fill px-1.5 py-px text-2xs"
                      :class="r.live ? 'text-ink' : 'text-ink-muted'"
                      :title="r.live ? r.live.word : t('telegram.sessionLinks.closedHint')"
                      :data-state="r.live?.state ?? 'closed'"
                      data-telegram-session-link-state
                    >
                      <StatusIcon v-if="r.live" :status="r.live.badge" :size="12" /><CircleDashed v-else :size="12" class="shrink-0" aria-hidden="true" /><span class="truncate">{{ r.live ? r.live.word : t('telegram.sessionLinks.closed') }}</span>
                    </span>
                    <AppSelect
                      v-if="inChat(r)"
                      :model-value="r.threadId"
                      :options="chatTopicOptions"
                      :label="t('telegram.topic')"
                      :display="topicName(r)"
                      size="sm"
                      data-telegram-session-link-topic
                      @update:model-value="(v: number | null) => moveSession(r, v)"
                    />
                    <button
                      type="button"
                      class="ccm-btn-plain px-1.5"
                      :class="r.keep ? 'text-accent-ink' : 'opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100'"
                      :aria-pressed="!!r.keep"
                      :aria-label="t('telegram.sessionLinks.keep')"
                      :title="t(r.keep ? 'telegram.sessionLinks.keepOn' : 'telegram.sessionLinks.keepOff')"
                      data-telegram-session-link-keep
                      @click="setKeep(r)"
                    >
                      <Pin :size="13" aria-hidden="true" />
                    </button>
                    <button type="button" class="ccm-btn-plain px-1.5 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100" :disabled="testing !== null" :aria-label="t('telegram.testRow')" :title="t('telegram.testRow')" data-telegram-session-link-test @click="test(r.project, r.session)">
                      <Send :size="13" :class="testing === r.session ? 'ccm-pulse' : ''" aria-hidden="true" />
                    </button>
                    <button
                      v-if="r.pane"
                      type="button"
                      class="ccm-btn-plain px-1.5 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100"
                      :aria-label="t('telegram.sessionLinks.show', { name: r.name })"
                      :title="t('telegram.sessionLinks.show', { name: r.name })"
                      data-telegram-session-link-show
                      @click="showSession(r.pane)"
                    >
                      <Terminal :size="13" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      class="ccm-btn-plain px-1.5 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 text-st-error"
                      :aria-label="t('telegram.sessionLinks.remove', { name: r.name })"
                      :title="t('telegram.sessionLinks.remove', { name: r.name })"
                      data-telegram-session-link-remove
                      @click="removeSessionLink(r.session)"
                    >
                      <Trash2 :size="13" aria-hidden="true" />
                    </button>
                  </li>
                </ul>
              </li>
            </ul>
          </li>
        </ul>
        <p v-if="sessionLinks.length" class="border-t border-line px-3 py-1.5 text-2xs text-ink-faint">{{ t('telegram.sessionLinks.hint') }}</p>
        <div class="flex flex-col gap-2 border-t border-line px-3 py-2" data-telegram-add>
          <div class="flex flex-wrap items-center gap-2">
            <AppSelect
              :model-value="newProject"
              :options="projectOptions"
              :label="t('telegram.project')"
              :display="newProject ? projectLabel(newProject) : t('telegram.projectPick')"
              size="sm"
              class="min-w-0"
              data-telegram-add-project
              @update:model-value="chooseProject"
            />
            <template v-if="tg.chat">
              <AppSelect v-model="newTopic" :options="chatTopicOptions" :label="t('telegram.topic')" size="sm" class="min-w-0" data-telegram-add-topic />
              <button type="button" class="ccm-btn" :disabled="!newProject" data-telegram-add-route @click="addRoute">
                <Plus :size="13" aria-hidden="true" />{{ t('telegram.add') }}
              </button>
              <button
                v-if="tg.chat.canManageTopics"
                type="button"
                class="ccm-btn-plain text-xs"
                :disabled="!newProject || creating !== null"
                :title="t('telegram.createTopicTitle')"
                data-telegram-add-create
                @click="newProject && createTopic(newProject)"
              >
                <FolderPlus :size="13" aria-hidden="true" />{{ t('telegram.createTopic') }}
              </button>
            </template>
          </div>
          <p v-if="newProject" class="truncate font-mono text-2xs text-ink-faint" :title="newProject">{{ newProject }}</p>
          <p v-if="!tg.chat" class="text-2xs text-ink-muted">{{ t('telegram.pickGroupFirst') }}</p>
          <details class="group" :open="!tg.chat || undefined" data-telegram-link>
            <summary class="flex cursor-pointer list-none items-center gap-1 text-xs text-ink-muted [&::-webkit-details-marker]:hidden">
              <ChevronRight :size="13" class="transition-transform duration-(--ccm-dur-fast) group-open:rotate-90" aria-hidden="true" />{{ t('telegram.linkSection') }}
            </summary>
            <div class="mt-2 flex flex-col gap-1">
              <label for="telegram-link" class="text-xs text-ink-muted">{{ t('telegram.link') }}</label>
              <div class="flex items-center gap-2">
                <input
                  id="telegram-link"
                  v-model="link"
                  type="text"
                  spellcheck="false"
                  maxlength="300"
                  :placeholder="t('telegram.linkPlaceholder')"
                  :aria-invalid="linkView ? !linkView.ok : undefined"
                  class="ccm-field min-w-0 flex-1 font-mono text-xs"
                  data-telegram-link-input
                />
                <button type="button" class="ccm-btn shrink-0" :disabled="!newProject || !parsedLink" data-telegram-add-link @click="addByLink">{{ t('telegram.addLink') }}</button>
              </div>
              <Transition name="ccm-swap" mode="out-in">
                <p v-if="linkView" :key="linkView.text" class="truncate text-2xs" :class="linkView.ok ? 'text-success' : 'text-st-error'" aria-live="polite" data-telegram-link-view>{{ linkView.text }}</p>
                <p v-else class="text-2xs text-ink-faint">{{ t('telegram.linkHint') }}</p>
              </Transition>
            </div>
          </details>
        </div>
      </div>
      <template v-if="unrouted.length">
        <div class="mt-4 mb-1.5 flex items-center gap-2 px-3">
          <h4 class="text-2xs font-semibold text-ink-muted">{{ t('telegram.unrouted.title') }} · {{ unrouted.length }}</h4>
          <button v-if="bulkSuggest.length > 1" type="button" class="ccm-btn-plain ml-auto text-2xs" :disabled="bulkBusy" :title="t('telegram.unrouted.allHint')" data-telegram-unrouted-all @click="routeAllSuggested">
            <Link2 :size="12" aria-hidden="true" />{{ t('telegram.unrouted.all', { n: bulkSuggest.length }) }}
          </button>
        </div>
        <div class="ccm-group overflow-hidden" data-telegram-unrouted>
          <TransitionGroup tag="ul" name="ccm-list" class="relative divide-y divide-line" @before-leave="pinLeaving">
            <li
              v-for="u in unrouted"
              :key="u.project"
              :draggable="!!tg.chat"
              class="group/row relative flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 pr-3 pl-7"
              :class="[tg.chat ? 'cursor-grab active:cursor-grabbing' : '', dragging?.kind === 'project' && dragging.project === u.project ? 'opacity-50' : '']"
              :title="tg.chat ? t('telegram.drag.rowHint') : undefined"
              data-telegram-unrouted-row
              @dragstart="onDragStart($event, { kind: 'project', project: u.project, name: projectLabel(u.project) })"
              @dragend="onDragEnd"
            >
              <GripVertical :size="12" class="absolute top-1/2 left-2 -translate-y-1/2 text-ink-faint opacity-60 transition-opacity group-hover/row:opacity-100" aria-hidden="true" />
              <Folder :size="13" class="shrink-0 text-ink-faint" aria-hidden="true" />
              <div class="min-w-0 flex-1 basis-40">
                <p class="truncate text-sm" :title="u.project">{{ projectLabel(u.project) }}</p>
                <p class="flex min-w-0 flex-wrap items-center gap-x-2 text-2xs text-ink-faint">
                  <button
                    v-for="x in u.sessions"
                    :key="x.key"
                    type="button"
                    class="inline-flex max-w-48 items-center gap-1 hover:underline"
                    :title="`${x.name} · ${x.live.word}`"
                    @click="showSession(x.key)"
                  >
                    <StatusIcon :status="x.live.badge" :size="11" /><span class="truncate">{{ x.name }}</span>
                  </button>
                </p>
              </div>
              <template v-if="tg.chat">
                <button v-if="u.suggest" type="button" class="ccm-btn text-xs" :title="t('telegram.unrouted.suggestHint')" data-telegram-unrouted-suggest @click="routeProject(u.project, u.suggest.threadId)">
                  <Link2 :size="12" aria-hidden="true" />{{ t('telegram.unrouted.suggest', { topic: u.suggest.name }) }}
                </button>
                <AppSelect
                  :model-value="''"
                  :options="pickTopicOptions"
                  :label="t('telegram.topic')"
                  :display="u.suggest ? t('telegram.unrouted.other') : t('telegram.unrouted.pick')"
                  size="sm"
                  data-telegram-unrouted-topic
                  @update:model-value="(v: string) => v && routeProject(u.project, v === GENERAL ? null : Number(v))"
                />
                <button
                  v-if="!u.suggest && tg.chat.canManageTopics"
                  type="button"
                  class="ccm-btn-plain px-1.5"
                  :disabled="creating !== null"
                  :aria-label="t('telegram.createTopicTitle')"
                  :title="t('telegram.createTopicTitle')"
                  data-telegram-unrouted-create
                  @click="createTopic(u.project)"
                >
                  <FolderPlus :size="13" :class="creating === u.project ? 'ccm-pulse' : ''" aria-hidden="true" />
                </button>
              </template>
            </li>
          </TransitionGroup>
          <p class="flex flex-wrap items-center gap-2 border-t border-line px-3 py-1.5 text-2xs text-ink-faint">
            {{ tg.chat ? t('telegram.unrouted.hint') : t('telegram.unrouted.scanFirst') }}
            <button v-if="!tg.chat" type="button" class="ccm-btn-plain text-2xs" :disabled="!state.configured || scanning" data-telegram-unrouted-scan @click="scan">
              <RefreshCw :size="12" :class="scanning ? 'ccm-spin' : ''" aria-hidden="true" />{{ scanning ? t('telegram.scanning') : t('telegram.scan') }}
            </button>
          </p>
        </div>
      </template>
    </div>

    <div v-show="tab === 'receive'" class="mt-4" data-telegram-tab="receive">
      <h4 class="mb-1.5 px-3 text-2xs font-semibold text-ink-muted">{{ t('telegram.receive.title') }}</h4>
      <div class="ccm-group divide-y divide-line overflow-hidden" data-telegram-receive>
        <div class="px-3 py-2">
          <p class="text-2xs leading-relaxed text-ink-muted">{{ t('telegram.receive.intro', { bot: botName }) }}</p>
          <p class="mt-1 text-2xs leading-relaxed text-ink-faint">{{ t('telegram.receive.limits') }}</p>
          <details class="group mt-2" data-telegram-actions>
            <summary class="flex cursor-pointer list-none items-center gap-1 text-xs text-ink-muted [&::-webkit-details-marker]:hidden">
              <ChevronRight :size="13" class="transition-transform duration-(--ccm-dur-fast) group-open:rotate-90" aria-hidden="true" />{{ t('telegram.receive.actionsTitle') }}
            </summary>
            <ul class="mt-2 flex list-disc flex-col gap-1 pl-8 text-2xs leading-relaxed text-ink-muted">
              <li v-for="a in actions" :key="a.key">{{ a.text }}</li>
            </ul>
            <p class="mt-1.5 flex items-start gap-1.5 text-2xs leading-relaxed text-warning">
              <ShieldAlert :size="12" class="mt-0.5 shrink-0" aria-hidden="true" />{{ t('telegram.receive.actionsNote') }}
            </p>
          </details>
        </div>
        <Transition name="ccm-swap" mode="out-in">
          <div v-if="state.owner" key="owner" class="flex items-center gap-3 px-3 py-2" data-telegram-owner>
            <UserCheck :size="15" class="shrink-0 text-success" aria-hidden="true" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm text-success" :title="state.owner.name">{{ t('telegram.receive.paired', { name: state.owner.name }) }}</p>
              <p class="mt-0.5 text-2xs text-ink-faint">{{ t('telegram.receive.unpairHint') }}</p>
            </div>
            <button type="button" class="ccm-btn-plain shrink-0 text-xs text-st-error" data-telegram-unpair @click="unpair">{{ t('telegram.receive.unpair') }}</button>
          </div>
          <div v-else-if="state.pairCode" key="code" class="flex flex-col gap-2 px-3 py-2" data-telegram-pairing>
            <p class="text-xs text-ink-muted">{{ t('telegram.receive.pairSay') }}</p>
            <div class="flex flex-wrap items-center gap-2">
              <code class="ccm-pop min-w-0 truncate rounded-inner bg-fill px-2 py-1 font-mono text-lg font-semibold tracking-wide text-ink tabular-nums" :title="pairCommand" data-telegram-pair-code>{{ pairCommand }}</code>
              <button type="button" class="ccm-btn-plain shrink-0 text-xs" data-telegram-pair-copy @click="copyPair">
                <Copy :size="13" aria-hidden="true" />{{ t('telegram.receive.copy') }}
              </button>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <p class="text-2xs tabular-nums" :class="pairExpired ? 'text-st-error' : 'text-ink-faint'" aria-live="off" data-telegram-pair-left>
                {{ pairExpired ? t('telegram.receive.expired') : t('telegram.receive.expires', { time: pairLeft }) }}
              </p>
              <button v-if="pairExpired" type="button" class="ccm-btn ml-auto text-xs" :disabled="pairing" @click="pair(true)">{{ t('telegram.receive.pair') }}</button>
              <button type="button" class="ccm-btn-plain text-xs" :class="pairExpired ? '' : 'ml-auto'" :disabled="pairing" data-telegram-pair-cancel @click="pair(false)">{{ t('telegram.receive.cancel') }}</button>
            </div>
          </div>
          <div v-else key="none" class="flex items-center gap-3 px-3 py-2" data-telegram-unpaired>
            <Link2 :size="15" class="shrink-0 text-ink-muted" aria-hidden="true" />
            <p class="min-w-0 flex-1 text-2xs text-ink-faint">{{ t('telegram.receive.pairHint') }}</p>
            <button type="button" class="ccm-btn shrink-0" :disabled="!state.configured || pairing" data-telegram-pair @click="pair(true)">{{ t('telegram.receive.pair') }}</button>
          </div>
        </Transition>
        <div class="flex items-center gap-3 px-3">
          <ToggleSwitch
            :model-value="state.receiving"
            :label="t('telegram.receive.switch')"
            :hint="state.owner && state.configured ? t('telegram.receive.switchHint') : state.configured ? t('telegram.receive.needOwner') : t('telegram.needToken')"
            :disabled="!state.owner || !state.configured"
            class="min-w-0 flex-1"
            data-telegram-receiving
            @update:model-value="setReceiving"
          />
        </div>
        <Transition name="ccm-swap">
          <p v-if="state.receiving" class="flex items-center gap-2 bg-warning-soft px-3 py-1.5 text-2xs text-ink" role="status" data-telegram-receiving-on>
            <Radio :size="13" class="shrink-0 text-warning" aria-hidden="true" />{{ t('telegram.receive.top') }}
          </p>
        </Transition>
        <div class="flex flex-col px-3 pb-2" data-telegram-stranger>
          <ToggleSwitch
            :model-value="state.stranger.enabled"
            :label="t('telegram.stranger.title')"
            :hint="t('telegram.stranger.hint')"
            data-telegram-stranger-toggle
            @update:model-value="(on: boolean) => patch({ stranger: { enabled: on, text: state!.stranger.text } })"
          />
          <template v-if="state.stranger.enabled">
            <input
              :value="state.stranger.text"
              type="text"
              maxlength="300"
              :aria-label="t('telegram.stranger.title')"
              :placeholder="t('telegram.stranger.default', { owner: state.owner?.name ?? t('telegram.stranger.you') })"
              class="ccm-field text-xs"
              data-telegram-stranger-text
              @change="(e: Event) => patch({ stranger: { enabled: true, text: (e.target as HTMLInputElement).value } })"
            />
            <p class="mt-1 text-2xs text-ink-faint">{{ t('telegram.stranger.textHint') }}</p>
          </template>
        </div>
        <div class="flex flex-col gap-2 px-3 py-2" data-telegram-members>
          <div class="flex items-center gap-2">
            <Users :size="15" class="shrink-0 text-ink-muted" aria-hidden="true" />
            <p class="min-w-0 flex-1 text-sm">{{ t('telegram.members.title') }}</p>
            <span class="shrink-0 text-2xs text-ink-faint tabular-nums">{{ t('telegram.members.count', { n: members.length, max: TELEGRAM_MEMBERS_MAX }) }}</span>
          </div>
          <p class="text-2xs leading-relaxed text-ink-faint">{{ t('telegram.members.hint') }}</p>
          <TransitionGroup v-if="members.length" tag="ul" name="ccm-list" class="flex flex-col divide-y divide-line rounded-inner bg-fill" data-telegram-member-list>
            <li v-for="m in members" :key="m.id" class="flex items-center gap-2 px-2 py-1.5" :data-telegram-member="m.id">
              <div class="min-w-0 flex-1">
                <p class="truncate text-xs" :title="m.name">{{ m.name }}</p>
                <p class="font-mono text-2xs text-ink-faint tabular-nums">{{ t('telegram.members.id', { id: m.id }) }}</p>
              </div>
              <SegmentedControl
                :model-value="m.level"
                :options="levelOptions"
                :label="t('telegram.members.level', { name: m.name })"
                class="shrink-0"
                data-telegram-member-level
                @update:model-value="(level: TelegramMemberLevel) => setLevel(m.id, level)"
              />
              <button type="button" class="ccm-btn-plain shrink-0 text-st-error" :aria-label="t('telegram.members.remove', { name: m.name })" :title="t('telegram.members.remove', { name: m.name })" data-telegram-member-remove @click="removeMember(m.id)">
                <Trash2 :size="13" aria-hidden="true" />
              </button>
            </li>
          </TransitionGroup>
          <p v-else class="text-2xs text-ink-faint">{{ t('telegram.members.empty') }}</p>
          <h5 class="mt-1 text-2xs font-semibold text-ink-muted">{{ t('telegram.members.recent') }}</h5>
          <ul v-if="state.recentStrangers.length" class="flex flex-col divide-y divide-line" data-telegram-recent>
            <li v-for="s in state.recentStrangers" :key="s.id" class="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5" :data-telegram-recent-id="s.id">
              <div class="min-w-0 flex-1">
                <p class="truncate text-xs" :title="s.name">{{ s.name }}</p>
                <p class="truncate text-2xs text-ink-faint tabular-nums" :title="s.chat || t('telegram.members.private')">
                  {{ t('telegram.members.id', { id: s.id }) }} · {{ s.chat || t('telegram.members.private') }} · {{ relativeTime(Math.min(s.at, now), locale, now) }}
                </p>
              </div>
              <button type="button" class="ccm-btn shrink-0 text-xs" :disabled="membersFull" data-telegram-add-read @click="addMember(s, 'read')">
                <Eye :size="13" aria-hidden="true" />{{ t('telegram.members.addRead') }}
              </button>
              <button type="button" class="ccm-btn shrink-0 text-xs" :disabled="membersFull" data-telegram-add-full @click="addMember(s, 'full')">
                <UserPlus :size="13" aria-hidden="true" />{{ t('telegram.members.addFull') }}
              </button>
            </li>
          </ul>
          <p v-else class="text-2xs text-ink-faint">{{ t('telegram.members.recentEmpty') }}</p>
          <p v-if="membersFull && state.recentStrangers.length" class="text-2xs text-warning" role="status">{{ t('telegram.members.maxed', { max: TELEGRAM_MEMBERS_MAX }) }}</p>
        </div>
        <div class="flex items-center gap-3 px-3 py-2" data-telegram-receive-command>
          <Terminal :size="15" class="shrink-0 text-ink-muted" aria-hidden="true" />
          <div class="min-w-0 flex-1">
            <p class="flex flex-wrap items-center gap-2 text-sm">
              <span class="font-mono text-xs">{{ t('telegram.receive.command') }}</span>
              <Transition name="ccm-swap" mode="out-in">
                <span v-if="state.receiveInstalled" key="on" class="inline-flex items-center gap-1 text-2xs text-success"><CircleCheck :size="12" aria-hidden="true" />{{ t('telegram.commandInstalled') }}</span>
                <span v-else key="off" class="inline-flex items-center gap-1 text-2xs text-ink-faint"><CircleDashed :size="12" aria-hidden="true" />{{ t('telegram.commandMissing') }}</span>
              </Transition>
            </p>
            <p class="mt-0.5 truncate text-2xs text-ink-faint" :title="t('telegram.receive.commandHint')">{{ t('telegram.receive.commandHint') }}</p>
          </div>
          <button type="button" class="ccm-btn shrink-0" :disabled="installingReceive" data-telegram-install-receive @click="installReceive">
            {{ state.receiveInstalled ? t('telegram.commandReinstall') : t('telegram.commandInstall') }}
          </button>
        </div>
        <Transition name="ccm-swap">
          <p v-if="state.ignored > 0" :key="state.ignored" class="px-3 py-1.5 text-2xs text-ink-faint tabular-nums" data-telegram-ignored>{{ t('telegram.receive.ignored', { n: state.ignored }, state.ignored) }}</p>
        </Transition>
      </div>
    </div>

    <div v-show="tab === 'report'" class="mt-4" data-telegram-tab="report">
      <div class="ccm-group divide-y divide-line overflow-hidden">
        <ToggleSwitch :model-value="state.includeReply" :label="t('telegram.includeReply')" :hint="t('telegram.includeReplyHint')" class="px-3" data-telegram-reply @update:model-value="(on: boolean) => patch({ includeReply: on })" />
        <ToggleSwitch :model-value="state.waiting" :label="t('telegram.waiting')" :hint="t('telegram.waitingHint')" class="px-3" data-telegram-waiting @update:model-value="(on: boolean) => patch({ waiting: on })" />
        <ToggleSwitch :model-value="state.digest" :label="t('telegram.digest')" :hint="t('telegram.digestHint')" class="px-3" data-telegram-digest @update:model-value="(on: boolean) => patch({ digest: on })" />
        <div class="px-3 py-2">
          <p class="text-sm">{{ t('telegram.done') }}</p>
          <p class="mt-0.5 text-2xs text-ink-faint">{{ t('telegram.doneHint') }}</p>
          <SegmentedControl :model-value="state.doneMinutes" :options="doneOptions" :label="t('telegram.done')" fill class="mt-2 w-full" data-telegram-done @update:model-value="(n: number) => patch({ doneMinutes: n })" />
        </div>
        <ToggleSwitch :model-value="state.alerts" :label="t('telegram.alerts')" :hint="t('telegram.alertsHint')" class="px-3" data-telegram-alerts @update:model-value="(on: boolean) => patch({ alerts: on })" />
        <div class="px-3" data-telegram-quiet>
          <ToggleSwitch :model-value="quiet.enabled" :label="t('telegram.quiet')" :hint="t('telegram.quietHint')" @update:model-value="(on: boolean) => setQuiet({ enabled: on })" />
          <div class="flex flex-wrap items-center gap-2 pb-2 text-xs text-ink-muted" :class="quiet.enabled ? '' : 'opacity-50'">
            <template v-for="f in (['from', 'to'] as const)" :key="f">
              <label :for="`tg-quiet-${f}`">{{ f === 'from' ? t('telegram.quietFrom') : t('telegram.quietTo') }}</label>
              <input
                :id="`tg-quiet-${f}`"
                type="time"
                :value="quiet[f]"
                :disabled="!quiet.enabled"
                class="ccm-field tabular-nums disabled:cursor-not-allowed"
                :data-telegram-quiet-time="f"
                @change="onQuietTime(f, $event)"
              />
            </template>
          </div>
        </div>
        <div class="px-3" data-telegram-summary>
          <ToggleSwitch :model-value="summary.enabled" :label="t('telegram.summary')" :hint="t('telegram.summaryHint')" @update:model-value="(on: boolean) => setSummary({ enabled: on })" />
          <div class="flex flex-wrap items-center gap-2 pb-2 text-xs text-ink-muted" :class="summary.enabled ? '' : 'opacity-50'">
            <label for="tg-summary-at">{{ t('telegram.summaryAt') }}</label>
            <input id="tg-summary-at" type="time" :value="summary.at" :disabled="!summary.enabled" class="ccm-field tabular-nums disabled:cursor-not-allowed" data-telegram-summary-time @change="onSummaryTime" />
          </div>
        </div>
        <div class="flex items-start gap-2 px-3" data-telegram-pin>
          <Pin :size="15" class="mt-2.5 shrink-0 text-ink-muted" aria-hidden="true" />
          <ToggleSwitch :model-value="state.pinStatus" :label="t('telegram.pinStatus')" :hint="t('telegram.pinStatusHint')" class="min-w-0 flex-1" @update:model-value="(on: boolean) => patch({ pinStatus: on })" />
        </div>
        <div class="flex items-start gap-2 px-3" data-telegram-topic-icons>
          <Hash :size="15" class="mt-2.5 shrink-0 text-ink-muted" aria-hidden="true" />
          <ToggleSwitch :model-value="state.topicIcons" :label="t('telegram.topicIcons')" :hint="t('telegram.topicIconsHint')" class="min-w-0 flex-1" @update:model-value="(on: boolean) => patch({ topicIcons: on })" />
        </div>
        <div v-if="state.configured && healthRows.length" class="flex flex-col gap-1 px-3 py-2" role="status" data-telegram-health>
          <p class="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
            <Activity :size="13" aria-hidden="true" />{{ t('telegram.health.title') }}
          </p>
          <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-2xs">
            <template v-for="r in healthRows" :key="r.key">
              <dt class="text-ink-faint">{{ r.label }}</dt>
              <dd class="min-w-0 truncate text-ink tabular-nums" :data-telegram-health-row="r.key">
                <Transition name="ccm-swap" mode="out-in"><span :key="r.value" class="inline-block">{{ r.value }}</span></Transition>
              </dd>
            </template>
          </dl>
          <p class="flex flex-wrap items-center gap-1 text-2xs tabular-nums" data-telegram-health-today>
            <span class="text-ink-muted">{{ t('telegram.health.today', { n: state.health.sentToday }, state.health.sentToday) }}</span>
            <span class="text-ink-faint" aria-hidden="true">·</span>
            <span v-if="state.health.errorsToday > 0" class="inline-flex items-center gap-1 text-warning" data-telegram-health-errors>
              <TriangleAlert :size="12" aria-hidden="true" />{{ t('telegram.health.errors', { n: state.health.errorsToday }, state.health.errorsToday) }}
            </span>
            <span v-else class="inline-flex items-center gap-1 text-success"><CircleCheck :size="12" aria-hidden="true" />{{ t('telegram.health.noErrors') }}</span>
          </p>
        </div>
      </div>
      <div class="ccm-group mt-4 flex items-center gap-3 px-3 py-2" data-telegram-command>
        <Terminal :size="15" class="shrink-0 text-ink-muted" aria-hidden="true" />
        <div class="min-w-0 flex-1">
          <p class="flex flex-wrap items-center gap-2 text-sm">
            <span class="font-mono text-xs">{{ t('telegram.command') }}</span>
            <Transition name="ccm-swap" mode="out-in">
              <span v-if="state.commandInstalled" key="on" class="inline-flex items-center gap-1 text-2xs text-success"><CircleCheck :size="12" aria-hidden="true" />{{ t('telegram.commandInstalled') }}</span>
              <span v-else key="off" class="inline-flex items-center gap-1 text-2xs text-ink-faint"><CircleDashed :size="12" aria-hidden="true" />{{ t('telegram.commandMissing') }}</span>
            </Transition>
          </p>
          <p class="mt-0.5 truncate text-2xs text-ink-faint" :title="t('telegram.commandHint')">{{ t('telegram.commandHint') }}</p>
        </div>
        <button type="button" class="ccm-btn shrink-0" :disabled="installing" data-telegram-install @click="installCommand">
          {{ state.commandInstalled ? t('telegram.commandReinstall') : t('telegram.commandInstall') }}
        </button>
      </div>
    </div>

    <p v-if="!state.keychain" class="mt-1 px-3 text-2xs text-st-error" role="alert">{{ t('telegram.setError.keychain') }}</p>
    <p v-if="note" class="mt-1 px-3 text-2xs" :class="note.error ? 'text-st-error' : 'text-ink-muted'" aria-live="polite" data-telegram-note>{{ note.text }}</p>
    <p v-else-if="lastError" class="mt-1 px-3 text-2xs text-st-error" role="alert" data-telegram-error>{{ lastError }}</p>
    <p class="mt-1.5 px-3 text-2xs leading-relaxed text-ink-faint">{{ t('telegram.privacy') }}</p>
  </section>
</template>
