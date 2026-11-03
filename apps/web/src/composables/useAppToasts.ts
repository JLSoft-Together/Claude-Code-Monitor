import { onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { BREAK_MINUTES, breakAnchor, nextBreakAt } from '../lib/breaks'
import { now } from '../lib/format'
import { hasPhone, onPhone } from '../lib/phone'
import { useExtrasStore } from '../stores/extras'
import { useSettingsStore } from '../stores/settings'
import { useToastsStore } from '../stores/toasts'
import { useUiStore } from '../stores/ui'

const BREAK_ID = 'break'
const PHONE_ID = 'phone-fail'

// Break reminder and failed phone sends reach the shared stack from here, so App.vue only mounts the host.
export function useAppToasts(): void {
  const { t, locale } = useI18n()
  const toasts = useToastsStore()
  const ui = useUiStore()
  const extras = useExtrasStore()
  const settings = useSettingsStore()

  function showBreak(minutes: number): void {
    const clock = new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit', hour12: false })
    const anchor = breakAnchor(extras.dayStartedAt, now.value)
    const worked = minutes >= 60 ? t('breaks.hm', { h: Math.floor(minutes / 60), m: minutes % 60 }) : t('breaks.m', { m: minutes })
    const done = () => toasts.dismiss(BREAK_ID, 'close')
    toasts.push({
      id: BREAK_ID,
      kind: 'break',
      title: t('breaks.title'),
      text: t('breaks.body', { n: BREAK_MINUTES }),
      detail: anchor === null ? undefined : t('breaks.since', { since: clock.format(anchor), worked }),
      meta: anchor === null ? undefined : t('breaks.next', { at: clock.format(nextBreakAt(anchor, now.value)) }),
      art: 'break',
      timeoutMs: 0,
      actions: [
        {
          label: t('breaks.off'),
          run: () => {
            settings.breakReminder = false
            done()
          },
        },
        { label: t('breaks.done'), run: done, primary: true },
      ],
      onDismiss: () => {
        ui.breakDue = null
      },
    })
  }

  watch(
    () => ui.breakDue,
    (due) => (due ? showBreak(due.minutes) : toasts.remove(BREAK_ID)),
    { immediate: true },
  )

  if (!hasPhone) return
  // Desktop main reports only the first failure of a run of failed sends, so one toast per run.
  const off = onPhone((e) => {
    if (!('failed' in e)) return
    toasts.push({
      id: PHONE_ID,
      kind: 'phoneFail',
      title: t('phone.failTitle'),
      text: t(`phone.error.${e.failed}`),
      timeoutMs: 0,
      attrs: { 'data-phone-fail': '' },
      actions: [
        {
          label: t('phone.openSettings'),
          run: () => {
            toasts.dismiss(PHONE_ID, 'close')
            ui.settingsPage = 'notify'
            ui.settingsOpen = true
          },
        },
      ],
    })
  })
  onBeforeUnmount(off)
}
