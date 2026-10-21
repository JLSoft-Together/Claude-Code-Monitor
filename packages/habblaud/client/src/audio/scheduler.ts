// Agendador dos sons (puro): decide se um som toca agora e com que volume, conforme a preferência
// (liga/desliga geral, volume mestre, categorias), a aba visível e os limites de frequência.
import type { SoundCueKind } from '../world/api';

/** Categorias que o usuário liga/desliga nas configurações. */
export type SoundCategory = 'alerts' | 'keys' | 'elevator' | 'social';
/** Sons: o sino de "precisa de você", o estalo de tarefa concluída e os do ambiente. */
export type SoundKind = 'chime' | 'pop' | SoundCueKind;

export const SOUND_CATEGORIES: readonly SoundCategory[] = ['alerts', 'keys', 'elevator', 'social'];

export const CATEGORY_OF: Readonly<Record<SoundKind, SoundCategory>> = {
  chime: 'alerts',
  pop: 'alerts',
  keys: 'keys',
  elevator: 'elevator',
  pingpong: 'social',
  table: 'social',
  arcade: 'social',
};

/** Intervalo mínimo (ms) entre dois sons do mesmo canal. */
export const MIN_GAP_MS: Readonly<Record<SoundKind, number>> = {
  chime: 1_200,
  pop: 1_200,
  keys: 600,
  elevator: 1_500,
  pingpong: 200,
  table: 200,
  arcade: 450,
};

/** O sino e o estalo dividem o mesmo canal (um não atropela o outro). */
const CHANNEL: Readonly<Record<SoundKind, string>> = {
  chime: 'alerts',
  pop: 'alerts',
  keys: 'keys',
  elevator: 'elevator',
  pingpong: 'pingpong',
  table: 'pingpong',
  arcade: 'arcade',
};

/** Teto global: no máximo isto de sons por segundo (o sino de alerta sempre passa). */
export const MAX_PER_SECOND = 7;

export interface SoundSettings {
  /** Volume mestre (0–1). */
  volume: number;
  alerts: boolean;
  keys: boolean;
  elevator: boolean;
  social: boolean;
}

export const DEFAULT_SOUND_SETTINGS: SoundSettings = { volume: 0.6, alerts: true, keys: true, elevator: true, social: true };

/** Valida campo a campo (preferência corrompida cai no padrão). */
export function sanitizeSoundSettings(raw: unknown): SoundSettings {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_SOUND_SETTINGS;
  const bool = (v: unknown, f: boolean) => (typeof v === 'boolean' ? v : f);
  const vol = typeof o.volume === 'number' && Number.isFinite(o.volume) ? Math.min(1, Math.max(0, o.volume)) : d.volume;
  return { volume: vol, alerts: bool(o.alerts, d.alerts), keys: bool(o.keys, d.keys), elevator: bool(o.elevator, d.elevator), social: bool(o.social, d.social) };
}

/** Curva do volume mestre: o controle deslizante fica perceptualmente linear. */
export function masterGain(volume: number): number {
  const v = Math.min(1, Math.max(0, volume));
  return v * v;
}

export class SoundScheduler {
  private enabled = false;
  private settings: SoundSettings = { ...DEFAULT_SOUND_SETTINGS };
  private last = new Map<string, number>();
  private recent: number[] = [];

  configure(enabled: boolean, settings: SoundSettings): void {
    this.enabled = enabled;
    this.settings = settings;
  }

  /** O som está liberado pela preferência (geral, categoria e volume)? */
  allowed(kind: SoundKind): boolean {
    return this.enabled && this.settings.volume > 0 && this.settings[CATEGORY_OF[kind]];
  }

  /**
   * Ganho final (0–1) para tocar `kind` agora, ou null se não deve tocar. Com a aba oculta só o
   * sino de "precisa de você" toca. `gain` é a proximidade sugerida pelo mundo.
   */
  decide(kind: SoundKind, now: number, opts: { hidden?: boolean; gain?: number } = {}): number | null {
    if (!this.allowed(kind)) return null;
    if (opts.hidden && kind !== 'chime') return null;
    const ch = CHANNEL[kind];
    const prev = this.last.get(ch);
    if (prev !== undefined && now - prev < MIN_GAP_MS[kind]) return null;
    while (this.recent.length && now - this.recent[0] >= 1_000) this.recent.shift();
    if (kind !== 'chime' && this.recent.length >= MAX_PER_SECOND) return null;
    const g = masterGain(this.settings.volume) * Math.min(1, Math.max(0, opts.gain ?? 1));
    if (g <= 0.0005) return null;
    this.last.set(ch, now);
    this.recent.push(now);
    return g;
  }
}
