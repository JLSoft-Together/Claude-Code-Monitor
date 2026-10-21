// Partículas: pool fixo (sem crescer), vida útil e física básica.
import { describe, expect, it } from 'vitest';
import { Particles } from './particles';

describe('partículas', () => {
  it('confete some depois da vida útil; pipoca volta a cair', () => {
    const p = new Particles(100);
    p.confetti(10, 10, 30);
    p.popcorn(0, 0);
    expect(p.count).toBe(31);
    p.update(0.05);
    expect(p.count).toBe(31);
    for (let i = 0; i < 40; i++) p.update(0.1);
    expect(p.count).toBe(0);
  });

  it('o pool nunca passa da capacidade', () => {
    const p = new Particles(20);
    for (let i = 0; i < 10; i++) p.confetti(0, 0, 10);
    expect(p.count).toBe(20);
    p.clear();
    expect(p.count).toBe(0);
  });

  it('chuva cai a distância pedida e acaba', () => {
    const p = new Particles(10);
    p.rain(0, 0, 6);
    p.update(0.05);
    expect(p.count).toBe(1);
    p.update(0.1);
    p.update(0.1);
    expect(p.count).toBe(0);
  });
});
