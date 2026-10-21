import { chmodSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cliArgs,
  createCliRunner,
  folderProblem,
  HOST_PRESENCE_MS,
  launch,
  parseSpawn,
  QUEUED_TIMEOUT_MS,
  SENT_TIMEOUT_MS,
  sessionName,
  SpawnService,
  spawnUrl,
  type Opener,
} from './spawn';
import { runnableClaudeBin } from '../claude-bin';

describe('novo agente: pedido e link', () => {
  it('aceita só pasta absoluta e pedido do tamanho certo', () => {
    expect(parseSpawn({ folder: ' /Users/a/proj ', prompt: 'faça X  \n' })).toEqual({ folder: '/Users/a/proj', prompt: 'faça X' });
    expect(parseSpawn({ folder: 'C:\\code\\proj' })).toEqual({ folder: 'C:\\code\\proj', prompt: '' });
    expect(parseSpawn({ folder: 'proj' })).toHaveProperty('error');
    expect(parseSpawn({ folder: '/a\0b' })).toHaveProperty('error');
    expect(parseSpawn({ folder: '/a', prompt: 'x'.repeat(8_001) })).toHaveProperty('error');
    expect(parseSpawn(null)).toHaveProperty('error');
  });

  it('o link do app do Claude leva pasta e pedido codificados (espaço como %20)', () => {
    const url = spawnUrl({ folder: '/Users/a/meu proj', prompt: 'rode os testes & conte' });
    expect(url.startsWith('claude://code/new?')).toBe(true);
    const q = new URL(url).searchParams;
    expect([q.get('folder'), q.get('q'), q.get('source')]).toEqual(['/Users/a/meu proj', 'rode os testes & conte', 'habblaud']);
    expect(url).not.toContain('+');
    expect(new URL(spawnUrl({ folder: '/a', prompt: '  ' })).searchParams.has('q')).toBe(false);
  });

  it('folderProblem: pasta que não existe ou arquivo', () => {
    expect(folderProblem(process.cwd())).toBeUndefined();
    expect(folderProblem('/nao/existe/mesmo')).toMatch(/não encontrada/);
    expect(folderProblem('/x', () => ({ isDirectory: () => false }))).toMatch(/não é uma pasta/);
  });
});

describe('SpawnService', () => {
  it('modo direto: confere a pasta e abre o link na hora', async () => {
    const opened: string[] = [];
    const opener: Opener = async (url) => (opened.push(url), { ok: true });
    const s = new SpawnService({ opener, folderProblem: () => undefined, newId: () => 'a1' });
    expect(s.available()).toBe(true);
    const r = s.submit({ folder: '/p', prompt: 'oi' });
    expect(r).toMatchObject({ spawn: { id: 'a1', folder: '/p' } });
    await new Promise((ok) => setTimeout(ok, 0));
    expect(s.get('a1')?.status).toBe('opened');
    expect(opened).toEqual([spawnUrl({ folder: '/p', prompt: 'oi' })]);
    const bad = new SpawnService({ opener, folderProblem: () => 'pasta não encontrada neste computador', newId: () => 'b' });
    bad.submit({ folder: '/nada', prompt: '' });
    await new Promise((ok) => setTimeout(ok, 0));
    expect(bad.get('b')).toMatchObject({ status: 'failed', error: 'pasta não encontrada neste computador' });
  });

  it('Docker: sem o auxiliar recusa; com ele, fila → busca → confirmação; e os prazos', () => {
    let now = 1_000_000;
    let n = 0;
    const s = new SpawnService({ now: () => now, newId: () => `id${++n}` });
    expect(s.submit({ folder: '/p', prompt: '' })).toMatchObject({ error: 'unavailable' });
    expect(s.poll()).toEqual([]);
    expect(s.available()).toBe(true);
    s.submit({ folder: '/p', prompt: 'a' });
    expect(s.poll()).toEqual([{ id: 'id1', folder: '/p', prompt: 'a', files: [] }]);
    expect(s.poll()).toEqual([]);
    s.ack({ results: [{ id: 'id1', ok: false, error: 'open: falhou' }] });
    expect(s.get('id1')).toMatchObject({ status: 'failed', error: 'open: falhou' });
    s.submit({ folder: '/p', prompt: 'b' });
    s.poll();
    now += SENT_TIMEOUT_MS + 1;
    expect(s.get('id2')).toMatchObject({ status: 'failed', error: 'o auxiliar do computador não confirmou' });
    now += HOST_PRESENCE_MS + 1;
    expect(s.available()).toBe(false);
    s.poll();
    s.submit({ folder: '/p', prompt: 'c' });
    now += QUEUED_TIMEOUT_MS + 1;
    expect(s.get('id3')).toMatchObject({ status: 'failed', error: 'o auxiliar do computador não buscou o pedido' });
  });

  it('no máximo 5 abrindo ao mesmo tempo', () => {
    const s = new SpawnService({ opener: () => new Promise(() => {}), folderProblem: () => undefined });
    for (let i = 0; i < 5; i++) expect(s.submit({ folder: '/p', prompt: '' })).toHaveProperty('spawn');
    expect(s.submit({ folder: '/p', prompt: '' })).toMatchObject({ error: 'too-many' });
  });
});

describe('SpawnService com anexos', () => {
  const att = (name: string) => ({ name, type: 'image/png', data: Buffer.from(name) });

  it('host: o pedido leva os anexos em base64 uma vez só, e o depósito não os entrega de novo', async () => {
    const { AttachmentStore } = await import('./attachments');
    const store = new AttachmentStore(Date.now, (() => { let n = 0; return () => `f${++n}`; })());
    store.put(att('a.png'));
    const s = new SpawnService({ attachments: store, newId: () => 's1' });
    s.poll();
    expect(s.submit({ folder: '/p', prompt: 'veja', attachments: ['f1'] })).toMatchObject({ spawn: { id: 's1' } });
    const [polled] = s.poll();
    expect(polled.files).toEqual([{ name: 'a.png', type: 'image/png', data: Buffer.from('a.png').toString('base64') }]);
    expect(s.poll()).toEqual([]);
    expect(s.submit({ folder: '/p', attachments: ['f1'] })).toMatchObject({ error: 'invalid' });
    const bare = new SpawnService({ newId: () => 'z' });
    bare.poll();
    expect(bare.submit({ folder: '/p', attachments: ['f1'] })).toMatchObject({ error: 'invalid', reason: 'anexos desligados' });
  });

  it('direto: grava os anexos e o link leva os caminhos no pedido', async () => {
    const { AttachmentStore } = await import('./attachments');
    const store = new AttachmentStore(Date.now, () => 'f1');
    store.put(att('print.png'));
    const opened: string[] = [];
    const written: string[] = [];
    const s = new SpawnService({
      opener: async (url) => (opened.push(url), { ok: true }),
      folderProblem: () => undefined,
      attachments: store,
      writeFiles: (id, files) => files.map((f) => (written.push(`${id}:${f.name}`), `/h/att/${f.name}`)),
      newId: () => 's2',
    });
    s.submit({ folder: '/p', prompt: 'conserte', attachments: ['f1'] });
    await new Promise((ok) => setTimeout(ok, 0));
    expect(written).toEqual(['s2:print.png']);
    expect(new URL(opened[0]).searchParams.get('q')).toBe('conserte\n\nAnexo enviado pelo Habblaud (leia antes de começar):\n- /h/att/print.png');
    expect(s.get('s2')?.status).toBe('opened');
  });

  it('direto: falha ao gravar vira erro do pedido, sem abrir o app', async () => {
    const { AttachmentStore } = await import('./attachments');
    const store = new AttachmentStore(Date.now, () => 'f1');
    store.put(att('x.png'));
    const opened: string[] = [];
    const s = new SpawnService({
      opener: async (url) => (opened.push(url), { ok: true }),
      folderProblem: () => undefined,
      attachments: store,
      writeFiles: () => {
        throw new Error('disco cheio');
      },
      newId: () => 's3',
    });
    s.submit({ folder: '/p', attachments: ['f1'] });
    await new Promise((ok) => setTimeout(ok, 0));
    expect(opened).toEqual([]);
    expect(s.get('s3')).toMatchObject({ status: 'failed', error: 'não deu para gravar os anexos (disco cheio)' });
  });
});

describe('novo agente em segundo plano (claude --bg)', () => {
  it('nome da sessão e argumentos: o pedido vai depois de `--`', () => {
    expect(sessionName('  \n rode os testes\nsegunda linha')).toBe('Habblaud: rode os testes');
    expect(sessionName('')).toBe('Habblaud');
    expect(sessionName('x'.repeat(100))).toHaveLength('Habblaud: '.length + 48);
    expect(cliArgs({ folder: '/p', prompt: 'doctor' })).toEqual(['--bg', '-n', 'Habblaud: doctor', '--', 'doctor']);
    expect(cliArgs({ folder: '/p', prompt: '--dangerously-skip-permissions' }).slice(-2)).toEqual(['--', '--dangerously-skip-permissions']);
    expect(cliArgs({ folder: '/p', prompt: '  ' })).toEqual(['--bg', '-n', 'Habblaud']);
  });

  it('createCliRunner roda o binário na pasta, sem shell, e lê o id; erro vira a 1ª linha', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hb-spawn-'));
    const bin = join(dir, 'claude');
    writeFileSync(
      bin,
      `#!/bin/sh\nprintf '%s\\n' "$PWD" "$@" > "${dir}/args"\n[ -f ./trusted ] || { echo 'Workspace not trusted. Run claude once' >&2; exit 1; }\necho 'Starting background service…'\necho 'backgrounded · 7eacc670 · nome'\n`,
    );
    chmodSync(bin, 0o755);
    writeFileSync(join(dir, 'trusted'), '');
    expect(runnableClaudeBin({ PATH: `/nao/existe:${dir}` })).toBe(bin);
    expect(runnableClaudeBin({ HABBLAUD_CLAUDE_BIN: join(dir, 'nada'), PATH: dir })).toBeUndefined();
    const run = createCliRunner(bin);
    expect(await run({ folder: dir, prompt: 'faça $(rm -rf x) && y' })).toEqual({ ok: true, id: '7eacc670' });
    const args = readFileSync(join(dir, 'args'), 'utf8').trim().split('\n');
    expect(realpathSync(args[0])).toBe(realpathSync(dir));
    expect(args.slice(1)).toEqual(['--bg', '-n', 'Habblaud: faça $(rm -rf x) && y', '--', 'faça $(rm -rf x) && y']);
    expect(await run({ folder: tmpdir(), prompt: 'oi' })).toEqual({ ok: false, error: 'Workspace not trusted. Run claude once' });
  });

  it('launch: roda em segundo plano; se não der, abre o app e diz por quê', async () => {
    const opened: string[] = [];
    const open: Opener = async (url) => (opened.push(url), { ok: true });
    expect(await launch({ folder: '/p', prompt: 'oi' }, open, async () => ({ ok: true, id: 'a' }))).toEqual({ ok: true, how: 'cli' });
    expect(opened).toEqual([]);
    const r = await launch({ folder: '/p', prompt: 'oi' }, open, async () => ({ ok: false, error: 'Workspace not trusted. Run `claude` in /p once' }));
    expect(r).toMatchObject({ ok: true, how: 'app', note: expect.stringMatching(/ainda não é confiável/) });
    expect(opened).toEqual([spawnUrl({ folder: '/p', prompt: 'oi' })]);
    expect(await launch({ folder: '/p', prompt: 'oi' }, open)).toEqual({ ok: true, how: 'app' });
    expect(await launch({ folder: '/p', prompt: 'oi' }, async () => ({ ok: false, error: 'open: x' }), async () => ({ ok: false, error: 'sem login' }))).toEqual({
      ok: false,
      error: 'sem login; e o app não abriu (open: x)',
    });
  });

  it('SpawnService: modo direto com o claude e confirmação do auxiliar com how/note', async () => {
    const s = new SpawnService({ opener: async () => ({ ok: true }), cli: async () => ({ ok: true, id: 'x' }), folderProblem: () => undefined, newId: () => 'c1' });
    s.submit({ folder: '/p', prompt: 'oi' });
    await new Promise((ok) => setTimeout(ok, 0));
    expect(s.get('c1')).toEqual({ id: 'c1', folder: '/p', status: 'opened', how: 'cli' });
    let n = 0;
    const d = new SpawnService({ newId: () => `d${++n}` });
    d.poll();
    d.submit({ folder: '/p', prompt: 'a' });
    d.submit({ folder: '/p', prompt: 'b' });
    d.submit({ folder: '/p', prompt: 'c' });
    d.poll();
    d.ack({ results: [{ id: 'd1', ok: true, how: 'cli' }, { id: 'd2', ok: true, how: 'app', note: 'pasta nova' }, { id: 'd3', ok: true }] });
    expect(d.get('d1')).toMatchObject({ status: 'opened', how: 'cli' });
    expect(d.get('d2')).toMatchObject({ status: 'opened', how: 'app', note: 'pasta nova' });
    expect(d.get('d3')).toMatchObject({ status: 'opened', how: 'app' });
  });
});
