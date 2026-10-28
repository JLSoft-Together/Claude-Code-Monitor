<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, GitCommitHorizontal, LoaderCircle, X } from 'lucide-vue-next'
import { isMac } from '../../lib/platform'
import { gitCommit, gitCommitCancel, type ChangesStatus } from '../../lib/preview'
import { stagedCount } from '../../lib/changesView'

const props = defineProps<{ status: Extract<ChangesStatus, { ok: true }> }>()
const emit = defineEmits<{ committed: [subject: string] }>()

const { t } = useI18n()
// Drafts survive switching between repos (not reloads): one per repo root.
const drafts = new Map<string, string>()
const message = ref(drafts.get(props.status.root) ?? '')
const amend = ref(false)
const busy = ref(false)
const notice = ref<{ ok: boolean; text: string } | null>(null)

watch(
  () => props.status.root,
  (root, prev) => {
    if (prev) drafts.set(prev, message.value)
    message.value = drafts.get(root) ?? ''
    amend.value = false
    notice.value = null
  },
)

const staged = computed(() => stagedCount(props.status.entries))
// HEAD that may still be local; the main process checks the remotes again before amending.
const mayAmend = computed(() => !props.status.upstream || props.status.ahead > 0)
watch(mayAmend, (v) => {
  if (!v) amend.value = false
})
const canCommit = computed(() => !busy.value && !!message.value.trim() && (staged.value > 0 || amend.value))
const keys = isMac ? '⌘↩' : 'Ctrl+Enter'

async function submit(): Promise<void> {
  if (!canCommit.value) return
  busy.value = true
  notice.value = null
  const res = await gitCommit(props.status.root, message.value, amend.value)
  busy.value = false
  if (res.ok) {
    message.value = ''
    drafts.delete(props.status.root)
    amend.value = false
    notice.value = { ok: true, text: t('workspace.commit.done', { hash: res.hash.slice(0, 7), subject: res.subject }) }
    emit('committed', res.subject)
  } else if (res.error !== 'cancelled') {
    notice.value = { ok: false, text: t(`workspace.commit.error.${res.error}`, { detail: res.detail ?? '' }) }
  }
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey)) {
    e.preventDefault()
    void submit()
  }
}
</script>

<template>
  <div class="flex shrink-0 flex-col gap-1 px-2 pb-1.5">
    <textarea
      v-model="message"
      rows="2"
      spellcheck="true"
      class="ccm-scroll max-h-40 min-h-12 w-full resize-y rounded-inner border border-line bg-control px-2 py-1 text-xs text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-focus"
      :placeholder="t('workspace.commit.placeholder', { branch: status.branch ?? '', keys })"
      :aria-label="t('workspace.commit.message')"
      :disabled="busy"
      @keydown="onKey"
    />
    <div class="flex min-w-0 items-center gap-1.5">
      <button
        type="button"
        class="ccm-btn ccm-btn-primary h-6 min-w-0 flex-1 justify-center gap-1 px-2 text-2xs"
        :disabled="!canCommit"
        :title="`${t('workspace.commit.action')} (${keys})`"
        @click="submit"
      >
        <LoaderCircle v-if="busy" :size="12" class="ccm-spin" aria-hidden="true" />
        <GitCommitHorizontal v-else :size="13" aria-hidden="true" />
        <span class="truncate">{{ amend ? t('workspace.commit.amendAction') : t('workspace.commit.actionN', { n: staged }, staged) }}</span>
      </button>
      <button v-if="busy" type="button" class="ccm-btn h-6 px-2 text-2xs" @click="gitCommitCancel(status.root)">
        {{ t('workspace.commit.cancel') }}
      </button>
      <label v-else-if="mayAmend" class="flex shrink-0 cursor-pointer items-center gap-1 text-2xs text-ink-muted" :title="t('workspace.commit.amendHint')">
        <input v-model="amend" type="checkbox" class="accent-(--ccm-accent)" />
        {{ t('workspace.commit.amend') }}
      </label>
    </div>
    <p v-if="!staged && !amend && message.trim()" class="text-2xs text-ink-faint">{{ t('workspace.commit.nothingStaged') }}</p>
    <p v-if="notice" class="flex items-start gap-1 text-2xs" :class="notice.ok ? 'text-ink-muted' : 'text-st-error'" role="status">
      <Check v-if="notice.ok" :size="12" class="mt-px shrink-0 text-success" aria-hidden="true" />
      <span class="min-w-0 flex-1 break-words">{{ notice.text }}</span>
      <button type="button" class="shrink-0 cursor-pointer text-ink-faint hover:text-ink" :aria-label="t('workspace.explorer.status.dismiss')" @click="notice = null">
        <X :size="11" aria-hidden="true" />
      </button>
    </p>
  </div>
</template>
