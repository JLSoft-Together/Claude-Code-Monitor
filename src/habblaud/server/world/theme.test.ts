import { describe, expect, it } from 'vitest';
import { WORLD_THEME_CHOICES, isWorldThemeChoice } from '../../shared/world/api';
import { resolveWorldTheme } from './theme';

const d = (m: number, day: number, h = 12) => new Date(2026, m - 1, day, h);

describe('resolveWorldTheme', () => {
  it('escolha fixa vai como está', () => {
    for (const t of ['none', 'halloween', 'christmas'] as const) expect(resolveWorldTheme(t, d(7, 1))).toBe(t);
  });

  it('automático: Halloween em outubro, Natal de 1/11 a 26/12, nenhum no resto (hora local)', () => {
    const cases: Array<[Date, string]> = [
      [d(9, 30, 23), 'none'],
      [d(10, 1, 0), 'halloween'],
      [d(10, 31, 23), 'halloween'],
      [d(11, 1, 0), 'christmas'],
      [d(12, 26, 23), 'christmas'],
      [d(12, 27, 0), 'none'],
      [d(1, 1), 'none'],
      [d(6, 15), 'none'],
    ];
    for (const [date, theme] of cases) expect(resolveWorldTheme('auto', date), date.toString()).toBe(theme);
    expect(resolveWorldTheme(undefined, d(10, 15))).toBe('halloween');
  });

  it('escolhas aceitas', () => {
    expect([...WORLD_THEME_CHOICES]).toEqual(['auto', 'none', 'halloween', 'christmas']);
    expect(isWorldThemeChoice('auto')).toBe(true);
    expect(isWorldThemeChoice('pascoa')).toBe(false);
    expect(isWorldThemeChoice(undefined)).toBe(false);
  });
});
