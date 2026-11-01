import type { AgentDataProgress, AgentDataResult, AgentDataSize, AgentDataState, CleanRequest, DataAgent } from '@ccm/shared'
import { desktop } from './desktop'

interface AgentDataBridge {
  agentDataState?: () => Promise<AgentDataState | null>
  agentDataScan?: () => Promise<AgentDataSize[] | null>
  agentDataCancel?: () => Promise<boolean>
  agentDataClean?: (req: CleanRequest) => Promise<AgentDataResult>
  agentDataStrip?: (req: { minDays: number }) => Promise<AgentDataResult>
  agentDataMove?: (agent: DataAgent) => Promise<AgentDataResult>
  agentDataUndo?: (agent: DataAgent) => Promise<AgentDataResult>
  agentDataDeleteOriginal?: (agent: DataAgent) => Promise<AgentDataResult>
  agentDataDiscard?: (agent: DataAgent) => Promise<AgentDataResult>
  onAgentData?: (handler: (p: AgentDataProgress) => void) => () => void
}
const bridge = desktop as unknown as AgentDataBridge | undefined

export const hasAgentData = typeof bridge?.agentDataState === 'function'

const failed: AgentDataResult = { ok: false, error: 'failed' }
const quiet = <T>(p: Promise<T> | undefined, fallback: T): Promise<T> => (p ? p.catch(() => fallback) : Promise.resolve(fallback))

export const agentDataState = (): Promise<AgentDataState | null> => quiet(bridge?.agentDataState?.(), null)
export const agentDataScan = (): Promise<AgentDataSize[] | null> => quiet(bridge?.agentDataScan?.(), null)
export const agentDataCancel = (): Promise<boolean> => quiet(bridge?.agentDataCancel?.(), false)
export const agentDataClean = (req: CleanRequest): Promise<AgentDataResult> => quiet(bridge?.agentDataClean?.(req), failed)
export const agentDataStrip = (minDays: number): Promise<AgentDataResult> => quiet(bridge?.agentDataStrip?.({ minDays }), failed)
export const agentDataMove = (agent: DataAgent): Promise<AgentDataResult> => quiet(bridge?.agentDataMove?.(agent), failed)
export const agentDataUndo = (agent: DataAgent): Promise<AgentDataResult> => quiet(bridge?.agentDataUndo?.(agent), failed)
export const agentDataDeleteOriginal = (agent: DataAgent): Promise<AgentDataResult> => quiet(bridge?.agentDataDeleteOriginal?.(agent), failed)
export const agentDataDiscard = (agent: DataAgent): Promise<AgentDataResult> => quiet(bridge?.agentDataDiscard?.(agent), failed)
export const onAgentData = (handler: (p: AgentDataProgress) => void): (() => void) => bridge?.onAgentData?.(handler) ?? (() => undefined)

