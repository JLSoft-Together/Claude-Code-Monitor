<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Copy } from 'lucide-vue-next'
import type { CommitDetail } from '@ccm/shared'

const props = defineProps<{ detail: CommitDetail | null; loading: boolean; contains: (hash: string) => Promise<string[] | null> }>()
const { t, locale } = useI18n()
const branches = ref<string[] | null>(null)
const finding = ref(false)
const showAll = ref(false)
const fmt = computed(() => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }))
const ok = computed(() => (props.detail?.ok ? props.detail : null))

watch(
  () => ok.value?.hash,
  () => {
    branches.value = null
    finding.value = false
    showAll.value = false
  },
)

async function findBranches(): Promise<void> {
  if (!ok.value || finding.value) return
  const hash = ok.value.hash
  finding.value = true
  const res = await props.contains(hash)
  if (ok.value?.hash !== hash) return
  branches.value = res
  finding.value = false
}

const copy = (s: string): void => void navigator.clipboard.writeText(s).catch(() => undefined)
</script>

<template>
  <div class="ccm-scroll min-h-0 min-w-0 overflow-x-hidden overflow-y-auto p-3 text-xs" data-log-details>
    <p v-if="!detail && !loading" class="text-ink-faint">{{ t('workspace.log.details.select') }}</p>
    <p v-else-if="loading && !ok" class="text-ink-faint">{{ t('workspace.log.details.loading') }}</p>
    <p v-else-if="detail && !detail.ok" class="text-ink-muted">{{ t(`workspace.log.error.${detail.error}`) }}</p>
    <template v-else-if="ok">
      <p class="font-semibold break-words whitespace-pre-wrap text-ink">{{ ok.message }}</p>
      <p v-if="ok.parents.length > 1" class="mt-1 text-2xs text-ink-faint">{{ t('workspace.log.details.mergeNote') }}</p>
      <p class="mt-3 flex min-w-0 flex-wrap items-center gap-x-1 text-ink-muted">
        <button type="button" class="ccm-btn-plain h-5 gap-1 px-1 font-mono text-2xs" :title="t('workspace.log.details.copyHash', { hash: ok.hash })" data-log-hash @click="copy(ok.hash)">
          {{ ok.hash.slice(0, 8) }}<Copy :size="11" aria-hidden="true" />
        </button>
        <span class="text-ink">{{ ok.author }}</span>
        <a class="truncate text-accent-ink" :href="`mailto:${ok.email}`" :title="ok.email">&lt;{{ ok.email }}&gt;</a>
        <span>{{ t('workspace.log.details.on', { date: fmt.format(ok.authorTime * 1000) }) }}</span>
      </p>
      <p v-if="ok.committer !== ok.author || ok.commitTime !== ok.authorTime" class="mt-1 text-2xs text-ink-faint">
        {{ t('workspace.log.details.committedBy', { name: ok.committer, date: fmt.format(ok.commitTime * 1000) }) }}
      </p>
      <p class="mt-3 text-ink-muted">
        <button v-if="branches === null" type="button" class="ccm-btn-plain h-5 px-1 text-xs text-accent-ink" :disabled="finding" data-log-contains @click="findBranches">
          {{ finding ? t('workspace.log.details.branchesLoading') : t('workspace.log.details.showBranches') }}
        </button>
        <template v-else-if="branches.length">
          {{ t('workspace.log.details.inBranches', { n: branches.length }, branches.length) }}:
          <span class="text-ink">{{ (showAll ? branches : branches.slice(0, 3)).join(', ') }}</span>
          <button v-if="!showAll && branches.length > 3" type="button" class="ccm-btn-plain ml-1 h-5 px-1 text-xs text-accent-ink" @click="showAll = true">{{ t('workspace.log.details.showAll') }}</button>
        </template>
        <template v-else>{{ t('workspace.log.details.notInBranch') }}</template>
      </p>
    </template>
  </div>
</template>
