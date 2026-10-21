// Preferências da interface, persistidas em localStorage ('habblaud:prefs').
// Puro: o armazenamento é injetado (testável em node).
import { DEFAULT_SOUND_SETTINGS, sanitizeSoundSettings, type SoundSettings } from '../audio/scheduler';
import type { DaylightMode, WorldOptions } from '../world/api';
import { DEFAULT_WORLD_OPTIONS } from '../world/api';

export const PREFS_KEY = 'habblaud:prefs';

export interface UiPrefs {
  showNames: boolean;
  bubbles: WorldOptions['bubbles'];
  liveliness: WorldOptions['liveliness'];
  /** Ciclo dia/noite: automático (hora local), sempre dia ou sempre noite. */
  daylight: DaylightMode;
  theme: NonNullable<WorldOptions['theme']>;
  /** Sons sintetizados (interruptor geral; desligado por padrão). */
  sound: boolean;
  /** Volume mestre e categorias dos sons. */
  sounds: SoundSettings;
  /** Notification do navegador para alertas com a aba oculta. */
  browserNotifications: boolean;
  sidebarOpen: boolean;
  feedOpen: boolean;
  /** Contas ocultas na barra lateral (AccountInfo.id). */
  hiddenAccounts: string[];
  /** Habblaud World: aviso quando o primeiro visitante entra no seu prédio (a cada conexão). Ligado por padrão. */
  worldVisitNotify: boolean;
}

export const DEFAULT_PREFS: UiPrefs = {
  showNames: DEFAULT_WORLD_OPTIONS.showNames,
  bubbles: DEFAULT_WORLD_OPTIONS.bubbles,
  liveliness: DEFAULT_WORLD_OPTIONS.liveliness,
  daylight: 'auto',
  theme: 'auto',
  sound: false,
  sounds: DEFAULT_SOUND_SETTINGS,
  browserNotifications: false,
  sidebarOpen: true,
  feedOpen: true,
  hiddenAccounts: [],
  worldVisitNotify: true,
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/** Valida campo a campo: valores desconhecidos ou corrompidos caem no padrão. */
export function sanitizePrefs(raw: unknown): UiPrefs {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_PREFS;
  return {
    showNames: bool(o.showNames, d.showNames),
    bubbles: oneOf(o.bubbles, ['all', 'important', 'none'] as const, d.bubbles),
    liveliness: oneOf(o.liveliness, ['calm', 'normal', 'lively'] as const, d.liveliness),
    // preferências antigas: o interruptor "dia e noite" desligado vira "sempre dia"
    daylight: oneOf(o.daylight, ['auto', 'day', 'night'] as const, o.dayNight === false ? 'day' : d.daylight),
    theme: oneOf(o.theme, ['auto', 'none', 'christmas', 'halloween'] as const, d.theme),
    sound: bool(o.sound, d.sound),
    sounds: sanitizeSoundSettings(o.sounds),
    browserNotifications: bool(o.browserNotifications, d.browserNotifications),
    sidebarOpen: bool(o.sidebarOpen, d.sidebarOpen),
    feedOpen: bool(o.feedOpen, d.feedOpen),
    hiddenAccounts: Array.isArray(o.hiddenAccounts) ? o.hiddenAccounts.filter((x): x is string => typeof x === 'string').slice(0, 20) : [],
    worldVisitNotify: bool(o.worldVisitNotify, d.worldVisitNotify),
  };
}

export function loadPrefs(storage: StorageLike | null): UiPrefs {
  if (!storage) return { ...DEFAULT_PREFS };
  try {
    const raw = storage.getItem(PREFS_KEY);
    return sanitizePrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(storage: StorageLike | null, prefs: UiPrefs): void {
  if (!storage) return;
  try {
    storage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Armazenamento cheio ou bloqueado (aba anônima): as preferências valem só nesta sessão.
  }
}

/** Parte das preferências que o mundo (canvas) consome. */
export function worldOptionsFrom(p: UiPrefs): Partial<WorldOptions> {
  return { showNames: p.showNames, bubbles: p.bubbles, liveliness: p.liveliness, dayNight: p.daylight !== 'day', daylight: p.daylight, theme: p.theme };
}

/** localStorage com proteção contra navegadores que lançam exceção ao acessá-lo. */
export function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Migração do nome antigo (CodeTown, até a 0.3.2): as chaves eram `codetown:prefs`,
 * `codetown:update-seen`, `codetown.wallets.v1`... e passaram a começar com `habblaud`.
 */
const LEGACY_NAME = 'codetown';
const LEGACY_PREFIXES = [`${LEGACY_NAME}:`, `${LEGACY_NAME}.`];
const NAME = 'habblaud';

type ListableStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/**
 * Renomeia as chaves do nome antigo para quem atualiza não perder as preferências nem as moedinhas.
 * Roda no boot, antes de qualquer leitura. Se a chave nova já existe, ela vale e a antiga só é apagada.
 * Retorna quantas chaves copiou.
 */
export function migrateLegacyKeys(storage: ListableStorage | null): number {
  if (!storage) return 0;
  const legacy: string[] = [];
  try {
    // Lista antes de mexer: apagar durante a varredura muda os índices de key(i).
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && LEGACY_PREFIXES.some((p) => key.startsWith(p))) legacy.push(key);
    }
  } catch {
    return 0;
  }
  let copied = 0;
  for (const old of legacy) {
    try {
      const value = storage.getItem(old);
      const key = NAME + old.slice(LEGACY_NAME.length);
      if (value !== null && storage.getItem(key) === null) {
        storage.setItem(key, value);
        copied++;
      }
      // Só apaga depois de copiar: se a gravação falhar (cota cheia), a antiga fica para a próxima vez.
      storage.removeItem(old);
    } catch {
      // segue com as outras chaves
    }
  }
  return copied;
}
