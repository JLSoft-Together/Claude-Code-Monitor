// Mod do Habblaud (Claude Code 2.1.287+): liga cada sessão ao escritório sem ler a conversa.
//
// Faz três coisas pequenas, e `claude plugin validate` lista exatamente o que o módulo chama (a saída
// está no mod/README.md):
//
// 1. Uso do plano (substitui o tap de statusline): em `session.start` e a cada `session.measure`
//    (depois de cada turno e quando um limite anda um ponto inteiro) grava
//    <HABBLAUD_USAGE_DIR ou ~/.habblaud/usage>/<conta>.json no MESMO formato do scripts/statusline-tap.mjs
//    ({accountId, configDir, fetchedAt, five_hour, seven_day}, `resets_at` em segundos) mais
//    `source: "mod"`. O servidor lê esses arquivos em server/accounts/statusline.ts.
// 2. Uma linha embaixo do prompt quando OUTRA sessão precisa de você: a cada 5 s pergunta ao Habblaud
//    local (GET /api/mod/summary, que já tira da lista esta sessão e os subagentes dela). Fora do ar, a
//    linha some e as perguntas passam a ser a cada 30 s até ele voltar. Só onde a sessão desenha
//    (`$.session.surfaces()` vazia = `claude -p`/SDK: nada a mostrar, nada a perguntar).
// 3. /habblaud: resumo do escritório, respondido pelo próprio mod (não chama o modelo, não gasta uso).
//
// Regras: nenhum hook lança (um hook que lança é pulado, mas o que ele deixou pela metade fica): cada
// passo tem seu try/catch e falha = silêncio. Nada de $.process, $.model, $.prompt, decisão de
// ferramenta nem leitura da conversa; a rede é só 127.0.0.1. O estado fica em variáveis do módulo: um
// hot reload recomeça do zero, o que aqui custa no máximo uma regravação a mais do arquivo de uso.
//
// Análise estática do Claude Code: cada chamada é escrita por extenso ($.noun.método), o nome do evento é
// sempre uma string literal e `$` só é passado para funções declaradas no topo deste arquivo.
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

/** Porta padrão do Habblaud (a mesma do servidor, do hook de permissão e do docker-compose). */
export const DEFAULT_PORT = 4747
/** Intervalo das perguntas ao Habblaud; fora do ar, recua para o segundo até ele voltar. */
export const POLL_MS = 5_000
export const OFFLINE_POLL_MS = 30_000
/** Quanto esperar o Habblaud local responder (`$.http.fetch` não aceita AbortSignal: a corrida é com um timer). */
export const FETCH_TIMEOUT_MS = 2_000
/** Valores idênticos gravados há menos que isto não são regravados (a mesma regra do tap). */
export const MIN_REWRITE_MS = 10_000
/** Nomes na linha embaixo do prompt antes do "e mais N". */
const MAX_NAMES = 3

/** Uma janela no formato do tap: percentual 0–100 e reinício em SEGUNDOS desde a época. */
export interface UsageWindow {
  utilization: number
  resets_at?: number
}

/** O arquivo de uso: o formato do tap mais `source`, para saber quem gravou. */
export interface UsageRecord {
  accountId: string
  configDir: string
  fetchedAt: number
  five_hour?: UsageWindow
  seven_day?: UsageWindow
  source: 'mod'
}

/** Quem precisa de você, como GET /api/mod/summary devolve (sem demo e sem esta sessão). */
export interface WaitingAgent {
  id: string
  name: string
  room: string
  account: string
  waitingFor: string
  since?: number
  /** Há pedido de permissão para responder pelo escritório. */
  answerable: boolean
}

export interface Summary {
  version: string
  agents: number
  working: number
  waiting: WaitingAgent[]
}

/** Resultado de uma pergunta ao Habblaud: resposta, fora do ar ou uma versão antiga, sem a rota do mod. */
type Asked = { kind: 'ok'; summary: Summary } | { kind: 'offline' } | { kind: 'outdated' }

interface ModEnv {
  /** Config dir da conta e o id dela (basename), como o tap calcula; sem HOME (ou USERPROFILE) nem CLAUDE_CONFIG_DIR, ausentes. */
  configDir?: string
  accountId?: string
  /** Pasta do uso; ausente sem HOME (ou USERPROFILE) nem HABBLAUD_USAGE_DIR. */
  usageDir?: string
  port: number
}

// ---------------------------------------------------------------------------------------------
// Funções puras (testadas em tests/habblaud.test.ts)
// ---------------------------------------------------------------------------------------------

/**
 * Normaliza um caminho (barras repetidas, `.`, `..` e a barra do fim): o ambiente do mod não tem node:path.
 * Caminhos do Windows (com drive ou UNC) saem com `/`, que o Windows também aceita, e a letra do drive (`C:`) conta
 * como raiz: assim o servidor no Docker, que é Linux, ainda acha o nome da pasta da conta no configDir gravado. Nos
 * outros, `\` é parte do nome (Linux e macOS) e fica como está.
 */
export function normalizePath(p: string): string {
  const win = /^(?:[A-Za-z]:|\\\\)/.test(p)
  const slashed = win ? p.replace(/\\/g, '/') : p
  // Raiz: o drive, ou uma das duas barras do UNC (`\\nas\share` vira `//nas/share`, que precisa das duas).
  const drive = /^[A-Za-z]:(?=\/|$)/.exec(slashed)?.[0] ?? (win && slashed.startsWith('//') ? '/' : '')
  const rest = slashed.slice(drive.length)
  const abs = rest.startsWith('/')
  const out: string[] = []
  for (const seg of rest.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop()
      else if (!abs) out.push(seg)
      continue
    }
    out.push(seg)
  }
  const joined = out.join('/')
  return drive + (abs ? `/${joined}` : joined || (drive ? '' : '.'))
}

/** `~` no começo vira o HOME (como o tap faz com CLAUDE_CONFIG_DIR e HABBLAUD_USAGE_DIR). */
function expandHome(p: string, home: string | undefined): string {
  return home && /^~(?=[\\/]|$)/.test(p) ? home + p.slice(1) : p
}

/** Config dir da conta: o primeiro item de CLAUDE_CONFIG_DIR (com `~` expandido) ou ~/.claude. */
export function configDirOf(claudeConfigDir: string | undefined, home: string | undefined): string | undefined {
  const first = (claudeConfigDir ?? '').split(',')[0]?.trim() ?? ''
  if (first) return normalizePath(expandHome(first, home))
  return home ? normalizePath(`${home}/.claude`) : undefined
}

/** Id da conta = nome da pasta (AccountInfo.id do servidor, ex.: ".claude-conta2"). */
export function accountIdOf(configDir: string): string | undefined {
  const name = configDir.split('/').filter(Boolean).pop()
  return name && name !== '.' && name !== '..' ? name : undefined
}

export function usageDirOf(habblaudUsageDir: string | undefined, home: string | undefined): string | undefined {
  const d = (habblaudUsageDir ?? '').trim()
  if (d) return normalizePath(expandHome(d, home))
  return home ? normalizePath(`${home}/.habblaud/usage`) : undefined
}

export function portOf(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? '', 10)
  return Number.isInteger(n) && n > 0 && n < 65_536 ? n : DEFAULT_PORT
}

/**
 * Uma janela de `$.session.usage().rateLimits` no formato do tap. `percentUsed` vem de 0 a 100 (passa de
 * 100 só num spend limit estourado, que não gravamos); `resetsAt` vem em ISO 8601 e o tap grava SEGUNDOS.
 */
export function windowOf(rl: SessionRateLimit | undefined): UsageWindow | undefined {
  if (!rl || typeof rl.percentUsed !== 'number' || !Number.isFinite(rl.percentUsed)) return undefined
  const w: UsageWindow = { utilization: Math.min(100, Math.max(0, rl.percentUsed)) }
  const ms = typeof rl.resetsAt === 'string' ? Date.parse(rl.resetsAt) : Number.NaN
  if (Number.isFinite(ms)) w.resets_at = Math.round(ms / 1_000)
  return w
}

/**
 * O registro gravado, ou undefined sem janela utilizável (fora de uma assinatura, ou antes da primeira
 * resposta da API, `rateLimits` vem vazia). Só `five_hour` e `seven_day`: o `spend_limit` de um gateway
 * não é limite do plano.
 */
export function usageRecord(rateLimits: readonly SessionRateLimit[], configDir: string, now: number): UsageRecord | undefined {
  const accountId = accountIdOf(configDir)
  if (!accountId) return undefined
  const five = windowOf(rateLimits.find((r) => r.kind === 'five_hour'))
  const week = windowOf(rateLimits.find((r) => r.kind === 'seven_day'))
  if (!five && !week) return undefined
  const rec: UsageRecord = { accountId, configDir, fetchedAt: now, source: 'mod' }
  if (five) rec.five_hour = five
  if (week) rec.seven_day = week
  return rec
}

/** Texto numa linha só (nomes e salas vêm do servidor; uma quebra de linha estragaria a linha de status). */
function oneLine(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? oneLine(v) : undefined
}

function count(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0
}

/** Lê a resposta de GET /api/mod/summary; qualquer coisa fora do formato = undefined (vale "fora do ar"). */
export function parseSummary(text: string): Summary | undefined {
  let j: unknown
  try {
    j = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return undefined
  const r = j as Record<string, unknown>
  if (!Array.isArray(r.waiting)) return undefined
  const waiting: WaitingAgent[] = []
  for (const item of r.waiting) {
    if (!item || typeof item !== 'object') continue
    const w = item as Record<string, unknown>
    const name = str(w.name)
    if (!name) continue
    const agent: WaitingAgent = {
      id: str(w.id) ?? name,
      name,
      room: str(w.room) ?? '?',
      account: str(w.account) ?? '',
      waitingFor: str(w.waitingFor) ?? 'responder no terminal',
      answerable: w.answerable === true,
    }
    if (typeof w.since === 'number' && Number.isFinite(w.since)) agent.since = w.since
    waiting.push(agent)
  }
  return { version: str(r.version) ?? '?', agents: count(r.agents), working: count(r.working), waiting }
}

/** A linha embaixo do prompt: undefined quando ninguém (além desta sessão) precisa de você. */
export function statusText(waiting: readonly WaitingAgent[]): string | undefined {
  const first = waiting[0]
  if (!first) return undefined
  if (waiting.length === 1) return `🏢 ${first.name} precisa de você em ${first.room}`
  const shown = waiting.slice(0, MAX_NAMES).map((w) => `${w.name} (${w.room})`)
  const rest = waiting.length - shown.length
  return `🏢 ${waiting.length} precisam de você: ${shown.join(', ')}${rest > 0 ? ` e mais ${rest}` : ''}`
}

/** A resposta do /habblaud com o Habblaud no ar. */
export function summaryText(s: Summary, url: string): string {
  const agents = s.agents === 1 ? '1 agente' : `${s.agents} agentes`
  const waiting = s.waiting.length === 0 ? 'ninguém precisa de você' : s.waiting.length === 1 ? '1 precisa de você' : `${s.waiting.length} precisam de você`
  const lines = [`Habblaud ${s.version} em ${url}`, `${agents} · ${s.working} trabalhando · ${waiting}`]
  for (const w of s.waiting) lines.push(`✋ ${w.name} (${w.room}): ${w.waitingFor}${w.answerable ? ' · dá para responder pelo escritório' : ''}`)
  return lines.join('\n')
}

export function offlineText(url: string): string {
  return `O Habblaud não respondeu em ${url}. Para subir: npm run docker:up na pasta do Habblaud.`
}

export function outdatedText(url: string): string {
  return `O Habblaud em ${url} está numa versão sem a rota do mod. Para atualizar: git pull e npm run docker:up na pasta do Habblaud.`
}

// ---------------------------------------------------------------------------------------------
// Estado do módulo (some num hot reload) e o que fala com o Claude Code
// ---------------------------------------------------------------------------------------------

let env: ModEnv | undefined
/** Última gravação do arquivo de uso (chave = arquivo + valores), para não regravar o mesmo em menos de 10 s. */
let lastWrite: { key: string; at: number } | undefined
/** Texto da linha de status; null = ainda não mexemos nela nesta carga (a primeira chamada sempre passa). */
let lastStatus: string | undefined | null = null
let timer: { cancel: () => void } | undefined
let timerMs = 0
/** Uma pergunta por vez: um Habblaud lento não acumula perguntas. */
let polling = false

/** O ambiente da sessão, lido uma vez por carga (cada nome escrito por extenso, como a análise exige). */
async function readEnv($: EngineInterface): Promise<ModEnv> {
  if (env) return env
  // No Windows, HOME só existe se alguém o definir: vale o USERPROFILE (a mesma ordem do servidor, HOME e depois homedir()).
  const home = (await $.env.get('HOME'))?.trim() || (await $.env.get('USERPROFILE'))?.trim() || undefined
  const configDir = configDirOf(await $.env.get('CLAUDE_CONFIG_DIR'), home)
  const next: ModEnv = {
    port: portOf(await $.env.get('HABBLAUD_PORT')),
    usageDir: usageDirOf(await $.env.get('HABBLAUD_USAGE_DIR'), home),
  }
  if (configDir) {
    next.configDir = configDir
    const accountId = accountIdOf(configDir)
    if (accountId) next.accountId = accountId
  }
  env = next
  return next
}

/** Grava o uso desta conta (se houver janelas e algo mudou ou já passou o intervalo). Pode lançar: quem chama engole. */
async function writeUsage($: EngineInterface, rateLimits: readonly SessionRateLimit[]): Promise<void> {
  if (!rateLimits.length) return
  const e = await readEnv($)
  if (!e.configDir || !e.usageDir) return
  const now = await $.clock.now()
  const rec = usageRecord(rateLimits, e.configDir, now)
  if (!rec) return
  const file = `${e.usageDir}/${rec.accountId}.json`
  const key = JSON.stringify([file, rec.configDir, rec.five_hour, rec.seven_day])
  if (lastWrite && lastWrite.key === key && now - lastWrite.at >= 0 && now - lastWrite.at < MIN_REWRITE_MS) return
  // $.fs.write cria a pasta se faltar e NÃO é atômico: o leitor do servidor ignora uma leitura pela
  // metade e fica com o último registro bom (server/accounts/statusline.ts).
  await $.fs.write(file, `${JSON.stringify(rec)}\n`)
  lastWrite = { key, at: now }
}

/** GET /api/mod/summary com prazo de 2 s; nunca lança. */
async function askHabblaud($: EngineInterface, port: number, query: string): Promise<Asked> {
  let wait: { cancel: () => void } | undefined
  const timeout = new Promise<undefined>((resolve) => {
    wait = $.clock.after(FETCH_TIMEOUT_MS, () => resolve(undefined))
  })
  try {
    const res = await Promise.race([$.http.fetch(`http://127.0.0.1:${port}/api/mod/summary${query}`, { headers: { accept: 'application/json' } }), timeout])
    if (!res) return { kind: 'offline' }
    // 404 JSON = um Habblaud de antes do mod (rota desconhecida); outro 404 qualquer = não é o Habblaud.
    if (res.status === 404 && res.text.includes('rota desconhecida')) return { kind: 'outdated' }
    const summary = res.ok ? parseSummary(res.text) : undefined
    return summary ? { kind: 'ok', summary } : { kind: 'offline' }
  } catch {
    return { kind: 'offline' }
  } finally {
    wait?.cancel()
  }
}

/** Troca a linha de status só quando o texto muda. */
function setStatus($: EngineInterface, text: string | undefined): void {
  if (text === lastStatus) return
  lastStatus = text
  $.ui.status(text)
}

/** (Re)agenda as perguntas: 5 s com o Habblaud no ar, 30 s fora do ar. */
function schedule($: EngineInterface, ms: number): void {
  if (timer && timerMs === ms) return
  timer?.cancel()
  timerMs = ms
  timer = $.clock.every(ms, () => {
    void poll($)
  })
}

/** Uma rodada do aviso embaixo do prompt. Nunca lança. */
async function poll($: EngineInterface): Promise<void> {
  if (polling) return
  polling = true
  try {
    const surfaces = await $.session.surfaces()
    if (!surfaces.length) {
      setStatus($, undefined)
      return
    }
    const e = await readEnv($)
    const params = new URLSearchParams()
    if (e.accountId) params.set('account', e.accountId)
    params.set('session', await $.session.id())
    const asked = await askHabblaud($, e.port, `?${params.toString()}`)
    if (asked.kind !== 'ok') {
      setStatus($, undefined)
      schedule($, OFFLINE_POLL_MS)
      return
    }
    schedule($, POLL_MS)
    setStatus($, statusText(asked.summary.waiting))
  } catch {
    // silêncio: a próxima rodada tenta de novo
  } finally {
    polling = false
  }
}

/** O texto do /habblaud: o escritório inteiro (sem filtrar esta sessão, para os números baterem com a tela). */
async function habblaudText($: EngineInterface): Promise<string> {
  const e = await readEnv($)
  const url = `http://localhost:${e.port}`
  const asked = await askHabblaud($, e.port, '')
  if (asked.kind === 'outdated') return outdatedText(url)
  if (asked.kind === 'offline') return offlineText(url)
  return summaryText(asked.summary, url)
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'habblaud', description: 'Resumo do Habblaud: quantos agentes, quem trabalha e quem precisa de você' })
    } catch {
      // sem o comando, o resto segue
    }
    try {
      const usage = await $.session.usage()
      await writeUsage($, usage.rateLimits)
    } catch {
      // falha ao gravar = silêncio (o Habblaud continua com o último número que tinha)
    }
    try {
      schedule($, POLL_MS)
    } catch {
      // sem o aviso embaixo do prompt, o resto segue
    }
    return next(e)
  })

  // Depois de cada turno e quando um limite anda um ponto. `e` traz os mesmos números de
  // `$.session.usage()` naquele instante, então não há por que perguntar de novo.
  on('session.measure', async ($, e, next) => {
    try {
      await writeUsage($, e.rateLimits)
    } catch {
      // falha ao gravar = silêncio
    }
    return next(e)
  })

  on('command.run', { command: 'habblaud' }, async ($) => {
    try {
      return { text: await habblaudText($) }
    } catch {
      return { text: offlineText(`http://localhost:${env?.port ?? DEFAULT_PORT}`) }
    }
  })
}
