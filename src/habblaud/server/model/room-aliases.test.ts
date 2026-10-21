import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RoomAliases } from './room-aliases';

const ASSETS = String.raw`C:\Users\x\.habblaud\assets`;
const DASH = String.raw`C:\repos\dash`;

describe('RoomAliases', () => {
  it('padrão, apelido por pasta (barras e maiúsculas tanto faz), vazio volta ao padrão e persiste', () => {
    const dir = mkdtempSync(join(tmpdir(), 'habblaud-rooms-'));
    try {
      const file = join(dir, 'rooms.json');
      const a = new RoomAliases(file);
      a.setDefault(ASSETS, 'Arquiteto');
      expect(a.get('c:/users/x/.habblaud/assets/')).toBe('Arquiteto');
      expect(a.set(DASH, '  Painel   do  Dash ')).toBe('Painel do Dash');
      expect(a.set(ASSETS, 'Oficina')).toBe('Oficina');
      const b = new RoomAliases(file);
      b.load();
      expect(b.get('c:/repos/dash')).toBe('Painel do Dash');
      b.setDefault(ASSETS, 'Arquiteto');
      expect(b.set(ASSETS, '')).toBe('Arquiteto');
      expect(b.get('/outro')).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
