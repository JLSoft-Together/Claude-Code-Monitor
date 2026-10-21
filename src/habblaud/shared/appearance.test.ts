import { describe, expect, it } from 'vitest';
import { NAME_MAX, nameKey, parseAppearanceParts, parseCharacterName, parseSeed, partsKey } from './appearance';

describe('parseAppearanceParts', () => {
  it('aceita peças válidas, devolve na ordem fixa e cores em minúsculas', () => {
    const p = parseAppearanceParts({ topStyle: 'jacket', skin: '#D69F78', hairStyle: 'bob' });
    expect(p).toEqual({ skin: '#d69f78', hairStyle: 'bob', topStyle: 'jacket' });
    expect(Object.keys(p!)).toEqual(['skin', 'hairStyle', 'topStyle']);
    expect(parseAppearanceParts({})).toEqual({});
  });

  it('recusa chave desconhecida, enum inválido, cor fora de #rrggbb e não-objeto', () => {
    const bad: unknown[] = [
      null,
      'x',
      1,
      [],
      { lanyard: '#ffffff' },
      { look: 'f' },
      { hairStyle: 'moicano' },
      { skin: '#fff' },
      { skin: 'red' },
      { skin: 1 },
      { accessory: undefined, hair: '#12345g' },
    ];
    for (const b of bad) expect(parseAppearanceParts(b)).toBeNull();
  });
});

describe('parseCharacterName', () => {
  it('apara, junta espaços (inclusive quebra de linha) e normaliza para NFC', () => {
    expect(parseCharacterName('  Ana   Paula ')).toBe('Ana Paula');
    expect(parseCharacterName('Ana\nPaula')).toBe('Ana Paula');
    // Escapes de propósito: NFD (u + U+0301) na entrada e NFC (U+00FA) no esperado; um editor normalizaria o literal.
    expect(parseCharacterName('Ju\u0301lia')).toBe('J\u00falia');
  });

  it(`1 a ${NAME_MAX} caracteres (emoji conta um), sem caracteres de controle`, () => {
    expect(parseCharacterName('a'.repeat(NAME_MAX))).toBe('a'.repeat(NAME_MAX));
    expect(parseCharacterName('🙂'.repeat(NAME_MAX))).toBe('🙂'.repeat(NAME_MAX));
    for (const bad of ['', '   ', 'a'.repeat(NAME_MAX + 1), 'Ana\u0000', 'Ana\u202e', 'Ana\u0085', 42, null]) {
      expect(parseCharacterName(bad)).toBeNull();
    }
  });
});

describe('nameKey, parseSeed e partsKey', () => {
  it('nameKey ignora caixa e forma Unicode', () => {
    // NFD em maiúsculas contra NFC em minúsculas, em escapes (ver o teste de parseCharacterName).
    expect(nameKey('JU\u0301LIA')).toBe(nameKey('j\u00falia'));
    expect(nameKey('Ana')).toBe(nameKey('ana'));
    expect(nameKey('Ana')).not.toBe(nameKey('Ána'));
  });

  it('parseSeed: inteiro de 0 a 2^32-1', () => {
    expect(parseSeed(0)).toBe(0);
    expect(parseSeed(4294967295)).toBe(4294967295);
    for (const bad of [-1, 4294967296, 1.5, '1', Number.NaN, null]) expect(parseSeed(bad)).toBeNull();
  });

  it('partsKey é estável (independe da ordem em que as peças foram postas)', () => {
    expect(partsKey(undefined)).toBe('');
    expect(partsKey({ hairStyle: 'bob', skin: '#000000' })).toBe(partsKey({ skin: '#000000', hairStyle: 'bob' }));
    expect(partsKey({ skin: '#000000' })).not.toBe(partsKey({ skin: '#000000', hairStyle: 'bob' }));
  });
});
