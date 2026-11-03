import { nextTick, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const LIVE_MS = 10_000
type LiveItem = { from: string; to: string; n: number }

/** Screen-reader line for peer messages: the first is said at once, the rest are merged per pair every LIVE_MS. */
export function useLiveAnnounce(nameOf: (terminalId: string) => string) {
  const { t } = useI18n()
  const liveText = ref('')
  const liveBuffer = new Map<string, LiveItem>()
  let liveTimer = 0

  function say(items: LiveItem[]): void {
    const text = items.map((x) => t('peer.live', { from: nameOf(x.from), to: nameOf(x.to), n: x.n }, x.n)).join(' · ')
    liveText.value = ''
    void nextTick(() => (liveText.value = text))
  }
  function flushLive(): void {
    liveTimer = 0
    if (!liveBuffer.size) return
    const items = [...liveBuffer.values()]
    liveBuffer.clear()
    say(items)
    liveTimer = window.setTimeout(flushLive, LIVE_MS)
  }
  function announce(from: string, to: string, n: number): void {
    if (!liveTimer) {
      say([{ from, to, n }])
      liveTimer = window.setTimeout(flushLive, LIVE_MS)
      return
    }
    const key = `${from}>${to}`
    const cur = liveBuffer.get(key)
    if (cur) cur.n += n
    else liveBuffer.set(key, { from, to, n })
  }

  onBeforeUnmount(() => window.clearTimeout(liveTimer))

  return { liveText, announce }
}
