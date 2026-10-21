import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseTimeline } from '../../shared/timeline';
import { AccountsService } from '../accounts/service';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { tempDir } from '../test/fixtures';
import { createApiHandler } from './app';
import { createRequestGuard } from './guard';
import { Hub } from './sse';
import { createTimelineHandler } from './timeline';

setQuiet(true);

const DAY = [
  JSON.stringify({ t: 'k', at: 1_000, v: 1, every: 300_000, boot: true, rooms: [], agents: [], accounts: [] }),
  JSON.stringify({ t: 'd', at: 2_000, rooms: [['/p/loja', { id: '/p/loja', name: 'loja', path: '/p/loja', slot: 0, seed: 1, createdAt: 2_000 }]] }),
  JSON.stringify({ t: 'end', at: 3_000 }),
].join('\n');

interface Env {
  base: string;
  dir: string;
  close: () => Promise<void>;
  cleanup: () => void;
}

async function start(): Promise<Env> {
  const tmp = tempDir('habblaud-tlapi-');
  const dir = join(tmp.dir, 'timeline');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '2026-10-07.jsonl'), `${DAY}\n`);
  writeFileSync(join(tmp.dir, 'segredo.jsonl'), 'não pode sair');
  const accounts = new AccountsService({ dirs: [], home: tmp.dir, env: {}, onChange: () => {} });
  const office = new Office({ names: new NameStore(null), version: 't', startedAt: Date.now(), accounts: (s) => accounts.list(s), sources: () => [], accountName: () => undefined });
  const hub = new Hub(office, { throttleMs: 10 });
  const api = createApiHandler({ office, hub, accounts, sources: () => [], version: 't', inDocker: false, timeline: createTimelineHandler({ dir, recording: true }) });
  const guard = createRequestGuard({ allowedHosts: new Set() });
  const server = http.createServer((req, res) => {
    if (guard(req, res)) return;
    if (!api(req, res, new URL(req.url ?? '/', 'http://x'))) {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as AddressInfo).port;
  return {
    base: `http://127.0.0.1:${port}`,
    dir,
    close: () =>
      new Promise((ok) => {
        hub.stop();
        server.closeAllConnections();
        server.close(() => ok());
      }),
    cleanup: tmp.cleanup,
  };
}

/** Requisição crua: o caminho vai exatamente como escrito (o fetch normalizaria "..", "%2F" etc.). */
function raw(base: string, path: string, opts: { method?: string; headers?: Record<string, string> } = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  const u = new URL(base);
  return new Promise((ok, fail) => {
    const req = http.request({ host: u.hostname, port: u.port, path, method: opts.method ?? 'GET', headers: opts.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => ok({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', fail);
    req.end();
  });
}

describe('API da linha do tempo', () => {
  let env: Env;
  beforeEach(async () => {
    env = await start();
  });
  afterEach(async () => {
    await env.close();
    env.cleanup();
  });

  it('GET /api/timeline/days', async () => {
    const res = await fetch(`${env.base}/api/timeline/days`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ recording: true, days: [{ day: '2026-10-07', bytes: DAY.length + 1, from: 1_000, to: 3_000 }] });
  });

  it('GET /api/timeline/:dia em JSONL, com gzip quando aceito', async () => {
    const plain = await raw(env.base, '/api/timeline/2026-10-07');
    expect(plain.status).toBe(200);
    expect(plain.headers['content-type']).toBe('application/x-ndjson; charset=utf-8');
    expect(plain.headers['x-content-type-options']).toBe('nosniff');
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(parseTimeline(plain.body.toString('utf8')).map((r) => r.t)).toEqual(['k', 'd', 'end']);

    const gz = await raw(env.base, '/api/timeline/2026-10-07', { headers: { 'Accept-Encoding': 'gzip, deflate' } });
    expect(gz.status).toBe(200);
    expect(gz.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(gz.body).toString('utf8')).toBe(`${DAY}\n`);

    const head = await raw(env.base, '/api/timeline/2026-10-07', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);
  });

  it('valida o dia com rigor (nada de path traversal)', async () => {
    for (const path of [
      '/api/timeline/..%2Fsegredo',
      '/api/timeline/%2e%2e%2Fsegredo',
      '/api/timeline/2026-10-07%2F..%2F..%2Fsegredo',
      '/api/timeline/2026-10-07.jsonl',
      '/api/timeline/2026-02-30',
      '/api/timeline/2026-13-01',
      '/api/timeline/hoje',
      '/api/timeline/%E0%A4%A',
      '/api/timeline/2026-10-07%00',
      '/api/timeline',
    ]) {
      const res = await raw(env.base, path);
      expect(res.status, path).toBe(400);
      expect(res.body.toString()).not.toContain('não pode sair');
    }
    // Caminhos com mais segmentos não casam com a rota do dia.
    expect((await raw(env.base, '/api/timeline/2026-10-07/../../segredo.jsonl')).status).not.toBe(200);
    expect((await raw(env.base, '/api/timeline/x/2026-10-07')).status).toBe(400);
  });

  it('dia sem gravação = 404; outros métodos = 405', async () => {
    expect((await raw(env.base, '/api/timeline/2026-10-01')).status).toBe(404);
    // (o guard da borda já exige JSON em métodos que não são leitura)
    const post = await raw(env.base, '/api/timeline/days', { method: 'DELETE', headers: { 'Content-Type': 'application/json' } });
    expect(post.status).toBe(405);
    expect(post.headers.allow).toBe('GET');
  });
});
