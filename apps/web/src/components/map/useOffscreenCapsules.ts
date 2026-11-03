import { computed, onBeforeUnmount, ref, type Component, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowDownLeft, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUp, ArrowUpLeft, ArrowUpRight } from 'lucide-vue-next'
import type { GraphNode } from '@vue-flow/core'
import { MAIN_HEIGHT, MAIN_WIDTH, type Point } from '../../lib/layout'

const CAPSULE_MS = 6000
const CAPSULE_MAX = 3
const SCREEN_MARGIN = 16
type Capsule = { key: number; from: string; to: string; node: string }

const ARROWS: Record<string, Component> = {
  '-1,-1': ArrowUpLeft,
  '0,-1': ArrowUp,
  '1,-1': ArrowUpRight,
  '-1,0': ArrowLeft,
  '1,0': ArrowRight,
  '-1,1': ArrowDownLeft,
  '0,1': ArrowDown,
  '1,1': ArrowDownRight,
}

export interface CapsuleDeps {
  findNode: (id: string) => GraphNode | undefined
  viewport: Ref<{ x: number; y: number; zoom: number }>
  dimensions: Ref<{ width: number; height: number }>
  mainNodeOf: (terminalId: string) => string | null
  nameOf: (terminalId: string) => string
  keepClear: number
}

/** Edge-of-canvas hints for a message that landed on a card currently outside the view. */
export function useOffscreenCapsules(deps: CapsuleDeps) {
  const { findNode, viewport, dimensions, mainNodeOf, nameOf, keepClear } = deps
  const { t } = useI18n()
  const capsules = ref<Capsule[]>([])
  const capsuleTimers = new Map<number, number>()
  let capsuleSeq = 0

  function screenCenter(id: string): Point | null {
    const n = findNode(id)
    if (!n) return null
    const { x, y, zoom } = viewport.value
    return {
      x: (n.computedPosition.x + (n.dimensions.width || MAIN_WIDTH) / 2) * zoom + x,
      y: (n.computedPosition.y + (n.dimensions.height || MAIN_HEIGHT) / 2) * zoom + y,
    }
  }

  function onScreen(p: Point): boolean {
    const { width, height } = dimensions.value
    if (!width || !height) return true
    return p.x >= SCREEN_MARGIN && p.x <= width - SCREEN_MARGIN && p.y >= keepClear && p.y <= height - SCREEN_MARGIN
  }

  function dismissCapsule(key: number): void {
    window.clearTimeout(capsuleTimers.get(key))
    capsuleTimers.delete(key)
    capsules.value = capsules.value.filter((c) => c.key !== key)
  }

  function dismissCapsulesTo(terminalId: string): void {
    for (const c of capsules.value) if (c.to === terminalId) dismissCapsule(c.key)
  }

  function offerCapsule(from: string, to: string, node: string): void {
    const at = screenCenter(node)
    if (!at || onScreen(at)) return
    const fromNode = mainNodeOf(from)
    const fromAt = fromNode ? screenCenter(fromNode) : null
    if (fromAt && !onScreen(fromAt)) return
    dismissCapsulesTo(to)
    const key = ++capsuleSeq
    capsules.value = [...capsules.value, { key, from, to, node }].slice(-CAPSULE_MAX)
    capsuleTimers.set(
      key,
      window.setTimeout(() => dismissCapsule(key), CAPSULE_MS),
    )
  }

  const capsuleViews = computed(() => {
    const { width, height } = dimensions.value
    return capsules.value.flatMap((c) => {
      const at = screenCenter(c.node)
      if (!at || onScreen(at)) return []
      const dx = at.x < SCREEN_MARGIN ? -1 : at.x > width - SCREEN_MARGIN ? 1 : 0
      const dy = at.y < keepClear ? -1 : at.y > height - SCREEN_MARGIN ? 1 : 0
      const left = dx < 0 ? 12 : dx > 0 ? width - 12 : Math.min(Math.max(at.x, width * 0.2), width * 0.8)
      const top = dy < 0 ? keepClear : dy > 0 ? height - 12 : Math.min(Math.max(at.y, keepClear + 16), height - 28)
      const tx = dx < 0 ? '0' : dx > 0 ? '-100%' : '-50%'
      const ty = dy < 0 ? '0' : dy > 0 ? '-100%' : '-50%'
      return [
        {
          key: c.key,
          to: c.to,
          icon: ARROWS[`${dx},${dy}`] ?? ArrowUp,
          text: t('peer.received', { name: nameOf(c.from) }),
          label: t('peerMap.capsuleLabel', { from: nameOf(c.from), to: nameOf(c.to) }),
          style: { left: `${left}px`, top: `${top}px`, transform: `translate(${tx}, ${ty})` },
        },
      ]
    })
  })

  onBeforeUnmount(() => {
    for (const timer of capsuleTimers.values()) window.clearTimeout(timer)
  })

  return { capsuleViews, dismissCapsule, dismissCapsulesTo, offerCapsule }
}
