<script setup lang="ts">
const props = defineProps<{ modelValue: boolean; label: string; hint?: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

function flip(): void {
  if (!props.disabled) emit('update:modelValue', !props.modelValue)
}
</script>

<template>
  <div class="flex items-center gap-3 py-2" :class="disabled ? 'opacity-50' : ''">
    <div class="min-w-0 flex-1">
      <p class="text-sm text-ink" @click="flip">{{ label }}</p>
      <p v-if="hint" class="mt-0.5 text-2xs text-ink-faint">{{ hint }}</p>
    </div>
    <button
      type="button"
      role="switch"
      :aria-checked="modelValue"
      :aria-label="label"
      :disabled="disabled"
      class="relative inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ease-out-quint disabled:cursor-not-allowed"
      :class="modelValue ? 'bg-accent' : 'bg-fill-strong'"
      @click="flip"
    >
      <span
        class="inline-block size-[18px] rounded-full bg-on-accent shadow-control transition-transform duration-200 ease-out-quint motion-reduce:transition-none"
        :class="modelValue ? 'translate-x-[18px]' : 'translate-x-[2px]'"
        aria-hidden="true"
      />
    </button>
  </div>
</template>
