<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Ellipsis, Info, Pin, SquareTerminal, Star, TriangleAlert, X } from 'lucide-vue-next'
import type { TerminalSession } from '@ccm/shared'
import { openAppKey } from '../lib/platform'
import { useInlineEdit } from '../composables/useInlineEdit'
import { useRevealInWorkspace } from '../composables/useRevealInWorkspace'
import { badgeOf } from '../lib/provider'
import { statusMeta } from '../lib/status'
import { displayTitle, isAutoNamed } from '../lib/title'
import { useConnectionStore } from '../stores/connection'
import { useFavoritesStore } from '../stores/favorites'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import ProviderBadge from './ProviderBadge.vue'
import StatusIcon from './StatusIcon.vue'

const props = defineProps<{ terminal: TerminalSession }>()
const emit = defineEmits<{ menu: [trigger: HTMLElement] }>()

const { t } = useI18n()
const ui = useUiStore()
const connection = useConnectionStore()
const favorites = useFavoritesStore()
const settings = useSettingsStore()
const reveal = useRevealInWorkspace()

const ended = computed(() => props.terminal.status === 'stale')
const focused = computed(() => ui.focusedTerminalId === props.terminal.id)
const title = computed(() => displayTitle(props.terminal))
// Rename, notes and favourites are kept per Claude session; other CLIs are read-only here.
const badge = computed(() => badgeOf(props.terminal))
const codex = computed(() => badge.value !== null)
const autoNamed = computed(() => !codex.value && isAutoNamed(props.terminal))
const statusText = computed(() => t(statusMeta(props.terminal.status).labelKey))

const starred = computed(() => favorites.has(props.terminal.cwd))
const pinned = computed(() => settings.pinned.has(props.terminal.id))
const pane = computed(() => reveal.paneOf(props.terminal.id))

const jumpError = computed(() => (ui.windowResult?.terminalId === props.terminal.id && ui.windowResult.result !== 'ok' ? ui.windowResult : null))
const openError = computed(() => (ui.openResult?.terminalId === props.terminal.id ? ui.openResult : null))
const titleTip = computed(() =>
  props.terminal.alias ? [title.value, t('terminal.originalName', { title: props.terminal.title })].join('\n') : title.value,
)
const renameTip = computed(() => (autoNamed.value ? [t('terminal.rename'), t('terminal.nameHintLong')].join('\n') : t('terminal.rename')))

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

defineExpose({
  rename: () => start(title.value, true),
  resetName: () => connection.setAlias(props.terminal.id, null),
})
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
      :title="renameTip"
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

  <div v-if="!editing" class="flex min-w-0 items-center gap-1.5">
    <span class="inline-flex shrink-0 items-center" role="img" :aria-label="t('monitorV79.card.status', { status: statusText })" :title="statusText">
      <Transition name="ccm-fade" mode="out-in">
        <StatusIcon :key="terminal.status" :status="terminal.status" :size="15" />
      </Transition>
    </span>
    <button
      type="button"
      class="min-w-0 flex-1 cursor-pointer truncate text-left text-base font-semibold after:absolute after:inset-0 after:rounded-card after:content-['']"
      :title="titleTip"
      :aria-label="t('terminal.focus', { title })"
      :aria-pressed="focused"
      @click="ui.focusTerminal(terminal.id)"
    >
      {{ title }}
    </button>
    <span class="flex shrink-0 items-center gap-1" data-card-state>
      <SquareTerminal v-if="pane" :size="13" class="text-accent-ink" aria-hidden="true" />
      <Pin v-if="pinned && !ended" :size="13" fill="currentColor" class="text-accent-ink" aria-hidden="true" />
      <Star v-if="starred && terminal.cwd && !codex" :size="13" fill="currentColor" class="text-favorite" aria-hidden="true" />
    </span>
    <ProviderBadge v-if="badge" :mode="terminal.entrypoint" :provider="badge" />
    <span
      v-if="terminal.kind && terminal.kind !== 'interactive'"
      class="shrink-0 rounded-inner bg-fill px-1.5 py-px font-mono text-2xs text-ink-muted"
      :title="t('terminal.kind')"
    >
      {{ terminal.kind }}
    </span>
    <span v-if="versionWarning" class="shrink-0 text-warning" :title="versionWarning" role="img" :aria-label="versionWarning">
      <TriangleAlert :size="15" aria-hidden="true" />
    </span>
    <slot name="trailing" />
    <button
      type="button"
      class="ccm-btn-plain relative z-10 -my-1 -me-1.5 shrink-0 opacity-0 transition-opacity duration-(--ccm-dur-fast) ease-out-quint group-hover/card:opacity-100 group-focus-within/card:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
      :aria-label="t('monitorV79.card.more', { title })"
      :title="t('monitorV79.card.more', { title })"
      aria-haspopup="menu"
      data-card-more
      @click="emit('menu', $event.currentTarget as HTMLElement)"
    >
      <Ellipsis :size="16" aria-hidden="true" />
    </button>
  </div>
  <span v-if="!editing && autoNamed" :id="`name-hint-${terminal.id}`" class="sr-only">{{ t('terminal.nameHintLong') }}</span>
  <p v-if="jumpError?.result === 'appOnly'" role="status" class="ccm-enter relative z-10 mt-1 inline-flex items-center gap-1 text-2xs text-ink-muted">
    <Info :size="12" class="shrink-0" aria-hidden="true" />{{ t('terminal.jumpError.appOnly') }}
  </p>
  <p v-else-if="jumpError" role="alert" class="ccm-enter relative z-10 mt-1 text-2xs text-st-error">
    {{ t(`terminal.jumpError.${jumpError.result}`) }}
  </p>
  <p v-if="openError" role="alert" class="ccm-enter relative z-10 mt-1 text-2xs text-st-error">
    {{ t(`open.error.${openError.result}`, { app: t(`open.app.${openAppKey(openError.app)}`) }) }}
  </p>
</template>
