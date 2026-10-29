<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleAlert, CircleCheck, Download, FolderX, KeyRound, LoaderCircle, Upload, X } from 'lucide-vue-next'
import type { BackupErrorCode, BackupPreview, BackupSectionId } from '@ccm/shared'
import { backupBridge, readReminder, toggleSection, TOKEN_REMINDER_KEY, writeLocal } from '../lib/backup'

/** Settings › Backup (v74): export the setup to one JSON file, import one with a per-section preview. */
const { t, locale } = useI18n()

type Ready = Extract<BackupPreview, { ok: true }>
const busy = ref<'export' | 'pick' | 'apply' | null>(null)
const exported = ref<string | null>(null)
const preview = ref<Ready | null>(null)
const selected = ref<Set<BackupSectionId>>(new Set())
const error = ref<BackupErrorCode | null>(null)
const restartPending = ref(false)
const reminder = ref<string[]>(readReminder())

const meta = computed(() => {
  const p = preview.value
  if (!p) return ''
  const d = new Date(p.createdAt)
  return t('backup.previewMeta', { app: p.app || '?', platform: p.platform || '?', date: Number.isNaN(d.getTime()) ? '?' : d.toLocaleString(locale.value) })
})

function fail(code: BackupErrorCode): void {
  if (code !== 'cancelled') error.value = code
}

async function doExport(): Promise<void> {
  if (!backupBridge || busy.value) return
  busy.value = 'export'
  error.value = null
  exported.value = null
  try {
    const r = await backupBridge.export()
    if (r.ok) exported.value = r.file
    else fail(r.error)
  } finally {
    busy.value = null
  }
}

async function pick(): Promise<void> {
  if (!backupBridge || busy.value) return
  busy.value = 'pick'
  error.value = null
  restartPending.value = false
  try {
    const r = await backupBridge.pick()
    if (!r.ok) return fail(r.error)
    preview.value = r
    selected.value = new Set(r.sections.map((s) => s.id))
  } finally {
    busy.value = null
  }
}

async function apply(): Promise<void> {
  const p = preview.value
  if (!backupBridge || !p || busy.value || !selected.value.size) return
  busy.value = 'apply'
  error.value = null
  try {
    const r = await backupBridge.apply(p.token, [...selected.value])
    if (!r.ok) {
      if (r.error === 'expired') preview.value = null
      return fail(r.error)
    }
    writeLocal(r.local)
    try {
      if (r.github.length) localStorage.setItem(TOKEN_REMINDER_KEY, JSON.stringify(r.github))
    } catch {
      // the import itself is done
    }
    preview.value = null
    if (r.github.length) reminder.value = r.github
    restartPending.value = true
    await backupBridge.relaunch()
  } finally {
    busy.value = null
  }
}

function dismissReminder(): void {
  reminder.value = []
  try {
    localStorage.removeItem(TOKEN_REMINDER_KEY)
  } catch {
    // nothing kept
  }
}
</script>

<template>
  <section aria-labelledby="set-backup" class="mt-6" data-backup-settings>
    <h3 id="set-backup" class="mb-1.5 px-3 text-2xs font-semibold text-ink-muted">{{ t('backup.section') }}</h3>
    <div class="ccm-group overflow-hidden">
      <div class="px-3 py-2">
        <p class="text-xs leading-relaxed text-ink-muted">{{ t('backup.hint') }}</p>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" class="ccm-btn" :disabled="!!busy" :aria-busy="busy === 'export'" data-backup-export @click="doExport">
            <LoaderCircle v-if="busy === 'export'" :size="13" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            <Download v-else :size="13" aria-hidden="true" />
            {{ busy === 'export' ? t('backup.exporting') : t('backup.export') }}
          </button>
          <button type="button" class="ccm-btn" :disabled="!!busy" :aria-busy="busy === 'pick'" data-backup-import @click="pick">
            <LoaderCircle v-if="busy === 'pick'" :size="13" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            <Upload v-else :size="13" aria-hidden="true" />
            {{ busy === 'pick' ? t('backup.reading') : t('backup.import') }}
          </button>
        </div>
      </div>

      <p v-if="exported" class="flex min-w-0 items-start gap-2 px-3 py-2 text-xs" role="status" data-backup-exported>
        <CircleCheck :size="14" class="mt-px shrink-0 text-success" aria-hidden="true" />
        <span class="min-w-0 flex-1 break-all text-ink">{{ t('backup.exported', { file: exported }) }}</span>
      </p>
      <p v-if="error" class="flex min-w-0 items-start gap-2 px-3 py-2 text-xs" role="alert" data-backup-error>
        <CircleAlert :size="14" class="mt-px shrink-0 text-st-error" aria-hidden="true" />
        <span class="min-w-0 flex-1 text-ink">{{ t(`backup.error.${error}`) }}</span>
      </p>
      <p v-if="restartPending" class="flex min-w-0 items-start gap-2 px-3 py-2 text-xs" role="status" data-backup-restart>
        <CircleCheck :size="14" class="mt-px shrink-0 text-success" aria-hidden="true" />
        <span class="min-w-0 flex-1 text-ink">{{ t('backup.restartPending') }}</span>
      </p>
      <div v-if="reminder.length" class="flex min-w-0 items-start gap-2 bg-warning-soft px-3 py-2 text-xs" role="status" data-backup-reminder>
        <KeyRound :size="14" class="mt-px shrink-0 text-warning" aria-hidden="true" />
        <span class="min-w-0 flex-1 text-ink">{{ t('backup.tokenReminder', { logins: reminder.join(', ') }) }}</span>
        <button type="button" class="ccm-btn-plain -my-1 shrink-0" :aria-label="t('backup.dismiss')" :title="t('backup.dismiss')" @click="dismissReminder">
          <X :size="13" aria-hidden="true" />
        </button>
      </div>

      <div v-if="preview" class="px-3 py-2" data-backup-preview>
        <p class="truncate text-sm font-medium text-ink" :title="preview.file">{{ t('backup.previewTitle', { file: preview.file }) }}</p>
        <p class="mt-0.5 text-2xs text-ink-faint">{{ meta }}</p>
        <p class="mt-2 text-2xs font-medium text-ink-muted">{{ t('backup.pick') }}</p>
        <ul class="mt-1 flex flex-col gap-0.5">
          <li v-for="s in preview.sections" :key="s.id" :data-backup-section="s.id">
            <label class="flex min-h-8 cursor-pointer items-start gap-2 rounded-control px-1 py-1 hover:bg-fill">
              <input
                type="checkbox"
                class="mt-0.5 size-4 shrink-0 cursor-pointer accent-accent"
                :checked="selected.has(s.id)"
                @change="selected = toggleSection(selected, s.id)"
              />
              <span class="min-w-0 flex-1">
                <span class="block text-sm text-ink">{{ t(`backup.sectionName.${s.id}`) }}</span>
                <span class="block text-2xs text-ink-faint">{{ t('backup.items', { n: s.count }, s.count) }}</span>
                <span v-if="s.missingPaths.length" class="mt-0.5 flex items-start gap-1 text-2xs text-warning" data-backup-missing>
                  <FolderX :size="12" class="mt-px shrink-0" aria-hidden="true" />
                  <span class="min-w-0">
                    {{ t('backup.missing', { n: s.missingPaths.length }, s.missingPaths.length) }}
                    <span class="block truncate font-mono text-ink-muted" :title="s.missingPaths.join('\n')">{{ s.missingPaths.slice(0, 3).join(', ') }}</span>
                  </span>
                </span>
              </span>
            </label>
          </li>
        </ul>
        <p v-if="preview.sections.some((s) => s.missingPaths.length)" class="mt-1 text-2xs text-ink-faint">{{ t('backup.missingHint') }}</p>
        <p v-if="preview.github.length && selected.has('github')" class="mt-2 flex items-start gap-1.5 text-2xs text-ink-muted" data-backup-github>
          <KeyRound :size="12" class="mt-px shrink-0" aria-hidden="true" />
          <span class="min-w-0">{{ t('backup.github', { logins: preview.github.join(', ') }) }}</span>
        </p>
        <div class="mt-2 flex flex-wrap items-center justify-end gap-2">
          <button type="button" class="ccm-btn-plain text-xs" :disabled="busy === 'apply'" @click="preview = null">{{ t('backup.cancel') }}</button>
          <button type="button" class="ccm-btn ccm-btn-primary" :disabled="!selected.size || !!busy" :aria-busy="busy === 'apply'" data-backup-apply @click="apply">
            <LoaderCircle v-if="busy === 'apply'" :size="13" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {{ busy === 'apply' ? t('backup.applying') : t('backup.apply') }}
          </button>
        </div>
      </div>
    </div>
    <p class="mt-1.5 px-3 text-2xs leading-relaxed text-ink-faint">{{ t('backup.autoHint') }}</p>
  </section>
</template>
