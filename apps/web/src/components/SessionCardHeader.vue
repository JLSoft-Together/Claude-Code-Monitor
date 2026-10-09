<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppWindow, Check, LoaderCircle, Pencil, Pin, RotateCcw, Star, StickyNote, Trash2, TriangleAlert, X } from 'lucide-vue-next'
import type { TerminalSession } from '@ccm/shared'
import { openAppKey } from '../lib/platform'
import { useBump } from '../composables/useBump'
import { useInlineEdit } from '../composables/useInlineEdit'
import { displayTitle, isAutoNamed } from '../lib/title'
import { useConnectionStore } from '../stores/connection'
import { useFavoritesStore } from '../stores/favorites'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'

const props = defineProps<{ terminal: TerminalSession }>()
const emit = defineEmits<{ note: [] }>()

const { t } = useI18n()
const ui = useUiStore()
const connection = useConnectionStore()
const favorites = useFavoritesStore()
const settings = useSettingsStore()

const ended = computed(() => props.terminal.status === 'stale')
const focused = computed(() => ui.focusedTerminalId === props.terminal.id)
const title = computed(() => displayTitle(props.terminal))
const autoNamed = computed(() => isAutoNamed(props.terminal))

const starred = computed(() => favorites.has(props.terminal.cwd))
const starLabel = computed(() => t(starred.value ? 'favorites.unstar' : 'favorites.star'))
const pinned = computed(() => settings.pinned.has(props.terminal.id))
const pinLabel = computed(() => t(pinned.value ? 'terminal.unpin' : 'terminal.pin'))
const pinBump = useBump(() => pinned.value)
const starBump = useBump(() => starred.value)

const jumping = computed(() => ui.focusingWindow === props.terminal.id)
const jumpError = computed(() => (ui.windowResult?.terminalId === props.terminal.id && ui.windowResult.result !== 'ok' ? ui.windowResult : null))
const canJump = computed(() => !ended.value && !!props.terminal.processId)
function jump(): void {
  if (!connection.focusWindow(props.terminal.id)) ui.reportWindowResult(props.terminal.id, 'offline')
}
const openError = computed(() => (ui.openResult?.terminalId === props.terminal.id ? ui.openResult : null))

const versionWarning = computed(() => {
  const supported = connection.supportedClaudeVersion
  const actual = props.terminal.claudeVersion
  if (!supported || !actual || supported === actual) return null
  return t('connection.versionMismatch', { supported, actual })
})

const { active: editing, draft, failed: saveFailed, input, start, commit, cancel } = useInlineEdit()

function saveAlias(value: string): boolean {
  const alias = value && value !== props.terminal.title ? value : null
  return (alias ?? undefined) === props.terminal.alias || connection.setAlias(props.terminal.id, alias)
}

function clearAlias(): void {
  connection.setAlias(props.terminal.id, null)
}
</script>

<template>
  <form v-if="editing" class="relative z-10 flex items-center gap-1.5" @submit.prevent="commit(saveAlias)">
    <label :for="`alias-${terminal.id}`" class="sr-only">{{ t('terminal.renameLabel') }}</label>
    <input
      :id="`alias-${terminal.id}`"
      ref="input"
      v-model="draft"
      maxlength="80"
      class="h-9 min-w-0 flex-1 rounded-lg border border-accent bg-canvas px-2.5 text-sm font-semibold text-ink outline-none"
      :aria-invalid="saveFailed"
      :aria-describedby="saveFailed ? `alias-err-${terminal.id}` : undefined"
      @keydown.esc.prevent="cancel"
    />
    <button type="submit" class="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg bg-accent text-on-accent" :aria-label="t('terminal.renameSave')">
      <Check :size="16" aria-hidden="true" />
    </button>
    <button type="button" class="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg text-ink-muted hover:bg-raised hover:text-ink" :aria-label="t('terminal.renameCancel')" @click="cancel">
      <X :size="16" aria-hidden="true" />
    </button>
  </form>
  <p v-if="editing && saveFailed" :id="`alias-err-${terminal.id}`" role="alert" class="relative z-10 mt-1 text-2xs text-st-error">
    {{ t('terminal.renameOffline') }}
  </p>

  <div v-if="!editing" class="flex items-start gap-2">
    <button
      type="button"
      class="min-w-0 flex-1 cursor-pointer truncate text-left text-base font-semibold after:absolute after:inset-0 after:rounded-xl after:content-['']"
      :title="title"
      :aria-label="t('terminal.focus', { title })"
      :aria-pressed="focused"
      @click="ui.focusTerminal(terminal.id)"
    >
      {{ title }}
    </button>
    <span
      v-if="terminal.kind && terminal.kind !== 'interactive'"
      class="shrink-0 rounded-md border border-line px-1.5 py-px font-mono text-2xs text-ink-muted"
      :title="t('terminal.kind')"
    >
      {{ terminal.kind }}
    </span>
    <span v-if="versionWarning" class="shrink-0 pt-1 text-st-waiting" :title="versionWarning" role="img" :aria-label="versionWarning">
      <TriangleAlert :size="15" aria-hidden="true" />
    </span>
    <button
      v-if="terminal.alias"
      type="button"
      class="relative z-10 -my-1 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-raised hover:text-ink"
      :aria-label="t('terminal.renameReset', { title: terminal.title })"
      :title="t('terminal.renameReset', { title: terminal.title })"
      @click="clearAlias"
    >
      <RotateCcw :size="15" aria-hidden="true" />
    </button>
    <button
      v-if="canJump"
      type="button"
      class="relative z-10 -my-1 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-raised hover:text-accent disabled:cursor-wait"
      :aria-label="t('terminal.jump', { title })"
      :title="t('terminal.jumpTitle')"
      :disabled="jumping"
      @click="jump"
    >
      <LoaderCircle v-if="jumping" :size="15" class="animate-spin" aria-hidden="true" />
      <AppWindow v-else :size="15" aria-hidden="true" />
    </button>
    <button
      v-if="!ended"
      type="button"
      class="relative z-10 -my-1 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-raised"
      :class="pinned ? 'text-accent' : 'text-ink-faint hover:text-ink'"
      :aria-label="pinLabel"
      :aria-pressed="pinned"
      :title="pinLabel"
      @click="settings.togglePin(terminal.id)"
    >
      <Pin :key="pinBump" :size="15" :fill="pinned ? 'currentColor' : 'none'" :class="pinBump ? 'ccm-pop' : ''" aria-hidden="true" />
    </button>
    <button
      v-if="terminal.cwd"
      type="button"
      class="relative z-10 -my-1 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-raised"
      :class="starred ? 'text-st-waiting' : 'text-ink-faint hover:text-ink'"
      :aria-label="starLabel"
      :aria-pressed="starred"
      :title="starLabel"
      @click="connection.toggleFavorite(terminal.id)"
    >
      <Star :key="starBump" :size="15" :fill="starred ? 'currentColor' : 'none'" :class="starBump ? 'ccm-pop' : ''" aria-hidden="true" />
    </button>
    <button
      type="button"
      class="relative z-10 -my-1 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-raised hover:text-ink"
      :class="terminal.note ? 'text-accent' : 'text-ink-faint'"
      :aria-label="t(terminal.note ? 'terminal.noteEdit' : 'terminal.noteAdd')"
      :title="t(terminal.note ? 'terminal.noteEdit' : 'terminal.noteAdd')"
      @click="emit('note')"
    >
      <StickyNote :size="15" aria-hidden="true" />
    </button>
    <button
      type="button"
      class="relative z-10 -my-1 -mr-1 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-raised hover:text-ink"
      :aria-label="t('terminal.rename')"
      :title="t('terminal.rename')"
      @click="start(title, true)"
    >
      <Pencil :size="15" aria-hidden="true" />
    </button>
    <button
      v-if="ended"
      type="button"
      class="relative z-10 -my-1 -mr-1 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-raised hover:text-st-error"
      :aria-label="t('terminal.dismiss', { title })"
      :title="t('terminal.dismiss', { title })"
      @click="connection.dismissEnded(terminal.id)"
    >
      <Trash2 :size="15" aria-hidden="true" />
    </button>
  </div>
  <p v-if="jumpError" role="alert" class="ccm-enter relative z-10 mt-1 text-2xs text-st-error">
    {{ t(`terminal.jumpError.${jumpError.result}`) }}
  </p>
  <p v-if="openError" role="alert" class="ccm-enter relative z-10 mt-1 text-2xs text-st-error">
    {{ t(`open.error.${openError.result}`, { app: t(`open.app.${openAppKey(openError.app)}`) }) }}
  </p>
  <p v-if="!editing && terminal.alias" class="mt-0.5 truncate text-2xs text-ink-faint" :title="terminal.title">
    {{ t('terminal.originalName', { title: terminal.title }) }}
  </p>
  <p v-else-if="!editing && autoNamed" class="mt-0.5 truncate text-2xs text-ink-faint" :title="t('terminal.nameHintLong')">
    {{ t('terminal.nameHint') }}
  </p>
</template>
