// Ids do mundo (server/world/ids.ts) com relógio falso: aleatórios, estáveis por 24 h ± 6 h, trocados sozinhos, novos
// para quem some e volta, e nunca derivados da chave do escritório.
import { describe, expect, it } from 'vitest';
import { ID_JITTER_MS, ID_LIFETIME_MS, WorldIds } from './ids';

const H = 3_600_000;
const T0 = 1_760_000_000_000;

describe('WorldIds', () => {
  it('formato do contrato: f_ + 10 hex e a_ + 8 hex', () => {
    const ids = new WorldIds();
    expect(ids.floorId('/Users/ana/projeto', T0)).toMatch(/^f_[0-9a-f]{10}$/);
    expect(ids.agentId('.claude:1234', T0)).toMatch(/^a_[0-9a-f]{8}$/);
  });

  it('aleatórios, não derivados: a mesma chave dá ids diferentes em outra instância (outro processo)', () => {
    const a = new WorldIds();
    const b = new WorldIds();
    const keys = Array.from({ length: 20 }, (_, i) => `/p/${i}`);
    const fa = keys.map((k) => a.floorId(k, T0));
    const fb = keys.map((k) => b.floorId(k, T0));
    expect(fa.filter((id, i) => id === fb[i])).toEqual([]);
    expect(new Set(fa).size).toBe(20);
  });

  it('o mesmo id enquanto vale; troca entre 18 h e 30 h, cada id com o seu sorteio', () => {
    let j = 0;
    const jitters = [-ID_JITTER_MS, ID_JITTER_MS, 0];
    const ids = new WorldIds({ jitter: () => jitters[j++ % jitters.length] });
    const f1 = ids.floorId('/p/a', T0); // vive 18 h
    const f2 = ids.floorId('/p/b', T0); // vive 30 h
    const a1 = ids.agentId('m1', T0); // vive 24 h
    for (const t of [T0 + H, T0 + 17 * H]) {
      expect(ids.floorId('/p/a', t)).toBe(f1);
      expect(ids.floorId('/p/b', t)).toBe(f2);
      expect(ids.agentId('m1', t)).toBe(a1);
    }
    expect(ids.floorId('/p/a', T0 + 18 * H)).not.toBe(f1);
    expect(ids.floorId('/p/b', T0 + 18 * H)).toBe(f2);
    expect(ids.agentId('m1', T0 + 24 * H - 1)).toBe(a1);
    expect(ids.agentId('m1', T0 + 24 * H)).not.toBe(a1);
    expect(ids.floorId('/p/b', T0 + 30 * H)).not.toBe(f2);
  });

  it('o sorteio padrão fica entre 18 h e 30 h', () => {
    const ids = new WorldIds();
    for (let i = 0; i < 50; i++) {
      const key = `/p/${i}`;
      const first = ids.floorId(key, T0);
      expect(ids.floorId(key, T0 + ID_LIFETIME_MS - ID_JITTER_MS - 1)).toBe(first);
      expect(ids.floorId(key, T0 + ID_LIFETIME_MS + ID_JITTER_MS)).not.toBe(first);
    }
  });

  it('quem some e volta renasce com id novo; a memória não cresce', () => {
    const ids = new WorldIds();
    const f = ids.floorId('/p/a', T0);
    const a = ids.agentId('m1', T0);
    ids.agentId('m2', T0);
    ids.sweep();
    // Na projeção seguinte só /p/a e m2 aparecem: m1 é esquecido.
    expect(ids.floorId('/p/a', T0 + 1000)).toBe(f);
    ids.agentId('m2', T0 + 1000);
    ids.sweep();
    expect(ids.size).toEqual({ floors: 1, agents: 1 });
    expect(ids.agentId('m1', T0 + 2000)).not.toBe(a);
    ids.sweep();
    ids.sweep();
    expect(ids.size).toEqual({ floors: 0, agents: 0 });
    expect(ids.floorId('/p/a', T0 + 3000)).not.toBe(f);
  });

  it('sem repetir id entre chaves, nem ao trocar', () => {
    let n = 0;
    // Fonte "ruim": repete o mesmo valor algumas vezes antes de mudar.
    const ids = new WorldIds({ randomBytes: (len) => new Uint8Array(len).fill(Math.floor(n++ / 3)), jitter: () => 0 });
    const a = ids.agentId('m1', T0);
    const b = ids.agentId('m2', T0);
    expect(a).not.toBe(b);
    const c = ids.agentId('m1', T0 + ID_LIFETIME_MS);
    expect(c).not.toBe(a);
    expect(c).not.toBe(b);
  });

  it('clear esquece tudo', () => {
    const ids = new WorldIds();
    const f = ids.floorId('/p/a', T0);
    ids.clear();
    expect(ids.floorId('/p/a', T0)).not.toBe(f);
  });
});
