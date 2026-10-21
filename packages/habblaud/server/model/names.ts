// Nomes dos personagens, persistidos por sessão/subagente em <dataDir>/names.json para que cada um mantenha o nome
// entre reinícios do servidor, e o personagem escolhido para cada projeto (sala) no editor (ver Office.setCharacter),
// com a sessão dona dele, para que um reinício não o entregue a outra sessão aberta.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseAppearanceParts, parseCharacterName, parseSeed, type AppearanceParts } from '../../shared/appearance';
import { pickName, type PersonName } from '../../shared/names';
import { errMsg, log } from '../log';
import { tr } from '../../shared/i18n';

interface StoredName {
  name: string;
  look: 'f' | 'm';
  at: number;
}

/**
 * Personagem escolhido para uma sala (chave: cwd normalizado). `owner` = sessionId da sessão que o está usando;
 * `at` = último uso, para a expiração.
 */
export interface StoredCharacter {
  name: string;
  look: 'f' | 'm';
  seed: number;
  parts?: AppearanceParts;
  owner?: string;
  at: number;
}

const MAX_OWNER_LENGTH = 200;

interface NamesFile {
  version: 1;
  names: Record<string, StoredName>;
  rooms?: Record<string, StoredCharacter>;
}

/** Entrada de `rooms` lida do arquivo, ou null se algo estiver fora do formato. */
function parseStoredCharacter(raw: unknown): StoredCharacter | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  const name = parseCharacterName(v.name);
  const seed = parseSeed(v.seed);
  const parts = v.parts === undefined ? {} : parseAppearanceParts(v.parts);
  if (!name || seed === null || (v.look !== 'f' && v.look !== 'm') || !parts) return null;
  const c: StoredCharacter = { name, look: v.look, seed, at: typeof v.at === 'number' ? v.at : 0 };
  if (Object.keys(parts).length) c.parts = parts;
  // Dono fora do formato não invalida a entrada: ela volta a valer para quem chegar primeiro.
  if (typeof v.owner === 'string' && v.owner && v.owner.length <= MAX_OWNER_LENGTH) c.owner = v.owner;
  return c;
}

function copyCharacter(c: StoredCharacter): StoredCharacter {
  return c.parts ? { ...c, parts: { ...c.parts } } : { ...c };
}

const MAX_ENTRIES = 4000;
const MAX_AGE_MS = 60 * 24 * 3_600_000;

export class NameStore {
  private names = new Map<string, StoredName>();
  private rooms = new Map<string, StoredCharacter>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => number;

  /** `file` null = só em memória (testes ou diretório de dados indisponível). */
  constructor(
    private readonly file: string | null,
    opts: { now?: () => number } = {},
  ) {
    this.now = opts.now ?? Date.now;
  }

  load(): void {
    if (!this.file) return;
    try {
      const j = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<NamesFile>;
      for (const [key, v] of Object.entries(j.names ?? {})) {
        if (v && typeof v.name === 'string' && (v.look === 'f' || v.look === 'm')) {
          this.names.set(key, { name: v.name, look: v.look, at: typeof v.at === 'number' ? v.at : 0 });
        }
      }
      const rooms = j.rooms && typeof j.rooms === 'object' && !Array.isArray(j.rooms) ? j.rooms : {};
      for (const [roomId, v] of Object.entries(rooms)) {
        const c = parseStoredCharacter(v);
        if (c) this.rooms.set(roomId, c);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(tr('names.json ilegível ({0}); começando do zero.', [errMsg(err)]));
    }
  }

  /** Nome de `key`: o persistido, se não colidir com `used`; senão um novo do pool. */
  assign(key: string, used: ReadonlySet<string>): PersonName {
    const stored = this.names.get(key);
    if (stored && !used.has(stored.name)) {
      stored.at = this.now();
      this.scheduleFlush();
      return { name: stored.name, look: stored.look };
    }
    const person = pickName(key, used);
    this.remember(key, person);
    return person;
  }

  /** Associa `person` a mais uma chave (ex.: a sessão nova depois de um /clear). */
  remember(key: string, person: PersonName): void {
    this.names.set(key, { name: person.name, look: person.look, at: this.now() });
    this.scheduleFlush();
  }

  get(key: string): PersonName | undefined {
    const s = this.names.get(key);
    return s ? { name: s.name, look: s.look } : undefined;
  }

  // ---------------------------------------------------------------- personagem de cada sala (projeto)

  character(roomId: string): StoredCharacter | undefined {
    const c = this.rooms.get(roomId);
    return c ? copyCharacter(c) : undefined;
  }

  /** A sessão `sessionId` passa a usar o personagem da sala: vira a dona e renova a expiração. */
  claimCharacter(roomId: string, sessionId: string): void {
    const c = this.rooms.get(roomId);
    if (!c) return;
    c.at = this.now();
    c.owner = sessionId;
    this.scheduleFlush();
  }

  setCharacter(roomId: string, c: Omit<StoredCharacter, 'at'>): void {
    this.rooms.set(roomId, copyCharacter({ ...c, at: this.now() }));
    this.scheduleFlush();
  }

  clearCharacter(roomId: string): void {
    if (this.rooms.delete(roomId)) this.scheduleFlush();
  }

  /** Nomes escolhidos para as salas (nome -> sala), sem a `exceptRoom`. */
  reservedNames(exceptRoom?: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const [roomId, c] of this.rooms) if (roomId !== exceptRoom) out.set(c.name, roomId);
    return out;
  }

  private scheduleFlush(): void {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 2_000);
    this.timer.unref?.();
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.file) return;
    const now = this.now();
    const fresh = <T extends { at: number }>(m: Map<string, T>): [string, T][] =>
      [...m]
        .filter(([, v]) => now - v.at < MAX_AGE_MS)
        .sort((a, b) => b[1].at - a[1].at)
        .slice(0, MAX_ENTRIES);
    const kept = fresh(this.names);
    const rooms = fresh(this.rooms);
    this.names = new Map(kept);
    this.rooms = new Map(rooms);
    const data: NamesFile = { version: 1, names: Object.fromEntries(kept) };
    if (rooms.length) data.rooms = Object.fromEntries(rooms);
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(data));
      renameSync(tmp, this.file);
      log.clearOnce('names-write');
    } catch (err) {
      log.warnOnce('names-write', tr('Não foi possível gravar {0} ({1}); os nomes valem só nesta execução.', [this.file, errMsg(err)]));
    }
  }
}
