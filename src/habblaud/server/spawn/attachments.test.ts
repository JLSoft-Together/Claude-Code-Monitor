import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../test/fixtures';
import { ATTACHMENT_MAX_BYTES, ATTACHMENTS_PER_SPAWN, AttachmentStore, parseAttachment, promptWithAttachments, safeFileName, writeAttachments } from './attachments';

const b64 = (s: string) => Buffer.from(s).toString('base64');

describe('anexos do Novo agente', () => {
  it('nome seguro: sem caminho, controles nem ponto no começo', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('C:\\Users\\x\\foto 1.jpg')).toBe('foto 1.jpg');
    expect(safeFileName('.env')).toBe('env');
    expect(safeFileName('a\u0000b:c?.png')).toBe('a_b_c_.png');
    expect(safeFileName('')).toBe('arquivo');
    const long = safeFileName(`${'x'.repeat(300)}.jpeg`);
    expect(long.length).toBe(120);
    expect(long.endsWith('.jpeg')).toBe(true);
  });

  it('parseAttachment: base64 válido, não vazio e no limite', () => {
    expect(parseAttachment({ name: 'a.png', type: 'image/png', data: b64('oi') })).toMatchObject({ name: 'a.png', type: 'image/png' });
    expect(parseAttachment({ name: 'a', type: 'bad type', data: b64('oi') })).toMatchObject({ type: 'application/octet-stream' });
    expect(parseAttachment({ name: 'a', data: '' })).toHaveProperty('error');
    expect(parseAttachment({ name: 'a', data: 'não é base64!' })).toHaveProperty('error');
    expect(parseAttachment({ name: 'a', data: Buffer.alloc(ATTACHMENT_MAX_BYTES + 1).toString('base64') })).toHaveProperty('error');
  });

  it('o depósito entrega cada anexo uma vez, expira e limita a quantidade', () => {
    let now = 0;
    let n = 0;
    const store = new AttachmentStore(() => now, () => `id${++n}`);
    const a = store.put({ name: 'a.txt', type: 'text/plain', data: Buffer.from('a') });
    const b = store.put({ name: 'b.txt', type: 'text/plain', data: Buffer.from('b') });
    expect(a).toEqual({ id: 'id1' });
    expect(store.take(['id1', 'id2'])).toHaveLength(2);
    expect(store.take(['id1'])).toHaveProperty('error');
    expect(b).toEqual({ id: 'id2' });
    store.put({ name: 'c', type: 't/t', data: Buffer.from('c') });
    now += 31 * 60_000;
    expect(store.take(['id3'])).toHaveProperty('error');
    expect(store.take(undefined)).toEqual([]);
    expect(store.take('id1')).toHaveProperty('error');
    expect(store.take(Array.from({ length: ATTACHMENTS_PER_SPAWN + 1 }, (_, i) => `x${i}`))).toHaveProperty('error');
  });

  it('grava numa pasta nova (700, arquivos 600) com nomes únicos', () => {
    const root = tempDir().dir;
    const files = [
      { name: 'foto.jpg', type: 'image/jpeg', data: Buffer.from('1') },
      { name: 'foto.jpg', type: 'image/jpeg', data: Buffer.from('2') },
      { name: '../nota.txt', type: 'text/plain', data: Buffer.from('3') },
    ];
    const paths = writeAttachments(root, 'abcdef12-3456', files, new Date(2026, 9, 12, 13, 5, 9));
    expect(paths.map((p) => p.split('/').slice(-2).join('/'))).toEqual(['20261012-130509-abcdef12/foto.jpg', '20261012-130509-abcdef12/foto-2.jpg', '20261012-130509-abcdef12/nota.txt']);
    const dir = join(root, '20261012-130509-abcdef12');
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(paths[0]).mode & 0o777).toBe(0o600);
    expect(readFileSync(paths[1], 'utf8')).toBe('2');
    expect(readdirSync(dir)).toHaveLength(3);
    expect(writeAttachments(root, 'x', [])).toEqual([]);
  });

  it('o pedido ganha a lista dos caminhos', () => {
    expect(promptWithAttachments('Corrija o layout', ['/h/.habblaud/attachments/x/print.png'])).toBe(
      'Corrija o layout\n\nAnexo enviado pelo Habblaud (leia antes de começar):\n- /h/.habblaud/attachments/x/print.png',
    );
    expect(promptWithAttachments('', ['/a', '/b'])).toBe('Anexos enviados pelo Habblaud (leia antes de começar):\n- /a\n- /b');
    expect(promptWithAttachments('só texto', [])).toBe('só texto');
  });

  it('teto de memória: conta também os anexos já tirados por pedidos na fila, até serem soltos', () => {
    let n = 0;
    const store = new AttachmentStore(Date.now, () => `a${++n}`, 10);
    const file = (size: number) => ({ name: 'x.png', type: 'image/png', data: Buffer.alloc(size, 1) });
    expect(store.put(file(6))).toEqual({ id: 'a1' });
    const taken = store.take(['a1']);
    expect(Array.isArray(taken) && taken.length).toBe(1);
    // Os 6 bytes saíram do depósito, mas seguem na memória (pedido na fila): 6 + 6 passa do teto.
    expect(store.put(file(6))).toHaveProperty('error');
    store.release(6);
    expect(store.put(file(6))).toEqual({ id: 'a2' });
  });
});
