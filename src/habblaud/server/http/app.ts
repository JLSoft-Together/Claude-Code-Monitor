// Rotas da API (/api/*). Respostas JSON; rotas desconhecidas -> 404 JSON.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { NAME_MAX, parseAppearanceParts, parseCharacterName, parseSeed } from '../../shared/appearance';
import type { AccessInfo, AgentInfo, ModSummary, OfficeSnapshot, SourceInfo, UpdateStatus } from '../../shared/types';
import type { AccountsService } from '../accounts/service';
import { handleCodexEvent } from '../codex/http';
import type { DayStatsService } from '../history/daystats';
import type { Office } from '../model/office';
import type { CodexLive } from '../sources/codex/live';
import type { SessionLookup } from '../sources/source';
import { isJsonContentType, isLoopbackHost } from './guard';
import type { RemoteFeature } from './remote';
import { handleSessionsRoute } from './sessions';
import type { Hub } from './sse';
import { handleStatsRoute } from './stats';
import type { TerminalStreams } from './terminal';
import { tr } from '../../shared/i18n';
import type { SpawnService } from '../spawn/spawn';
import { ATTACHMENT_BODY_MAX, parseAttachment, type AttachmentStore } from '../spawn/attachments';
import type { SpawnFolder } from '../spawn/folders';
import { AUDIO_BODY_MAX, type DictationService } from '../dictation/dictation';
import type { DeliveryIndex } from '../deliveries/deliveries';
import type { FileFetcher } from '../deliveries/fetcher';
import { HOST_WAIT_MS } from '../host-wait';

export interface ApiDeps {
  office: Office;
  hub: Hub;
  accounts: AccountsService;
  sources: () => SourceInfo[];
  version: string;
  inDocker: boolean;
  /** Terminal ligado (ServerConfig.terminal: só com bind local). */
  terminal?: boolean;
  /** Streams do terminal; sem eles o recurso fica desligado mesmo com `terminal`. */
  terminals?: TerminalStreams;
  /**
   * Histórico de sessões do terminal (GET /api/sessions/*, http/sessions.ts): o HistorySet de todas as ferramentas
   * (ou um provedor sozinho); mesma trava do terminal.
   */
  sessions?: SessionLookup;
  /** Rotas do timelapse (/api/timeline/*, ver http/timeline.ts); devolve false para o resto. */
  timeline?: (req: IncomingMessage, res: ServerResponse, url: URL) => boolean;
  /**
   * Rotas de /api/permissions (responder pelo escritório, server/permissions/http.ts). Só existem com bind
   * local (ServerConfig.terminal); a trava do Host local é conferida aqui antes de chamá-las.
   */
  permissions?: (req: IncomingMessage, res: ServerResponse, path: string) => void;
  /**
   * Rotas das mensagens pelo escritório (/api/messages, a caixa de entrada do plugin em /api/mod/inbox e a do auxiliar
   * do Codex em /api/codex/bridge/*, server/messages/http.ts). Só existem com ServerConfig.messages (a trava do
   * terminal e HABBLAUD_MENSAGENS); a trava do Host local é conferida aqui antes de chamá-las.
   */
  messages?: (req: IncomingMessage, res: ServerResponse, path: string) => void;
  /**
   * Terminal interativo e ações nos agentes (/api/pty/*, POST /api/agents/:id/stop|takeover; http/pty.ts).
   * Ausente = desligado (sem HABBLAUD_PTY=1, Docker, sem node-pty ou sem bind local).
   */
  pty?: (req: IncomingMessage, res: ServerResponse, path: string) => void;
  /**
   * Fonte do Codex ao vivo: recebe os eventos dos hooks do Codex (POST /api/codex/events, server/codex/http.ts). Sem
   * ela a rota responde {ok: false}. Só com Host local e, fora do Docker, conexão pelo loopback (os eventos só observam:
   * não dependem da trava do terminal).
   */
  codexLive?: CodexLive;
  /** Novo agente pelo escritório (/api/spawn e, para o auxiliar do host, /api/host/spawn/*; server/spawn/spawn.ts). */
  spawn?: SpawnService;
  /** Pastas sugeridas no "Novo agente" (GET /api/spawn/folders; spawn/folders.ts): projetos recentes. */
  spawnFolders?: () => Promise<SpawnFolder[]>;
  /** Anexos do "Novo agente" (POST /api/spawn/attachments; spawn/attachments.ts). */
  attachments?: AttachmentStore;
  /** Ditado (/api/dictation e, para o auxiliar do host, /api/host/dictation/*; dictation/dictation.ts). */
  dictation?: DictationService;
  /** Entregas (GET /api/deliveries e os anexos em /api/deliveries/file/:id; deliveries/deliveries.ts). */
  deliveries?: DeliveryIndex;
  /** Quem lê os arquivos das entregas (e, para o auxiliar do host, /api/host/files/*; deliveries/fetcher.ts). */
  files?: FileFetcher;
  /** Renomeia a sala (POST /api/rooms/rename {id, name}; vazio volta ao padrão). Devolve o nome em uso, ou undefined se a sala não existe. */
  renameRoom?: (id: string, name: string) => string | undefined;
  /** Estatísticas do "Meu dia" (GET /api/stats, http/stats.ts). */
  stats?: DayStatsService;
  /** Verificação de versão nova no GitHub (GET /api/updates, POST /api/updates/check; updates/checker.ts). */
  updates?: {
    status(): UpdateStatus;
    check(opts: { manual?: boolean }): Promise<UpdateStatus>;
  };
  /**
   * Porta remota com login (http/remote.ts): `is` diz se a requisição chegou por ela (já autenticada); `allows`, o que
   * HABBLAUD_REMOTE_ALLOW libera. Requisição remota nunca vale pelo Host: só pelo que `allows` liberar.
   */
  remote?: { is(req: IncomingMessage): boolean; allows(feature: RemoteFeature): boolean };
  /**
   * Rotas do Habblaud World (/api/world/*, server/world/http.ts). Ausente = HABBLAUD_WORLD=0: 404 em todas. Só pela porta
   * local com Host local: pela porta do celular, nem com login (403 `local_only`).
   */
  world?: (req: IncomingMessage, res: ServerResponse, url: URL) => void;
}

/** GET /api/agents/:id/terminal (ids nunca contêm '/'). */
const TERMINAL_ROUTE = /^\/api\/agents\/([^/]+)\/terminal$/;
/** POST /api/agents/:id/stop|takeover (terminal interativo). */
const AGENT_ACTION_ROUTE = /^\/api\/agents\/[^/]+\/(stop|takeover)$/;

/** PUT|DELETE /api/agents/:id/character: personagem do projeto (ver Office.setCharacter). */
const CHARACTER_ROUTE = /^\/api\/agents\/([^/]+)\/character$/;
const NOT_EDITABLE = tr('agente não encontrado: só o agente principal de uma sessão aberta tem personagem editável');

/** Conexão vinda do próprio computador (127.x, ::1 ou ::ffff:127.x). */
function isLoopbackAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  const a = addr.replace(/^::ffff:/i, '');
  return a === '::1' || /^127\./.test(a);
}

/** Rotas das mensagens pelo escritório (server/messages/http.ts); /api/mod/summary fica de fora (sem trava). */
/**
 * Rotas dos hooks, dos plugins e do auxiliar do host: registrar e esperar pedidos de permissão, buscar as mensagens de
 * uma sessão, as rodadas do auxiliar. Só valem pela porta local; pela remota, nem com login (o celular aprova e manda
 * mensagens pelas rotas da página).
 */
function isLocalOnlyPath(path: string): boolean {
  return (
    path === '/api/permissions' ||
    /^\/api\/permissions\/[^/]+\/wait$/.test(path) ||
    path === '/api/mod/inbox' ||
    path === '/api/mod/inbox/ack' ||
    path.startsWith('/api/codex/') ||
    path.startsWith('/api/host/')
  );
}

function isMessagesPath(path: string): boolean {
  return (
    path === '/api/messages' ||
    path.startsWith('/api/messages/') ||
    path === '/api/mod/inbox' ||
    path === '/api/mod/inbox/ack' ||
    path === '/api/codex/bridge/poll' ||
    path === '/api/codex/bridge/ack'
  );
}

const MAX_BODY = 256 * 1024;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    // A API só é lida pela própria página: nada de leitura "no-cors" por outras origens.
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  res.end(data);
}

/**
 * Anexo de entrega. Páginas e SVG vêm numa sandbox sem scripts (CSP), para não rodarem com o login do escritório;
 * PDF e imagens podem abrir dentro do modal (mesma origem).
 */
function sendFile(res: ServerResponse, data: Buffer, type: string, name: string): void {
  const active = /^text\/html|^image\/svg/.test(type);
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': data.length,
    'Cache-Control': 'private, max-age=300',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
    ...(active ? { 'Content-Security-Policy': "sandbox; default-src 'none'; img-src data: blob: 'self'; style-src 'unsafe-inline'; media-src 'self'" } : {}),
  });
  res.end(data);
}

/** Lê o corpo JSON. Exige `Content-Type: application/json` (barreira contra CSRF; ver http/guard.ts). */
export function readJson(req: IncomingMessage, max = MAX_BODY): Promise<unknown> {
  if (!isJsonContentType(req.headers['content-type'])) {
    req.resume();
    return Promise.reject(new HttpError(415, tr('envie o corpo como JSON (Content-Type: application/json)')));
  }
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      // Grande demais: continua drenando (sem guardar) para conseguir responder 413.
      if (size > max) return void fail(new HttpError(413, tr('corpo grande demais')));
      chunks.push(c);
    });
    req.on('end', () => {
      if (size > max) return;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return ok({});
      try {
        ok(JSON.parse(raw));
      } catch {
        fail(new HttpError(400, tr('JSON inválido')));
      }
    });
    req.on('error', fail);
  });
}

/** Resumo da verificação de versão nova para o /api/health. */
function updatesSummary(s: UpdateStatus | undefined): { state: UpdateStatus['state']; latest?: string; available: boolean } {
  return s ? { state: s.state, latest: s.latest, available: s.available } : { state: 'off', available: false };
}

/** Subagentes aninhados mais fundo que isto não existem na prática; o limite só evita laço num parentId torto. */
const MAX_PARENT_HOPS = 16;

/**
 * Resumo para o mod do Claude Code (GET /api/mod/summary, ver ModSummary). `isReal` diz quem é agente de
 * verdade: os do demo vivem só no snapshot (não no Office), então `office.has(id)` os separa sem depender
 * do prefixo "demo:". A própria sessão sai quando vem `session` (e, se vier, `account` também precisa
 * bater): o principal tem o sessionId atual da sessão (troca no /clear) e os subagentes guardam o da
 * sessão que os disparou; por garantia, um subagente também sai quando algum ancestral (parentId) é dela.
 */
export function modSummary(
  snap: OfficeSnapshot,
  isReal: (id: string) => boolean,
  version: string,
  own: { account?: string; session?: string } = {},
): ModSummary {
  const byId = new Map(snap.agents.map((a) => [a.id, a]));
  const rooms = new Map(snap.rooms.map((r) => [r.id, r.name]));
  const isOwn = (a: AgentInfo): boolean => {
    if (!own.session || (own.account && a.account !== own.account)) return false;
    let cur: AgentInfo | undefined = a;
    for (let hops = 0; cur && hops <= MAX_PARENT_HOPS; hops++) {
      if (cur.sessionId === own.session) return true;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return false;
  };
  const present = snap.agents.filter((a) => isReal(a.id) && a.status !== 'offline' && a.status !== 'done' && !isOwn(a));
  const waiting = present
    .filter((a) => a.status === 'waiting')
    .sort((a, b) => a.statusSince - b.statusSince || a.id.localeCompare(b.id))
    .map((a) => ({
      id: a.id,
      name: a.name,
      room: rooms.get(a.roomId) ?? a.roomId,
      account: a.account,
      waitingFor: a.waitingFor ?? tr('responder no terminal'),
      since: a.statusSince,
      answerable: !!a.permission,
    }));
  return { version, agents: present.length, working: present.filter((a) => a.status === 'working').length, waiting };
}

/** Devolve um handler que trata /api/* e responde false para o resto. */
export function createApiHandler(deps: ApiDeps): (req: IncomingMessage, res: ServerResponse, url: URL) => boolean {
  const { office, hub, accounts } = deps;
  const terminals = deps.terminal ? deps.terminals : undefined;

  const isRemote = (req: IncomingMessage): boolean => !!deps.remote?.is(req);
  /**
   * A trava "pelo próprio computador": na porta local, o Host precisa ser loopback (como antes); na porta remota, só o
   * que HABBLAUD_REMOTE_ALLOW liberar (`feature` ausente = nunca pela porta remota).
   */
  const trusted = (req: IncomingMessage, feature?: RemoteFeature): boolean =>
    isRemote(req) ? !!feature && !!deps.remote?.allows(feature) : isLoopbackHost(req.headers.host);
  const denied = (req: IncomingMessage, localMessage: string): string =>
    isRemote(req) ? tr('não liberado no acesso remoto (veja HABBLAUD_REMOTE_ALLOW)') : localMessage;

  const methodNotAllowed = (res: ServerResponse, allow: string) => {
    res.setHeader('Allow', allow);
    sendJson(res, 405, { error: tr('método não permitido') });
  };

  const handleDemo = async (req: IncomingMessage, res: ServerResponse) => {
    const body = (await readJson(req)) as { enabled?: unknown };
    if (typeof body?.enabled !== 'boolean') throw new HttpError(400, tr('esperado {enabled: boolean}'));
    office.setDemo(body.enabled);
    sendJson(res, 200, { ok: true, demo: office.isDemo() });
  };

  const handleCharacter = async (req: IncomingMessage, res: ServerResponse, id: string, method: string) => {
    if (method === 'DELETE') {
      req.resume();
      if (office.resetCharacter(id) === 'not-found') return sendJson(res, 404, { error: NOT_EDITABLE });
      return sendJson(res, 200, { ok: true });
    }
    const body = (await readJson(req)) as { name?: unknown; seed?: unknown; parts?: unknown } | null;
    const name = parseCharacterName(body?.name);
    const seed = parseSeed(body?.seed);
    const parts = parseAppearanceParts(body?.parts);
    if (!name || seed === null || !parts) {
      throw new HttpError(400, tr('esperado {name: texto de 1 a {0} caracteres, seed: inteiro de 0 a 4294967295, parts: peças da aparência}', [NAME_MAX]));
    }
    const r = office.setCharacter(id, { name, seed, parts });
    if (r.result === 'not-found') return sendJson(res, 404, { error: NOT_EDITABLE });
    if (r.result === 'conflict') return sendJson(res, 409, { error: r.message });
    sendJson(res, 200, { ok: true });
  };

  /**
   * Rodada do auxiliar do host: com `?wait=1`, a resposta espera trabalho (até HOST_WAIT_MS). Devolve undefined se a
   * conexão caiu enquanto esperava (nada sai da fila).
   */
  const hostWait = async <T>(res: ServerResponse, url: URL, poll: (ms: number, signal: AbortSignal) => Promise<T[]>): Promise<T[] | undefined> => {
    const ac = new AbortController();
    const abort = () => ac.abort();
    res.once('close', abort);
    try {
      const list = await poll(url.searchParams.get('wait') === '1' ? HOST_WAIT_MS : 0, ac.signal);
      return ac.signal.aborted ? undefined : list;
    } finally {
      res.off('close', abort);
    }
  };

  const fail = (res: ServerResponse, err: unknown) => {
    if (res.headersSent) return void res.destroy();
    if (err instanceof HttpError) sendJson(res, err.status, { error: err.message });
    else sendJson(res, 500, { error: tr('erro interno') });
  };

  return (req, res, url) => {
    const path = url.pathname;
    if (path !== '/api' && !path.startsWith('/api/')) return false;
    const method = req.method ?? 'GET';
    const isRead = method === 'GET' || method === 'HEAD';

    if (isRemote(req) && isLocalOnlyPath(path)) {
      req.resume();
      sendJson(res, 403, { error: tr('rota só do próprio computador (hooks, plugins e o auxiliar do host)') });
      return true;
    }
    if (path === '/api/world' || path.startsWith('/api/world/')) {
      // A conta do Habblaud World age em seu nome: só o próprio computador, como o terminal. O Host local sozinho não
      // basta (o Tailscale chega pelo loopback e o Host se imita): a porta remota nunca passa, nem com login.
      if (!deps.world) {
        req.resume();
        sendJson(res, 404, { error: tr('rota desconhecida') });
      } else if (isRemote(req) || !isLoopbackHost(req.headers.host)) {
        req.resume();
        sendJson(res, 403, { error: { code: 'local_only', message: tr('o Habblaud World só é usado pelo próprio computador (http://localhost)') } });
      } else deps.world(req, res, url);
      return true;
    }
    if (path === '/api/stream') {
      if (method !== 'GET') methodNotAllowed(res, 'GET');
      else hub.attach(req, res);
      return true;
    }
    if (path === '/api/snapshot') {
      if (!isRead) methodNotAllowed(res, 'GET');
      else sendJson(res, 200, hub.current());
      return true;
    }
    if (path === '/api/health') {
      if (!isRead) methodNotAllowed(res, 'GET');
      else {
        const remote = isRemote(req);
        sendJson(res, 200, {
          ok: true,
          version: deps.version,
          demo: office.isDemo(),
          docker: deps.inDocker,
          remote,
          terminal: !!terminals && (!remote || trusted(req, 'terminal')),
          permissions: !!deps.permissions && (!remote || trusted(req, 'permissions')),
          // O terminal interativo (pty) nunca vale pela porta remota.
          pty: !!deps.pty && !remote,
          messages: !!deps.messages && (!remote || trusted(req, 'messages')),
          codexEvents: !!deps.codexLive,
          updates: updatesSummary(deps.updates?.status()),
          sources: deps.sources(),
          accounts: accounts.allEntries().map((a) =>
            a.provider === 'claude'
              ? { id: a.id, usageStatus: accounts.usageView(a.id).status }
              : { id: a.id, provider: a.provider, usageStatus: accounts.usageView(a.id).status },
          ),
        });
      }
      return true;
    }
    if (path === '/api/access') {
      if (!isRead) methodNotAllowed(res, 'GET');
      else {
        const remote = isRemote(req);
        const access: AccessInfo = {
          remote,
          local: !remote && isLoopbackHost(req.headers.host),
          permissions: !!deps.permissions && trusted(req, 'permissions'),
          messages: !!deps.messages && trusted(req, 'messages'),
          terminal: !!terminals && trusted(req, 'terminal'),
          spawn: !!deps.spawn && trusted(req, 'spawn'),
          world: !!deps.world && !!deps.terminal && !remote && isLoopbackHost(req.headers.host),
        };
        sendJson(res, 200, access);
      }
      return true;
    }
    if (path === '/api/mod/summary') {
      // Lido a cada 5 s por sessão com o mod: só contagens e quem espera (nada que o snapshot já não mostre).
      if (!isRead) methodNotAllowed(res, 'GET');
      else {
        const own = { account: url.searchParams.get('account') || undefined, session: url.searchParams.get('session') || undefined };
        sendJson(res, 200, modSummary(hub.current(), (id) => office.has(id), deps.version, own));
      }
      return true;
    }
    const terminalMatch = TERMINAL_ROUTE.exec(path);
    if (terminalMatch) {
      if (method !== 'GET') methodNotAllowed(res, 'GET');
      else if (!terminals) {
        sendJson(res, 403, { error: tr('terminal desligado: ele só funciona com o Habblaud acessível apenas pelo próprio computador') });
      } else if (!trusted(req, 'terminal')) {
        sendJson(res, 403, { error: denied(req, tr('o terminal só abre pelo próprio computador (http://localhost ou http://127.0.0.1)')) });
      } else {
        let id: string;
        try {
          id = decodeURIComponent(terminalMatch[1]);
        } catch {
          sendJson(res, 400, { error: tr('id inválido') });
          return true;
        }
        terminals.attach(req, res, id);
      }
      return true;
    }
    if (path.startsWith('/api/sessions/')) {
      handleSessionsRoute(req, res, path, {
        history: deps.terminal ? deps.sessions : undefined,
        terminals,
        trusted: isRemote(req) ? trusted(req, 'terminal') : undefined,
      });
      return true;
    }
    if (path === '/api/permissions' || path.startsWith('/api/permissions/')) {
      // Responder pelo escritório age sobre as sessões: a mesma trava do terminal (bind local + Host local).
      if (!deps.permissions) {
        sendJson(res, 403, { error: tr('responder pelo escritório desligado: só funciona com o Habblaud acessível apenas pelo próprio computador') });
      } else if (!trusted(req, 'permissions')) {
        sendJson(res, 403, { error: denied(req, tr('pedidos de permissão só são respondidos pelo próprio computador (http://localhost ou http://127.0.0.1)')) });
      } else {
        deps.permissions(req, res, path);
      }
      return true;
    }
    if (path === '/api/pty' || path.startsWith('/api/pty/') || AGENT_ACTION_ROUTE.test(path)) {
      // Executa comandos na máquina: nunca pela porta remota, nem com login (o Host e o endereço de quem conecta não
      // bastam: o Tailscale chega pelo loopback e o Host se imita).
      if (isRemote(req)) sendJson(res, 403, { error: tr('o terminal interativo só pode ser usado no próprio computador') });
      else if (!deps.pty) sendJson(res, 403, { error: tr('terminal interativo desligado (veja o log do servidor)') });
      else deps.pty(req, res, path);
      return true;
    }
    const characterMatch = CHARACTER_ROUTE.exec(path);
    if (characterMatch) {
      // Mudar o personagem age sobre o escritório: a mesma trava do terminal (bind local + Host local).
      if (method !== 'PUT' && method !== 'DELETE') methodNotAllowed(res, 'PUT, DELETE');
      else if (!deps.terminal) {
        sendJson(res, 403, { error: tr('editar o personagem desligado: só funciona com o Habblaud acessível apenas pelo próprio computador') });
      } else if (!trusted(req)) {
        sendJson(res, 403, { error: denied(req, tr('o personagem só é editado pelo próprio computador (http://localhost ou http://127.0.0.1)')) });
      } else {
        let id: string;
        try {
          id = decodeURIComponent(characterMatch[1]);
        } catch {
          sendJson(res, 400, { error: tr('id inválido') });
          return true;
        }
        handleCharacter(req, res, id, method).catch((err) => fail(res, err));
      }
      return true;
    }
    if (path === '/api/codex/events') {
      // Eventos dos hooks do Codex: só observam, mas só valem vindos do próprio computador. Fora do Docker o hook
      // sempre conecta pelo loopback (o Host sozinho um cliente da rede consegue imitar); no Docker ele chega pela porta
      // publicada, com o endereço do gateway.
      if (method !== 'POST') methodNotAllowed(res, 'POST');
      else if (!trusted(req) || (!deps.inDocker && !isLoopbackAddress(req.socket.remoteAddress))) {
        sendJson(res, 403, { error: denied(req, tr('eventos do Codex só são aceitos pelo próprio computador (http://localhost ou http://127.0.0.1)')) });
      } else handleCodexEvent(req, res, { live: deps.codexLive, entries: () => accounts.entriesOf('codex') }).catch((err) => fail(res, err));
      return true;
    }
    if (path === '/api/spawn' || path.startsWith('/api/spawn/')) {
      // Abre uma sessão nova no app do Claude: roda código no computador, então a mesma trava das mensagens.
      const spawn = deps.spawn;
      if (!spawn) sendJson(res, 403, { error: tr('novo agente pelo escritório desligado') });
      else if (!trusted(req, 'spawn')) sendJson(res, 403, { error: denied(req, tr('agentes novos só são abertos pelo próprio computador (http://localhost)')) });
      else if (path === '/api/spawn' && isRead) sendJson(res, 200, { available: spawn.available(), mode: spawn.mode() });
      else if (path === '/api/spawn/folders') {
        if (!isRead) methodNotAllowed(res, 'GET');
        else (deps.spawnFolders ?? (async () => []))().then((folders) => sendJson(res, 200, { folders }), (err) => fail(res, err));
      } else if (path === '/api/spawn/attachments') {
        const store = deps.attachments;
        if (method !== 'POST') methodNotAllowed(res, 'POST');
        else if (!store) sendJson(res, 403, { error: tr('anexos desligados') });
        else
          readJson(req, ATTACHMENT_BODY_MAX)
            .then((body) => {
              const a = parseAttachment(body);
              if ('error' in a) return sendJson(res, 400, { error: a.error });
              const r = store.put(a);
              if ('error' in r) return sendJson(res, 429, { error: r.error });
              sendJson(res, 201, { id: r.id, name: a.name, size: a.data.length });
            })
            .catch((err) => fail(res, err));
      }
      else if (path === '/api/spawn' && method === 'POST') {
        readJson(req)
          .then((body) => {
            const r = spawn.submit(body);
            if ('spawn' in r) return sendJson(res, 201, r.spawn);
            sendJson(res, r.error === 'invalid' ? 400 : r.error === 'too-many' ? 429 : 409, { error: r.reason });
          })
          .catch((err) => fail(res, err));
      } else if (path !== '/api/spawn' && isRead) {
        const info = spawn.get(decodeURIComponent(path.slice('/api/spawn/'.length)));
        if (info) sendJson(res, 200, info);
        else sendJson(res, 404, { error: tr('pedido desconhecido') });
      } else methodNotAllowed(res, path === '/api/spawn' ? 'GET, POST' : 'GET');
      return true;
    }
    if (path === '/api/dictation' || path.startsWith('/api/dictation/')) {
      // Ditado do "Novo agente" e da caixa de mensagem: vale com qualquer uma das duas travas (o texto vira um pedido
      // ou uma mensagem, que continuam com a trava delas ao serem enviados).
      const dictation = deps.dictation;
      if (!dictation) sendJson(res, 403, { error: tr('ditado desligado') });
      else if (!trusted(req, 'spawn') && !trusted(req, 'messages')) {
        sendJson(res, 403, { error: denied(req, tr('o ditado só funciona pelo próprio computador (http://localhost)')) });
      }
      else if (path === '/api/dictation' && isRead) sendJson(res, 200, { available: dictation.available() });
      else if (path === '/api/dictation' && method === 'POST') {
        readJson(req, AUDIO_BODY_MAX)
          .then((body) => {
            const r = dictation.submit(body);
            if ('dictation' in r) return sendJson(res, 201, r.dictation);
            sendJson(res, r.error === 'invalid' ? 400 : r.error === 'too-many' ? 429 : 409, { error: r.reason });
          })
          .catch((err) => fail(res, err));
      } else if (path !== '/api/dictation' && isRead) {
        const info = dictation.get(decodeURIComponent(path.slice('/api/dictation/'.length)));
        if (info) sendJson(res, 200, info);
        else sendJson(res, 404, { error: tr('ditado desconhecido') });
      } else methodNotAllowed(res, path === '/api/dictation' ? 'GET, POST' : 'GET');
      return true;
    }
    if (path === '/api/deliveries' || path.startsWith('/api/deliveries/')) {
      // Entregas mostram a resposta inteira e arquivos do agente: a mesma trava do terminal.
      const deliveries = deps.deliveries;
      if (!deliveries) sendJson(res, 403, { error: tr('entregas desligadas (precisam do terminal: acesso local)') });
      else if (!isRead) methodNotAllowed(res, 'GET');
      else if (!trusted(req, 'terminal')) sendJson(res, 403, { error: denied(req, tr('as entregas só abrem pelo próprio computador (http://localhost)')) });
      else if (path === '/api/deliveries') deliveries.list().then((list) => sendJson(res, 200, { deliveries: list }), (err) => fail(res, err));
      else if (path.startsWith('/api/deliveries/file/')) {
        const att = deliveries.attachment(decodeURIComponent(path.slice('/api/deliveries/file/'.length)));
        if (!att) sendJson(res, 404, { error: tr('anexo desconhecido: atualize a lista de entregas') });
        else if (att.kind === 'capture') sendFile(res, att.data, att.type, att.name);
        else if (!deps.files) sendJson(res, 404, { error: tr('arquivos desligados') });
        else
          deps.files.get(att.path).then(
            (r) => ('data' in r ? sendFile(res, r.data, att.type, att.name) : sendJson(res, r.status, { error: r.error })),
            (err) => fail(res, err),
          );
      } else sendJson(res, 404, { error: tr('rota desconhecida') });
      return true;
    }
    if (path === '/api/host/files/poll' || path === '/api/host/files/ack') {
      // Só o auxiliar do host, pela porta local (nunca pela remota); fora do Docker, só pelo loopback.
      const files = deps.files;
      if (method !== 'POST') methodNotAllowed(res, 'POST');
      else if (!files) sendJson(res, 403, { error: tr('arquivos desligados') });
      else if (!trusted(req) || (!deps.inDocker && !isLoopbackAddress(req.socket.remoteAddress))) {
        sendJson(res, 403, { error: denied(req, tr('só o auxiliar do próprio computador')) });
      } else if (path === '/api/host/files/poll') {
        req.resume();
        hostWait(res, url, (ms, signal) => files.pollWait(ms, signal)).then((list) => list && sendJson(res, 200, { files: list }), (err) => fail(res, err));
      } else {
        readJson(req, 36 * 1024 * 1024)
          .then((body) => {
            files.ack(body);
            sendJson(res, 200, { ok: true });
          })
          .catch((err) => fail(res, err));
      }
      return true;
    }
    if (path === '/api/host/dictation/poll' || path === '/api/host/dictation/ack') {
      // Só o auxiliar do host, pela porta local (nunca pela remota); fora do Docker, só pelo loopback.
      const dictation = deps.dictation;
      if (method !== 'POST') methodNotAllowed(res, 'POST');
      else if (!dictation) sendJson(res, 403, { error: tr('ditado desligado') });
      else if (!trusted(req) || (!deps.inDocker && !isLoopbackAddress(req.socket.remoteAddress))) {
        sendJson(res, 403, { error: denied(req, tr('só o auxiliar do próprio computador')) });
      } else if (path === '/api/host/dictation/poll') {
        req.resume();
        hostWait(res, url, (ms, signal) => dictation.pollWait(ms, signal)).then((list) => list && sendJson(res, 200, { dictations: list }), (err) => fail(res, err));
      } else {
        readJson(req, 512 * 1024)
          .then((body) => {
            dictation.ack(body);
            sendJson(res, 200, { ok: true });
          })
          .catch((err) => fail(res, err));
      }
      return true;
    }
    if (path === '/api/host/spawn/poll' || path === '/api/host/spawn/ack') {
      // Só o auxiliar do host, pela porta local (nunca pela remota); fora do Docker, só pelo loopback.
      const spawn = deps.spawn;
      if (method !== 'POST') methodNotAllowed(res, 'POST');
      else if (!spawn) sendJson(res, 403, { error: tr('novo agente pelo escritório desligado') });
      else if (!trusted(req) || (!deps.inDocker && !isLoopbackAddress(req.socket.remoteAddress))) {
        sendJson(res, 403, { error: denied(req, tr('só o auxiliar do próprio computador')) });
      } else if (path === '/api/host/spawn/poll') {
        req.resume();
        sendJson(res, 200, { spawns: spawn.poll() });
      } else {
        readJson(req)
          .then((body) => {
            spawn.ack(body);
            sendJson(res, 200, { ok: true });
          })
          .catch((err) => fail(res, err));
      }
      return true;
    }
    if (isMessagesPath(path)) {
      // As mensagens entram na sessão como se você as tivesse digitado: a mesma trava (recurso ligado + Host local).
      if (!deps.messages) {
        sendJson(res, 403, {
          error: tr('mensagens pelo escritório desligadas: só funcionam com o Habblaud acessível apenas pelo próprio computador (e sem HABBLAUD_MENSAGENS=0)'),
        });
      } else if (!trusted(req, 'messages')) {
        sendJson(res, 403, { error: denied(req, tr('mensagens só são mandadas pelo próprio computador (http://localhost ou http://127.0.0.1)')) });
      } else {
        deps.messages(req, res, path);
      }
      return true;
    }
    if (path.startsWith('/api/agents/')) {
      if (!isRead) {
        methodNotAllowed(res, 'GET');
        return true;
      }
      let id: string;
      try {
        id = decodeURIComponent(path.slice('/api/agents/'.length));
      } catch {
        sendJson(res, 400, { error: tr('id inválido') });
        return true;
      }
      const detail = office.detail(id);
      if (detail) sendJson(res, 200, detail);
      else sendJson(res, 404, { error: tr('agente não encontrado') });
      return true;
    }
    if (path === '/api/rooms/rename') {
      // Como o personagem: a mesma trava do terminal (bind local + Host local).
      if (method !== 'POST') methodNotAllowed(res, 'POST');
      else if (!deps.terminal) sendJson(res, 403, { error: tr('renomear salas desligado: só funciona com o Habblaud acessível apenas pelo próprio computador') });
      else if (!trusted(req)) sendJson(res, 403, { error: denied(req, tr('renomear salas só pelo próprio computador (http://localhost)')) });
      else
        readJson(req)
          .then((body) => {
            const b = body as { id?: unknown; name?: unknown };
            if (typeof b?.id !== 'string' || typeof b.name !== 'string') throw new HttpError(400, tr('esperado {id, name}'));
            const name = deps.renameRoom?.(b.id, b.name);
            if (name === undefined) throw new HttpError(404, tr('sala não encontrada'));
            sendJson(res, 200, { name });
          })
          .catch((err) => fail(res, err));
      return true;
    }
    if (path === '/api/stats' || path.startsWith('/api/stats/')) {
      handleStatsRoute(req, res, url, deps.stats, sendJson);
      return true;
    }
    if (path === '/api/demo') {
      // Liga o modo demonstração para todo mundo: só pelo computador (o celular com login só vê o que foi liberado).
      if (method !== 'POST') methodNotAllowed(res, 'POST');
      else if (isRemote(req)) sendJson(res, 403, { error: tr('não liberado no acesso remoto (veja HABBLAUD_REMOTE_ALLOW)') });
      else handleDemo(req, res).catch((err) => fail(res, err));
      return true;
    }
    if (path === '/api/updates') {
      if (!isRead) methodNotAllowed(res, 'GET');
      else sendJson(res, 200, { version: deps.version, ...(deps.updates?.status() ?? { state: 'off', available: false }) });
      return true;
    }
    if (path === '/api/updates/check') {
      // "Verificar agora": consulta o GitHub (no máximo uma vez a cada 30 s) e devolve o status novo.
      if (method !== 'POST') methodNotAllowed(res, 'POST');
      else {
        req.resume();
        const updates = deps.updates;
        if (!updates) sendJson(res, 200, { version: deps.version, state: 'off', available: false });
        else
          updates
            .check({ manual: true })
            .then((status) => sendJson(res, 200, { version: deps.version, ...status }))
            .catch((err) => fail(res, err));
      }
      return true;
    }
    if (deps.timeline?.(req, res, url)) return true;
    sendJson(res, 404, { error: tr('rota desconhecida') });
    return true;
  };
}
