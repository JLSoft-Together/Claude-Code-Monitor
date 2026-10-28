<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowUp, ListOrdered, Pause, Pencil, Play, Plus, SquareArrowRight, Trash2 } from 'lucide-vue-next'
import { emptyQueue } from '../../lib/promptQueue'
import { usePromptQueueStore } from '../../stores/promptQueue'

const props = defineProps<{ paneKey: string; canFill: boolean }>()
const emit = defineEmits<{ fill: [] }>()
const { t } = useI18n()
const store = usePromptQueueStore()
store.get(props.paneKey)

const queue = computed(() => store.queues[props.paneKey] ?? emptyQueue())
const count = computed(() => queue.value.items.length)
const label = computed(() => (count.value ? t('workspace.promptQueue.count', { n: count.value }, count.value) : t('workspace.promptQueue.title')))

const button = ref<HTMLButtonElement | null>(null)
const pop = ref<HTMLElement | null>(null)
const draftBox = ref<HTMLTextAreaElement | null>(null)
const anchor = ref<DOMRect | null>(null)
const draft = ref('')
const editing = ref<string | null>(null)
const editText = ref('')

const style = computed(() => {
  const r = anchor.value
  if (!r) return {}
  const w = Math.min(400, window.innerWidth - 24)
  return { left: `${Math.max(12, Math.min(r.right - w, window.innerWidth - w - 12))}px`, top: `${r.bottom + 6}px`, width: `${w}px` }
})

function open(rect?: DOMRect): void {
  const r = rect ?? button.value?.getBoundingClientRect()
  if (!r) return
  anchor.value = r
  document.addEventListener('pointerdown', onOutside, true)
  void nextTick(() => draftBox.value?.focus())
}
function toggle(): void {
  if (anchor.value) close()
  else open()
}
function close(): void {
  anchor.value = null
  editing.value = null
  document.removeEventListener('pointerdown', onOutside, true)
}
function onOutside(e: PointerEvent): void {
  const target = e.target as Node
  if (!pop.value?.contains(target) && !button.value?.contains(target)) close()
}
onBeforeUnmount(close)
defineExpose({ open, close })

function add(): void {
  if (!draft.value.trim()) return
  store.add(props.paneKey, draft.value)
  draft.value = ''
  draftBox.value?.focus()
}
function startEdit(id: string, text: string): void {
  editing.value = id
  editText.value = text
}
function saveEdit(): void {
  if (editing.value) store.edit(props.paneKey, editing.value, editText.value)
  editing.value = null
}
function fillNow(): void {
  emit('fill')
}
</script>

<template>
  <button
    ref="button"
    type="button"
    class="ccm-btn-plain shrink-0 gap-1 @max-[420px]:hidden"
    :class="queue.paused && count ? 'text-warning' : ''"
    :aria-label="label"
    :title="`${label}: ${t('workspace.promptQueue.hint')}`"
    aria-haspopup="dialog"
    :aria-expanded="!!anchor"
    data-prompt-queue
    data-more="queue"
    @click.stop="toggle()"
  >
    <ListOrdered :size="14" aria-hidden="true" />
    <span v-if="count" class="text-2xs tabular" data-prompt-queue-count>{{ count }}</span>
  </button>
  <Teleport to="body">
    <div
      v-if="anchor"
      ref="pop"
      class="ccm-menu fixed z-50 flex max-h-[min(70vh,560px)] flex-col gap-2 overflow-y-auto p-3 text-xs text-ink outline-none"
      :style="style"
      role="dialog"
      tabindex="-1"
      :aria-label="t('workspace.promptQueue.title')"
      data-prompt-queue-pop
      @keydown.esc.stop="close()"
    >
      <div class="flex items-center gap-2">
        <p class="min-w-0 flex-1 truncate font-semibold">{{ t('workspace.promptQueue.title') }}</p>
        <button
          type="button"
          class="ccm-btn h-7 gap-1 text-2xs"
          :aria-pressed="queue.paused"
          data-prompt-queue-pause
          @click="store.pause(paneKey, !queue.paused)"
        >
          <Play v-if="queue.paused" :size="12" aria-hidden="true" />
          <Pause v-else :size="12" aria-hidden="true" />
          {{ queue.paused ? t('workspace.promptQueue.resume') : t('workspace.promptQueue.pause') }}
        </button>
        <button
          type="button"
          class="ccm-btn h-7 gap-1 text-2xs"
          :disabled="!count || !canFill"
          :title="canFill ? t('workspace.promptQueue.fillHint') : t('workspace.promptQueue.notRunning')"
          data-prompt-queue-fill
          @click="fillNow"
        >
          <SquareArrowRight :size="12" aria-hidden="true" />{{ t('workspace.promptQueue.fillNow') }}
        </button>
      </div>
      <p class="text-2xs text-ink-faint">
        {{ queue.paused ? t('workspace.promptQueue.pausedHint') : t('workspace.promptQueue.hint') }}
      </p>
      <ol v-if="count" class="flex flex-col gap-1">
        <li v-for="(it, i) in queue.items" :key="it.id" class="flex items-start gap-1.5 rounded-inner bg-fill p-1.5" data-prompt-queue-item>
          <span class="w-4 shrink-0 pt-0.5 text-right text-2xs text-ink-faint tabular">{{ i + 1 }}</span>
          <textarea
            v-if="editing === it.id"
            v-model="editText"
            class="ccm-field min-h-14 min-w-0 flex-1 resize-y font-mono text-2xs"
            :aria-label="t('workspace.promptQueue.editLabel')"
            data-prompt-queue-edit
            @keydown.enter.ctrl.prevent="saveEdit"
            @keydown.enter.meta.prevent="saveEdit"
            @keydown.esc.stop="editing = null"
            @blur="saveEdit"
          />
          <button
            v-else
            type="button"
            class="min-w-0 flex-1 cursor-text text-left font-mono text-2xs break-words whitespace-pre-wrap text-ink-muted hover:text-ink"
            :title="t('workspace.promptQueue.edit')"
            @click="startEdit(it.id, it.text)"
          >
            {{ it.text.length > 400 ? `${it.text.slice(0, 400)}…` : it.text }}
          </button>
          <span class="flex shrink-0 items-center">
            <button type="button" class="ccm-btn-plain min-w-6 px-1" :disabled="i === 0" :aria-label="t('workspace.promptQueue.up')" :title="t('workspace.promptQueue.up')" data-prompt-queue-up @click="store.move(paneKey, it.id, -1)">
              <ArrowUp :size="12" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="ccm-btn-plain min-w-6 px-1"
              :disabled="i === count - 1"
              :aria-label="t('workspace.promptQueue.down')"
              :title="t('workspace.promptQueue.down')"
              data-prompt-queue-down
              @click="store.move(paneKey, it.id, 1)"
            >
              <ArrowDown :size="12" aria-hidden="true" />
            </button>
            <button type="button" class="ccm-btn-plain min-w-6 px-1" :aria-label="t('workspace.promptQueue.edit')" :title="t('workspace.promptQueue.edit')" @click="startEdit(it.id, it.text)">
              <Pencil :size="12" aria-hidden="true" />
            </button>
            <button type="button" class="ccm-btn-plain min-w-6 px-1" :aria-label="t('workspace.promptQueue.remove')" :title="t('workspace.promptQueue.remove')" data-prompt-queue-remove @click="store.remove(paneKey, it.id)">
              <Trash2 :size="12" aria-hidden="true" />
            </button>
          </span>
        </li>
      </ol>
      <p v-else class="text-2xs text-ink-faint">{{ t('workspace.promptQueue.empty') }}</p>
      <div class="flex flex-col gap-1.5">
        <textarea
          ref="draftBox"
          v-model="draft"
          class="ccm-field min-h-16 resize-y font-mono text-2xs"
          :placeholder="t('workspace.promptQueue.placeholder')"
          :aria-label="t('workspace.promptQueue.addLabel')"
          data-prompt-queue-draft
          @keydown.enter.ctrl.prevent="add"
          @keydown.enter.meta.prevent="add"
        />
        <button type="button" class="ccm-btn ccm-btn-primary h-7 gap-1 self-end text-2xs" :disabled="!draft.trim()" data-prompt-queue-add @click="add">
          <Plus :size="12" aria-hidden="true" />{{ t('workspace.promptQueue.add') }}
        </button>
      </div>
    </div>
  </Teleport>
</template>
