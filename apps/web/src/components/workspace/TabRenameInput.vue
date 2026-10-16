<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useInlineEdit } from '../../composables/useInlineEdit'
import { TAB_NAME_MAX, useWorkspaceStore } from '../../stores/workspace'

const props = defineProps<{ tabKey: string; initial: string }>()
const emit = defineEmits<{ done: [saved: boolean] }>()

const { t } = useI18n()
const workspace = useWorkspaceStore()
const { draft, input, start, commit, cancel } = useInlineEdit()
let finished = false

onMounted(() => void start(props.initial, true))

function finish(save: boolean): void {
  if (finished) return
  finished = true
  if (save && draft.value.trim() === props.initial.trim()) save = false
  if (save)
    commit((value) => {
      workspace.renameTab(props.tabKey, value)
      return true
    })
  else cancel()
  emit('done', save)
}
</script>

<template>
  <input
    ref="input"
    v-model="draft"
    type="text"
    :maxlength="TAB_NAME_MAX"
    :aria-label="t('workspace.tabName.label')"
    :title="t('workspace.tabName.hint')"
    :placeholder="t('workspace.tabName.hint')"
    class="ccm-field h-6 w-full min-w-[10ch] py-0! text-xs!"
    spellcheck="false"
    autocomplete="off"
    data-tab-rename
    @keydown.enter.prevent.stop="finish(true)"
    @keydown.esc.prevent.stop="finish(false)"
    @keydown.stop
    @click.stop
    @dblclick.stop
    @pointerdown.stop
    @contextmenu.stop
    @blur="finish(true)"
  />
</template>
