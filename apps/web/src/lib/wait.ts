import type { Component } from 'vue'
import { Hourglass, MessageCircleQuestion, ShieldQuestion } from 'lucide-vue-next'
import { waitReason, type WaitReason } from '@ccm/shared'

export interface WaitDisplay {
  reason: WaitReason
  icon: Component
  text: string
}

type Translate = (key: string, params?: Record<string, unknown>) => string

export function waitDisplay(waitingFor: string | undefined, tool: string | undefined, t: Translate): WaitDisplay | null {
  if (!waitingFor) return null
  const reason = waitReason(waitingFor)
  if (reason === 'permission') {
    const text = tool === 'ExitPlanMode' ? t('wait.plan') : tool ? t('wait.permissionTool', { tool }) : t('wait.permission')
    return { reason, icon: ShieldQuestion, text }
  }
  if (reason === 'question') return { reason, icon: MessageCircleQuestion, text: t('wait.question') }
  return { reason, icon: Hourglass, text: waitingFor }
}
