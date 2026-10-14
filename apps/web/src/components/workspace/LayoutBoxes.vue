<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { boxRect, shortClass, type LayoutViewNode } from '../../lib/layoutPreview'

const props = defineProps<{ nodes: readonly LayoutViewNode[]; scale: number; hovered: LayoutViewNode | null; selected: LayoutViewNode | null }>()
const { t } = useI18n()

function boxStyle(n: LayoutViewNode): Record<string, string> {
  const r = boxRect(n.bounds, props.scale)
  return { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` }
}

function nodeLabel(n: LayoutViewNode): string {
  const cls = shortClass(n.class)
  return n.xmlId ? t('layout.view.id', { cls, id: n.xmlId.replace(/^@\+?id\//, '#') }) : t('layout.view.label', { cls })
}
</script>

<template>
  <div v-for="(n, i) in nodes" :key="i" class="bp pointer-events-none absolute" :style="boxStyle(n)">
    <span v-if="(n.bounds[2] - n.bounds[0]) * scale > 60" class="bp-label">{{ shortClass(n.class) }}</span>
  </div>
  <div v-if="hovered && hovered !== selected" class="hover-box pointer-events-none absolute" :style="boxStyle(hovered)">
    <span class="box-label" :class="hovered.bounds[1] * scale < 18 ? 'is-inside' : ''">{{ nodeLabel(hovered) }}</span>
  </div>
  <div v-if="selected" class="sel-box pointer-events-none absolute" :style="boxStyle(selected)">
    <span class="box-label" :class="selected.bounds[1] * scale < 18 ? 'is-inside' : ''">{{ nodeLabel(selected) }}</span>
  </div>
</template>

<style scoped>
.bp {
  border: 1px solid color-mix(in srgb, var(--ccm-well-ink) 45%, transparent);
}
.bp-label {
  position: absolute;
  left: 2px;
  top: 1px;
  max-width: calc(100% - 4px);
  overflow: hidden;
  font-size: 10px;
  line-height: 1.2;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: color-mix(in srgb, var(--ccm-well-ink) 80%, transparent);
}
.hover-box {
  outline: 1px dashed var(--ccm-focus);
  outline-offset: -1px;
  background: color-mix(in srgb, var(--ccm-focus) 8%, transparent);
}
.sel-box {
  outline: 2px solid var(--ccm-focus);
  outline-offset: -2px;
  background: color-mix(in srgb, var(--ccm-focus) 12%, transparent);
}
.box-label {
  position: absolute;
  left: -2px;
  bottom: 100%;
  margin-bottom: 2px;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 1.35;
  white-space: nowrap;
  color: var(--ccm-on-accent);
  background: var(--ccm-accent);
}
.box-label.is-inside {
  bottom: auto;
  top: 2px;
  left: 2px;
}
</style>
