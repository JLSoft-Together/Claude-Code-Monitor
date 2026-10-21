// Migração do nome antigo do projeto (CodeTown, até a 0.3.2) para Habblaud. O que ainda precisa conhecer o
// nome antigo fica aqui, para sair de uma vez quando ninguém mais vier de uma instalação da 0.3.
import { existsSync, readdirSync, renameSync, rmdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tr } from '../shared/i18n';

/** Nome antigo em minúsculas: pasta de estado, plugins, marketplace, projeto e volume do Docker. */
export const LEGACY_NAME = 'codetown';
const LEGACY_ENV_PREFIX = 'CODETOWN_';
const ENV_PREFIX = 'HABBLAUD_';

/** Variáveis do nome antigo (CODETOWN_*) presentes em `keys`, com o nome novo de cada uma. */
export function legacyEnvVars(keys: Iterable<string>): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  for (const k of keys) {
    if (k.startsWith(LEGACY_ENV_PREFIX)) out.push({ from: k, to: ENV_PREFIX + k.slice(LEGACY_ENV_PREFIX.length) });
  }
  return out.sort((a, b) => a.from.localeCompare(b.from));
}

/** Aviso para as variáveis antigas (que não valem mais), ou undefined se não houver nenhuma. */
export function legacyEnvWarning(keys: Iterable<string>, where = tr('no ambiente')): string | undefined {
  const vars = legacyEnvVars(keys);
  if (!vars.length) return undefined;
  return tr('{0} {1}: {2}. Renomeie para valer de novo.', [vars.length === 1 ? tr('variável do nome antigo ignorada') : tr('variáveis do nome antigo ignoradas'), where, vars.map((v) => `${v.from} → ${v.to}`).join(', ')]);
}

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const isFile = (p: string) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** Move de `from` para `to` o que falta lá (pastas em comum são mescladas); em arquivos dos dois lados, vence o mais recente. */
function mergeInto(from: string, to: string, moved: string[], rel: string): void {
  for (const name of readdirSync(from)) {
    const src = join(from, name);
    const dst = join(to, name);
    const relName = rel ? `${rel}/${name}` : name;
    if (!existsSync(dst)) {
      renameSync(src, dst);
      moved.push(relName);
    } else if (isDir(src) && isDir(dst)) mergeInto(src, dst, moved, relName);
    else if (isFile(src) && isFile(dst) && statSync(src).mtimeMs > statSync(dst).mtimeMs) {
      // Ex.: o mod antigo seguiu gravando o uso em ~/.codetown depois de a pasta nova existir.
      renameSync(src, dst);
      moved.push(relName);
    }
  }
  try {
    rmdirSync(from);
  } catch {
    // sobrou algo que já existia no destino: a pasta antiga fica, com só esses itens
  }
}

/**
 * Leva o estado de ~/.codetown para ~/.habblaud (uso capturado pelo mod/tap e, fora do Docker, nomes, linha do
 * tempo e estatísticas). Sem a pasta nova, é um rename; se ela já existe (o mod gravou o uso antes), move o que
 * falta lá e o que for mais recente. Devolve o que foi movido (vazio = nada a fazer) e nunca lança.
 */
export function migrateLegacyStateDir(home: string): { moved: string[]; error?: string } {
  const from = join(home, `.${LEGACY_NAME}`);
  const to = join(home, '.habblaud');
  const moved: string[] = [];
  if (!isDir(from)) return { moved };
  try {
    if (!existsSync(to)) {
      renameSync(from, to);
      moved.push('.');
    } else if (isDir(to)) mergeInto(from, to, moved, '');
    else return { moved, error: tr('{0} existe e não é uma pasta', [to]) };
    return { moved };
  } catch (err) {
    return { moved, error: (err as Error).message };
  }
}

/** Frase curta para o log de quem migrou (undefined se nada mudou). */
export function describeStateMigration(r: { moved: string[]; error?: string }): string | undefined {
  if (r.error) return tr('não consegui levar ~/.{0} para ~/.habblaud ({1}); mova a pasta à mão.', [LEGACY_NAME, r.error]);
  if (!r.moved.length) return undefined;
  return r.moved[0] === '.' ? tr('~/.{0} (nome antigo) agora é ~/.habblaud.', [LEGACY_NAME]) : tr('de ~/.{0} (nome antigo) para ~/.habblaud: {1}.', [LEGACY_NAME, r.moved.join(', ')]);
}
