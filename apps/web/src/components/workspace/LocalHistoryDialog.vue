<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { History } from 'lucide-vue-next'
import { lhList, lhRead, type LhVersion } from '../../lib/preview'
import { now, relativeTime } from '../../lib/format'
import TextCompareDialog from './TextCompareDialog.vue'

const props = defineProps<{ path: string; name: string; current: string; grammar: string | null }>()
const emit = defineEmits<{ restore: [text: string]; close: [] }>()
const { t, locale } = useI18n()

const versions = shallowRef<LhVersion[] | null>(null)
const selected = ref<string | null>(null)
const text = shallowRef<string | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
let seq = 0

const current = computed(() => versions.value?.find((v) => v.id === selected.value) ?? null)
const stamp = (time: number): string => new Date(time).toLocaleString(locale.value)
const size = (n: number): string => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`)

async function pick(id: string): Promise<void> {
  const run = ++seq
  selected.value = id
  loading.value = true
  error.value = null
  const res = await lhRead(props.path, id)
  if (run !== seq) return
  loading.value = false
  text.value = res.ok ? res.text : null
  if (!res.ok) error.value = t(`workspace.localHistory.error.${res.error}`)
}

onMounted(async () => {
  const res = await lhList(props.path)
  versions.value = res.ok ? res.versions : []
  if (!res.ok) error.value = t(`workspace.localHistory.error.${res.error}`)
  const first = versions.value[0]
  if (first) await pick(first.id)
  else loading.value = false
})

function onKey(e: KeyboardEvent): void {
  const list = versions.value
  if (!list?.length || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
  e.preventDefault()
  const at = list.findIndex((v) => v.id === selected.value)
  const next = list[Math.min(list.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))]
  if (next && next.id !== selected.value) {
    void pick(next.id)
    ;(e.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-lh-id="${next.id}"]`)?.focus()
  }
}
</script>

<template>
  <TextCompareDialog
    :title="t('workspace.localHistory.title', { name })"
    :subtitle="path"
    :a="text"
    :b="current ? props.current : null"
    :labels="{ a: current ? t('workspace.localHistory.version', { time: stamp(current.time) }) : '', b: t('workspace.localHistory.currentText') }"
    :grammar="grammar"
    :primary="t('workspace.localHistory.restore')"
    :primary-disabled="text === null || text === props.current"
    :loading="loading"
    :message="error ?? (versions && !versions.length ? t('workspace.localHistory.empty') : null)"
    :error="!!error"
    @primary="text !== null && emit('restore', text)"
    @close="emit('close')"
  >
    <template #side>
      <ul v-if="versions?.length" class="flex flex-col gap-px p-1.5" role="listbox" :aria-label="t('workspace.localHistory.list')" data-lh-list @keydown="onKey">
        <li v-for="v in versions" :key="v.id">
          <button
            type="button"
            role="option"
            :aria-selected="v.id === selected"
            class="flex w-full items-center gap-2 rounded-inner px-2 py-1.5 text-left text-xs"
            :class="v.id === selected ? 'bg-accent-soft text-accent-ink' : 'text-ink hover:bg-fill'"
            :title="stamp(v.time)"
            :data-lh-id="v.id"
            @click="pick(v.id)"
          >
            <History :size="13" class="shrink-0" :class="v.id === selected ? 'text-accent-ink' : 'text-ink-faint'" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate">{{ relativeTime(v.time, locale, now) }}</span>
            <span class="shrink-0 text-2xs tabular-nums" :class="v.id === selected ? 'text-accent-ink' : 'text-ink-faint'">{{ size(v.size) }}</span>
          </button>
        </li>
      </ul>
      <p v-else-if="versions" class="p-3 text-xs text-ink-muted">{{ t('workspace.localHistory.empty') }}</p>
    </template>
  </TextCompareDialog>
</template>
