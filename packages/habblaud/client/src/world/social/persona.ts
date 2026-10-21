// Personalidades dos personagens — funções PURAS e determinísticas (mesma semente = mesma pessoa em
// qualquer navegador). Cada agente tem 2 ou 3 traços, que mudam o que prefere fazer quando está à toa,
// com quem anda e o que fala; pares de agentes podem ter amizade ou rivalidade.
import { mulberry32 } from '../../../../shared/hash';
import { IDLE_WEIGHTS, type IdleActivity } from '../sim/behavior';
import { tr } from '../../../../shared/i18n';
import { TRAIT_IDS, traitsClash, type TraitId } from '../../../../shared/world/traits';

// Os ids, os rótulos e os pares que não combinam ficam em shared/world/traits.ts (os mesmos do jogador do Habblaud
// World); re-exportados aqui para quem já importava deste módulo.
export { TRAIT_IDS, TRAITS, type Trait, type TraitId } from '../../../../shared/world/traits';

/** Bordões: cada um tem o seu (aparece de vez em quando nas falas). */
export const CATCHPHRASES = [
  tr('Bora!'),
  tr('Partiu!'),
  tr('Tá pago!'),
  tr('É hoje!'),
  tr('Simbora!'),
  tr('Bora codar!'),
  tr('Deu bom!'),
  tr('Que isso!'),
  tr('Show de bola!'),
  tr('Tamo junto!'),
  tr('Sem estresse.'),
  tr('Vai dar certo!'),
] as const;

export interface Persona {
  traits: TraitId[];
  /** 0..1: vontade de entrar em rodas (timidez puxa para baixo; fofoca e piadas para cima). */
  sociability: number;
  /** 0..1: sorte/habilidade em jogos (games e esporte puxam para cima). */
  skill: number;
  catchphrase: string;
}

/** Mistura de 32 bits (sementes próximas viram sequências bem diferentes). */
function mix(seed: number): number {
  let h = (seed ^ 0x5bd1e995) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

const cache = new Map<number, Persona>();

/** Personalidade do agente com esta semente (2 ou 3 traços sem conflito). */
export function personaFor(seed: number): Persona {
  const hit = cache.get(seed);
  if (hit) return hit;
  const rng = mulberry32(mix(seed));
  const n = rng() < 0.55 ? 2 : 3;
  const traits: TraitId[] = [];
  for (let guard = 0; traits.length < n && guard < 40; guard++) {
    const t = TRAIT_IDS[Math.floor(rng() * TRAIT_IDS.length) % TRAIT_IDS.length];
    if (traits.includes(t) || traits.some((o) => traitsClash(o, t))) continue;
    traits.push(t);
  }
  let sociability = 0.45 + rng() * 0.3;
  if (traits.includes('timidez')) sociability -= 0.3;
  if (traits.includes('fofoca')) sociability += 0.2;
  if (traits.includes('piadas')) sociability += 0.12;
  let skill = 0.3 + rng() * 0.4;
  if (traits.includes('games')) skill += 0.2;
  if (traits.includes('esporte')) skill += 0.15;
  if (traits.includes('sonecas')) skill -= 0.1;
  const catchphrase = CATCHPHRASES[Math.floor(rng() * CATCHPHRASES.length) % CATCHPHRASES.length];
  const p: Persona = { traits, sociability: clamp01(sociability), skill: clamp01(skill), catchphrase };
  if (cache.size > 500) cache.clear();
  cache.set(seed, p);
  return p;
}

function clamp01(v: number): number {
  return Math.max(0.05, Math.min(0.95, v));
}

export function hasTrait(p: Persona, t: TraitId): boolean {
  return p.traits.includes(t);
}

export type Bond = 'amizade' | 'rivalidade';

/**
 * Vínculo entre dois agentes (simétrico): ~22% amizade, ~12% rivalidade, o resto só colegas.
 * Competição dos dois lados puxa para rivalidade; fofoca/piadas para amizade.
 */
export function bondBetween(seedA: number, seedB: number): Bond | null {
  if (seedA === seedB) return null;
  const lo = Math.min(seedA >>> 0, seedB >>> 0);
  const hi = Math.max(seedA >>> 0, seedB >>> 0);
  const r = mulberry32(mix(lo ^ Math.imul(hi, 0x9e3779b1)))();
  const a = personaFor(seedA);
  const b = personaFor(seedB);
  const rivalry = 0.12 + (hasTrait(a, 'competicao') && hasTrait(b, 'competicao') ? 0.18 : 0);
  const friendship = 0.22 + ([a, b].some((p) => hasTrait(p, 'fofoca') || hasTrait(p, 'piadas')) ? 0.08 : 0);
  if (r < rivalry) return 'rivalidade';
  if (r < rivalry + friendship) return 'amizade';
  return null;
}

/** Quanto cada traço multiplica a vontade de cada passeio sozinho. */
const SOLO_K: Partial<Record<TraitId, Partial<Record<IdleActivity, number>>>> = {
  cafeina: { coffee: 3 },
  vaidade: { mirror: 5, bathroom: 1.3 },
  leitura: { shelf: 3, phone: 1.6, window: 1.2 },
  sonecas: { lounge: 2.5 },
  esporte: { stretch: 2.5, water: 1.5 },
  calma: { window: 2.5, stretch: 1.5 },
  games: { arcade: 3, phone: 1.4 },
  timidez: { window: 1.5, shelf: 1.5, phone: 1.5 },
  fofoca: { coffee: 1.4, phone: 1.4 },
  series: { phone: 1.5, lounge: 1.3 },
  economia: { snack: 0.4, water: 1.6 },
};

/** Pesos dos passeios sozinho para esta personalidade. */
export function soloWeights(p: Persona): Record<IdleActivity, number> {
  const out = { ...IDLE_WEIGHTS };
  for (const t of p.traits) for (const [k, v] of Object.entries(SOLO_K[t] ?? {})) out[k as IdleActivity] *= v as number;
  return out;
}
