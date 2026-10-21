// Nomes fictícios dos andares (shared/world/floor-names.ts, copiado igual no servidor do mundo) e os rótulos traduzidos.
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import { floorLabel, isFloorNameId } from './floor-labels';
import { FLOOR_NAME_IDS } from './floor-names';

afterEach(() => setLocale('pt-BR'));

describe('nomes dos andares', () => {
  it('60 ids ASCII, sem repetir, e a ordem do sorteio começa por ipe, jade e aurora', () => {
    expect(FLOOR_NAME_IDS).toHaveLength(60);
    expect(new Set(FLOOR_NAME_IDS).size).toBe(60);
    for (const id of FLOOR_NAME_IDS) expect(id).toMatch(/^[a-z]+$/);
    expect([FLOOR_NAME_IDS[0], FLOOR_NAME_IDS[20], FLOOR_NAME_IDS[40]]).toEqual(['ipe', 'jade', 'aurora']);
  });

  it('cada id tem rótulo próprio nos 4 idiomas', () => {
    expect(floorLabel('ipe')).toBe('Projeto Ipê');
    expect(floorLabel('lapislazuli')).toBe('Projeto Lápis-lazúli');
    const pt = FLOOR_NAME_IDS.map(floorLabel);
    expect(new Set(pt).size).toBe(60);
    for (const [locale, prefix] of [['en', 'Project '], ['es', 'Proyecto '], ['fr', 'Projet ']] as const) {
      setLocale(locale);
      const labels = FLOOR_NAME_IDS.map(floorLabel);
      expect(new Set(labels).size, locale).toBe(60);
      for (const l of labels) expect(l.startsWith(prefix), `${locale}: ${l}`).toBe(true);
    }
    setLocale('en');
    expect(floorLabel('ipe')).toBe('Project Ipê');
    expect(floorLabel('carvalho')).toBe('Project Oak');
  });

  it('id desconhecido (de uma versão mais nova do servidor) vira só "Projeto"', () => {
    expect(isFloorNameId('ipe')).toBe(true);
    expect(isFloorNameId('novo')).toBe(false);
    expect(floorLabel('novo')).toBe('Projeto');
  });
});
