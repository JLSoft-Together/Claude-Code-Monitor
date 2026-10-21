// Regras do nome de jogador do Habblaud World (contrato da Fase 1, seção 1). O Habblaud confere antes de mandar, para
// avisar na hora; quem decide é o servidor do mundo, que aplica as mesmas regras e mais a lista de palavras bloqueadas
// (que fica só lá). Só importa ./protocol: pode ser copiado para o servidor do mundo como está. Puro: sem Node nem DOM.
//
// O nome, depois de NFC, trim e espaços repetidos colapsados:
// - tem de 3 a 20 caracteres (pontos de código);
// - só tem letras, acentos combinados (no máximo 3 seguidos, depois de uma letra), dígitos 0-9, espaço, `_`, `-` e `.`,
//   com pelo menos uma letra;
// - não tem controle, formatação, marcas de direção, espaços especiais nem caracteres invisíveis (inclusive os que o
//   Unicode classifica como letra mas não desenham nada, como o preenchimento do Hangul U+3164);
// - usa um só sistema de escrita (latino, cirílico, grego, árabe...); japonês (kanji + hiragana + katakana), coreano
//   (hangul + hanja) e chinês (han + bopomofo) contam como um só;
// - não é um nome reservado (comparado pela chave, sem espaços nem `_`, `-`, `.`).
// A chave de unicidade (playerNameKey) iguala nomes que só mudam em largura, maiúsculas, acentos ou espaços.
import { PLAYER_NAME_LIMITS, RESERVED_PLAYER_NAMES } from './protocol';

/** Por que o nome foi recusado (o servidor responde só o código; o motivo serve para a mensagem local). */
export type PlayerNameProblem =
  | 'type' // não é texto
  | 'length' // fora de 3 a 20 caracteres
  | 'invisible' // controle, formatação, direção, espaço especial ou invisível
  | 'chars' // caractere fora da lista (ou acentos empilhados demais)
  | 'scripts' // letras de mais de um sistema de escrita
  | 'no_letter' // nenhuma letra
  | 'reserved'; // nome reservado

export type PlayerNameResult =
  | { ok: true; name: string; key: string }
  | { ok: false; code: 'name_invalid' | 'name_blocked'; problem: PlayerNameProblem };

/** Acentos combinados seguidos aceitos depois de uma letra (o resto é "texto zalgo"). */
const MAX_MARKS = 3;

/**
 * Invisíveis e afins: controle, formatação, privados, sem atribuição (\p{C}), separadores de linha e parágrafo, os
 * ignoráveis por padrão (ZWJ, seletores de variação, preenchimentos do Hangul...) e as marcas de direção.
 */
const INVISIBLE = /[\p{C}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\p{Bidi_Control}]/u;
/** Espaço que não é o espaço comum (NBSP, espaço ideográfico, tab...). */
const ODD_SPACE = /(?! )[\p{Zs}\s]/u;
const LETTER = /^\p{L}$/u;
const MARK = /^\p{M}$/u;
const OTHER_ALLOWED = /^[0-9 _.-]$/;

/** Sistemas de escrita reconhecidos, pelo Script_Extensions do Unicode. */
const SCRIPTS = [
  'Latin', 'Greek', 'Cyrillic', 'Armenian', 'Hebrew', 'Arabic', 'Syriac', 'Thaana', 'Devanagari', 'Bengali', 'Gurmukhi',
  'Gujarati', 'Oriya', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Sinhala', 'Thai', 'Lao', 'Tibetan', 'Myanmar',
  'Georgian', 'Hangul', 'Ethiopic', 'Khmer', 'Mongolian', 'Hiragana', 'Katakana', 'Bopomofo', 'Han',
] as const;
const SCRIPT_RE = SCRIPTS.map((s) => [s, new RegExp(`^\\p{Script_Extensions=${s}}$`, 'u')] as const);
/** Letra de um sistema fora da lista: vale sozinha (dois sistemas desconhecidos juntos não são distinguidos). */
const OTHER = 'Other';
/** Combinações que contam como um sistema só. */
const WRITING_SYSTEMS: readonly (readonly string[])[] = [
  ...SCRIPTS.map((s) => [s]),
  ['Han', 'Hiragana', 'Katakana'],
  ['Hangul', 'Han'],
  ['Han', 'Bopomofo'],
  [OTHER],
];

function scriptsOf(letter: string): string[] {
  const found = SCRIPT_RE.filter(([, re]) => re.test(letter)).map(([s]) => s);
  return found.length ? found : [OTHER];
}

/** As letras cabem num só sistema de escrita? (Cada letra pode pertencer a mais de um, como o "ー" do japonês.) */
function oneWritingSystem(letters: readonly string[]): boolean {
  const sets = [...new Set(letters)].map(scriptsOf);
  return WRITING_SYSTEMS.some((system) => sets.every((s) => s.some((x) => system.includes(x))));
}

/** Nome sem espaços nas pontas e com espaços repetidos colapsados (só o espaço comum: os outros são recusados). */
function tidy(raw: string): string {
  return raw.normalize('NFC').trim().replace(/ {2,}/g, ' ');
}

/**
 * Chave de unicidade do nome: NFKC → minúsculas → sem diacríticos → espaços colapsados. "Márcio", "MARCIO",
 * "ｍａｒｃｉｏ" e "marcio " dão a mesma chave.
 */
export function playerNameKey(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\p{Mn}\p{Me}]/gu, '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Chave sem os separadores aceitos (espaço, `_`, `-`, `.`), para comparar com os reservados. */
function compactKey(key: string): string {
  return key.replace(/[ _.-]/g, '');
}

const invalid = (problem: PlayerNameProblem): PlayerNameResult => ({ ok: false, code: 'name_invalid', problem });

/** Confere e arruma o nome de jogador; devolve o nome a gravar e a chave dele, ou o código do servidor e o motivo. */
export function parsePlayerName(raw: unknown): PlayerNameResult {
  if (typeof raw !== 'string') return invalid('type');
  // Texto enorme nem é processado.
  if (raw.length > PLAYER_NAME_LIMITS.max * 8) return invalid('length');
  const name = tidy(raw);
  if (INVISIBLE.test(name) || ODD_SPACE.test(name)) return invalid('invisible');
  const chars = [...name];
  if (chars.length < PLAYER_NAME_LIMITS.min || chars.length > PLAYER_NAME_LIMITS.max) return invalid('length');
  const letters: string[] = [];
  let marks = 0;
  let prevLetter = false;
  for (const ch of chars) {
    if (LETTER.test(ch)) {
      letters.push(ch);
      marks = 0;
      prevLetter = true;
    } else if (MARK.test(ch)) {
      if (!prevLetter || ++marks > MAX_MARKS) return invalid('chars');
    } else if (OTHER_ALLOWED.test(ch)) {
      marks = 0;
      prevLetter = false;
    } else return invalid('chars');
  }
  if (!letters.length) return invalid('no_letter');
  if (!oneWritingSystem(letters)) return invalid('scripts');
  const key = playerNameKey(name);
  if ((RESERVED_PLAYER_NAMES as readonly string[]).includes(compactKey(key))) return { ok: false, code: 'name_blocked', problem: 'reserved' };
  return { ok: true, name, key };
}
