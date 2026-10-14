<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowUpRight, Globe } from 'lucide-vue-next'
import { devUrlLabel } from '../../lib/devServer'

/** `urls` newest last; the chip shows the newest and counts the rest. */
const props = defineProps<{ urls: readonly string[] }>()
const emit = defineEmits<{ open: [url: string] }>()

const { t } = useI18n()
const url = computed(() => props.urls[props.urls.length - 1] ?? '')
const host = computed(() => devUrlLabel(url.value))
const more = computed(() => props.urls.length - 1)
</script>

<template>
  <Transition name="ccm-fade" appear>
    <button
      v-if="url"
      type="button"
      class="ccm-press inline-flex h-6 min-w-0 max-w-full shrink cursor-pointer items-center gap-1 rounded-full bg-fill px-2 text-2xs font-medium text-ink transition-colors duration-(--ccm-dur-fast) hover:bg-fill-strong"
      :title="more > 0 ? `${t('workspace.devServer.open', { host: url })}\n${t('workspace.devServer.more', { n: more })}` : t('workspace.devServer.open', { host: url })"
      :aria-label="t('workspace.devServer.open', { host })"
      @click="emit('open', url)"
    >
      <Globe :size="12" class="shrink-0 text-agent-browser" aria-hidden="true" />
      <span class="min-w-0 truncate tabular">{{ host }}</span>
      <span v-if="more > 0" class="shrink-0 tabular text-ink-muted" aria-hidden="true">+{{ more }}</span>
      <ArrowUpRight :size="12" class="shrink-0 text-ink-muted" aria-hidden="true" />
    </button>
  </Transition>
</template>
