// Frases de apresentação do jogador do Habblaud World: o protocolo leva só o id (IntroId); o texto é traduzido no
// navegador de quem vê. Puro: sem Node nem DOM.
import { tr } from '../i18n';
import { INTRO_IDS, type IntroId } from './protocol';

export { INTRO_IDS, type IntroId };

/** Uma função por id (o tr roda na hora, no idioma ativo). O Record obriga a ter todos os ids. */
const LABELS: Readonly<Record<IntroId, () => string>> = {
  night_owl: () => tr('Codo de madrugada'),
  early_bird: () => tr('Acordo cedo para codar'),
  coffee: () => tr('Movido a café'),
  tea: () => tr('Time do chá'),
  tabs: () => tr('Time dos tabs'),
  spaces: () => tr('Time dos espaços'),
  dark_mode: () => tr('Modo escuro sempre'),
  light_mode: () => tr('Modo claro, sem medo'),
  vim: () => tr('Vim até o fim'),
  tests_first: () => tr('Testo antes de escrever'),
  ship_fast: () => tr('Entrego rápido'),
  refactor: () => tr('Refatorar é meu hobby'),
  pixel_art: () => tr('Fã de pixel art'),
  music: () => tr('Codo ouvindo música'),
  silence: () => tr('Codo em silêncio'),
  cats: () => tr('Gente de gato'),
  dogs: () => tr('Gente de cachorro'),
  open_source: () => tr('Vivo de código aberto'),
  learning: () => tr('Sempre aprendendo'),
  hello: () => tr('Oi, prazer!'),
};

export function isIntroId(v: unknown): v is IntroId {
  return typeof v === 'string' && (INTRO_IDS as readonly string[]).includes(v);
}

/** Texto da frase no idioma ativo (um id que esta versão não conhece, vindo de um servidor mais novo: o próprio id). */
export function introLabel(id: IntroId): string {
  return LABELS[id]?.() ?? String(id);
}

/** Todas as frases, na ordem de INTRO_IDS (para o seletor). */
export function introOptions(): { id: IntroId; label: string }[] {
  return INTRO_IDS.map((id) => ({ id, label: introLabel(id) }));
}
