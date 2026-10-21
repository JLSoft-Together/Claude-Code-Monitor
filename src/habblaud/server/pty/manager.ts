// Terminal interativo: o Habblaud abre o Claude Code num pseudo-terminal (node-pty) e o navegador mostra e
// controla esse terminal (xterm.js). Saída via SSE em GET /api/pty/:id/stream; entrada, redimensionamento e
// encerramento via POST (rotas em http/pty.ts).
//
// Três usos: sessão nova numa pasta; "assumir" uma sessão aberta noutro terminal (o processo de lá é
// encerrado e a mesma conversa continua aqui com `claude --resume`); e encerrar um agente, esteja ele aqui
// ou noutro terminal (só processos que o registro de sessões do Claude Code confirma como sessão e cujo início
// e executável batem com o registro: pty/procinfo.ts).
//
// Segurança: quem controla um terminal destes executa comandos na máquina. O recurso é opt-in (HABBLAUD_PTY=1),
// as rotas só aceitam conexões do próprio computador (ver http/pty.ts) e ele fica desligado no Docker.
import { chmodSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { PtyInfo, PtyStatus } from '../../shared/types';
import { frame } from '../http/sse';
import { errMsg, log } from '../log';
import { pidAlive } from '../sources/registry';
import { readProcInfo, sameProcess, type ProcInfo, type RegisteredProc } from './procinfo';
import { killWithConsoleReset } from './winkill';
import { tr } from '../../shared/i18n';
import { isExecutableFile } from '../claude-bin';

export { claudeBinFrom, findExecutable, isExecutableFile } from '../claude-bin';

/** O que o gerenciador usa do node-pty (permite trocar nos testes). */
export interface PtyProcess {
  readonly pid: number;
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export type SpawnPty = (file: string, args: string[], opts: { cwd: string; cols: number; rows: number; env: NodeJS.ProcessEnv }) => PtyProcess;

export interface PtyAccount {
  id: string;
  /** Pasta de configuração da conta (vira CLAUDE_CONFIG_DIR, exceto a padrão). */
  dir: string;
  isDefault: boolean;
}

/** O que o gerenciador precisa saber de um agente principal para encerrá-lo ou assumi-lo. */
export interface PtyAgentRef {
  id: string;
  kind: 'main' | 'sub';
  account: string;
  sessionId: string;
  cwd?: string;
}

/**
 * Tela de um terminal no servidor: recebe a saída e devolve, para quem conecta depois (ou troca de aba), uma
 * sequência que reconstrói a tela atual com os modos que o programa ligou (colagem entre colchetes, teclas de
 * aplicação, tela alternativa). `write` pode processar depois: o callback avisa quando aquele trecho entrou.
 */
export interface PtyScreen {
  write(data: string, done?: () => void): void;
  resize(cols: number, rows: number): void;
  serialize(): string;
  dispose(): void;
}

export type ScreenFactory = (cols: number, rows: number) => PtyScreen;

export interface PtyManagerOptions {
  spawn: SpawnPty | null;
  /** Por que o recurso está desligado (quando `spawn` é null). */
  disabledReason?: string;
  claudeBin: string;
  accounts: () => PtyAccount[];
  agent: (id: string) => PtyAgentRef | undefined;
  onChange: () => void;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  /**
   * Encerra um processo de fora (testes). Padrão: no Windows, encerra e limpa os modos do terminal dele
   * (pty/winkill.ts, que confere de novo o início exato); nos outros, SIGTERM (o Claude Code sai e limpa sozinho).
   */
  killPid?: (pid: number, proc: ProcInfo) => void | Promise<void>;
  /** Encerra à força quando o processo não sai a tempo ao assumir (padrão: SIGKILL; no Windows, TerminateProcess). */
  forceKill?: (pid: number) => void;
  /** Início e executável de um processo vivo (padrão: pty/procinfo.ts). */
  procInfo?: (pid: number) => Promise<ProcInfo | undefined>;
  /** Lê `<conta>/sessions/<pid>.json` (testes). */
  readSession?: (accountDir: string, pid: number) => unknown;
  /** Tela de cada terminal, reproduzida para quem conecta (padrão: só a saída bruta; ver pty/screen.ts). */
  createScreen?: ScreenFactory;
  isAlive?: (pid: number) => boolean;
  sleep?: (ms: number) => Promise<void>;
}

/** Saída bruta guardada por terminal quando não há o @xterm/headless (ver rawScreen). */
const MAX_SCROLLBACK = 512 * 1024;
/** Terminais encerrados continuam na lista por um tempo, para a tela final ainda poder ser vista. */
const EXITED_KEEP_MS = 10 * 60_000;
export const MAX_PTYS = 12;
/** Quanto esperar o processo de fora sair antes de retomar a sessão aqui (depois, encerra à força). */
const TAKEOVER_WAIT_MS = 5_000;
/** Depois de encerrar à força: quanto mais esperar. */
const FORCE_WAIT_MS = 3_000;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Id de agente principal: "<conta>:<pid>". */
const MAIN_ID = /^(.+):(\d+)$/;

/**
 * Variáveis que o Claude Code põe no ambiente das próprias ferramentas. Se o Habblaud foi iniciado de dentro
 * de uma sessão, o Claude aberto aqui se acharia uma sessão-filha (e desligaria o transcript).
 */
const INHERITED_SESSION_VARS = [
  'CLAUDECODE',
  'AI_AGENT',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_SSE_PORT',
];

/**
 * Sem o @xterm/headless: guarda a saída bruta, cortada no começo de uma linha (nunca no meio de uma sequência
 * de escape). Os modos ligados lá no começo podem se perder ao reproduzir.
 */
export function rawScreen(): PtyScreen {
  let buffer = '';
  return {
    write(data, done) {
      buffer += data;
      if (buffer.length > MAX_SCROLLBACK) {
        const cut = buffer.indexOf('\n', buffer.length - MAX_SCROLLBACK);
        buffer = cut === -1 ? '' : buffer.slice(cut + 1);
      }
      done?.();
    },
    resize() {},
    serialize: () => buffer,
    dispose() {
      buffer = '';
    },
  };
}

interface Pty {
  info: PtyInfo;
  proc: PtyProcess;
  screen: PtyScreen;
  clients: Set<ServerResponse>;
  /** Conectando: guardam a saída nova numa fila até a tela guardada ficar pronta. */
  pending: Map<ServerResponse, string[]>;
}

/** Sessão aberta noutro terminal, conferida: o PID e o que o sistema diz dele. */
interface ExternalProc {
  pid: number;
  proc: ProcInfo;
}

/** O que uma sessão nova precisa, já validado (pasta, conta e tamanho). */
interface SpawnPlan {
  cwd: string;
  account: PtyAccount;
  cols: number;
  rows: number;
}

export class PtyError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class PtyManager {
  private ptys = new Map<string, Pty>();
  private seq = 0;
  /** "Assumir" em andamento por agente: um duplo clique (ou duas abas) recebe o mesmo resultado. */
  private takeovers = new Map<string, Promise<PtyInfo>>();
  private readonly now: () => number;
  private readonly killPid: (pid: number, proc: ProcInfo) => void | Promise<void>;
  private readonly forceKill: (pid: number) => void;
  private readonly procInfo: (pid: number) => Promise<ProcInfo | undefined>;
  private readonly readSession: (accountDir: string, pid: number) => unknown;
  private readonly createScreen: ScreenFactory;
  private readonly isAlive: (pid: number) => boolean;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: PtyManagerOptions) {
    this.now = opts.now ?? Date.now;
    this.procInfo = opts.procInfo ?? ((pid) => readProcInfo(pid));
    this.killPid =
      opts.killPid ??
      (process.platform === 'win32'
        ? (pid, proc) => killWithConsoleReset(pid, proc.fileTime ?? '', () => this.stillSame(pid, proc))
        : (pid) => void process.kill(pid, 'SIGTERM'));
    this.forceKill = opts.forceKill ?? ((pid) => void process.kill(pid, 'SIGKILL'));
    this.readSession = opts.readSession ?? ((dir, pid) => JSON.parse(readFileSync(join(dir, 'sessions', `${pid}.json`), 'utf8')));
    this.createScreen = opts.createScreen ?? (() => rawScreen());
    this.isAlive = opts.isAlive ?? pidAlive;
    this.sleep = opts.sleep ?? ((ms) => new Promise((ok) => setTimeout(ok, ms)));
  }

  status(): PtyStatus {
    return this.opts.spawn ? { enabled: true } : { enabled: false, reason: this.opts.disabledReason ?? tr('indisponível') };
  }

  list(): PtyInfo[] {
    const now = this.now();
    for (const [id, t] of this.ptys) {
      if (t.info.exitedAt !== undefined && now - t.info.exitedAt > EXITED_KEEP_MS) this.drop(id);
    }
    return [...this.ptys.values()].map((t) => ({ ...t.info }));
  }

  /** Abre uma sessão nova do Claude Code na pasta (`cwd` absoluto), na conta pedida (ou na padrão). */
  create(p: { cwd: unknown; account?: unknown; cols?: unknown; rows?: unknown }): PtyInfo {
    return this.spawn(this.plan(p, this.takeovers.size));
  }

  /**
   * Encerra um agente principal. Aberto aqui: fecha o pty. Aberto noutro terminal: encerra o processo, mas só
   * se o registro de sessões da conta confirmar que aquele PID é aquela sessão do Claude Code (e o processo vivo
   * com esse PID começou quando o registro diz e é o Claude Code).
   */
  async stop(agentId: string): Promise<void> {
    const own = this.byAgent(agentId);
    if (own) {
      this.kill(own);
      return;
    }
    const ext = await this.external(agentId);
    try {
      await this.killPid(ext.pid, ext.proc);
    } catch (err) {
      throw new PtyError(500, tr('não consegui encerrar a sessão: {0}', [errMsg(err)]));
    }
    log.info(tr('Agente {0} encerrado pelo escritório.', [agentId]));
  }

  /**
   * Assume uma sessão aberta noutro terminal: encerra o processo de lá, espera ele sair e continua a mesma
   * conversa aqui (`claude --resume <sessão>`, na pasta e na conta originais). O que pode impedir a sessão nova
   * (pasta, conta, limite) é conferido antes de encerrar a de lá; pedidos repetidos esperam o primeiro.
   */
  takeover(agentId: string, size: { cols?: unknown; rows?: unknown } = {}): Promise<PtyInfo> {
    const pending = this.takeovers.get(agentId);
    if (pending) return pending;
    const run = this.doTakeover(agentId, size).finally(() => this.takeovers.delete(agentId));
    this.takeovers.set(agentId, run);
    return run;
  }

  private async doTakeover(agentId: string, size: { cols?: unknown; rows?: unknown }): Promise<PtyInfo> {
    // Um tique: o pedido já está em this.takeovers (conta no limite abaixo como "esta" tomada).
    await Promise.resolve();
    if (!this.opts.spawn) throw new PtyError(503, tr('terminal desligado: {0}', [this.opts.disabledReason ?? tr('indisponível')]));
    const own = this.byAgent(agentId);
    if (own) return { ...own.info };
    const agent = this.mainAgent(agentId);
    if (!SESSION_ID.test(agent.sessionId)) throw new PtyError(409, tr('sessão sem id válido para retomar'));
    if (!agent.cwd) throw new PtyError(409, tr('não sei a pasta desta sessão'));
    // As outras tomadas em andamento já têm uma vaga prometida.
    const plan = this.plan({ cwd: agent.cwd, account: agent.account, cols: size.cols, rows: size.rows }, this.takeovers.size - 1);
    const ext = await this.external(agentId);
    try {
      await this.killPid(ext.pid, ext.proc);
    } catch (err) {
      throw new PtyError(500, tr('não consegui encerrar a sessão no outro terminal: {0}', [errMsg(err)]));
    }
    if (!(await this.waitExit(ext.pid, TAKEOVER_WAIT_MS))) {
      // Não saiu a tempo: encerra à força (se ainda for o mesmo processo) e espera mais um pouco.
      log.warn(tr('Agente {0} não encerrou em {1} s: encerrando à força.', [agentId, TAKEOVER_WAIT_MS / 1000]));
      try {
        if (await this.stillSame(ext.pid, ext.proc)) this.forceKill(ext.pid);
      } catch (err) {
        log.warn(tr('Falha ao encerrar à força o processo {0}: {1}', [ext.pid, errMsg(err)]));
      }
      if (!(await this.waitExit(ext.pid, FORCE_WAIT_MS))) {
        throw new PtyError(500, tr('a sessão no outro terminal não encerrou nem à força; ela continua aberta lá'));
      }
    }
    let info: PtyInfo;
    try {
      info = this.spawn(plan, { resume: agent.sessionId, from: agentId });
    } catch (err) {
      // A sessão de lá já foi encerrada: dizer como continuar a conversa.
      throw new PtyError(500, tr('a sessão foi encerrada no outro terminal, mas não abriu aqui ({0}); para continuar: claude --resume {1}', [errMsg(err), agent.sessionId]));
    }
    log.info(tr('Agente {0} assumido pelo escritório (sessão {1}).', [agentId, agent.sessionId]));
    return info;
  }

  /** Conecta um cliente SSE: a tela atual primeiro, depois a saída ao vivo. */
  attach(id: string, req: IncomingMessage, res: ServerResponse): void {
    const pty = this.get(id);
    req.socket.setTimeout(0);
    req.socket.setNoDelay(true);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    // A saída que chega enquanto a tela termina de processar o que veio antes vai para a fila deste cliente.
    const queue: string[] = [];
    pty.pending.set(res, queue);
    const drop = () => {
      pty.pending.delete(res);
      pty.clients.delete(res);
    };
    req.on('close', drop);
    res.on('close', drop);
    res.on('error', drop);
    pty.screen.write('', () => {
      if (!pty.pending.delete(res) || res.writableEnded) return;
      res.write(frame('reset', pty.screen.serialize()));
      for (const data of queue) res.write(frame('data', data));
      if (pty.info.exitedAt !== undefined) res.write(frame('exit', { code: pty.info.exitCode ?? 0 }));
      pty.clients.add(res);
    });
  }

  input(id: string, data: unknown): void {
    if (typeof data !== 'string' || data.length > 64 * 1024) throw new PtyError(400, tr('entrada inválida'));
    this.running(id).proc.write(data);
  }

  resize(id: string, cols: unknown, rows: unknown): void {
    const pty = this.running(id);
    const c = clampInt(cols, 20, 400, 100);
    const r = clampInt(rows, 5, 200, 30);
    pty.proc.resize(c, r);
    pty.screen.resize(c, r);
  }

  /** Encerra o processo (ainda rodando) ou tira da lista (já encerrado). */
  close(id: string): void {
    const pty = this.get(id);
    if (pty.info.exitedAt === undefined) this.kill(pty);
    else {
      this.drop(id);
      this.opts.onChange();
    }
  }

  stopAll(): void {
    for (const t of this.ptys.values()) {
      for (const c of t.clients) c.end();
      for (const c of t.pending.keys()) c.end();
      t.screen.dispose();
      if (t.info.exitedAt === undefined) {
        try {
          t.proc.kill();
        } catch {
          // encerrando o servidor: nada a fazer
        }
      }
    }
    this.ptys.clear();
  }

  /** Valida o pedido de uma sessão nova (`reserved`: vagas já prometidas a tomadas em andamento). */
  private plan(p: { cwd: unknown; account?: unknown; cols?: unknown; rows?: unknown }, reserved = 0): SpawnPlan {
    if (!this.opts.spawn) throw new PtyError(503, tr('terminal desligado: {0}', [this.opts.disabledReason ?? tr('indisponível')]));
    // Antes de tudo (o "assumir" encerra a sessão de lá depois daqui): um claude que não roda abriria um terminal que
    // sai na hora.
    if (!isExecutableFile(this.opts.claudeBin)) throw new PtyError(503, tr('o executável do Claude Code não roda: {0} (confira o HABBLAUD_CLAUDE_BIN)', [this.opts.claudeBin]));
    if (typeof p.cwd !== 'string' || !isAbsolute(p.cwd)) throw new PtyError(400, tr('informe a pasta do projeto (caminho absoluto)'));
    const cwd = resolve(p.cwd);
    let isDir = false;
    try {
      isDir = statSync(cwd).isDirectory();
    } catch {
      // tratado abaixo
    }
    if (!isDir) throw new PtyError(400, tr('pasta não encontrada: {0}', [cwd]));
    const accounts = this.opts.accounts();
    const account = typeof p.account === 'string' ? accounts.find((a) => a.id === p.account) : (accounts.find((a) => a.isDefault) ?? accounts[0]);
    if (!account) throw new PtyError(400, tr('conta desconhecida'));
    const running = [...this.ptys.values()].filter((t) => t.info.exitedAt === undefined).length;
    if (running + Math.max(0, reserved) >= MAX_PTYS) throw new PtyError(429, tr('limite de {0} terminais abertos', [MAX_PTYS]));
    return { cwd, account, cols: clampInt(p.cols, 20, 400, 100), rows: clampInt(p.rows, 5, 200, 30) };
  }

  private spawn(plan: SpawnPlan, p: { resume?: string; from?: string } = {}): PtyInfo {
    const spawn = this.opts.spawn;
    if (!spawn) throw new PtyError(503, tr('terminal desligado: {0}', [this.opts.disabledReason ?? tr('indisponível')]));
    const { cwd, account, cols, rows } = plan;
    const env: NodeJS.ProcessEnv = { ...(this.opts.env ?? process.env), TERM: 'xterm-256color', COLORTERM: 'truecolor' };
    for (const k of INHERITED_SESSION_VARS) delete env[k];
    if (account.isDefault) delete env.CLAUDE_CONFIG_DIR;
    else env.CLAUDE_CONFIG_DIR = account.dir;

    let proc: PtyProcess;
    try {
      const args = p.resume ? ['--resume', p.resume] : [];
      proc = spawn(this.opts.claudeBin, args, { cwd, cols, rows, env });
    } catch (err) {
      throw new PtyError(500, tr('não consegui abrir o Claude Code: {0}', [errMsg(err)]));
    }
    const id = `p${++this.seq}-${proc.pid}`;
    const info: PtyInfo = { id, pid: proc.pid, cwd, account: account.id, agentId: `${account.id}:${proc.pid}`, startedAt: this.now() };
    if (p.resume) info.resumed = p.resume;
    if (p.from) info.fromAgent = p.from;
    const pty: Pty = { info, proc, screen: this.createScreen(cols, rows), clients: new Set(), pending: new Map() };
    this.ptys.set(id, pty);
    proc.onData((data) => {
      pty.screen.write(data);
      for (const queue of pty.pending.values()) queue.push(data);
      this.broadcast(pty, 'data', data);
    });
    proc.onExit(({ exitCode }) => {
      pty.info.exitedAt = this.now();
      pty.info.exitCode = exitCode;
      this.broadcast(pty, 'exit', { code: exitCode });
      this.opts.onChange();
    });
    log.info(p.resume ? tr('Terminal {0} aberto em {1} (conta {2}, retomando {3}).', [id, cwd, account.id, p.resume]) : tr('Terminal {0} aberto em {1} (conta {2}).', [id, cwd, account.id]));
    this.opts.onChange();
    return { ...info };
  }

  private byAgent(agentId: string): Pty | undefined {
    for (const t of this.ptys.values()) if (t.info.agentId === agentId && t.info.exitedAt === undefined) return t;
    return undefined;
  }

  private mainAgent(agentId: string): PtyAgentRef {
    const agent = this.opts.agent(agentId);
    if (!agent) throw new PtyError(404, tr('agente não encontrado'));
    if (agent.kind !== 'main') throw new PtyError(400, tr('só dá para encerrar ou assumir o agente principal de uma sessão'));
    return agent;
  }

  /**
   * Agente principal aberto fora do Habblaud, confirmado pelo registro de sessões da conta (mesma sessão) e pelo
   * sistema (o processo com esse PID começou quando o registro diz e é o Claude Code).
   */
  private async external(agentId: string): Promise<ExternalProc> {
    const agent = this.mainAgent(agentId);
    const m = MAIN_ID.exec(agent.id);
    const pid = m ? Number(m[2]) : NaN;
    if (!m || m[1] !== agent.account || !Number.isSafeInteger(pid) || pid <= 0) throw new PtyError(400, tr('agente sem processo conhecido'));
    const account = this.opts.accounts().find((a) => a.id === agent.account);
    if (!account) throw new PtyError(400, tr('conta desconhecida'));
    let registered: unknown;
    try {
      registered = this.readSession(account.dir, pid);
    } catch {
      throw new PtyError(409, tr('a sessão não está mais aberta'));
    }
    const r = (registered ?? {}) as { sessionId?: unknown; startedAt?: unknown; procStart?: unknown };
    if (r.sessionId !== agent.sessionId) throw new PtyError(409, tr('o processo não é mais desta sessão'));
    if (!this.isAlive(pid)) throw new PtyError(409, tr('a sessão não está mais aberta'));
    const reg: RegisteredProc = {
      startedAt: typeof r.startedAt === 'number' ? r.startedAt : undefined,
      procStart: typeof r.procStart === 'string' ? r.procStart : undefined,
    };
    const proc = await this.procInfo(pid);
    if (!proc) throw new PtyError(409, tr('não consegui conferir o processo desta sessão (talvez já tenha encerrado)'));
    if (!sameProcess(reg, proc)) throw new PtyError(409, tr('o processo {0} não é mais esta sessão do Claude Code (registro antigo?)', [pid]));
    return { pid, proc };
  }

  /** O processo `pid` ainda é o mesmo de `proc` (vivo, mesmo executável e mesmo início)? */
  private async stillSame(pid: number, proc: ProcInfo): Promise<boolean> {
    if (!this.isAlive(pid)) return false;
    const now = await this.procInfo(pid);
    if (!now || now.name !== proc.name) return false;
    return proc.fileTime && now.fileTime ? now.fileTime === proc.fileTime : Math.abs(now.startMs - proc.startMs) < 1_000;
  }

  /** Espera `pid` sair (true) ou o tempo acabar (false). */
  private async waitExit(pid: number, ms: number): Promise<boolean> {
    for (let waited = 0; this.isAlive(pid) && waited < ms; waited += 100) await this.sleep(100);
    return !this.isAlive(pid);
  }

  private kill(pty: Pty): void {
    try {
      pty.proc.kill();
    } catch (err) {
      log.warn(tr('Falha ao encerrar o terminal {0}: {1}', [pty.info.id, errMsg(err)]));
    }
  }

  private get(id: string): Pty {
    const pty = this.ptys.get(id);
    if (!pty) throw new PtyError(404, tr('terminal não encontrado'));
    return pty;
  }

  private running(id: string): Pty {
    const pty = this.get(id);
    if (pty.info.exitedAt !== undefined) throw new PtyError(409, tr('o terminal já foi encerrado'));
    return pty;
  }

  private drop(id: string): void {
    const t = this.ptys.get(id);
    if (!t) return;
    for (const c of t.clients) c.end();
    for (const c of t.pending.keys()) c.end();
    t.screen.dispose();
    this.ptys.delete(id);
  }

  private broadcast(pty: Pty, event: string, data: unknown): void {
    const f = frame(event, data);
    for (const c of pty.clients) c.write(f);
  }
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Carrega o node-pty (dependência opcional) e confere que ele abre um terminal. Devolve null + motivo se não der:
 * sem isso, "Assumir" encerraria a sessão de lá e só depois descobriria que não consegue abrir a de cá.
 */
export async function loadPty(): Promise<{ spawn: SpawnPty | null; reason?: string }> {
  let ptySpawn: ((file: string, args: string[], o: Record<string, unknown>) => PtyProcess) | undefined;
  try {
    const mod = (await import('node-pty')) as unknown as {
      spawn?: (file: string, args: string[], o: Record<string, unknown>) => PtyProcess;
      default?: { spawn: (file: string, args: string[], o: Record<string, unknown>) => PtyProcess };
    };
    ptySpawn = mod.spawn ?? mod.default?.spawn;
  } catch (err) {
    return { spawn: null, reason: tr('node-pty não instalado ({0})', [errMsg(err)]) };
  }
  if (!ptySpawn) return { spawn: null, reason: tr('node-pty sem spawn()') };
  const nativeSpawn = ptySpawn;
  const spawn: SpawnPty = (file, args, o) => nativeSpawn(file, args, { name: 'xterm-256color', cwd: o.cwd, cols: o.cols, rows: o.rows, env: o.env });
  // No Windows não há spawn-helper; o teste de spawn foi pensado para o macOS e o Linux.
  if (process.platform === 'win32') return { spawn };
  const dir = nodePtyDir();
  if (dir) fixSpawnHelper(dir);
  const problem = await spawnProblem(spawn);
  return problem ? { spawn: null, reason: problem } : { spawn };
}

/** Pasta do pacote node-pty (undefined se não der para achar). */
function nodePtyDir(): string | undefined {
  try {
    return dirname(createRequire(import.meta.url).resolve('node-pty/package.json'));
  } catch {
    return undefined;
  }
}

/**
 * O node-pty 1.1.0 publica o `spawn-helper` do macOS (prebuilds/darwin-*) sem permissão de execução, e nenhum script
 * de instalação a devolve: sem ela, todo terminal falha com "posix_spawnp failed". Devolve a permissão nas pastas em
 * que o node-pty procura o binário nativo (o spawn-helper usado é o que fica ao lado dele).
 */
export function fixSpawnHelper(ptyDir: string, platform: NodeJS.Platform = process.platform, arch: string = process.arch): void {
  for (const sub of ['build/Release', 'build/Debug', `prebuilds/${platform}-${arch}`]) {
    const file = join(ptyDir, sub, 'spawn-helper');
    try {
      const mode = statSync(file).mode;
      if (!(mode & 0o100)) chmodSync(file, (mode & 0o777) | 0o111);
    } catch {
      // não existe (ou não deu para mudar): o teste de spawn diz se o terminal abre
    }
  }
}

/** Abre um terminal de teste (o próprio Node, que sai na hora): null se deu certo, senão o motivo. */
export function spawnProblem(spawn: SpawnPty, timeoutMs = 5_000): Promise<string | null> {
  let proc: PtyProcess;
  try {
    proc = spawn(process.execPath, ['-e', ''], { cwd: process.cwd(), cols: 80, rows: 24, env: process.env });
  } catch (err) {
    return Promise.resolve(tr('node-pty não consegue abrir terminais ({0})', [errMsg(err)]));
  }
  return new Promise((ok) => {
    // Abriu e não saiu a tempo: o spawn funciona, que é o que interessa aqui.
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // já saiu
      }
      ok(null);
    }, timeoutMs);
    proc.onExit(({ exitCode }) => {
      clearTimeout(timer);
      ok(exitCode === 0 ? null : tr('node-pty abriu o terminal de teste, mas ele saiu com o código {0}', [exitCode]));
    });
  });
}
