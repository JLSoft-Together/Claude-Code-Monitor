<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { desktop, type RunSdkKey } from '../lib/desktop'
import { useRunStore } from '../stores/run'

/** Settings › Run: SDK / JDK folders for the Run pane (desktop with `hasRun`). Read when the panel opens. */
const props = defineProps<{ open: boolean }>()

const { t } = useI18n()
const run = useRunStore()
const failed = ref(false)
type SdkKind = RunSdkKey
const KINDS: SdkKind[] = ['flutterSdk', 'androidSdk', 'jdk']

watch(
  () => props.open,
  (open) => {
    if (open) void run.loadSettings()
  },
  { immediate: true },
)

async function choose(kind: SdkKind): Promise<void> {
  const dir = await desktop?.pickFolder(run.settings?.[kind] ?? undefined)
  if (dir) await set(kind, dir)
}

async function set(kind: SdkKind, value: string | null): Promise<void> {
  failed.value = !(await run.updateSettings({ [kind]: value }))
}
</script>

<template>
  <section aria-labelledby="set-run" class="mt-6" data-run-settings>
    <h3 id="set-run" class="mb-1.5 px-3 text-2xs font-semibold text-ink-muted">{{ t('run.sdk.section') }}</h3>
    <div class="ccm-group divide-y divide-line overflow-hidden">
      <div v-for="kind in KINDS" :key="kind" class="flex min-w-0 items-center gap-2 px-3 py-2" :data-run-sdk="kind">
        <div class="min-w-0 flex-1">
          <p class="text-sm text-ink">{{ t(`run.sdk.${kind}`) }}</p>
          <p class="mt-0.5 truncate font-mono text-2xs" :class="run.settings?.[kind] ? 'text-ink-muted' : 'text-ink-faint'" :title="run.settings?.[kind] ?? undefined">
            {{ run.settings?.[kind] ?? t('run.sdk.auto') }}
          </p>
        </div>
        <button type="button" class="ccm-btn shrink-0" :aria-label="t('run.sdk.chooseFor', { name: t(`run.sdk.${kind}`) })" @click="choose(kind)">{{ t('run.sdk.choose') }}</button>
        <button
          v-if="run.settings?.[kind]"
          type="button"
          class="ccm-btn-plain shrink-0 text-xs"
          :aria-label="t('run.sdk.resetFor', { name: t(`run.sdk.${kind}`) })"
          :title="t('run.sdk.resetFor', { name: t(`run.sdk.${kind}`) })"
          @click="set(kind, null)"
        >
          {{ t('run.sdk.reset') }}
        </button>
      </div>
    </div>
    <p class="mt-1.5 px-3 text-2xs leading-relaxed text-ink-faint">{{ t('run.sdk.hint') }}</p>
    <p v-if="failed" class="mt-1 px-3 text-2xs text-st-error" role="alert">{{ t('run.sdk.failed') }}</p>
  </section>
</template>
