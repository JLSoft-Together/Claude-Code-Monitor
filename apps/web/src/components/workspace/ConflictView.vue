<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleCheck, FileWarning, PencilLine, TriangleAlert } from 'lucide-vue-next'
import { parseConflicts, resolveConflict, type ConflictBlock, type Pick } from '../../lib/mergeConflicts'
import { fileWrite, gitStage, readFile } from '../../lib/preview'

const props = defineProps<{ root: string; path: string; abs: string }>()
const emit = defineEmits<{ open: [path: string, line?: number]; staged: [] }>()

const { t } = useI18n()

const text = ref<string | null>(null)
const mtime = ref<number | undefined>(undefined)
const state = ref<'loading' | 'ready' | 'error'>('loading')
const notice = ref<string | null>(null)
const busy = ref(false)
const parsed = shallowRef<ReturnType<typeof parseConflicts> | null>(null)
let seq = 0

const blocks = computed<ConflictBlock[]>(() => parsed.value?.segments.flatMap((s) => (s.kind === 'conflict' ? [s.block] : [])) ?? [])
const left = computed(() => parsed.value?.count ?? 0)

async function load(): Promise<void> {
  const run = ++seq
  const view = await readFile(props.abs)
  if (run !== seq) return
  if (!view || view.kind !== 'text' || view.text == null) {
    state.value = 'error'
    return
  }
  text.value = view.text
  mtime.value = view.mtimeMs
  parsed.value = parseConflicts(view.text)
  state.value = 'ready'
}

watch(() => props.abs, () => {
  notice.value = null
  state.value = 'loading'
  void load()
}, { immediate: true })

async function take(index: number, pick: Pick): Promise<void> {
  if (busy.value || text.value == null) return
  busy.value = true
  notice.value = null
  const next = resolveConflict(text.value, index, pick)
  const res = await fileWrite(props.abs, next, mtime.value)
  busy.value = false
  if (res.ok) {
    text.value = next
    mtime.value = res.mtimeMs
    parsed.value = parseConflicts(next)
    return
  }
  notice.value = res.error === 'conflict' ? t('workspace.conflicts.changedOnDisk') : t('workspace.conflicts.writeFailed', { detail: res.error })
  if (res.error === 'conflict') void load()
}

async function markResolved(): Promise<void> {
  if (busy.value) return
  busy.value = true
  const res = await gitStage(props.root, [props.path])
  busy.value = false
  if (res.ok) emit('staged')
  else notice.value = t('workspace.conflicts.stageFailed', { detail: res.detail ?? res.error })
}

const sideLabel = (key: 'ours' | 'theirs', label: string): string => t(`workspace.conflicts.${key}`, { label: label || t(`workspace.conflicts.${key}Default`) })
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col" data-conflict-view>
    <div class="flex h-8 shrink-0 items-center gap-2 border-b border-well-line px-3 text-xs text-well-ink">
      <component :is="left ? TriangleAlert : CircleCheck" :size="13" class="shrink-0" :class="left ? 'text-warning' : 'text-success'" aria-hidden="true" />
      <span class="min-w-0 flex-1 truncate" aria-live="polite" data-conflict-left>{{
        left ? t('workspace.conflicts.left', { n: left }, left) : t('workspace.conflicts.none')
      }}</span>
      <button
        v-if="state === 'ready' && !left"
        type="button"
        class="well-btn ccm-btn-plain shrink-0 gap-1 text-2xs"
        :disabled="busy"
        data-conflict-resolved
        @click="markResolved()"
      >
        <CircleCheck :size="13" aria-hidden="true" />{{ t('workspace.conflicts.markResolved') }}
      </button>
    </div>
    <p v-if="notice" class="flex shrink-0 items-center gap-1.5 border-b border-well-line px-3 py-1 text-2xs text-well-ink" role="status">
      <FileWarning :size="12" class="shrink-0" aria-hidden="true" />{{ notice }}
    </p>
    <div class="ccm-scroll min-h-0 flex-1 overflow-auto">
      <div v-if="state === 'loading'" class="grid size-full place-items-center text-xs text-well-ink" role="status">{{ t('workspace.changes.loading') }}</div>
      <div v-else-if="state === 'error'" class="grid size-full place-items-center p-6 text-sm text-well-ink">{{ t('workspace.conflicts.readFailed') }}</div>
      <div v-else-if="!left" class="grid size-full place-items-center p-6 text-center text-sm text-well-ink">{{ t('workspace.conflicts.doneHint') }}</div>
      <ol v-else class="flex flex-col gap-3 p-3">
        <li v-for="(b, i) in blocks" :key="`${b.line}:${i}`" class="flex flex-col overflow-hidden rounded-inner border border-well-line" :data-conflict-block="i">
          <div class="flex min-w-0 flex-wrap items-center gap-1 border-b border-well-line px-2 py-1 text-2xs text-well-ink">
            <span class="mr-auto font-semibold">{{ t('workspace.conflicts.block', { line: b.line }) }}</span>
            <button type="button" class="well-btn ccm-btn-plain gap-1 text-2xs" :disabled="busy" data-take="ours" @click="take(i, 'ours')">{{ t('workspace.conflicts.takeOurs') }}</button>
            <button type="button" class="well-btn ccm-btn-plain gap-1 text-2xs" :disabled="busy" data-take="theirs" @click="take(i, 'theirs')">{{ t('workspace.conflicts.takeTheirs') }}</button>
            <button type="button" class="well-btn ccm-btn-plain gap-1 text-2xs" :disabled="busy" data-take="both" @click="take(i, 'both')">{{ t('workspace.conflicts.takeBoth') }}</button>
            <button type="button" class="well-btn ccm-btn-plain gap-1 text-2xs" :title="t('workspace.conflicts.editHint')" @click="emit('open', abs, b.line)">
              <PencilLine :size="12" aria-hidden="true" />{{ t('workspace.conflicts.edit') }}
            </button>
          </div>
          <div class="grid min-w-0" :class="b.base ? 'grid-cols-1 @3xl:grid-cols-3' : 'grid-cols-1 @xl:grid-cols-2'">
            <section class="min-w-0 border-well-line" :aria-label="sideLabel('ours', b.oursLabel)">
              <p class="truncate border-b border-well-line px-2 py-0.5 text-2xs font-semibold text-well-ink" :title="b.oursLabel">{{ sideLabel('ours', b.oursLabel) }}</p>
              <pre class="side font-mono">{{ b.ours.join('\n') || ' ' }}</pre>
            </section>
            <section v-if="b.base" class="min-w-0 border-t border-well-line @3xl:border-t-0 @3xl:border-l" :aria-label="t('workspace.conflicts.base')">
              <p class="border-b border-well-line px-2 py-0.5 text-2xs font-semibold text-well-ink">{{ t('workspace.conflicts.base') }}</p>
              <pre class="side font-mono">{{ b.base.join('\n') || ' ' }}</pre>
            </section>
            <section class="min-w-0 border-t border-well-line" :class="b.base ? '@3xl:border-t-0 @3xl:border-l' : '@xl:border-t-0 @xl:border-l'" :aria-label="sideLabel('theirs', b.theirsLabel)">
              <p class="truncate border-b border-well-line px-2 py-0.5 text-2xs font-semibold text-well-ink" :title="b.theirsLabel">{{ sideLabel('theirs', b.theirsLabel) }}</p>
              <pre class="side font-mono">{{ b.theirs.join('\n') || ' ' }}</pre>
            </section>
          </div>
        </li>
      </ol>
    </div>
  </div>
</template>

<style scoped>
.side {
  margin: 0;
  padding: 4px 8px;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.5;
  color: var(--ccm-well-ink);
  white-space: pre;
}
.well-btn {
  min-height: 22px;
  color: var(--ccm-well-ink);
}
.well-btn:hover:not(:disabled) {
  background: var(--ccm-well-line);
}
</style>
