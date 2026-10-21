import { describe, expect, it } from 'vitest';
import { usageRowFits, type UsageRowInput } from './usage-row';

// Medidas reais da barra no demo (5 contas, cartões com no mínimo 128 px): marca 265, contadores 179, botões 249.
const bar = (over: Partial<UsageRowInput> = {}): UsageRowInput => ({
  barWidth: 1182,
  others: [265, 179, 249],
  gap: 12,
  cardGap: 8,
  cards: [128, 128, 128, 128, 128],
  ...over,
});

describe('usageRowFits', () => {
  it('sem cartões sempre cabe', () => {
    expect(usageRowFits(bar({ cards: [] }))).toBe(true);
  });

  it('cabe quando sobra espaço depois dos outros itens', () => {
    expect(usageRowFits(bar({ barWidth: 1420 }))).toBe(true);
  });

  it('5 contas numa janela de 1200 px não cabem: sobram 453 px para 672 px de cartões', () => {
    expect(usageRowFits(bar())).toBe(false);
  });

  it('o limite é exato: cabendo justo ainda cabe', () => {
    // usado = 265 + 179 + 249 + 3 x 12 = 729; cartões = 5 x 128 + 4 x 8 = 672 -> largura mínima 1401.
    expect(usageRowFits(bar({ barWidth: 1401 }))).toBe(true);
    expect(usageRowFits(bar({ barWidth: 1400 }))).toBe(false);
  });

  it('quanto menor o cartão, mais contas cabem', () => {
    expect(usageRowFits(bar({ barWidth: 1182, cards: [128, 128] }))).toBe(true);
    expect(usageRowFits(bar({ barWidth: 1182, cards: [188, 188, 188, 188, 188] }))).toBe(false);
  });

  it('um único cartão não paga espaço entre cartões', () => {
    // 249 + 265 + 179 + 36 = 729 usados; 453 livres: um cartão de 453 cabe, de 454 não.
    expect(usageRowFits(bar({ barWidth: 1182, cards: [453] }))).toBe(true);
    expect(usageRowFits(bar({ barWidth: 1182, cards: [454] }))).toBe(false);
  });
});
