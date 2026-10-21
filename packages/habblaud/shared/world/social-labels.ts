// Rótulos do social leve do Habblaud World (Fase 5): cumprimentos, carimbos da portaria, motivos de denúncia e metas da
// cidade. O protocolo leva só o id; o texto (e o ícone) sai aqui, no idioma de quem vê, como intro.ts e traits.ts.
// Puro: sem Node nem DOM.
import { intlLocale, tr } from '../i18n';
import {
  CITY_GOAL_IDS,
  GREETING_IDS,
  REPORT_REASONS,
  STAMP_IDS,
  type CityGoalId,
  type GreetingId,
  type ReportReason,
  type StampId,
  type TokenBand,
} from './protocol';

export { CITY_GOAL_IDS, GREETING_IDS, REPORT_REASONS, STAMP_IDS };
export type { CityGoalId, GreetingId, ReportReason, StampId };

/** Um id com o ícone (emoji) e o texto no idioma ativo. */
export interface SocialLabel {
  icon: string;
  label: () => string;
}

/** Os 10 cumprimentos, na ordem da roda (o Record obriga a ter todos os ids). */
export const GREETINGS: Readonly<Record<GreetingId, SocialLabel>> = {
  hello: { icon: '👋', label: () => tr('Olá!') },
  nice_building: { icon: '👍', label: () => tr('Prédio bonito!') },
  coffee: { icon: '☕', label: () => tr('Bora um café?') },
  congrats: { icon: '🎉', label: () => tr('Parabéns pela entrega!') },
  nice_to_meet: { icon: '🤝', label: () => tr('Prazer!') },
  bye: { icon: '✌️', label: () => tr('Até mais!') },
  thanks: { icon: '🙏', label: () => tr('Valeu!') },
  good_luck: { icon: '🍀', label: () => tr('Boa sorte!') },
  wave: { icon: '🙋', label: () => tr('Oi, oi!') },
  clap: { icon: '👏', label: () => tr('Mandou bem!') },
};

/** Os 8 carimbos da portaria. */
export const STAMPS: Readonly<Record<StampId, SocialLabel>> = {
  visited: { icon: '👣', label: () => tr('Passei por aqui') },
  nice_building: { icon: '🏢', label: () => tr('Prédio lindo') },
  keep_going: { icon: '💪', label: () => tr('Continue assim') },
  coffee: { icon: '☕', label: () => tr('Fica o café') },
  wave: { icon: '👋', label: () => tr('Um aceno') },
  star: { icon: '⭐', label: () => tr('Nota 10') },
  heart: { icon: '💖', label: () => tr('Com carinho') },
  rocket: { icon: '🚀', label: () => tr('Decolando!') },
};

/** Os motivos fixos de denúncia. */
export const REPORTS: Readonly<Record<ReportReason, SocialLabel>> = {
  offensive_name: { icon: '🤬', label: () => tr('Nome ofensivo') },
  impersonation: { icon: '🎭', label: () => tr('Fingindo ser outra pessoa') },
  harassment: { icon: '🚫', label: () => tr('Perseguição') },
  greeting_spam: { icon: '📢', label: () => tr('Spam de cumprimentos') },
  fake_building: { icon: '🏚️', label: () => tr('Prédio falso') },
  other: { icon: '❔', label: () => tr('Outro motivo') },
};

/** Horas de agente de cada meta da cidade (o servidor manda o `target` também; isto é só o rótulo). */
export const CITY_GOAL_HOURS: Readonly<Record<CityGoalId, number>> = {
  agent_hours_10k: 10_000,
  agent_hours_50k: 50_000,
  agent_hours_100k: 100_000,
};

const ofList = <K extends string>(list: Readonly<Record<K, SocialLabel>>, id: string): SocialLabel | undefined =>
  (Object.prototype.hasOwnProperty.call(list, id) ? list[id as K] : undefined);

/** Texto de um cumprimento (um id que esta versão não conhece: o próprio id, sem quebrar). */
export function greetingLabel(id: GreetingId | string): string {
  return ofList(GREETINGS, id)?.label() ?? String(id);
}

export function greetingIcon(id: GreetingId | string): string {
  return ofList(GREETINGS, id)?.icon ?? '💬';
}

export function stampLabel(id: StampId | string): string {
  return ofList(STAMPS, id)?.label() ?? String(id);
}

export function stampIcon(id: StampId | string): string {
  return ofList(STAMPS, id)?.icon ?? '🏷️';
}

export function reportLabel(id: ReportReason | string): string {
  return ofList(REPORTS, id)?.label() ?? String(id);
}

/** Número curto no idioma ativo ("10 mil", "1,2 mil", "50 mil"). */
export function compactNumber(n: number): string {
  const v = Number.isFinite(n) ? Math.max(0, n) : 0;
  try {
    return new Intl.NumberFormat(intlLocale(), { notation: 'compact', maximumFractionDigits: v < 10_000 && v >= 1_000 ? 1 : 0 }).format(v);
  } catch {
    return String(Math.round(v));
  }
}

/** "10 mil horas de agentes trabalhando" (a meta da semana). */
export function cityGoalLabel(id: CityGoalId | string, target?: number): string {
  const hours = target ?? (Object.prototype.hasOwnProperty.call(CITY_GOAL_HOURS, id) ? CITY_GOAL_HOURS[id as CityGoalId] : 0);
  return tr('{0} horas de agentes trabalhando', [compactNumber(hours)]);
}

/** A faixa de tokens (TokenBand) como teto legível: "até 100 mil", "até 1 milhão"... "mais de 100 milhões". */
export function tokenBandText(band: TokenBand | number | undefined): string {
  switch (band) {
    case 1:
      return tr('até 100 mil tokens');
    case 2:
      return tr('até 1 milhão de tokens');
    case 3:
      return tr('até 10 milhões de tokens');
    case 4:
      return tr('até 100 milhões de tokens');
    case 5:
      return tr('mais de 100 milhões de tokens');
    default:
      return tr('quase nada de tokens');
  }
}
