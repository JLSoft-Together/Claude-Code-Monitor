<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { BellRing, FolderPlus, LoaderCircle } from 'lucide-vue-next'
import { useOpenProject } from '../../../composables/useOpenProject'
import { useRail } from '../../../composables/useRail'
import { retireOverlay } from '../../../lib/motion'
import { avatarInitials } from '../../../lib/rail/avatars'
import type { RailCluster } from '../../../lib/rail/railModel'
import { useWorkspaceStore } from '../../../stores/workspace'
import WorkspaceSidebar from '../WorkspaceSidebar.vue'

// Sidebar listeners (scripts, run, close, …) arrive as attrs and go to the flyout's rail.
defineOptions({ inheritAttrs: false })

const { t } = useI18n()
const workspace = useWorkspaceStore()
const { clusters } = useRail()
const live = computed(() => clusters.value.filter((c) => c.live))
const { available: openable, picking, openProject } = useOpenProject()

const nameOf = (c: RailCluster): string => (c.key === 'home' ? t('workspace.side.home') : c.name)

const open = ref<{ key: string; top: number; left: number; trigger: HTMLElement } | null>(null)
const flyout = ref<HTMLElement | null>(null)

async function show(c: RailCluster, e: MouseEvent): Promise<void> {
  const trigger = e.currentTarget as HTMLElement
  if (open.value?.key === c.key) return close(false)
  const r = trigger.getBoundingClientRect()
  open.value = { key: c.key, top: Math.max(8, Math.min(r.top, window.innerHeight - 320)), left: r.right + 8, trigger }
  await nextTick()
  flyout.value?.querySelector<HTMLElement>('[data-side-row], [data-side-head]')?.focus()
}

function close(refocus: boolean): void {
  const trigger = open.value?.trigger
  open.value = null
  if (refocus) trigger?.focus()
}

function onOutside(e: PointerEvent): void {
  const target = e.target as Element
  // Menus the flyout opens are teleported too: clicks in them keep it open.
  if (flyout.value?.contains(target) || open.value?.trigger.contains(target) || target.closest?.('[role=menu], .ccm-menu')) return
  close(false)
}

watch(open, (v, before) => {
  if (v && !before) document.addEventListener('pointerdown', onOutside, true)
  if (!v) document.removeEventListener('pointerdown', onOutside, true)
})
watch(() => workspace.activeKey, () => close(false))
watch(
  () => live.value.some((c) => c.key === open.value?.key),
  (still) => {
    if (!still) close(false)
  },
)
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside, true))

function label(c: RailCluster): string {
  return c.needs ? `${nameOf(c)}, ${t('workspace.rail.needs', { n: c.needs }, c.needs)}` : nameOf(c)
}
</script>

<template>
  <nav class="ccm-material flex min-h-0 w-full flex-1 flex-col items-center gap-1.5 rounded-card py-2" :aria-label="t('workspace.rail.column')" data-rail-column>
    <button
      v-if="openable"
      type="button"
      class="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-control border border-dashed border-line text-ink-muted transition-colors duration-(--ccm-dur-fast) hover:bg-fill hover:text-ink disabled:cursor-default disabled:text-ink-faint"
      :title="t('workspace.rail.openProjectHint')"
      :aria-label="t('workspace.rail.openProject')"
      :disabled="picking"
      data-rail-open-project
      @click="openProject"
    >
      <LoaderCircle v-if="picking" :size="16" class="ccm-spin" aria-hidden="true" />
      <FolderPlus v-else :size="16" aria-hidden="true" />
    </button>
    <div class="ccm-scroll flex min-h-0 w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto pt-1">
    <button
      v-for="c in live"
      :key="c.key"
      type="button"
      class="relative inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-control text-xs font-semibold transition-colors duration-(--ccm-dur-fast)"
      :class="c.active ? 'bg-accent-soft text-accent-ink ring-1 ring-focus' : 'bg-fill text-ink-muted hover:bg-fill-strong hover:text-ink'"
      :title="[c.root ?? nameOf(c), c.needs ? t('workspace.rail.needs', { n: c.needs }, c.needs) : ''].filter(Boolean).join('\n')"
      :aria-label="label(c)"
      aria-haspopup="true"
      :aria-expanded="open?.key === c.key"
      :data-rail-avatar="c.key"
      @click="show(c, $event)"
    >
      {{ c.key === 'home' ? '~' : avatarInitials(c.name) }}
      <span v-if="c.needs" class="absolute -top-1 -right-1 inline-flex rounded-full bg-surface" aria-hidden="true">
        <span
          class="inline-flex h-4 min-w-4 items-center justify-center gap-px rounded-full px-0.5 text-2xs leading-none tabular"
          :class="c.failed ? 'bg-st-error-soft text-st-error' : 'bg-st-waiting-soft text-st-waiting'"
        >
          <BellRing :size="8" />{{ c.needs }}
        </span>
      </span>
    </button>
    </div>

    <Teleport to="body">
      <Transition name="ccm-menu" @before-leave="retireOverlay">
        <div
          v-if="open"
          ref="flyout"
          class="ccm-menu fixed z-40 flex max-h-[min(70vh,520px)] w-[272px] flex-col [--ccm-origin:top_left]"
          :style="{ top: `${open.top}px`, left: `${open.left}px` }"
          role="dialog"
          :aria-label="nameOf(live.find((c) => c.key === open!.key) ?? live[0]!)"
          data-rail-flyout
          @keydown.esc.stop="close(true)"
        >
          <WorkspaceSidebar v-bind="$attrs" :only="open.key" flat class="min-h-0 flex-1" />
        </div>
      </Transition>
    </Teleport>
  </nav>
</template>
