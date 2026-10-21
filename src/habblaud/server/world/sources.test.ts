// Os arquivos que o servidor do Habblaud World guarda como cópia exata (protocol.ts e city.ts, com o SHA-256 conferido
// lá) não importam nada nem usam Node ou DOM: copiados byte a byte, compilam do outro lado. Fica aqui (e não ao lado
// deles, em shared/) porque precisa ler o disco.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(join(import.meta.dirname, '..', '..', 'shared', 'world', file), 'utf8');

describe('arquivos copiados para o servidor do mundo', () => {
  for (const file of ['protocol.ts', 'city.ts']) {
    it(`${file}: sem imports, sem Node nem DOM, com o aviso no topo`, () => {
      const src = read(file);
      expect(src).not.toMatch(/^\s*import\s/m);
      expect(src).not.toMatch(/\brequire\(|\bprocess\.|\bwindow\.|\bdocument\./);
      expect(src.startsWith('// AVISO')).toBe(true);
    });
  }
});
