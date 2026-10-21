// Instala (ou remove) o hook de permissão do Habblaud em cada conta do Claude Code. Roda no HOST, com tsx:
//
//   npm run hooks:install     # acrescenta o hook PermissionRequest em <conta>/settings.json (backup antes)
//   npm run hooks:uninstall   # tira só o hook do Habblaud (os seus hooks ficam)
//   npm run hooks:status      # mostra, por conta, se está instalado, e se o Habblaud está respondendo pedidos
//   (opções: --dry-run, --node <caminho>, --port <n>, --timeout <s>)
//
// No Claude Code 2.1.287+ o mesmo hook vem pronto no plugin `habblaud-permissoes` do marketplace do
// repositório (mod/habblaud-permissoes, que roda o MESMO script); este instalador fica para as versões
// anteriores e para tirar instalações antigas.
//
// O hook (mod/habblaud-permissoes/hooks/permission-hook.mjs) deixa aprovar ou recusar pelo escritório os
// pedidos de permissão ("Do you want to…"): o Claude Code continua mostrando o diálogo no terminal e vale o
// que você responder primeiro. Sem o Habblaud no ar ou sem nenhuma página aberta, o hook sai na hora e nada muda.
//
// Em <conta>/settings.json só a lista hooks.PermissionRequest muda: entra um grupo {matcher: "*", hooks:
// [{type: "command", command: 'node "<Habblaud>/mod/habblaud-permissoes/hooks/permission-hook.mjs"', timeout,
// statusMessage}]} (os demais hooks e chaves ficam como estão). Antes de gravar, uma cópia vai para
// settings.json.habblaud-backup-<data>. Rodar de novo atualiza o caminho/opções sem duplicar (e troca o
// caminho antigo, scripts/permission-hook.mjs, de antes da 0.3, e o do nome antigo, mod/codetown-permissoes/).
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { discoverClaudeDirs } from '../server/accounts/detect';
import { detectNodeCommand, quotePath, readSettings, tildify, writeSettings, type Settings } from './statusline-install';
import { tr } from '../shared/i18n';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const HOOK_SCRIPT = join(ROOT, 'mod', 'habblaud-permissoes', 'hooks', 'permission-hook.mjs');
/** Onde o script ficava até a 0.2 (instalações antigas apontam para cá; o status avisa e manda reinstalar). */
export const LEGACY_HOOK_SCRIPT = join(ROOT, 'scripts', 'permission-hook.mjs');
/**
 * O hook é reconhecido pelo NOME do arquivo, em qualquer pasta: assim o caminho antigo (scripts/), o do nome
 * antigo (mod/codetown-permissoes/hooks/, que não existe mais) e o novo (mod/habblaud-permissoes/hooks/) contam
 * como "nosso", e install/uninstall trocam ou tiram qualquer um deles.
 */
const HOOK_NAME = 'permission-hook.mjs';
const EVENT = 'PermissionRequest';
export const DEFAULT_PORT = 4747;
export const DEFAULT_TIMEOUT_S = 300;
/** Folga do tempo limite do Claude Code sobre o do hook (o hook sempre desiste antes). */
const TIMEOUT_SLACK_S = 30;
export const STATUS_MESSAGE = tr('Aguardando resposta no Habblaud');

const USAGE = tr('Uso: npm run hooks:<install|uninstall|status> [-- opções]\n\n  install     acrescenta o hook de permissão do Habblaud em cada conta (faz backup do settings.json)\n  uninstall   tira o hook do Habblaud de cada conta (os outros hooks ficam)\n  status      mostra se o hook está instalado e se o Habblaud está respondendo pedidos\n\nOpções:\n  --dry-run        mostra o que mudaria, sem gravar nada\n  --node <cmd>     comando do node usado no hook (padrão: detectado no PATH)\n  --port <n>       porta do Habblaud (padrão: HABBLAUD_PORT ou {0})\n  --timeout <s>    quanto o hook espera sua resposta no Habblaud antes de devolver o pedido ao terminal\n                   (padrão: {1} s)\n  -h, --help       mostra esta ajuda\n\nContas: as mesmas do servidor (~/.claude* com projects/ ou sessions/, CLAUDE_CONFIG_DIR ou\nHABBLAUD_CLAUDE_DIRS).', [DEFAULT_PORT, DEFAULT_TIMEOUT_S]);

// ---------------------------------------------------------------------------------------------
// Funções puras (testadas em server/test/hooks-install.test.ts)
// ---------------------------------------------------------------------------------------------

export interface HookOptions {
  port: number;
  timeoutS: number;
}

type Rec = Record<string, unknown>;

function rec(v: unknown): Rec | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined;
}

/** `node "<hook>"`, com --port/--timeout só quando diferentes do padrão. */
export function hookCommand(nodeCmd: string, scriptPath: string, o: HookOptions): string {
  const node = /^[\w@%+=:,./~-]+$/.test(nodeCmd) ? nodeCmd : quotePath(nodeCmd);
  let cmd = `${node} ${quotePath(scriptPath)}`;
  if (o.port !== DEFAULT_PORT) cmd += ` --port ${o.port}`;
  if (o.timeoutS !== DEFAULT_TIMEOUT_S) cmd += ` --timeout ${o.timeoutS}`;
  return cmd;
}

/** O hook como o Claude Code o lê em hooks.PermissionRequest[].hooks[]. */
export function hookEntry(command: string, o: HookOptions): Rec {
  return { type: 'command', command, timeout: o.timeoutS + TIMEOUT_SLACK_S, statusMessage: STATUS_MESSAGE };
}

export function isOurHook(h: unknown): boolean {
  const r = rec(h);
  return !!r && typeof r.command === 'string' && r.command.includes(HOOK_NAME);
}

export type PlanAction =
  | { action: 'install'; settings: Settings; message: string }
  | { action: 'uninstall'; settings: Settings; message: string }
  | { action: 'none'; message: string }
  | { action: 'skip'; message: string };

/** hooks e hooks.PermissionRequest num formato que dá para editar (ou o motivo para não mexer). */
function eventList(settings: Settings): { hooks: Rec; list: unknown[] } | string {
  if (settings.hooks !== undefined && !rec(settings.hooks)) return tr('"hooks" em formato desconhecido; nada foi alterado');
  const hooks = rec(settings.hooks) ?? {};
  if (hooks[EVENT] !== undefined && !Array.isArray(hooks[EVENT])) return tr('"hooks.{0}" em formato desconhecido; nada foi alterado', [EVENT]);
  return { hooks, list: (hooks[EVENT] as unknown[] | undefined) ?? [] };
}

/** Lista sem os hooks do Habblaud (grupos que ficarem vazios saem); `removed` = quantos saíram. */
function withoutOurs(list: unknown[]): { list: unknown[]; removed: number } {
  let removed = 0;
  const out: unknown[] = [];
  for (const g of list) {
    const group = rec(g);
    if (!group || !Array.isArray(group.hooks)) {
      out.push(g);
      continue;
    }
    const kept = group.hooks.filter((h) => !isOurHook(h));
    removed += group.hooks.length - kept.length;
    if (kept.length === group.hooks.length) out.push(g);
    else if (kept.length) out.push({ ...group, hooks: kept });
  }
  return { list: out, removed };
}

/** Plano de instalação para um settings.json já lido (não grava nada). */
export function planInstall(settings: Settings, entry: Rec): PlanAction {
  const ev = eventList(settings);
  if (typeof ev === 'string') return { action: 'skip', message: ev };
  const mine = ev.list.flatMap((g) => {
    const group = rec(g);
    return group && Array.isArray(group.hooks) ? group.hooks.filter(isOurHook).map((h) => ({ group, hook: h as Rec })) : [];
  });
  const matchAll = (m: unknown) => m === undefined || m === '' || m === '*';
  if (mine.length === 1 && matchAll(mine[0].group.matcher) && JSON.stringify(mine[0].hook) === JSON.stringify(entry)) {
    return { action: 'none', message: tr('já instalado') };
  }
  const rest = withoutOurs(ev.list).list;
  const next: Settings = { ...settings, hooks: { ...ev.hooks, [EVENT]: [...rest, { matcher: '*', hooks: [entry] }] } };
  return { action: 'install', settings: next, message: mine.length ? tr('atualizado (novo caminho do Habblaud, do node ou das opções)') : tr('instalado') };
}

/** Plano de remoção: tira só os hooks do Habblaud (e o que ficar vazio por causa disso). */
export function planUninstall(settings: Settings): PlanAction {
  const ev = eventList(settings);
  if (typeof ev === 'string') return { action: 'skip', message: ev };
  const { list, removed } = withoutOurs(ev.list);
  if (!removed) return { action: 'none', message: tr('não estava instalado') };
  const hooks: Rec = { ...ev.hooks };
  if (list.length) hooks[EVENT] = list;
  else delete hooks[EVENT];
  const next: Settings = { ...settings };
  if (Object.keys(hooks).length) next.hooks = hooks;
  else delete next.hooks;
  return { action: 'uninstall', settings: next, message: tr('hook do Habblaud removido') };
}

/** Hook do Habblaud instalado nesta conta (o primeiro), ou undefined. */
export function installedHook(settings: Settings): Rec | undefined {
  const ev = eventList(settings);
  if (typeof ev === 'string') return undefined;
  for (const g of ev.list) {
    const hooks = rec(g)?.hooks;
    if (!Array.isArray(hooks)) continue;
    const h = hooks.find(isOurHook);
    if (h) return h as Rec;
  }
  return undefined;
}

/** Caminho do script num comando instalado (entre aspas duplas ou simples, ou sem aspas). */
export function scriptPathOf(command: string): string | undefined {
  const m = /("[^"]*permission-hook\.mjs"|'(?:[^']|'\\'')*permission-hook\.mjs'|\S*permission-hook\.mjs)/.exec(command);
  if (!m) return undefined;
  const q = m[1];
  if (q.startsWith('"')) return q.slice(1, -1);
  if (q.startsWith("'")) return q.slice(1, -1).replace(/'\\''/g, "'");
  return q;
}

// ---------------------------------------------------------------------------------------------
// Efeitos (arquivos e o /api/health do Habblaud)
// ---------------------------------------------------------------------------------------------

export interface RunOptions extends HookOptions {
  command: 'install' | 'uninstall' | 'status';
  dryRun: boolean;
  nodeCmd?: string;
}

export interface RunContext {
  env: NodeJS.ProcessEnv;
  home: string;
  now: Date;
  hookPath: string;
  out: (line: string) => void;
  /** Consulta o /api/health do Habblaud (testes injetam um falso). */
  health?: (port: number) => Promise<{ permissions?: boolean } | undefined>;
}

class FatalError extends Error {}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): RunOptions | 'help' {
  let command: RunOptions['command'] | undefined;
  let dryRun = false;
  let nodeCmd: string | undefined;
  const envPort = Number.parseInt(env.HABBLAUD_PORT ?? '', 10);
  let port = Number.isInteger(envPort) && envPort > 0 && envPort < 65_536 ? envPort : DEFAULT_PORT;
  let timeoutS = DEFAULT_TIMEOUT_S;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') return 'help';
    if (a === '--dry-run') dryRun = true;
    else if (a === '--node') {
      nodeCmd = argv[++i];
      if (!nodeCmd) throw new FatalError(tr('--node precisa de um caminho.'));
    } else if (a === '--port') {
      port = Number(argv[++i]);
      if (!Number.isInteger(port) || port <= 0 || port >= 65_536) throw new FatalError(tr('--port precisa de um número entre 1 e 65535.'));
    } else if (a === '--timeout') {
      timeoutS = Number(argv[++i]);
      if (!Number.isInteger(timeoutS) || timeoutS < 5 || timeoutS > 86_400) throw new FatalError(tr('--timeout precisa de um número de segundos entre 5 e 86400 (24 h).'));
    } else if ((a === 'install' || a === 'uninstall' || a === 'status') && !command) command = a;
    else throw new FatalError(tr('opção desconhecida: {0}\n\n{1}', [a, USAGE]));
  }
  if (!command) throw new FatalError(tr('diga o que fazer: install, uninstall ou status.\n\n{0}', [USAGE]));
  return { command, dryRun, nodeCmd, port, timeoutS };
}

async function fetchHealth(port: number): Promise<{ permissions?: boolean } | undefined> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1_500) });
    if (!res.ok) return undefined;
    return (await res.json()) as { permissions?: boolean };
  } catch {
    return undefined;
  }
}

/** Executa o comando para todas as contas. Devolve o código de saída. */
export async function run(opts: RunOptions, ctx: RunContext): Promise<number> {
  const { env, home, out } = ctx;
  const dirs = discoverClaudeDirs(env, home);
  if (!dirs.length) {
    out(tr('Nenhuma conta do Claude Code encontrada (~/.claude* com projects/ ou sessions/). Use HABBLAUD_CLAUDE_DIRS se estiverem em outro lugar.'));
    return 1;
  }
  const nodeCmd = opts.nodeCmd ?? detectNodeCommand(env, home);
  const entry = hookEntry(hookCommand(nodeCmd, ctx.hookPath, opts), opts);
  let failures = 0;
  let changed = 0;
  for (const dir of dirs) {
    const file = join(dir, 'settings.json');
    const label = `${basename(dir)} (${tildify(file, home)})`;
    const read = readSettings(file);
    if ('error' in read) {
      out(`✗ ${label}: ${read.error}`);
      failures++;
      continue;
    }
    if (opts.command === 'status') {
      const h = installedHook(read.settings);
      if (!h) {
        out(tr('• {0}: não instalado', [label]));
        continue;
      }
      const path = typeof h.command === 'string' ? scriptPathOf(h.command) : undefined;
      if (path && resolve(path) !== resolve(ctx.hookPath)) {
        const gone = !existsSync(path) ? tr(' (esse arquivo não existe mais: o hook falha e vale só o terminal)') : '';
        out(tr('! {0}: o hook aponta para {1}{2}; rode npm run hooks:install para atualizar', [label, path, gone]));
      }
      out(tr('• {0}: instalado ({1}; tempo limite {2} s)', [label, String(h.command), String(h.timeout ?? '?')]));
      continue;
    }
    const plan = opts.command === 'install' ? planInstall(read.settings, entry) : planUninstall(read.settings);
    if (plan.action === 'none') {
      out(`= ${label}: ${plan.message}`);
      continue;
    }
    if (plan.action === 'skip') {
      out(`✗ ${label}: ${plan.message}`);
      failures++;
      continue;
    }
    if (opts.dryRun) {
      out(tr('~ {0}: {1} (simulação: nada gravado)', [label, plan.message]));
      out(`    hooks.${EVENT} → ${JSON.stringify(rec(plan.settings.hooks)?.[EVENT] ?? null)}`);
      continue;
    }
    try {
      const backup = writeSettings(file, plan.settings, read.raw, ctx.now);
      out(`✓ ${label}: ${plan.message}${backup ? tr(' · backup em {0}', [tildify(backup, home)]) : ''}`);
      changed++;
    } catch (err) {
      out(tr('✗ {0}: não consegui gravar ({1})', [label, (err as Error).message]));
      failures++;
    }
  }
  if (opts.command === 'status') {
    const health = await (ctx.health ?? fetchHealth)(opts.port);
    if (!health) out(tr('Habblaud em http://127.0.0.1:{0}: fora do ar (com ele parado, o hook sai na hora e o terminal segue normal).', [opts.port]));
    else if (health.permissions) out(tr('Habblaud em http://127.0.0.1:{0}: respondendo pedidos de permissão (com alguma página aberta).', [opts.port]));
    else out(tr('Habblaud em http://127.0.0.1:{0}: no ar, mas responder pelo escritório está desligado (porta exposta na rede ou HABBLAUD_TERMINAL=0).', [opts.port]));
  }
  if (opts.command === 'install' && changed) {
    out('');
    out(tr('Pronto. Com o Habblaud aberto no navegador, os pedidos de permissão aparecem no escritório e você'));
    out(tr('pode aprovar ou recusar por lá; o diálogo continua no terminal e vale o que responder primeiro.'));
    out(tr('Sessões abertas costumam recarregar o settings.json sozinhas; se não, reabra a sessão.'));
    out(tr('Para desfazer: npm run hooks:uninstall'));
  }
  return failures ? 1 : 0;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed === 'help') {
    console.log(USAGE);
    return;
  }
  const home = process.env.HOME || homedir();
  process.exitCode = await run(parsed, { env: process.env, home, now: new Date(), hookPath: HOOK_SCRIPT, out: (l) => console.log(l) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof FatalError ? tr('[hooks] Erro: {0}', [err.message]) : tr('[hooks] Erro inesperado: {0}', [String(err)]));
    process.exitCode = 1;
  });
}
