// Instala (ou remove) o mod do Habblaud no Claude Code de cada conta. Roda no HOST, com tsx:
//
//   npm run mod:install      # marketplace "habblaud" (esta pasta) + plugins habblaud, habblaud-permissoes e
//                            # habblaud-mensagens
//   npm run mod:uninstall    # tira os três plugins e o marketplace de cada conta
//   npm run mod:status       # por conta: marketplace, plugins (e versões) e restos do jeito antigo
//   (opções: --sem-permissoes, --sem-mensagens, --conta <pasta>, --dry-run, --claude <comando>)
//
// Tudo passa pelo CLI do próprio Claude Code (`claude plugin ...`), rodado uma vez por conta com o
// CLAUDE_CONFIG_DIR daquela conta, como faz o atalho do shell (`alias d='CLAUDE_CONFIG_DIR=... claude'`). Assim
// quem grava os registros (enabledPlugins e extraKnownMarketplaces no settings.json, <conta>/plugins/*.json) é o
// Claude Code, no formato que ele conhece: este script não edita esses campos.
//
// O marketplace é ESTA pasta (.claude-plugin/marketplace.json na raiz do repositório), adicionado como diretório
// local: o Claude Code carrega os plugins direto das pastas em mod/, sem copiar. Depois de um `git pull`, sessões
// novas (ou /reload-plugins) já rodam o código novo; o `claude plugin update` acerta a versão registrada (o
// `npm run docker:up` faz isso sozinho para quem já instalou).
//
// Mensagens pelo escritório (habblaud-mensagens, o plugin que digita na sessão em seu nome): vai junto por padrão;
// com --sem-mensagens fica de fora, e um já instalado continua (como o de permissões com --sem-permissoes). O
// docker:up nunca o instala sozinho: numa conta com o mod e sem ele, só dá a dica de rodar o mod:install.
//
// Migração do jeito antigo: o mod grava o uso no mesmo arquivo do tap de statusline (usage:install) e o plugin
// de permissões faz o mesmo que o settings hook PermissionRequest (hooks:install). Na instalação, cada um sai do
// settings.json da conta (com backup), pelas funções dos instaladores antigos, para não ficarem dois capturando
// o uso nem dois respondendo o mesmo pedido. Com --sem-permissoes, o hook antigo fica como está.
//
// Nome antigo (CodeTown, até a 0.3.2): o install tira os plugins codetown e codetown-permissoes e o marketplace
// codetown (esta mesma pasta, com o nome que o manifesto não tem mais) ANTES de adicionar o habblaud, e leva
// ~/.codetown para ~/.habblaud. O uninstall também os tira, o status os mostra e o docker:up só avisa.
//
// Status (e o plano de cada conta): vem de `claude plugin list --json` e `claude plugin marketplace list --json`,
// saídas documentadas que já resolvem escopo, ligado/desligado e CLAUDE_CODE_PLUGIN_CACHE_DIR. Os arquivos
// <conta>/plugins/installed_plugins.json e known_marketplaces.json são internos do Claude Code e podem mudar de
// formato (o primeiro já está na versão 2).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { discoverClaudeDirs, expandHome, isDefaultDir } from '../server/accounts/detect';
import { LEGACY_NAME } from '../server/legacy';
import { DEFAULT_PORT, installedHook, planUninstall as planHookUninstall } from './hooks-install';
import {
  formatAge,
  isTapCommand,
  migrateLegacyState,
  planUninstall as planTapUninstall,
  readSettings,
  tildify,
  usageDirOf,
  writeSettings,
  type Settings,
} from './statusline-install';
import { tr } from '../shared/i18n';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Nome do marketplace em .claude-plugin/marketplace.json (contrato com mod/). */
export const MARKETPLACE = 'habblaud';
/** O mod: uso do plano, aviso de "precisa de você" no terminal e /habblaud. */
export const MOD_PLUGIN = `habblaud@${MARKETPLACE}`;
/** O settings hook PermissionRequest de responder pelo escritório, empacotado como plugin. */
export const PERMISSIONS_PLUGIN = `habblaud-permissoes@${MARKETPLACE}`;
/** Mandar mensagens pelo escritório: leva para a sessão, como suas, as mensagens digitadas no Habblaud. */
export const MESSAGES_PLUGIN = `habblaud-mensagens@${MARKETPLACE}`;
/** Os plugins do Habblaud, na ordem da saída (status, remoção, atualização). */
export const PLUGINS = [MOD_PLUGIN, PERMISSIONS_PLUGIN, MESSAGES_PLUGIN] as const;
/** Marketplace do nome antigo (CodeTown, até a 0.3.2): a mesma pasta, registrada com o nome que ela tinha. */
export const LEGACY_MARKETPLACE = LEGACY_NAME;
/** Os plugins que vinham dele (o mod e o de permissões, com o nome antigo). */
export const LEGACY_PLUGINS = [`${LEGACY_NAME}@${LEGACY_MARKETPLACE}`, `${LEGACY_NAME}-permissoes@${LEGACY_MARKETPLACE}`] as const;
/** Primeira versão do Claude Code (terminal) que carrega mods. */
export const MIN_CLAUDE_VERSION = '2.1.287';
/** Os plugins vão sempre para o escopo do usuário: valem em todos os projetos da conta. */
const SCOPE = 'user';
/** Tempo máximo de cada chamada ao CLI (o add/update de um diretório local leva poucos segundos). */
const CLI_TIMEOUT_MS = 120_000;

const USAGE = tr('Uso: npm run mod:<install|uninstall|status> [-- opções]\n\n  install     instala o mod do Habblaud no Claude Code de cada conta (marketplace desta pasta + plugins)\n              e tira o que ele substitui: o tap de statusline e o hook de permissão antigos e o mod do\n              nome antigo (codetown)\n  uninstall   tira os plugins e o marketplace do Habblaud de cada conta (e os do nome antigo, se sobraram)\n  status      mostra, por conta, o marketplace, os plugins (e versões) e o que sobrou do jeito antigo\n\nOpções:\n  --sem-permissoes   não instala o plugin de responder permissões pelo escritório (e mantém o hook antigo)\n  --sem-mensagens    não instala o plugin de mandar mensagens pelo escritório (um já instalado continua)\n  --conta <pasta>    só esta conta (ex.: --conta ~/.claude-conta2); pode repetir\n  --dry-run          mostra o que faria, sem instalar nem gravar nada\n  --claude <cmd>     comando do Claude Code (padrão: claude, do PATH)\n  -h, --help         mostra esta ajuda\n\nPrecisa do Claude Code {0} ou mais novo. Em versões anteriores, use o jeito antigo:\nnpm run usage:install (uso ao vivo) e npm run hooks:install (responder permissões); mandar mensagens pelo\nescritório só existe com o mod.\n\nContas: as mesmas do servidor (~/.claude* com projects/ ou sessions/, CLAUDE_CONFIG_DIR ou\nHABBLAUD_CLAUDE_DIRS). Uso capturado em HABBLAUD_USAGE_DIR (padrão ~/.habblaud/usage).', [MIN_CLAUDE_VERSION]);

// ---------------------------------------------------------------------------------------------
// O CLI do Claude Code (injetável: os testes nunca chamam o de verdade)
// ---------------------------------------------------------------------------------------------

export interface ClaudeResult {
  /** Código de saída (null se nem chegou a rodar ou foi morto). */
  code: number | null;
  stdout: string;
  stderr: string;
  /** Falha ao iniciar o processo (ex.: `claude` fora do PATH). */
  error?: string;
}

/** Roda `claude <args>` com o ambiente dado (o CLAUDE_CONFIG_DIR da conta vem nele). */
export type ClaudeRunner = (args: string[], env: NodeJS.ProcessEnv) => ClaudeResult;

/** O runner de verdade. stdin fechado: nada fica esperando uma resposta no terminal. */
export function makeClaudeRunner(cmd = 'claude'): ClaudeRunner {
  return (args, env) => {
    const r = spawnSync(cmd, args, { env, encoding: 'utf8', timeout: CLI_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] });
    if (r.error) {
      const code = (r.error as NodeJS.ErrnoException).code;
      const error = code === 'ENOENT' ? tr('o comando "{0}" não foi encontrado no PATH', [cmd]) : code === 'ETIMEDOUT' ? tr('"{0} {1}" não terminou em {2} s', [cmd, args.join(' '), CLI_TIMEOUT_MS / 1000]) : r.error.message;
      return { code: null, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error };
    }
    return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
}

/**
 * Ambiente do CLI para uma conta. A conta padrão (~/.claude) roda SEM CLAUDE_CONFIG_DIR, como o `claude` puro:
 * com a variável apontando para ~/.claude, o Claude Code passaria a usar ~/.claude/.claude.json em vez de
 * ~/.claude.json. E a variável herdada (ex.: rodando de dentro de uma sessão da outra conta) nunca vaza.
 */
export function accountEnv(env: NodeJS.ProcessEnv, dir: string, home: string): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  if (isDefaultDir(dir, home)) delete out.CLAUDE_CONFIG_DIR;
  else out.CLAUDE_CONFIG_DIR = dir;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Funções puras (testadas em server/test/mod-install.test.ts)
// ---------------------------------------------------------------------------------------------

type Rec = Record<string, unknown>;

function rec(v: unknown): Rec | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined;
}

/** "2.1.293 (Claude Code)" → [2, 1, 293]. */
export function parseVersion(text: string): [number, number, number] | undefined {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

export function versionAtLeast(version: string, min: string): boolean {
  const a = parseVersion(version);
  const b = parseVersion(min);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

/** Sem códigos de cor do terminal. */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
}

/**
 * JSON da saída do CLI, com tolerância: a saída inteira, ou a partir da primeira linha que abre um JSON (avisos
 * antes dele), ou só a última linha (formato de resultado do `--json` das ações). undefined se nada servir.
 */
export function parseJsonOutput(stdout: string): unknown {
  const text = stripAnsi(stdout).trim();
  if (!text) return undefined;
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s) as unknown;
    } catch {
      return undefined;
    }
  };
  const whole = tryParse(text);
  if (whole !== undefined) return whole;
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s*[[{]/.test(l));
  if (start > 0) {
    const fromStart = tryParse(lines.slice(start).join('\n'));
    if (fromStart !== undefined) return fromStart;
  }
  return tryParse(lines[lines.length - 1]);
}

/** Uma instalação de plugin, como `claude plugin list --json` mostra (só o que usamos). */
export interface PluginInfo {
  id: string;
  version?: string;
  scope?: string;
  enabled: boolean;
  /** Pasta de onde carrega, quando lido no lugar a partir de um marketplace local (Claude Code 2.1.289+). */
  readFromFolder?: string;
  /** Versão do manifesto nessa pasta (pode ser mais nova que a registrada). */
  folderVersion?: string;
  errors: string[];
}

/** Lista de plugins instalados; aceita o array ou o objeto de `--available` ({installed: [...]}). */
export function parsePluginList(stdout: string): PluginInfo[] | undefined {
  const raw = parseJsonOutput(stdout);
  const list = Array.isArray(raw) ? raw : rec(raw) && Array.isArray(rec(raw)!.installed) ? (rec(raw)!.installed as unknown[]) : undefined;
  if (!list) return undefined;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const out: PluginInfo[] = [];
  for (const item of list) {
    const r = rec(item);
    const id = str(r?.id);
    if (!r || !id) continue;
    out.push({
      id,
      version: str(r.version),
      scope: str(r.scope),
      enabled: r.enabled !== false,
      readFromFolder: str(r.readFromFolder),
      folderVersion: str(r.folderVersion),
      errors: Array.isArray(r.errors) ? r.errors.filter((e): e is string => typeof e === 'string') : [],
    });
  }
  return out;
}

export interface MarketplaceInfo {
  name: string;
  source?: string;
  /** Pasta (marketplaces de diretório ou arquivo local). */
  path?: string;
}

export function parseMarketplaceList(stdout: string): MarketplaceInfo[] | undefined {
  const raw = parseJsonOutput(stdout);
  if (!Array.isArray(raw)) return undefined;
  const out: MarketplaceInfo[] = [];
  for (const item of raw) {
    const r = rec(item);
    if (!r || typeof r.name !== 'string') continue;
    const m: MarketplaceInfo = { name: r.name };
    if (typeof r.source === 'string') m.source = r.source;
    const path = typeof r.path === 'string' ? r.path : typeof r.installLocation === 'string' && r.source === 'directory' ? r.installLocation : undefined;
    if (path) m.path = path;
    out.push(m);
  }
  return out;
}

/** O que uma conta tem do Habblaud no Claude Code. */
export interface AccountState {
  marketplace?: MarketplaceInfo;
  /** O marketplace do nome antigo (codetown), se ainda estiver registrado. */
  legacyMarketplace?: MarketplaceInfo;
  plugins: PluginInfo[];
}

/** A instalação de `id` no escopo do usuário (o único que este script gerencia). */
export function userInstall(state: AccountState, id: string): PluginInfo | undefined {
  return state.plugins.find((p) => p.id === id && (p.scope === SCOPE || p.scope === undefined));
}

/** Plugins do nome antigo no escopo do usuário (onde o mod:install da 0.3 os pôs). */
export function legacyPlugins(state: AccountState): PluginInfo[] {
  return LEGACY_PLUGINS.map((id) => userInstall(state, id)).filter((p): p is PluginInfo => !!p);
}

/**
 * Os restos do nome antigo numa frase ("marketplace codetown, codetown@codetown 0.3.2"), ou undefined se não
 * sobrou nada. `where` descreve a pasta do marketplace (o status diz se é esta).
 */
export function legacySummary(state: AccountState, where?: (m: MarketplaceInfo) => string): string | undefined {
  const parts = legacyPlugins(state).map((p) => `${p.id}${p.version ? ` ${p.version}` : ''}`);
  const m = state.legacyMarketplace;
  if (m) parts.unshift(`marketplace ${LEGACY_MARKETPLACE}${where ? ` (${where(m)})` : ''}`);
  return parts.length ? parts.join(', ') : undefined;
}

/** Uma chamada ao CLI, com a frase que conta o que ela faz. */
export interface CliStep {
  args: string[];
  /** "habblaud: instalado" (vira ✓, ~ ou ✗ na saída). */
  message: string;
  /** Plugin que depende deste passo (falhou = não conta como instalado). */
  plugin?: string;
  /** Se falhar, os passos seguintes da instalação rodam assim mesmo (a falha ainda conta no fim). */
  keepGoing?: boolean;
}

/** Item do plano, na ordem da saída: uma chamada ao CLI ou algo que já está certo (vira "="). */
export type PlanItem = CliStep | { unchanged: string };

export interface InstallPlan {
  items: PlanItem[];
  /** Avisos que não impedem a instalação. */
  notes: string[];
  /** Plugins que ficam instalados se todos os passos derem certo. */
  plugins: string[];
}

/** Só as chamadas ao CLI de um plano. */
export function cliSteps(plan: InstallPlan): CliStep[] {
  return plan.items.filter((i): i is CliStep => 'args' in i);
}

export interface PlanOptions {
  /** Raiz do repositório (onde está .claude-plugin/marketplace.json). */
  root: string;
  /** Versão do package.json (= versão dos plugins). */
  version: string;
  /** Instalar também o plugin de permissões. */
  permissions: boolean;
  /** Instalar também o plugin de mensagens. */
  messages: boolean;
  /** Compara pastas (padrão: caminho real). */
  sameDir?: (a: string, b: string) => boolean;
}

/** Mesma pasta, resolvendo symlinks quando der. */
export function sameDir(a: string, b: string): boolean {
  if (resolve(a) === resolve(b)) return true;
  const real = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  return real(a) === real(b);
}

const shortName = (id: string) => id.split('@')[0];

/**
 * Passos que tiram os restos do nome antigo: os plugins (escopo do usuário) e depois o marketplace. Um plugin
 * que não sair não segura os passos seguintes: tirar o marketplace leva junto o que veio dele.
 */
function legacySteps(state: AccountState): CliStep[] {
  const steps: CliStep[] = legacyPlugins(state).map((p) => ({
    args: ['plugin', 'uninstall', p.id, '--scope', SCOPE],
    message: tr('{0} (nome antigo): removido', [shortName(p.id)]),
    keepGoing: true,
  }));
  if (state.legacyMarketplace) {
    steps.push({ args: ['plugin', 'marketplace', 'remove', LEGACY_MARKETPLACE], message: tr('marketplace {0} (nome antigo): removido', [LEGACY_MARKETPLACE]) });
  }
  return steps;
}

/**
 * Passos de instalação de uma conta, a partir do que ela já tem. Os restos do nome antigo saem primeiro. O
 * marketplace é adicionado (ou, se já existe, tem o catálogo relido; se apontava para outra pasta, passa a
 * apontar para esta). Cada plugin é instalado, religado (se estava desligado) ou atualizado (se a versão
 * registrada difere da do package.json).
 */
export function planInstall(state: AccountState, o: PlanOptions): InstallPlan {
  const same = o.sameDir ?? sameDir;
  const plan: InstallPlan = { items: [], notes: [], plugins: [] };
  // O marketplace codetown aponta para esta mesma pasta: ele sai antes de o habblaud entrar, para nunca ficarem
  // dois nomes registrados para a mesma pasta (um deles que o manifesto não tem mais).
  plan.items.push(...legacySteps(state));
  const m = state.marketplace;
  if (!m) {
    plan.items.push({ args: ['plugin', 'marketplace', 'add', o.root], message: tr('marketplace {0}: adicionado (esta pasta)', [MARKETPLACE]) });
  } else if (m.path && same(m.path, o.root)) {
    plan.items.push({ args: ['plugin', 'marketplace', 'update', MARKETPLACE], message: tr('marketplace {0}: catálogo relido desta pasta', [MARKETPLACE]) });
  } else {
    // Outra pasta (o Habblaud mudou de lugar) ou outra origem: o add com a mesma chave só troca a origem e
    // mantém os plugins instalados.
    plan.items.push({
      args: ['plugin', 'marketplace', 'add', o.root],
      message: tr('marketplace {0}: passou a apontar para esta pasta (antes: {1})', [MARKETPLACE, m.path ?? m.source ?? tr('outra origem')]),
    });
  }
  const wanted = [MOD_PLUGIN, ...(o.permissions ? [PERMISSIONS_PLUGIN] : []), ...(o.messages ? [MESSAGES_PLUGIN] : [])];
  for (const id of wanted) {
    const name = shortName(id);
    const cur = userInstall(state, id);
    if (!cur) {
      plan.items.push({ args: ['plugin', 'install', id, '--scope', SCOPE], message: tr('{0}: instalado', [name]), plugin: id });
      plan.plugins.push(id);
      continue;
    }
    plan.plugins.push(id);
    let touched = false;
    if (!cur.enabled) {
      plan.items.push({ args: ['plugin', 'enable', id, '--scope', SCOPE], message: tr('{0}: religado (estava desligado)', [name]), plugin: id });
      touched = true;
    }
    if (cur.version !== o.version) {
      plan.items.push({ args: ['plugin', 'update', id, '--scope', SCOPE], message: tr('{0}: atualizado de {1} para {2}', [name, cur.version ?? '?', o.version]), plugin: id });
      touched = true;
    }
    if (!touched) plan.items.push({ unchanged: tr('{0}: já instalado na versão {1}', [name, o.version]) });
  }
  // Com --sem-permissoes (ou --sem-mensagens), um plugin desses já instalado continua (e acompanha a versão do mod).
  const left: Array<[id: string, flag: string]> = [];
  if (!o.permissions) left.push([PERMISSIONS_PLUGIN, '--sem-permissoes']);
  if (!o.messages) left.push([MESSAGES_PLUGIN, '--sem-mensagens']);
  for (const [id, flag] of left) {
    const cur = userInstall(state, id);
    if (!cur) continue;
    if (cur.version !== o.version) {
      plan.items.push({ args: ['plugin', 'update', id, '--scope', SCOPE], message: tr('{0}: atualizado de {1} para {2}', [shortName(id), cur.version ?? '?', o.version]), plugin: id });
    }
    plan.plugins.push(id);
    plan.notes.push(tr('{0} já estava instalado e continua ({1} não o remove; para tirar: claude plugin uninstall {2})', [shortName(id), flag, id]));
  }
  return plan;
}

/**
 * Passos de remoção: os restos do nome antigo (se houver), os plugins do escopo do usuário e o marketplace, só o
 * que existir. (Tirar o marketplace já desinstalaria o que veio dele, mas um passo por plugin deixa claro, na
 * saída, o que saiu.)
 */
export function planUninstall(state: AccountState): InstallPlan {
  const plan: InstallPlan = { items: [...legacySteps(state)], notes: [], plugins: [] };
  for (const id of PLUGINS) {
    const name = shortName(id);
    if (userInstall(state, id)) plan.items.push({ args: ['plugin', 'uninstall', id, '--scope', SCOPE], message: tr('{0}: removido', [name]), plugin: id });
    else plan.items.push({ unchanged: tr('{0}: não estava instalado', [name]) });
  }
  if (state.marketplace) plan.items.push({ args: ['plugin', 'marketplace', 'remove', MARKETPLACE], message: tr('marketplace {0}: removido', [MARKETPLACE]) });
  else plan.items.push({ unchanged: tr('marketplace {0}: não estava adicionado', [MARKETPLACE]) });
  return plan;
}

export interface MigrationPlan {
  /** settings.json novo, se algo mudou. */
  settings?: Settings;
  /** O que foi tirado (vira ✓). */
  done: string[];
  /** O que ficou e por quê (vira "="). */
  kept: string[];
  /** Formatos que não dá para mexer com segurança (vira "!"). */
  warnings: string[];
}

/**
 * Tira do settings.json o que o mod substitui: o tap de statusline (se o mod ficou instalado) e o hook de
 * permissão antigo (se o plugin de permissões ficou instalado). Uma gravação só, para um backup só.
 */
export function planMigration(settings: Settings, o: { modInstalled: boolean; permissionsInstalled: boolean; permissions: boolean }): MigrationPlan {
  const out: MigrationPlan = { done: [], kept: [], warnings: [] };
  let next = settings;
  const sl = rec(settings.statusLine);
  if (sl && isTapCommand(sl.command)) {
    if (!o.modInstalled) out.kept.push(tr('tap de statusline antigo mantido (o mod não ficou instalado)'));
    else {
      const p = planTapUninstall(next);
      if (p.action === 'uninstall') {
        next = p.settings;
        out.done.push(tr('tap de statusline antigo removido: o mod grava o uso no lugar dele ({0})', [p.message]));
      } else if (p.action === 'skip') out.warnings.push(tr('tap de statusline antigo: {0} (rode npm run usage:uninstall depois de conferir)', [p.message]));
    }
  }
  if (installedHook(next)) {
    if (!o.permissions) out.kept.push(tr('hook de permissão antigo mantido (--sem-permissoes)'));
    else if (!o.permissionsInstalled) out.kept.push(tr('hook de permissão antigo mantido (o plugin de permissões não ficou instalado)'));
    else {
      const p = planHookUninstall(next);
      if (p.action === 'uninstall') {
        next = p.settings;
        out.done.push(tr('hook de permissão antigo removido: o plugin {0} responde no lugar dele', [shortName(PERMISSIONS_PLUGIN)]));
      } else if (p.action === 'skip') out.warnings.push(tr('hook de permissão antigo: {0} (rode npm run hooks:uninstall depois de conferir)', [p.message]));
    }
  }
  if (next !== settings) out.settings = next;
  return out;
}

/** Diferenças entre o que deveria ter ficado instalado e o que o Claude Code registra depois dos passos. */
export function verifyInstall(after: AccountState, plugins: string[], version: string): string[] {
  const out: string[] = [];
  for (const id of plugins) {
    const p = userInstall(after, id);
    const name = shortName(id);
    if (!p) out.push(tr('{0}: não aparece instalado na lista do Claude Code', [name]));
    else if (!p.enabled) out.push(tr('{0}: instalado, mas desligado (claude plugin enable {1})', [name, id]));
    else if (p.version !== version) out.push(tr('{0}: o Claude Code registra a versão {1}, não a {2} (o manifesto em mod/ está com outra versão?)', [name, p.version ?? '?', version]));
    if (p?.errors.length) out.push(`${name}: ${p.errors.join('; ')}`);
  }
  return out;
}

/**
 * Para o docker:up: atualiza só o que já está instalado, nunca instala. `hint` é a dica para quem tem o mod e não o
 * plugin de mensagens (que veio depois): o docker:up não o instala sozinho.
 */
export type UpdatePlan =
  | { action: 'none'; installed: boolean; hint?: string }
  | { action: 'update'; steps: CliStep[]; hint?: string }
  | { action: 'warn'; message: string };

/** A dica do plugin de mensagens, quando a conta tem o mod e não ele. */
export const MESSAGES_HINT = tr('rode npm run mod:install para mandar mensagens pelo escritório (plugin {0})', [shortName(MESSAGES_PLUGIN)]);

export function planUpdate(state: AccountState, o: { root: string; version: string; sameDir?: (a: string, b: string) => boolean }): UpdatePlan {
  const same = o.sameDir ?? sameDir;
  // Nome antigo: a troca (tirar o codetown, instalar o habblaud) é do mod:install; aqui só o aviso. Um aviso conta
  // como "instalado", então a dica de instalar do zero não aparece para quem já usava o mod.
  const legacy = legacySummary(state);
  if (legacy) return { action: 'warn', message: tr('ainda com o nome antigo ({0}); o docker:up não troca sozinho: rode npm run mod:install', [legacy]) };
  const installed = PLUGINS.map((id) => userInstall(state, id)).filter((p): p is PluginInfo => !!p);
  if (!installed.length) return { action: 'none', installed: false };
  const hint = userInstall(state, MOD_PLUGIN) && !userInstall(state, MESSAGES_PLUGIN) ? { hint: MESSAGES_HINT } : {};
  const stale = installed.filter((p) => p.version !== o.version);
  if (!stale.length) return { action: 'none', installed: true, ...hint };
  // Marketplace de outra pasta (outro clone, pasta movida): atualizar dali não traria esta versão.
  const m = state.marketplace;
  if (!m) return { action: 'warn', message: tr('o mod está instalado, mas o marketplace {0} sumiu; rode npm run mod:install', [MARKETPLACE]) };
  if (!m.path || !same(m.path, o.root)) {
    return { action: 'warn', message: tr('o mod vem de outra pasta ({0}), então não foi atualizado; para usar esta: npm run mod:install', [m.path ?? m.source ?? '?']) };
  }
  return {
    action: 'update',
    steps: [
      { args: ['plugin', 'marketplace', 'update', MARKETPLACE], message: tr('marketplace {0}: catálogo relido', [MARKETPLACE]) },
      ...stale.map((p) => ({ args: ['plugin', 'update', p.id, '--scope', SCOPE], message: `${shortName(p.id)}: ${p.version ?? '?'} → ${o.version}`, plugin: p.id })),
    ],
    ...hint,
  };
}

/** Últimas linhas úteis da saída do CLI (para explicar uma falha). */
export function cliMessage(r: ClaudeResult): string {
  if (r.error) return r.error;
  const lines = stripAnsi(`${r.stdout}\n${r.stderr}`)
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s✘✔✗✓×]+/, '').trim())
    .filter(Boolean);
  return lines.slice(-2).join(' · ') || tr('saiu com código {0}', [r.code ?? '?']);
}

/** Linhas do status de uma conta (sem o cabeçalho). */
export function describeStatus(state: AccountState, settings: Settings, o: { root: string; version: string; home: string; sameDir?: (a: string, b: string) => boolean }): string[] {
  const same = o.sameDir ?? sameDir;
  const lines: string[] = [];
  const m = state.marketplace;
  if (!m) lines.push(tr('marketplace {0}: não adicionado', [MARKETPLACE]));
  else if (m.path && same(m.path, o.root)) lines.push(tr('marketplace {0}: esta pasta', [MARKETPLACE]));
  else lines.push(tr('marketplace {0}: outra origem ({1}); npm run mod:install aponta para esta pasta', [MARKETPLACE, m.path ? tildify(m.path, o.home) : (m.source ?? '?')]));
  for (const id of PLUGINS) {
    const name = shortName(id);
    const all = state.plugins.filter((p) => p.id === id);
    if (!all.length) {
      lines.push(tr('{0}: não instalado', [name]));
      continue;
    }
    for (const p of all) {
      const parts = [tr('instalado{0}', [p.scope && p.scope !== SCOPE ? tr(' (escopo {0})', [p.scope]) : '']), p.enabled ? tr('ligado') : tr('desligado')];
      parts.push(tr('versão {0}{1}', [p.version ?? '?', p.version === o.version ? '' : tr(' (esta pasta: {0}; npm run mod:install ou npm run docker:up atualiza)', [o.version])]));
      if (p.folderVersion && p.folderVersion !== p.version) parts.push(tr('carrega {0} de {1}', [p.folderVersion, tildify(p.readFromFolder ?? '?', o.home)]));
      if (p.errors.length) parts.push(`erro: ${p.errors.join('; ')}`);
      lines.push(`${name}: ${parts.join(', ')}`);
    }
  }
  const legacy = legacySummary(state, (lm) => (lm.path && same(lm.path, o.root) ? tr('esta pasta') : lm.path ? tildify(lm.path, o.home) : (lm.source ?? '?')));
  if (legacy) lines.push(tr('! nome antigo ainda registrado: {0}; npm run mod:install troca pelo habblaud', [legacy]));
  const sl = rec(settings.statusLine);
  const hook = installedHook(settings);
  const modOn = !!userInstall(state, MOD_PLUGIN);
  const permOn = !!userInstall(state, PERMISSIONS_PLUGIN);
  if (sl && isTapCommand(sl.command)) {
    lines.push(
      modOn
        ? tr('! tap de statusline antigo ainda instalado junto com o mod: npm run mod:install tira (ou npm run usage:uninstall)')
        : tr('tap de statusline antigo instalado (jeito antigo; o mod o substitui)'),
    );
  }
  if (hook) {
    lines.push(
      permOn
        ? tr('! hook de permissão antigo ainda no settings.json junto com o plugin: os dois respondem; npm run mod:install tira (ou npm run hooks:uninstall)')
        : tr('hook de permissão antigo instalado (jeito antigo; o plugin de permissões o substitui)'),
    );
  }
  if (settings.disableAllHooks === true) lines.push(tr('! disableAllHooks está ligado no settings.json desta conta: nenhum mod (nem hook) roda'));
  return lines;
}

// ---------------------------------------------------------------------------------------------
// Efeitos (CLI do Claude Code e settings.json)
// ---------------------------------------------------------------------------------------------

export interface RunOptions {
  command: 'install' | 'uninstall' | 'status';
  dryRun: boolean;
  /** false com --sem-permissoes. */
  permissions: boolean;
  /** false com --sem-mensagens. */
  messages: boolean;
  /** --conta (vazio = todas as detectadas). */
  accounts: string[];
  claudeCmd?: string;
}

export interface RunContext {
  env: NodeJS.ProcessEnv;
  home: string;
  now: Date;
  /** Raiz do repositório (o marketplace). */
  root: string;
  /** Versão do package.json. */
  version: string;
  claude: ClaudeRunner;
  out: (line: string) => void;
  /** Consulta o /api/health do Habblaud no status (testes injetam um falso). */
  health?: (port: number) => Promise<HealthInfo | undefined>;
}

/** O que o status usa do /api/health (`messages` só existe a partir do Habblaud com mensagens pelo escritório). */
export interface HealthInfo {
  permissions?: boolean;
  messages?: boolean;
}

class FatalError extends Error {}

async function fetchHealth(port: number): Promise<HealthInfo | undefined> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1_500) });
    if (!res.ok) return undefined;
    return (await res.json()) as HealthInfo;
  } catch {
    return undefined;
  }
}

/** Porta do Habblaud (HABBLAUD_PORT ou a padrão). */
function habblaudPort(env: NodeJS.ProcessEnv): number {
  const p = Number.parseInt(env.HABBLAUD_PORT ?? '', 10);
  return Number.isInteger(p) && p > 0 && p < 65_536 ? p : DEFAULT_PORT;
}

export function parseArgs(argv: string[]): RunOptions | 'help' {
  let command: RunOptions['command'] | undefined;
  let dryRun = false;
  let permissions = true;
  let messages = true;
  let claudeCmd: string | undefined;
  const accounts: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') return 'help';
    if (a === '--dry-run') dryRun = true;
    else if (a === '--sem-permissoes') permissions = false;
    else if (a === '--sem-mensagens') messages = false;
    else if (a === '--conta') {
      const dir = argv[++i];
      if (!dir) throw new FatalError(tr('--conta precisa da pasta da conta (ex.: --conta ~/.claude-conta2).'));
      accounts.push(dir);
    } else if (a === '--claude') {
      claudeCmd = argv[++i];
      if (!claudeCmd) throw new FatalError(tr('--claude precisa de um comando ou caminho.'));
    } else if ((a === 'install' || a === 'uninstall' || a === 'status') && !command) command = a;
    else throw new FatalError(tr('opção desconhecida: {0}\n\n{1}', [a, USAGE]));
  }
  if (!command) throw new FatalError(tr('diga o que fazer: install, uninstall ou status.\n\n{0}', [USAGE]));
  return { command, dryRun, permissions, messages, accounts, claudeCmd };
}

/** Versão do package.json da raiz. */
export function readPackageVersion(root: string): string {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: unknown };
  if (typeof pkg.version !== 'string' || !pkg.version) throw new FatalError(tr('package.json sem "version" em {0}', [root]));
  return pkg.version;
}

/** Marketplace e plugins de uma conta, pelo CLI (ou o motivo de não conseguir). */
export function readAccountState(claude: ClaudeRunner, env: NodeJS.ProcessEnv): AccountState | { error: string } {
  const mr = claude(['plugin', 'marketplace', 'list', '--json'], env);
  if (mr.error || mr.code !== 0) return { error: tr('não consegui listar os marketplaces ({0})', [cliMessage(mr)]) };
  const markets = parseMarketplaceList(mr.stdout);
  if (!markets) return { error: tr('não entendi a lista de marketplaces do Claude Code') };
  const pr = claude(['plugin', 'list', '--json'], env);
  if (pr.error || pr.code !== 0) return { error: tr('não consegui listar os plugins ({0})', [cliMessage(pr)]) };
  const plugins = parsePluginList(pr.stdout);
  if (!plugins) return { error: tr('não entendi a lista de plugins do Claude Code') };
  return { marketplace: markets.find((m) => m.name === MARKETPLACE), legacyMarketplace: markets.find((m) => m.name === LEGACY_MARKETPLACE), plugins };
}

/** Pastas das contas: as de --conta (que precisam existir) ou as detectadas. */
function accountDirs(opts: RunOptions, env: NodeJS.ProcessEnv, home: string): string[] {
  if (!opts.accounts.length) return discoverClaudeDirs(env, home);
  return [...new Set(opts.accounts.map((a) => expandHome(a, home)))].map((dir) => {
    let ok = false;
    try {
      ok = statSync(dir).isDirectory();
    } catch {
      ok = false;
    }
    if (!ok) throw new FatalError(tr('--conta {0}: pasta não encontrada.', [dir]));
    return dir;
  });
}

/** Último uso capturado (pelo mod ou pelo tap) de uma conta, para o status. */
function lastCapture(dir: string, env: NodeJS.ProcessEnv, home: string, now: Date): string {
  const file = join(usageDirOf(env, home), `${basename(dir)}.json`);
  try {
    const j = JSON.parse(readFileSync(file, 'utf8')) as Rec;
    const at = typeof j.fetchedAt === 'number' ? j.fetchedAt : statSync(file).mtimeMs;
    return tr('último uso capturado há {0} ({1})', [formatAge(now.getTime() - at), j.source === 'mod' ? tr('pelo mod') : tr('pelo tap de statusline')]);
  } catch {
    return tr('nenhum uso capturado ainda (chega depois da próxima resposta numa sessão aberta desta conta)');
  }
}

/** Executa o comando para todas as contas. Devolve o código de saída. */
export async function run(opts: RunOptions, ctx: RunContext): Promise<number> {
  const { env, home, out } = ctx;
  const dirs = accountDirs(opts, env, home);
  if (!dirs.length) {
    out(tr('Nenhuma conta do Claude Code encontrada (~/.claude* com projects/ ou sessions/). Use --conta <pasta> ou HABBLAUD_CLAUDE_DIRS.'));
    return 1;
  }
  const manifest = join(ctx.root, '.claude-plugin', 'marketplace.json');
  if (opts.command === 'install' && !existsSync(manifest)) {
    out(tr('Não achei {0}: esta pasta não tem o mod (versão antiga do Habblaud? rode git pull).', [tildify(manifest, home)]));
    return 1;
  }

  // Uma versão só: todas as contas usam o mesmo executável, só muda o CLAUDE_CONFIG_DIR.
  const vr = ctx.claude(['--version'], env);
  if (vr.error) {
    out(tr('Não consegui rodar o Claude Code: {0}.', [vr.error]));
    out(tr('Instale o Claude Code (https://code.claude.com) ou diga onde ele está: npm run mod:<comando> -- --claude <caminho>'));
    return 1;
  }
  const cliVersion = parseVersion(vr.stdout) ? parseVersion(vr.stdout)!.join('.') : undefined;
  if (opts.command === 'install') {
    if (!cliVersion) out(tr('! Não entendi a versão do Claude Code ("{0}"); sigo assim mesmo.', [cliMessage(vr)]));
    else if (!versionAtLeast(cliVersion, MIN_CLAUDE_VERSION)) {
      out(tr('O mod precisa do Claude Code {0} ou mais novo, e este é o {1}.', [MIN_CLAUDE_VERSION, cliVersion]));
      out(tr('Atualize o Claude Code (claude update) e rode de novo. Ou use o jeito antigo, que funciona em versões anteriores:'));
      out(tr('  npm run usage:install    # uso de 5h/semanal ao vivo (tap de statusline)'));
      out(tr('  npm run hooks:install    # responder pedidos de permissão pelo escritório'));
      return 1;
    }
  }
  if (opts.command === 'status') {
    out(tr('Claude Code {0}{1} · Habblaud {2} em {3}', [cliVersion ?? tr('(versão desconhecida)'), cliVersion && !versionAtLeast(cliVersion, MIN_CLAUDE_VERSION) ? tr(' — o mod precisa do {0}+', [MIN_CLAUDE_VERSION]) : '', ctx.version, tildify(ctx.root, home)]));
  }

  // Nome antigo: ~/.codetown vira ~/.habblaud antes de criar (ou usar) a pasta do uso.
  if (opts.command === 'install') {
    const moved = migrateLegacyState(home, opts.dryRun);
    if (moved) out(moved);
  }
  // O mod grava o uso em ~/.habblaud/usage, mas não cria a pasta (o docker:up também a monta no container).
  if (opts.command === 'install' && !opts.dryRun) {
    const usageDir = usageDirOf(env, home);
    try {
      if (!existsSync(usageDir)) {
        mkdirSync(usageDir, { recursive: true, mode: 0o700 });
        out(tr('✓ pasta do uso criada: {0}', [tildify(usageDir, home)]));
      }
    } catch (err) {
      out(tr('! não consegui criar {0} ({1}); o uso ao vivo não vai ser gravado', [tildify(usageDir, home), (err as Error).message]));
    }
  }

  let failures = 0;
  let changed = 0;
  for (const dir of dirs) {
    const label = `${basename(dir)} (${tildify(dir, home)})`;
    const cenv = accountEnv(env, dir, home);
    const state = readAccountState(ctx.claude, cenv);
    const file = join(dir, 'settings.json');
    if (opts.command === 'status') {
      out(`• ${label}`);
      const read = readSettings(file);
      const settings = 'error' in read ? {} : read.settings;
      if ('error' in read) out(tr('    ✗ settings.json: {0}', [read.error]));
      if ('error' in state) {
        out(`    ✗ ${state.error}`);
        failures++;
      } else for (const l of describeStatus(state, settings, { root: ctx.root, version: ctx.version, home })) out(`    ${l}`);
      out(`    ${lastCapture(dir, env, home, ctx.now)}`);
      continue;
    }

    out(`${label}:`);
    if ('error' in state) {
      out(`  ✗ ${state.error}`);
      failures++;
      continue;
    }
    const plan =
      opts.command === 'install' ? planInstall(state, { root: ctx.root, version: ctx.version, permissions: opts.permissions, messages: opts.messages }) : planUninstall(state);
    const failed = new Set<string>();
    let broken = false;
    let stepFailed = false;
    for (const item of plan.items) {
      if (!('args' in item)) {
        out(`  = ${item.unchanged}`);
        continue;
      }
      if (opts.dryRun) {
        out(tr('  ~ {0} (simulação: claude {1})', [item.message, item.args.join(' ')]));
        continue;
      }
      // Na instalação, depois de uma falha os passos seguintes desta conta não rodam (sem marketplace não há
      // plugin), menos depois de um plugin do nome antigo que não saiu (o marketplace dele o leva junto). Na
      // remoção, segue: o que der para tirar, sai.
      if (broken && opts.command === 'install') {
        if (item.plugin) failed.add(item.plugin);
        continue;
      }
      const r = ctx.claude(item.args, cenv);
      if (!r.error && r.code === 0) {
        out(`  ✓ ${item.message}`);
        changed++;
      } else {
        out(tr('  ✗ {0}: falhou ({1})', [item.message.split(':')[0], cliMessage(r)]));
        if (item.plugin) failed.add(item.plugin);
        stepFailed = true;
        if (!item.keepGoing) broken = true;
      }
    }
    if (stepFailed) failures++;
    for (const n of plan.notes) out(`  ! ${n}`);
    if (opts.command !== 'install') continue;

    // Confere com o próprio Claude Code o que ficou instalado (um update sem efeito também sai com 0) e decide a
    // migração por isso. Na simulação (ou se a lista falhar), vale o plano menos o que deu erro.
    let ok = (id: string) => plan.plugins.includes(id) && !failed.has(id);
    if (!opts.dryRun) {
      const after = readAccountState(ctx.claude, cenv);
      if (!('error' in after)) {
        for (const w of verifyInstall(after, plan.plugins, ctx.version)) out(`  ! ${w}`);
        const legacy = legacySummary(after);
        if (legacy) out(tr('  ! nome antigo ainda registrado: {0}; rode npm run mod:install de novo (ou confira com npm run mod:status)', [legacy]));
        ok = (id: string) => userInstall(after, id)?.enabled === true;
      }
    }

    // Migração: lê o settings.json DEPOIS do CLI (ele também grava ali: enabledPlugins, marketplaces).
    const read = readSettings(file);
    if ('error' in read) {
      out(tr('  ✗ settings.json: {0}; o tap e o hook antigos não foram conferidos', [read.error]));
      failures++;
      continue;
    }
    const mig = planMigration(read.settings, { modInstalled: ok(MOD_PLUGIN), permissionsInstalled: ok(PERMISSIONS_PLUGIN), permissions: opts.permissions });
    for (const k of mig.kept) out(`  = ${k}`);
    for (const w of mig.warnings) out(`  ! ${w}`);
    if (read.settings.disableAllHooks === true) out(tr('  ! disableAllHooks está ligado no settings.json desta conta: o mod não roda até você desligar'));
    if (!mig.settings) continue;
    if (opts.dryRun) {
      for (const d of mig.done) out(tr('  ~ {0} (simulação: nada gravado)', [d]));
      continue;
    }
    try {
      const backup = writeSettings(file, mig.settings, read.raw, ctx.now);
      for (const d of mig.done) out(`  ✓ ${d}`);
      if (backup) out(tr('    backup do settings.json em {0}', [tildify(backup, home)]));
      changed++;
    } catch (err) {
      out(tr('  ✗ não consegui gravar o settings.json ({0}); o tap e o hook antigos continuam', [(err as Error).message]));
      failures++;
    }
  }

  if (opts.command === 'install' && !opts.dryRun && !failures) {
    out('');
    out(tr('Pronto. Sessões novas do Claude Code já carregam o mod; nas que já estão abertas, rode /reload-plugins (ou'));
    out(tr('reabra a sessão). O uso de 5h/semanal chega ao Habblaud depois da próxima resposta de cada sessão.'));
    out(tr('Para conferir: npm run mod:status · Para desfazer: npm run mod:uninstall'));
  }
  if (opts.command === 'uninstall' && !opts.dryRun && changed) {
    out('');
    out(tr('Pronto. Sessões já abertas continuam com o mod até /reload-plugins (ou até reabrir a sessão).'));
    out(tr('Para voltar ao jeito antigo (Claude Code anterior ao 2.1.287): npm run usage:install e npm run hooks:install'));
  }
  if (opts.command === 'status') {
    // O mod e os plugins só falam com o Habblaud local: diz se ele está lá para responder.
    const port = habblaudPort(env);
    const health = await (ctx.health ?? fetchHealth)(port);
    const at = tr('Habblaud em http://127.0.0.1:{0}', [port]);
    if (!health) out(tr('{0}: fora do ar (o mod segue gravando o uso; os pedidos de permissão ficam só no terminal).', [at]));
    else if (health.permissions) out(tr('{0}: no ar e respondendo pedidos de permissão (com alguma página aberta).', [at]));
    else out(tr('{0}: no ar, mas responder pelo escritório está desligado (porta exposta na rede ou HABBLAUD_TERMINAL=0).', [at]));
    // Um Habblaud de antes das mensagens não diz nada sobre elas.
    if (health && typeof health.messages === 'boolean') {
      out(
        health.messages
          ? tr('Mensagens pelo escritório: ligadas (chegam às sessões abertas com o plugin {0}).', [shortName(MESSAGES_PLUGIN)])
          : tr('Mensagens pelo escritório: desligadas no Habblaud (porta exposta na rede, HABBLAUD_TERMINAL=0 ou HABBLAUD_MENSAGENS=0).'),
      );
    }
  }
  return failures ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------
// Para o docker:up: atualiza o mod de quem já instalou
// ---------------------------------------------------------------------------------------------

export interface ModUpdateContext {
  env: NodeJS.ProcessEnv;
  home: string;
  root: string;
  version: string;
  claude: ClaudeRunner;
}

export interface ModUpdateResult {
  /** Alguma conta tem o mod (ou um dos outros plugins) instalado, mesmo que com o nome antigo. */
  installed: boolean;
  /** Não deu para consultar o Claude Code em nenhuma conta (ex.: `claude` fora do PATH). */
  unavailable: boolean;
  lines: Array<{ level: 'info' | 'warn'; text: string }>;
}

/**
 * Para cada conta com o mod instalado numa versão diferente da do package.json: relê o catálogo e atualiza os
 * plugins instalados. Com restos do nome antigo, só avisa (a troca é do mod:install). Com o mod e sem o plugin de
 * mensagens, dá a dica de rodar o mod:install. Nunca instala nada e nunca lança: qualquer falha vira um aviso.
 */
export function updateInstalledMods(accounts: Array<{ dir: string; label: string }>, ctx: ModUpdateContext): ModUpdateResult {
  const res: ModUpdateResult = { installed: false, unavailable: false, lines: [] };
  if (!accounts.length) return res;
  // Um runner que nunca lança: qualquer exceção vira uma falha comum (o docker:up não pode cair por isso).
  const claude: ClaudeRunner = (args, env) => {
    try {
      return ctx.claude(args, env);
    } catch (err) {
      return { code: null, stdout: '', stderr: '', error: (err as Error).message };
    }
  };
  // Sem o CLI, a mesma falha se repetiria em todas as contas: confere uma vez e avisa uma vez.
  const probe = claude(['--version'], ctx.env);
  if (probe.error || probe.code !== 0) {
    res.unavailable = true;
    res.lines.push({ level: 'warn', text: tr('não consegui consultar o Claude Code ({0}); o mod não foi conferido.', [cliMessage(probe)]) });
    return res;
  }
  for (const { dir, label } of accounts) {
    const env = accountEnv(ctx.env, dir, ctx.home);
    const state = readAccountState(claude, env);
    if ('error' in state) {
      res.lines.push({ level: 'warn', text: tr('mod na {0}: {1}', [label, state.error]) });
      continue;
    }
    const plan = planUpdate(state, { root: ctx.root, version: ctx.version });
    if (plan.action !== 'none' || plan.installed) res.installed = true;
    if (plan.action === 'warn') {
      res.lines.push({ level: 'warn', text: tr('mod na {0}: {1}', [label, plan.message]) });
      continue;
    }
    if (plan.action === 'update') res.lines.push(applyUpdate(plan.steps, { claude, env, version: ctx.version, label }));
    // Tem o mod e não o plugin de mensagens (que veio depois): o docker:up não o instala sozinho, só dá a dica.
    if (plan.hint) res.lines.push({ level: 'info', text: tr('Dica para a {0}: {1}', [label, plan.hint]) });
  }
  return res;
}

/** Roda os passos da atualização de uma conta e conta como foi, numa linha. */
function applyUpdate(steps: CliStep[], o: { claude: ClaudeRunner; env: NodeJS.ProcessEnv; version: string; label: string }): ModUpdateResult['lines'][number] {
  for (const step of steps) {
    const r = o.claude(step.args, o.env);
    if (r.error || r.code !== 0) {
      return { level: 'warn', text: tr('não consegui atualizar o mod na {0}: {1} ({2}). Tente: npm run mod:install', [o.label, step.message.split(':')[0], cliMessage(r)]) };
    }
  }
  // Só diz "atualizado" se o Claude Code passou mesmo a registrar a versão nova.
  const after = readAccountState(o.claude, o.env);
  const ids = steps.flatMap((s) => (s.plugin ? [s.plugin] : []));
  const issues = 'error' in after ? [after.error] : verifyInstall(after, ids, o.version);
  if (issues.length) return { level: 'warn', text: tr('mod na {0}: {1}', [o.label, issues.join('; ')]) };
  return { level: 'info', text: tr('Mod atualizado para {0} na {1}; sessões abertas: /reload-plugins', [o.version, o.label]) };
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
    root: ROOT,
    version: readPackageVersion(ROOT),
    claude: makeClaudeRunner(parsed.claudeCmd),
    out: (l) => console.log(l),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof FatalError ? tr('[mod] Erro: {0}', [err.message]) : tr('[mod] Erro inesperado: {0}', [String(err)]));
    process.exitCode = 1;
  });
}
