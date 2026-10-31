<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, X } from 'lucide-vue-next'
import { SENSITIVE_GROUPS, MAX_SENSITIVE_GLOBS, type SensitiveGroup } from '@ccm/shared'
import { folderName, ruleText } from '../lib/sensitive'
import { useConnectionStore } from '../stores/connection'
import { useSensitiveStore } from '../stores/sensitive'
import ToggleSwitch from './ToggleSwitch.vue'

/** Settings › Sensitive watch (v76 R5): rule groups, own globs, per-project ignore list. Stored by the collector. */
const { t } = useI18n()
const connection = useConnectionStore()
const sensitive = useSensitiveStore()

const offline = computed(() => connection.state !== 'connected')
const failed = ref(false)
const draft = ref('')
const cfg = computed(() => sensitive.settings)
const ignored = computed(() =>
  Object.entries(cfg.value.ignore).flatMap(([project, rules]) => rules.map((rule) => ({ project, rule, key: `${project}|${rule}` }))),
)

const sent = (ok: boolean): void => {
  failed.value = !ok
}

function setGroup(g: SensitiveGroup, on: boolean): void {
  sent(connection.updateSensitive({ groups: { [g]: on } }))
}

function addGlob(): void {
  const glob = draft.value.trim()
  if (!glob || cfg.value.globs.includes(glob)) return
  sent(connection.updateSensitive({ globs: [...cfg.value.globs, glob] }))
  draft.value = ''
}

const removeGlob = (glob: string): void => sent(connection.updateSensitive({ globs: cfg.value.globs.filter((g) => g !== glob) }))
const unignore = (project: string, rule: string): void => sent(connection.ignoreSensitive(project, rule, false))
</script>

<template>
  <section aria-labelledby="set-sensitive" class="mt-6" data-sensitive-settings>
    <h3 id="set-sensitive" class="mb-1.5 px-3 text-2xs font-semibold text-ink-muted">{{ t('sensitive.section') }}</h3>
    <div class="ccm-group" role="group" :aria-label="t('sensitive.section')">
      <ToggleSwitch
        v-for="g in SENSITIVE_GROUPS"
        :key="g"
        :model-value="cfg.groups[g]"
        :label="t(`sensitive.groups.${g}`)"
        :disabled="offline"
        class="px-3"
        :data-sensitive-group="g"
        @update:model-value="(on: boolean) => setGroup(g, on)"
      />
    </div>
    <p class="mt-1.5 px-3 text-2xs leading-relaxed text-ink-faint">{{ t('sensitive.hint') }}</p>

    <p class="mt-4 mb-1.5 px-3 text-2xs text-ink-faint">{{ t('sensitive.globs') }}</p>
    <div class="ccm-group divide-y divide-line overflow-hidden">
      <form class="flex min-w-0 items-center gap-2 px-3 py-2" @submit.prevent="addGlob">
        <input
          v-model="draft"
          type="text"
          spellcheck="false"
          maxlength="200"
          :placeholder="t('sensitive.globPlaceholder')"
          :aria-label="t('sensitive.addFor')"
          :disabled="offline || !cfg.groups.custom || cfg.globs.length >= MAX_SENSITIVE_GLOBS"
          class="ccm-field min-w-0 flex-1 font-mono text-xs"
          data-sensitive-glob-input
        />
        <button type="submit" class="ccm-btn shrink-0" :disabled="offline || !draft.trim()" :aria-label="t('sensitive.addFor')" data-sensitive-glob-add>
          <Plus :size="13" aria-hidden="true" />{{ t('sensitive.add') }}
        </button>
      </form>
      <div v-for="g in cfg.globs" :key="g" class="flex min-w-0 items-center gap-2 px-3 py-1.5" data-sensitive-glob>
        <span class="min-w-0 flex-1 truncate font-mono text-xs" :title="g">{{ g }}</span>
        <button type="button" class="ccm-btn-plain size-7 shrink-0" :aria-label="t('sensitive.remove', { glob: g })" :title="t('sensitive.remove', { glob: g })" @click="removeGlob(g)">
          <X :size="13" aria-hidden="true" />
        </button>
      </div>
    </div>
    <p class="mt-1.5 px-3 text-2xs leading-relaxed text-ink-faint">{{ t('sensitive.globsHint') }}</p>

    <p class="mt-4 mb-1.5 px-3 text-2xs text-ink-faint">{{ t('sensitive.ignoreList') }}</p>
    <div class="ccm-group divide-y divide-line overflow-hidden">
      <p v-if="!ignored.length" class="px-3 py-2 text-xs text-ink-faint">{{ t('sensitive.ignoreEmpty') }}</p>
      <div v-for="i in ignored" :key="i.key" class="flex min-w-0 items-center gap-2 px-3 py-1.5" data-sensitive-ignored>
        <div class="min-w-0 flex-1">
          <p class="truncate text-xs text-ink">{{ ruleText(i.rule, t) }}</p>
          <p class="truncate font-mono text-2xs text-ink-faint" :title="i.project">{{ folderName(i.project) }}</p>
        </div>
        <button
          type="button"
          class="ccm-btn-plain size-7 shrink-0"
          :disabled="offline"
          :aria-label="t('sensitive.unignore', { rule: ruleText(i.rule, t), project: folderName(i.project) })"
          :title="t('sensitive.unignore', { rule: ruleText(i.rule, t), project: folderName(i.project) })"
          @click="unignore(i.project, i.rule)"
        >
          <X :size="13" aria-hidden="true" />
        </button>
      </div>
    </div>
    <p v-if="failed" class="mt-1 px-3 text-2xs text-st-error" role="alert">{{ t('sensitive.failed') }}</p>
  </section>
</template>
