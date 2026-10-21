// Nomes de sala escolhidos pelo usuário (botão direito > Renomear), persistidos por pasta em <dataDir>/rooms.json.
// Sem apelido, a sala usa o nome da pasta (model/rooms.ts roomDisplayNames); `defaults` dá nomes fixos a pastas
// conhecidas (a pasta de assets aparece como "Arquiteto").
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { errMsg, log } from '../log';
import { tr } from '../../shared/i18n';

export const ROOM_NAME_MAX = 40;

/** Chave comparável de um caminho (barras normais, sem barra final, sem diferença de maiúsculas). */
export function pathKey(p: string): string {
  return p.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export class RoomAliases {
  private aliases = new Map<string, string>();
  private readonly defaults = new Map<string, string>();

  /** `file` null = só em memória (testes). */
  constructor(private readonly file: string | null) {}

  load(): void {
    if (!this.file) return;
    try {
      const j = JSON.parse(readFileSync(this.file, 'utf8')) as { aliases?: Record<string, unknown> };
      for (const [k, v] of Object.entries(j.aliases ?? {})) if (typeof v === 'string' && v.trim()) this.aliases.set(pathKey(k), v.trim().slice(0, ROOM_NAME_MAX));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(tr('rooms.json ilegível ({0}); sem nomes de sala personalizados.', [errMsg(err)]));
    }
  }

  /** Nome fixo para uma pasta quando o usuário não escolheu outro. */
  setDefault(path: string, name: string): void {
    this.defaults.set(pathKey(path), name);
  }

  get(path: string): string | undefined {
    const k = pathKey(path);
    return this.aliases.get(k) ?? this.defaults.get(k);
  }

  /** Define o nome da sala da pasta; vazio volta ao padrão. Devolve o nome em uso. */
  set(path: string, name: string): string | undefined {
    const k = pathKey(path);
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, ROOM_NAME_MAX);
    if (clean) this.aliases.set(k, clean);
    else this.aliases.delete(k);
    this.save();
    return this.get(path);
  }

  private save(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(`${this.file}.tmp`, JSON.stringify({ version: 1, aliases: Object.fromEntries(this.aliases) }, null, 2));
      renameSync(`${this.file}.tmp`, this.file);
    } catch (err) {
      log.warn(tr('Não consegui gravar {0}: {1}', [this.file, errMsg(err)]));
    }
  }
}
