// Tela de cada terminal interativo no servidor (@xterm/headless + @xterm/addon-serialize, dependências opcionais
// como o node-pty). Quem conecta depois, reconecta ou troca de aba recebe a tela atual já montada, com os modos
// que o Claude Code ligou no começo (colagem entre colchetes, teclas de aplicação, mouse, tela alternativa). Sem
// eles, a reprodução da saída bruta perderia esses modos: colar várias linhas viraria vários prompts.
import { errMsg } from '../log';
import type { PtyScreen, ScreenFactory } from './manager';
import { tr } from '../../shared/i18n';

/** Linhas de rolagem guardadas por terminal. */
const SCROLLBACK = 5_000;

interface HeadlessTerminal {
  write(data: string, cb?: () => void): void;
  resize(cols: number, rows: number): void;
  loadAddon(addon: unknown): void;
  dispose(): void;
}

interface SerializeAddon {
  serialize(opts?: { scrollback?: number }): string;
}

/** Carrega o @xterm/headless e o addon de serialização. Devolve null + motivo se não der. */
export async function loadHeadlessScreen(): Promise<{ create: ScreenFactory | null; reason?: string }> {
  try {
    const headless = (await import('@xterm/headless')) as unknown as { Terminal?: unknown; default?: { Terminal?: unknown } };
    const serialize = (await import('@xterm/addon-serialize')) as unknown as { SerializeAddon?: unknown; default?: { SerializeAddon?: unknown } };
    const Terminal = (headless.Terminal ?? headless.default?.Terminal) as (new (o: Record<string, unknown>) => HeadlessTerminal) | undefined;
    const Serialize = (serialize.SerializeAddon ?? serialize.default?.SerializeAddon) as (new () => SerializeAddon) | undefined;
    if (!Terminal || !Serialize) return { create: null, reason: tr('@xterm/headless sem Terminal ou SerializeAddon') };
    return {
      create: (cols, rows): PtyScreen => {
        const term = new Terminal({ cols, rows, scrollback: SCROLLBACK, allowProposedApi: true });
        const ser = new Serialize();
        term.loadAddon(ser);
        return {
          write: (data, done) => term.write(data, done),
          resize: (c, r) => term.resize(c, r),
          serialize: () => ser.serialize({ scrollback: SCROLLBACK }),
          dispose: () => term.dispose(),
        };
      },
    };
  } catch (err) {
    return { create: null, reason: tr('@xterm/headless não instalado ({0})', [errMsg(err)]) };
  }
}
