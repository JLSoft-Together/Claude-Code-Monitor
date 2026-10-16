import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultDataDir } from './datadir'

export interface CollectorConfig {
  claudeRoot: string
  codexHome: string
  codex: boolean
  host: string
  port: number
  staleTtlMs: number
  peerTtlMs?: number
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
  toastBackend: 'powershell' | 'electron' | null
  /** Set by the desktop app: every request but /health must carry it. */
  appKey: string | null
  /** `npm run dev` (Vite UI work): no key, the page opens in a browser. */
  dev: boolean
  /** Base for toast click links; the desktop app registers agent-monitor://. */
  toastLink: string | null
}

function intFromEnv(value: string | undefined, fallback: number): number {
  const n = value === undefined ? NaN : Number.parseInt(value, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

// The desktop bundle is CJS without import.meta, so repo-relative fallbacks resolve only when the env var is missing.
const fromHere = (rel: string): string => path.resolve(path.dirname(fileURLToPath(import.meta.url)), rel)

export function loadConfig(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, argv: readonly string[] = process.argv): CollectorConfig {
  const toastBackend = env.CCM_TOAST === '0' ? null : platform === 'win32' ? 'powershell' : env.CCM_TOAST_BACKEND === 'electron' ? 'electron' : null
  const statusLineBridge = env.CCM_STATUSLINE_BRIDGE || fromHere('../../../scripts/statusline-bridge.mjs')
  return {
    claudeRoot: env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
    codexHome: env.CODEX_HOME || path.join(os.homedir(), '.codex'),
    codex: env.CCM_CODEX !== '0',
    host: '127.0.0.1',
    port: intFromEnv(env.CCM_PORT, 4317),
    staleTtlMs: intFromEnv(env.CCM_STALE_TTL_MIN, 120) * 60_000,
    peerTtlMs: intFromEnv(env.CCM_PEER_TTL_MIN, 60) * 60_000,
    reconcileMs: 5_000,
    processVerifyMs: 60_000,
    activityLimit: 1000,
    batchMs: 50,
    verifyProcesses: ['win32', 'darwin', 'linux'].includes(process.platform) && env.CCM_VERIFY_PROCESSES !== '0',
    webDist: env.CCM_WEB_DIST || fromHere('../../web/dist'),
    statusLineBridge,
    statusLineCommand: env.CCM_STATUSLINE_COMMAND || `node "${statusLineBridge.replaceAll('\\', '/')}"`,
    devOriginPorts: [intFromEnv(env.CCM_DEV_ORIGIN_PORT, 5173)],
    toast: toastBackend !== null,
    toastBackend,
    dataDir: env.CCM_DATA_DIR || defaultDataDir(env, process.platform, os.homedir()),
    appKey: env.CCM_APP_KEY || null,
    dev: argv.includes('--dev'),
    toastLink: env.CCM_TOAST_LINK || null,
  }
}
