// Terminal: a trava da config (só bind local), os status da rota, o transporte SSE
// (init/append/reset/limite) com um JSONL temporário e parser injetado, o demo e o caminho do transcript
// que o watcher informa.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { appendFileSync, mkdirSync, renameSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { TerminalEntry, TerminalInit } from '../../shared/types';
import { AccountsService } from '../accounts/service';
import { isLoopbackBind, loadConfig, terminalOffReason } from '../config';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import type { TerminalParser } from '../sources/terminal';
import { ClaudeWatcher, encodeCwd } from '../sources/watcher';
import { appendLines, L, tempDir, writeLines } from '../test/fixtures';
import { createApiHandler } from './app';
import { createRequestGuard } from './guard';
import { Hub } from './sse';
import { MAX_STREAMS, TerminalStreams, type TerminalOptions } from './terminal';

setQuiet(true);

describe('trava do terminal (config)', () => {
  it('isLoopbackBind: 127.0.0.0/8, ::1 e localhost', () => {
    for (const v of ['127.0.0.1', '127.1.2.3', ' 127.0.0.1 ', '::1', '[::1]', '0:0:0:0:0:0:0:1', 'localhost', 'LocalHost']) expect(isLoopbackBind(v)).toBe(true);
    for (const v of [undefined, '', '0.0.0.0', '::', '[::]', '192.168.0.10', '10.0.0.5', 'fe80::1', '128.0.0.1', 'meu-mac.local', 'app.localhost', '127.0.0.1.nip.io']) {
      expect(isLoopbackBind(v)).toBe(false);
    }
  });

  it('Node: decide o HABBLAUD_HOST', () => {
    for (const host of ['127.0.0.1', 'localhost', '::1']) expect(terminalOffReason({}, host, false)).toBeUndefined();
    expect(terminalOffReason({}, '0.0.0.0', false)).toBe('a porta está exposta na rede: HABBLAUD_HOST=0.0.0.0');
    for (const host of ['::', '192.168.0.10', 'meu-mac.local']) expect(terminalOffReason({}, host, false)).toMatch(/exposta na rede/);
    // HABBLAUD_BIND só vale no Docker: não liga o modo Node exposto.
    expect(terminalOffReason({ HABBLAUD_BIND: '127.0.0.1' }, '0.0.0.0', false)).toBeDefined();
  });

  it('Docker: decide o HABBLAUD_BIND (ausente ou vazio = desligado)', () => {
    expect(terminalOffReason({ HABBLAUD_BIND: '127.0.0.1' }, '0.0.0.0', true)).toBeUndefined();
    expect(terminalOffReason({ HABBLAUD_BIND: '[::1]' }, '0.0.0.0', true)).toBeUndefined();
    expect(terminalOffReason({}, '0.0.0.0', true)).toMatch(/HABBLAUD_BIND não chegou/);
    expect(terminalOffReason({ HABBLAUD_BIND: '  ' }, '0.0.0.0', true)).toMatch(/HABBLAUD_BIND não chegou/);
    expect(terminalOffReason({ HABBLAUD_BIND: '0.0.0.0' }, '0.0.0.0', true)).toBe('a porta está exposta na rede: HABBLAUD_BIND=0.0.0.0');
    expect(terminalOffReason({ HABBLAUD_BIND: '192.168.0.10' }, '0.0.0.0', true)).toMatch(/exposta na rede/);
    // No container o host do processo não conta (é sempre 0.0.0.0).
    expect(terminalOffReason({ HABBLAUD_BIND: '0.0.0.0' }, '127.0.0.1', true)).toBeDefined();
  });

  it('HABBLAUD_TERMINAL só desliga: não há como ligar com a porta exposta', () => {
    for (const v of ['0', 'false', 'off', 'nao']) {
      expect(terminalOffReason({ HABBLAUD_TERMINAL: v }, '127.0.0.1', false)).toBe(`HABBLAUD_TERMINAL=${v}`);
      expect(terminalOffReason({ HABBLAUD_TERMINAL: v, HABBLAUD_BIND: '127.0.0.1' }, '0.0.0.0', true)).toMatch(/HABBLAUD_TERMINAL/);
    }
    expect(terminalOffReason({ HABBLAUD_TERMINAL: '1' }, '127.0.0.1', false)).toBeUndefined();
    expect(terminalOffReason({ HABBLAUD_TERMINAL: '' }, '127.0.0.1', false)).toBeUndefined();
    expect(terminalOffReason({ HABBLAUD_TERMINAL: '1' }, '0.0.0.0', false)).toBeDefined();
    expect(terminalOffReason({ HABBLAUD_TERMINAL: 'sim', HABBLAUD_BIND: '0.0.0.0' }, '0.0.0.0', true)).toBeDefined();
  });

  it('loadConfig preenche ServerConfig.terminal', () => {
    const tmp = tempDir();
    try {
      const terminal = (env: NodeJS.ProcessEnv) => loadConfig({ HOME: tmp.dir, HABBLAUD_IN_DOCKER: '0', ...env }, []).terminal;
      expect(terminal({})).toBe(true);
      expect(terminal({ HABBLAUD_HOST: '0.0.0.0' })).toBe(false);
      expect(terminal({ HABBLAUD_TERMINAL: '0' })).toBe(false);
      expect(terminal({ HABBLAUD_IN_DOCKER: '1', HABBLAUD_HOST: '0.0.0.0' })).toBe(false);
      expect(terminal({ HABBLAUD_IN_DOCKER: '1', HABBLAUD_HOST: '0.0.0.0', HABBLAUD_BIND: '127.0.0.1' })).toBe(true);
      expect(terminal({ HABBLAUD_IN_DOCKER: '1', HABBLAUD_HOST: '0.0.0.0', HABBLAUD_BIND: '0.0.0.0' })).toBe(false);
    } finally {
      tmp.cleanup();
    }
  });
});

// ------------------------------------------------------------------ servidor de teste

/** Parser de teste: cada linha JSON {id, text} vira uma entrada 'user'; "boom" faz o parser falhar. */
function fakeParser(): TerminalParser {
  return {
    push(raw) {
      if (raw === 'boom') throw new Error('falhou');
      try {
        const j = JSON.parse(raw) as { id?: string; text?: string };
        return j.id ? [user(j.id, j.text)] : [];
      } catch {
        return [];
      }
    },
  };
}

const user = (id: string, text = id): TerminalEntry => ({ kind: 'user', id, at: 0, text });
const line = (id: string) => JSON.stringify({ id, text: id });
const route = (id: string) => `/api/agents/${encodeURIComponent(id)}/terminal`;
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const MAIN = 'acc:1';

interface Served {
  base: string;
  port: string;
  office: Office;
  terminals: TerminalStreams;
  /** Caminho do transcript de cada agente (o que o watcher informaria). */
  paths: Map<string, string>;
  dir: string;
  close: () => Promise<void>;
}

async function serve(opts: { terminal?: boolean; streams?: Partial<TerminalOptions> } = {}): Promise<Served> {
  const tmp = tempDir();
  const terminal = opts.terminal ?? true;
  const office = new Office({
    names: new NameStore(null),
    version: 't',
    startedAt: Date.now(),
    accounts: () => [],
    sources: () => [],
    accountName: () => undefined,
    terminal,
  });
  const hub = new Hub(office, { throttleMs: 10 });
  const accounts = new AccountsService({ dirs: [], home: tmp.dir, env: {}, onChange: () => {} });
  const paths = new Map<string, string>();
  const terminals = new TerminalStreams({ office, transcriptPathOf: (id) => paths.get(id), createParser: fakeParser, pollMs: 20, demoPollMs: 20, ...opts.streams });
  const api = createApiHandler({ office, hub, accounts, sources: () => [], version: 't', inDocker: false, terminal, terminals });
  const guard = createRequestGuard({ allowedHosts: new Set(['habblaud.lan']) });
  const server = http.createServer((req, res) => {
    if (guard(req, res)) return;
    if (!api(req, res, new URL(req.url ?? '/', 'http://x'))) res.writeHead(404).end();
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = String((server.address() as AddressInfo).port);
  office.addMain({ id: MAIN, account: 'acc', sessionId: 's1', cwd: '/p/loja', role: 'Agente principal', startedAt: Date.now(), status: 'working' });
  return {
    base: `http://127.0.0.1:${port}`,
    port,
    office,
    terminals,
    paths,
    dir: tmp.dir,
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

interface Sse {
  status: number;
  headers: http.IncomingHttpHeaders;
  /** Corpo das respostas que não são SSE (erros JSON). */
  body: string;
  /** Texto cru do stream. */
  raw: string;
  events: Array<{ event: string; data: unknown }>;
  close: () => void;
}

/** Abre uma requisição crua (dá para trocar o Host) e interpreta o stream SSE, se for um. */
function open(base: string, path: string, opts: { method?: string; headers?: Record<string, string> } = {}): Promise<Sse> {
  const u = new URL(base);
  return new Promise((ok, fail) => {
    let settled = false;
    const req = http.request({ host: u.hostname, port: u.port, path, method: opts.method ?? 'GET', headers: opts.headers }, (res) => {
      const out: Sse = { status: res.statusCode ?? 0, headers: res.headers, body: '', raw: '', events: [], close: () => req.destroy() };
      res.setEncoding('utf8');
      res.on('error', () => {});
      settled = true;
      if (!String(res.headers['content-type']).startsWith('text/event-stream')) {
        res.on('data', (c: string) => (out.body += c));
        res.on('end', () => ok(out));
        return;
      }
      let buf = '';
      res.on('data', (c: string) => {
        out.raw += c;
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
    req.on('error', (err) => {
      if (!settled) fail(err);
    });
    req.end();
  });
}

const inits = (s: Sse) => s.events.filter((e) => e.event === 'init').map((e) => e.data as TerminalInit);
const appendIds = (s: Sse) => s.events.filter((e) => e.event === 'append').flatMap((e) => (e.data as TerminalEntry[]).map((x) => x.id));

/** O que o cliente mostraria: `init` substitui tudo, `append` acrescenta. */
function view(s: Sse): string[] {
  let ids: string[] = [];
  for (const e of s.events) {
    if (e.event === 'init') ids = (e.data as TerminalInit).entries.map((x) => x.id);
    else if (e.event === 'append') ids.push(...(e.data as TerminalEntry[]).map((x) => x.id));
  }
  return ids;
}

const health = async (base: string) => (await (await fetch(`${base}/api/health`)).json()) as { ok: boolean; terminal: boolean };

const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 3_000, interval: 10 });

// ------------------------------------------------------------------ rota

describe('terminal: rota', () => {
  it('recurso desligado: 403 JSON; /api/health e meta.terminal dizem false', async () => {
    const env = await serve({ terminal: false });
    try {
      env.paths.set(MAIN, join(env.dir, 'x.jsonl'));
      const r = await open(env.base, route(MAIN));
      expect(r.status).toBe(403);
      expect(JSON.parse(r.body).error).toMatch(/desligado/);
      expect(await health(env.base)).toMatchObject({ ok: true, terminal: false });
      expect(env.office.commit().snapshot.meta.terminal).toBe(false);
      expect(env.terminals.size).toBe(0);
    } finally {
      await env.close();
    }
  });

  it('Host que não é local (IP da rede ou nome de HABBLAUD_ALLOWED_HOSTS): 403; localhost abre', async () => {
    const env = await serve();
    try {
      const file = join(env.dir, 't.jsonl');
      writeLines(file, [line('a')]);
      env.paths.set(MAIN, file);
      for (const host of [`192.168.0.10:${env.port}`, `habblaud.lan:${env.port}`]) {
        const r = await open(env.base, route(MAIN), { headers: { Host: host } });
        expect(r.status).toBe(403);
        expect(JSON.parse(r.body).error).toMatch(/próprio computador/);
      }
      expect(env.terminals.size).toBe(0);
      const ok = await open(env.base, route(MAIN), { headers: { Host: `localhost:${env.port}` } });
      expect(ok.status).toBe(200);
      ok.close();
      expect(await health(env.base)).toMatchObject({ ok: true, terminal: true });
    } finally {
      await env.close();
    }
  });

  it('404 para agente ou transcript desconhecido; 405 para outros métodos', async () => {
    const env = await serve();
    try {
      for (const id of ['nao-existe', 'demo:nao-existe']) {
        const r = await open(env.base, route(id));
        expect(r.status).toBe(404);
        expect(JSON.parse(r.body)).toEqual({ error: 'agente não encontrado' });
      }
      const noPath = await open(env.base, route(MAIN));
      expect(noPath.status).toBe(404);
      expect(JSON.parse(noPath.body)).toEqual({ error: 'transcript do agente não encontrado' });
      const post = await open(env.base, route(MAIN), { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      expect(post.status).toBe(405);
      expect(post.headers.allow).toBe('GET');
      expect((await open(env.base, route(MAIN), { method: 'HEAD' })).status).toBe(405);
      // A rota genérica do agente continua igual.
      expect((await fetch(`${env.base}/api/agents/${encodeURIComponent(MAIN)}`)).status).toBe(200);
    } finally {
      await env.close();
    }
  });

  it(`429 acima de ${MAX_STREAMS} terminais abertos; fechar um libera a vaga`, async () => {
    const env = await serve();
    try {
      const file = join(env.dir, 't.jsonl');
      writeLines(file, [line('a')]);
      env.paths.set(MAIN, file);
      const open8 = await Promise.all(Array.from({ length: MAX_STREAMS }, () => open(env.base, route(MAIN))));
      expect(open8.every((s) => s.status === 200)).toBe(true);
      expect(env.terminals.size).toBe(MAX_STREAMS);
      const extra = await open(env.base, route(MAIN));
      expect(extra.status).toBe(429);
      expect(JSON.parse(extra.body).error).toMatch(/terminais abertos demais/);
      open8[0].close();
      await waitFor(() => expect(env.terminals.size).toBe(MAX_STREAMS - 1));
      const again = await open(env.base, route(MAIN));
      expect(again.status).toBe(200);
      again.close();
      for (const s of open8) s.close();
      await waitFor(() => expect(env.terminals.size).toBe(0));
    } finally {
      await env.close();
    }
  });
});

// ------------------------------------------------------------------ transporte

describe('terminal: transporte', () => {
  it('init com a conversa do transcript; depois append só com as linhas novas', async () => {
    const env = await serve();
    try {
      const file = join(env.dir, 't.jsonl');
      writeLines(file, [line('a'), 'lixo', line('b')]);
      env.paths.set(MAIN, file);
      const s = await open(env.base, route(MAIN));
      expect(s.status).toBe(200);
      expect(s.headers['content-type']).toMatch(/^text\/event-stream/);
      expect(s.headers['cache-control']).toBe('no-cache, no-transform');
      await waitFor(() => expect(inits(s)).toHaveLength(1));
      expect(s.raw).toMatch(/^retry: 2000\n\nevent: init\ndata: \{/);
      expect(inits(s)[0]).toEqual({ agentId: MAIN, entries: [user('a'), user('b')], truncated: false });
      // Linha parcial só conta quando termina; uma linha que derruba o parser é pulada.
      appendFileSync(file, `${line('c')}\nboom\n${line('d').slice(0, 5)}`);
      await waitFor(() => expect(appendIds(s)).toEqual(['c']));
      appendFileSync(file, `${line('d').slice(5)}\n`);
      await waitFor(() => expect(appendIds(s)).toEqual(['c', 'd']));
      expect(view(s)).toEqual(['a', 'b', 'c', 'd']);
      expect(inits(s)).toHaveLength(1);
      s.close();
      await waitFor(() => expect(env.terminals.size).toBe(0));
    } finally {
      await env.close();
    }
  });

  it('transcript truncado ou substituído: parser novo e init de novo', async () => {
    let parsers = 0;
    const env = await serve({ streams: { createParser: () => (parsers++, fakeParser()) } });
    try {
      const file = join(env.dir, 't.jsonl');
      writeLines(file, [line('a'), line('b'), line('c')]);
      env.paths.set(MAIN, file);
      const s = await open(env.base, route(MAIN));
      await waitFor(() => expect(inits(s)).toHaveLength(1));
      expect(parsers).toBe(1);
      truncateSync(file, 0);
      appendLines(file, [line('x')]);
      await waitFor(() => expect(view(s)).toEqual(['x']));
      expect(inits(s).length).toBeGreaterThanOrEqual(2);
      expect(parsers).toBe(inits(s).length);
      // Substituído (outro arquivo no mesmo caminho, inode novo).
      const tmp = join(env.dir, 'novo.jsonl');
      writeLines(tmp, [line('y'), line('z'), line('w'), line('v')]);
      const before = inits(s).length;
      renameSync(tmp, file);
      await waitFor(() => expect(inits(s).length).toBe(before + 1));
      expect(inits(s).at(-1)).toEqual({ agentId: MAIN, entries: ['y', 'z', 'w', 'v'].map((id) => user(id)), truncated: false });
      s.close();
    } finally {
      await env.close();
    }
  });

  it('truncated: janela do fim do arquivo (offset > 0) ou entradas descartadas', async () => {
    const env = await serve({ streams: { initTailBytes: 60, initEntries: 3 } });
    try {
      const big = join(env.dir, 'big.jsonl');
      writeLines(big, ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map(line));
      env.paths.set(MAIN, big);
      const s = await open(env.base, route(MAIN));
      await waitFor(() => expect(inits(s)).toHaveLength(1));
      const init = inits(s)[0];
      expect(init.truncated).toBe(true);
      expect(init.entries.at(-1)?.id).toBe('a6');
      expect(init.entries.length).toBeLessThan(6);
      s.close();

      // Arquivo inteiro dentro da janela (48 bytes), mas com mais entradas do que o limite de 3.
      const small = join(env.dir, 'small.jsonl');
      writeLines(small, ['c1', 'c2', 'c3', 'c4'].map((id) => JSON.stringify({ id })));
      env.paths.set(MAIN, small);
      const t = await open(env.base, route(MAIN));
      await waitFor(() => expect(inits(t)).toHaveLength(1));
      expect(inits(t)[0]).toEqual({ agentId: MAIN, entries: ['c2', 'c3', 'c4'].map((id) => user(id)), truncated: true });
      t.close();
    } finally {
      await env.close();
    }
  });

  it('transcript que ainda não existe (ou sumiu): init vazio e continua tentando', async () => {
    const env = await serve();
    try {
      const file = join(env.dir, 'depois', 't.jsonl');
      env.paths.set(MAIN, file);
      const s = await open(env.base, route(MAIN));
      await waitFor(() => expect(inits(s)).toHaveLength(1));
      expect(inits(s)[0]).toEqual({ agentId: MAIN, entries: [], truncated: false });
      await sleep(60);
      writeLines(file, [line('a')]);
      await waitFor(() => expect(view(s)).toEqual(['a']));
      s.close();
    } finally {
      await env.close();
    }
  });

  it('/clear no mesmo processo: o transcript do principal muda e chega um init do novo', async () => {
    const env = await serve();
    try {
      const first = join(env.dir, 's1.jsonl');
      const second = join(env.dir, 's2.jsonl');
      writeLines(first, [line('a')]);
      writeLines(second, [line('novo')]);
      env.paths.set(MAIN, first);
      const s = await open(env.base, route(MAIN));
      await waitFor(() => expect(inits(s)).toHaveLength(1));
      env.paths.set(MAIN, second);
      await waitFor(() => expect(inits(s)).toHaveLength(2));
      expect(inits(s)[1].entries.map((e) => e.id)).toEqual(['novo']);
      // Sessão encerrada (o watcher esquece o caminho): continua no último transcript.
      env.paths.delete(MAIN);
      appendLines(second, [line('fim')]);
      await waitFor(() => expect(view(s)).toEqual(['novo', 'fim']));
      s.close();
    } finally {
      await env.close();
    }
  });

  it('stop() encerra os streams abertos', async () => {
    const env = await serve();
    try {
      const file = join(env.dir, 't.jsonl');
      writeLines(file, [line('a')]);
      env.paths.set(MAIN, file);
      const s = await open(env.base, route(MAIN));
      await waitFor(() => expect(inits(s)).toHaveLength(1));
      env.terminals.stop();
      expect(env.terminals.size).toBe(0);
    } finally {
      await env.close();
    }
  });

  it('parser por agente (parserFor, o da ferramenta dele); sem parser próprio, o padrão; um novo a cada init', async () => {
    const OTHER = '.codex:019a0000-0000-7000-8000-000000000001';
    let codexParsers = 0;
    /** Parser "de outra ferramenta": as mesmas linhas viram entradas com o prefixo "cx-". */
    const codexParser = (): TerminalParser => {
      codexParsers++;
      const base = fakeParser();
      return { push: (raw) => base.push(raw).map((e) => ({ ...e, id: `cx-${e.id}` })) };
    };
    const asked: string[] = [];
    const parserFor = (id: string) => (asked.push(id), id === OTHER ? codexParser() : undefined);
    const env = await serve({ streams: { parserFor } });
    try {
      env.office.addMain({ id: OTHER, provider: 'codex', account: '.codex', sessionId: 'thr', cwd: '/p/loja', role: 'Agente principal', startedAt: Date.now(), status: 'working' });
      const a = join(env.dir, 'a.jsonl');
      const b = join(env.dir, 'b.jsonl');
      writeLines(a, [line('a1')]);
      writeLines(b, [line('b1')]);
      env.paths.set(MAIN, a);
      env.paths.set(OTHER, b);
      const sa = await open(env.base, route(MAIN));
      const sb = await open(env.base, route(OTHER));
      await waitFor(() => expect(view(sa)).toEqual(['a1']));
      await waitFor(() => expect(view(sb)).toEqual(['cx-b1']));
      appendLines(b, [line('b2')]);
      await waitFor(() => expect(view(sb)).toEqual(['cx-b1', 'cx-b2']));
      expect(codexParsers).toBe(1);
      // Truncado: parser novo, de novo o da ferramenta.
      truncateSync(b, 0);
      appendLines(b, [line('b3')]);
      await waitFor(() => expect(view(sb)).toEqual(['cx-b3']));
      expect(codexParsers).toBe(inits(sb).length);
      expect(asked).toContain(MAIN);
      expect(env.office.get(OTHER)?.provider).toBe('codex');
      expect(env.office.get(MAIN)?.provider).toBeUndefined();
      sa.close();
      sb.close();
    } finally {
      await env.close();
    }
  });
});

// ------------------------------------------------------------------ demo

describe('terminal: agentes do demo', () => {
  it('conversa fictícia (demoTerminalEntries): init com o id do agente', async () => {
    const env = await serve();
    try {
      env.office.setDemo(true);
      const demo = env.office.commit().snapshot.agents.find((a) => a.id.startsWith('demo:'))!;
      const s = await open(env.base, route(demo.id));
      expect(s.status).toBe(200);
      await waitFor(() => expect(inits(s)).toHaveLength(1));
      const init = inits(s)[0];
      expect(init.agentId).toBe(demo.id);
      expect(Array.isArray(init.entries)).toBe(true);
      for (const e of init.entries) expect(typeof e.id).toBe('string');
      s.close();
    } finally {
      await env.close();
    }
  });

  it('append só com ids novos; o agente sumiu = para o polling (o stream continua aberto)', async () => {
    const items = [user('d1'), user('d2')];
    const env = await serve({ streams: { demoEntries: () => items.slice() } });
    try {
      env.office.setDemo(true);
      const demo = env.office.commit().snapshot.agents.find((a) => a.id.startsWith('demo:'))!;
      const s = await open(env.base, route(demo.id));
      await waitFor(() => expect(inits(s)).toHaveLength(1));
      expect(inits(s)[0]).toEqual({ agentId: demo.id, entries: items, truncated: false });
      items.push(user('d3'));
      await waitFor(() => expect(appendIds(s)).toEqual(['d3']));
      // A janela anda (d1 sai): nada é reenviado.
      items.shift();
      items.push(user('d4'));
      await waitFor(() => expect(appendIds(s)).toEqual(['d3', 'd4']));
      env.office.setDemo(false);
      await sleep(80);
      const detail = vi.spyOn(env.office, 'detail');
      await sleep(80);
      expect(detail).not.toHaveBeenCalled();
      expect(env.terminals.size).toBe(1);
      s.close();
    } finally {
      await env.close();
    }
  });
});

// ------------------------------------------------------------------ watcher

describe('ClaudeWatcher.transcriptPathOf', () => {
  it('principal "<conta>:<pid>" e subagente "<sessionId>:<agentId>"', () => {
    const tmp = tempDir();
    const dir = join(tmp.dir, '.claude');
    const cwd = '/projetos/loja';
    mkdirSync(join(dir, 'sessions'), { recursive: true });
    const transcript = join(dir, 'projects', encodeCwd(cwd), 'sess-a.jsonl');
    writeLines(transcript, [L.prompt('Arruma o carrinho')]);
    writeFileSync(
      join(dir, 'sessions', '100.json'),
      JSON.stringify({ pid: 100, sessionId: 'sess-a', cwd, startedAt: Date.now() - 60_000, kind: 'interactive', status: 'busy' }),
    );
    const subDir = join(dir, 'projects', encodeCwd(cwd), 'sess-a', 'subagents');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, 'agent-b1.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'Mapear', requestShape: 'foreground' }));
    const subPath = join(subDir, 'agent-b1.jsonl');
    writeLines(subPath, [L.prompt('Mapeie', { agentId: 'b1' }), L.assistant([L.tool('r1', 'Read', { file_path: `${cwd}/a.ts` })], { agentId: 'b1' })]);
    const accounts = new AccountsService({ dirs: [dir], home: tmp.dir, env: {}, onChange: () => {} });
    const office = new Office({
      names: new NameStore(null),
      version: 't',
      startedAt: Date.now(),
      accounts: (s) => accounts.list(s),
      sources: () => [],
      accountName: () => undefined,
    });
    const watcher = new ClaudeWatcher({ accounts, office, inDocker: false, isAlive: () => true, watch: false });
    try {
      watcher.poll();
      expect(watcher.transcriptPathOf('.claude:100')).toBe(transcript);
      expect(office.has('sess-a:b1')).toBe(true);
      expect(watcher.transcriptPathOf('sess-a:b1')).toBe(subPath);
      expect(watcher.transcriptPathOf('sess-a:outro')).toBeUndefined();
      expect(watcher.transcriptPathOf('.claude:999')).toBeUndefined();
    } finally {
      watcher.stop();
      tmp.cleanup();
    }
  });
});
