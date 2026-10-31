<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { TriangleAlert, X } from 'lucide-vue-next'
import { displayTitle } from '../lib/title'
import { useResourcesStore } from '../stores/resources'
import { useTerminalsStore } from '../stores/terminals'

const { t } = useI18n()
const res = useResourcesStore()
const terminals = useTerminalsStore()
const conflict = computed(() => res.conflicts[0] ?? null)

const text = computed(() => {
  const c = conflict.value
  if (!c) return ''
  if (!c.holder) return t('resources.conflictUnknown', { port: c.port })
  const term = c.holder.sessionId ? terminals.byId[c.holder.sessionId] : undefined
  return term ? t('resources.conflictSession', { port: c.port, holder: c.holder.name, session: displayTitle(term) }) : t('resources.conflict', { port: c.port, holder: c.holder.name })
})
</script>

<template>
  <div v-if="conflict" role="status" class="flex min-w-0 flex-wrap items-center gap-2 rounded-card bg-warning-soft px-3 py-1.5 text-xs" data-port-conflict>
    <TriangleAlert :size="14" class="shrink-0 text-warning" aria-hidden="true" />
    <span class="min-w-0 flex-1 text-ink">{{ text }}</span>
    <button type="button" class="ccm-btn h-6 text-2xs" @click="res.show('ports', conflict.port)">{{ t('resources.conflictShow') }}</button>
    <button type="button" class="ccm-btn-plain size-6 justify-center p-0" :aria-label="t('resources.conflictDismiss')" :title="t('resources.conflictDismiss')" @click="res.dismissConflict(conflict)">
      <X :size="13" aria-hidden="true" />
    </button>
  </div>
</template>
