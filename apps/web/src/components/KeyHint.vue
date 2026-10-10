<script setup lang="ts">
import { useSettingsStore } from '../stores/settings'

defineProps<{ keys: string }>()
const settings = useSettingsStore()
</script>

<template>
  <kbd
    v-if="settings.keyHints"
    aria-hidden="true"
    class="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded border border-b-2 border-line-strong bg-raised px-1 font-sans text-[11px] leading-none font-medium text-ink-muted"
  >{{ keys }}</kbd>
</template>
