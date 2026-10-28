<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDownToLine, LoaderCircle, Send, X } from 'lucide-vue-next'
import { dirOfRel } from '../../lib/changesView'
import { grammarFor } from '../../lib/codeView'
import { parseUnifiedDiff, type DiffFile } from '../../lib/diff'
import { viewBlocks } from '../../lib/diffBlocks'
import { readDiffOpts } from '../../lib/diffOpts'
import { baseName, wtDiff, wtFileDiff, wtTake, type WtBetweenFile } from '../../lib/preview'
import { dirKey } from '../../stores/favorites'
import { isTerm, presetOf, useWorkspaceStore, workCwd, type Pane } from '../../stores/workspace'
import DiffView from './DiffView.vue'

/** `a` / `b`: branches with their worktree folders; `here`: the checkout a taken file lands in. */
const props = defineProps<{ cwd: string; a: { branch: string; path: string }; b: { branch: string; path: string }; here?: string }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const workspace = useWorkspaceStore()

const opts = readDiffOpts()
const card = ref<HTMLElement | null>(null)
const files = shallowRef<WtBetweenFile[]>([])
const truncated = ref(false)
const loading = ref(true)
const selected = ref<string | null>(null)
const diffFile = shallowRef<DiffFile | null>(null)
const diffState = ref<'idle' | 'loading' | 'large' | 'binary' | 'empty' | 'error'>('idle')
const current = ref(0)
const busy = ref(false)
const notice = ref<{ ok: boolean; text: string } | null>(null)
const promptText = ref('')

const blocks = computed(() => (diffFile.value ? viewBlocks(diffFile.value, opts.highlight) : []))
const lang = computed(() => (selected.value ? grammarFor(undefined, selected.value) : null))
const within = (dir: string | undefined, root: string): boolean => !!dir && (dirKey(dir) === dirKey(root) || dirKey(dir).startsWith(`${dirKey(root)}\\`))
const hereKey = computed(() => (props.here ? dirKey(props.here) : null))
/** The other side's branch: the file comes from there into `here`. */
const takeFrom = computed(() => (hereKey.value === dirKey(props.b.path) ? props.a : props.b))
const canTake = computed(() => !!props.here && (hereKey.value === dirKey(props.a.path) || hereKey.value === dirKey(props.b.path)))

const errorText = (error: string, detail?: string) => t(`workspace.wt.compare.error.${error}`, { detail: detail ?? '' })

function agentIn(path: string): Pane | null {
  const live = workspace.panes.filter((p) => isTerm(p) && presetOf(p) !== 'shell' && (p.state === 'running' || p.state === 'starting') && within(workCwd(p), path))
  return live.sort((x, y) => (y.focusedAt ?? 0) - (x.focusedAt ?? 0))[0] ?? null
}
const agentA = computed(() => agentIn(props.a.path))
const agentB = computed(() => agentIn(props.b.path))
const sendBlocked = computed(() => (!agentA.value || !agentB.value ? t('workspace.wt.compare.noAgents') : null))

async function load(): Promise<void> {
  const res = await wtDiff(props.cwd, props.a.branch, props.b.branch)
  loading.value = false
  if (!res.ok) return void (notice.value = { ok: false, text: errorText(res.error, res.detail) })
  files.value = res.files
  truncated.value = res.truncated
  if (res.files[0]) await pick(res.files[0].path)
}

async function pick(path: string): Promise<void> {
  selected.value = path
  current.value = 0
  diffFile.value = null
  diffState.value = 'loading'
  const res = await wtFileDiff(props.cwd, props.a.branch, props.b.branch, path)
  if (selected.value !== path) return
  if (!res.ok) {
    diffState.value = 'error'
    notice.value = { ok: false, text: errorText(res.error, res.detail) }
    return
  }
  if (res.tooLarge) return void (diffState.value = 'large')
  const parsed = parseUnifiedDiff(res.text)[0] ?? null
  if (!parsed) return void (diffState.value = /^Binary files /m.test(res.text) ? 'binary' : 'empty')
  diffFile.value = parsed
  diffState.value = 'idle'
}

async function take(): Promise<void> {
  const path = selected.value
  if (!path || !props.here || busy.value) return
  busy.value = true
  const res = await wtTake(props.here, takeFrom.value.branch, path)
  busy.value = false
  if (res.ok) notice.value = { ok: true, text: t('workspace.wt.compare.taken', { name: baseName(path), branch: takeFrom.value.branch }) }
  else if (res.error !== 'cancelled') notice.value = { ok: false, text: errorText(res.error, res.detail) }
}

async function sendBoth(): Promise<void> {
  const text = promptText.value.trim()
  const [pa, pb] = [agentA.value, agentB.value]
  if (!text || !pa || !pb) return
  workspace.insertInto(pb.key, text)
  // insertRequest holds one request: let the first pane take it before the next replaces it.
  await nextTick()
  workspace.insertInto(pa.key, text)
  promptText.value = ''
  notice.value = { ok: true, text: t('workspace.wt.compare.sent') }
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    emit('close')
  }
}

const STATUS_CLASS = { A: 'text-diff-add', D: 'text-diff-del', M: 'text-diff-mod', T: 'text-diff-mod' } as const

onMounted(async () => {
  await nextTick()
  card.value?.focus()
  await load()
})
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 grid place-items-center ccm-scrim p-4" data-wt-compare-layer @pointerdown.self="emit('close')" @keydown="onKey">
      <div
        ref="card"
        tabindex="-1"
        class="ccm-sheet flex h-[min(86vh,900px)] w-[min(94vw,1280px)] flex-col overflow-hidden outline-none"
        role="dialog"
        aria-modal="true"
        :aria-label="t('workspace.wt.compare.title', { a: a.branch, b: b.branch })"
        data-wt-compare
      >
        <header class="flex h-10 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-3">
          <span class="min-w-0 flex-1 truncate text-xs font-medium text-ink">{{ t('workspace.wt.compare.title', { a: a.branch, b: b.branch }) }}</span>
          <LoaderCircle v-if="loading || busy" :size="13" class="ccm-spin shrink-0 text-ink-faint" aria-hidden="true" />
          <span class="shrink-0 text-2xs text-ink-faint tabular">{{ t('workspace.wt.compare.files', { n: files.length }, files.length) }}</span>
          <button type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.wt.compare.close')" :aria-label="t('workspace.wt.compare.close')" @click="emit('close')">
            <X :size="14" aria-hidden="true" />
          </button>
        </header>
        <div class="flex min-h-0 flex-1 flex-col md:flex-row">
          <ul class="ccm-scroll max-h-[35%] shrink-0 overflow-y-auto border-b border-line py-1 md:max-h-none md:w-64 md:border-r md:border-b-0" :aria-label="t('workspace.wt.compare.fileList')">
            <li v-for="f in files" :key="f.path">
              <button
                type="button"
                class="flex h-[26px] w-full min-w-0 cursor-pointer items-center gap-1.5 px-2 text-left text-xs hover:bg-fill"
                :class="selected === f.path ? 'bg-fill text-ink' : 'text-ink-muted'"
                :aria-current="selected === f.path || undefined"
                :data-wt-compare-file="f.path"
                @click="pick(f.path)"
              >
                <span class="w-3 shrink-0 text-center font-mono text-2xs font-semibold" :class="STATUS_CLASS[f.status]" :title="t(`workspace.wt.compare.status.${f.status}`)">{{ f.status }}</span>
                <span class="min-w-0 flex-1 truncate">{{ baseName(f.path) }}<span v-if="dirOfRel(f.path)" class="ml-1.5 text-ink-faint">{{ dirOfRel(f.path) }}</span></span>
                <span v-if="!f.binary" class="shrink-0 text-2xs tabular">
                  <span v-if="f.added" class="text-diff-add">+{{ f.added }}</span>
                  <span v-if="f.removed" class="ml-1 text-diff-del">−{{ f.removed }}</span>
                </span>
              </button>
            </li>
            <li v-if="!loading && !files.length" class="px-3 py-2 text-2xs text-ink-faint">{{ t('workspace.wt.compare.same') }}</li>
            <li v-if="truncated" class="px-3 py-2 text-2xs text-ink-faint">{{ t('workspace.wt.compare.truncated', { n: files.length }) }}</li>
          </ul>
          <div class="flex min-h-0 min-w-0 flex-1 flex-col bg-well">
            <div v-if="selected" class="flex h-8 min-w-0 shrink-0 items-center gap-1 border-b border-well-line px-2 text-well-ink">
              <span class="min-w-0 flex-1 truncate font-mono text-2xs" :title="selected">{{ selected }}</span>
              <button
                v-if="canTake"
                type="button"
                class="well-btn ccm-btn-plain shrink-0 gap-1 text-2xs"
                :disabled="busy"
                :title="t('workspace.wt.compare.take', { branch: takeFrom.branch })"
                data-wt-take
                @click="take()"
              >
                <ArrowDownToLine :size="13" aria-hidden="true" />{{ t('workspace.wt.compare.take', { branch: takeFrom.branch }) }}
              </button>
            </div>
            <p v-if="notice" class="shrink-0 border-b border-well-line px-3 py-1 text-2xs" :class="notice.ok ? 'text-well-ink' : 'text-diff-del'" role="status">{{ notice.text }}</p>
            <div class="ccm-scroll min-h-0 flex-1 overflow-auto">
              <div v-if="diffState === 'loading'" class="grid size-full place-items-center text-xs text-well-ink" role="status">{{ t('workspace.changes.loading') }}</div>
              <div v-else-if="diffState !== 'idle'" class="grid size-full place-items-center p-6 text-sm text-well-ink">
                {{ diffState === 'large' ? t('workspace.changes.tooLarge') : diffState === 'binary' ? t('workspace.changes.binary') : diffState === 'empty' ? t('workspace.changes.noDiff') : '' }}
              </div>
              <DiffView
                v-else-if="diffFile"
                :file="diffFile"
                :blocks="blocks"
                :layout="opts.layout"
                :lang="lang"
                :collapse="true"
                :context="3"
                :highlight="opts.highlight"
                :align="opts.align"
                :sync="opts.sync"
                :can-revert="false"
                :current="current"
                :sides="{ left: a.branch, right: b.branch }"
                @focus-block="(i: number) => (current = i)"
              />
            </div>
          </div>
        </div>
        <form class="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2" @submit.prevent="sendBoth()">
          <input
            v-model="promptText"
            class="ccm-field h-8 min-w-0 flex-1 text-xs"
            :placeholder="t('workspace.wt.compare.promptBoth')"
            :aria-label="t('workspace.wt.compare.promptBoth')"
            :disabled="!!sendBlocked"
            :title="sendBlocked ?? undefined"
          />
          <button type="submit" class="ccm-btn h-8 shrink-0 gap-1 text-xs" :disabled="!!sendBlocked || !promptText.trim()" :title="sendBlocked ?? t('workspace.wt.compare.sendHint')">
            <Send :size="13" aria-hidden="true" />{{ t('workspace.wt.compare.send') }}
          </button>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.well-btn {
  min-height: 24px;
  color: var(--ccm-well-ink);
}
.well-btn:hover:not(:disabled) {
  background: var(--ccm-well-line);
}
</style>
