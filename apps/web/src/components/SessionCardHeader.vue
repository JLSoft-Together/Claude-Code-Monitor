<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppWindow, Check, Info, LoaderCircle, Pencil, Pin, RotateCcw, SquareTerminal, Star, StickyNote, Trash2, TriangleAlert, X } from 'lucide-vue-next'
import { isAgentSessionId, type TerminalSession } from '@ccm/shared'
import { hasTerminals } from '../lib/desktop'
import { openAppKey } from '../lib/platform'
import { useBump } from '../composables/useBump'
import { useInlineEdit } from '../composables/useInlineEdit'
import { isCodex } from '../lib/provider'
import { displayTitle, isAutoNamed } from '../lib/title'
import { useConnectionStore } from '../stores/connection'
import { useFavoritesStore } from '../stores/favorites'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import { useWorkspaceStore } from '../stores/workspace'
import ProviderBadge from './ProviderBadge.vue'

const props = defineProps<{ terminal: TerminalSession }>()
const emit = defineEmits<{ note: [] }>()

const { t } = useI18n()
const ui = useUiStore()
const connection = useConnectionStore()
const favorites = useFavoritesStore()
const settings = useSettingsStore()
const workspace = useWorkspaceStore()

const ended = computed(() => props.terminal.status === 'stale')
const focused = computed(() => ui.focusedTerminalId === props.terminal.id)
const title = computed(() => displayTitle(props.terminal))
const codex = computed(() => isCodex(props.terminal))
const autoNamed = computed(() => !codex.value && isAutoNamed(props.terminal))

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
const pane = computed(() => workspace.paneByTerminal.get(props.terminal.id))
const resumeId = computed(() => (codex.value ? props.terminal.codexSessionId : props.terminal.claudeSessionId))
const canReopen = computed(() => hasTerminals && !pane.value && !!props.terminal.cwd && isAgentSessionId(resumeId.value))
const confirmReopen = ref(false)

function showInWorkspace(): void {
  if (!pane.value) return
  workspace.activate(pane.value.key)
  ui.setView('workspace')
}

// Two live instances on one session would both append to the same transcript, so a running one needs a yes first.
function reopen(force = false): void {
  if (!canReopen.value) return
  if (!ended.value && !force) {
    confirmReopen.value = true
    return
  }
  confirmReopen.value = false
  workspace.resumeSession(codex.value ? 'codex' : 'claude', props.terminal.cwd!, resumeId.value!)
  ui.setView('workspace')
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
      class="ccm-field min-w-0 flex-1 text-sm! font-semibold"
      :aria-invalid="saveFailed"
      :aria-describedby="saveFailed ? `alias-err-${terminal.id}` : undefined"
      @keydown.esc.prevent="cancel"
    />
    <button type="submit" class="ccm-btn ccm-btn-primary w-7 px-0!" :aria-label="t('terminal.renameSave')">
      <Check :size="16" aria-hidden="true" />
    </button>
    <button type="button" class="ccm-btn-plain" :aria-label="t('terminal.renameCancel')" @click="cancel">
      <X :size="16" aria-hidden="true" />
    </button>
  </form>
  <p v-if="editing && saveFailed" :id="`alias-err-${terminal.id}`" role="alert" class="relative z-10 mt-1 text-2xs text-st-error">
    {{ t('terminal.renameOffline') }}
  </p>

  <div v-if="!editing" class="flex items-start gap-2">
    <button
      type="button"
      class="min-w-0 flex-1 cursor-pointer truncate text-left text-base font-semibold after:absolute after:inset-0 after:rounded-card after:content-['']"
      :title="title"
      :aria-label="t('terminal.focus', { title })"
      :aria-pressed="focused"
      @click="ui.focusTerminal(terminal.id)"
    >
      {{ title }}
    </button>
    <ProviderBadge v-if="codex" class="mt-1" :mode="terminal.entrypoint" />
    <span
      v-if="terminal.kind && terminal.kind !== 'interactive'"
      class="shrink-0 rounded-inner bg-fill px-1.5 py-px font-mono text-2xs text-ink-muted"
      :title="t('terminal.kind')"
    >
      {{ terminal.kind }}
    </span>
    <span v-if="versionWarning" class="shrink-0 pt-1 text-warning" :title="versionWarning" role="img" :aria-label="versionWarning">
      <TriangleAlert :size="15" aria-hidden="true" />
    </span>
    <button
      v-if="terminal.alias"
      type="button"
      class="ccm-btn-plain relative z-10 -my-1 shrink-0"
      :aria-label="t('terminal.renameReset', { title: terminal.title })"
      :title="t('terminal.renameReset', { title: terminal.title })"
      @click="clearAlias"
    >
      <RotateCcw :size="15" aria-hidden="true" />
    </button>
    <button
      v-if="pane"
      type="button"
      class="ccm-btn-plain relative z-10 -my-1 shrink-0 text-accent-ink!"
      :aria-label="t('workspace.reopen.show')"
      :title="t('workspace.reopen.show')"
      @click="showInWorkspace"
    >
      <SquareTerminal :size="15" aria-hidden="true" />
    </button>
    <button
      v-else-if="canReopen"
      type="button"
      class="ccm-btn-plain relative z-10 -my-1 shrink-0 hover:text-accent-ink!"
      :aria-label="t('workspace.reopen.action')"
      :title="t('workspace.reopen.action')"
      :aria-expanded="confirmReopen"
      @click="reopen()"
    >
      <SquareTerminal :size="15" aria-hidden="true" />
    </button>
    <button
      v-if="canJump && !pane"
      type="button"
      class="ccm-btn-plain relative z-10 -my-1 shrink-0 hover:text-accent-ink! disabled:cursor-wait!"
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
      class="ccm-btn-plain relative z-10 -my-1 shrink-0"
      :class="pinned ? 'text-accent-ink!' : ''"
      :aria-label="pinLabel"
      :aria-pressed="pinned"
      :title="pinLabel"
      @click="settings.togglePin(terminal.id)"
    >
      <Pin :key="pinBump" :size="15" :fill="pinned ? 'currentColor' : 'none'" :class="pinBump ? 'ccm-pop' : ''" aria-hidden="true" />
    </button>
    <button
      v-if="terminal.cwd && !codex"
      type="button"
      class="ccm-btn-plain relative z-10 -my-1 shrink-0"
      :class="starred ? 'text-favorite!' : ''"
      :aria-label="starLabel"
      :aria-pressed="starred"
      :title="starLabel"
      @click="connection.toggleFavorite(terminal.id)"
    >
      <Star :key="starBump" :size="15" :fill="starred ? 'currentColor' : 'none'" :class="starBump ? 'ccm-pop' : ''" aria-hidden="true" />
    </button>
    <button
      v-if="!codex"
      type="button"
      class="ccm-btn-plain relative z-10 -my-1 shrink-0"
      :class="terminal.note ? 'text-accent-ink!' : ''"
      :aria-label="t(terminal.note ? 'terminal.noteEdit' : 'terminal.noteAdd')"
      :title="t(terminal.note ? 'terminal.noteEdit' : 'terminal.noteAdd')"
      @click="emit('note')"
    >
      <StickyNote :size="15" aria-hidden="true" />
    </button>
    <button
      v-if="!codex"
      type="button"
      class="ccm-btn-plain relative z-10 -my-1 -mr-1 shrink-0"
      :aria-label="t('terminal.rename')"
      :title="t('terminal.rename')"
      @click="start(title, true)"
    >
      <Pencil :size="15" aria-hidden="true" />
    </button>
    <button
      v-if="ended"
      type="button"
      class="ccm-btn-plain relative z-10 -my-1 -mr-1 shrink-0 hover:text-st-error!"
      :aria-label="t('terminal.dismiss', { title })"
      :title="t('terminal.dismiss', { title })"
      @click="connection.dismissEnded(terminal.id)"
    >
      <Trash2 :size="15" aria-hidden="true" />
    </button>
  </div>
  <p v-if="jumpError?.result === 'appOnly'" role="status" class="ccm-enter relative z-10 mt-1 inline-flex items-center gap-1 text-2xs text-ink-muted">
    <Info :size="12" class="shrink-0" aria-hidden="true" />{{ t('terminal.jumpError.appOnly') }}
  </p>
  <p v-else-if="jumpError" role="alert" class="ccm-enter relative z-10 mt-1 text-2xs text-st-error">
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
  <div v-if="confirmReopen" class="relative z-10 mt-2 flex flex-col gap-2 rounded-inner bg-warning-soft p-2.5 text-xs text-ink" role="alertdialog" :aria-label="t('workspace.reopen.action')">
    <p class="flex gap-1.5"><TriangleAlert :size="14" class="mt-px shrink-0 text-warning" aria-hidden="true" />{{ t('workspace.reopen.liveWarning') }}</p>
    <div class="flex justify-end gap-1.5">
      <button type="button" class="ccm-btn h-7" @click="confirmReopen = false">{{ t('workspace.reopen.cancel') }}</button>
      <button type="button" class="ccm-btn ccm-btn-primary h-7" @click="reopen(true)">{{ t('workspace.reopen.confirm') }}</button>
    </div>
  </div>
</template>
