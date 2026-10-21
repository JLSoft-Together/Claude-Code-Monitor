// Fachada: altura que cabe no lote, "+N" acima de 12 andares, janelas acesas na proporção working/total, as
// waiting piscando (ao menos uma), apagado no away, metade no modo discreto, chave do cache estável.
import { describe, expect, it } from 'vitest';
import { FACADE, FACADE_VARIANTS, facadeHeight, facadeKey, facadeModel, signRect, windowOrder, windowRect } from './facade';

const agents = (total: number, working: number, waiting = 0) => ({ total, working, waiting, idle: total - working - waiting });

describe('fachada', () => {
  it('cabe sempre no lote (12 tiles de fundo) e para de crescer em 12 andares', () => {
    expect(facadeHeight(0)).toBe(FACADE.roof + FACADE.ground);
    expect(facadeHeight(12)).toBe(facadeHeight(30));
    expect(facadeHeight(12)).toBeLessThanOrEqual(12 * 16);
    expect(facadeHeight(5)).toBe(FACADE.roof + 5 * FACADE.floor + FACADE.ground);
  });

  it('acima de 12 andares, desenha 12 e põe "+N"', () => {
    const m = facadeModel({ floors: 16, state: 'online', theme: 'none', agents: agents(4, 2) }, 'front', 7);
    expect(m.drawn).toBe(12);
    expect(m.plus).toBe(4);
    expect(facadeModel({ floors: 12, state: 'online', theme: 'none', agents: agents(4, 2) }, 'front', 7).plus).toBe(0);
  });

  it('acende as janelas na proporção trabalhando/total, em oitavos', () => {
    const m = facadeModel({ floors: 4, state: 'online', theme: 'none', agents: agents(8, 4) }, 'front', 3);
    const count = 4 * FACADE.cols;
    expect(m.litLevel).toBe(4);
    expect(m.lit).toHaveLength(Math.round(count / 2));
    const all = facadeModel({ floors: 4, state: 'online', theme: 'none', agents: agents(5, 5) }, 'front', 3);
    expect(all.lit).toHaveLength(count);
    // um agente trabalhando já acende alguma coisa
    expect(facadeModel({ floors: 10, state: 'online', theme: 'none', agents: agents(40, 1) }, 'front', 3).lit.length).toBeGreaterThan(0);
  });

  it('as janelas de quem espera piscam: ao menos uma, nunca uma acesa', () => {
    const m = facadeModel({ floors: 3, state: 'online', theme: 'none', agents: agents(30, 10, 1) }, 'back', 11);
    expect(m.waiting.length).toBeGreaterThanOrEqual(1);
    for (const w of m.waiting) expect(m.lit).not.toContain(w);
  });

  it('away apaga tudo (nada pisca); modo discreto acende metade sem piscar', () => {
    const away = facadeModel({ floors: 3, state: 'away', theme: 'halloween', agents: agents(4, 4, 0) }, 'front', 1);
    expect(away.lit).toEqual([]);
    expect(away.waiting).toEqual([]);
    expect(away.litLevel).toBe(0);
    const discreet = facadeModel({ floors: 2, state: 'online', theme: 'none' }, 'front', 1);
    expect(discreet.discreet).toBe(true);
    expect(discreet.litLevel).toBe(4);
    expect(discreet.waiting).toEqual([]);
  });

  it('a ordem das janelas é uma permutação determinística', () => {
    const o = windowOrder(5, 33);
    expect([...o].sort((a, b) => a - b)).toEqual(Array.from({ length: 33 }, (_, i) => i));
    expect(windowOrder(5, 33)).toEqual(o);
    expect(windowOrder(6, 33)).not.toEqual(o);
  });

  it('janelas e placa ficam dentro do sprite', () => {
    for (const side of ['front', 'back'] as const) {
      const m = facadeModel({ floors: 12, state: 'online', theme: 'christmas', agents: agents(2, 1) }, side, 99);
      for (let i = 0; i < m.drawn * FACADE.cols; i++) {
        const r = windowRect(m, i);
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(FACADE.w);
        expect(r.y).toBeGreaterThanOrEqual(FACADE.roof);
        expect(r.y + r.h).toBeLessThanOrEqual(m.height - FACADE.ground);
      }
      const s = signRect(m);
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.y + s.h).toBeLessThanOrEqual(m.height);
    }
  });

  it('a chave do cache só muda com o que muda o desenho, e as variantes não crescem com os lotes', () => {
    const a = facadeModel({ floors: 3, state: 'online', theme: 'none', agents: agents(4, 2) }, 'front', 7);
    const b = facadeModel({ floors: 3, state: 'online', theme: 'none', agents: agents(8, 4) }, 'front', 7 + FACADE_VARIANTS);
    expect(facadeKey(a)).toBe(facadeKey(b));
    const c = facadeModel({ floors: 3, state: 'away', theme: 'none', agents: agents(4, 2) }, 'front', 7);
    expect(facadeKey(c)).not.toBe(facadeKey(a));
  });
});
