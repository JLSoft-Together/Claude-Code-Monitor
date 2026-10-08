import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultDataDir } from './datadir'

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
  dataDir: string
  devOriginPorts: number[]
  statusLineBridge: string
  statusLineCommand: string
  toast: boolean
}

function intFromEnv(value: string | undefined, fallback: number): number {
  const n = value === undefined ? NaN : Number.parseInt(value, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

// The desktop bundle is CJS without import.meta, so repo-relative fallbacks resolve only when the env var is missing.
const fromHere = (rel: string): string => path.resolve(path.dirname(fileURLToPath(import.meta.url)), rel)

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CollectorConfig {
  const statusLineBridge = env.CCM_STATUSLINE_BRIDGE || fromHere('../../../scripts/statusline-bridge.mjs')
  return {
    claudeRoot: env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
    host: '127.0.0.1',
    port: intFromEnv(env.CCM_PORT, 4317),
    staleTtlMs: intFromEnv(env.CCM_STALE_TTL_MIN, 120) * 60_000,
    reconcileMs: 5_000,
    processVerifyMs: 60_000,
    activityLimit: 1000,
    batchMs: 50,
    verifyProcesses: ['win32', 'darwin', 'linux'].includes(process.platform) && env.CCM_VERIFY_PROCESSES !== '0',
    webDist: env.CCM_WEB_DIST || fromHere('../../web/dist'),
    statusLineBridge,
    statusLineCommand: env.CCM_STATUSLINE_COMMAND || `node "${statusLineBridge.replaceAll('\\', '/')}"`,
    devOriginPorts: [intFromEnv(env.CCM_DEV_ORIGIN_PORT, 5173)],
    toast: process.platform === 'win32' && env.CCM_TOAST !== '0',
    dataDir: env.CCM_DATA_DIR || defaultDataDir(env, process.platform, os.homedir()),
  }
}
