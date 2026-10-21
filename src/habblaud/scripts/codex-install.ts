// Instala (ou remove) os hooks do Habblaud no OpenAI Codex (CLI `codex` e o app desktop). Roda no HOST, com tsx:
//
//   npm run codex:install     # acrescenta os grupos do Habblaud em <CODEX_HOME>/hooks.json (backup antes)
//   npm run codex:uninstall   # tira só os grupos do Habblaud (os outros hooks ficam)
//   npm run codex:status      # mostra, por pasta, se os grupos estão lá e se o Habblaud está respondendo
//   (opções: --dry-run, --conta <id>, --port <n>, --espera <s>)
//
// O hook (mod/habblaud-codex/hook.mjs) manda ao escritório o que as sessões do Codex fazem (SessionStart,
// UserPromptSubmit, PreToolUse, PostToolUse, Stop, SubagentStart, SubagentStop, SessionEnd) e deixa aprovar ou recusar
// pelo escritório os pedidos de aprovação (PermissionRequest): o Codex espera o hook por até a espera configurada
// (padrão 25 s) e, sem decisão, segue a aprovação normal no terminal.
//
// Pastas: as mesmas contas do Codex que o servidor acompanha: HABBLAUD_CODEX_DIRS (lista separada por vírgula;
// substitui tudo) ou CODEX_HOME e as pastas ~/.codex* do Codex (isCodexHome). Pasta do Claude Code nunca é tocada.
//
// Em <pasta>/hooks.json ({description?, hooks: {<Evento>: [{matcher?, hooks: [handler]}]}}) só mudam as listas dos
// eventos acima: entra, no FIM da lista de cada um, um grupo sem matcher com o handler
// {type: "command", command: 'node "<Habblaud>/mod/habblaud-codex/hook.mjs"', ...}. O resto do arquivo fica como
// está. Antes de gravar, uma cópia vai para hooks.json.habblaud-backup-<data>.
//
// Confiança: o Codex só roda um hook novo ou alterado depois que você o aprova em /hooks, e guarda essa aprovação
// (config.toml, [hooks.state."<hooks.json>:<evento>:<grupo>:<handler>"].trusted_hash) pela POSIÇÃO do grupo e por um
// hash do evento, do matcher e do handler (comando, timeout, async, statusMessage). Por isso o instalador:
// - nunca grava a confiança nem mexe no config.toml (quem aprova é você, em /hooks);
// - sempre ACRESCENTA no fim e, ao atualizar, troca o handler do Habblaud NO MESMO lugar: os grupos de outros apps
//   (ex.: o Orca) nunca mudam de posição nem de conteúdo;
// - usa um comando sem opções e valores fixos (porta e espera ficam em ~/.habblaud/codex-hook.json, que o hook lê):
//   mudar a porta não pede aprovação nova; mudar a espera muda o timeout do PermissionRequest e pede.
// Rodar de novo não duplica (o grupo do Habblaud é reconhecido pelo comando).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isClaudeDir } from '../server/accounts/detect';
import { discoverCodexDirs } from '../server/sources/codex/accounts';
import { quotePath, readSettings, tildify, writeSettings, type Settings } from './statusline-install';
import { tr } from '../shared/i18n';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const HOOK_SCRIPT = join(ROOT, 'mod', 'habblaud-codex', 'hook.mjs');
/** O hook do Habblaud é reconhecido pelo caminho do script no comando (em qualquer pasta do repositório). */
const HOOK_MARK = /habblaud-codex[\\/]+hook\.mjs/;
export const DEFAULT_PORT = 4747;
export const DEFAULT_WAIT_S = 25;
export const MIN_WAIT_S = 5;
export const MAX_WAIT_S = 120;
/** Eventos só de observação: em segundo plano (async), sem atrasar a sessão. */
export const OBSERVE_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStart', 'SubagentStop'] as const;
/** Todos os eventos em que o Habblaud entra. */
export const EVENTS = [...OBSERVE_EVENTS, 'SessionEnd', 'PermissionRequest'] as const;
/** Tempo limite dos eventos de observação (o hook manda o evento com prazo de 1,5 s). */
export const OBSERVE_TIMEOUT_S = 5;
/** SessionEnd: o Codex sempre o roda em primeiro plano, com 1 s por padrão (máx. 3). */
export const SESSION_END_TIMEOUT_S = 1;
/** Folga do tempo limite do PermissionRequest sobre a espera (node subindo, evento e registro; o hook desiste antes). */
export const PERMISSION_SLACK_S = 10;
export const STATUS_MESSAGE = tr('Aguardando resposta no Habblaud…');
/** Configuração lida pelo hook (porta e espera), em ~/.habblaud. */
export const CONFIG_NAME = 'codex-hook.json';

/** Versão mínima do Node para o hook (o mesmo `engines` do Habblaud, na parte que importa: fetch e AbortSignal). */
export const MIN_NODE_MAJOR = 22;

const USAGE = tr('Uso: npm run codex:<install|uninstall|status> [-- opções]\n\n  install     acrescenta os hooks do Habblaud no hooks.json de cada pasta do Codex (faz backup antes)\n  uninstall   tira os hooks do Habblaud de cada pasta (os outros hooks ficam)\n  status      mostra se os hooks estão lá e se o Habblaud está respondendo\n\nOpções:\n  --dry-run        mostra o que mudaria, sem gravar nada\n  --conta <id>     só a pasta desta conta (o nome da pasta, ex.: .codex)\n  --port <n>       porta do Habblaud (padrão: HABBLAUD_PORT ou {0})\n  --espera <s>     quanto o Codex espera sua resposta no Habblaud antes de pedir a aprovação no terminal\n                   (padrão: {1} s; entre {2} e {3})\n  --node <caminho> o Node {4}+ que roda os hooks (padrão: o `node` do shell de login, se for {5}+;\n                   senão o primeiro {6}+ entre /opt/homebrew/bin, /usr/local/bin e o deste comando)\n  -h, --help       mostra esta ajuda\n\nPastas: HABBLAUD_CODEX_DIRS (lista separada por vírgula) ou CODEX_HOME e as pastas ~/.codex* do Codex.\nDepois de instalar, abra o Codex e aprove os hooks do Habblaud em /hooks.', [DEFAULT_PORT, DEFAULT_WAIT_S, MIN_WAIT_S, MAX_WAIT_S, MIN_NODE_MAJOR, MIN_NODE_MAJOR, MIN_NODE_MAJOR]);

// ---------------------------------------------------------------------------------------------
// Funções puras (testadas em server/test/codex-install.test.ts)
// ---------------------------------------------------------------------------------------------

type Rec = Record<string, unknown>;

function rec(v: unknown): Rec | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined;
}

/**
 * `node "<hook>"` (ou `"<node>" "<hook>"` com um Node escolhido, ver chooseNode), sem opções: o comando entra no hash
 * da confiança do Codex.
 */
export function hookCommand(scriptPath: string, nodeBin?: string): string {
  return `${nodeBin ? quotePath(nodeBin) : 'node'} ${quotePath(scriptPath)}`;
}

/** Major de uma versão como `node --version` imprime ("v24.17.0" → 24). */
export function nodeMajor(version: string | undefined): number | undefined {
  const m = /^v?(\d+)\./.exec(version?.trim() ?? '');
  return m ? Number(m[1]) : undefined;
}

/**
 * O Node dos hooks. O Codex roda o hook por `$SHELL -lc`: um shell de LOGIN, que no zsh não lê o .zshrc (onde o nvm
 * costuma estar), então o `node` dele pode ser outro, e antigo. `probe(undefined)` = versão do `node` desse shell;
 * `probe(caminho)` = versão daquele binário. Shell de login com Node 22+: `node` (comando curto, sobrevive a trocas de
 * versão). Senão, o primeiro candidato 22+ com caminho absoluto; nenhum: `node` mesmo, com aviso.
 */
export function chooseNode(probe: (bin: string | undefined) => string | undefined, candidates: readonly string[]): { bin?: string; login?: string; chosen?: string } {
  const login = probe(undefined);
  if ((nodeMajor(login) ?? 0) >= MIN_NODE_MAJOR) return { login };
  for (const bin of candidates) {
    const v = probe(bin);
    if ((nodeMajor(v) ?? 0) >= MIN_NODE_MAJOR) return { bin, login, chosen: v };
  }
  return { login };
}

/** Tempo limite do PermissionRequest para uma espera (s). */
export function permissionTimeout(waitS: number): number {
  return waitS + PERMISSION_SLACK_S;
}

/** O handler do Habblaud para um evento, como o Codex o lê em hooks.<Evento>[].hooks[]. */
export function handlerFor(event: string, command: string, waitS: number): Rec {
  if (event === 'PermissionRequest') return { type: 'command', command, timeout: permissionTimeout(waitS), statusMessage: STATUS_MESSAGE };
  if (event === 'SessionEnd') return { type: 'command', command, timeout: SESSION_END_TIMEOUT_S };
  return { type: 'command', command, async: true, timeout: OBSERVE_TIMEOUT_S };
}

export function isOurHandler(h: unknown): boolean {
  const r = rec(h);
  return !!r && typeof r.command === 'string' && HOOK_MARK.test(r.command);
}

/** JSON com as chaves em ordem (para comparar handlers sem depender da ordem em que foram gravados). */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const r = rec(v);
  if (!r) return JSON.stringify(v) ?? 'null';
  return `{${Object.keys(r)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(r[k])}`)
    .join(',')}}`;
}

/** Caminho do script num comando instalado (entre aspas duplas ou simples, ou sem aspas). */
export function scriptPathOf(command: string): string | undefined {
  const m = /("[^"]*habblaud-codex[\\/]+hook\.mjs"|'(?:[^']|'\\'')*habblaud-codex[\\/]+hook\.mjs'|\S*habblaud-codex[\\/]+hook\.mjs)/.exec(command);
  if (!m) return undefined;
  const q = m[1];
  if (q.startsWith('"')) return q.slice(1, -1);
  if (q.startsWith("'")) return q.slice(1, -1).replace(/'\\''/g, "'");
  return q;
}

export type PlanAction =
  | { action: 'install'; file: Settings; message: string; /** Eventos com hook novo ou alterado (aprovar em /hooks). */ approve: string[] }
  | { action: 'uninstall'; file: Settings; message: string; /** Eventos em que grupos de outros apps mudaram de posição. */ shifted: string[] }
  | { action: 'none'; message: string }
  | { action: 'skip'; message: string };

/** `hooks` num formato que dá para editar (ou o motivo para não mexer). */
function hooksOf(file: Settings): Rec | string {
  if (file.hooks !== undefined && !rec(file.hooks)) return tr('"hooks" em formato desconhecido; nada foi alterado');
  const hooks = rec(file.hooks) ?? {};
  for (const [event, list] of Object.entries(hooks)) {
    if (!Array.isArray(list)) return tr('"hooks.{0}" em formato desconhecido; nada foi alterado', [event]);
  }
  return hooks;
}

/** Posições (grupo, handler) dos handlers do Habblaud numa lista de grupos, na ordem. */
function ourPositions(list: unknown[]): Array<{ g: number; h: number }> {
  const out: Array<{ g: number; h: number }> = [];
  list.forEach((g, gi) => {
    const hooks = rec(g)?.hooks;
    if (Array.isArray(hooks)) hooks.forEach((h, hi) => isOurHandler(h) && out.push({ g: gi, h: hi }));
  });
  return out;
}

/** Posições (grupo:handler) dos handlers de OUTROS apps, na ordem: a chave da confiança deles no Codex. */
function otherPositions(list: unknown[]): string {
  const out: string[] = [];
  list.forEach((g, gi) => {
    const hooks = rec(g)?.hooks;
    if (Array.isArray(hooks)) hooks.forEach((h, hi) => !isOurHandler(h) && out.push(`${gi}:${hi}`));
  });
  return out.join(',');
}

/** Tira os handlers nas posições dadas (do fim para o começo, sem bagunçar os índices); grupo que fica vazio por isso sai. */
function removeAt(list: unknown[], positions: Array<{ g: number; h: number }>): unknown[] {
  const out = [...list];
  const byGroup = new Map<number, number[]>();
  for (const p of positions) byGroup.set(p.g, [...(byGroup.get(p.g) ?? []), p.h]);
  for (const g of [...byGroup.keys()].sort((a, b) => b - a)) {
    const group = rec(out[g])!;
    const drop = new Set(byGroup.get(g));
    const kept = (group.hooks as unknown[]).filter((_, i) => !drop.has(i));
    if (kept.length) out[g] = { ...group, hooks: kept };
    else out.splice(g, 1);
  }
  return out;
}

/**
 * Plano de instalação para um hooks.json já lido (não grava nada). Evento sem o Habblaud: um grupo novo no FIM da
 * lista. Com ele: o handler é trocado no MESMO lugar se mudou (caminho do repositório, espera); cópias repetidas saem.
 */
export function planInstall(file: Settings, command: string, waitS: number): PlanAction {
  const parsed = hooksOf(file);
  if (typeof parsed === 'string') return { action: 'skip', message: parsed };
  const hooks: Rec = { ...parsed };
  const added: string[] = [];
  const updated: string[] = [];
  for (const event of EVENTS) {
    const handler = handlerFor(event, command, waitS);
    let list = [...((hooks[event] as unknown[] | undefined) ?? [])];
    const found = ourPositions(list);
    if (!found.length) {
      list.push({ hooks: [handler] });
      added.push(event);
    } else {
      const first = found[0];
      const group = rec(list[first.g])!;
      const handlers = [...(group.hooks as unknown[])];
      let changed = false;
      if (canonical(handlers[first.h]) !== canonical(handler)) {
        handlers[first.h] = handler;
        list[first.g] = { ...group, hooks: handlers };
        changed = true;
      }
      // Cópias repetidas (editadas à mão): o hook rodaria duas vezes.
      if (found.length > 1) {
        list = removeAt(list, found.slice(1));
        changed = true;
      }
      if (changed) updated.push(event);
    }
    hooks[event] = list;
  }
  if (!added.length && !updated.length) return { action: 'none', message: tr('já instalado') };
  const parts = [added.length ? (updated.length ? tr('instalado em {0}', [added.join(', ')]) : tr('instalado ({0} eventos)', [added.length])) : '', updated.length ? tr('atualizado em {0}', [updated.join(', ')]) : ''].filter(Boolean);
  return { action: 'install', file: { ...file, hooks }, message: parts.join('; '), approve: [...added, ...updated] };
}

/**
 * Plano de remoção: tira só os handlers do Habblaud (e os grupos que ficarem vazios por isso; a lista de um evento que
 * esvaziar sai, e `hooks` também, se ficar vazio). Grupos de outros apps que vinham DEPOIS de um grupo do Habblaud
 * sobem uma posição: o Codex pede para aprová-los de novo em /hooks (`shifted`).
 */
export function planUninstall(file: Settings): PlanAction {
  const parsed = hooksOf(file);
  if (typeof parsed === 'string') return { action: 'skip', message: parsed };
  const hooks: Rec = { ...parsed };
  let removed = 0;
  const shifted: string[] = [];
  for (const [event, raw] of Object.entries(hooks)) {
    const list = raw as unknown[];
    const found = ourPositions(list);
    if (!found.length) continue;
    const next = removeAt(list, found);
    removed += found.length;
    // Algum handler de outro app mudou de posição (vinha depois de um do Habblaud)?
    if (otherPositions(list) !== otherPositions(next)) shifted.push(event);
    if (next.length) hooks[event] = next;
    else delete hooks[event];
  }
  if (!removed) return { action: 'none', message: tr('não estava instalado') };
  const next: Settings = { ...file };
  if (Object.keys(hooks).length) next.hooks = hooks;
  else delete next.hooks;
  return { action: 'uninstall', file: next, message: tr('hooks do Habblaud removidos'), shifted };
}

export interface InstallState {
  /** Eventos com o handler do Habblaud igual ao esperado. */
  ok: string[];
  /** Eventos com o handler do Habblaud diferente (outro caminho ou outra espera). */
  outdated: string[];
  missing: string[];
  /** Caminhos do script nos handlers instalados. */
  paths: string[];
}

/** O que está instalado num hooks.json (para o status). */
export function installState(file: Settings, command: string, waitS: number): InstallState {
  const parsed = hooksOf(file);
  const hooks = typeof parsed === 'string' ? {} : parsed;
  const state: InstallState = { ok: [], outdated: [], missing: [], paths: [] };
  for (const event of EVENTS) {
    const list = (hooks[event] as unknown[] | undefined) ?? [];
    const found = ourPositions(list);
    if (!found.length) {
      state.missing.push(event);
      continue;
    }
    const group = rec(list[found[0].g])!;
    const h = rec((group.hooks as unknown[])[found[0].h])!;
    const path = typeof h.command === 'string' ? scriptPathOf(h.command) : undefined;
    if (path && !state.paths.includes(path)) state.paths.push(path);
    (canonical(h) === canonical(handlerFor(event, command, waitS)) && found.length === 1 ? state.ok : state.outdated).push(event);
  }
  return state;
}

/**
 * Pastas do Codex: as MESMAS que o servidor acompanha (discoverCodexDirs da fonte do Codex: HABBLAUD_CODEX_DIRS, que
 * substitui tudo, ou CODEX_HOME e as pastas ~/.codex* com cara de Codex; ~/.codex primeiro). Pasta do Claude Code
 * listada por engano fica de fora (`refused`).
 */
export function discoverCodexHomes(env: NodeJS.ProcessEnv, home: string): { dirs: string[]; refused: string[] } {
  const dirs: string[] = [];
  const refused: string[] = [];
  for (const p of discoverCodexDirs(env, home)) (isClaudeDir(p) ? refused : dirs).push(p);
  return { dirs, refused };
}

// ---------------------------------------------------------------------------------------------
// Efeitos (arquivos e o /api/health do Habblaud)
// ---------------------------------------------------------------------------------------------

export interface HookConfig {
  port: number;
  permissionTimeoutS: number;
}

export interface RunOptions {
  command: 'install' | 'uninstall' | 'status';
  dryRun: boolean;
  /** Só a pasta desta conta (basename). */
  account?: string;
  port: number;
  waitS: number;
  /** --node: o Node dos hooks, com caminho absoluto (sem ela, chooseNode). */
  node?: string;
}

export interface Health {
  permissions?: boolean;
  messages?: boolean;
  codexEvents?: boolean;
}

export interface RunContext {
  env: NodeJS.ProcessEnv;
  home: string;
  now: Date;
  hookPath: string;
  out: (line: string) => void;
  /** Consulta o /api/health do Habblaud (testes injetam um falso). */
  health?: (port: number) => Promise<Health | undefined>;
  /** Versão de um Node (ver chooseNode); ausente = não consulta e usa `node` (os testes não rodam shells). */
  nodeProbe?: (bin: string | undefined) => string | undefined;
  /** Candidatos a Node quando o do shell de login é antigo. */
  nodeCandidates?: readonly string[];
}

class FatalError extends Error {}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): RunOptions | 'help' {
  let command: RunOptions['command'] | undefined;
  let dryRun = false;
  let account: string | undefined;
  const envPort = Number.parseInt(env.HABBLAUD_PORT ?? '', 10);
  let port = Number.isInteger(envPort) && envPort > 0 && envPort < 65_536 ? envPort : DEFAULT_PORT;
  let waitS = DEFAULT_WAIT_S;
  let node: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') return 'help';
    if (a === '--dry-run') dryRun = true;
    else if (a === '--conta') {
      account = argv[++i];
      if (!account) throw new FatalError(tr('--conta precisa do nome da pasta da conta (ex.: .codex).'));
    } else if (a === '--port') {
      port = Number(argv[++i]);
      if (!Number.isInteger(port) || port <= 0 || port >= 65_536) throw new FatalError(tr('--port precisa de um número entre 1 e 65535.'));
    } else if (a === '--espera') {
      waitS = Number(argv[++i]);
      if (!Number.isInteger(waitS) || waitS < MIN_WAIT_S || waitS > MAX_WAIT_S) throw new FatalError(tr('--espera precisa de um número de segundos entre {0} e {1}.', [MIN_WAIT_S, MAX_WAIT_S]));
    } else if (a === '--node') {
      node = argv[++i];
      if (!node || !isAbsolute(node)) throw new FatalError(tr('--node precisa do caminho absoluto de um Node 22+ (ex.: /opt/homebrew/bin/node).'));
    } else if ((a === 'install' || a === 'uninstall' || a === 'status') && !command) command = a;
    else throw new FatalError(tr('opção desconhecida: {0}\n\n{1}', [a, USAGE]));
  }
  if (!command) throw new FatalError(tr('diga o que fazer: install, uninstall ou status.\n\n{0}', [USAGE]));
  return { command, dryRun, account, port, waitS, ...(node ? { node } : {}) };
}

export function configPath(home: string): string {
  return join(home, '.habblaud', CONFIG_NAME);
}

/** Configuração gravada para o hook (undefined = não existe ou ilegível). */
export function readHookConfig(home: string): Partial<HookConfig> | undefined {
  try {
    const j = rec(JSON.parse(readFileSync(configPath(home), 'utf8')));
    if (!j) return undefined;
    const out: Partial<HookConfig> = {};
    if (typeof j.port === 'number') out.port = j.port;
    if (typeof j.permissionTimeoutS === 'number') out.permissionTimeoutS = j.permissionTimeoutS;
    return out;
  } catch {
    return undefined;
  }
}

/** Grava a configuração do hook se mudou. Devolve true se gravou. */
function writeHookConfig(home: string, cfg: HookConfig): boolean {
  const cur = readHookConfig(home);
  if (cur?.port === cfg.port && cur.permissionTimeoutS === cfg.permissionTimeoutS) return false;
  mkdirSync(join(home, '.habblaud'), { recursive: true });
  writeFileSync(configPath(home), `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o644 });
  return true;
}

async function fetchHealth(port: number): Promise<Health | undefined> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1_500) });
    if (!res.ok) return undefined;
    return (await res.json()) as Health;
  } catch {
    return undefined;
  }
}

/** Executa o comando para todas as pastas do Codex. Devolve o código de saída. */
export async function run(opts: RunOptions, ctx: RunContext): Promise<number> {
  const { env, home, out } = ctx;
  const found = discoverCodexHomes(env, home);
  for (const p of found.refused) out(tr('! {0}: é uma pasta do Claude Code, não do Codex; fica de fora.', [tildify(p, home)]));
  const dirs = opts.account ? found.dirs.filter((d) => basename(d) === opts.account) : found.dirs;
  if (!dirs.length) {
    out(
      opts.account
        ? tr('Nenhuma pasta do Codex com o nome {0} (pastas encontradas: {1}).', [opts.account, found.dirs.map((d) => basename(d)).join(', ') || tr('nenhuma')])
        : tr('Nenhuma pasta do Codex encontrada (~/.codex ou CODEX_HOME). Use HABBLAUD_CODEX_DIRS se ela estiver em outro lugar.'),
    );
    return 1;
  }
  let nodeBin = opts.node;
  if (!nodeBin && ctx.nodeProbe) {
    const pick = chooseNode(ctx.nodeProbe, ctx.nodeCandidates ?? []);
    nodeBin = pick.bin;
    const login = pick.login ? `Node ${pick.login}` : tr('nenhum Node');
    if (pick.bin) out(tr('i O shell de login (onde o Codex roda os hooks) tem {0}; o hook precisa do {1}+ e vai usar {2} ({3}).', [login, MIN_NODE_MAJOR, tildify(pick.bin, home), pick.chosen]));
    else if ((nodeMajor(pick.login) ?? 0) < MIN_NODE_MAJOR)
      out(tr('! O shell de login (onde o Codex roda os hooks) tem {0} e não achei um Node {1}+: os hooks podem falhar. Use --node <caminho de um Node {2}+>.', [login, MIN_NODE_MAJOR, MIN_NODE_MAJOR]));
  }
  const command = hookCommand(ctx.hookPath, nodeBin);
  let failures = 0;
  let changed = 0;
  const approve = new Set<string>();
  for (const dir of dirs) {
    const file = join(dir, 'hooks.json');
    const label = `${basename(dir)} (${tildify(file, home)})`;
    const read = readSettings(file);
    if ('error' in read) {
      out(`✗ ${label}: ${read.error}`);
      failures++;
      continue;
    }
    if (opts.command === 'status') {
      const cfgWait = readHookConfig(home)?.permissionTimeoutS;
      const st = installState(read.settings, command, typeof cfgWait === 'number' ? cfgWait : opts.waitS);
      if (!st.ok.length && !st.outdated.length) {
        out(tr('• {0}: não instalado', [label]));
        continue;
      }
      for (const p of st.paths) {
        if (resolve(p) === resolve(ctx.hookPath)) continue;
        const gone = !existsSync(p) ? tr(' (esse arquivo não existe mais: os hooks falham e nada chega ao escritório)') : '';
        out(tr('! {0}: os hooks apontam para {1}{2}; rode npm run codex:install para atualizar', [label, p, gone]));
      }
      if (st.outdated.length) out(tr('! {0}: diferente do esperado em {1}; rode npm run codex:install para atualizar', [label, st.outdated.join(', ')]));
      if (st.missing.length) out(tr('! {0}: faltando em {1}; rode npm run codex:install', [label, st.missing.join(', ')]));
      out(tr('• {0}: instalado em {1} de {2} eventos', [label, st.ok.length + st.outdated.length, EVENTS.length]));
      continue;
    }
    const plan = opts.command === 'install' ? planInstall(read.settings, command, opts.waitS) : planUninstall(read.settings);
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
      out(`    hooks → ${JSON.stringify(plan.file.hooks ?? null)}`);
      continue;
    }
    try {
      const backup = writeSettings(file, plan.file, read.raw, ctx.now);
      out(`✓ ${label}: ${plan.message}${backup ? tr(' · backup em {0}', [tildify(backup, home)]) : ''}`);
      changed++;
      if (plan.action === 'install') for (const e of plan.approve) approve.add(e);
      if (plan.action === 'uninstall' && plan.shifted.length) {
        out(tr('    Hooks de outros apps que vinham depois dos do Habblaud ({0}) mudaram de posição:', [plan.shifted.join(', ')]));
        out(tr('    o Codex vai pedir para aprová-los de novo em /hooks.'));
      }
    } catch (err) {
      out(tr('✗ {0}: não consegui gravar ({1})', [label, (err as Error).message]));
      failures++;
    }
  }
  const cfgFile = tildify(configPath(home), home);
  if (opts.command === 'install') {
    const cfg: HookConfig = { port: opts.port, permissionTimeoutS: opts.waitS };
    if (opts.dryRun) out(tr('~ configuração do hook ({0}): porta {1}, espera {2} s (simulação: nada gravado)', [cfgFile, cfg.port, cfg.permissionTimeoutS]));
    else {
      try {
        if (writeHookConfig(home, cfg)) out(tr('✓ configuração do hook gravada em {0} (porta {1}, espera {2} s)', [cfgFile, cfg.port, cfg.permissionTimeoutS]));
        else out(tr('= configuração do hook ({0}): porta {1}, espera {2} s', [cfgFile, cfg.port, cfg.permissionTimeoutS]));
      } catch (err) {
        out(tr('✗ não consegui gravar {0} ({1}): o hook usa a porta {2} e espera {3} s', [cfgFile, (err as Error).message, DEFAULT_PORT, DEFAULT_WAIT_S]));
        failures++;
      }
    }
  }
  if (opts.command === 'status') {
    const cfg = readHookConfig(home);
    out(
      cfg
        ? tr('Configuração do hook ({0}): porta {1}, espera {2} s.', [cfgFile, cfg.port ?? DEFAULT_PORT, cfg.permissionTimeoutS ?? DEFAULT_WAIT_S])
        : tr('Configuração do hook ({0}): não existe (o hook usa HABBLAUD_PORT ou a porta {1} e espera {2} s).', [cfgFile, DEFAULT_PORT, DEFAULT_WAIT_S]),
    );
    const port = cfg?.port ?? opts.port;
    const health = await (ctx.health ?? fetchHealth)(port);
    if (!health) out(tr('Habblaud em http://127.0.0.1:{0}: fora do ar (com ele parado, os hooks saem na hora e o Codex segue normal).', [port]));
    else {
      const events = health.codexEvents ? tr('recebendo os eventos do Codex') : tr('no ar, mas sem a fonte do Codex (os eventos são ignorados)');
      const perms = health.permissions ? tr('aprovar pelo escritório ligado (com alguma página aberta)') : tr('aprovar pelo escritório desligado (porta exposta na rede ou HABBLAUD_TERMINAL=0)');
      out(tr('Habblaud em http://127.0.0.1:{0}: {1}; {2}.', [port, events, perms]));
    }
    out(tr('Confiança: o Codex só roda um hook novo ou alterado depois que você o aprova; confira em /hooks dentro do Codex.'));
  }
  if (opts.command === 'install' && opts.account && !opts.dryRun) {
    // A espera fica num arquivo só, mas o timeout do PermissionRequest fica em cada hooks.json: as outras pastas com o
    // Habblaud e outra espera cortariam o hook antes da hora.
    const behind = found.dirs.filter((d) => {
      if (dirs.includes(d)) return false;
      const r = readSettings(join(d, 'hooks.json'));
      return !('error' in r) && installState(r.settings, command, opts.waitS).outdated.includes('PermissionRequest');
    });
    if (behind.length) {
      out(tr('! {0}: o Habblaud está lá com outra espera; rode npm run codex:install sem --conta para alinhar.', [behind.map((d) => basename(d)).join(', ')]));
    }
  }
  if (opts.command === 'install' && approve.size && !opts.dryRun) {
    out('');
    out(tr('Pronto. Falta um passo: abra o Codex e aprove os hooks do Habblaud em /hooks (o Codex só roda hook novo'));
    out(tr('ou alterado depois que você aprova). Com o Habblaud aberto no navegador, as sessões do Codex aparecem no'));
    out(tr('escritório e os pedidos de aprovação esperam sua resposta lá por até {0} s antes de irem para o terminal.', [opts.waitS]));
    if (approve.has('PermissionRequest') && approve.size < EVENTS.length) {
      out(tr('(A espera ou o caminho do Habblaud mudou: aprove de novo os hooks alterados em /hooks.)'));
    }
    out(tr('Para desfazer: npm run codex:uninstall'));
  }
  if (opts.command === 'uninstall' && changed) out(tr('A configuração em ~/.habblaud/codex-hook.json fica (só o hook a lê).'));
  return failures ? 1 : 0;
}

/** Versão de um Node: o do shell de login do Codex (`$SHELL -lc`, bin ausente) ou de um caminho. Falha = undefined. */
function probeNode(bin: string | undefined): string | undefined {
  try {
    const opts = { encoding: 'utf8' as const, timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] as ['ignore', 'pipe', 'ignore'] };
    const out = bin ? execFileSync(bin, ['--version'], opts) : execFileSync(process.env.SHELL || '/bin/sh', ['-lc', 'node --version'], opts);
    return out.trim().split('\n').pop();
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed === 'help') {
    console.log(USAGE);
    return;
  }
  const home = process.env.HOME || homedir();
  process.exitCode = await run(parsed, {
    env: process.env,
    home,
    now: new Date(),
    hookPath: HOOK_SCRIPT,
    out: (l) => console.log(l),
    nodeProbe: probeNode,
    nodeCandidates: ['/opt/homebrew/bin/node', '/usr/local/bin/node', process.execPath],
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof FatalError ? tr('[codex] Erro: {0}', [err.message]) : tr('[codex] Erro inesperado: {0}', [String(err)]));
    process.exitCode = 1;
  });
}
