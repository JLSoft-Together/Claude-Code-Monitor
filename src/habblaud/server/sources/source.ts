// Fontes de agentes (uma por ferramenta: Claude Code, Codex...) e o que o resto do servidor espera delas.
//
// Cada fonte observa as sessões ABERTAS da sua ferramenta e alimenta o Office (addMain, addActivity...). O
// servidor liga todas por um SourceSet: o snapshot (meta.sources), o /api/health, o terminal e o caminho do
// transcript de um agente passam por ele, sem saber de qual ferramenta o agente vem. Hoje só existe a do Claude
// Code (sources/watcher.ts, ClaudeWatcher); a do Codex entra pelo mesmo contrato.
//
// Histórico do terminal (sessões recentes, abertas ou encerradas): um HistoryProvider por ferramenta, juntos num
// HistorySet que atende as rotas /api/sessions/*. O do Claude Code é o SessionHistory (sources/history.ts).
//
// Boot: a fonte que reconstrói as sessões abertas ao começar chama office.beginBoot() antes e office.endBoot()
// depois, SEMPRE em par (num `finally`, inclusive num boot assíncrono). O Office conta os boots: enquanto alguma
// fonte boota não há avisos e o feed fica guardado para sair em ordem cronológica no fim do último boot (uma fonte
// que nunca chamasse endBoot calaria os avisos de todas).
import type { Provider, RecentSession, SourceInfo } from '../../shared/types';
import { errMsg, log } from '../log';
import { HISTORY_LIMIT } from './history';
import { createTerminalParser, type TerminalParser } from './terminal';
import { tr } from '../../shared/i18n';

/** Uma fonte de agentes: observa as sessões abertas de uma ferramenta e alimenta o Office. */
export interface AgentSource {
  readonly provider: Provider;
  /**
   * Boot (reconstrói as sessões abertas, entre office.beginBoot/endBoot) e o acompanhamento ao vivo. Uma fonte
   * síncrona termina o boot antes de voltar; uma assíncrona devolve a promessa (falhas só vão para o log).
   */
  start(): void | Promise<void>;
  stop(): void;
  /** Uma entrada por conta observada (meta.sources do snapshot e /api/health). */
  sources(): SourceInfo[];
  /** Arquivo da conversa de um agente presente desta fonte; undefined se o agente não é dela (ou ainda sem arquivo). */
  transcriptPathOf(agentId: string): string | undefined;
  /**
   * Parser do terminal para a conversa de um agente desta fonte: um NOVO a cada chamada (parsers guardam estado).
   * Ausente, ou undefined, = o do Claude Code (createTerminalParser).
   */
  terminalParser?(agentId: string): TerminalParser | undefined;
}

/** Todas as fontes de agentes ligadas, vistas como uma só. */
export class SourceSet {
  private readonly list: AgentSource[] = [];

  constructor(sources: readonly AgentSource[] = []) {
    for (const s of sources) this.add(s);
  }

  /** Acrescenta uma fonte (antes de start()). */
  add(source: AgentSource): void {
    this.list.push(source);
  }

  all(): readonly AgentSource[] {
    return this.list;
  }

  /** A fonte de uma ferramenta, se estiver ligada. */
  of(provider: Provider): AgentSource | undefined {
    return this.list.find((s) => s.provider === provider);
  }

  /**
   * Liga as fontes na ordem em que entraram: as síncronas terminam o boot aqui mesmo (antes de o hub começar a
   * transmitir). A falha de uma não impede as outras: vai para o log. A promessa resolve quando as assíncronas
   * terminarem de ligar.
   */
  start(): Promise<void> {
    const pending: Promise<void>[] = [];
    for (const s of this.list) {
      const failed = (err: unknown) => log.error(tr('Fonte de agentes {0}: falha ao iniciar ({1}).', [s.provider, errMsg(err)]));
      try {
        const r = s.start();
        if (r) pending.push(r.catch(failed));
      } catch (err) {
        failed(err);
      }
    }
    return Promise.all(pending).then(() => undefined);
  }

  stop(): void {
    for (const s of this.list) {
      try {
        s.stop();
      } catch (err) {
        log.warn(tr('Fonte de agentes {0}: falha ao parar ({1}).', [s.provider, errMsg(err)]));
      }
    }
  }

  sources(): SourceInfo[] {
    return this.list.flatMap((s) => s.sources());
  }

  /** Arquivo da conversa de um agente presente (a primeira fonte que o conhece). */
  transcriptPathOf(agentId: string): string | undefined {
    for (const s of this.list) {
      const path = s.transcriptPathOf(agentId);
      if (path) return path;
    }
    return undefined;
  }

  /**
   * Parser NOVO para o terminal de um agente: o da fonte que conhece o transcript dele (transcriptPathOf); sem
   * fonte, ou se ela não tiver um próprio, o do Claude Code.
   */
  parserFor(agentId: string): TerminalParser {
    const owner = this.list.find((s) => s.transcriptPathOf(agentId) !== undefined);
    return owner?.terminalParser?.(agentId) ?? createTerminalParser();
  }
}

// ------------------------------------------------------------------ histórico do terminal

/** Sessão do histórico achada: o arquivo da conversa e o parser do terminal para ele. */
export interface HistorySession {
  path: string;
  /** Parser NOVO a cada chamada (o terminal cria outro quando o arquivo é truncado ou substituído). */
  createParser: () => TerminalParser;
}

/** Resultado de resolve(): a sessão ou o erro HTTP. */
export type HistoryResolveResult = HistorySession | { status: 400 | 404; error: string };

/** O que as rotas /api/sessions/* precisam: um provedor sozinho ou o HistorySet. */
export interface SessionLookup {
  /** Sessões recentes, da atividade mais recente para a mais antiga. */
  list(): Promise<RecentSession[]>;
  /**
   * Valida e acha a sessão `sessionId` da conta (nada de path traversal). Nunca lança: 400 = id inválido,
   * 404 = conta ou sessão desconhecida.
   */
  resolve(account: string, sessionId: string): HistoryResolveResult;
}

/** Histórico de uma ferramenta: as sessões recentes das contas dela. */
export interface HistoryProvider extends SessionLookup {
  readonly provider: Provider;
  /** A conta é deste provedor (o HistorySet manda o resolve() dela para cá). */
  hasAccount(account: string): boolean;
}

/**
 * Junta o histórico de todas as ferramentas: a listagem de todos (da atividade mais recente para a mais antiga,
 * até `limit`) e cada sessão resolvida pelo provedor da conta. Conta que nenhum provedor conhece vai para o
 * primeiro (o do Claude Code), que dá o erro de sempre (400 para id inválido, senão 404).
 */
export class HistorySet implements SessionLookup {
  private readonly list_: HistoryProvider[] = [];

  constructor(
    providers: readonly HistoryProvider[] = [],
    private readonly limit = HISTORY_LIMIT,
  ) {
    for (const p of providers) this.add(p);
  }

  add(provider: HistoryProvider): void {
    this.list_.push(provider);
  }

  /** Um provedor que falha não derruba a listagem dos outros (só vai para o log); todos falhando, a falha sobe. */
  async list(): Promise<RecentSession[]> {
    const results = await Promise.allSettled(this.list_.map((p) => p.list()));
    const out: RecentSession[] = [];
    const failures: Array<{ provider: Provider; err: unknown }> = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') out.push(...r.value);
      else failures.push({ provider: this.list_[i].provider, err: r.reason });
    });
    if (failures.length && failures.length === results.length) throw failures[0].err;
    for (const f of failures) {
      log.warnOnce(`history-list:${f.provider}:${errMsg(f.err)}`, tr('Histórico de sessões ({0}): falha ao listar ({1}).', [f.provider, errMsg(f.err)]));
    }
    return out.sort((a, b) => b.lastAt - a.lastAt).slice(0, this.limit);
  }

  resolve(account: string, sessionId: string): HistoryResolveResult {
    const owner = this.list_.find((p) => p.hasAccount(account)) ?? this.list_[0];
    return owner ? owner.resolve(account, sessionId) : { status: 404, error: tr('conta desconhecida') };
  }
}
