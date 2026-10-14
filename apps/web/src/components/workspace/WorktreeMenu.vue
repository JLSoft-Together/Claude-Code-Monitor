<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Asterisk, GitBranch, LoaderCircle, Plus, SquareCode, SquareTerminal, Trash2 } from 'lucide-vue-next'
import type { PtyPreset, PtyServerMessage, PtyWorktree, WorktreeError } from '@ccm/shared'
import { shortPath } from '../../lib/format'
import { PtyConnection } from '../../lib/ptyClient'
import { dirKey } from '../../stores/favorites'
import { useWorkspaceStore } from '../../stores/workspace'
import SegmentedControl from '../ui/SegmentedControl.vue'

const props = defineProps<{ cwd: string; anchor: DOMRect; trigger?: HTMLElement | null }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const workspace = useWorkspaceStore()

const WIDTH = 380
const root = ref<HTMLElement | null>(null)
const branchInput = ref<HTMLInputElement | null>(null)
const loading = ref(true)
const repo = ref<string | null>(null)
const worktrees = ref<PtyWorktree[]>([])
const listError = ref<WorktreeError | null>(null)
const branch = ref('')
const busy = ref(false)
const formError = ref<string | null>(null)
const confirming = ref<string | null>(null)
const rowError = ref<{ path: string; message: string } | null>(null)

const style = computed(() => {
  const left = Math.max(12, Math.min(props.anchor.left, window.innerWidth - WIDTH - 12))
  return { left: `${left}px`, top: `${props.anchor.bottom + 6}px`, width: `min(${WIDTH}px, calc(100vw - 24px))` }
})

const presetOptions = computed(() => [
  { value: 'claude' as PtyPreset, label: t('workspace.preset.claude'), icon: Asterisk },
  { value: 'codex' as PtyPreset, label: t('workspace.preset.codex'), icon: SquareCode },
  { value: 'shell' as PtyPreset, label: t('workspace.preset.shell'), icon: SquareTerminal },
])

const repoName = computed(() => repo.value?.split(/[\\/]+/).filter(Boolean).pop() ?? '')
const isHere = (wt: PtyWorktree): boolean => {
  const here = dirKey(props.cwd)
  const base = dirKey(wt.path)
  return here === base || here.startsWith(`${base}\\`)
}
// A nested worktree path also starts with its parent's: the longest match is where this pane lives.
const herePath = computed(() => [...worktrees.value].filter(isHere).sort((a, b) => b.path.length - a.path.length)[0]?.path)

function errorText(code: WorktreeError, detail?: string): string {
  return t(`workspace.wt.error.${code}`, { detail: detail ?? '' })
}

async function load(): Promise<void> {
  loading.value = true
  const reply = await PtyConnection.request({ t: 'wt.list', cwd: props.cwd })
  loading.value = false
  if (reply?.t === 'wt.list') {
    repo.value = reply.repo
    worktrees.value = reply.worktrees
    listError.value = reply.repo ? null : 'notRepo'
  } else listError.value = reply?.t === 'wt.error' ? reply.code : 'unknown'
}

function openIn(path: string): void {
  workspace.open(workspace.preset, path)
  emit('close')
}

async function create(): Promise<void> {
  const name = branch.value.trim()
  if (!name || busy.value) return
  busy.value = true
  formError.value = null
  const reply: PtyServerMessage | null = await PtyConnection.request({ t: 'wt.add', cwd: props.cwd, branch: name }, 130_000)
  busy.value = false
  if (reply?.t === 'wt.added') return openIn(reply.path)
  formError.value = reply?.t === 'wt.error' ? errorText(reply.code, reply.detail) : errorText('unknown')
}

async function remove(wt: PtyWorktree): Promise<void> {
  if (busy.value) return
  busy.value = true
  rowError.value = null
  const reply = await PtyConnection.request({ t: 'wt.remove', cwd: props.cwd, path: wt.path }, 130_000)
  busy.value = false
  confirming.value = null
  if (reply?.t === 'wt.removed') return void load()
  rowError.value = { path: wt.path, message: reply?.t === 'wt.error' ? errorText(reply.code, reply.detail) : errorText('unknown') }
}

function onOutside(e: PointerEvent): void {
  const target = e.target as Node
  if (!root.value?.contains(target) && !props.trigger?.contains(target)) emit('close')
}

onMounted(async () => {
  document.addEventListener('pointerdown', onOutside, true)
  await load()
  await nextTick()
  if (!listError.value) branchInput.value?.focus()
})
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside, true))
</script>

<template>
  <Teleport to="body">
    <div
      ref="root"
      class="ccm-menu ccm-pop fixed z-50 flex flex-col gap-2 p-2"
      :style="style"
      role="dialog"
      :aria-label="t('workspace.wt.title')"
      @keydown.esc.stop="emit('close')"
    >
      <div class="flex items-center gap-2 px-2 pt-1">
        <GitBranch :size="14" class="shrink-0 text-ink-muted" aria-hidden="true" />
        <span class="truncate text-sm font-semibold text-ink">{{ repoName || t('workspace.wt.title') }}</span>
        <LoaderCircle v-if="loading" :size="13" class="ccm-spin ml-auto shrink-0 text-ink-faint" aria-hidden="true" />
      </div>

      <p v-if="listError" class="px-2 pb-1 text-xs text-ink-muted" role="status">{{ errorText(listError) }}</p>

      <template v-else-if="!loading">
        <SegmentedControl v-model="workspace.preset" :options="presetOptions" :label="t('workspace.launch.agent')" fill />
        <ul class="ccm-scroll -mx-1 flex max-h-[min(40vh,320px)] flex-col overflow-y-auto px-1">
          <li v-for="wt in worktrees" :key="wt.path" class="flex flex-col">
            <div class="group flex min-w-0 items-center gap-1">
              <button
                type="button"
                class="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-inner px-2 text-left text-sm text-ink hover:bg-fill focus-visible:bg-accent focus-visible:text-on-accent focus-visible:outline-none disabled:cursor-default disabled:opacity-50"
                :title="t('workspace.wt.openIn', { path: wt.path })"
                :disabled="wt.prunable"
                @click="openIn(wt.path)"
              >
                <GitBranch :size="14" class="shrink-0 opacity-70" aria-hidden="true" />
                <span class="shrink-0 truncate font-medium">{{ wt.branch ?? t('workspace.wt.detached', { head: wt.head.slice(0, 7) }) }}</span>
                <span class="min-w-0 truncate text-xs opacity-60">{{ shortPath(wt.path) }}</span>
                <span v-if="wt.main" class="ml-auto shrink-0 rounded-[4px] bg-fill px-1 text-2xs opacity-80">{{ t('workspace.wt.main') }}</span>
                <span v-else-if="wt.path === herePath" class="ml-auto shrink-0 rounded-[4px] bg-fill px-1 text-2xs opacity-80">{{ t('workspace.wt.here') }}</span>
                <span v-else-if="wt.prunable" class="ml-auto shrink-0 text-2xs opacity-80">{{ t('workspace.wt.missing') }}</span>
              </button>
              <button
                v-if="!wt.main"
                type="button"
                class="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-inner text-ink-faint hover:bg-fill hover:text-st-error focus-visible:text-st-error"
                :title="t('workspace.wt.remove')"
                :aria-label="`${t('workspace.wt.remove')}: ${wt.branch ?? wt.path}`"
                @click="confirming = confirming === wt.path ? null : wt.path"
              >
                <Trash2 :size="14" aria-hidden="true" />
              </button>
            </div>
            <div v-if="confirming === wt.path" class="mx-1 mb-1 flex flex-col gap-2 rounded-inner bg-fill p-2 text-xs text-ink" role="alertdialog" :aria-label="t('workspace.wt.remove')">
              <p>{{ t('workspace.wt.confirm', { name: wt.branch ?? shortPath(wt.path) }) }}</p>
              <div class="flex justify-end gap-1.5">
                <button type="button" class="ccm-btn h-7" @click="confirming = null">{{ t('workspace.wt.cancel') }}</button>
                <button type="button" class="ccm-btn ccm-btn-danger h-7" :disabled="busy" @click="remove(wt)">
                  <LoaderCircle v-if="busy" :size="13" class="ccm-spin" aria-hidden="true" />{{ t('workspace.wt.remove') }}
                </button>
              </div>
            </div>
            <p v-if="rowError?.path === wt.path" class="mx-2 mb-1 text-xs text-st-error" role="alert">{{ rowError.message }}</p>
          </li>
        </ul>

        <form class="flex flex-col gap-1.5 border-t border-line px-1 pt-2" @submit.prevent="create">
          <label :for="`wt-branch`" class="px-1 text-2xs font-semibold text-ink-faint">{{ t('workspace.wt.new') }}</label>
          <div class="flex gap-1.5">
            <input
              id="wt-branch"
              ref="branchInput"
              v-model="branch"
              class="ccm-field h-8 min-w-0 flex-1 font-mono text-xs"
              :placeholder="t('workspace.wt.placeholder')"
              autocomplete="off"
              spellcheck="false"
              :aria-invalid="!!formError"
              aria-describedby="wt-hint"
            />
            <button type="submit" class="ccm-btn ccm-btn-primary h-8" :disabled="busy || !branch.trim()">
              <LoaderCircle v-if="busy" :size="13" class="ccm-spin" aria-hidden="true" />
              <Plus v-else :size="14" aria-hidden="true" />{{ t('workspace.wt.create') }}
            </button>
          </div>
          <p v-if="formError" class="px-1 text-xs text-st-error" role="alert">{{ formError }}</p>
          <p v-else id="wt-hint" class="px-1 text-2xs text-ink-faint">{{ t('workspace.wt.hint', { dir: `${repoName}-wt/` }) }}</p>
        </form>
      </template>
    </div>
  </Teleport>
</template>
