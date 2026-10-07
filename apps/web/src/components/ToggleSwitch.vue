<script setup lang="ts">
const props = defineProps<{ modelValue: boolean; label: string; hint?: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

function flip(): void {
  if (!props.disabled) emit('update:modelValue', !props.modelValue)
}
</script>

<template>
  <div class="flex items-start gap-3 py-2" :class="disabled ? 'opacity-50' : ''">
    <div class="min-w-0 flex-1">
      <p class="text-sm text-ink" @click="flip">{{ label }}</p>
      <p v-if="hint" class="mt-0.5 text-xs leading-relaxed text-ink-faint">{{ hint }}</p>
    </div>
    <button
      type="button"
      role="switch"
      :aria-checked="modelValue"
      :aria-label="label"
      :disabled="disabled"
      class="relative mt-0.5 inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-150 disabled:cursor-not-allowed"
      :class="modelValue ? 'border-accent bg-accent' : 'border-line-strong bg-raised'"
      @click="flip"
    >
      <span
        class="inline-block size-4.5 rounded-full shadow-sm transition-transform duration-150 ease-out motion-reduce:transition-none"
        :class="modelValue ? 'translate-x-[19px] bg-on-accent' : 'translate-x-[3px] bg-ink-faint'"
        aria-hidden="true"
      />
    </button>
  </div>
</template>
