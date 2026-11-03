<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleArrowUp, Circle, CircleAlert, CircleCheck, CircleDashed, CircleDot, Download, ExternalLink, FolderSync, Info, KeyRound, LoaderCircle, LogOut, RefreshCw } from 'lucide-vue-next'
import { autoSyncAfterLogin, setupSteps } from '../../lib/deepseekGate'
import { desktop, type DeepSeekEvent, type DeepSeekResult, type DeepSeekSyncResult, type DeepSeekUpdateCheck } from '../../lib/desktop'
import { now, relativeTime } from '../../lib/format'
import { useDeepSeekStore } from '../../stores/deepseek'
import ToggleSwitch from '../ToggleSwitch.vue'
import SettingSection from './SettingSection.vue'

const KEYS_URL = 'https://platform.deepseek.com/api_keys'

const { t, locale } = useI18n()
const ds = useDeepSeekStore()
const status = computed(() => ds.status)
const loading = ref(false)
const installing = ref(false)
const progress = ref<DeepSeekEvent | null>(null)
const installMsg = ref<string | null>(null)
const key = ref('')
const saving = ref(false)
const keyMsg = ref<{ ok: boolean; text: string } | null>(null)
const syncing = ref(false)
const syncResult = ref<DeepSeekSyncResult | null>(null)
const checking = ref(false)
const updateInfo = ref<DeepSeekUpdateCheck | null>(null)
const updated = ref(false)

const errorText = (res: DeepSeekResult): string => {
  const base = t(`deepseekSetup.error.${res.code ?? 'failed'}`)
  return res.detail && res.code === 'failed' ? `${base} ${res.detail}` : base
}

async function refresh(level: 'cache' | 'page' | 'cli' = 'cli'): Promise<void> {
  loading.value = true
  try {
    await ds.refresh(level)
  } finally {
    loading.value = false
  }
}

let off: (() => void) | undefined
onMounted(() => {
  off = desktop?.onDeepSeek?.((e) => (progress.value = e))
  void refresh('page')
})
onBeforeUnmount(() => {
  off?.()
  ds.notice = null
})

const installed = computed(() => !!status.value?.installed)
const steps = computed(() => setupSteps(status.value))
const allDone = computed(() => steps.value.every((s) => s.state === 'done'))
const pct = computed(() => (progress.value?.phase === 'download' ? progress.value.pct : null))
const progressText = computed(() => {
  const p = progress.value
  if (p?.phase === 'download') return p.totalMb ? t('deepseekSetup.downloading', { mb: p.mb, total: p.totalMb }) : t('deepseekSetup.downloadingOpen', { mb: p.mb })
  return status.value?.busy === 'update' || updating.value ? t('deepseekSetup.update.running') : t('deepseekSetup.installing')
})
const installHint = computed(() => t(`deepseekSetup.installHint.${status.value?.installRoute ?? 'none'}`))
const canInstall = computed(() => !!status.value && (status.value.needsDownload || !!status.value.installRoute))
const syncedText = computed(() => {
  const at = status.value?.syncedAt
  const ago = at ? relativeTime(at, locale.value, now.value) : null
  return ago ? t('deepseekSetup.syncedAt', { time: ago }) : null
})

const updating = ref(false)
async function runInstall(kind: 'install' | 'update'): Promise<void> {
  const call = kind === 'install' ? desktop?.deepseekInstall : desktop?.deepseekUpdate
  if (!call || installing.value) return
  installing.value = true
  updating.value = kind === 'update'
  installMsg.value = null
  progress.value = null
  try {
    const res = await call()
    if (!res.ok && res.code !== 'cancelled') installMsg.value = errorText(res)
    if (res.ok && kind === 'update') {
      updated.value = true
      updateInfo.value = null
    }
  } finally {
    installing.value = false
    updating.value = false
    progress.value = null
    await refresh('cli')
  }
}

async function checkUpdate(): Promise<void> {
  if (!desktop?.deepseekCheckUpdate || checking.value) return
  checking.value = true
  updated.value = false
  try {
    updateInfo.value = await desktop.deepseekCheckUpdate()
  } finally {
    checking.value = false
  }
}

async function saveKey(): Promise<void> {
  const value = key.value.trim()
  if (!desktop?.deepseekLogin || !value || saving.value) return
  saving.value = true
  keyMsg.value = null
  let ok = false
  try {
    const res = await desktop.deepseekLogin(value)
    ok = res.ok
    if (res.ok) key.value = ''
    keyMsg.value = res.ok ? { ok: true, text: t('deepseekSetup.saved') } : { ok: false, text: errorText(res) }
  } finally {
    saving.value = false
    await refresh('cli')
  }
  // First run: the copy from Claude is the last step; its native confirm still asks.
  if (ok && autoSyncAfterLogin(status.value)) await sync()
}

async function logout(): Promise<void> {
  if (!desktop?.deepseekLogout) return
  keyMsg.value = null
  const res = await desktop.deepseekLogout()
  if (res.ok) keyMsg.value = { ok: true, text: t('deepseekSetup.loggedOutDone') }
  else if (res.code !== 'cancelled') keyMsg.value = { ok: false, text: errorText(res) }
  await refresh('cli')
}

async function setTelemetry(on: boolean): Promise<void> {
  if (!desktop?.deepseekTelemetry) return
  await desktop.deepseekTelemetry(on)
  await refresh('cli')
}

async function sync(): Promise<void> {
  if (!desktop?.deepseekSync || syncing.value) return
  syncing.value = true
  try {
    const res = await desktop.deepseekSync()
    if (res.ok || res.code !== 'cancelled') syncResult.value = res
  } finally {
    syncing.value = false
    await refresh('page')
  }
}

const syncChanged = computed(() => syncResult.value?.files?.some((f) => f.action === 'create' || f.action === 'update') ?? false)
const stepIcon = { done: CircleCheck, next: CircleDot, todo: Circle } as const
</script>

<template>
  <div data-deepseek-settings>
    <p v-if="ds.notice" class="mb-3 flex items-start gap-2 rounded-inner bg-fill px-3 py-2 text-xs text-ink" role="status" data-deepseek-notice>
      <Info :size="14" class="mt-px shrink-0 text-accent-ink" aria-hidden="true" />
      <span class="min-w-0 flex-1">{{ t(`deepseekSetup.notice.${ds.notice}`) }}</span>
    </p>
    <p class="mb-3 px-3 text-2xs leading-relaxed text-ink-faint">{{ t('deepseekSetup.intro') }}</p>

    <SettingSection v-if="status && !allDone" id="deepseek-steps" :title="t('deepseekSetup.steps.title')">
      <ol class="py-1" data-deepseek-steps>
        <li v-for="(s, i) in steps" :key="s.id" class="flex min-w-0 items-center gap-3 px-3 py-1.5" :data-step="s.id" :data-step-state="s.state">
          <component
            :is="stepIcon[s.state]"
            :size="16"
            class="shrink-0"
            :class="s.state === 'done' ? 'text-success' : s.state === 'next' ? 'text-accent-ink' : 'text-ink-faint'"
            aria-hidden="true"
          />
          <span class="min-w-0 flex-1 text-sm" :class="s.state === 'todo' ? 'text-ink-muted' : 'text-ink'">{{ i + 1 }}. {{ t(`deepseekSetup.steps.${s.id}`) }}</span>
          <span class="shrink-0 text-2xs" :class="s.state === 'next' ? 'font-medium text-accent-ink' : 'text-ink-faint'">{{ t(`deepseekSetup.steps.state.${s.state}`) }}</span>
        </li>
      </ol>
    </SettingSection>

    <SettingSection id="deepseek-status" :title="t('deepseekSetup.status')">
      <div class="flex min-w-0 items-center gap-3 px-3 py-2" data-setting-row="dsStatus">
        <LoaderCircle v-if="!status && loading" :size="16" class="shrink-0 animate-spin text-ink-muted motion-reduce:animate-none" aria-hidden="true" />
        <CircleCheck v-else-if="installed" :size="16" class="shrink-0 text-success" aria-hidden="true" />
        <CircleAlert v-else-if="status?.needsDownload" :size="16" class="shrink-0 text-warning" aria-hidden="true" />
        <CircleDashed v-else :size="16" class="shrink-0 text-ink-muted" aria-hidden="true" />
        <div class="min-w-0 flex-1" role="status" data-deepseek-installed>
          <p class="truncate text-sm tabular-nums">
            {{
              !status
                ? t('deepseekSetup.checking')
                : installed
                  ? status.version
                    ? t('deepseekSetup.installed', { version: status.version })
                    : t('deepseekSetup.installedNoVersion')
                  : status.needsDownload
                    ? t('deepseekSetup.needsDownload')
                    : t('deepseekSetup.notInstalled')
            }}
          </p>
          <p class="mt-0.5 text-2xs text-ink-faint">{{ t('deepseekSetup.statusHint') }}</p>
        </div>
        <button
          type="button"
          class="ccm-btn-plain shrink-0"
          :disabled="loading || installing"
          :aria-label="t('deepseekSetup.refresh')"
          :title="t('deepseekSetup.refresh')"
          data-deepseek-refresh
          @click="refresh('cli')"
        >
          <RefreshCw :size="14" :class="loading ? 'animate-spin motion-reduce:animate-none' : ''" aria-hidden="true" />
        </button>
      </div>

      <div v-if="installed" class="flex min-w-0 items-center gap-3 px-3 py-2" data-deepseek-login-state>
        <CircleCheck v-if="status?.loggedIn" :size="16" class="shrink-0 text-success" aria-hidden="true" />
        <CircleAlert v-else-if="status?.loggedIn === false" :size="16" class="shrink-0 text-warning" aria-hidden="true" />
        <CircleDashed v-else :size="16" class="shrink-0 text-ink-muted" aria-hidden="true" />
        <p class="min-w-0 flex-1 text-sm">{{ t('deepseekSetup.loginState') }}</p>
        <span class="shrink-0 text-xs text-ink-muted">
          {{ status?.loggedIn ? t('deepseekSetup.loggedIn') : status?.loggedIn === false ? t('deepseekSetup.loggedOut') : t('deepseekSetup.loginUnknown') }}
        </span>
      </div>

      <div v-if="installed && !installing" class="flex min-w-0 items-center gap-3 px-3 py-2" data-setting-row="dsUpdate" data-deepseek-update>
        <CircleArrowUp v-if="updateInfo?.newer" :size="16" class="shrink-0 text-accent-ink" aria-hidden="true" />
        <CircleCheck v-else-if="updated || (updateInfo?.ok && !updateInfo.newer)" :size="16" class="shrink-0 text-success" aria-hidden="true" />
        <CircleAlert v-else-if="updateInfo && !updateInfo.ok" :size="16" class="shrink-0 text-st-error" aria-hidden="true" />
        <RefreshCw v-else :size="16" class="shrink-0 text-ink-muted" aria-hidden="true" />
        <p class="min-w-0 flex-1 truncate text-xs tabular-nums" :class="updateInfo && !updateInfo.ok ? 'text-st-error' : 'text-ink-muted'" role="status" data-deepseek-update-state>
          {{
            updated
              ? t('deepseekSetup.update.done')
              : updateInfo?.ok
                ? updateInfo.newer
                  ? t('deepseekSetup.update.available', { latest: updateInfo.latest, current: updateInfo.current })
                  : t('deepseekSetup.update.upToDate', { version: updateInfo.current })
                : updateInfo
                  ? errorText(updateInfo)
                  : ''
          }}
        </p>
        <button v-if="updateInfo?.newer" type="button" class="ccm-btn ccm-btn-primary shrink-0" data-deepseek-update-run @click="runInstall('update')">
          <Download :size="13" aria-hidden="true" />
          {{ t('deepseekSetup.update.run') }}
        </button>
        <button v-else type="button" class="ccm-btn shrink-0" :disabled="checking" :aria-busy="checking" data-deepseek-update-check @click="checkUpdate">
          <LoaderCircle v-if="checking" :size="13" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {{ checking ? t('deepseekSetup.update.checking') : t('deepseekSetup.update.check') }}
        </button>
      </div>

      <div v-if="status && (!installed || installing)" class="px-3 py-2" data-deepseek-install>
        <div v-if="installing" class="min-w-0">
          <div class="flex items-center gap-3">
            <p class="min-w-0 flex-1 truncate text-xs text-ink-muted tabular-nums" role="status" aria-live="polite">{{ progressText }}</p>
            <button type="button" class="ccm-btn-plain shrink-0 text-xs" data-deepseek-cancel @click="desktop?.deepseekCancel?.()">{{ t('deepseekSetup.cancel') }}</button>
          </div>
          <p v-if="progress?.phase === 'install'" class="mt-0.5 truncate font-mono text-2xs text-ink-faint" :title="progress.line">{{ progress.line }}</p>
          <div class="mt-1.5 h-1 overflow-hidden rounded-full bg-fill" role="progressbar" :aria-label="progressText" :aria-valuenow="pct ?? undefined" aria-valuemin="0" aria-valuemax="100">
            <div class="h-full rounded-full bg-accent transition-[width] duration-200" :class="pct === null ? 'w-1/3 animate-pulse motion-reduce:animate-none' : ''" :style="pct === null ? undefined : { width: `${pct}%` }" />
          </div>
        </div>
        <div v-else class="flex min-w-0 items-center gap-3">
          <p class="min-w-0 flex-1 text-2xs leading-relaxed text-ink-faint">{{ status.needsDownload ? t('deepseekSetup.installHint.npm') : installHint }}</p>
          <button type="button" class="ccm-btn ccm-btn-primary shrink-0" :disabled="!canInstall" data-deepseek-install-run @click="runInstall('install')">
            <Download :size="13" aria-hidden="true" />
            {{ status.needsDownload ? t('deepseekSetup.download') : t('deepseekSetup.install') }}
          </button>
        </div>
      </div>
      <p v-if="installMsg" class="px-3 pb-2 text-2xs text-st-error" role="alert" data-deepseek-install-error>{{ installMsg }}</p>
    </SettingSection>

    <SettingSection v-if="installed" id="deepseek-account" :title="t('deepseekSetup.loginState')">
      <form class="flex flex-col gap-1.5 px-3 py-2.5" novalidate data-setting-row="dsKey" @submit.prevent="saveKey">
        <label for="set-deepseek-key" class="text-xs font-medium text-ink-muted">{{ t('deepseekSetup.apiKey') }}</label>
        <div class="flex min-w-0 items-center gap-2">
          <input
            id="set-deepseek-key"
            v-model="key"
            type="password"
            autocomplete="off"
            spellcheck="false"
            class="ccm-field h-8 min-w-0 flex-1 font-mono text-sm"
            :placeholder="t('deepseekSetup.apiKeyPlaceholder')"
            :disabled="saving"
            aria-describedby="set-deepseek-key-hint"
            data-deepseek-key
            @input="keyMsg = null"
          />
          <button type="submit" class="ccm-btn ccm-btn-primary shrink-0" :disabled="!key.trim() || saving" :aria-busy="saving" data-deepseek-save>
            <LoaderCircle v-if="saving" :size="13" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            <KeyRound v-else :size="13" aria-hidden="true" />
            {{ saving ? t('deepseekSetup.saving') : t('deepseekSetup.save') }}
          </button>
        </div>
        <p v-if="keyMsg" class="text-2xs" :class="keyMsg.ok ? 'text-success' : 'text-st-error'" :role="keyMsg.ok ? 'status' : 'alert'" data-deepseek-key-msg>{{ keyMsg.text }}</p>
        <p id="set-deepseek-key-hint" class="text-2xs leading-relaxed text-ink-faint">{{ t('deepseekSetup.apiKeyHint') }}</p>
        <button type="button" class="ccm-btn-plain self-start text-xs" @click="desktop?.openExternal?.(KEYS_URL)">
          <ExternalLink :size="12" aria-hidden="true" />
          {{ t('deepseekSetup.getKey') }}
        </button>
      </form>
      <div class="flex min-w-0 items-center gap-3 px-3 py-2" data-setting-row="dsLogout">
        <div class="min-w-0 flex-1">
          <p class="text-sm">{{ t('deepseekSetup.logout') }}</p>
          <p class="mt-0.5 text-2xs text-ink-faint">{{ t('deepseekSetup.logoutHint') }}</p>
        </div>
        <button type="button" class="ccm-btn ccm-btn-danger shrink-0" :disabled="!status?.loggedIn || saving" data-deepseek-logout @click="logout">
          <LogOut :size="13" aria-hidden="true" />
          {{ t('deepseekSetup.logout') }}
        </button>
      </div>
      <ToggleSwitch
        v-if="status?.telemetry !== null && status?.telemetry !== undefined"
        :model-value="status.telemetry"
        :label="t('deepseekSetup.telemetry')"
        :hint="t('deepseekSetup.telemetryHint')"
        class="px-3"
        data-setting-row="dsTelemetry"
        @update:model-value="setTelemetry"
      />
    </SettingSection>

    <SettingSection id="deepseek-sync" :title="t('deepseekSetup.sync')">
      <div v-if="status?.sync === 'stale'" class="flex min-w-0 items-center gap-2 px-3 py-2 text-xs text-ink" role="status" data-deepseek-stale>
        <CircleAlert :size="14" class="shrink-0 text-warning" aria-hidden="true" />
        <span class="min-w-0 flex-1">{{ t('deepseekSetup.stale') }}</span>
      </div>
      <div class="px-3 py-2" data-setting-row="dsSync">
        <div class="flex min-w-0 items-center gap-3">
          <div class="min-w-0 flex-1">
            <p class="text-2xs leading-relaxed text-ink-faint">{{ t('deepseekSetup.syncHint') }}</p>
            <p v-if="syncedText" class="mt-0.5 text-2xs text-ink-muted" data-deepseek-synced-at>{{ syncedText }}</p>
          </div>
          <button
            type="button"
            class="ccm-btn shrink-0"
            :class="status?.sync === 'stale' ? 'ccm-btn-primary' : ''"
            :disabled="syncing"
            :aria-busy="syncing"
            data-deepseek-sync
            @click="sync"
          >
            <LoaderCircle v-if="syncing" :size="13" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            <FolderSync v-else :size="13" aria-hidden="true" />
            {{ syncing ? t('deepseekSetup.syncing') : status?.sync === 'stale' ? t('deepseekSetup.syncUpdate') : t('deepseekSetup.syncAction') }}
          </button>
        </div>
        <div v-if="syncResult" class="mt-2" role="status" data-deepseek-sync-result>
          <p v-if="!syncResult.ok" class="text-2xs text-st-error" role="alert">{{ errorText(syncResult) }}</p>
          <template v-else>
            <p class="flex items-center gap-1.5 text-xs" :class="syncChanged ? 'text-success' : 'text-ink-muted'">
              <CircleCheck :size="13" class="shrink-0" aria-hidden="true" />
              {{ syncChanged ? t('deepseekSetup.syncDone') : t('deepseekSetup.syncNothing') }}
            </p>
            <ul class="mt-1 space-y-0.5">
              <li v-for="f in syncResult.files" :key="f.id" class="flex min-w-0 flex-wrap gap-x-2 text-2xs">
                <span class="w-24 shrink-0" :class="f.action === 'skip' ? 'text-ink-faint' : 'text-ink-muted'">{{ t(`deepseekSetup.fileAction.${f.action}`) }}</span>
                <span class="min-w-0 flex-1 truncate font-mono text-ink" :title="f.file">{{ f.file }}</span>
                <span v-if="f.reason" class="basis-full pl-26 text-ink-faint">{{ t(`deepseekSetup.skipReason.${f.reason}`) }}</span>
              </li>
            </ul>
            <p v-if="syncResult.mcpAdded?.length" class="mt-1 text-2xs text-ink-muted">{{ t('deepseekSetup.syncServers', { names: syncResult.mcpAdded.join(', ') }) }}</p>
          </template>
        </div>
      </div>
    </SettingSection>
  </div>
</template>
