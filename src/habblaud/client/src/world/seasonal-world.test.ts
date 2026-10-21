// O tema automático do prédio no World (server/world/theme.ts) segue o mesmo calendário do escritório (seasonalThemeFor).
import { describe, expect, it } from 'vitest';
import { resolveWorldTheme } from '../../../server/world/theme';
import { seasonalThemeFor } from './api';

describe('tema automático: escritório e World', () => {
  it('o mesmo tema em todos os dias de 2026 e 2028 (bissexto)', () => {
    for (const year of [2026, 2028]) {
      for (let t = new Date(year, 0, 1, 12); t.getFullYear() === year; t = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1, 12)) {
        expect(resolveWorldTheme('auto', t), t.toDateString()).toBe(seasonalThemeFor('auto', t));
      }
    }
  });
});
