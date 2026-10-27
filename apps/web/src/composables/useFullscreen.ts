import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

export function useFullscreen(target: Ref<HTMLElement | null>) {
  const active = ref(false)

  function sync(): void {
    active.value = !!target.value && document.fullscreenElement === target.value
  }

  const supported = (): boolean => typeof target.value?.requestFullscreen === 'function'

  async function enter(): Promise<void> {
    const el = target.value
    if (!el || document.fullscreenElement === el || !supported()) return
    try {
      await el.requestFullscreen({ navigationUI: 'hide' })
    } catch {
      active.value = false
    }
    sync()
  }

  async function exit(): Promise<void> {
    if (!target.value || document.fullscreenElement !== target.value) return
    try {
      await document.exitFullscreen()
    } catch {
      active.value = true
    }
    sync()
  }

  function toggle(): Promise<void> {
    return active.value ? exit() : enter()
  }

  onMounted(() => {
    document.addEventListener('fullscreenchange', sync)
    sync()
  })
  onBeforeUnmount(() => {
    document.removeEventListener('fullscreenchange', sync)
    if (active.value) void exit()
    active.value = false
  })

  return { active, supported, enter, exit, toggle }
}
