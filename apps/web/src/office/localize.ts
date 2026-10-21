import { tr } from '@ccm/habblaud/shared/i18n'
import { SPECIAL, describeTool, describeWaitingFor } from '@ccm/habblaud/shared/activity'
import type { Activity, ActivityKind, AgentInfo, OfficeSnapshot } from '@ccm/habblaud/shared/types'

export interface OfficeColors {
  claude: string
  codex: string
}

const KIND_TEXT: Partial<Record<ActivityKind, () => string>> = {
  think: () => SPECIAL.think().text,
  respond: () => SPECIAL.respond().text,
  done: () => SPECIAL.turnDone().text,
  error: () => SPECIAL.error().text,
  compact: () => SPECIAL.compact().text,
  wait: () => SPECIAL.waiting().text,
}

function localizeActivity(a: Activity): Activity {
  const text = a.tool ? describeTool(a.tool, undefined).text : (KIND_TEXT[a.kind]?.() ?? a.text)
  return { ...a, text }
}

function localizeAgent(a: AgentInfo): AgentInfo {
  const out: AgentInfo = { ...a, recent: a.recent.map(localizeActivity) }
  if (a.role === 'main') out.role = tr('Agente principal')
  if (a.activity) out.activity = localizeActivity(a.activity)
  if (a.waitingFor !== undefined) out.waitingFor = describeWaitingFor(a.waitingFor)
  if (a.shells) out.shells = a.shells.map((s) => (s.label === '' ? { ...s, label: tr('Shell em segundo plano') } : { ...s }))
  return out
}

/** Pure: turns the collector's raw snapshot into one whose texts follow the active Habblaud locale. */
export function localizeSnapshot(s: OfficeSnapshot, colors: OfficeColors): OfficeSnapshot {
  return {
    ...s,
    agents: s.agents.map(localizeAgent),
    accounts: s.accounts.map((acc) => ({ ...acc, color: (acc.provider ?? 'claude') === 'codex' ? colors.codex : colors.claude })),
  }
}
