<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ExternalLink, LoaderCircle, Trash2, TriangleAlert } from 'lucide-vue-next'
import { GH_TOKEN_URL, type GhAccount, type GhAccountsResult } from '@ccm/shared'
import { ghAccountAdd, ghAccountDefault, ghAccountRemove, ghAccounts } from '../lib/github'
import { openExternal } from '../lib/preview'

/** Settings › GitHub accounts (v58): tokens go to main once and are never shown again. Read when the panel opens. */
const props = defineProps<{ open: boolean }>()

const { t } = useI18n()
const accounts = ref<GhAccount[]>([])
const token = ref('')
const adding = ref(false)
const error = ref<string | null>(null)
const added = ref<string | null>(null)

const canAdd = computed(() => token.value.trim().length > 0 && !adding.value)

function apply(res: GhAccountsResult): boolean {
  if (res.ok) {
    accounts.value = res.accounts
    return true
  }
  if (res.error !== 'cancelled') error.value = [t(`github.error.${res.error}`), res.detail].filter(Boolean).join(' — ')
  return false
}

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    error.value = null
    added.value = null
    apply(await ghAccounts())
  },
  { immediate: true },
)

async function add(): Promise<void> {
  if (!canAdd.value) return
  adding.value = true
  error.value = null
  added.value = null
  const before = new Set(accounts.value.map((a) => `${a.id}:${a.addedAt}`))
  const res = await ghAccountAdd(token.value.trim())
  adding.value = false
  if (!apply(res)) return
  token.value = ''
  added.value = accounts.value.find((a) => !before.has(`${a.id}:${a.addedAt}`))?.login ?? null
}

async function remove(a: GhAccount): Promise<void> {
  error.value = null
  added.value = null
  apply(await ghAccountRemove(a.id))
}

async function makeDefault(a: GhAccount): Promise<void> {
  error.value = null
  apply(await ghAccountDefault(a.id))
}

/** Classic token without `repo`: private repos refuse push. Fine-grained tokens report no scopes (null). */
const missingRepo = (a: GhAccount): boolean => a.scopes !== null && !a.scopes.includes('repo')
const initial = (login: string): string => login.slice(0, 1).toUpperCase()
</script>

<template>
  <section aria-labelledby="set-github" class="mt-6" data-github-accounts>
    <h3 id="set-github" class="mb-1.5 px-3 text-2xs font-semibold text-ink-muted">{{ t('github.section') }}</h3>
    <div class="ccm-group divide-y divide-line overflow-hidden">
      <div v-for="a in accounts" :key="a.id" class="flex min-w-0 items-center gap-2.5 px-3 py-2" :data-github-account="a.login">
        <span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-fill text-xs font-semibold text-ink-muted" aria-hidden="true">{{ initial(a.login) }}</span>
        <div class="min-w-0 flex-1">
          <p class="flex min-w-0 items-center gap-1.5 text-sm text-ink">
            <span class="truncate" :title="a.login">{{ a.login }}</span>
            <span v-if="a.isDefault" class="shrink-0 rounded-inner bg-fill px-1.5 py-px text-2xs font-medium text-ink-muted" data-github-default>{{ t('github.default') }}</span>
          </p>
          <p v-if="missingRepo(a)" class="mt-0.5 flex min-w-0 items-center gap-1 text-2xs text-warning">
            <TriangleAlert :size="11" class="shrink-0" aria-hidden="true" />
            <span class="truncate" :title="t('github.noRepoScope')">{{ t('github.noRepoScope') }}</span>
          </p>
          <p v-else class="mt-0.5 truncate text-2xs text-ink-faint" :title="a.scopes ? a.scopes.join(', ') : t('github.fineGrained')">
            {{ [a.name, a.scopes ? a.scopes.join(', ') : t('github.fineGrained')].filter(Boolean).join(' · ') }}
          </p>
        </div>
        <button v-if="!a.isDefault" type="button" class="ccm-btn-plain shrink-0 text-xs" @click="makeDefault(a)">{{ t('github.makeDefault') }}</button>
        <button
          type="button"
          class="ccm-btn-plain shrink-0"
          :title="t('github.removeFor', { login: a.login })"
          :aria-label="t('github.removeFor', { login: a.login })"
          data-github-remove
          @click="remove(a)"
        >
          <Trash2 :size="14" aria-hidden="true" />
        </button>
      </div>
      <p v-if="!accounts.length" class="px-3 py-2.5 text-xs text-ink-muted" data-github-empty>{{ t('github.empty') }}</p>
    </div>

    <form class="ccm-group mt-3 overflow-hidden" novalidate data-github-add @submit.prevent="add">
      <div class="flex flex-col gap-1.5 px-3 py-2.5">
        <label for="set-github-token" class="text-xs font-medium text-ink-muted">{{ t('github.token') }}</label>
        <div class="flex min-w-0 items-center gap-2">
          <input
            id="set-github-token"
            v-model="token"
            type="password"
            autocomplete="off"
            spellcheck="false"
            class="ccm-field h-8 min-w-0 flex-1 font-mono text-sm"
            :placeholder="t('github.tokenPlaceholder')"
            :disabled="adding"
            aria-describedby="set-github-hint"
            @input="error = null"
          />
          <button type="submit" class="ccm-btn ccm-btn-primary shrink-0" :disabled="!canAdd" :aria-busy="adding">
            <LoaderCircle v-if="adding" :size="13" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {{ adding ? t('github.checking') : t('github.add') }}
          </button>
        </div>
        <p v-if="error" class="text-2xs text-st-error" role="alert" data-github-error>{{ error }}</p>
        <p v-else-if="added" class="text-2xs text-success" role="status">{{ t('github.added', { login: added }) }}</p>
        <button type="button" class="ccm-btn-plain self-start text-xs" @click="openExternal(GH_TOKEN_URL)">
          <ExternalLink :size="12" aria-hidden="true" />
          {{ t('github.generate') }}
        </button>
      </div>
    </form>
    <p id="set-github-hint" class="mt-1.5 px-3 text-2xs leading-relaxed text-ink-faint">{{ t('github.hint') }}</p>
  </section>
</template>
