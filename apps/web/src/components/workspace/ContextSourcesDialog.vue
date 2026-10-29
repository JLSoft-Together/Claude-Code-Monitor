<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { Layers, RefreshCw, X } from 'lucide-vue-next'
import type { CtxSource, CtxSources } from '@ccm/shared'
import { ctxSources, displayPath, groupSources, kb, startBytes } from '../../lib/ctxSources'
import { fullNumber } from '../../lib/format'
import { baseName } from '../../lib/preview'
import { useAgentsStore } from '../../stores/agents'
import { useWorkspaceStore } from '../../stores/workspace'

const props = defineProps<{ cwd: string | null; terminalId: string | null }>()
const emit = defineEmits<{ close: [] }>()
const { t, locale } = useI18n()
const agents = useAgentsStore()
const workspace = useWorkspaceStore()

const report = shallowRef<CtxSources | null>(null)
const loading = ref(false)
const card = ref<HTMLElement | null>(null)

async function load(): Promise<void> {
  if (!props.cwd) return
  loading.value = true
  report.value = await ctxSources(props.cwd).catch(() => ({ ok: false, error: 'unavailable' }) as const)
  loading.value = false
}

onMounted(async () => {
  await load()
  await nextTick()
  card.value?.focus()
})

const ok = computed(() => (report.value?.ok ? report.value : null))
const groups = computed(() => groupSources(ok.value?.files ?? []))
const total = computed(() => startBytes(ok.value?.files ?? []))
const agent = computed(() => (props.terminalId ? agents.mainOf(props.terminalId) : undefined))
const num = (n: number): string => fullNumber(n, locale.value)

const shown = (f: CtxSource): string => (ok.value ? displayPath(f.path, ok.value.cwd, ok.value.home) : f.path)

function openFile(f: CtxSource): void {
  emit('close')
  workspace.openFile(f.path, undefined, { cwd: props.cwd ?? undefined })
}

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
    <div class="fixed inset-0 z-50 grid place-items-center ccm-scrim p-4" data-ctx-layer @pointerdown.self="emit('close')" @keydown="onKey">
      <div
        ref="card"
        tabindex="-1"
        class="ccm-sheet flex h-[min(84vh,720px)] w-[min(94vw,760px)] flex-col overflow-hidden outline-none"
        role="dialog"
        aria-modal="true"
        :aria-label="t('ctxSources.title')"
        data-ctx-sources
      >
        <header class="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-3">
          <Layers :size="14" class="shrink-0 text-ink-muted" aria-hidden="true" />
          <h2 class="min-w-0 flex-1 truncate text-sm font-semibold text-ink" :title="cwd ?? undefined">
            {{ cwd ? t('ctxSources.titleOf', { name: baseName(cwd) }) : t('ctxSources.title') }}
          </h2>
          <button v-if="cwd" type="button" class="ccm-btn-plain shrink-0" :title="t('ctxSources.refresh')" :aria-label="t('ctxSources.refresh')" :disabled="loading" @click="load()">
            <RefreshCw :size="14" :class="loading ? 'ccm-spin' : ''" aria-hidden="true" />
          </button>
          <button type="button" class="ccm-btn-plain shrink-0" :title="t('ctxSources.close')" :aria-label="t('ctxSources.close')" @click="emit('close')">
            <X :size="14" aria-hidden="true" />
          </button>
        </header>

        <p v-if="!cwd" class="p-4 text-xs text-ink-muted">{{ t('ctxSources.noFolder') }}</p>
        <div v-else class="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-xs">
          <section :aria-label="t('ctxSources.measured')" data-ctx-measured>
            <h3 class="text-2xs font-semibold text-ink-muted">{{ t('ctxSources.measured') }}</h3>
            <dl v-if="agent?.firstContextTokens !== undefined || agent?.contextTokens !== undefined" class="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              <template v-if="agent?.firstContextTokens !== undefined">
                <dt class="text-ink-muted">{{ t('ctxSources.first') }}</dt>
                <dd class="tabular font-semibold text-ink" :title="t('ctxSources.firstHint')" data-ctx-first>{{ t('ctxSources.tokens', { n: num(agent.firstContextTokens) }) }}</dd>
              </template>
              <template v-if="agent?.contextTokens !== undefined">
                <dt class="text-ink-muted">{{ t('ctxSources.now') }}</dt>
                <dd class="tabular text-ink">
                  {{ agent.contextWindow ? t('ctxSources.ofWindow', { n: num(agent.contextTokens), window: num(agent.contextWindow) }) : t('ctxSources.tokens', { n: num(agent.contextTokens) }) }}
                </dd>
              </template>
            </dl>
            <p v-else class="mt-1 text-2xs text-ink-faint">{{ t('ctxSources.noUsage') }}</p>
            <p v-if="agent?.firstContextTokens !== undefined" class="mt-0.5 text-2xs text-ink-faint">{{ t('ctxSources.firstHint') }}</p>
          </section>

          <section class="mt-3" :aria-label="t('ctxSources.files')">
            <div class="flex items-baseline gap-2">
              <h3 class="text-2xs font-semibold text-ink-muted">{{ t('ctxSources.files') }}</h3>
              <span v-if="ok" class="text-2xs tabular text-ink" data-ctx-total>{{ t('ctxSources.startTotal', { kb: kb(total) }) }}</span>
            </div>
            <p class="text-2xs text-ink-faint">{{ t('ctxSources.kbNote') }}</p>
            <div v-if="!report" class="py-4 text-center text-ink-muted" role="status">{{ t('ctxSources.loading') }}</div>
            <p v-else-if="!ok" class="py-2 text-warning" role="status">{{ t(`ctxSources.error.${report.ok ? 'unavailable' : report.error}`) }}</p>
            <p v-else-if="!groups.length" class="py-2 text-ink-muted">{{ t('ctxSources.none') }}</p>
            <div v-for="g in groups" :key="g.id" class="mt-2" :data-ctx-group="g.id">
              <p class="flex items-baseline gap-2 text-2xs font-semibold text-ink">
                {{ t(`ctxSources.group.${g.id}`) }}
                <span v-if="g.startBytes" class="font-normal tabular text-ink-faint">{{ t('ctxSources.kb', { kb: kb(g.startBytes) }) }}</span>
              </p>
              <ul class="mt-0.5 divide-y divide-line rounded-inner border border-line">
                <li v-for="f in g.files" :key="f.path" class="flex min-w-0 items-center gap-2 px-2 py-1" data-ctx-file>
                  <span class="shrink-0 rounded-full bg-fill px-1.5 text-2xs text-ink-muted">{{ t(`ctxSources.kind.${f.kind}`) }}</span>
                  <button
                    type="button"
                    class="min-w-0 flex-1 cursor-pointer truncate text-left font-mono text-2xs text-link hover:underline"
                    :title="f.from ? `${f.path}\n${t('ctxSources.importedBy', { file: f.from })}` : t('ctxSources.openFile', { file: f.path })"
                    @click="openFile(f)"
                  >
                    {{ shown(f) }}
                  </button>
                  <span class="hidden shrink-0 text-2xs text-ink-faint sm:inline">{{ t(`ctxSources.load.${f.load}`) }}</span>
                  <span v-if="f.lines !== undefined" class="hidden w-16 shrink-0 text-right text-2xs tabular text-ink-faint sm:inline">{{ t('ctxSources.lines', { n: f.lines }, f.lines) }}</span>
                  <span class="w-14 shrink-0 text-right text-2xs tabular" :class="f.load === 'start' ? 'text-ink' : 'text-ink-faint'">{{ t('ctxSources.kb', { kb: kb(f.bytes) }) }}</span>
                </li>
              </ul>
            </div>
            <p v-if="ok?.truncated" class="mt-1 text-2xs text-warning">{{ t('ctxSources.truncated') }}</p>
          </section>

          <section v-if="ok && (ok.mcp.length || ok.plugins.length)" class="mt-3">
            <template v-if="ok.mcp.length">
              <h3 class="text-2xs font-semibold text-ink-muted">{{ t('ctxSources.mcp') }}</h3>
              <p class="text-2xs text-ink-faint">{{ t('ctxSources.mcpHint') }}</p>
              <ul class="mt-0.5 flex flex-wrap gap-1" data-ctx-mcp>
                <li v-for="m in ok.mcp" :key="m.name" class="rounded-full bg-fill px-2 py-0.5 font-mono text-2xs text-ink" :title="m.scopes.join(', ')">{{ m.name }}</li>
              </ul>
            </template>
            <template v-if="ok.plugins.length">
              <h3 class="mt-2 text-2xs font-semibold text-ink-muted">{{ t('ctxSources.plugins') }}</h3>
              <ul class="mt-0.5 flex flex-wrap gap-1" data-ctx-plugins>
                <li v-for="p in ok.plugins" :key="p" class="rounded-full bg-fill px-2 py-0.5 font-mono text-2xs text-ink">{{ p }}</li>
              </ul>
            </template>
          </section>
        </div>
      </div>
    </div>
  </Teleport>
</template>
