// Editor do personagem, parte pura (sem DOM): quando a gaveta oferece a edição, como as peças se agrupam, os rótulos
// em português e o que vai para o servidor em `parts`. A interface fica em character-editor.ts.
import { PART_KEYS, type AppearanceParts, type PartKey } from '../../../shared/appearance';
import { isDemoId } from '../../../shared/timeline';
import type { AgentInfo } from '../../../shared/types';
import type { Appearance } from '../art/api';
import { tr } from '../../../shared/i18n';

export interface EditGate {
  /** O agente ainda está no escritório. */
  live: boolean;
  /** meta.terminal: o Habblaud só é acessível pelo próprio computador (bind local). */
  terminal: boolean;
  /** A página foi aberta por localhost/127.x (o servidor recusa o resto). */
  local: boolean;
  replaying: boolean;
  mock: boolean;
}

/**
 * O lápis "Editar personagem" aparece? Só para o principal real, ao vivo, que não está saindo (offline: o servidor
 * responderia 404) e com acesso local (a trava do terminal).
 */
export function canEditCharacter(a: Pick<AgentInfo, 'id' | 'kind' | 'status'>, g: EditGate): boolean {
  return a.kind === 'main' && a.status !== 'offline' && g.live && g.terminal && g.local && !g.replaying && !g.mock && !isDemoId(a.id);
}

/** Peças que diferem da aparência sorteada pela seed (o que vai em `parts`), na ordem de PART_KEYS. */
export function changedParts(base: Appearance, edited: Appearance): AppearanceParts {
  const out: Record<string, string> = {};
  for (const k of PART_KEYS) {
    const v = edited[k];
    if (v !== undefined && v !== base[k]) out[k] = v;
  }
  return out as AppearanceParts;
}

export interface EditorRow {
  key: PartKey;
  label: string;
  kind: 'style' | 'color';
}

export const EDITOR_GROUPS: readonly { title: string; rows: readonly EditorRow[] }[] = [
  { title: tr('Pele'), rows: [{ key: 'skin', label: tr('Tom'), kind: 'color' }] },
  {
    title: tr('Cabelo'),
    rows: [
      { key: 'hairStyle', label: tr('Estilo'), kind: 'style' },
      { key: 'hair', label: tr('Cor'), kind: 'color' },
    ],
  },
  { title: tr('Barba'), rows: [{ key: 'facialHair', label: tr('Estilo'), kind: 'style' }] },
  { title: tr('Olhos'), rows: [{ key: 'eyes', label: tr('Cor'), kind: 'color' }] },
  {
    title: tr('Parte de cima'),
    rows: [
      { key: 'topStyle', label: tr('Estilo'), kind: 'style' },
      { key: 'top', label: tr('Cor'), kind: 'color' },
      { key: 'topAccent', label: tr('Detalhe'), kind: 'color' },
    ],
  },
  {
    title: tr('Parte de baixo'),
    rows: [
      { key: 'bottomStyle', label: tr('Estilo'), kind: 'style' },
      { key: 'bottom', label: tr('Cor'), kind: 'color' },
    ],
  },
  { title: tr('Sapatos'), rows: [{ key: 'shoes', label: tr('Cor'), kind: 'color' }] },
  {
    title: tr('Acessório'),
    rows: [
      { key: 'accessory', label: tr('Tipo'), kind: 'style' },
      { key: 'accessoryColor', label: tr('Cor'), kind: 'color' },
    ],
  },
];

const STYLE_LABELS: Partial<Record<PartKey, Readonly<Record<string, string>>>> = {
  hairStyle: {
    short: tr('Curto'), buzz: tr('Raspado'), spiky: tr('Espetado'), side_part: tr('Repartido'), curly: tr('Cacheado'), afro: tr('Black power'),
    bob: tr('Chanel'), long: tr('Longo'), ponytail: tr('Rabo de cavalo'), bun: tr('Coque'), pigtails: 'Maria-chiquinha', mohawk: tr('Moicano'),
    bald: tr('Careca'), wavy: tr('Ondulado'),
  },
  topStyle: {
    tshirt: tr('Camiseta'), hoodie: tr('Moletom'), shirt_tie: tr('Camisa e gravata'), sweater: tr('Suéter'), jacket: tr('Jaqueta'),
    blouse: tr('Blusa'), polo: 'Polo',
  },
  bottomStyle: { pants: tr('Calça'), shorts: tr('Bermuda'), skirt: tr('Saia') },
  accessory: {
    none: tr('Nenhum'), glasses: tr('Óculos'), sunglasses: tr('Óculos escuros'), headphones: tr('Fone'), cap: tr('Boné'), beanie: tr('Gorro'),
    earrings: tr('Brincos'), bow: tr('Laço'),
  },
  facialHair: { none: tr('Sem barba'), stubble: tr('Por fazer'), beard: tr('Barba'), mustache: tr('Bigode'), goatee: tr('Cavanhaque') },
};

/** Rótulo em português de um estilo (cabelo, roupa, acessório...). */
export function styleLabel(key: PartKey, value: string): string {
  return STYLE_LABELS[key]?.[value] ?? value;
}

/** A linha aparece com esta aparência? (sem acessório, não há cor de acessório para escolher) */
export function rowVisible(r: EditorRow, a: Pick<Appearance, 'accessory'>): boolean {
  return !(r.key === 'accessoryColor' && a.accessory === 'none');
}
