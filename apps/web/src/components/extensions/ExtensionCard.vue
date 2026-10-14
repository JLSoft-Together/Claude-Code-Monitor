<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleAlert, CircleCheck, ExternalLink, LoaderCircle, LogIn, TriangleAlert } from 'lucide-vue-next'
import type { CatalogEntry, ExtPrereq, ExtResult, ExtScope } from '@ccm/shared'
import { removeScope, type EntryState } from '../../lib/extensions'
import { entryIcon, STATE_META } from './meta'

const props = defineProps<{
  entry: CatalogEntry
  state: EntryState
  /** `claude mcp list` still running for an MCP entry. */
  checking: boolean
  missing: ExtPrereq[]
  busy: boolean
  disabled: boolean
  project: boolean
  result?: ExtResult
}>()
const emit = defineEmits<{ open: []; remove: [scope: ExtScope]; signIn: [server: string]; docs: [] }>()
const { t } = useI18n()

const icon = computed(() => entryIcon(props.entry.id))
const showChecking = computed(() => props.checking && props.entry.kind === 'mcp' && props.state.state !== 'notInstalled' && props.state.state !== 'guide')
const badge = computed(() => STATE_META[props.state.state])
const label = computed(() => {
  const s = props.state
  if (s.state === 'installed' && (s.total ?? 0) > 1) return t('ext.partial', { n: s.installed?.length ?? 0, total: s.total })
  return t(`ext.state.${s.state}`)
})
const multi = computed(() => (props.state.total ?? 0) > 1)
const scopeToRemove = computed(() => (props.state.viaPlugin ? null : removeScope(props.state.scopes, props.project)))
const canSignIn = computed(() => props.state.state === 'needsAuth' && !!props.state.server)

/** Main action: sign in when a server waits for it, else install / manage / steps. */
const primary = computed<'signIn' | 'open' | 'remove' | null>(() => {
  if (canSignIn.value) return 'signIn'
  if (props.entry.install.type === 'guide' || multi.value) return 'open'
  if (props.state.viaPlugin) return null
  return scopeToRemove.value ? 'remove' : 'open'
})
const openLabel = computed(() =>
  props.entry.install.type === 'guide' ? t('ext.actions.setup') : multi.value && props.state.state === 'installed' ? t('ext.actions.manage') : t('ext.actions.install'),
)
const resultText = computed(() => {
  const r = props.result
  if (!r) return null
  return r.ok ? t('ext.result.ok') : t(`ext.result.${r.code}`)
})
</script>

<template>
  <article
    class="flex min-w-0 flex-col gap-3 rounded-card bg-surface p-4 shadow-card"
    :data-ext-card="entry.id"
    :aria-busy="busy || undefined"
  >
    <div class="flex min-w-0 items-start gap-3">
      <span class="grid size-9 shrink-0 place-items-center rounded-inner bg-fill" aria-hidden="true">
        <component :is="icon" :size="18" class="text-ink-muted" />
      </span>
      <div class="min-w-0 flex-1">
        <h4 class="truncate text-sm font-semibold" :title="entry.name">{{ entry.name }}</h4>
        <p class="truncate text-2xs text-ink-faint" :title="entry.vendor">{{ entry.vendor }}</p>
      </div>
      <button type="button" class="ccm-btn-plain -mt-1 -mr-1 shrink-0" :aria-label="`${t('ext.actions.docs')}: ${entry.name}`" :title="t('ext.actions.docs')" @click="emit('docs')">
        <ExternalLink :size="14" aria-hidden="true" />
      </button>
    </div>

    <p class="line-clamp-2 min-h-[2lh] text-xs leading-relaxed text-ink-muted">{{ t(`ext.desc.${entry.id}`) }}</p>

    <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span v-if="showChecking && state.state === 'unknown'" class="inline-flex items-center gap-1 text-xs font-medium text-ink-muted" data-ext-state="checking">
        <LoaderCircle :size="13" class="animate-spin" aria-hidden="true" />{{ t('ext.state.checking') }}
      </span>
      <span v-else class="inline-flex items-center gap-1 text-xs font-medium" :class="badge.cls" :data-ext-state="state.state">
        <component :is="badge.icon" :size="13" aria-hidden="true" />{{ label }}
      </span>
      <span
        v-for="s in state.scopes"
        :key="s"
        class="rounded-full bg-fill px-1.5 py-px text-2xs text-ink-muted"
      >{{ t(`ext.scopeChip.${s}`) }}</span>
    </div>
    <p v-if="state.viaPlugin" class="-mt-2 truncate text-2xs text-ink-faint">{{ t('ext.viaPlugin', { name: state.viaPlugin }) }}</p>
    <p v-if="state.state === 'pending'" class="-mt-2 text-2xs leading-relaxed text-ink-faint">{{ t('ext.pendingHint') }}</p>
    <p v-if="missing.length" class="-mt-1 flex items-start gap-1 text-2xs leading-relaxed text-warning">
      <TriangleAlert :size="12" class="mt-0.5 shrink-0" aria-hidden="true" />
      {{ t('ext.prereqMissing', { what: missing.map((m) => t(`ext.prereq.${m}`)).join(', ') }) }}
    </p>

    <div class="mt-auto flex flex-wrap items-center gap-2 pt-1">
      <button
        v-if="primary === 'signIn'"
        type="button"
        class="ccm-btn ccm-btn-primary"
        :disabled="disabled"
        :data-ext-action="'signIn'"
        @click="emit('signIn', state.server!)"
      >
        <LoaderCircle v-if="busy" :size="13" class="animate-spin" aria-hidden="true" />
        <LogIn v-else :size="13" aria-hidden="true" />{{ t('ext.actions.signIn') }}
      </button>
      <button
        v-if="primary === 'open' || (primary === 'signIn' && multi)"
        type="button"
        class="ccm-btn"
        :class="{ 'ccm-btn-primary': primary === 'open' && state.state !== 'installed' && entry.install.type !== 'guide' }"
        :disabled="disabled && entry.install.type !== 'guide'"
        :aria-label="`${openLabel}: ${entry.name}`"
        data-ext-action="open"
        @click="emit('open')"
      >
        <LoaderCircle v-if="busy && primary === 'open'" :size="13" class="animate-spin" aria-hidden="true" />{{ openLabel }}
      </button>
      <button
        v-if="scopeToRemove && (primary === 'remove' || primary === 'signIn') && !multi"
        type="button"
        class="ccm-btn"
        :disabled="disabled"
        :aria-label="`${t('ext.actions.remove')}: ${entry.name}`"
        data-ext-action="remove"
        @click="emit('remove', scopeToRemove)"
      >
        <LoaderCircle v-if="busy && primary === 'remove'" :size="13" class="animate-spin" aria-hidden="true" />{{ t('ext.actions.remove') }}
      </button>
      <p
        v-if="resultText"
        class="flex min-w-0 items-center gap-1 text-2xs"
        :class="result?.ok ? 'text-success' : result?.code === 'cancelled' ? 'text-ink-faint' : 'text-warning'"
        :title="result && !result.ok ? result.detail : undefined"
        role="status"
      >
        <CircleCheck v-if="result?.ok" :size="12" class="shrink-0" aria-hidden="true" />
        <CircleAlert v-else :size="12" class="shrink-0" aria-hidden="true" />
        <span class="truncate">{{ resultText }}</span>
      </p>
    </div>
  </article>
</template>
