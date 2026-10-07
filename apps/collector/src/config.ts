import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface CollectorConfig {
  claudeRoot: string
  host: string
  port: number
  staleTtlMs: number
  reconcileMs: number
  processVerifyMs: number
  activityLimit: number
  batchMs: number
  verifyProcesses: boolean
  webDist: string
}

function intFromEnv(value: string | undefined, fallback: number): number {
  const n = value === undefined ? NaN : Number.parseInt(value, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CollectorConfig {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return {
    claudeRoot: env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
    host: '127.0.0.1',
    port: intFromEnv(env.CCM_PORT, 4317),
    staleTtlMs: intFromEnv(env.CCM_STALE_TTL_MIN, 120) * 60_000,
    reconcileMs: 5_000,
    processVerifyMs: 60_000,
    activityLimit: 300,
    batchMs: 50,
    verifyProcesses: process.platform === 'win32' && env.CCM_VERIFY_PROCESSES !== '0',
    webDist: env.CCM_WEB_DIST || path.resolve(here, '../../web/dist'),
  }
}
