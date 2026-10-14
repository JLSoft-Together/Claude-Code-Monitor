<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderLock } from 'lucide-vue-next'
import { baseName, dirOf, requestAccess } from '../../lib/preview'

/** Denied path → one click asks the desktop (native yes/no); never shown or asked without the user clicking. */
const props = withDefaults(defineProps<{ path: string; compact?: boolean; well?: boolean }>(), { compact: false, well: false })
const emit = defineEmits<{ granted: [] }>()

const { t } = useI18n()
const busy = ref(false)
const refused = ref(false)

// The desktop grants the folder (a directory path is its own folder); a dotted last segment reads as a file.
const folder = computed(() => (/\.[^.\\/]+$/.test(baseName(props.path)) ? dirOf(props.path) : props.path))

async function allow(): Promise<void> {
  busy.value = true
  refused.value = false
  const ok = await requestAccess(props.path)
  busy.value = false
  if (ok) emit('granted')
  else refused.value = true
}
</script>

<template>
  <span v-if="compact" class="inline-flex min-w-0 items-center gap-2">
    <button type="button" class="ccm-btn-plain shrink-0 text-xs text-accent-ink" :disabled="busy" :title="folder" data-allow-access @click="allow">
      <FolderLock :size="13" aria-hidden="true" />
      <span>{{ t('workspace.access.allow', { folder: baseName(folder) }) }}</span>
    </button>
    <span v-if="refused" class="truncate text-ink-muted" role="status">{{ t('workspace.access.refused') }}</span>
  </span>
  <div v-else class="flex flex-col items-center gap-2">
    <p class="max-w-xs text-xs" :class="well ? 'text-well-ink' : 'text-ink-muted'">{{ t('workspace.access.denied') }}</p>
    <button type="button" class="ccm-btn ccm-btn-primary mt-1 max-w-full" :disabled="busy" :title="folder" data-allow-access @click="allow">
      <FolderLock :size="14" class="shrink-0" aria-hidden="true" />
      <span class="truncate">{{ t('workspace.access.allow', { folder: baseName(folder) }) }}</span>
    </button>
    <p v-if="refused" class="text-xs" :class="well ? 'text-well-ink' : 'text-ink-muted'" role="status">{{ t('workspace.access.refused') }}</p>
  </div>
</template>
