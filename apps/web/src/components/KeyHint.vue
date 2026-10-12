<script setup lang="ts">
import { ref, watch } from 'vue'
import { reducedMotion } from '../lib/motion'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'

const props = defineProps<{ keys: string }>()
const settings = useSettingsStore()
const ui = useUiStore()
const kbd = ref<HTMLElement | null>(null)

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

watch(
  () => ui.keyPress,
  (k) => {
    const el = kbd.value
    if (k?.keys !== props.keys || !el || reducedMotion()) return
    const host = el.closest('button')
    // Hidden hint (H off) or a button in a closed panel: nothing on screen to answer the key.
    if (!host?.offsetParent) return
    const root = getComputedStyle(document.documentElement)
    const token = (name: string) => root.getPropertyValue(name).trim()
    if (el.offsetParent) {
      el.animate(
        [
          { transform: 'translateY(1px) scale(0.88)', borderBottomWidth: '1px', color: token('--ccm-accent') },
          { transform: 'none', borderBottomWidth: '2px' },
        ],
        { duration: 280, easing: EASE },
      )
    }
    const glow = token('--ccm-accent-soft')
    if (glow) host.animate([{ backgroundColor: glow }, {}], { duration: 420, easing: 'ease-out' })
  },
  { flush: 'post' },
)

// Badges sweep in left to right when hints are switched on.
function onEnter(el: Element): void {
  const left = el.getBoundingClientRect().left
  ;(el as HTMLElement).style.animationDelay = `${Math.round(Math.max(0, Math.min(1, left / window.innerWidth)) * 220)}ms`
}
</script>

<template>
  <Transition name="ccm-kbd" @enter="onEnter">
    <kbd
      v-show="settings.keyHints"
      ref="kbd"
      aria-hidden="true"
      class="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded border border-b-2 border-line-strong bg-raised px-1 font-sans text-[11px] leading-none font-medium text-ink-muted"
    >{{ keys }}</kbd>
  </Transition>
</template>
