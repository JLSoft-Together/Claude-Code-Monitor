import { describe, expect, it } from 'vitest'
import { Hourglass, MessageCircleQuestion, ShieldQuestion } from 'lucide-vue-next'
import { waitDisplay } from './wait'

const t = (k: string, p?: Record<string, unknown>) => (p?.tool ? `${k}:${p.tool}` : k)

describe('waitDisplay', () => {
  it('returns null without waitingFor', () => {
    expect(waitDisplay(undefined, undefined, t)).toBeNull()
  })

  it('uses the open tool for permission waits', () => {
    expect(waitDisplay('permission prompt', 'Bash', t)).toEqual({ reason: 'permission', icon: ShieldQuestion, text: 'wait.permissionTool:Bash' })
    expect(waitDisplay('permission prompt', undefined, t)?.text).toBe('wait.permission')
  })

  it('shows plan approval for ExitPlanMode', () => {
    expect(waitDisplay('permission prompt', 'ExitPlanMode', t)?.text).toBe('wait.plan')
  })

  it('labels questions and keeps other text verbatim', () => {
    expect(waitDisplay('input needed', undefined, t)).toEqual({ reason: 'question', icon: MessageCircleQuestion, text: 'wait.question' })
    expect(waitDisplay('foo', 'Bash', t)).toEqual({ reason: 'other', icon: Hourglass, text: 'foo' })
  })
})
