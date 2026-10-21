// Histórico do terminal (rotas /api/sessions/*): a trava (recurso desligado ou Host que não é local = 403),
// a validação de conta/id/caminho contra path traversal (400/404), métodos (405) e o SSE de uma sessão
// encerrada (init com a conversa do transcript, append do que for acrescentado), com o parser real. Como no
// servidor, as rotas passam pelo HistorySet (o do Claude Code e, num teste, o de outra ferramenta).
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { RecentSessionsResponse, TerminalEntry, TerminalInit } from '../../shared/types';
import { AccountsService } from '../accounts/service';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { openMainAgent, SessionHistory } from '../sources/history';
import { HistorySet, type HistoryProvider } from '../sources/source';
import { encodeCwd } from '../sources/watcher';
import { appendLines, L, symlinkOrSkip, tempDir, writeLines } from '../test/fixtures';
import { createApiHandler } from './app';
import { createRequestGuard } from './guard';
import { Hub } from './sse';
import { TerminalStreams } from './terminal';

setQuiet(true);

const SID = '00000000-0000-4000-8000-0000000000a1';
const OPEN_SID = '00000000-0000-4000-8000-0000000000b2';
const CWD = '/projetos/loja';

interface Served {
  base: string;
  port: string;
  root: string;
  dir: string;
  transcript: string;
  terminals: TerminalStreams;
  close: () => Promise<void>;
}

async function serve(opts: { terminal?: boolean; extra?: (root: string) => HistoryProvider } = {}): Promise<Served> {
  const tmp = tempDir();
  const terminal = opts.terminal ?? true;
  const dir = join(tmp.dir, '.claude');
  const now = Date.now();
  const transcript = join(dir, 'projects', encodeCwd(CWD), `${SID}.jsonl`);
  writeLines(transcript, [
    L.prompt('Arruma o carrinho', { at: now - 60_000 }),
    L.assistant([L.text('Pronto: o carrinho soma o frete.')], { at: now - 50_000, stop: 'end_turn' }),
    L.raw('ai-title', { aiTitle: 'Carrinho de compras' }),
  ]);
  writeLines(join(dir, 'projects', encodeCwd(CWD), `${OPEN_SID}.jsonl`), [L.prompt('Ainda aberta', { at: now - 10_000 })]);
  const accounts = new AccountsService({ dirs: [dir], home: tmp.dir, env: {}, onChange: () => {} });
  const office = new Office({
    names: new NameStore(null),
    version: 't',
    startedAt: now,
    accounts: (s) => accounts.list(s),
    sources: () => [],
    accountName: () => undefined,
    terminal,
  });
  office.addMain({ id: '.claude:7', account: '.claude', sessionId: OPEN_SID, cwd: CWD, role: 'Agente principal', startedAt: now, status: 'working' });
  const hub = new Hub(office, { throttleMs: 10 });
  const terminals = new TerminalStreams({ office, transcriptPathOf: () => undefined, sessionPollMs: 20 });
  const history = new HistorySet([new SessionHistory({ accounts: () => accounts.entries(), openAgentOf: (acc, sid) => openMainAgent(office.list(), acc, sid) })]);
  if (opts.extra) history.add(opts.extra(tmp.dir));
  const api = createApiHandler({ office, hub, accounts, sources: () => [], version: 't', inDocker: false, terminal, terminals, sessions: history });
  const guard = createRequestGuard({ allowedHosts: new Set(['habblaud.lan']) });
  const server = http.createServer((req, res) => {
    if (guard(req, res)) return;
    if (!api(req, res, new URL(req.url ?? '/', 'http://x'))) res.writeHead(404).end();
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = String((server.address() as AddressInfo).port);
  return {
    base: `http://127.0.0.1:${port}`,
    port,
    root: tmp.dir,
    dir,
    transcript,
    terminals,
    close: () =>
      new Promise((ok) => {
        terminals.stop();
        hub.stop();
        server.closeAllConnections();
        server.close(() => {
          tmp.cleanup();
          ok();
        });
      }),
  };
}

interface Res {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  events: Array<{ event: string; data: unknown }>;
  close: () => void;
}

/** Requisição crua (caminho sem normalização, Host trocável); interpreta o SSE, se for um. */
function request(base: string, path: string, opts: { method?: string; headers?: Record<string, string> } = {}): Promise<Res> {
  const u = new URL(base);
  return new Promise((ok, fail) => {
    const req = http.request({ host: u.hostname, port: u.port, path, method: opts.method ?? 'GET', headers: opts.headers }, (res) => {
      const out: Res = { status: res.statusCode ?? 0, headers: res.headers, body: '', events: [], close: () => req.destroy() };
      res.setEncoding('utf8');
      res.on('error', () => {});
      if (!String(res.headers['content-type']).startsWith('text/event-stream')) {
        res.on('data', (c: string) => (out.body += c));
        res.on('end', () => ok(out));
        return;
      }
      let buf = '';
      res.on('data', (c: string) => {
        buf += c;
        for (let i = buf.indexOf('\n\n'); i !== -1; i = buf.indexOf('\n\n')) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const event = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (event && data !== undefined) out.events.push({ event, data: JSON.parse(data) });
        }
      });
      ok(out);
    });
    req.on('error', fail);
    req.end();
  });
}

const terminalRoute = (account: string, sid: string) => `/api/sessions/${encodeURIComponent(account)}/${encodeURIComponent(sid)}/terminal`;
const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 3_000, interval: 10 });

describe('histórico de sessões: trava', () => {
  it('recurso desligado: 403 nas duas rotas', async () => {
    const env = await serve({ terminal: false });
    try {
      for (const path of ['/api/sessions/recent', terminalRoute('.claude', SID)]) {
        const r = await request(env.base, path);
        expect(r.status).toBe(403);
        expect(JSON.parse(r.body).error).toMatch(/desligado/);
      }
      expect(env.terminals.size).toBe(0);
    } finally {
      await env.close();
    }
  });

  it('Host que não é local (IP da rede ou nome de HABBLAUD_ALLOWED_HOSTS): 403; localhost abre', async () => {
    const env = await serve();
    try {
      for (const host of [`192.168.0.10:${env.port}`, `habblaud.lan:${env.port}`]) {
        for (const path of ['/api/sessions/recent', terminalRoute('.claude', SID)]) {
          const r = await request(env.base, path, { headers: { Host: host } });
          expect(r.status).toBe(403);
          expect(JSON.parse(r.body).error).toMatch(/próprio computador/);
        }
      }
      expect(env.terminals.size).toBe(0);
      const ok = await request(env.base, '/api/sessions/recent', { headers: { Host: `localhost:${env.port}` } });
      expect(ok.status).toBe(200);
    } finally {
      await env.close();
    }
  });
});

describe('histórico de sessões: listagem', () => {
  it('GET /api/sessions/recent: aberta (com o agente) e encerrada, da mais recente para a mais antiga', async () => {
    const env = await serve();
    try {
      const r = await request(env.base, '/api/sessions/recent');
      expect(r.status).toBe(200);
      expect(r.headers['cache-control']).toBe('no-store');
      const body = JSON.parse(r.body) as RecentSessionsResponse;
      expect(body).toMatchObject({ days: 7, limit: 150 });
      expect(body.sessions.map((s) => [s.sessionId, s.open, s.agentId])).toEqual([
        [OPEN_SID, true, '.claude:7'],
        [SID, false, undefined],
      ]);
      expect(body.sessions[1]).toMatchObject({ account: '.claude', title: 'Carrinho de compras', projectDir: encodeCwd(CWD) });
    } finally {
      await env.close();
    }
  });

  it('métodos: POST/PUT -> 405; HEAD vale só na listagem; subrota desconhecida -> 404', async () => {
    const env = await serve();
    try {
      const json = { 'Content-Type': 'application/json' };
      const post = await request(env.base, '/api/sessions/recent', { method: 'POST', headers: json });
      expect(post.status).toBe(405);
      expect(post.headers.allow).toBe('GET, HEAD');
      expect((await request(env.base, '/api/sessions/recent', { method: 'HEAD' })).status).toBe(200);
      const head = await request(env.base, terminalRoute('.claude', SID), { method: 'HEAD' });
      expect(head.status).toBe(405);
      expect(head.headers.allow).toBe('GET');
      expect((await request(env.base, terminalRoute('.claude', SID), { method: 'PUT', headers: json })).status).toBe(405);
      for (const path of ['/api/sessions/', '/api/sessions/x', `/api/sessions/.claude/${SID}`, `/api/sessions/.claude/${SID}/terminal/x`]) {
        expect((await request(env.base, path)).status).toBe(404);
      }
    } finally {
      await env.close();
    }
  });
});

describe('histórico de sessões: validação (path traversal)', () => {
  it('id que não é UUID: 400; conta desconhecida ou fora de projects/: 404; nunca abre o arquivo de fora', async ({ skip }) => {
    const env = await serve();
    try {
      writeFileSync(join(env.root, 'segredo.jsonl'), `${L.prompt('não pode sair')}\n`);
      const bad400 = [
        `/api/sessions/.claude/..%2F..%2Fsegredo/terminal`,
        `/api/sessions/.claude/${SID}%2F..%2F${SID}/terminal`,
        `/api/sessions/.claude/${SID}.jsonl/terminal`,
        `/api/sessions/.claude/%E0%A4%A/terminal`,
        `/api/sessions/%E0%A4%A/${SID}/terminal`,
      ];
      for (const path of bad400) {
        const r = await request(env.base, path);
        expect(r.status, path).toBe(400);
        expect(r.events).toEqual([]);
      }
      const bad404 = [
        `/api/sessions/..%2F..%2F/${SID}/terminal`,
        `/api/sessions/.claude%2F..%2F.claude/${SID}/terminal`,
        `/api/sessions/${encodeURIComponent(env.dir)}/${SID}/terminal`,
        `/api/sessions/.claude-outra/${SID}/terminal`,
        terminalRoute('.claude', '00000000-0000-4000-8000-000000000999'),
        // Segmentos ".." (crus ou %2e%2e): a URL normalizada sai de /api/sessions/ (rota desconhecida).
        `/api/sessions/.claude/../../segredo/terminal`,
        `/api/sessions/.claude/%2e%2e/terminal`,
      ];
      for (const path of bad404) {
        const r = await request(env.base, path);
        expect(r.status, path).toBe(404);
        expect(r.events).toEqual([]);
      }
      // Link dentro de projects/ apontando para fora: 404.
      const linked = '00000000-0000-4000-8000-0000000000c3';
      symlinkOrSkip(skip, join(env.root, 'segredo.jsonl'), join(env.dir, 'projects', encodeCwd(CWD), `${linked}.jsonl`));
      mkdirSync(join(env.dir, 'projects', 'vazio'), { recursive: true });
      const r = await request(env.base, terminalRoute('.claude', linked));
      expect(r.status).toBe(404);
      expect(JSON.parse(r.body)).toEqual({ error: 'sessão não encontrada' });
      expect(env.terminals.size).toBe(0);
    } finally {
      await env.close();
    }
  });
});

describe('histórico de sessões: outra ferramenta', () => {
  const XID = '019a0000-0000-7000-8000-0000000000d4';
  /** Provedor fictício da conta ".codex": uma sessão, lida com um parser próprio (cada linha vira "cx-<n>"). */
  const codexHistory = (root: string): HistoryProvider => {
    const path = join(root, 'rollout.jsonl');
    writeFileSync(path, 'a\nb\n');
    let n = 0;
    return {
      provider: 'codex',
      hasAccount: (a) => a === '.codex',
      list: async () => [{ account: '.codex', provider: 'codex', sessionId: XID, projectDir: '2026/10/09', lastAt: Date.now() + 60_000, size: 4, open: false }],
      resolve: (_account, sessionId) =>
        sessionId === XID
          ? { path, createParser: () => ({ push: (): TerminalEntry[] => [{ kind: 'user', id: `cx-${++n}`, at: 0, text: 'cx' }] }) }
          : { status: 404, error: 'sessão não encontrada' },
    };
  };

  it('listagem junta as ferramentas; o terminal da sessão usa o parser da ferramenta dela', async () => {
    const env = await serve({ extra: codexHistory });
    try {
      const body = JSON.parse((await request(env.base, '/api/sessions/recent')).body) as RecentSessionsResponse;
      expect(body.sessions.map((s) => [s.account, s.sessionId, s.provider])).toEqual([
        ['.codex', XID, 'codex'],
        ['.claude', OPEN_SID, undefined],
        ['.claude', SID, undefined],
      ]);
      const s = await request(env.base, terminalRoute('.codex', XID));
      expect(s.status).toBe(200);
      await waitFor(() => expect(s.events.filter((e) => e.event === 'init')).toHaveLength(1));
      const init = s.events[0].data as TerminalInit;
      expect(init.agentId).toBe(`session:.codex:${XID}`);
      expect(init.entries.map((e) => e.id)).toEqual(['cx-1', 'cx-2']);
      s.close();
      // A conta do Claude Code continua com o parser dele; a desconhecida, com os erros de sempre.
      const c = await request(env.base, terminalRoute('.claude', SID));
      await waitFor(() => expect(c.events.filter((e) => e.event === 'init')).toHaveLength(1));
      expect((c.events[0].data as TerminalInit).entries.map((e) => e.kind)).toEqual(['user', 'assistant']);
      c.close();
      expect((await request(env.base, terminalRoute('.codex', '00000000-0000-4000-8000-000000000999'))).status).toBe(404);
      expect(JSON.parse((await request(env.base, terminalRoute('.outra', SID))).body)).toEqual({ error: 'conta desconhecida' });
      expect((await request(env.base, terminalRoute('.outra', 'x'))).status).toBe(400);
    } finally {
      await env.close();
    }
  });
});

describe('histórico de sessões: SSE da sessão encerrada', () => {
  it('init com a conversa do transcript (parser real); depois append do que for acrescentado', async () => {
    const env = await serve();
    try {
      const s = await request(env.base, terminalRoute('.claude', SID));
      expect(s.status).toBe(200);
      expect(s.headers['content-type']).toMatch(/^text\/event-stream/);
      await waitFor(() => expect(s.events.filter((e) => e.event === 'init')).toHaveLength(1));
      const init = s.events[0].data as TerminalInit;
      expect(init.agentId).toBe(`session:.claude:${SID}`);
      expect(init.truncated).toBe(false);
      expect(init.entries.map((e) => [e.kind, 'text' in e ? e.text : undefined])).toEqual([
        ['user', 'Arruma o carrinho'],
        ['assistant', 'Pronto: o carrinho soma o frete.'],
      ]);
      expect(env.terminals.size).toBe(1);
      // Retomada com /resume: o transcript cresce e o stream acompanha.
      appendLines(env.transcript, [L.prompt('Mais uma coisa')]);
      await waitFor(() => {
        const appended = s.events.filter((e) => e.event === 'append').flatMap((e) => e.data as TerminalEntry[]);
        expect(appended.map((e) => e.kind === 'user' && e.text)).toEqual(['Mais uma coisa']);
      });
      s.close();
      await waitFor(() => expect(env.terminals.size).toBe(0));
    } finally {
      await env.close();
    }
  });
});
