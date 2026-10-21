import { describe, expect, it } from 'vitest';
import { parsePlayerName, playerNameKey, type PlayerNameProblem } from './names-rules';
import { RESERVED_PLAYER_NAMES } from './protocol';

const ok = (raw: unknown) => {
  const r = parsePlayerName(raw);
  if (!r.ok) throw new Error(`recusado (${r.problem}): ${JSON.stringify(raw)}`);
  return r;
};
const problem = (raw: unknown): PlayerNameProblem | undefined => {
  const r = parsePlayerName(raw);
  return r.ok ? undefined : r.problem;
};

describe('parsePlayerName', () => {
  it('aceita nomes comuns e arruma espaços (trim e repetidos)', () => {
    expect(ok('Ana')).toEqual({ ok: true, name: 'Ana', key: 'ana' });
    expect(ok('  Márcio   Jr  ')).toEqual({ ok: true, name: 'Márcio Jr', key: 'marcio jr' });
    expect(ok('dev_ninja-42.x').name).toBe('dev_ninja-42.x');
  });

  it('acentos: NFC antes de contar, e o decomposto vira o composto', () => {
    const r = ok('Márcio');
    expect(r.name).toBe('Márcio');
    expect(r.name).toBe('Márcio'.normalize('NFC'));
    expect(r.key).toBe('marcio');
    expect(ok('Ñandú João Ü').key).toBe('nandu joao u');
  });

  it('tamanho: 3 a 20 caracteres (pontos de código), depois de arrumar', () => {
    expect(problem('Al')).toBe('length');
    expect(problem('  Al   ')).toBe('length');
    expect(ok('Ali').name).toBe('Ali');
    expect(ok('a'.repeat(20)).name).toHaveLength(20);
    expect(problem('a'.repeat(21))).toBe('length');
    expect(problem('a'.repeat(10_000))).toBe('length');
    // Letras fora do BMP contam como uma (não como dois code units).
    expect(ok('𝒜𝒷𝒸').name).toBe('𝒜𝒷𝒸');
  });

  it('recusa invisíveis, controle, marcas de direção e espaços especiais', () => {
    const cases = [
      'Ana​', // espaço de largura zero
      'A‍na', // ZWJ
      'A‌na', // ZWNJ
      'Ana‮txt', // inverte a direção
      'Ana‏txt', // marca RTL
      'ㅤㅤㅤ', // preenchimento do Hangul (letra que não desenha nada)
      'Anaﾠ', // preenchimento do Hangul de meia largura
      'An a', // espaço sem quebra
      'An　a', // espaço ideográfico
      'An\ta', // tab
      'An\na', // quebra de linha
      'Ana️', // seletor de variação
      'Ana­', // hífen suave
      'Ana\u0007', // controle
      'Ana', // uso privado
    ];
    for (const c of cases) expect(problem(c), JSON.stringify(c)).toBe('invisible');
  });

  it('recusa caracteres fora da lista e acentos empilhados', () => {
    for (const c of ['Ana!', 'Ana😀', 'ana@x', 'a/b/c', 'Ana٣', 'Ana４', '<b>oi</b>', '⠀⠀⠀']) {
      expect(problem(c), c).toBe('chars');
    }
    // Acento solto no começo e "zalgo".
    expect(problem('́Ana')).toBe('chars');
    expect(problem('Aná̂̃̄̅')).toBe('chars'); // o NFC junta o primeiro; sobram 4
    expect(ok('Aná̂̃̄').name).toHaveLength(6); // 3 sobrando ainda passam
    expect(ok('กี้ไทย').name).toBe('กี้ไทย'); // tailandês: 2 marcas seguidas é normal
  });

  it('um sistema de escrita só (japonês, coreano e chinês contam como um)', () => {
    expect(problem('Pаulo')).toBe('scripts'); // "а" cirílico no meio do latino
    expect(problem('Ana山')).toBe('scripts');
    expect(problem('Иван Smith')).toBe('scripts');
    for (const name of ['Παύλος', 'Иван', 'محمد', 'דוד', 'राहुल', '山田たろう', 'カタカナー', '김민수', '한국漢字', '王小明']) {
      expect(ok(name).name, name).toBe(name);
    }
    // Dígitos e separadores não contam como sistema.
    expect(ok('Иван_2000').name).toBe('Иван_2000');
  });

  it('precisa de pelo menos uma letra', () => {
    expect(problem('123')).toBe('no_letter');
    expect(problem('...')).toBe('no_letter');
    expect(problem('_-_')).toBe('no_letter');
  });

  it('reservados viram name_blocked, comparados pela chave sem separadores', () => {
    for (const name of RESERVED_PLAYER_NAMES) {
      const r = parsePlayerName(name.toUpperCase());
      expect(r, name).toEqual({ ok: false, code: 'name_blocked', problem: 'reserved' });
    }
    for (const name of ['Ad.Min', 'ad_min', 'Clàude', 'C L A U D E', 'ＡＤＭＩＮ']) expect(problem(name), name).toBe('reserved');
    expect(ok('Administradora').name).toBe('Administradora');
    expect(ok('Claudete').name).toBe('Claudete');
  });

  it('o resto dá name_invalid; não-texto também', () => {
    expect(parsePlayerName(42)).toEqual({ ok: false, code: 'name_invalid', problem: 'type' });
    expect(parsePlayerName(undefined)).toMatchObject({ ok: false, code: 'name_invalid' });
    expect(parsePlayerName('A!b')).toMatchObject({ ok: false, code: 'name_invalid' });
  });
});

describe('playerNameKey', () => {
  it('NFKC, minúsculas, sem diacríticos e espaços colapsados', () => {
    expect(playerNameKey('Márcio')).toBe('marcio');
    expect(playerNameKey('MARCIO')).toBe('marcio');
    expect(playerNameKey('ｍａｒｃｉｏ')).toBe('marcio');
    expect(playerNameKey('  Mar   cio ')).toBe('mar cio');
    expect(playerNameKey('Márcio')).toBe(playerNameKey('Márcio'));
    expect(playerNameKey('Çağrı')).toBe('cagrı');
    expect(playerNameKey('Ἀθηνᾶ')).toBe('αθηνα');
  });

  it('nomes diferentes de verdade continuam diferentes', () => {
    expect(playerNameKey('Ana')).not.toBe(playerNameKey('Anna'));
    expect(playerNameKey('Pаulo')).not.toBe(playerNameKey('Paulo')); // cirílico "а" (recusado antes, de todo modo)
  });
});
