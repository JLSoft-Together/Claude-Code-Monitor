// docs/world/privacidade.md é a lista do que sai do computador: todo campo do pacote do prédio (schema.json) e da
// primeira mensagem da conexão (`hello`) tem de estar citado lá, entre crases. Campo novo no pacote sem a página
// atualizada derruba este teste (regra 3 de shared/world/README.md).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HelloMessage } from '../../shared/world/protocol';
import schemaJson from '../../shared/world/schema.json';
import { schemaKeyPaths } from '../../shared/world/schema-validator';

const DOC = readFileSync(join(import.meta.dirname, '..', '..', 'docs', 'world', 'privacidade.md'), 'utf8');
const cited = (field: string) => DOC.includes(`\`${field}\``);

describe('docs/world/privacidade.md', () => {
  it('cita cada campo do schema.json', () => {
    const paths = [...schemaKeyPaths(schemaJson as unknown as { [k: string]: unknown })];
    const fields = new Set(paths.map((p) => p.split('.').pop()!.replace(/\[\]$/, '')));
    expect(fields.size).toBeGreaterThanOrEqual(30);
    for (const f of fields) expect(cited(f), `campo \`${f}\` do schema.json sem citação em docs/world/privacidade.md`).toBe(true);
  });

  it('cita cada campo do hello (e o build por dentro)', () => {
    const hello: Record<keyof Omit<HelloMessage, 't' | 'v'>, true> = { version: true, build: true, locale: true, token: true };
    for (const f of [...Object.keys(hello), 'commit', 'dirty']) expect(cited(f), f).toBe(true);
  });

  it('a conferência não passa à toa: um campo inventado não está lá', () => {
    expect(cited('costUSD')).toBe(false);
    expect(cited('gitBranch')).toBe(false);
  });
});
