import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DayStatsResponse, StatsDaysResponse } from '../../shared/daystats';
import { AccountsService } from '../accounts/service';
import { DayStatsService } from '../history/daystats';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { tempDir } from '../test/fixtures';
import { createApiHandler } from './app';
import { createRequestGuard } from './guard';
import { Hub } from './sse';
import { parseStatsQuery } from './stats';

setQuiet(true);

describe('parseStatsQuery', () => {
  const today = () => '2026-10-08';
  const q = (search: string) => parseStatsQuery(new URL(`http://x/api/stats${search}`), 'UTC', today);

  it('padrões: hoje, fuso do servidor, fonte automática', () => {
    expect(q('')).toEqual({ ok: true, day: '2026-10-08', tz: 'UTC' });
    expect(q('?day=2026-10-01&tz=America/Sao_Paulo&source=real')).toEqual({ ok: true, day: '2026-10-01', tz: 'America/Sao_Paulo', source: 'real' });
    expect(q('?source=demo')).toMatchObject({ ok: true, source: 'demo' });
    // O fuso volta no nome canônico (variações de caixa não viram fusos diferentes).
    expect(q('?tz=america/sao_PAULO')).toMatchObject({ ok: true, tz: 'America/Sao_Paulo' });
  });

  it('recusa dias malformados, inexistentes, no futuro ou repetidos (400)', () => {
    for (const bad of ['?day=', '?day=hoje', '?day=2026-10-8', '?day=2026-02-30', '?day=%202026-10-08', '?day=2026-10-08T00:00', '?day=../../etc', '?day=2026-10-09']) {
      expect(q(bad), bad).toMatchObject({ ok: false, status: 400 });
    }
    expect(q('?day=2026-10-01&day=2026-10-02')).toMatchObject({ ok: false, status: 400, error: expect.stringContaining('repetido') });
  });

  it('fuso e fonte inválidos (400); fora da retenção (404)', () => {
    expect(q('?tz=Marte/Olimpo')).toMatchObject({ ok: false, status: 400 });
    expect(q('?tz=')).toMatchObject({ ok: false, status: 400 });
    expect(q('?source=tudo')).toMatchObject({ ok: false, status: 400 });
    expect(q('?day=2026-09-07')).toMatchObject({ ok: false, status: 404 });
    expect(q('?day=2026-09-08')).toMatchObject({ ok: true });
  });
});

describe('GET /api/stats', () => {
  let base = '';
  let close: () => Promise<void> = async () => {};
  let cleanup = () => {};
  let office: Office;
  let stats: DayStatsService;

  beforeEach(async () => {
    const tmp = tempDir();
    cleanup = tmp.cleanup;
    const late: { office?: Office } = {};
    const accounts = new AccountsService({ dirs: [], home: tmp.dir, env: {}, onChange: () => late.office?.markDirty() });
    office = new Office({ names: new NameStore(null), version: '9.9.9', startedAt: Date.now(), accounts: (s) => accounts.list(s), sources: () => [], accountName: () => undefined });
    late.office = office;
    const hub = new Hub(office, { throttleMs: 10 });
    hub.start();
    stats = new DayStatsService({ dir: null, tz: 'UTC', snapshot: () => hub.current() });
    stats.load();
    const api = createApiHandler({ office, hub, accounts, sources: () => [], version: '9.9.9', inDocker: false, stats });
    const guard = createRequestGuard();
    const server = http.createServer((req, res) => {
      if (guard(req, res)) return;
      if (!api(req, res, new URL(req.url ?? '/', 'http://x'))) res.end();
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    office.addMain({ id: '.claude:1', account: '.claude', sessionId: 's1', cwd: '/p/loja', role: 'Agente principal', startedAt: Date.now(), status: 'working' });
    close = () =>
      new Promise((ok) => {
        hub.stop();
        server.closeAllConnections();
        server.close(() => ok());
      });
  });

  afterEach(async () => {
    await close();
    cleanup();
  });

  it('devolve o dia de hoje com números agregados', async () => {
    stats.sample();
    stats.sample(Date.now() + 2_000);
    const res = await fetch(`${base}/api/stats?tz=UTC`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as DayStatsResponse;
    expect(body.source).toBe('real');
    expect(body.demoAvailable).toBe(false);
    expect(body.stats.day).toBe(body.today);
    expect(body.stats.totals.ms.working).toBeGreaterThan(0);
    expect(body.stats.rooms[0]).toMatchObject({ id: '/p/loja', name: 'loja', sessions: 1 });
    const days = (await (await fetch(`${base}/api/stats/days?tz=America/Sao_Paulo`)).json()) as StatsDaysResponse;
    expect(days.tz).toBe('America/Sao_Paulo');
    expect(days.days[0]).toBe(days.today);
  });

  it('erros: 400 no dia ou no fuso, 404 sem dados ou rota, 405 fora do GET', async () => {
    expect((await fetch(`${base}/api/stats?day=2026-13-01`)).status).toBe(400);
    expect((await fetch(`${base}/api/stats?day=2999-01-01`)).status).toBe(400);
    expect((await fetch(`${base}/api/stats/days?tz=nada`)).status).toBe(400);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const r404 = await fetch(`${base}/api/stats?day=${yesterday}&tz=UTC`);
    expect(r404.status).toBe(404);
    expect(await r404.json()).toEqual({ error: 'sem estatísticas para este dia' });
    expect((await fetch(`${base}/api/stats?source=demo`)).status).toBe(404);
    expect((await fetch(`${base}/api/stats/outra`)).status).toBe(404);
    const post = await fetch(`${base}/api/stats`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET');
  });

  it('com o demo ligado, o padrão é o balde do demo (e dá para pedir o real)', async () => {
    office.setDemo(true);
    stats.sample();
    const demo = (await (await fetch(`${base}/api/stats?tz=UTC`)).json()) as DayStatsResponse;
    expect(demo.source).toBe('demo');
    expect(demo.demoAvailable).toBe(true);
    expect(demo.stats.rooms.every((r) => r.id !== '/p/loja')).toBe(true);
    const real = (await (await fetch(`${base}/api/stats?tz=UTC&source=real`)).json()) as DayStatsResponse;
    expect(real.source).toBe('real');
    expect(real.stats.accounts.every((a) => !a.id.startsWith('demo:'))).toBe(true);
  });
});
