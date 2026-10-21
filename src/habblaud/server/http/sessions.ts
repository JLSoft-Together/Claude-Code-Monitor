// Histórico do terminal (rotas /api/sessions/*):
//   GET /api/sessions/recent                       -> RecentSessionsResponse (sessões dos últimos 7 dias)
//   GET /api/sessions/:conta/:sessionId/terminal   -> SSE com o mesmo protocolo do terminal do agente
// Mesma trava do terminal (ServerConfig.terminal + Host local), porque expõem títulos e conversas. A conta
// precisa ser uma das conhecidas, o id precisa ter formato de UUID e o transcript precisa ficar dentro da
// pasta da conta (cada ferramenta valida o seu: sources/history.ts para o Claude Code): nada de path traversal.
// Quem lista e resolve é o HistorySet (sources/source.ts), que junta o histórico de todas as ferramentas.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RecentSessionsResponse } from '../../shared/types';
import { errMsg, log } from '../log';
import { HISTORY_DAYS, HISTORY_LIMIT } from '../sources/history';
import type { SessionLookup } from '../sources/source';
import { sendJson } from './app';
import { isLoopbackHost } from './guard';
import type { TerminalStreams } from './terminal';
import { tr } from '../../shared/i18n';

export interface SessionRoutesDeps {
  /** Ausente = recurso desligado (sem bind local). */
  history?: SessionLookup;
  /** Ausente = terminal desligado. */
  terminals?: TerminalStreams;
  /** Porta remota (http/remote.ts): a decisão já tomada pela API; ausente = trava do Host local, como antes. */
  trusted?: boolean;
}

const RECENT_ROUTE = '/api/sessions/recent';
/** GET /api/sessions/:conta/:sessionId/terminal (segmentos sem '/'; um %2F só aparece depois de decodificar). */
const TERMINAL_ROUTE = /^\/api\/sessions\/([^/]+)\/([^/]+)\/terminal$/;

/** Por que a trava recusa a requisição (undefined = liberada): os mesmos textos do terminal do agente. */
export function sessionsLockError(enabled: boolean, host: string | undefined, trusted?: boolean): string | undefined {
  if (!enabled) return tr('terminal desligado: ele só funciona com o Habblaud acessível apenas pelo próprio computador');
  if (trusted === false) return tr('não liberado no acesso remoto (veja HABBLAUD_REMOTE_ALLOW)');
  if (trusted === undefined && !isLoopbackHost(host)) return tr('o terminal só abre pelo próprio computador (http://localhost ou http://127.0.0.1)');
  return undefined;
}

function decode(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

/** Atende /api/sessions/* (a rota já foi reconhecida pelo prefixo em http/app.ts). */
export function handleSessionsRoute(req: IncomingMessage, res: ServerResponse, path: string, deps: SessionRoutesDeps): void {
  const method = req.method ?? 'GET';
  const terminalMatch = TERMINAL_ROUTE.exec(path);
  const recent = path === RECENT_ROUTE;
  if (!recent && !terminalMatch) return sendJson(res, 404, { error: tr('rota desconhecida') });
  if (method !== 'GET' && !(recent && method === 'HEAD')) {
    res.setHeader('Allow', recent ? 'GET, HEAD' : 'GET');
    return sendJson(res, 405, { error: tr('método não permitido') });
  }
  const { history, terminals } = deps;
  const locked = sessionsLockError(!!history && !!terminals, req.headers.host, deps.trusted);
  if (locked || !history || !terminals) return sendJson(res, 403, { error: locked });

  if (recent) {
    history
      .list()
      .then((sessions) => {
        const body: RecentSessionsResponse = { sessions, days: HISTORY_DAYS, limit: HISTORY_LIMIT };
        sendJson(res, 200, body);
      })
      .catch((err) => {
        log.warnOnce(`history-list:${errMsg(err)}`, tr('Histórico de sessões: falha ao listar ({0}).', [errMsg(err)]));
        if (!res.headersSent) sendJson(res, 500, { error: tr('não foi possível listar as sessões') });
      });
    return;
  }

  const account = decode(terminalMatch![1]);
  const sessionId = decode(terminalMatch![2]);
  if (account === undefined || sessionId === undefined) return sendJson(res, 400, { error: tr('endereço inválido') });
  const found = history.resolve(account, sessionId);
  if ('error' in found) return sendJson(res, found.status, { error: found.error });
  terminals.attachSession(req, res, `session:${account}:${sessionId}`, found.path, found.createParser);
}
