<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { Ban, CircleCheck, CircleSlash, RefreshCw, ShieldCheck, ShieldX, TriangleAlert, X } from 'lucide-vue-next'
import { PERM_ASK_DAYS, type PermRead } from '@ccm/shared'
import { adviseRules, deniedTools, editedRule, permAllow, permRead, tickable, type PermAdvice } from '../../lib/permAdvisor'
import { baseName } from '../../lib/preview'
import { inRoot } from '../../lib/runUi'
import { useTerminalsStore } from '../../stores/terminals'

const props = defineProps<{ root: string | null }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const terminals = useTerminalsStore()

const report = shallowRef<PermRead | null>(null)
const loading = ref(false)
const writing = ref(false)
const notice = ref<{ text: string; bad: boolean } | null>(null)
const ticked = ref(new Set<string>())
const edits = ref<Record<string, string>>({})
const card = ref<HTMLElement | null>(null)

async function load(): Promise<void> {
  if (!props.root) return
  loading.value = true
  report.value = await permRead(props.root).catch(() => ({ ok: false, error: 'unavailable' }) as const)
  loading.value = false
  ticked.value = new Set([...ticked.value].filter((k) => rows.value.some((r) => r.key === k && tickable(r))))
}

onMounted(async () => {
  await load()
  await nextTick()
  card.value?.focus()
})

const ok = computed(() => (report.value?.ok ? report.value : null))
const rows = computed<PermAdvice[]>(() => (ok.value ? adviseRules(ok.value.asks, ok.value.shared, ok.value.local) : []))
const denied = computed(() => (props.root ? deniedTools(terminals.list, (cwd) => inRoot(cwd, props.root!)) : { total: 0, tools: [] }))

const ruleText = (r: PermAdvice): string => edits.value[r.key] ?? r.rule ?? ''
const checkOf = (r: PermAdvice) => editedRule(ruleText(r))
function ruleError(r: PermAdvice): 'invalid' | 'risky' | null {
  const c = checkOf(r)
  return 'error' in c ? c.error : null
}

function toggle(r: PermAdvice): void {
  const next = new Set(ticked.value)
  if (!next.delete(r.key)) next.add(r.key)
  ticked.value = next
}

const picked = computed(() => rows.value.filter((r) => tickable(r) && ticked.value.has(r.key)))
const pickedRules = computed(() => {
  const out: string[] = []
  for (const r of picked.value) {
    const c = checkOf(r)
    if ('error' in c) return null
    if (!out.includes(c.rule)) out.push(c.rule)
  }
  return out
})

async function add(): Promise<void> {
  const rules = pickedRules.value
  if (!props.root || !rules?.length || writing.value) return
  writing.value = true
  notice.value = null
  const res = await permAllow(props.root, rules).catch(() => ({ ok: false, error: 'failed' }) as const)
  writing.value = false
  if (res.ok) {
    notice.value = { text: res.added.length ? t('permAdvisor.added', { n: res.added.length }, res.added.length) : t('permAdvisor.nothingAdded'), bad: false }
    ticked.value = new Set()
    edits.value = {}
    await load()
  } else if (res.error !== 'cancelled') notice.value = { text: t(`permAdvisor.error.${res.error}`), bad: true }
}

const time = (iso: string): string => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

const STATE_ICON = { shared: CircleCheck, local: CircleCheck, denied: Ban } as const

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && !e.defaultPrevented) {
    e.preventDefault()
    e.stopPropagation()
    emit('close')
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 grid place-items-center ccm-scrim p-4" data-perm-layer @pointerdown.self="emit('close')" @keydown="onKey">
      <div
        ref="card"
        tabindex="-1"
        class="ccm-sheet flex h-[min(84vh,720px)] w-[min(94vw,820px)] flex-col overflow-hidden outline-none"
        role="dialog"
        aria-modal="true"
        :aria-label="t('permAdvisor.title')"
        data-perm-advisor
      >
        <header class="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-3">
          <ShieldCheck :size="14" class="shrink-0 text-ink-muted" aria-hidden="true" />
          <h2 class="min-w-0 flex-1 truncate text-sm font-semibold text-ink" :title="root ?? undefined">
            {{ root ? t('permAdvisor.titleOf', { name: baseName(root) }) : t('permAdvisor.title') }}
          </h2>
          <button v-if="root" type="button" class="ccm-btn-plain shrink-0" :title="t('permAdvisor.refresh')" :aria-label="t('permAdvisor.refresh')" :disabled="loading" @click="load()">
            <RefreshCw :size="14" :class="loading ? 'ccm-spin' : ''" aria-hidden="true" />
          </button>
          <button type="button" class="ccm-btn-plain shrink-0" :title="t('permAdvisor.close')" :aria-label="t('permAdvisor.close')" @click="emit('close')">
            <X :size="14" aria-hidden="true" />
          </button>
        </header>

        <p v-if="!root" class="p-4 text-xs text-ink-muted">{{ t('permAdvisor.noProject') }}</p>
        <div v-else-if="!report" class="grid flex-1 place-items-center text-xs text-ink-muted" role="status">{{ t('permAdvisor.loading') }}</div>
        <p v-else-if="!ok" class="p-4 text-xs text-warning" role="status">{{ t(`permAdvisor.error.${report.ok ? 'failed' : report.error}`) }}</p>
        <div v-else class="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-xs">
          <p class="text-2xs text-ink-faint">{{ t('permAdvisor.scope', { days: PERM_ASK_DAYS }) }}</p>

          <section class="mt-2" :aria-label="t('permAdvisor.prompts')">
            <h3 class="text-2xs font-semibold text-ink-muted">{{ t('permAdvisor.prompts') }}</h3>
            <div v-if="!rows.length" class="mt-1 rounded-inner bg-fill px-3 py-2" data-perm-empty>
              <p class="text-ink">{{ t('permAdvisor.empty', { days: PERM_ASK_DAYS }) }}</p>
              <p class="mt-0.5 text-2xs text-ink-muted">{{ t('permAdvisor.emptyHint') }}</p>
            </div>
            <ul v-else class="mt-1 divide-y divide-line rounded-inner border border-line">
              <li v-for="r in rows" :key="r.key" class="flex min-w-0 items-center gap-2 px-2 py-1.5" data-perm-row>
                <input
                  v-if="tickable(r)"
                  type="checkbox"
                  class="shrink-0 cursor-pointer accent-(--ccm-accent)"
                  :checked="ticked.has(r.key)"
                  :aria-label="t('permAdvisor.pick', { rule: ruleText(r) })"
                  data-perm-tick
                  @change="toggle(r)"
                />
                <span v-else class="inline-block w-[13px] shrink-0" aria-hidden="true" />
                <div class="min-w-0 flex-1">
                  <input
                    v-if="tickable(r)"
                    class="ccm-field h-6 w-full min-w-0 font-mono text-2xs"
                    :value="ruleText(r)"
                    :aria-label="t('permAdvisor.editLabel', { tool: r.tool })"
                    :aria-invalid="!!ruleError(r)"
                    spellcheck="false"
                    data-perm-rule
                    @input="edits = { ...edits, [r.key]: ($event.target as HTMLInputElement).value }"
                  />
                  <span v-else class="block truncate font-mono text-2xs text-ink" :title="r.rule ?? r.tool">{{ r.rule ?? r.tool }}</span>
                  <p v-if="tickable(r) && ruleError(r)" class="mt-0.5 flex items-center gap-1 text-2xs text-warning" role="status">
                    <TriangleAlert :size="11" aria-hidden="true" />{{ ruleError(r) === 'risky' ? t('permAdvisor.riskyEdit') : t('permAdvisor.invalid') }}
                  </p>
                  <p v-else-if="r.covered" class="mt-0.5 flex items-center gap-1 text-2xs" :class="r.covered === 'denied' ? 'text-st-error' : 'text-success'">
                    <component :is="STATE_ICON[r.covered]" :size="11" aria-hidden="true" />{{ t(`permAdvisor.state.${r.covered}`) }}
                  </p>
                  <p v-else-if="r.risky" class="mt-0.5 flex items-center gap-1 text-2xs text-warning">
                    <TriangleAlert :size="11" aria-hidden="true" />{{ t('permAdvisor.state.risky') }}
                  </p>
                  <p v-else-if="!r.rule" class="mt-0.5 flex items-center gap-1 text-2xs text-ink-faint">
                    <CircleSlash :size="11" aria-hidden="true" />{{ t('permAdvisor.state.noRule') }}
                  </p>
                </div>
                <span class="shrink-0 tabular font-semibold text-ink">{{ t('permAdvisor.count', { n: r.count }) }}</span>
                <span class="hidden w-28 shrink-0 truncate text-right text-2xs text-ink-faint sm:inline">{{ t('permAdvisor.last', { time: time(r.lastAt) }) }}</span>
              </li>
            </ul>
          </section>

          <section class="mt-3" :aria-label="t('permAdvisor.denied')">
            <h3 class="flex items-center gap-1 text-2xs font-semibold text-ink-muted"><ShieldX :size="12" aria-hidden="true" />{{ t('permAdvisor.denied') }}</h3>
            <p class="text-2xs text-ink-faint">{{ t('permAdvisor.deniedHint') }}</p>
            <p v-if="!denied.tools.length" class="mt-0.5 text-2xs text-ink-muted">{{ t('permAdvisor.deniedNone') }}</p>
            <ul v-else class="mt-0.5 flex flex-wrap gap-1" data-perm-denied>
              <li v-for="d in denied.tools" :key="d.tool" class="rounded-full bg-fill px-2 py-0.5 font-mono text-2xs text-ink">{{ t('permAdvisor.deniedRow', { tool: d.tool, n: d.sessions }, d.sessions) }}</li>
            </ul>
          </section>

          <section class="mt-3" :aria-label="t('permAdvisor.rules')">
            <h3 class="text-2xs font-semibold text-ink-muted">{{ t('permAdvisor.rules') }}</h3>
            <div v-for="f in (['shared', 'local'] as const)" :key="f" class="mt-1" :data-perm-file="f">
              <p class="text-2xs text-ink">
                {{ t(`permAdvisor.file.${f}`) }}
                <span v-if="ok[f].state !== 'ok'" class="text-ink-faint">· {{ t(`permAdvisor.fileState.${ok[f].state}`) }}</span>
              </p>
              <template v-if="ok[f].state === 'ok'">
                <p v-if="!ok[f].allow.length && !ok[f].deny.length" class="text-2xs text-ink-faint">{{ t('permAdvisor.noRules') }}</p>
                <p v-for="kind in (['allow', 'deny'] as const)" v-show="ok[f][kind].length" :key="kind" class="break-all font-mono text-2xs leading-relaxed text-ink-muted">
                  <span :class="kind === 'allow' ? 'text-success' : 'text-st-error'">{{ t(`permAdvisor.${kind}`) }}:</span> {{ ok[f][kind].join(', ') }}
                </p>
              </template>
            </div>
          </section>
        </div>

        <footer v-if="ok" class="flex min-h-10 shrink-0 items-center gap-2 border-t border-line px-3 py-1.5 text-2xs">
          <span v-if="notice" class="min-w-0 flex-1 text-ink-muted" :class="notice.bad ? 'text-warning' : 'text-ink-muted'" role="status" data-perm-notice>{{ notice.text }}</span>
          <span v-else class="min-w-0 flex-1 text-ink-faint">{{ t('permAdvisor.addHint') }}</span>
          <button type="button" class="ccm-btn-primary shrink-0" :disabled="!pickedRules?.length || writing" data-perm-add @click="add">
            {{ t('permAdvisor.add', { n: pickedRules?.length ?? 0 }, pickedRules?.length ?? 0) }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
