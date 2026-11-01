<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleAlert, CircleCheck, CircleHelp, HardDriveDownload, History, KeyRound, Link2, Package, Trash2, Undo2 } from 'lucide-vue-next'
import {
  CLEAN_AGE_DAYS,
  STRIP_AGE_DAYS,
  type AgentDataPlace,
  type AgentDataProgress,
  type AgentDataResult,
  type AgentDataSize,
  type AgentDataState,
  type DataAgent,
  type DataKind,
} from '@ccm/shared'
import {
  agentDataCancel,
  agentDataClean,
  agentDataDeleteOriginal,
  agentDataDiscard,
  agentDataMove,
  agentDataScan,
  agentDataState,
  agentDataStrip,
  agentDataUndo,
  onAgentData,
} from '../lib/agentData'
import { formatBytes } from '../lib/resources'
import { hasBuildClean } from '../lib/buildClean'
import { useUiStore } from '../stores/ui'
import SegmentedControl from './ui/SegmentedControl.vue'

/** Settings › Agent data (desktop, v76 R7): sizes of ~/.claude / ~/.codex, clean caches, strip images, move to another drive. */
const props = defineProps<{ open: boolean }>()

const { t, locale } = useI18n()
const ui = useUiStore()
const state = ref<AgentDataState | null>(null)
const sizes = ref<AgentDataSize[] | null>(null)
const running = ref<string | null>(null)
const progress = ref<AgentDataProgress | null>(null)
const note = ref<{ ok: boolean; text: string } | null>(null)
const picked = ref<Record<DataAgent, Set<string>>>({ claude: new Set(), codex: new Set() })
const olderDays = ref<number>(30)
const stripDays = ref<number>(30)

const bytes = (n: number): string => (n < 1024 * 1024 ? `${n ? Math.max(1, Math.round(n / 1024)) : 0} KB` : formatBytes(n, locale.value))
const refresh = async (): Promise<void> => {
  state.value = await agentDataState()
}

let off: (() => void) | null = null
watch(
  () => props.open,
  (open) => {
    if (!open) return
    void refresh()
    off ??= onAgentData((p) => {
      if (running.value) progress.value = p
    })
  },
  { immediate: true },
)
onBeforeUnmount(() => off?.())

const KIND_ICON: Record<DataKind, Component> = { cache: Trash2, history: History, config: KeyRound, program: Package, unknown: CircleHelp }
const KIND_CLASS: Record<DataKind, string> = { cache: 'text-success', history: 'text-accent-ink', config: 'text-warning', program: 'text-ink-muted', unknown: 'text-ink-faint' }

const sizeOf = (agent: string): AgentDataSize | null => sizes.value?.find((s) => s.agent === agent) ?? null
const appSize = computed(() => sizeOf('claudeApp'))
const ageOptions = computed(() => CLEAN_AGE_DAYS.map((n) => ({ value: n as number, label: n ? t('agentData.days', { n }) : t('agentData.anyAge') })))
const stripOptions = computed(() => STRIP_AGE_DAYS.map((n) => ({ value: n as number, label: t('agentData.days', { n }) })))
const agentName = (a: string): string => t(`agentData.agent.${a}`)
const camel = (code: string): string => code.replace(/-(\w)/g, (_m, c: string) => c.toUpperCase())

const pct = computed(() => {
  const p = progress.value
  return p?.totalBytes ? Math.min(100, Math.round((p.bytes / p.totalBytes) * 100)) : null
})
const progressText = computed(() => {
  const p = progress.value
  if (!p) return running.value ? t(`agentData.phase.${running.value}`) : ''
  const label = t(`agentData.phase.${p.phase ?? p.op}`)
  return p.totalBytes ? `${label} — ${t('agentData.of', { done: bytes(p.bytes), total: bytes(p.totalBytes) })}` : `${label} — ${bytes(p.bytes)}`
})

function toggle(agent: DataAgent, id: string): void {
  const next = new Set(picked.value[agent])
  if (next.has(id)) next.delete(id)
  else next.add(id)
  picked.value = { ...picked.value, [agent]: next }
}

function explain(r: AgentDataResult, agent: DataAgent | null, done: string, extra: Record<string, unknown> = {}): void {
  if (r.ok) {
    const skipped = r.skipped ? ` ${t('agentData.skipped', { n: r.skipped }, r.skipped)}` : ''
    note.value = { ok: true, text: t(`agentData.done.${done}`, { n: r.files ?? 0, size: bytes(r.bytes ?? 0), path: r.path ?? '', ...extra }, r.files ?? 0) + skipped }
    return
  }
  const code = r.error ?? 'failed'
  const list = (r.procs ?? []).map((p) => `${p.name} (${p.pid})`).join(', ')
  note.value = { ok: false, text: t(`agentData.error.${camel(code)}`, { agent: agent ? agentName(agent) : '', list, path: r.path ?? '' }) }
}

async function task<T>(op: string, fn: () => Promise<T>): Promise<T | null> {
  if (running.value) return null
  running.value = op
  progress.value = null
  note.value = null
  try {
    return await fn()
  } finally {
    running.value = null
    progress.value = null
    await refresh()
  }
}

const measure = (): Promise<void> =>
  task('scan', async () => {
    const r = await agentDataScan()
    if (r) sizes.value = r
  }).then(() => undefined)

async function clean(agent: DataAgent): Promise<void> {
  const groups = [...picked.value[agent]]
  if (!groups.length) return
  const r = await task('clean', async () => {
    const res = await agentDataClean({ agent, groups, olderDays: olderDays.value })
    const next = res.ok ? await agentDataScan() : null
    if (next) sizes.value = next
    return res
  })
  if (r) explain(r, agent, 'clean')
}

async function act(op: 'move' | 'undo' | 'delete' | 'discard', agent: DataAgent): Promise<void> {
  const call = { move: agentDataMove, undo: agentDataUndo, delete: agentDataDeleteOriginal, discard: agentDataDiscard }[op]
  const r = await task(op === 'discard' ? 'delete' : op, () => call(agent))
  if (r) explain(r, agent, op)
}

async function strip(): Promise<void> {
  const r = await task('strip', () => agentDataStrip(stripDays.value))
  if (r) explain(r, 'claude', 'strip')
}

const cleanable = (agent: DataAgent) => sizeOf(agent)?.groups.filter((g) => g.cleanable) ?? []
const backupName = (p: AgentDataPlace): string => p.move?.backup.split(/[\\/]/).pop() ?? ''
</script>

<template>
  <section v-if="state" aria-labelledby="set-agentdata" class="mt-6" data-agentdata>
    <h3 id="set-agentdata" class="mb-1.5 px-3 text-2xs font-semibold text-ink-muted">{{ t('agentData.section') }}</h3>
    <div class="ccm-group divide-y divide-line overflow-hidden">
      <div class="flex min-w-0 items-center gap-2 px-3 py-2">
        <p class="min-w-0 flex-1 text-2xs leading-relaxed text-ink-faint">{{ t('agentData.hint') }}</p>
        <button type="button" class="ccm-btn shrink-0" :disabled="!!running" data-agentdata-measure @click="measure">
          {{ sizes ? t('agentData.measureAgain') : t('agentData.measure') }}
        </button>
      </div>

      <div v-if="running" class="px-3 py-2" role="status" aria-live="polite" data-agentdata-progress>
        <div class="flex items-center gap-2">
          <p class="min-w-0 flex-1 truncate text-2xs text-ink-muted tabular-nums">{{ progressText }}</p>
          <button type="button" class="ccm-btn-plain shrink-0 text-xs" data-agentdata-cancel @click="agentDataCancel()">{{ t('agentData.cancel') }}</button>
        </div>
        <div
          class="mt-1 h-1 overflow-hidden rounded-full bg-fill"
          role="progressbar"
          :aria-label="progressText"
          :aria-valuenow="pct ?? undefined"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <div class="h-full rounded-full bg-accent transition-[width] duration-200" :class="pct === null ? 'w-1/3 animate-pulse' : ''" :style="pct === null ? undefined : { width: `${pct}%` }" />
        </div>
      </div>

      <p
        v-if="note"
        class="flex items-start gap-1.5 px-3 py-2 text-2xs leading-relaxed"
        :class="note.ok ? 'text-success' : 'text-warning'"
        :role="note.ok ? 'status' : 'alert'"
        :data-agentdata-note="note.ok ? 'ok' : 'error'"
      >
        <component :is="note.ok ? CircleCheck : CircleAlert" :size="13" class="mt-px shrink-0" aria-hidden="true" />
        <span class="min-w-0 break-words">{{ note.text }}</span>
      </p>

      <p v-for="a in state.recovered" :key="`rec-${a}`" class="flex items-start gap-1.5 px-3 py-2 text-2xs text-warning" role="alert" data-agentdata-recovered>
        <CircleAlert :size="13" class="mt-px shrink-0" aria-hidden="true" />{{ t('agentData.recovered', { agent: agentName(a) }) }}
      </p>

      <div v-for="p in state.places" :key="p.agent" class="px-3 py-2" :data-agentdata-agent="p.agent">
        <div class="flex min-w-0 items-baseline gap-2">
          <p class="text-sm font-medium text-ink">{{ agentName(p.agent) }}</p>
          <p class="min-w-0 flex-1 truncate font-mono text-2xs text-ink-faint" :title="p.root">{{ p.root }}</p>
          <p class="shrink-0 text-2xs text-ink-muted tabular-nums" data-agentdata-total>
            <template v-if="!p.exists">{{ t('agentData.missing') }}</template>
            <template v-else-if="sizeOf(p.agent)">{{ t('agentData.total', { size: bytes(sizeOf(p.agent)!.bytes), n: sizeOf(p.agent)!.files }, sizeOf(p.agent)!.files) }}</template>
            <template v-else>{{ t('agentData.notMeasured') }}</template>
          </p>
        </div>

        <ul v-if="sizeOf(p.agent)?.groups.length" class="mt-1.5 flex flex-col">
          <li v-for="g in sizeOf(p.agent)!.groups" :key="g.id" class="flex min-h-7 min-w-0 items-center gap-2 text-xs" :data-agentdata-group="g.id" :data-kind="g.kind">
            <input
              v-if="g.cleanable"
              type="checkbox"
              class="size-4 shrink-0 cursor-pointer accent-accent"
              :checked="picked[p.agent].has(g.id)"
              :disabled="!!running || !!p.linkTarget"
              :aria-label="t(`agentData.group.${g.id}`)"
              data-agentdata-pick
              @change="toggle(p.agent, g.id)"
            />
            <span v-else class="size-4 shrink-0" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate text-ink" :title="g.entries.map((e) => e.name + (e.link ? ` → ${e.link}` : '')).join('\n')">
              {{ t(`agentData.group.${g.id}`) }}
              <Link2 v-if="g.entries.some((e) => e.link)" :size="11" class="ml-0.5 inline text-ink-faint" :aria-label="t('agentData.link', { path: g.entries.find((e) => e.link)?.link ?? '' })" />
            </span>
            <span class="inline-flex shrink-0 items-center gap-1 text-2xs" :class="KIND_CLASS[g.kind]" :title="t(`agentData.kindHint.${g.kind}`)">
              <component :is="KIND_ICON[g.kind]" :size="12" aria-hidden="true" />{{ t(`agentData.kind.${g.kind}`) }}
            </span>
            <span class="w-16 shrink-0 text-right text-2xs text-ink-muted tabular-nums">{{ bytes(g.bytes) }}</span>
          </li>
        </ul>

        <div v-if="cleanable(p.agent).length && !p.linkTarget" class="mt-2">
          <p class="text-2xs text-ink-muted">{{ t('agentData.olderThan') }}</p>
          <SegmentedControl v-model="olderDays" :options="ageOptions" :label="t('agentData.olderThan')" fill class="mt-1 w-full" data-agentdata-age />
          <div class="mt-2 flex items-center gap-2">
            <p class="min-w-0 flex-1 text-2xs leading-relaxed text-ink-faint">
              {{ picked[p.agent].size ? t('agentData.cleanHint') : t('agentData.pickGroups') }}
              <template v-if="cleanable(p.agent).some((g) => g.idleOnly && picked[p.agent].has(g.id))"> {{ t('agentData.idleOnly', { agent: agentName(p.agent) }) }}</template>
            </p>
            <button type="button" class="ccm-btn shrink-0" :disabled="!!running || !picked[p.agent].size" data-agentdata-clean @click="clean(p.agent)">
              <Trash2 :size="13" aria-hidden="true" />{{ t('agentData.clean') }}
            </button>
          </div>
        </div>

        <div class="mt-2 border-t border-line pt-2">
          <template v-if="p.move?.phase === 'linked'">
            <p class="flex items-center gap-1.5 text-2xs text-ink" data-agentdata-moved>
              <Link2 :size="12" class="shrink-0 text-accent-ink" aria-hidden="true" />
              <span class="min-w-0 truncate" :title="p.move.target">{{ t('agentData.movedTo', { path: p.move.target }) }}</span>
            </p>
            <p class="mt-0.5 truncate text-2xs text-ink-faint" :title="p.move.backup">
              {{ p.move.originalDeleted ? t('agentData.originalDeleted') : t('agentData.original', { path: backupName(p) }) }}
            </p>
            <div class="mt-1.5 flex flex-wrap gap-2">
              <button type="button" class="ccm-btn" :disabled="!!running" data-agentdata-undo @click="act('undo', p.agent)">
                <Undo2 :size="13" aria-hidden="true" />{{ t('agentData.undo') }}
              </button>
              <button v-if="!p.move.originalDeleted" type="button" class="ccm-btn-danger" :disabled="!!running" data-agentdata-delete @click="act('delete', p.agent)">
                {{ t('agentData.deleteOriginal') }}
              </button>
            </div>
          </template>
          <template v-else-if="p.move?.phase === 'interrupted'">
            <p class="flex items-start gap-1.5 text-2xs text-warning" role="alert" data-agentdata-interrupted>
              <CircleAlert :size="13" class="mt-px shrink-0" aria-hidden="true" /><span class="min-w-0 break-all">{{ t('agentData.interrupted', { path: p.move.target }) }}</span>
            </p>
            <button type="button" class="ccm-btn mt-1.5" :disabled="!!running" data-agentdata-discard @click="act('discard', p.agent)">{{ t('agentData.discard') }}</button>
          </template>
          <p v-else-if="p.linkTarget" class="flex items-center gap-1.5 text-2xs text-ink-muted" data-agentdata-linked>
            <Link2 :size="12" class="shrink-0" aria-hidden="true" /><span class="min-w-0 truncate" :title="p.linkTarget">{{ t('agentData.linkedByHand', { path: p.linkTarget }) }}</span>
          </p>
          <div v-else-if="p.exists" class="flex items-center gap-2">
            <p class="min-w-0 flex-1 text-2xs leading-relaxed text-ink-faint">{{ t('agentData.moveHint', { agent: agentName(p.agent) }) }}</p>
            <button type="button" class="ccm-btn shrink-0" :disabled="!!running" data-agentdata-move @click="act('move', p.agent)">
              <HardDriveDownload :size="13" aria-hidden="true" />{{ t('agentData.move') }}
            </button>
          </div>
        </div>

        <details v-if="p.agent === 'claude' && p.exists" class="mt-2 border-t border-line pt-2" data-agentdata-strip>
          <summary class="cursor-pointer text-2xs font-medium text-ink-muted">{{ t('agentData.strip.title') }}</summary>
          <p class="mt-1 text-2xs leading-relaxed text-ink-faint">{{ t('agentData.strip.hint') }}</p>
          <p class="mt-2 text-2xs text-ink-muted">{{ t('agentData.strip.olderThan') }}</p>
          <SegmentedControl v-model="stripDays" :options="stripOptions" :label="t('agentData.strip.olderThan')" fill class="mt-1 w-full" data-agentdata-strip-age />
          <button type="button" class="ccm-btn mt-2" :disabled="!!running" data-agentdata-strip-run @click="strip">{{ t('agentData.strip.run') }}</button>
        </details>
      </div>

      <div v-if="hasBuildClean" class="flex min-w-0 items-center gap-2 px-3 py-2" data-agentdata-build>
        <div class="min-w-0 flex-1">
          <p class="text-sm text-ink">{{ t('buildClean.agentDataRow') }}</p>
          <p class="mt-0.5 text-2xs leading-relaxed text-ink-faint">{{ t('buildClean.agentDataHint') }}</p>
        </div>
        <button type="button" class="ccm-btn shrink-0" :disabled="!!running" data-agentdata-build-open @click="ui.buildClean = { dir: null }">{{ t('buildClean.open') }}</button>
      </div>

      <div v-if="state.claudeApp" class="flex min-w-0 items-baseline gap-2 px-3 py-2" data-agentdata-agent="claudeApp">
        <p class="text-sm text-ink">{{ t('agentData.agent.claudeApp') }}</p>
        <span class="shrink-0 text-2xs text-ink-faint">{{ t('agentData.viewOnly') }}</span>
        <p class="min-w-0 flex-1 truncate font-mono text-2xs text-ink-faint" :title="state.claudeApp">{{ state.claudeApp }}</p>
        <p class="shrink-0 text-2xs text-ink-muted tabular-nums">{{ appSize ? bytes(appSize.bytes) : t('agentData.notMeasured') }}</p>
      </div>
    </div>
  </section>
</template>
