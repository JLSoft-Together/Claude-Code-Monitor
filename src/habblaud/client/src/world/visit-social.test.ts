// O social dentro do prédio (Fase 5), a parte pura: o carimbo de hoje (dia UTC) e o quadro de carimbos da recepção.
import { describe, expect, it } from 'vitest';
import { stampBoard, stampedToday, stampKey, stampPinTitle, stampReply, utcDay } from './visit-social';

describe('carimbo de hoje', () => {
  it('um por prédio por dia UTC; o de ontem, um id fora da lista ou lixo não valem', () => {
    const day = utcDay(Date.UTC(2026, 9, 15, 23, 59));
    expect(day).toBe('2026-10-15');
    expect(stampedToday(JSON.stringify({ day, stampId: 'rocket' }), day)).toBe('rocket');
    expect(stampedToday(JSON.stringify({ day: '2026-10-14', stampId: 'rocket' }), day)).toBeNull();
    expect(stampedToday(JSON.stringify({ day, stampId: 'texto livre' }), day)).toBeNull();
    expect(stampedToday('{', day)).toBeNull();
    expect(stampedToday(null, day)).toBeNull();
    expect(stampKey('b1')).toBe('habblaud:world-stamp:b1');
  });
});

describe('quadro de carimbos da recepção', () => {
  it('o meu primeiro, depois os mais recebidos; posições dentro do quadro e iguais a cada chamada', () => {
    const entries = [{ stampId: 'star' as const, count: 3 }, { stampId: 'coffee' as const, count: 1 }, { stampId: 'rocket' as const, mine: true }];
    const a = stampBoard(entries, 7);
    expect(a.map((p) => p.stampId)).toEqual(['rocket', 'star', 'coffee']);
    expect(a[0]).toMatchObject({ mine: true, icon: '🚀' });
    for (const p of a) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(1);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(1);
      expect(Math.abs(p.rot)).toBeLessThanOrEqual(12);
    }
    expect(stampBoard(entries, 7)).toEqual(a);
    expect(stampPinTitle(a[1]!)).toBe('Nota 10 ×3');
  });

  it('no máximo `max` carimbos; ids fora da lista ficam de fora', () => {
    const many = Array.from({ length: 12 }, () => ({ stampId: 'heart' as const }));
    expect(stampBoard(many, 1, 8)).toHaveLength(8);
    expect(stampBoard([{ stampId: 'xx' as never }], 1)).toEqual([]);
  });
});

describe('a resposta a um carimbo', () => {
  it('stamped confirma (o carimbo fica), already_done diz que já havia um, o resto desfaz', () => {
    expect(stampReply('stamped')).toBe('ok');
    expect(stampReply('already_done')).toBe('already');
    for (const t of ['too_far', 'not_found', 'blocked', 'rate_limited', 'id_novo']) expect(stampReply(t), t).toBe('failed');
  });
});
