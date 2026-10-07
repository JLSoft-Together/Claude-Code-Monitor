import { ClipboardList, FilePen, ShieldAlert, ShieldCheck, Zap } from 'lucide-vue-next'

export interface ModeMeta {
  icon: typeof Zap
  cls: string
  labelKey: string | null
}

const KNOWN: Record<string, ModeMeta> = {
  bypassPermissions: { icon: ShieldAlert, cls: 'border-st-error/40 bg-st-error-soft text-st-error', labelKey: 'mode.bypassPermissions' },
  dontAsk: { icon: ShieldAlert, cls: 'border-st-waiting/40 bg-st-waiting-soft text-st-waiting', labelKey: 'mode.dontAsk' },
  auto: { icon: Zap, cls: 'border-line bg-raised text-ink-muted', labelKey: 'mode.auto' },
  acceptEdits: { icon: FilePen, cls: 'border-line bg-raised text-ink-muted', labelKey: 'mode.acceptEdits' },
  plan: { icon: ClipboardList, cls: 'border-accent/40 bg-accent-soft text-accent', labelKey: 'mode.plan' },
}

/** `default` is the normal ask-every-time mode and gets no badge; unknown values show raw. */
export function modeMeta(mode: string | undefined): ModeMeta | null {
  if (!mode || mode === 'default') return null
  return KNOWN[mode] ?? { icon: ShieldCheck, cls: 'border-line bg-raised text-ink-muted', labelKey: null }
}
