<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleCheck, CircleHelp, CircleX, ClipboardCheck, FileSearch, FolderOpen, KeyRound, RefreshCw, Send, Stamp, TriangleAlert, X } from 'lucide-vue-next'
import type { ReleaseCheckResult, ReleaseFinding, ReleaseStatus, ReleaseVerifyResult } from '@ccm/shared'
import { baseName } from '../../lib/preview'
import { countStatus, findingKey, fixPrompt, groupFindings, releaseCheck, releaseMark, releaseRemember, releaseVerify, withCert } from '../../lib/releaseCheck'
import { handoffPaneFor } from '../../lib/runUi'
import { useUiStore } from '../../stores/ui'
import { useWorkspaceStore } from '../../stores/workspace'

const props = defineProps<{ root: string | null }>()
const emit = defineEmits<{ close: [] }>()
const { t, locale } = useI18n()
const workspace = useWorkspaceStore()
const ui = useUiStore()

const result = shallowRef<ReleaseCheckResult | null>(null)
const loading = ref(false)
const appDir = ref<string | null>(null)
const verify = shallowRef<ReleaseVerifyResult | null>(null)
const verifying = ref(false)
const busy = ref(false)
const notice = ref<{ text: string; warn: boolean } | null>(null)
const card = ref<HTMLElement | null>(null)
let gen = 0

const apps = computed(() => (result.value?.ok ? result.value.apps : []))
const app = computed(() => apps.value.find((a) => a.dir === appDir.value) ?? apps.value[0] ?? null)
const verifiedFor = ref<string | null>(null)
const verifyOk = computed(() => (verify.value?.ok && app.value && verifiedFor.value === app.value.dir ? verify.value : null))
const findings = computed(() => (app.value ? withCert(app.value, verifyOk.value?.finding ?? null) : []))
const groups = computed(() => groupFindings(findings.value))
const counts = computed(() => countStatus(findings.value))
const canRemember = computed(() => !!verifyOk.value && !verifyOk.value.debugKey && verifyOk.value.sha256 !== app.value?.cert?.sha256)

const STATUS_ICON = { ok: CircleCheck, warn: TriangleAlert, fail: CircleX, unknown: CircleHelp } as const
const STATUS_CLASS: Record<ReleaseStatus, string> = { ok: 'text-success', warn: 'text-warning', fail: 'text-st-error', unknown: 'text-ink-faint' }
const COUNT_ORDER: ReleaseStatus[] = ['fail', 'warn', 'unknown', 'ok']

const describe = (f: ReleaseFinding): string => t(`releaseCheck.rule.${f.rule}.${f.detail}`, f.params ?? {})
const relOf = (file: string): string => {
  const a = file.replace(/\\/g, '/')
  const b = (result.value?.ok ? result.value.root : (props.root ?? '')).replace(/\\/g, '/').replace(/\/$/, '')
  return b && a.toLowerCase().startsWith(`${b.toLowerCase()}/`) ? a.slice(b.length + 1) : baseName(file)
}
const canOpen = (f: ReleaseFinding): boolean => !!f.file && f.line !== null && !/\.(apk|aab)$/i.test(f.file)

async function run(): Promise<void> {
  if (!props.root) {
    result.value = { ok: false, error: 'no-app' }
    return
  }
  const my = ++gen
  loading.value = true
  const res = await releaseCheck(props.root)
  if (my !== gen) return
  result.value = res
  loading.value = false
  if (res.ok && !res.apps.some((a) => a.dir === appDir.value)) appDir.value = res.apps[0]?.dir ?? null
}

function rerun(): void {
  notice.value = null
  void run()
}

onMounted(async () => {
  await nextTick()
  card.value?.focus()
  await run()
})

async function mark(): Promise<void> {
  const a = app.value
  if (!a || !props.root || busy.value) return
  busy.value = true
  const res = await releaseMark(props.root, a.dir)
  busy.value = false
  if (res.ok) {
    result.value = res
    notice.value = { text: t('releaseCheck.marked', { code: a.version.code ?? '?' }), warn: false }
  } else notice.value = { text: t(`releaseCheck.error.${res.error}`), warn: true }
}

async function runVerify(pick: boolean): Promise<void> {
  const a = app.value
  if (!a || !props.root || verifying.value) return
  verifying.value = true
  notice.value = null
  const res = await releaseVerify(props.root, a.dir, pick)
  verifying.value = false
  if (res.ok) {
    verify.value = res
    verifiedFor.value = a.dir
    notice.value = { text: t('releaseCheck.verified', { file: baseName(res.file), sha: res.sha256 }), warn: false }
  } else notice.value = { text: t(`releaseCheck.verifyError.${res.error}`), warn: true }
}

async function remember(): Promise<void> {
  const a = app.value
  if (!a || !props.root || busy.value) return
  busy.value = true
  const res = await releaseRemember(props.root, a.dir)
  busy.value = false
  if (res.ok) {
    result.value = res
    verify.value = null
    notice.value = { text: t('releaseCheck.remembered'), warn: false }
  } else notice.value = { text: t(`releaseCheck.error.${res.error}`), warn: true }
}

function openFinding(f: ReleaseFinding): void {
  if (!canOpen(f)) return
  emit('close')
  workspace.openFile(f.file!, f.line!, { cwd: props.root ?? undefined })
}

function fill(): void {
  const a = app.value
  if (!a || !props.root) return
  const text = fixPrompt(a, findings.value, props.root, describe)
  if (!text) {
    notice.value = { text: t('releaseCheck.nothingToFix'), warn: false }
    return
  }
  const pane = handoffPaneFor(workspace.panes, props.root)
  if (!pane) {
    notice.value = { text: t('releaseCheck.noAgent'), warn: true }
    return
  }
  workspace.insertInto(pane.key, text)
  if (ui.view !== 'workspace') ui.setView('workspace')
  notice.value = { text: t('releaseCheck.filled', { name: pane.title ?? baseName(pane.cwd ?? '') }), warn: false }
}

const releasedText = computed(() => {
  const r = app.value?.released
  if (!r) return t('releaseCheck.notReleased')
  return t('releaseCheck.released', { code: r.code ?? '?', name: r.name ?? '?', date: new Date(r.at).toLocaleDateString(locale.value) })
})

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
    <div class="fixed inset-0 z-50 grid place-items-center ccm-scrim p-4" data-release-layer @pointerdown.self="emit('close')" @keydown="onKey">
      <div
        ref="card"
        tabindex="-1"
        class="ccm-sheet flex h-[min(84vh,760px)] w-[min(94vw,880px)] flex-col overflow-hidden outline-none"
        role="dialog"
        aria-modal="true"
        :aria-label="t('releaseCheck.title')"
        data-release-check
      >
        <header class="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-3">
          <ClipboardCheck :size="14" class="shrink-0 text-ink-muted" aria-hidden="true" />
          <h2 class="min-w-0 shrink truncate text-sm font-semibold text-ink" :title="app?.dir ?? root ?? undefined">
            {{ app ? t('releaseCheck.titleOf', { name: app.name }) : t('releaseCheck.title') }}
          </h2>
          <div v-if="app" class="flex shrink-0 items-center gap-2 text-2xs tabular" data-release-summary>
            <template v-for="s in COUNT_ORDER" :key="s">
              <span v-if="counts[s]" class="inline-flex items-center gap-1" :class="STATUS_CLASS[s]" :data-release-count="s">
                <component :is="STATUS_ICON[s]" :size="12" aria-hidden="true" />{{ t(`releaseCheck.count.${s}`, { n: counts[s] }) }}
              </span>
            </template>
          </div>
          <span class="flex-1" />
          <select
            v-if="apps.length > 1"
            v-model="appDir"
            class="ccm-field h-7 max-w-48 min-w-0 shrink cursor-pointer text-xs"
            :aria-label="t('releaseCheck.app')"
            :title="t('releaseCheck.app')"
            data-release-app
          >
            <option v-for="a in apps" :key="a.dir" :value="a.dir">{{ a.name }}</option>
          </select>
          <button v-if="app" type="button" class="ccm-btn shrink-0" :title="t('releaseCheck.fillHint')" :disabled="!counts.fail && !counts.warn" data-release-fill @click="fill">
            <Send :size="13" aria-hidden="true" />{{ t('releaseCheck.fill') }}
          </button>
          <button type="button" class="ccm-btn-plain shrink-0" :title="t('releaseCheck.rerun')" :aria-label="t('releaseCheck.rerun')" :disabled="loading" data-release-rerun @click="rerun">
            <RefreshCw :size="14" :class="loading ? 'ccm-spin' : ''" aria-hidden="true" />
          </button>
          <button type="button" class="ccm-btn-plain shrink-0" :title="t('releaseCheck.close')" :aria-label="t('releaseCheck.close')" @click="emit('close')">
            <X :size="14" aria-hidden="true" />
          </button>
        </header>

        <div v-if="app" class="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-raised px-3 py-1.5 text-2xs">
          <span class="min-w-0 flex-1 truncate text-ink-muted" :title="releasedText" data-release-released>{{ releasedText }}</span>
          <button
            type="button"
            class="ccm-btn shrink-0"
            :title="t('releaseCheck.markHint', { code: app.version.code ?? '?' })"
            :disabled="busy || app.version.code === null"
            data-release-mark
            @click="mark"
          >
            <Stamp :size="13" aria-hidden="true" />{{ t('releaseCheck.mark') }}
          </button>
          <button type="button" class="ccm-btn shrink-0" :title="t('releaseCheck.verifyHint')" :disabled="verifying" data-release-verify @click="runVerify(false)">
            <FileSearch :size="13" aria-hidden="true" />{{ t('releaseCheck.verify') }}
          </button>
          <button type="button" class="ccm-btn-plain shrink-0" :title="t('releaseCheck.chooseHint')" :disabled="verifying" data-release-choose @click="runVerify(true)">
            <FolderOpen :size="13" aria-hidden="true" />{{ t('releaseCheck.choose') }}
          </button>
          <button v-if="canRemember" type="button" class="ccm-btn shrink-0" :title="t('releaseCheck.rememberHint')" :disabled="busy" data-release-remember @click="remember">
            <KeyRound :size="13" aria-hidden="true" />{{ t('releaseCheck.remember') }}
          </button>
        </div>

        <div v-if="!result || (loading && !app)" class="grid flex-1 place-items-center text-xs text-ink-muted" role="status">{{ t('releaseCheck.reading') }}</div>
        <p v-else-if="!result.ok" class="p-4 text-xs text-warning" role="status" :data-release-error="result.error">{{ t(`releaseCheck.error.${result.error}`) }}</p>
        <div v-else class="ccm-scroll min-h-0 flex-1 overflow-auto overscroll-contain" :class="loading ? 'opacity-60' : ''">
          <section v-for="g in groups" :key="g.section" class="border-b border-line last:border-b-0" :data-release-section="g.section">
            <h3 class="sticky top-0 z-10 flex items-center gap-1.5 bg-surface px-3 pt-2.5 pb-1 text-2xs font-semibold text-ink-muted">
              <component :is="STATUS_ICON[g.worst]" :size="12" :class="STATUS_CLASS[g.worst]" aria-hidden="true" />{{ t(`releaseCheck.section.${g.section}`) }}
            </h3>
            <ul class="pb-1.5">
              <li
                v-for="f in g.findings"
                :key="findingKey(f)"
                class="grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline gap-x-2 px-3 py-1 text-xs hover:bg-fill"
                :data-release-rule="f.rule"
                :data-release-status="f.status"
                :data-release-detail="f.detail"
              >
                <span class="inline-flex items-center gap-1 whitespace-nowrap" :class="STATUS_CLASS[f.status]">
                  <component :is="STATUS_ICON[f.status]" :size="12" class="shrink-0 self-center" aria-hidden="true" />{{ t(`releaseCheck.status.${f.status}`) }}
                </span>
                <div class="min-w-0">
                  <p class="text-ink">
                    <span class="font-medium">{{ t(`releaseCheck.rule.${f.rule}.title`) }}</span>
                    <span class="text-ink-muted"> · {{ describe(f) }}</span>
                  </p>
                  <button
                    v-if="canOpen(f)"
                    type="button"
                    class="block max-w-full cursor-pointer truncate font-mono text-2xs text-link hover:underline"
                    :title="t('releaseCheck.openAt', { file: f.file, line: f.line })"
                    data-release-open
                    @click="openFinding(f)"
                  >
                    {{ relOf(f.file!) }}:{{ f.line }}
                  </button>
                  <span v-else-if="f.file" class="block truncate font-mono text-2xs text-ink-faint" :title="f.file">{{ relOf(f.file) }}</span>
                </div>
              </li>
            </ul>
          </section>
        </div>

        <footer class="flex h-9 shrink-0 items-center gap-2 border-t border-line px-3 text-2xs">
          <span v-if="verifying" class="min-w-0 flex-1 truncate text-ink-muted" role="status">{{ t('releaseCheck.verifying') }}</span>
          <span v-else-if="notice" class="min-w-0 flex-1 truncate" :class="notice.warn ? 'text-warning' : 'text-ink-muted'" :title="notice.text" role="status" data-release-notice>{{ notice.text }}</span>
          <span v-else class="min-w-0 flex-1 truncate text-ink-faint">{{ t('releaseCheck.note') }}</span>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
