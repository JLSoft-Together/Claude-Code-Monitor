// Responder pelo escritório: registro dos pedidos de permissão pendentes.
//
// O hook PermissionRequest do Claude Code (mod/habblaud-permissoes/hooks/permission-hook.mjs, pelo plugin
// habblaud-permissoes ou pelo npm run hooks:install) manda cada pedido para POST /api/permissions e fica esperando a decisão em GET /api/permissions/:id/wait (long-poll).
// A página responde em POST /api/permissions/:id/decision. O registro:
// - só aceita o pedido se alguma página local estiver aberta e a sessão for conhecida (senão o hook sai
//   na hora e o terminal segue normal);
// - publica o pedido no agente (AgentInfo.permission, via Office) e avisa no feed;
// - entrega a decisão ao hook (allow/deny, ou as respostas de um AskUserQuestion) ou o libera sem decisão
//   ("responder no terminal");
// - descarta pedidos órfãos: tempo limite do hook, hook que morreu (sem ninguém esperando), agente que
//   saiu e pedido respondido no próprio terminal (o tool_result aparece no transcript).
//
// O Codex usa as mesmas rotas (hook PermissionRequest de mod/habblaud-codex/hook.mjs, com `provider: "codex"` e a
// conta no corpo). Diferenças: o agente casa pelo thread (agent_id ?? session_id) entre os agentes do Codex; sem
// sugestões nem perguntas; recusar só com motivo (sem interromper); sem a busca da resposta no transcript (no Codex o
// terminal só pede a aprovação depois que o hook termina, então ela nunca é respondida lá enquanto ele espera).
import { randomBytes } from 'node:crypto';
import { describeTool, maskSecrets, truncate } from '../../shared/activity';
import { ANSWER_OTHER_MAX, answerSummary, ASK_TOOL, checkAnswers } from '../../shared/answers';
import type { Activity, AgentInfo, PermissionAnswer, PermissionDecision, PermissionRequestInfo, PermissionSuggestionInfo } from '../../shared/types';
import { errMsg, log } from '../log';
import { toolView } from '../sources/terminal';
import { codexToolView } from './codex';
import { callSignature, scanToolCall } from './transcript';
import { tr } from '../../shared/i18n';

/** Tempo que o hook espera por padrão (ele manda o próprio em `timeout_ms`). */
export const DEFAULT_TIMEOUT_MS = 300_000;
export const MIN_TIMEOUT_MS = 5_000;
export const MAX_TIMEOUT_MS = 24 * 60 * 60_000;
/** Folga depois do tempo limite do hook antes de o pedido sumir sozinho. */
export const EXPIRY_GRACE_MS = 5_000;
/** Resposta mais longa de um long-poll (o hook pergunta de novo em seguida). */
export const WAIT_MAX_MS = 25_000;
/** Sem nenhum hook esperando há este tempo = o hook morreu (cancelado, tempo esgotado, sessão interrompida). */
export const ORPHAN_MS = 8_000;
/** Decisão guardada para o hook que estava entre duas esperas vir buscar. */
export const RESOLVED_KEEP_MS = 30_000;
/** Intervalo mínimo entre conferências do transcript de um pedido. */
export const SCAN_EVERY_MS = 1_000;
/** Principal que esperava (diálogo aberto) e deixou de esperar há este tempo: respondeu no terminal. */
export const LEFT_WAITING_MS = 3_000;
export const MAX_PENDING = 32;
/**
 * Espera longa (HABBLAUD_PERMISSION_TIMEOUT acima do padrão) sem nenhuma página que responda há este tempo, e sem
 * celular que possa entrar depois: o pedido volta ao terminal (senão ficaria até 24 h onde ninguém o vê; nos
 * subagentes em segundo plano o terminal só mostra o diálogo quando o hook termina).
 */
export const UNWATCHED_MS = 5 * 60_000;

const DESTINATIONS = new Set(['session', 'localSettings', 'projectSettings', 'userSettings']);
const MAX_SUGGESTIONS = 4;
const MAX_MESSAGE = 1_000;
const RULE_MAX = 160;
/** Respostas numa decisão `answer` (o AskUserQuestion faz até 4 perguntas). */
const MAX_ANSWERS = 4;

/** O que o registro usa do Office (interface mínima: facilita os testes). */
export interface OfficeLike {
  get(id: string): AgentInfo | undefined;
  list(): AgentInfo[];
  markDirty(): void;
  addActivity(id: string, activity: Activity, current: boolean, opts?: { feed?: boolean }): void;
  /** Aviso "pede permissão" ou "tem uma pergunta" (mesmo dedupe do aviso "precisa de você" do status). */
  noticePermission(id: string, what: string, kind?: 'permission' | 'question'): void;
}

export interface RegistryOptions {
  office: OfficeLike;
  /** Páginas locais conectadas (Hub.localSize): sem nenhuma, o pedido não é desviado do terminal. */
  viewers: () => number;
  /** Uma página que ainda não está aberta pode responder depois (celular com login e `permissions` liberado). */
  answerLater?: () => boolean;
  /** Transcript de um agente presente (ClaudeWatcher.transcriptPathOf). */
  transcriptPathOf?: (agentId: string) => string | undefined;
  /**
   * Conta do Codex (AgentInfo.account) de um pedido do hook do Codex, pela pasta CODEX_HOME que ele manda (o basename
   * que o hook calcula não sabe dos ids desambiguados, ex. ".codex~2"). undefined = vale a conta do hook.
   */
  codexAccount?: (account: string | undefined, codexHome: string | undefined) => string | undefined;
  /** Decisão para um pedido fictício do demo (Office.decideDemoPermission); true = era do demo. */
  demoDecide?: (id: string, d: PermissionDecision) => boolean;
  /** Detalhe de um pedido fictício do demo (o snapshot já o traz). */
  demoDetail?: (id: string) => PermissionRequestInfo | undefined;
  now?: () => number;
  /** Intervalo do relógio interno (start). */
  tickMs?: number;
  orphanMs?: number;
  resolvedKeepMs?: number;
  maxPending?: number;
}

export type SkipReason = 'no-viewers' | 'unknown-session' | 'unsupported-tool' | 'too-many';
export type RegisterResult = { id: string; expiresAt: number } | { skip: SkipReason };
export type ReleaseReason = 'terminal' | 'answered' | 'expired' | 'orphan' | 'gone' | 'unwatched' | 'shutdown';

/**
 * Resposta de uma espera do hook. `answer`: as respostas por posição (o hook as troca pelos textos originais
 * do AskUserQuestion que recebeu do Claude Code).
 */
export type WaitResult =
  | { status: 'pending' }
  | { status: 'decided'; behavior: 'allow' | 'deny'; message?: string; interrupt?: boolean; suggestion?: number }
  | { status: 'decided'; behavior: 'answer'; answers: PermissionAnswer[] }
  | { status: 'released'; reason: ReleaseReason };

/**
 * invalid = sugestão de regra desconhecida; invalid-answer = decisão que não serve para o tipo de pedido (pergunta
 * se responde com `answer`, e só ela) ou respostas que não batem com as perguntas; unsupported = o Codex não aceita
 * (interromper ou "sempre permitir").
 */
export type DecideResult = 'ok' | 'not-found' | 'conflict' | 'invalid' | 'invalid-answer' | 'unsupported';

/** Erro de validação do corpo vindo do hook (vira 400). */
export class InvalidRequest extends Error {}

interface Waiter {
  done: (r: WaitResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Formato ORIGINAL de uma pergunta do AskUserQuestion: para conferir as respostas, que voltam por posição. */
interface AskFormat {
  multiSelect: boolean;
  /** Quantas opções o original tem (inclusive as que o Habblaud não mostra). */
  options: number;
}

interface Pending {
  /** Versão completa (com `input`): GET /api/permissions/:id. */
  info: PermissionRequestInfo;
  /** Pedido do Codex (sem a busca da resposta no transcript). */
  codex?: boolean;
  /** Pergunta (AskUserQuestion): o formato de `tool_input.questions`, por posição (undefined = entrada inválida). */
  askFormat?: Array<AskFormat | undefined>;
  agentId: string;
  sessionId: string;
  /** agent_id do hook (pedido de subagente). */
  hookAgentId?: string;
  signature: string;
  toolUseId?: string;
  lastScanAt: number;
  /** O registro de sessões já mostrou o principal esperando (o diálogo abriu no terminal). */
  sawWaiting?: boolean;
  /** Desde quando ele deixou de esperar (depois de ter esperado). */
  notWaitingSince?: number;
  waiters: Set<Waiter>;
  /** Desde quando não há hook esperando. */
  idleSince: number;
  outcome?: Exclude<WaitResult, { status: 'pending' }>;
  resolvedAt?: number;
}

type Rec = Record<string, unknown>;

function rec(v: unknown): Rec | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined;
}

function shortStr(v: unknown, max: number): string | undefined {
  return typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : undefined;
}

function isIndex(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

/** Pedido que se responde com `answer` (as perguntas do AskUserQuestion; o Codex não as manda pelo hook). */
function isQuestion(info: { tool: string; provider?: string }): boolean {
  return info.tool === ASK_TOOL && info.provider !== 'codex';
}

/** O Codex não aceita interromper nem "sempre permitir" (o hook dele só aprova ou recusa com motivo). */
function unsupportedByCodex(info: PermissionRequestInfo, d: PermissionDecision): boolean {
  return info.provider === 'codex' && (d.interrupt === true || d.suggestion !== undefined);
}

/**
 * A decisão não serve para o tipo de pedido: `answer` só vale para perguntas, e pergunta não se aprova sem as
 * respostas (recusar e "responder no terminal" valem para os dois).
 */
function wrongKind(info: PermissionRequestInfo, d: PermissionDecision): boolean {
  return d.behavior === 'answer' ? !isQuestion(info) || !info.questions?.length : d.behavior === 'allow' && isQuestion(info);
}

/** Formato original das perguntas do AskUserQuestion, por posição. */
function askFormat(raw: unknown): Array<AskFormat | undefined> {
  if (!Array.isArray(raw)) return [];
  return raw.map((q) => {
    const r = rec(q);
    return r ? { multiSelect: r.multiSelect === true, options: Array.isArray(r.options) ? r.options.length : 0 } : undefined;
  });
}

/** Perguntas de verdade (com texto) no original: todas precisam aparecer no escritório para dar para responder por lá. */
function askCount(raw: unknown): number {
  if (!Array.isArray(raw)) return 0;
  return raw.filter((q) => {
    const text = rec(q)?.question;
    return typeof text === 'string' && !!text.trim();
  }).length;
}

/** A resposta cabe no formato original da pergunta (posições das opções e quantas escolhas). */
function fitsFormat(f: AskFormat | undefined, a: PermissionAnswer): boolean {
  if (!f) return false;
  const options = a.options ?? [];
  if (options.some((i) => i >= f.options)) return false;
  return f.multiSelect || options.length + (a.other ? 1 : 0) === 1;
}

/** Agente que ainda pode receber um pedido (não saiu nem concluiu). */
function present(a: AgentInfo | undefined): a is AgentInfo {
  return !!a && a.status !== 'offline' && a.status !== 'done';
}

/** "Bash(npm test:*)" a partir de {toolName, ruleContent}. */
function ruleText(raw: unknown): string | undefined {
  const r = rec(raw);
  const tool = shortStr(r?.toolName, 200);
  if (!tool) return undefined;
  const content = typeof r?.ruleContent === 'string' && r.ruleContent.trim() ? r.ruleContent : undefined;
  return truncate(maskSecrets(content ? `${tool}(${content})` : tool), RULE_MAX);
}

/**
 * Sugestões "sempre permitir" que o Habblaud oferece: só `addRules` com `behavior: "allow"` num destino
 * conhecido. A página escolhe pela posição e o hook aplica a sugestão ORIGINAL que recebeu do Claude Code
 * (o servidor nunca inventa regras).
 */
export function pickSuggestions(raw: unknown): PermissionSuggestionInfo[] {
  if (!Array.isArray(raw)) return [];
  const out: PermissionSuggestionInfo[] = [];
  raw.forEach((s, index) => {
    const r = rec(s);
    if (!r || r.type !== 'addRules' || r.behavior !== 'allow' || typeof r.destination !== 'string' || !DESTINATIONS.has(r.destination)) return;
    const rules = Array.isArray(r.rules) ? r.rules.map(ruleText).filter((x): x is string => !!x) : [];
    if (!rules.length || out.length >= MAX_SUGGESTIONS) return;
    out.push({ index, rules: rules.slice(0, 4), destination: r.destination });
  });
  return out;
}

/**
 * Põe o pedido pendente no agente do snapshot (cópia já clonada pelo Office). Enquanto há pedido, o agente
 * aparece como 'waiting' — inclusive o subagente em segundo plano, cujo diálogo só aparece no terminal
 * depois que o hook responde (o registro de sessões do Claude Code não diz que ele espera).
 */
export function applyPermission(a: AgentInfo, p: PermissionRequestInfo | undefined): AgentInfo {
  if (!p || !present(a)) return a;
  a.permission = p;
  if (a.status !== 'waiting') {
    a.status = 'waiting';
    a.statusSince = p.createdAt;
  }
  a.waitingFor ??= isQuestion(p) ? tr('responder uma pergunta') : p.provider === 'codex' ? tr('aprovar um comando') : tr('aprovar uma permissão');
  return a;
}

/**
 * Valida o JSON do hook (o mesmo que o Claude Code entrega no stdin, com `timeout_ms` do hook). O hook do Codex manda
 * também `provider: "codex"`, a conta (`account`, o basename do CODEX_HOME) e o caminho dela (`codexHome`); nele,
 * `agent_id` é o thread do subagente (e `session_id`, o thread raiz).
 */
export function parseHookInput(raw: unknown): {
  provider?: 'codex';
  account?: string;
  codexHome?: string;
  sessionId: string;
  agentId?: string;
  agentType?: string;
  cwd?: string;
  tool: string;
  input: Rec;
  suggestions: unknown;
  timeoutMs: number;
} {
  const r = rec(raw);
  const sessionId = shortStr(r?.session_id, 200);
  const tool = shortStr(r?.tool_name, 200);
  if (!r || !sessionId || !tool) throw new InvalidRequest(tr('esperado o JSON do hook PermissionRequest (session_id e tool_name)'));
  const t = typeof r.timeout_ms === 'number' && Number.isFinite(r.timeout_ms) ? r.timeout_ms : DEFAULT_TIMEOUT_MS;
  const codex = r.provider === 'codex';
  return {
    ...(codex ? { provider: 'codex' as const, account: shortStr(r.account, 200), codexHome: shortStr(r.codexHome, 4_096) } : {}),
    sessionId,
    agentId: shortStr(r.agent_id, 200),
    agentType: shortStr(r.agent_type, 120),
    cwd: shortStr(r.cwd, 4_096),
    tool,
    input: rec(r.tool_input) ?? {},
    suggestions: codex ? undefined : r.permission_suggestions,
    timeoutMs: Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, t)),
  };
}

/**
 * Respostas de uma decisão `answer`: até MAX_ANSWERS, cada uma com a posição da pergunta, as posições das opções
 * (distintas; ficam em ordem crescente) e/ou o texto livre (aparado, até ANSWER_OTHER_MAX). Se batem com as
 * perguntas do pedido, quem confere é o registro (decide).
 */
function parseAnswers(raw: unknown): PermissionAnswer[] | undefined {
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_ANSWERS) return undefined;
  const out: PermissionAnswer[] = [];
  for (const item of raw) {
    const r = rec(item);
    if (!r || !isIndex(r.question)) return undefined;
    const a: PermissionAnswer = { question: r.question };
    if (r.options !== undefined) {
      if (!Array.isArray(r.options) || !r.options.every(isIndex) || new Set(r.options).size !== r.options.length) return undefined;
      if (r.options.length) a.options = (r.options as number[]).slice().sort((x, y) => x - y);
    }
    if (r.other !== undefined) {
      if (typeof r.other !== 'string') return undefined;
      const other = r.other.trim();
      if (other.length > ANSWER_OTHER_MAX) return undefined;
      if (other) a.other = other;
    }
    out.push(a);
  }
  return out;
}

/** Corpo de uma decisão vinda da página. */
export function parseDecision(raw: unknown): PermissionDecision | undefined {
  const r = rec(raw);
  if (r?.behavior === 'answer') {
    const answers = parseAnswers(r.answers);
    return answers ? { behavior: 'answer', answers } : undefined;
  }
  if (!r || (r.behavior !== 'allow' && r.behavior !== 'deny' && r.behavior !== 'terminal')) return undefined;
  const d: PermissionDecision = { behavior: r.behavior };
  if (r.behavior === 'deny') {
    if (typeof r.message === 'string' && r.message.trim()) d.message = r.message.trim().slice(0, MAX_MESSAGE);
    if (r.interrupt === true) d.interrupt = true;
  }
  if (r.behavior === 'allow' && r.suggestion !== undefined) {
    if (typeof r.suggestion !== 'number' || !Number.isInteger(r.suggestion) || r.suggestion < 0) return undefined;
    d.suggestion = r.suggestion;
  }
  return d;
}

export class PermissionRegistry {
  private pending = new Map<string, Pending>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private seq = 0;
  private readonly now: () => number;
  private readonly orphanMs: number;
  private readonly resolvedKeepMs: number;
  private readonly maxPending: number;
  /** Desde quando não há nenhuma página que responda (null = há). */
  private unwatchedSince: number | null = null;

  constructor(private readonly opts: RegistryOptions) {
    this.now = opts.now ?? Date.now;
    this.orphanMs = opts.orphanMs ?? ORPHAN_MS;
    this.resolvedKeepMs = opts.resolvedKeepMs ?? RESOLVED_KEEP_MS;
    this.maxPending = opts.maxPending ?? MAX_PENDING;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        this.tick();
      } catch (err) {
        log.warnOnce(`permissions-tick:${errMsg(err)}`, tr('Pedidos de permissão: falha no relógio ({0}).', [errMsg(err)]));
      }
    }, this.opts.tickMs ?? 500);
    this.timer.unref?.();
  }

  /** Para o relógio e libera quem estiver esperando (o hook sai sem decidir). */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const p of this.pending.values()) if (!p.outcome) this.release(p, 'shutdown');
  }

  /** Pedidos em aberto (sem decisão). */
  get size(): number {
    let n = 0;
    for (const p of this.pending.values()) if (!p.outcome) n++;
    return n;
  }

  /**
   * Registra um pedido vindo do hook. `{skip}` = não desviar (o hook sai na hora e o terminal segue):
   * pergunta que o escritório não consegue mostrar inteira, ninguém olhando, sessão desconhecida ou pedidos
   * demais. Corpo inválido: lança InvalidRequest.
   */
  register(raw: unknown): RegisterResult {
    const req = parseHookInput(raw);
    const codex = req.provider === 'codex';
    const desc = codex ? codexToolView(req.tool, req.input, req.cwd) : describeTool(req.tool, req.input);
    const questions = 'questions' in desc ? desc.questions : undefined;
    const ask = isQuestion(req);
    // Pergunta: todas precisam aparecer no escritório (o hook só responde se cada uma tiver resposta).
    if (ask && (!questions?.length || questions.length !== askCount(req.input.questions))) return { skip: 'unsupported-tool' };
    if (this.opts.viewers() <= 0) return { skip: 'no-viewers' };
    const target = codex
      ? this.resolveCodexAgent(req.sessionId, req.agentId, req.agentType, this.opts.codexAccount?.(req.account, req.codexHome) ?? req.account)
      : this.resolveAgent(req.sessionId, req.agentId, req.agentType);
    if (!target) return { skip: 'unknown-session' };
    if (this.size >= this.maxPending) return { skip: 'too-many' };

    const now = this.now();
    const id = `p-${now.toString(36)}-${++this.seq}-${randomBytes(9).toString('base64url')}`;
    // Codex: título, resumo e argumentos pelos nomes de ferramenta dele (permissions/codex.ts).
    const view = 'title' in desc ? desc : toolView(req.tool, req.input, req.cwd);
    const info: PermissionRequestInfo = { id, tool: req.tool, title: view.title, text: desc.text, icon: desc.icon, createdAt: now, expiresAt: now + req.timeoutMs };
    if (codex) info.provider = 'codex';
    if (view.input) info.input = view.input;
    if (view.inputKind) info.inputKind = view.inputKind;
    if (target.subagent) info.subagent = target.subagent;
    const suggestions = pickSuggestions(req.suggestions);
    if (suggestions.length) info.suggestions = suggestions;
    if (ask) info.questions = questions;

    const p: Pending = {
      info,
      agentId: target.id,
      sessionId: req.sessionId,
      signature: codex ? '' : callSignature(req.tool, req.input),
      lastScanAt: 0,
      waiters: new Set(),
      idleSince: now,
    };
    if (codex) p.codex = true;
    if (req.agentId) p.hookAgentId = req.agentId;
    if (ask) p.askFormat = askFormat(req.input.questions);
    this.pending.set(id, p);

    const by = target.subagent ? tr(' (subagente {0})', [target.subagent]) : '';
    const first = info.questions?.[0]?.question;
    if (first) {
      const all = info.questions!.map((q) => q.question).join(' · ');
      this.opts.office.addActivity(target.id, { id: `${target.id}#perm:${id}`, at: now, kind: 'wait', icon: '❓', text: truncate(tr('Pergunta: {0}', [first]), 46), detail: truncate(all, 300), tool: 'PermissionRequest' }, false);
      this.opts.office.noticePermission(target.id, `${truncate(first, 120)}${by}`, 'question');
    } else {
      this.opts.office.addActivity(target.id, { id: `${target.id}#perm:${id}`, at: now, kind: 'wait', icon: '🔐', text: truncate(tr('Pede permissão: {0}', [desc.text]), 46), detail: view.title, tool: 'PermissionRequest' }, false);
      this.opts.office.noticePermission(target.id, `${desc.text}${by}`);
    }
    this.opts.office.markDirty();
    return { id, expiresAt: info.expiresAt + EXPIRY_GRACE_MS };
  }

  /** Detalhe completo de um pedido em aberto (com os argumentos), ou undefined. */
  detail(id: string): PermissionRequestInfo | undefined {
    const p = this.pending.get(id);
    if (p && !p.outcome) return { ...p.info, ...this.queueOf(p) };
    return this.opts.demoDetail?.(id);
  }

  /**
   * Pedido mais antigo de cada agente (sem `input`, que só sai pelo detalhe), com quantos esperam depois
   * dele. É o que o Office põe no snapshot.
   */
  snapshot(): Map<string, PermissionRequestInfo> {
    const out = new Map<string, PermissionRequestInfo>();
    const counts = new Map<string, number>();
    for (const p of this.pending.values()) {
      if (p.outcome) continue;
      counts.set(p.agentId, (counts.get(p.agentId) ?? 0) + 1);
      if (out.has(p.agentId)) continue;
      const { input: _input, inputKind: _kind, ...info } = p.info;
      out.set(p.agentId, info);
    }
    for (const [agentId, info] of out) {
      const n = (counts.get(agentId) ?? 1) - 1;
      if (n > 0) info.queued = n;
    }
    return out;
  }

  /**
   * Espera a decisão de um pedido por até `ms`. undefined = id desconhecido (o hook desiste). `cancel`
   * desliga a espera (conexão fechada). Uma decisão já tomada volta na hora.
   */
  wait(id: string, ms: number): { result: Promise<WaitResult>; cancel: () => void } | undefined {
    const p = this.pending.get(id);
    if (!p) return undefined;
    if (p.outcome) {
      const outcome = p.outcome;
      // Entregue: não precisa mais guardar.
      this.pending.delete(id);
      return { result: Promise.resolve(outcome), cancel: () => {} };
    }
    let waiter: Waiter | undefined;
    const result = new Promise<WaitResult>((done) => {
      const timer = setTimeout(() => this.dropWaiter(p, waiter!, { status: 'pending' }), Math.max(0, Math.min(ms, WAIT_MAX_MS)));
      timer.unref?.();
      waiter = { done, timer };
      p.waiters.add(waiter);
    });
    return { result, cancel: () => waiter && this.dropWaiter(p, waiter) };
  }

  /** Decisão da página. Pedido do demo vai para `demoDecide` (com as mesmas regras para as perguntas). */
  decide(id: string, d: PermissionDecision): DecideResult {
    const p = this.pending.get(id);
    if (!p) {
      const demo = this.opts.demoDetail?.(id);
      if (demo && unsupportedByCodex(demo, d)) return 'unsupported';
      if (demo && (wrongKind(demo, d) || (d.behavior === 'answer' && !checkAnswers(demo.questions ?? [], d.answers)))) return 'invalid-answer';
      return this.opts.demoDecide?.(id, d) ? 'ok' : 'not-found';
    }
    if (p.outcome) return 'conflict';
    if (unsupportedByCodex(p.info, d)) return 'unsupported';
    if (d.suggestion !== undefined && !p.info.suggestions?.some((s) => s.index === d.suggestion)) return 'invalid';
    if (d.behavior === 'terminal') {
      this.release(p, 'terminal');
      return 'ok';
    }
    if (wrongKind(p.info, d)) return 'invalid-answer';
    if (d.behavior === 'answer') return this.answer(p, d.answers);
    const outcome: WaitResult = { status: 'decided', behavior: d.behavior };
    if (d.message) outcome.message = d.message;
    if (d.interrupt) outcome.interrupt = true;
    if (d.suggestion !== undefined) outcome.suggestion = d.suggestion;
    this.resolve(p, outcome);
    const now = this.now();
    const act: Activity =
      d.behavior === 'allow'
        ? { id: `${p.agentId}#perm-ok:${id}`, at: now, kind: 'other', icon: '✅', text: d.suggestion !== undefined ? tr('Aprovado no Habblaud (sempre permitir)') : tr('Aprovado no Habblaud'), detail: p.info.title, tool: 'PermissionRequest' }
        : { id: `${p.agentId}#perm-no:${id}`, at: now, kind: 'wait', icon: '🚫', text: tr('Recusado no Habblaud'), detail: d.message ? `${p.info.title} — ${d.message}` : p.info.title, tool: 'PermissionRequest' };
    this.opts.office.addActivity(p.agentId, act, false);
    return 'ok';
  }

  /**
   * Respostas às perguntas de um AskUserQuestion: cada pergunta mostrada respondida exatamente uma vez, com as
   * opções dela, conferidas também contra o formato ORIGINAL (é por posição que o hook acha os textos).
   */
  private answer(p: Pending, raw: PermissionAnswer[] | undefined): DecideResult {
    const questions = p.info.questions ?? [];
    const answers = checkAnswers(questions, raw);
    if (!answers || answers.some((a) => !fitsFormat(p.askFormat?.[a.question], a))) return 'invalid-answer';
    this.resolve(p, { status: 'decided', behavior: 'answer', answers });
    const act: Activity = { id: `${p.agentId}#perm-answer:${p.info.id}`, at: this.now(), kind: 'other', icon: '💬', text: tr('Respondido no Habblaud'), detail: answerSummary(questions, answers), tool: 'PermissionRequest' };
    this.opts.office.addActivity(p.agentId, act, false);
    return 'ok';
  }

  /** Relógio: expiração, órfãos, agente que saiu, resposta no terminal e limpeza das decisões entregues. */
  tick(): void {
    const now = this.now();
    this.unwatchedSince = this.opts.viewers() > 0 ? null : (this.unwatchedSince ?? now);
    const unwatched = this.unwatchedSince !== null && now - this.unwatchedSince >= UNWATCHED_MS && !this.opts.answerLater?.();
    for (const [id, p] of this.pending) {
      if (p.outcome) {
        if (now - (p.resolvedAt ?? now) >= this.resolvedKeepMs) this.pending.delete(id);
        continue;
      }
      if (now >= p.info.expiresAt + EXPIRY_GRACE_MS) this.release(p, 'expired');
      else if (!p.waiters.size && now - p.idleSince >= this.orphanMs) this.release(p, 'orphan');
      else if (!present(this.opts.office.get(p.agentId))) this.release(p, 'gone');
      else if (unwatched && p.info.expiresAt - p.info.createdAt > DEFAULT_TIMEOUT_MS) this.release(p, 'unwatched');
      // No Codex o terminal só pede a aprovação depois que o hook termina: não há resposta dada lá para procurar.
      else if (p.codex) continue;
      else if (now - p.lastScanAt >= SCAN_EVERY_MS && this.answeredInTerminal(p, now)) this.release(p, 'answered');
      else if (this.leftWaiting(p, now)) this.release(p, 'answered');
    }
  }

  // ---------------------------------------------------------------- internos

  private resolveAgent(sessionId: string, agentId?: string, agentType?: string): { id: string; subagent?: string } | undefined {
    const office = this.opts.office;
    if (agentId) {
      const subId = `${sessionId}:${agentId}`;
      const sub = office.get(subId);
      if (present(sub) && sub.provider !== 'codex') return { id: subId };
    }
    const main = office.list().find((a) => a.kind === 'main' && a.provider !== 'codex' && a.sessionId === sessionId && a.status !== 'offline');
    if (!main) return undefined;
    return agentId ? { id: main.id, subagent: agentType ?? tr('subagente') } : { id: main.id };
  }

  /**
   * Agente do Codex de um pedido: o do thread `agent_id ?? session_id` (o subagente tem thread próprio; o principal é o
   * thread raiz). A conta só desempata (ids de thread são UUIDs). Subagente que o Habblaud não mostra: o pedido vai
   * para o principal, com o tipo dele.
   */
  private resolveCodexAgent(sessionId: string, agentId: string | undefined, agentType: string | undefined, account: string | undefined): { id: string; subagent?: string } | undefined {
    const find = (thread: string): AgentInfo | undefined => {
      const found = this.opts.office.list().filter((a) => a.provider === 'codex' && a.sessionId === thread && present(a));
      return found.find((a) => a.account === account) ?? found[0];
    };
    const sub = agentId && agentId !== sessionId ? agentId : undefined;
    const own = sub ? find(sub) : undefined;
    if (own) return { id: own.id };
    const main = find(sessionId);
    if (!main) return undefined;
    return sub ? { id: main.id, subagent: agentType ?? tr('subagente') } : { id: main.id };
  }

  private queueOf(p: Pending): { queued?: number } {
    // Pela ordem de chegada (a do Map), não pelo createdAt: dois pedidos no mesmo milissegundo empatariam e cada
    // um contaria o outro como "atrás dele".
    let n = 0;
    let after = false;
    for (const o of this.pending.values()) {
      if (o === p) after = true;
      else if (after && !o.outcome && o.agentId === p.agentId) n++;
    }
    return n ? { queued: n } : {};
  }

  /** O tool_result da chamada apareceu no transcript (respondido no terminal)? Nunca lança. */
  private answeredInTerminal(p: Pending, now: number): boolean {
    p.lastScanAt = now;
    // Subagente que o Habblaud não acompanha (pedido mostrado no principal): o transcript dele não é
    // conhecido e o do principal não tem a chamada; sobram a expiração e o órfão.
    if (p.hookAgentId && p.agentId !== `${p.sessionId}:${p.hookAgentId}`) return false;
    const path = this.opts.transcriptPathOf?.(p.agentId);
    if (!path) return false;
    try {
      const r = scanToolCall(path, { tool: p.info.tool, signature: p.signature, knownId: p.toolUseId, createdAt: p.info.createdAt });
      if (r.toolUseId) p.toolUseId = r.toolUseId;
      return r.answered;
    } catch {
      return false;
    }
  }

  /**
   * Plano B da resposta no terminal, só para pedidos do principal cuja chamada não foi achada no
   * transcript: o registro de sessões mostrou o diálogo aberto ('waiting') e depois deixou de mostrar
   * por LEFT_WAITING_MS. (Com a chamada achada, vale só o tool_result: pedidos em sequência do mesmo
   * agente passam por 'busy' entre um diálogo e outro.)
   */
  private leftWaiting(p: Pending, now: number): boolean {
    if (p.hookAgentId || p.toolUseId) return false;
    const a = this.opts.office.get(p.agentId);
    if (a?.kind !== 'main') return false;
    if (a.status === 'waiting') {
      p.sawWaiting = true;
      delete p.notWaitingSince;
      return false;
    }
    if (!p.sawWaiting) return false;
    p.notWaitingSince ??= now;
    return now - p.notWaitingSince >= LEFT_WAITING_MS;
  }

  private dropWaiter(p: Pending, w: Waiter, result?: WaitResult): void {
    if (!p.waiters.delete(w)) return;
    clearTimeout(w.timer);
    if (!p.waiters.size) p.idleSince = this.now();
    if (result) w.done(result);
  }

  private resolve(p: Pending, outcome: Exclude<WaitResult, { status: 'pending' }>): void {
    p.outcome = outcome;
    p.resolvedAt = this.now();
    const delivered = p.waiters.size > 0;
    for (const w of [...p.waiters]) this.dropWaiter(p, w, outcome);
    // Entregue a quem esperava: some já; senão fica guardado até o hook voltar (ou RESOLVED_KEEP_MS).
    if (delivered) this.pending.delete(p.info.id);
    this.opts.office.markDirty();
  }

  private release(p: Pending, reason: ReleaseReason): void {
    this.resolve(p, { status: 'released', reason });
  }
}
