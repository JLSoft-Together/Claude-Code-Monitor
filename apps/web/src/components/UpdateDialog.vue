<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleAlert, CircleArrowDown, CircleCheck, ExternalLink, FolderOpen, LoaderCircle, X } from 'lucide-vue-next'
import { relativeTime } from '../lib/format'
import { renderMarkdown } from '../lib/markdown'
import { retireOverlay } from '../lib/motion'
import { openExternal } from '../lib/preview'
import { megabytes, progressPercent } from '../lib/update'
import { useUpdateStore } from '../stores/update'

const { t, locale } = useI18n()
const store = useUpdateStore()
const dialog = ref<HTMLElement | null>(null)
let restoreFocus: HTMLElement | null = null

const s = computed(() => store.state)
const release = computed(() => s.value?.release ?? null)
const phase = computed(() => s.value?.phase ?? 'idle')
const error = computed(() => s.value?.error ?? null)
const pct = computed(() => progressPercent(s.value))
const notesHtml = computed(() => (release.value?.notes.trim() ? renderMarkdown(release.value.notes) : ''))
const date = computed(() => {
  const iso = release.value?.date
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const abs = d.toLocaleString(locale.value, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  const rel = relativeTime(d.getTime(), locale.value, Date.now())
  return rel ? `${abs} (${rel})` : abs
})
const progressText = computed(() => {
  const p = s.value?.progress
  return p ? t('update.progress', { got: megabytes(p.received), total: megabytes(p.total), speed: megabytes(p.bps) }) : ''
})
/** No file this build can install: the release page is the way forward. */
const pageOnly = computed(() => !s.value?.canDownload || error.value === 'no-asset' || error.value === 'no-digest' || !release.value?.asset)
const showFile = computed(() => error.value === 'install' || error.value === 'incomplete')

type Primary = { label: string; run: () => void; busy?: boolean; disabled?: boolean } | null
const primary = computed<Primary>(() => {
  if (phase.value === 'installing') return { label: t('update.installing'), run: () => undefined, busy: true, disabled: true }
  if (phase.value === 'ready') return { label: t('update.restart'), run: () => void store.install() }
  if (phase.value === 'downloading') return null
  if (pageOnly.value) return { label: t('update.openPage'), run: store.openPage }
  return { label: t('update.download'), run: () => void store.download() }
})

function close(): void {
  store.dialogOpen = false
}

function skip(): void {
  void store.skip()
}

// Release notes come from GitHub: links leave the app through the system browser, relative ones go nowhere.
function onNotesClick(e: MouseEvent): void {
  const a = (e.target as HTMLElement).closest('a')
  if (!a) return
  e.preventDefault()
  const href = a.getAttribute('href') ?? ''
  if (/^https:\/\//i.test(href)) openExternal(href)
}

function trap(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    return
  }
  if (e.key !== 'Tab' || !dialog.value) return
  const focusables = [...dialog.value.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]')]
  const first = focusables[0]
  const last = focusables.at(-1)
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last?.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first?.focus()
  }
}

watch(
  () => store.dialogOpen,
  async (open) => {
    if (open) {
      restoreFocus = document.activeElement as HTMLElement | null
      await nextTick()
      dialog.value?.querySelector<HTMLElement>('[data-update-primary], [data-update-close]')?.focus()
    } else {
      if (restoreFocus?.isConnected) restoreFocus.focus()
      restoreFocus = null
    }
  },
)
</script>

<template>
  <Teleport to="body">
    <Transition name="ccm-dialog" @before-leave="(el) => retireOverlay(el.firstElementChild!)">
      <div v-if="store.dialogOpen && release" class="fixed inset-0 z-50 flex items-start justify-center ccm-scrim px-4 py-[8vh]" @mousedown.self="close">
        <div
          ref="dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="update-title"
          class="flex max-h-[84vh] w-full max-w-[520px] flex-col overflow-hidden ccm-sheet"
          data-update-dialog
          @keydown="trap"
        >
          <div class="flex shrink-0 items-center gap-2.5 border-b border-line py-3 pr-3 pl-5">
            <CircleArrowDown :size="18" class="shrink-0 text-accent-ink" aria-hidden="true" />
            <div class="mr-auto min-w-0">
              <h2 id="update-title" class="truncate text-base font-semibold">{{ t('update.dialogTitle') }}</h2>
              <p class="truncate text-2xs text-ink-muted tabular-nums">{{ t('update.dialogSubtitle', { version: release.version, current: s?.current ?? '' }) }}</p>
              <p v-if="date" class="truncate text-2xs text-ink-muted tabular-nums" :title="release.date ?? undefined" data-update-date>{{ t('update.published', { date }) }}</p>
            </div>
            <button type="button" class="ccm-btn-plain shrink-0" :title="t('update.close')" :aria-label="t('update.close')" data-update-close @click="close">
              <X :size="16" aria-hidden="true" />
            </button>
          </div>

          <div class="ccm-scroll min-h-0 flex-1 overflow-y-auto bg-canvas px-5 py-4">
            <p v-if="release.asset" class="mb-2 flex flex-wrap gap-x-3 text-2xs text-ink-faint">
              <span v-if="release.asset" class="tabular-nums">{{ t('update.size', { mb: megabytes(release.asset.size) }) }}</span>
            </p>
            <h3 class="sr-only">{{ t('update.notes') }}</h3>
            <!-- eslint-disable-next-line vue/no-v-html -- renderMarkdown escapes every input character first -->
            <article v-if="notesHtml" class="update-notes ccm-group px-4 py-3 text-sm" data-update-notes @click="onNotesClick" v-html="notesHtml" />
            <p v-else class="ccm-group px-4 py-3 text-sm text-ink-muted">{{ t('update.noNotes') }}</p>
          </div>

          <div class="shrink-0 border-t border-line px-5 pt-3 pb-4">
            <div v-if="phase === 'downloading'" class="mb-3" data-update-progress>
              <div class="mb-1 flex items-baseline justify-between gap-3 text-xs">
                <span class="font-medium text-ink">{{ t('update.downloading', { pct }) }}</span>
                <span class="text-2xs text-ink-faint tabular-nums">{{ progressText }}</span>
              </div>
              <div
                class="h-1.5 overflow-hidden rounded-full bg-fill"
                role="progressbar"
                :aria-valuenow="pct"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-label="t('update.downloading', { pct })"
              >
                <div class="h-full origin-left rounded-full bg-accent transition-transform duration-200 motion-reduce:transition-none" :style="{ transform: `scaleX(${pct / 100})` }" />
              </div>
            </div>
            <p v-else-if="phase === 'ready' || phase === 'installing'" class="mb-3 flex items-start gap-2 text-xs text-ink" role="status" data-update-ready>
              <CircleCheck :size="14" class="mt-px shrink-0 text-success" aria-hidden="true" />{{ t('update.ready') }}
            </p>
            <p v-if="error" class="mb-3 flex items-start gap-2 text-xs text-ink" role="alert" data-update-error>
              <CircleAlert :size="14" class="mt-px shrink-0 text-st-error" aria-hidden="true" />{{ t(`update.error.${error}`) }}
            </p>
            <p v-if="!s?.canDownload" class="mb-3 text-2xs text-ink-faint">{{ t('update.devHint') }}</p>

            <div class="flex flex-wrap items-center gap-2">
              <button
                v-if="phase !== 'downloading' && phase !== 'ready' && phase !== 'installing'"
                type="button"
                class="ccm-btn-plain text-xs"
                :disabled="s?.skipped === release.version"
                data-update-skip
                @click="skip"
              >
                {{ s?.skipped === release.version ? t('update.skipped') : t('update.skip') }}
              </button>
              <button v-if="!pageOnly && phase !== 'installing'" type="button" class="ccm-btn-plain text-xs" @click="store.openPage()">
                <ExternalLink :size="12" aria-hidden="true" />{{ t('update.openPage') }}
              </button>
              <span class="flex-1" aria-hidden="true" />
              <button v-if="showFile" type="button" class="ccm-btn" @click="store.reveal()">
                <FolderOpen :size="13" aria-hidden="true" />{{ t('update.showFile') }}
              </button>
              <button v-if="phase === 'downloading'" type="button" class="ccm-btn" data-update-cancel @click="store.cancel()">{{ t('update.cancel') }}</button>
              <button v-else-if="phase !== 'installing'" type="button" class="ccm-btn" @click="close">{{ t('update.later') }}</button>
              <button
                v-if="primary"
                type="button"
                class="ccm-btn ccm-btn-primary"
                :disabled="primary.disabled"
                :aria-busy="primary.busy"
                data-update-primary
                @click="primary.run()"
              >
                <LoaderCircle v-if="primary.busy" :size="13" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                {{ primary.label }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.update-notes {
  color: var(--ccm-ink);
  line-height: 1.55;
  overflow-wrap: anywhere;
}
.update-notes :deep(h1),
.update-notes :deep(h2),
.update-notes :deep(h3),
.update-notes :deep(h4) {
  margin: 0.9em 0 0.4em;
  font-weight: 600;
  line-height: 1.3;
}
.update-notes :deep(:first-child) {
  margin-top: 0;
}
.update-notes :deep(h1),
.update-notes :deep(h2) {
  font-size: 1.05em;
}
.update-notes :deep(h3),
.update-notes :deep(h4) {
  font-size: 1em;
  color: var(--ccm-ink-muted);
}
.update-notes :deep(p),
.update-notes :deep(ul),
.update-notes :deep(ol),
.update-notes :deep(pre),
.update-notes :deep(blockquote) {
  margin: 0 0 0.7em;
}
.update-notes :deep(ul) {
  list-style: disc;
  padding-left: 1.3em;
}
.update-notes :deep(ol) {
  list-style: decimal;
  padding-left: 1.5em;
}
.update-notes :deep(li::marker) {
  color: var(--ccm-ink-faint);
}
.update-notes :deep(a) {
  color: var(--ccm-accent-ink);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.update-notes :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.9em;
  padding: 0.05em 0.3em;
  border-radius: 4px;
  background: var(--ccm-fill);
}
.update-notes :deep(pre) {
  padding: 0.6em 0.8em;
  overflow-x: auto;
  border-radius: var(--radius-inner);
  background: var(--ccm-fill);
}
.update-notes :deep(pre code) {
  padding: 0;
  background: none;
}
.update-notes :deep(blockquote) {
  padding-left: 0.8em;
  border-left: 3px solid var(--ccm-line);
  color: var(--ccm-ink-muted);
}
.update-notes :deep(hr) {
  margin: 1em 0;
  border: 0;
  border-top: 1px solid var(--ccm-line);
}
.update-notes :deep(table) {
  display: block;
  overflow-x: auto;
  border-collapse: collapse;
}
.update-notes :deep(th),
.update-notes :deep(td) {
  padding: 0.3em 0.6em;
  border: 1px solid var(--ccm-line);
}
</style>
