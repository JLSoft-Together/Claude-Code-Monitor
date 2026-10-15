<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleAlert, CircleCheck, Clock, FilePlus, FileText, ImageIcon, ImagePlus, LoaderCircle, Paperclip, Send, X } from 'lucide-vue-next'
import { clipboardImageBlob, imageData } from '../../lib/imageData'
import { pickFiles } from '../../lib/preview'
import type { EraseKeys } from '../../lib/promptAttachments'
import { fromPath, useAttachmentsStore, type Attachment } from '../../stores/attachments'
import ToggleSwitch from '../ToggleSwitch.vue'

/** Tray of one terminal pane: what goes into the agent's prompt, named as the agent names it. */
const props = defineProps<{
  paneKey: string
  imagesSupported: boolean
  /** Keys that erase an inserted item, null = not before the cursor on its row (usePaneAttachments). */
  eraseFor: (a: Attachment) => EraseKeys | null
  remove: (a: Attachment) => Promise<boolean>
}>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const store = useAttachmentsStore()
const notice = ref('')
let noticeTimer = 0

const live = computed(() => store.live(props.paneKey))
const sent = computed(() => store.sent(props.paneKey))
const staged = computed(() => live.value.filter((a) => a.state === 'staged'))

function say(text: string): void {
  notice.value = text
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => (notice.value = ''), 4000)
}

async function addFiles(): Promise<void> {
  const paths = await pickFiles()
  const items = paths.map((p) => fromPath(p, 'pick')).filter((it) => it.kind === 'file' || props.imagesSupported)
  if (items.length) store.add(props.paneKey, items)
}

async function pasteImage(): Promise<void> {
  const blob = await clipboardImageBlob()
  const img = blob ? await imageData(blob) : null
  if (!img) return say(t('attach.noImage'))
  store.add(props.paneKey, [{ kind: 'image', name: t('attach.clipboard'), source: 'paste', ...img }])
}

async function removeItem(a: Attachment): Promise<void> {
  if (!(await props.remove(a))) say(t('attach.removeInTerminal'))
}

const STATE = {
  staged: { icon: Clock, cls: 'text-ink-muted' },
  inserting: { icon: LoaderCircle, cls: 'text-ink-muted' },
  inserted: { icon: CircleCheck, cls: 'text-success' },
  sent: { icon: Send, cls: 'text-ink-faint' },
  failed: { icon: CircleAlert, cls: 'text-warning' },
} as const

const removable = (a: Attachment): boolean => a.state !== 'inserted' || props.eraseFor(a) !== null
const label = (a: Attachment): string => (a.source === 'terminal' && a.kind === 'image' ? t('attach.image') : a.name)
</script>

<template>
  <aside
    class="flex w-64 min-w-0 shrink-0 flex-col overflow-hidden rounded-card bg-surface shadow-card"
    :aria-label="t('attach.title')"
    data-attachments
  >
    <header class="flex items-center gap-2 border-b border-line px-3 py-2">
      <Paperclip :size="14" class="shrink-0 text-ink-muted" aria-hidden="true" />
      <h3 class="min-w-0 flex-1 truncate text-xs font-semibold text-ink">{{ t('attach.title') }}</h3>
      <button type="button" class="ccm-btn-plain -my-1 -mr-1.5" :aria-label="t('attach.close')" :title="t('attach.close')" @click="emit('close')">
        <X :size="14" aria-hidden="true" />
      </button>
    </header>

    <div class="flex gap-1.5 px-3 pt-2.5">
      <button type="button" class="ccm-btn h-7 min-w-0 flex-1 px-2 text-xs" data-attach="add" @click="addFiles">
        <FilePlus :size="14" class="shrink-0" aria-hidden="true" /><span class="truncate">{{ t('attach.add') }}</span>
      </button>
      <button v-if="imagesSupported" type="button" class="ccm-btn h-7 min-w-0 flex-1 px-2 text-xs" data-attach="paste" @click="pasteImage">
        <ImagePlus :size="14" class="shrink-0" aria-hidden="true" /><span class="truncate">{{ t('attach.paste') }}</span>
      </button>
    </div>

    <div class="ccm-scroll min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
      <p v-if="!live.length && !sent.length" class="px-1.5 py-3 text-xs leading-relaxed text-ink-faint">{{ t('attach.empty') }} {{ t('attach.hint') }}</p>
      <ul class="flex flex-col gap-0.5" role="list">
        <li
          v-for="a in live"
          :key="a.id"
          class="group flex min-w-0 items-center gap-2 rounded-inner px-1.5 py-1 hover:bg-fill"
          :data-attachment="a.state"
        >
          <img v-if="a.thumb" :src="a.thumb" alt="" class="size-7 shrink-0 rounded-[4px] object-cover shadow-control" />
          <span v-else class="inline-flex size-7 shrink-0 items-center justify-center rounded-[4px] bg-fill text-ink-muted" aria-hidden="true">
            <ImageIcon v-if="a.kind === 'image'" :size="14" />
            <FileText v-else :size="14" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-xs text-ink" :title="a.path ?? label(a)">{{ label(a) }}</span>
            <span class="flex min-w-0 items-center gap-1 text-2xs" :class="STATE[a.state].cls">
              <component :is="STATE[a.state].icon" :size="11" class="shrink-0" :class="a.state === 'inserting' ? 'ccm-spin' : ''" aria-hidden="true" />
              <span class="shrink-0">{{ t(`attach.state.${a.state}`) }}</span>
              <span v-if="a.token" class="min-w-0 truncate font-mono text-ink-muted" :title="a.token">· {{ a.token }}</span>
              <span v-else-if="a.error" class="min-w-0 truncate" :title="t(`attach.error.${a.error}`)">· {{ t(`attach.error.${a.error}`) }}</span>
            </span>
          </span>
          <button
            type="button"
            class="ccm-btn-plain -mr-0.5 shrink-0 opacity-70 group-hover:opacity-100 focus-visible:opacity-100"
            :aria-label="t('attach.remove', { name: label(a) })"
            :title="removable(a) ? t('attach.remove', { name: label(a) }) : t('attach.removeInTerminal')"
            :aria-disabled="!removable(a)"
            @click="removeItem(a)"
          >
            <X :size="13" aria-hidden="true" />
          </button>
        </li>
      </ul>

      <template v-if="sent.length">
        <div class="mt-3 flex items-center justify-between px-1.5">
          <p class="text-2xs font-semibold text-ink-faint">{{ t('attach.lastSent') }}</p>
          <button type="button" class="text-2xs text-link hover:underline" @click="store.clearSent(paneKey)">{{ t('attach.clearSent') }}</button>
        </div>
        <ul class="mt-1 flex flex-col gap-0.5" role="list">
          <li v-for="a in sent" :key="a.id" class="flex min-w-0 items-center gap-2 px-1.5 py-0.5 text-2xs text-ink-faint" data-attachment="sent">
            <Send :size="11" class="shrink-0" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate" :title="a.path ?? label(a)">{{ label(a) }}</span>
            <span v-if="a.token" class="max-w-[45%] shrink-0 truncate font-mono">{{ a.token }}</span>
          </li>
        </ul>
      </template>
    </div>

    <footer class="flex flex-col gap-1 border-t border-line px-3 pt-1 pb-2">
      <p v-if="notice" class="pt-1 text-2xs text-warning" role="status">{{ notice }}</p>
      <button v-if="staged.length" type="button" class="ccm-btn ccm-btn-primary mt-1.5 h-7 text-xs" @click="store.insert(paneKey)">
        {{ t('attach.insertAll', { n: staged.length }) }}
      </button>
      <ToggleSwitch v-model="store.autoInsert" :label="t('attach.auto')" :hint="imagesSupported ? t('attach.clipboardNote') : undefined" class="[&_p:first-child]:text-xs" />
    </footer>
  </aside>
</template>
