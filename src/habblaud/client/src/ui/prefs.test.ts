import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, loadPrefs, migrateLegacyKeys, PREFS_KEY, sanitizePrefs, savePrefs, worldOptionsFrom } from './prefs';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

/** Com o que a migração precisa a mais: listar (key/length) e apagar. */
function listableStorage(initial: Record<string, string> = {}) {
  const st = memoryStorage(initial);
  return {
    ...st,
    removeItem: (k: string) => void st.data.delete(k),
    key: (i: number) => [...st.data.keys()][i] ?? null,
    get length() {
      return st.data.size;
    },
  };
}

describe('preferências', () => {
  it('usa o padrão sem armazenamento ou com JSON inválido', () => {
    expect(loadPrefs(null)).toEqual(DEFAULT_PREFS);
    expect(loadPrefs(memoryStorage({ [PREFS_KEY]: '{oops' }))).toEqual(DEFAULT_PREFS);
  });
  it('valida campo a campo', () => {
    const p = sanitizePrefs({ showNames: false, bubbles: 'muitos', liveliness: 'lively', sound: 'sim', hiddenAccounts: ['.claude', 3] });
    expect(p.showNames).toBe(false);
    expect(p.bubbles).toBe(DEFAULT_PREFS.bubbles);
    expect(p.liveliness).toBe('lively');
    expect(p.sound).toBe(false);
    expect(p.hiddenAccounts).toEqual(['.claude']);
  });
  it('salva e carrega de volta', () => {
    const st = memoryStorage();
    savePrefs(st, { ...DEFAULT_PREFS, bubbles: 'none', feedOpen: false });
    expect(loadPrefs(st)).toEqual({ ...DEFAULT_PREFS, bubbles: 'none', feedOpen: false });
  });
  it('não quebra quando o armazenamento lança exceção', () => {
    const broken = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('cheio');
      },
    };
    expect(loadPrefs(broken)).toEqual(DEFAULT_PREFS);
    expect(() => savePrefs(broken, DEFAULT_PREFS)).not.toThrow();
  });
  it('extrai só as opções do mundo', () => {
    expect(worldOptionsFrom({ ...DEFAULT_PREFS, daylight: 'day' })).toEqual({ showNames: true, bubbles: 'important', liveliness: 'normal', dayNight: false, daylight: 'day', theme: 'auto' });
    expect(worldOptionsFrom({ ...DEFAULT_PREFS, daylight: 'night' })).toMatchObject({ dayNight: true, daylight: 'night' });
  });
  it('ciclo dia/noite: valida o modo e migra o interruptor antigo', () => {
    expect(DEFAULT_PREFS.daylight).toBe('auto');
    expect(sanitizePrefs({ daylight: 'night' }).daylight).toBe('night');
    expect(sanitizePrefs({ daylight: 'meio-dia' }).daylight).toBe('auto');
    expect(sanitizePrefs({ dayNight: false }).daylight).toBe('day');
    expect(sanitizePrefs({ dayNight: true }).daylight).toBe('auto');
    expect(sanitizePrefs({ dayNight: false, daylight: 'night' }).daylight).toBe('night');
  });
  it('temas: preserva preferências antigas e recupera valores inválidos', () => {
    expect(sanitizePrefs({ daylight: 'night' })).toMatchObject({ theme: 'auto', daylight: 'night' });
    expect(sanitizePrefs({ theme: 'invalid' }).theme).toBe('auto');
    for (const theme of ['christmas', 'halloween', 'none', 'auto'] as const) {
      const st = memoryStorage();
      savePrefs(st, { ...DEFAULT_PREFS, theme });
      expect(loadPrefs(st).theme).toBe(theme);
      expect(worldOptionsFrom(loadPrefs(st)).theme).toBe(theme);
    }
  });
  it('sons: desligados por padrão; volume e categorias validados', () => {
    expect(DEFAULT_PREFS.sound).toBe(false);
    const p = sanitizePrefs({ sound: true, sounds: { volume: 3, keys: false, elevator: 'sim' } });
    expect(p.sound).toBe(true);
    expect(p.sounds).toEqual({ volume: 1, alerts: true, keys: false, elevator: true, social: true });
    expect(sanitizePrefs({ sounds: { volume: -1 } }).sounds.volume).toBe(0);
    expect(sanitizePrefs({ sounds: 'alto' }).sounds).toEqual(DEFAULT_PREFS.sounds);
  });
});

describe('migração do nome antigo (CodeTown)', () => {
  it('move as chaves para o prefixo novo e apaga as antigas', () => {
    const prefs = JSON.stringify({ ...DEFAULT_PREFS, bubbles: 'none' });
    const wallets = JSON.stringify({ v: 1, wallets: { a1: { name: 'Ana', coins: 250 } } });
    const st = listableStorage({ 'codetown:prefs': prefs, 'codetown:update-seen': '0.3.2', 'codetown.wallets.v1': wallets });
    expect(migrateLegacyKeys(st)).toBe(3);
    expect(Object.fromEntries(st.data)).toEqual({ 'habblaud:prefs': prefs, 'habblaud:update-seen': '0.3.2', 'habblaud.wallets.v1': wallets });
    expect(loadPrefs(st).bubbles).toBe('none');
  });
  it('não sobrescreve a chave nova que já existe, mas apaga a antiga', () => {
    const st = listableStorage({ 'codetown:prefs': '{"bubbles":"none"}', [PREFS_KEY]: '{"bubbles":"all"}' });
    expect(migrateLegacyKeys(st)).toBe(0);
    expect(Object.fromEntries(st.data)).toEqual({ [PREFS_KEY]: '{"bubbles":"all"}' });
  });
  it('ignora chaves sem o prefixo antigo', () => {
    const st = listableStorage({ 'outra:coisa': '1', codetown: '2', 'codetownx:prefs': '3', 'meu.codetown:prefs': '4' });
    expect(migrateLegacyKeys(st)).toBe(0);
    expect(st.data.size).toBe(4);
    expect(migrateLegacyKeys(listableStorage())).toBe(0);
  });
  it('não quebra sem armazenamento ou quando ele lança exceção', () => {
    expect(migrateLegacyKeys(null)).toBe(0);
    const blocked = {
      ...listableStorage(),
      get length(): number {
        throw new Error('bloqueado');
      },
    };
    expect(migrateLegacyKeys(blocked)).toBe(0);
    // cota cheia: a chave antiga fica para a próxima vez
    const full = listableStorage({ 'codetown:prefs': '{}' });
    full.setItem = () => {
      throw new Error('cheio');
    };
    expect(migrateLegacyKeys(full)).toBe(0);
    expect(Object.fromEntries(full.data)).toEqual({ 'codetown:prefs': '{}' });
  });
});
