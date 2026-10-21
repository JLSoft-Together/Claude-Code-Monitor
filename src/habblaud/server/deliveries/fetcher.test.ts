import { describe, expect, it } from 'vitest';
import { FileFetcher, HOST_PRESENCE_MS } from './fetcher';

const ok = (p: string) => ({ path: p, size: 3 });

describe('FileFetcher', () => {
  it('Node: lê direto do disco, com a checagem', async () => {
    const f = new FileFetcher({ direct: true, check: ok, read: () => Buffer.from('abc') });
    expect(await f.get('/a/x.png')).toEqual({ data: Buffer.from('abc') });
    const denied = new FileFetcher({ direct: true, check: () => ({ error: 'arquivo protegido' }) });
    expect(await denied.get('/a/.ssh/x.png')).toEqual({ error: 'arquivo protegido', status: 403 });
  });

  it('Docker: pasta montada lê aqui; o resto vai pelo auxiliar (poll → ack) e fica no cache', async () => {
    let now = 1_000;
    const reads: string[] = [];
    const f = new FileFetcher({
      now: () => now,
      check: ok,
      read: (p) => (reads.push(p), Buffer.from('m')),
      mapHostPath: (p) => (p.startsWith('/Users/a/.claude/') ? `/claude${p.slice('/Users/a/.claude'.length)}` : undefined),
    });
    expect(await f.get('/Users/a/.claude/projects/x/t.jpg')).toEqual({ data: Buffer.from('m') });
    expect(reads).toEqual(['/claude/projects/x/t.jpg']);
    expect(await f.get('/tmp/x.png')).toMatchObject({ status: 503 });
    f.poll();
    const pending = f.get('/tmp/x.png');
    const [req] = f.poll();
    expect(req.path).toBe('/tmp/x.png');
    f.ack({ results: [{ id: req.id, ok: true, data: Buffer.from('png').toString('base64') }] });
    expect(await pending).toEqual({ data: Buffer.from('png') });
    now += HOST_PRESENCE_MS + 1;
    expect(await f.get('/tmp/x.png')).toEqual({ data: Buffer.from('png') });
  });

  it('auxiliar recusa: o erro dele chega ao navegador', async () => {
    const f = new FileFetcher({ check: ok });
    f.poll();
    const pending = f.get('/tmp/y.png');
    const [req] = f.poll();
    f.ack({ results: [{ id: req.id, ok: false, error: 'arquivo protegido' }] });
    expect(await pending).toEqual({ error: 'arquivo protegido', status: 404 });
  });

  it('rodada com espera (?wait=1): o auxiliar fica parado até a página pedir um arquivo, e conta como presente', async () => {
    const f = new FileFetcher({ mapHostPath: () => undefined });
    expect(f.hostAvailable()).toBe(false);
    const round = f.pollWait(60_000);
    expect(f.hostAvailable()).toBe(true);
    const got = f.get('/proj/a.png');
    const list = await round;
    expect(list).toEqual([{ id: expect.any(String), path: '/proj/a.png' }]);
    f.ack({ results: [{ id: list[0].id, ok: true, data: Buffer.from('png').toString('base64') }] });
    await expect(got).resolves.toEqual({ data: Buffer.from('png') });
  });
});
