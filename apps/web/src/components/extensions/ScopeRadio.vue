<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleAlert } from 'lucide-vue-next'
import type { ExtScope } from '@ccm/shared'

const props = defineProps<{ projectMode: boolean; secret: boolean; name: string }>()
const model = defineModel<ExtScope>({ required: true })
const { t } = useI18n()

const scopes = computed<ExtScope[]>(() => (props.projectMode ? ['user', 'project', 'local'] : ['user']))
const label = (s: ExtScope): string => t(s === 'user' ? 'ext.sheet.scopeUser' : s === 'project' ? 'ext.sheet.scopeProject' : 'ext.sheet.scopeLocal')
</script>

<template>
  <fieldset class="flex flex-col gap-1.5">
    <legend class="mb-1.5 text-xs font-medium">{{ t('ext.sheet.scope') }}</legend>
    <label v-for="s in scopes" :key="s" class="flex cursor-pointer items-start gap-2.5 rounded-inner px-2.5 py-2 hover:bg-fill has-checked:bg-accent-soft">
      <input v-model="model" type="radio" :name="name" :value="s" class="mt-0.5 accent-accent" :data-ext-scope="s" />
      <span class="min-w-0">
        <span class="block text-sm" :class="{ 'text-accent-ink': model === s }">{{ label(s) }}</span>
        <span class="block text-2xs leading-relaxed text-ink-faint">{{ t(`ext.sheet.scopeHelp.${s}`) }}</span>
      </span>
    </label>
    <p v-if="!projectMode" class="text-2xs leading-relaxed text-ink-faint">{{ t('ext.sheet.noProject') }}</p>
    <p v-if="model === 'project' && secret" class="flex items-start gap-1 text-2xs leading-relaxed text-warning">
      <CircleAlert :size="12" class="mt-0.5 shrink-0" aria-hidden="true" />{{ t('ext.sheet.secretShared') }}
    </p>
  </fieldset>
</template>
