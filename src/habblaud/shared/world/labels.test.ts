import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import { EN } from '../locales/en';
import { ES } from '../locales/es';
import { FR } from '../locales/fr';
import { introLabel, introOptions, isIntroId } from './intro';
import { INTRO_IDS, TRAIT_IDS } from './protocol';
import { isTraitId, parsePlayerTraits, TRAITS, traitsClash } from './traits';

afterEach(() => setLocale('pt-BR'));

/** Os textos em PT do contrato da Fase 1 (seção 3). */
const INTRO_PT: Record<string, string> = {
  night_owl: 'Codo de madrugada',
  early_bird: 'Acordo cedo para codar',
  coffee: 'Movido a café',
  tea: 'Time do chá',
  tabs: 'Time dos tabs',
  spaces: 'Time dos espaços',
  dark_mode: 'Modo escuro sempre',
  light_mode: 'Modo claro, sem medo',
  vim: 'Vim até o fim',
  tests_first: 'Testo antes de escrever',
  ship_fast: 'Entrego rápido',
  refactor: 'Refatorar é meu hobby',
  pixel_art: 'Fã de pixel art',
  music: 'Codo ouvindo música',
  silence: 'Codo em silêncio',
  cats: 'Gente de gato',
  dogs: 'Gente de cachorro',
  open_source: 'Vivo de código aberto',
  learning: 'Sempre aprendendo',
  hello: 'Oi, prazer!',
};

describe('frases de apresentação', () => {
  it('os 20 ids com o texto do contrato, traduzidos nos 3 idiomas', () => {
    expect(Object.keys(INTRO_PT)).toEqual([...INTRO_IDS]);
    for (const id of INTRO_IDS) {
      expect(introLabel(id)).toBe(INTRO_PT[id]);
      for (const dict of [EN, ES, FR]) expect(dict[INTRO_PT[id]], `${id}`).toBeTruthy();
    }
    expect(introOptions().map((o) => o.id)).toEqual([...INTRO_IDS]);
  });

  it('o rótulo segue o idioma ativo na hora', () => {
    setLocale('en');
    expect(introLabel('coffee')).toBe(EN['Movido a café']);
    setLocale('pt-BR');
    expect(introLabel('coffee')).toBe('Movido a café');
  });

  it('id desconhecido (servidor mais novo) vira o próprio id, sem quebrar', () => {
    expect(introLabel('emacs' as never)).toBe('emacs');
  });

  it('isIntroId', () => {
    expect(isIntroId('vim')).toBe(true);
    expect(isIntroId('emacs')).toBe(false);
    expect(isIntroId(1)).toBe(false);
  });
});

describe('traços', () => {
  it('TRAITS na ordem de TRAIT_IDS (o sorteio de personaFor depende dela)', () => {
    expect(Object.keys(TRAITS)).toEqual([...TRAIT_IDS]);
    for (const id of TRAIT_IDS) expect(TRAITS[id].id).toBe(id);
  });

  it('pares que não combinam, nos dois sentidos', () => {
    expect(traitsClash('timidez', 'piadas')).toBe(true);
    expect(traitsClash('piadas', 'timidez')).toBe(true);
    expect(traitsClash('calma', 'competicao')).toBe(true);
    expect(traitsClash('games', 'leitura')).toBe(false);
  });

  it('escolha do jogador: 2 ou 3, conhecidos, sem repetir e sem conflito', () => {
    expect(parsePlayerTraits(['games', 'cafeina'])).toEqual(['games', 'cafeina']);
    expect(parsePlayerTraits(['games', 'cafeina', 'leitura'])).toEqual(['games', 'cafeina', 'leitura']);
    expect(parsePlayerTraits(['games'])).toBeNull();
    expect(parsePlayerTraits(['games', 'cafeina', 'leitura', 'calma'])).toBeNull();
    expect(parsePlayerTraits(['games', 'games'])).toBeNull();
    expect(parsePlayerTraits(['timidez', 'piadas'])).toBeNull();
    expect(parsePlayerTraits(['games', 'xadrez'])).toBeNull();
    expect(parsePlayerTraits('games')).toBeNull();
    expect(isTraitId('sonecas')).toBe(true);
    expect(isTraitId('soneca')).toBe(false);
  });
});
