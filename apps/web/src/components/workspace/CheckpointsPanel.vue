<script setup lang="ts">
import { computed, defineAsyncComponent, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { GitCompareArrows, History, LoaderCircle, RotateCcw } from 'lucide-vue-next'
import { absoluteIn, dirOfRel } from '../../lib/changesView'
import { now, relativeTime } from '../../lib/format'
import { baseName, cpDiff, cpRestore, type Checkpoint, type CheckpointFile } from '../../lib/preview'
import { turnPair } from '../../lib/turnReview'
import { useCheckpointsStore } from '../../stores/checkpoints'
import { dirKey } from '../../stores/favorites'

const TurnReview = defineAsyncComponent(() => import('./TurnReview.vue'))

const props = defineProps<{ root: string }>()
const emit = defineEmits<{ open: [path: string, keep: boolean] }>()

const { t, locale } = useI18n()
const store = useCheckpointsStore()

const state = computed(() => store.roots[dirKey(props.root)] ?? null)
const loading = ref(true)
watch(
  () => props.root,
  async (root) => {
    loading.value = true
    await store.refresh(root)
    loading.value = false
  },
  { immediate: true },
)

const picked = ref<string | null>(null)
const files = shallowRef<CheckpointFile[]>([])
const chosen = ref(new Set<string>())
const busy = ref(false)
const notice = ref<{ ok: boolean; text: string } | null>(null)

async function pick(id: string): Promise<void> {
  if (picked.value === id) {
    picked.value = null
    return
  }
  picked.value = id
  busy.value = true
  notice.value = null
  const res = await cpDiff(props.root, id)
  busy.value = false
  if (picked.value !== id) return
  files.value = res.ok ? res.files : []
  chosen.value = new Set(files.value.map((f) => f.path))
  if (!res.ok) notice.value = { ok: false, text: t(`workspace.checkpoints.error.${res.error}`, { detail: res.detail ?? '' }) }
}

async function restore(): Promise<void> {
  const id = picked.value
  const paths = files.value.map((f) => f.path).filter((p) => chosen.value.has(p))
  if (!id || !paths.length) return
  busy.value = true
  const res = await cpRestore(props.root, id, paths)
  busy.value = false
  if (res.ok) {
    notice.value = { ok: true, text: t('workspace.checkpoints.restored', { n: paths.length }, paths.length) }
    picked.value = null
  } else if (res.error !== 'cancelled') notice.value = { ok: false, text: t(`workspace.checkpoints.error.${res.error}`, { detail: res.detail ?? '' }) }
}

function toggle(path: string): void {
  const next = new Set(chosen.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  chosen.value = next
}

const labelOf = (label: string): string => {
  const [kind, ...rest] = label.split(':')
  const title = rest.join(':')
  return kind === 'before' || kind === 'after' ? t(`workspace.checkpoints.${kind}`, { title }) : label
}
const STATUS_CLASS = { A: 'text-diff-add', D: 'text-diff-del', M: 'text-diff-mod' } as const

const review = ref<{ before: Checkpoint; after: Checkpoint; title: string } | null>(null)
const pairOf = (cp: Checkpoint) => (state.value ? turnPair(state.value.list, cp.id) : null)
function openReview(cp: Checkpoint): void {
  const pair = pairOf(cp)
  if (pair) review.value = pair
}
</script>

<template>
  <div class="flex min-h-0 flex-col gap-1 border-t border-line pt-1">
    <div class="flex items-center gap-1.5 px-2 text-2xs font-semibold text-ink-faint">
      <History :size="12" aria-hidden="true" />
      <span class="flex-1">{{ t('workspace.checkpoints.title') }}</span>
      <LoaderCircle v-if="loading || busy" :size="11" class="ccm-spin" aria-hidden="true" />
      <label class="flex cursor-pointer items-center gap-1 font-normal text-ink-muted" :title="t('workspace.checkpoints.toggleHint')">
        <input type="checkbox" class="accent-(--ccm-accent)" :checked="!!state?.on" :disabled="loading" @change="store.setOn(root, ($event.target as HTMLInputElement).checked)" />
        {{ t('workspace.checkpoints.toggle') }}
      </label>
    </div>
    <p v-if="state?.on && !state.list.length" class="px-2 text-2xs text-ink-faint">{{ t('workspace.checkpoints.empty') }}</p>
    <p v-else-if="!state?.on && !loading" class="px-2 text-2xs text-ink-faint">{{ t('workspace.checkpoints.offHint') }}</p>
    <ul v-if="state?.on && state.list.length" class="ccm-scroll max-h-56 overflow-y-auto">
      <li v-for="cp in state.list" :key="cp.id">
        <button
          type="button"
          class="flex h-[22px] w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-inner px-2 text-left text-xs hover:bg-fill"
          :class="picked === cp.id ? 'bg-fill text-ink' : 'text-ink-muted'"
          :aria-expanded="picked === cp.id"
          @click="pick(cp.id)"
        >
          <span class="min-w-0 flex-1 truncate">{{ labelOf(cp.label) }}</span>
          <span class="shrink-0 text-2xs text-ink-faint tabular">{{ relativeTime(cp.at, locale, now) }}</span>
        </button>
        <div v-if="picked === cp.id && !busy" class="mx-1 mb-1 flex flex-col gap-1 rounded-inner bg-fill p-1.5">
          <button v-if="pairOf(cp)" type="button" class="ccm-btn h-6 justify-center gap-1 text-2xs" data-turn-review-open @click="openReview(cp)">
            <GitCompareArrows :size="12" aria-hidden="true" />{{ t('workspace.turnReview.open') }}
          </button>
          <p v-if="!files.length" class="text-2xs text-ink-faint">{{ t('workspace.checkpoints.same') }}</p>
          <template v-else>
            <p class="text-2xs text-ink-faint">{{ t('workspace.checkpoints.since', { n: files.length }, files.length) }}</p>
            <ul class="ccm-scroll max-h-48 overflow-y-auto">
              <li v-for="f in files" :key="f.path" class="flex h-[22px] min-w-0 items-center gap-1.5 text-xs">
                <input type="checkbox" class="accent-(--ccm-accent)" :checked="chosen.has(f.path)" :aria-label="f.path" @change="toggle(f.path)" />
                <span class="w-3 shrink-0 text-center font-mono text-2xs font-semibold" :class="STATUS_CLASS[f.status]" :title="t(`workspace.checkpoints.status.${f.status}`)">{{ f.status }}</span>
                <button type="button" class="min-w-0 flex-1 cursor-pointer truncate text-left text-ink hover:underline" :disabled="f.status === 'D'" @click="emit('open', absoluteIn(root, f.path), false)">
                  {{ baseName(f.path) }}<span v-if="dirOfRel(f.path)" class="ml-1.5 text-ink-faint">{{ dirOfRel(f.path) }}</span>
                </button>
                <span v-if="f.added || f.removed" class="shrink-0 text-2xs tabular">
                  <span v-if="f.added" class="text-diff-add">+{{ f.added }}</span><span v-if="f.removed" class="ml-1 text-diff-del">−{{ f.removed }}</span>
                </span>
              </li>
            </ul>
            <button type="button" class="ccm-btn h-6 justify-center gap-1 text-2xs" :disabled="!chosen.size" @click="restore">
              <RotateCcw :size="12" aria-hidden="true" />{{ t('workspace.checkpoints.restore', { n: chosen.size }, chosen.size) }}
            </button>
          </template>
        </div>
      </li>
    </ul>
    <p v-if="notice" class="px-2 pb-1 text-2xs" :class="notice.ok ? 'text-ink-muted' : 'text-st-error'" role="status">{{ notice.text }}</p>
    <TurnReview v-if="review" :root="root" :before="review.before" :after="review.after" :title="review.title" @close="review = null" @open="(p: string, k: boolean) => emit('open', p, k)" />
  </div>
</template>
