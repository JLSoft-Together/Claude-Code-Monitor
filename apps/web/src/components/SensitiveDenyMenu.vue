<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderGit2, Laptop, UserRound } from 'lucide-vue-next'
import { DENY_SCOPES, type DenyScope } from '@ccm/shared'

/** Scope picker for "Block next time": the native confirm that follows shows the file and the exact diff. */
const props = defineProps<{ anchor: DOMRect; rules: string[]; trigger?: HTMLElement | null }>()
const emit = defineEmits<{ pick: [scope: DenyScope]; close: [] }>()

const { t } = useI18n()
const WIDTH = 300
const root = ref<HTMLElement | null>(null)
const icons = { project: FolderGit2, local: Laptop, user: UserRound } as const

const style = computed(() => {
  const left = Math.max(12, Math.min(props.anchor.left, window.innerWidth - WIDTH - 12))
  const below = props.anchor.bottom + 6
  const top = below + 260 > window.innerHeight ? Math.max(12, props.anchor.top - 266) : below
  return { left: `${left}px`, top: `${top}px`, width: `${WIDTH}px`, '--ccm-origin': 'top left' }
})

const items = (): HTMLElement[] => [...(root.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]

function close(refocus = true): void {
  emit('close')
  if (refocus) props.trigger?.focus()
}

function choose(scope: DenyScope): void {
  emit('pick', scope)
  close(false)
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    return close()
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
  e.preventDefault()
  const list = items()
  const at = list.indexOf(document.activeElement as HTMLElement)
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length
  list[next]?.focus()
}

function onOutside(e: PointerEvent): void {
  const target = e.target as Node
  if (!root.value?.contains(target) && !props.trigger?.contains(target)) close(false)
}

onMounted(async () => {
  document.addEventListener('pointerdown', onOutside, true)
  await nextTick()
  items()[0]?.focus()
})
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside, true))

const rowClass =
  'group flex w-full cursor-pointer items-start gap-2.5 rounded-inner px-2 py-1.5 text-left text-sm text-ink hover:bg-fill focus-visible:bg-accent focus-visible:text-on-accent focus-visible:outline-none'
const hintClass = 'block text-2xs text-ink-faint group-focus-visible:text-on-accent'
</script>

<template>
  <Teleport to="body">
    <div ref="root" class="ccm-menu ccm-pop fixed z-50 flex flex-col p-1" :style="style" role="menu" :aria-label="t('sensitive.deny.menu')" data-sensitive-deny-menu @keydown="onKey">
      <div class="px-2 pt-1 pb-1.5">
        <p class="text-2xs text-ink-muted">{{ t('sensitive.deny.rules', rules.length) }}</p>
        <ul class="mt-1 space-y-0.5" data-sensitive-deny-rules>
          <li v-for="r in rules" :key="r" class="truncate font-mono text-2xs text-ink" :title="r">{{ r }}</li>
        </ul>
      </div>
      <div class="mx-2 mb-1 border-t border-line" aria-hidden="true" />
      <button v-for="scope in DENY_SCOPES" :key="scope" type="button" role="menuitem" :class="rowClass" :data-sensitive-deny-scope="scope" @click="choose(scope)">
        <component :is="icons[scope]" :size="15" class="mt-0.5 shrink-0" aria-hidden="true" />
        <span class="min-w-0 flex-1">
          <span class="block">{{ t(`sensitive.deny.scope.${scope}`) }}</span>
          <span :class="[hintClass, 'font-mono']">{{ t(`sensitive.deny.file.${scope}`) }}</span>
          <span :class="hintClass">{{ t(`sensitive.deny.hint.${scope}`) }}</span>
        </span>
      </button>
    </div>
  </Teleport>
</template>
