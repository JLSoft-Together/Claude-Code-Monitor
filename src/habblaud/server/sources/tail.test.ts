import { appendFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { log } from '../log';
import { tempDir } from '../test/fixtures';
import { FileTail, MAX_LINE_BYTES } from './tail';

function drain(t: FileTail): string[] {
  const all: string[] = [];
  for (let i = 0; i < 80; i++) {
    const r = t.read();
    all.push(...r.lines);
    if (!r.more) return all;
  }
  throw new Error('leitura não terminou');
}

describe('FileTail', () => {
  let tmp: ReturnType<typeof tempDir>;
  let file: string;
  beforeEach(() => {
    tmp = tempDir();
    file = join(tmp.dir, 'a.jsonl');
  });
  afterEach(() => tmp.cleanup());

  it('lê só linhas completas e guarda a linha parcial para o próximo ciclo', () => {
    writeFileSync(file, '{"a":1}\n{"b":');
    const t = new FileTail(file);
    expect(t.read().lines).toEqual(['{"a":1}']);
    expect(t.read().lines).toEqual([]);
    appendFileSync(file, '2}\n{"c":3}\n');
    expect(t.read().lines).toEqual(['{"b":2}', '{"c":3}']);
  });

  it('não quebra caracteres multibyte divididos entre leituras', () => {
    const line = JSON.stringify({ t: 'ação — café ☕' });
    const buf = Buffer.from(`${line}\n`);
    writeFileSync(file, buf.subarray(0, 12));
    const t = new FileTail(file);
    expect(t.read().lines).toEqual([]);
    appendFileSync(file, buf.subarray(12));
    expect(t.read().lines).toEqual([line]);
  });

  it('detecta truncamento e recomeça do início', () => {
    writeFileSync(file, 'um\ndois\n');
    const t = new FileTail(file);
    expect(t.read().lines).toEqual(['um', 'dois']);
    writeFileSync(file, 'x\n');
    const r = t.read();
    expect(r.reset).toBe(true);
    expect(r.lines).toEqual(['x']);
  });

  it('detecta arquivo substituído (rotação) mesmo maior', () => {
    writeFileSync(file, 'a\n');
    const t = new FileTail(file);
    t.read();
    rmSync(file);
    writeFileSync(file, 'novo-1\nnovo-2\n');
    const r = t.read();
    expect(r.reset).toBe(true);
    expect(r.lines).toEqual(['novo-1', 'novo-2']);
  });

  it('não trata linhas acrescentadas ao mesmo arquivo como rotação', () => {
    writeFileSync(file, 'a\n');
    const t = new FileTail(file);
    t.read();
    appendFileSync(file, 'b\nc\n');
    const r = t.read();
    expect(r.reset).toBe(false);
    expect(r.lines).toEqual(['b', 'c']);
  });

  describe('reescrita no mesmo inode', () => {
    /** Espera o relógio do sistema de arquivos andar (o ext4 grava os tempos em ticks de alguns ms). */
    const tick = () => new Promise((ok) => setTimeout(ok, 15));

    it('conteúdo novo do mesmo tamanho recomeça do início', async () => {
      writeFileSync(file, 'aaaa\nbbbb\ncccc\n');
      const t = new FileTail(file);
      expect(t.read().lines).toEqual(['aaaa', 'bbbb', 'cccc']);
      await tick();
      writeFileSync(file, 'xxxx\nyyyy\nzzzz\n'); // mesmo inode, mesmo tamanho
      const r = t.read();
      expect(r.reset).toBe(true);
      expect(r.lines).toEqual(['xxxx', 'yyyy', 'zzzz']);
    });

    it('conteúdo novo maior recomeça do início', async () => {
      writeFileSync(file, 'um\ndois\n');
      const t = new FileTail(file);
      t.read();
      await tick();
      writeFileSync(file, 'novo-1\nnovo-2\nnovo-3\n');
      const r = t.read();
      expect(r.reset).toBe(true);
      expect(r.lines).toEqual(['novo-1', 'novo-2', 'novo-3']);
    });

    it('só acrescentar linhas (o mtime muda, o começo não) não é troca', async () => {
      writeFileSync(file, 'a\n');
      const t = new FileTail(file);
      t.read();
      await tick();
      appendFileSync(file, 'b\n');
      expect(t.read()).toMatchObject({ reset: false, lines: ['b'] });
      await tick();
      appendFileSync(file, 'c\n');
      expect(t.read()).toMatchObject({ reset: false, lines: ['c'] });
    });

    it('tocar no arquivo sem mudar o conteúdo não é troca', async () => {
      writeFileSync(file, 'a\nb\n');
      const t = new FileTail(file);
      t.read();
      await tick();
      const now = new Date();
      utimesSync(file, now, now);
      expect(t.read()).toMatchObject({ reset: false, lines: [] });
    });
  });

  it('informa arquivo inexistente sem lançar erro', () => {
    const t = new FileTail(join(tmp.dir, 'nao-existe.jsonl'));
    expect(t.read()).toMatchObject({ missing: true, lines: [] });
  });

  it('seekTail alinha no início da próxima linha', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `linha-${String(i).padStart(3, '0')}`);
    writeFileSync(file, lines.map((l) => `${l}\n`).join(''));
    const t = new FileTail(file);
    const start = t.seekTail(25);
    expect(start).toBeGreaterThan(0);
    const got = t.read().lines;
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((l) => /^linha-\d{3}$/.test(l))).toBe(true);
    expect(got.at(-1)).toBe('linha-049');
  });

  it('seekTail em arquivo pequeno lê tudo', () => {
    writeFileSync(file, 'a\nb\n');
    const t = new FileTail(file);
    expect(t.seekTail(1024)).toBe(0);
    expect(t.read().lines).toEqual(['a', 'b']);
  });

  it('respeita o limite por leitura e sinaliza que há mais', () => {
    writeFileSync(file, 'aaaa\nbbbb\ncccc\n');
    const t = new FileTail(file, { maxChunk: 6 });
    const r1 = t.read();
    expect(r1.lines).toEqual(['aaaa']);
    expect(r1.more).toBe(true);
    const all = [...r1.lines];
    for (let i = 0; i < 5; i++) all.push(...t.read().lines);
    expect(all).toEqual(['aaaa', 'bbbb', 'cccc']);
  });

  it('descarta a linha parcial que passa do teto e segue na próxima', () => {
    writeFileSync(file, Buffer.alloc(MAX_LINE_BYTES + 64 * 1024, 0x61));
    const t = new FileTail(file, { maxChunk: 256 * 1024 });
    const warn = vi.spyOn(log, 'warnOnce').mockImplementation(() => {});
    try {
      expect(drain(t)).toEqual([]);
      appendFileSync(file, '\n{"ok":1}\n');
      const lines = drain(t);
      // O tamanho vem antes do texto: uma falha não despeja a linha gigante no diff.
      expect(lines.map((l) => l.length)).toEqual([8]);
      expect(lines).toEqual(['{"ok":1}']);
      expect(warn).toHaveBeenCalledWith(`oversize-line:${file}`, expect.stringContaining('8 MiB'));
    } finally {
      warn.mockRestore();
    }
  });

  it('entrega uma linha do tamanho exato do teto', () => {
    expect(MAX_LINE_BYTES).toBe(8 * 1024 * 1024);
    writeFileSync(file, Buffer.concat([Buffer.alloc(MAX_LINE_BYTES, 0x62), Buffer.from('\nok\n')]));
    const t = new FileTail(file, { maxChunk: 256 * 1024 });
    const lines = drain(t);
    expect(lines.length).toBe(2);
    expect(lines[0]?.length).toBe(MAX_LINE_BYTES);
    expect(lines[0]?.charCodeAt(0)).toBe(0x62);
    expect(lines[0]?.charCodeAt(MAX_LINE_BYTES - 1)).toBe(0x62);
    expect(lines[1]).toBe('ok');
  });
});
