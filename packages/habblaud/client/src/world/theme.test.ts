import { describe, expect, it } from 'vitest';
import { seasonalThemeFor } from './api';

describe('tema do escritório', () => {
  const at = (month: number, day: number, hour = 12) => new Date(2026, month - 1, day, hour);

  it('automático segue o calendário (hora local)', () => {
    expect(seasonalThemeFor('auto', at(9, 30, 23))).toBe('none');
    expect(seasonalThemeFor('auto', at(10, 1, 0))).toBe('halloween');
    expect(seasonalThemeFor('auto', at(10, 31, 23))).toBe('halloween');
    expect(seasonalThemeFor('auto', at(11, 1, 0))).toBe('christmas');
    expect(seasonalThemeFor('auto', at(12, 26, 23))).toBe('christmas');
    expect(seasonalThemeFor('auto', at(12, 27, 0))).toBe('none');
    expect(seasonalThemeFor('auto', at(1, 1))).toBe('none');
    expect(seasonalThemeFor('auto', at(7, 15))).toBe('none');
    // Sem preferência (opções antigas do mundo) vale o automático.
    expect(seasonalThemeFor(undefined, at(10, 13))).toBe('halloween');
  });

  it('escolha fixa vale o ano todo', () => {
    for (const date of [at(1, 1), at(10, 13), at(12, 1)]) {
      expect(seasonalThemeFor('none', date)).toBe('none');
      expect(seasonalThemeFor('christmas', date)).toBe('christmas');
      expect(seasonalThemeFor('halloween', date)).toBe('halloween');
    }
  });
});
