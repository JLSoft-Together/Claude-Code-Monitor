import { describe, expect, it } from 'vitest';
import { computeInsets, INSET_GAP, MIN_FREE, sameInsets, sameSelection, type PanelGeometry } from './viewport';

const desktop: PanelGeometry = {
  vw: 1440,
  vh: 900,
  topBottom: 64,
  sideRight: 314,
  drawerLeft: 1050,
  drawerTop: 74,
  drawerSheet: false,
  feedOpenH: 200,
  feedClosedH: 38,
  feedMargin: 10,
};
const g = INSET_GAP;

describe('computeInsets', () => {
  it('desktop: barra superior, barra lateral aberta e feed aberto', () => {
    expect(computeInsets(desktop, { sidebar: true, feed: true, drawer: false, narrow: false })).toEqual({
      top: 64 + g,
      left: 314 + g,
      right: 0,
      bottom: 200 + 10 + g,
    });
  });

  it('gaveta aberta conta à direita; feed recolhido ainda ocupa a faixa do cabeçalho', () => {
    expect(computeInsets(desktop, { sidebar: false, feed: false, drawer: true, narrow: false })).toEqual({
      top: 64 + g,
      left: 0,
      right: 1440 - 1050 + g,
      bottom: 38 + 10 + g,
    });
  });

  it('tela estreita: a barra lateral é sobreposta (com fundo escuro) e não conta', () => {
    expect(computeInsets(desktop, { sidebar: true, feed: false, drawer: false, narrow: true }).left).toBe(0);
  });

  it('celular: a gaveta é uma folha inferior e conta embaixo, não à direita', () => {
    const phone: PanelGeometry = { ...desktop, vw: 390, vh: 844, topBottom: 108, drawerLeft: 8, drawerTop: 346, drawerSheet: true, feedOpenH: 371, feedMargin: 8 };
    const ins = computeInsets(phone, { sidebar: false, feed: false, drawer: true, narrow: true });
    expect(ins).toEqual({ top: 108 + g, left: 0, right: 0, bottom: 844 - 346 + g });
    // A faixa livre acima da folha continua utilizável.
    expect(844 - ins.top - ins.bottom).toBeGreaterThanOrEqual(MIN_FREE);
  });

  it('janela pequena demais: os painéis cedem para sobrar uma área mínima', () => {
    const tiny: PanelGeometry = { ...desktop, vw: 700, vh: 360 };
    const ins = computeInsets(tiny, { sidebar: true, feed: true, drawer: true, narrow: false });
    expect(700 - ins.left - ins.right).toBeGreaterThanOrEqual(MIN_FREE - 1);
    expect(360 - ins.top - ins.bottom).toBeGreaterThanOrEqual(MIN_FREE - 1);
    expect(ins.left).toBeGreaterThan(0);
    expect(ins.right).toBeGreaterThan(0);
  });
});

describe('comparações', () => {
  it('sameInsets ignora diferenças abaixo de 1 px', () => {
    const a = { top: 72, right: 0, bottom: 218, left: 322 };
    expect(sameInsets(a, { ...a, left: 322.4 })).toBe(true);
    expect(sameInsets(a, { ...a, right: 398 })).toBe(false);
    expect(sameInsets(null, a)).toBe(false);
  });

  it('sameSelection', () => {
    expect(sameSelection(null, null)).toBe(true);
    expect(sameSelection({ type: 'agent', id: 'a' }, { type: 'agent', id: 'a' })).toBe(true);
    expect(sameSelection({ type: 'agent', id: 'a' }, { type: 'room', id: 'a' })).toBe(false);
    expect(sameSelection({ type: 'agent', id: 'a' }, null)).toBe(false);
  });
});
