// Sobe (ou derruba) o Habblaud no Docker local. Roda no HOST, com tsx:
//
//   npm run docker:up                 # detecta as contas, gera o override, constrói e sobe
//   npm run docker:up -- --no-build   # sobe sem reconstruir a imagem
//   npm run docker:down               # derruba o container
//
// O que ele faz ao subir:
// 1. Descobre os config dirs do Claude Code no host (mesma regra do servidor: ~/.claude*,
//    CLAUDE_CONFIG_DIR ou HABBLAUD_CLAUDE_DIRS) e lê os metadados das contas com detectAccounts.
// 2. Gera o docker-compose.override.yml montando SOMENTE <conta>/projects e <conta>/sessions,
//    somente leitura, em /claude/<conta>/... — nunca a pasta inteira da conta, onde ficam
//    credenciais e configurações — e a pasta do uso capturado pelo statusline
//    (~/.habblaud/usage, criada se faltar) em /usage, também somente leitura. Passa
//    HABBLAUD_CLAUDE_DIRS, HABBLAUD_ACCOUNTS, HABBLAUD_USAGE_DIR e o fuso do host (TZ) ao container.
//    Contas do Codex (~/.codex*, CODEX_HOME ou HABBLAUD_CODEX_DIRS; HABBLAUD_CODEX=0 desliga): SOMENTE
//    sessions/, archived_sessions/ e thread-writer-locks/ de cada uma, somente leitura, em /codex/<conta>/... —
//    nunca auth.json, config.toml, shell_snapshots/, history.jsonl, logs nem os SQLite. Vão em HABBLAUD_CODEX_DIRS
//    e, com `provider: 'codex'` e a pasta do HOST (onde o `codex queue` roda), em HABBLAUD_ACCOUNTS.
// 3. Migra o que sobrou do nome antigo (CodeTown, até a 0.3.2): ~/.codetown vira ~/.habblaud, o container
//    `codetown` e a rede codetown_default saem e, se o volume novo ainda não existe, os dados de
//    codetown_codetown-data são copiados para ele (o antigo fica, para apagar à mão). Avisa de CODETOWN_*
//    no ambiente e no .env, que não valem mais.
// 4. Roda `docker compose up -d --build`, espera o /api/health e mostra a URL.
// 5. Diz no fim se o Habblaud World está ligado (HABBLAUD_WORLD_URL do ambiente ou do .env, conferida como o servidor
//    confere) e para qual servidor; sem a variável, vem ligado apontando para server.habblaud.com ("(padrão)"), e
//    HABBLAUD_WORLD=0 desliga tudo.
// 6. Atualiza o mod do Habblaud nas contas onde ele JÁ está instalado com outra versão (depois de
//    atualizar o Habblaud): relê o marketplace desta pasta e roda `claude plugin update` com o
//    CLAUDE_CONFIG_DIR de cada conta. Nunca instala sozinho; se o `claude` faltar ou falhar, é só um aviso. Numa
//    conta com o mod e sem o plugin de mensagens (que veio depois), só dá a dica de rodar o npm run mod:install.
//
// Uso de 5h/semanal ao vivo: o mod do Habblaud (npm run mod:install; Claude Code 2.1.287+) ou, em
// versões anteriores, o tap de statusline (npm run usage:install). Os dois gravam os números na pasta
// montada em /usage. Sem eles, vale o cache do /usage lido das contas ao subir.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AccountInfo, SourceInfo } from '../shared/types';
import { codexDirsRefused, detectAccounts, discoverClaudeDirs, type DetectedAccount } from '../server/accounts/detect';
import { detectCodexAccounts, discoverCodexDirs } from '../server/sources/codex/accounts';
import { describeStateMigration, LEGACY_NAME, legacyEnvWarning, migrateLegacyStateDir } from '../server/legacy';
import { makeClaudeRunner, MIN_CLAUDE_VERSION, readPackageVersion, updateInstalledMods, type ModUpdateResult } from './mod-install';
import { tr } from '../shared/i18n';
import { readEnvValue } from '../server/remote/envfile';
import { parseWorldConfig } from '../server/config';
import { ensureServerCert, remoteTargets, remoteTlsBase, tlsPaths } from '../server/remote/tls';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOME = process.env.HOME || homedir();
const STATE_DIR = join(HOME, '.habblaud');
const OVERRIDE_FILE = join(ROOT, 'docker-compose.override.yml');
/** O .env desta pasta, que o Compose lê sozinho. */
const ENV_FILE = join(ROOT, '.env');
/** Uso capturado no host pelo mod do Habblaud ou pelo tap de statusline (scripts/statusline-tap.mjs). */
const USAGE_DIR = process.env.HABBLAUD_USAGE_DIR?.trim() ? resolve(process.env.HABBLAUD_USAGE_DIR.trim()) : join(STATE_DIR, 'usage');
/** Onde essa pasta aparece no container. */
const CONTAINER_USAGE_DIR = '/usage';
/** Onde o container lê o certificado do acesso remoto (server/http/remote.ts). */
const CONTAINER_REMOTE_TLS_DIR = '/remote-tls';
const SERVICE = 'habblaud';
/** Raiz das montagens dentro do container: /claude/<conta>/{projects,sessions}. */
const CONTAINER_ROOT = '/claude';
/** Somente estas subpastas de cada conta entram no container. */
const MOUNTED_SUBDIRS = ['projects', 'sessions'] as const;
/** Raiz das montagens do Codex dentro do container: /codex/<conta>/{sessions,archived_sessions,thread-writer-locks}. */
const CODEX_CONTAINER_ROOT = '/codex';
/**
 * Somente estas subpastas de cada pasta do Codex entram no container (as conversas e os locks das sessões abertas).
 * auth.json, config.toml, shell_snapshots/, history.jsonl, logs e os SQLite ficam no host.
 */
export const CODEX_MOUNTED_SUBDIRS = ['sessions', 'archived_sessions', 'thread-writer-locks'] as const;
const DEFAULT_PORT = 4747;
const HEALTH_TIMEOUT_MS = 120_000;
/** Imagem e volume de dados como o Compose os nomeia (`name: habblaud` no docker-compose.yml). */
const IMAGE = 'habblaud:local';
const DATA_VOLUME = 'habblaud_habblaud-data';
/** O mesmo no CodeTown (até a 0.3.2), só para a migração: container_name fixo, rede padrão, volume e imagem. */
const LEGACY_DOCKER = {
  container: LEGACY_NAME,
  network: `${LEGACY_NAME}_default`,
  volume: `${LEGACY_NAME}_${LEGACY_NAME}-data`,
  image: `${LEGACY_NAME}:local`,
} as const;

const USAGE = tr('Uso: npm run docker:up [-- opções]\n\nOpções:\n  --no-build   sobe sem reconstruir a imagem\n  --down       derruba o container (o mesmo que npm run docker:down)\n  -h, --help   mostra esta ajuda\n\nVariáveis: HABBLAUD_PORT (porta no host, padrão {0}), HABBLAUD_CLAUDE_DIRS\n(config dirs separados por vírgula, se as contas não estiverem em ~/.claude*), HABBLAUD_CODEX_DIRS\n(pastas do Codex, se não estiverem em ~/.codex* nem em CODEX_HOME) e HABBLAUD_CODEX=0 (sem o Codex).', [DEFAULT_PORT]);

// ---------------------------------------------------------------------------------------------
// Saída no terminal
// ---------------------------------------------------------------------------------------------

const say = (msg: string) => console.log(`[docker-up] ${msg}`);
const warn = (msg: string) => console.warn(tr('[docker-up] Atenção: {0}', [msg]));

class FatalError extends Error {}

function fail(msg: string): never {
  throw new FatalError(msg);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

const USAGE_STATUS: Record<AccountInfo['usageStatus'], string> = {
  ok: tr('uso atualizado'),
  stale: tr('uso desatualizado'),
  disabled: tr('sem dados de uso'),
};

// ---------------------------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------------------------

export interface Options {
  down: boolean;
  build: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): Options {
  const opts: Options = { down: false, build: true, help: false };
  for (const arg of argv) {
    if (arg === '--down') opts.down = true;
    else if (arg === '--no-build') opts.build = false;
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else fail(tr('opção desconhecida: {0}\n\n{1}', [arg, USAGE]));
  }
  return opts;
}

export function hostPort(env: NodeJS.ProcessEnv): number {
  const raw = env.HABBLAUD_PORT?.trim();
  if (!raw) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port >= 65536) fail(tr('HABBLAUD_PORT inválida: "{0}" (use um número de 1 a 65535).', [raw]));
  return port;
}

// ---------------------------------------------------------------------------------------------
// Plano de montagens e override do Compose (funções puras, sem efeitos colaterais)
// ---------------------------------------------------------------------------------------------

export interface BindMount {
  /** Caminho real no host (symlinks resolvidos: o Docker Desktop não os segue). */
  source: string;
  /** Caminho dentro do container. */
  target: string;
}

export interface AccountMount {
  account: DetectedAccount;
  /** Config dir da conta no host. */
  hostDir: string;
  /** Onde a conta aparece no container: /claude/<id>. */
  mountDir: string;
  binds: BindMount[];
}

/** Janelas de uso que o servidor exibe (as demais chaves do cache são ignoradas). */
const USAGE_WINDOWS = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet'] as const;

type CachedWindow = { utilization: unknown; resets_at?: unknown };
type CachedUsage = { fetchedAtMs: unknown; utilization: Partial<Record<(typeof USAGE_WINDOWS)[number], CachedWindow>> };

export interface AccountPayload {
  id: string;
  /** Só nas contas do Codex (ausente = Claude Code). */
  provider?: 'codex';
  configDir: string;
  mountDir: string;
  short: string;
  name: string;
  email?: string;
  organization?: string;
  plan?: string;
  color: string;
  cachedUsage?: CachedUsage;
}

/** Caminho real de uma pasta existente, ou undefined. */
function realDir(p: string): string | undefined {
  try {
    const real = realpathSync(p);
    return statSync(real).isDirectory() ? real : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Monta só projects/ e sessions/ de cada conta (as que existirem). `accounts` vem de
 * detectAccounts(dirs) e está na mesma ordem de `dirs`; o id (basename desambiguado) vira o
 * nome da pasta no container, então o servidor lá dentro deriva exatamente o mesmo id.
 */
export function planMounts(dirs: string[], accounts: DetectedAccount[], resolveDir: (p: string) => string | undefined = realDir): AccountMount[] {
  const out: AccountMount[] = [];
  dirs.forEach((hostDir, i) => {
    const account = accounts[i];
    const mountDir = posix.join(CONTAINER_ROOT, account.id);
    const binds: BindMount[] = [];
    for (const sub of MOUNTED_SUBDIRS) {
      const source = resolveDir(join(hostDir, sub));
      if (source) binds.push({ source, target: posix.join(mountDir, sub) });
    }
    if (binds.length) out.push({ account, hostDir, mountDir, binds });
  });
  return out;
}

/**
 * Monta só sessions/, archived_sessions/ e thread-writer-locks/ de cada pasta do Codex (as que existirem), em
 * /codex/<id>. `accounts` vem de detectCodexAccounts(dirs), na mesma ordem de `dirs`; o id vira o nome da pasta no
 * container, então o servidor lá dentro deriva o mesmo id.
 */
export function planCodexMounts(dirs: string[], accounts: DetectedAccount[], resolveDir: (p: string) => string | undefined = realDir): AccountMount[] {
  const out: AccountMount[] = [];
  dirs.forEach((hostDir, i) => {
    const account = accounts[i];
    const mountDir = posix.join(CODEX_CONTAINER_ROOT, account.id);
    const binds: BindMount[] = [];
    for (const sub of CODEX_MOUNTED_SUBDIRS) {
      const source = resolveDir(join(hostDir, sub));
      if (source) binds.push({ source, target: posix.join(mountDir, sub) });
    }
    if (binds.length) out.push({ account, hostDir, mountDir, binds });
  });
  return out;
}

/** Metadados das contas do Codex para HABBLAUD_ACCOUNTS: `provider: 'codex'` e a pasta do HOST em `configDir`. */
export function codexAccountsPayload(mounts: AccountMount[]): AccountPayload[] {
  return mounts.map(({ account: a, hostDir, mountDir }) => {
    const p: AccountPayload = { id: a.id, provider: 'codex', configDir: hostDir, mountDir, short: a.short, name: a.name, color: a.color };
    if (a.plan) p.plan = a.plan;
    return p;
  });
}

/** HABBLAUD_CODEX desligado (0, false, off, no) no ambiente de quem roda o docker:up. */
export function codexDisabled(env: NodeJS.ProcessEnv): boolean {
  const v = env.HABBLAUD_CODEX?.trim();
  return !!v && !/^(1|true|yes|sim|on)$/i.test(v);
}

/**
 * Do cache de uso do Claude Code (`cachedUsageUtilization`) só seguem a data da coleta e, de
 * cada janela exibida, o percentual e o horário de reinício. Identificadores da conta, gastos e
 * demais campos ficam de fora (o ambiente do container é visível em `docker inspect`).
 */
export function sanitizeCachedUsage(raw: unknown): CachedUsage | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const c = raw as Record<string, unknown>;
  const fetchedAtMs = c.fetchedAtMs ?? c.fetchedAt;
  if (fetchedAtMs === undefined || !c.utilization || typeof c.utilization !== 'object') return undefined;
  const util = c.utilization as Record<string, unknown>;
  const out: CachedUsage = { fetchedAtMs, utilization: {} };
  for (const key of USAGE_WINDOWS) {
    const w = util[key];
    if (!w || typeof w !== 'object') continue;
    const { utilization, resets_at } = w as Record<string, unknown>;
    if (utilization === undefined || utilization === null) continue;
    out.utilization[key] = resets_at === undefined || resets_at === null ? { utilization } : { utilization, resets_at };
  }
  return Object.keys(out.utilization).length ? out : undefined;
}

/** Metadados das contas para HABBLAUD_ACCOUNTS (o container não enxerga o .claude.json do host). */
export function accountsPayload(mounts: AccountMount[]): AccountPayload[] {
  return mounts.map(({ account: a, mountDir }) => {
    const p: AccountPayload = { id: a.id, configDir: a.configDir, mountDir, short: a.short, name: a.name, color: a.color };
    if (a.email) p.email = a.email;
    if (a.organization) p.organization = a.organization;
    if (a.plan) p.plan = a.plan;
    const cached = sanitizeCachedUsage(a.cachedUsage);
    if (cached) p.cachedUsage = cached;
    return p;
  });
}

/**
 * Escalar YAML seguro: string JSON (válida como string YAML entre aspas duplas) com `$`
 * duplicado, para o Compose não tentar interpolar variáveis dentro dos valores.
 */
export function yamlString(value: string): string {
  return JSON.stringify(value.replaceAll('$', '$$$$'));
}

/**
 * Fuso horário do host (TZ ou o do sistema), para o container: sem ele o Node do container usa UTC e
 * o "dia" do timelapse e do painel do dia viraria às 21h no horário de Brasília. Undefined se inválido.
 */
export function hostTimeZone(env: NodeJS.ProcessEnv = process.env): string | undefined {
  let tz = env.TZ?.trim().replace(/^:/, '');
  if (!tz) {
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return undefined;
    }
  }
  return tz && /^[A-Za-z0-9_+\-]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(tz) ? tz : undefined;
}

/**
 * `usageDir`: pasta do host com o uso capturado pelo tap de statusline (já existente; caminho real),
 * montada somente leitura em /usage. `timeZone`: fuso do host, repassado como TZ. `codex`: montagens das contas do
 * Codex (planCodexMounts).
 */
export function renderOverride(
  mounts: AccountMount[],
  generatedAt: Date = new Date(),
  usageDir?: string,
  timeZone?: string,
  codex: AccountMount[] = [],
  remoteTlsDir?: string,
  extraPorts: string[] = [],
): string {
  const env: Array<[string, string]> = [
    ['HABBLAUD_CLAUDE_DIRS', mounts.map((m) => m.mountDir).join(',')],
    ['HABBLAUD_ACCOUNTS', JSON.stringify([...accountsPayload(mounts), ...codexAccountsPayload(codex)])],
  ];
  if (codex.length) env.push(['HABBLAUD_CODEX_DIRS', codex.map((m) => m.mountDir).join(',')]);
  if (usageDir) env.push(['HABBLAUD_USAGE_DIR', CONTAINER_USAGE_DIR]);
  if (timeZone) env.push(['TZ', timeZone]);
  const lines = [
    `# Gerado por scripts/docker-up.ts em ${generatedAt.toISOString()} — não edite: é recriado a cada \`npm run docker:up\`.`,
    '# Contém caminhos do host e e-mails das contas: fica fora do git e com permissão 600.',
    '# Montagens: SOMENTE <conta>/projects, <conta>/sessions e a pasta do uso do statusline, todas somente leitura.',
    ...(codex.length ? ['# Codex: SOMENTE <pasta>/sessions, <pasta>/archived_sessions e <pasta>/thread-writer-locks, somente leitura.'] : []),
    'services:',
    `  ${SERVICE}:`,
    '    environment:',
    ...env.map(([k, v]) => `      ${k}: ${yamlString(v)}`),
  ];
  // O Compose junta estas portas às do docker-compose.yml.
  if (extraPorts.length) lines.push('    ports:', ...extraPorts.map((p) => `      - ${yamlString(p)}`));
  const binds = [...mounts, ...codex].flatMap((m) => m.binds);
  if (usageDir) binds.push({ source: usageDir, target: CONTAINER_USAGE_DIR });
  // Acesso remoto: SÓ a pasta do certificado do servidor (a chave da CA fica no host).
  if (remoteTlsDir) binds.push({ source: remoteTlsDir, target: CONTAINER_REMOTE_TLS_DIR });
  if (binds.length) {
    lines.push('    volumes:');
    for (const b of binds) {
      lines.push(
        '      - type: bind',
        `        source: ${yamlString(b.source)}`,
        `        target: ${yamlString(b.target)}`,
        '        read_only: true',
        '        bind:',
        '          create_host_path: false',
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Dica do fim do docker:up sobre o mod: só aparece quando nenhuma conta tem o mod instalado (quem já instalou
 * recebe a atualização automática, ou um aviso). Sem o CLI do Claude Code, não dá para saber: fica quieto.
 */
export function modHint(mod: Pick<ModUpdateResult, 'installed' | 'unavailable'>): string[] {
  if (mod.installed || mod.unavailable) return [];
  return [
    tr('  Uso de 5h/semanal ao vivo, responder e mandar mensagens pelo escritório: npm run mod:install (uma vez; Claude Code {0}+).', [MIN_CLAUDE_VERSION]),
    tr('  Em versões anteriores do Claude Code: npm run usage:install e npm run hooks:install. Sem eles, vale o cache do /usage.'),
  ];
}

// ---------------------------------------------------------------------------------------------
// Nome antigo (CodeTown, até a 0.3.2): plano da subida no Docker e nomes do .env (funções puras)
// ---------------------------------------------------------------------------------------------

/** O que já existe no Docker antes de subir. */
export interface DockerState {
  /** Container `codetown` do CodeTown (container_name fixo: prende o nome e a porta). */
  legacyContainer: boolean;
  /** Rede codetown_default. */
  legacyNetwork: boolean;
  /** Volume codetown_codetown-data (nomes dos personagens, linha do tempo, estatísticas). */
  legacyVolume: boolean;
  /** Imagem codetown:local. */
  legacyImage: boolean;
  /** Volume de dados do Habblaud (habblaud_habblaud-data). */
  dataVolume: boolean;
}

export type UpStep =
  | { kind: 'remove-container'; name: string }
  | { kind: 'remove-network'; name: string }
  | { kind: 'compose'; args: string[] }
  | { kind: 'copy-volume'; from: string; to: string };

export interface UpPlan {
  steps: UpStep[];
  /** Comandos para apagar o que sobrou do CodeTown, mostrados no fim quando esta subida migrou algo. */
  cleanup: string[];
}

/**
 * Passos para subir o Habblaud. Antes, tira do caminho o container do CodeTown e a rede dele. Se o volume antigo
 * existe e o novo ainda não, os dados são copiados: o Compose cria o volume (com os labels dele; um volume criado
 * à mão gera aviso e pedido para recriar) e o container, ainda parado; a cópia entra e só então ele sobe. O volume
 * antigo nunca é apagado aqui.
 */
export function planUp(state: DockerState, build: boolean): UpPlan {
  const steps: UpStep[] = [];
  if (state.legacyContainer) steps.push({ kind: 'remove-container', name: LEGACY_DOCKER.container });
  if (state.legacyNetwork) steps.push({ kind: 'remove-network', name: LEGACY_DOCKER.network });
  const copy = state.legacyVolume && !state.dataVolume;
  if (copy) {
    steps.push(
      { kind: 'compose', args: build ? ['up', '--no-start', '--build'] : ['up', '--no-start'] },
      { kind: 'copy-volume', from: LEGACY_DOCKER.volume, to: DATA_VOLUME },
      { kind: 'compose', args: ['up', '-d'] },
    );
  } else steps.push({ kind: 'compose', args: build ? ['up', '-d', '--build'] : ['up', '-d'] });

  const cleanup: string[] = [];
  if (state.legacyContainer || copy) {
    if (state.legacyVolume) cleanup.push(`docker volume rm ${LEGACY_DOCKER.volume}`);
    if (state.legacyImage) cleanup.push(`docker image rm ${LEGACY_DOCKER.image}`);
  }
  return { steps, cleanup };
}

/**
 * `docker run` descartável que copia o volume `from` (somente leitura) para `to` com a própria imagem do
 * Habblaud, como root (ela roda como `node`) e sem rede; a raiz de `to` fica com o dono e as permissões da de
 * `from`. O --rm leva junto o volume anônimo do VOLUME /data da imagem.
 */
export function copyVolumeArgs(from: string, to: string, image: string = IMAGE): string[] {
  const script = 'set -e; cp -a /from/. /to/; chown "$(stat -c %u:%g /from)" /to; chmod "$(stat -c %a /from)" /to';
  const flags = ['--rm', '--pull', 'never', '--network', 'none', '--no-healthcheck', '--user', '0:0', '--entrypoint', 'sh'];
  return ['run', ...flags, '-v', `${from}:/from:ro`, '-v', `${to}:/to`, image, '-c', script];
}

/** Nomes das variáveis de um .env (linhas `NOME=valor`, com ou sem `export`). Os valores ficam de fora. */
export function envFileKeys(text: string): string[] {
  const keys: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (m) keys.push(m[1]);
  }
  return keys;
}

/** As variáveis do Habblaud World que o docker-compose.yml repassa ao container. */
const WORLD_ENV_KEYS = ['HABBLAUD_WORLD', 'HABBLAUD_WORLD_URL', 'HABBLAUD_WORLD_DEV'] as const;

/**
 * A linha do Habblaud World no fim do docker:up: o que o container vai ler (o ambiente vale mais que o .env, como no
 * Compose), conferido pelo mesmo parseWorldConfig do servidor (no container não há `--dev`: só HABBLAUD_WORLD_DEV).
 * Mostra só o endereço já normalizado, nunca o valor cru (que poderia ter usuário e senha).
 */
export function worldLine(env: NodeJS.ProcessEnv, envFile = ''): string {
  const vars: NodeJS.ProcessEnv = {};
  for (const key of WORLD_ENV_KEYS) {
    const value = key in env ? env[key] : readEnvValue(envFile, key);
    if (value !== undefined) vars[key] = value;
  }
  const world = parseWorldConfig(vars, []);
  if (!world.enabled) return tr('Habblaud World: desligado (HABBLAUD_WORLD={0}).', [vars.HABBLAUD_WORLD?.trim() ?? '0']);
  if (world.url) return world.defaultUrl ? tr('Habblaud World: ligado: {0} (padrão)', [world.url]) : tr('Habblaud World: ligado: {0}', [world.url]);
  return tr('Habblaud World: desligado ({0}).', [world.warning ?? tr('HABBLAUD_WORLD_URL recusada')]);
}

// ---------------------------------------------------------------------------------------------
// Estado no host (~/.habblaud)
// ---------------------------------------------------------------------------------------------

/** O .env desta pasta ('' sem ele). */
function readEnvFile(): string {
  try {
    return readFileSync(ENV_FILE, 'utf8');
  } catch {
    return '';
  }
}

/** Avisa das variáveis CODETOWN_* (nome antigo, ignoradas) no ambiente e no .env desta pasta. */
function warnLegacyEnv(): void {
  let fileKeys: string[] = [];
  try {
    fileKeys = envFileKeys(readFileSync(ENV_FILE, 'utf8'));
  } catch {
    // sem .env (o normal) ou ilegível: nada a avisar
  }
  for (const msg of [legacyEnvWarning(Object.keys(process.env)), legacyEnvWarning(fileKeys, tr('no .env'))]) {
    if (msg) warn(msg);
  }
}

/** Leva ~/.codetown (nome antigo) para ~/.habblaud; roda antes de criar a pasta do uso, para ser um rename. */
function migrateStateDir(): void {
  const result = migrateLegacyStateDir(HOME);
  const msg = describeStateMigration(result);
  if (msg) (result.error ? warn : say)(msg);
}

/** Cria a pasta do uso do statusline se faltar e devolve o caminho real (ou undefined, se falhar). */
function ensureUsageDir(): string | undefined {
  try {
    mkdirSync(USAGE_DIR, { recursive: true, mode: 0o700 });
    return realDir(USAGE_DIR);
  } catch (err) {
    warn(tr('não consegui criar {0} ({1}); o uso do statusline não vai aparecer no container.', [tildify(USAGE_DIR), (err as Error).message]));
    return undefined;
  }
}

function tildify(p: string): string {
  return p === HOME || p.startsWith(`${HOME}/`) ? `~${p.slice(HOME.length)}` : p;
}

// ---------------------------------------------------------------------------------------------
// Docker
// ---------------------------------------------------------------------------------------------

function checkDocker(): void {
  const info = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8' });
  if (info.error) fail(tr('o comando "docker" não foi encontrado. Instale o Docker Desktop: https://www.docker.com/products/docker-desktop/'));
  if (info.status !== 0) fail(tr('o Docker não está respondendo. Abra o Docker Desktop, espere ele terminar de iniciar e tente de novo.'));
  const compose = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' });
  if (compose.status !== 0) fail(tr('o Docker Compose v2 ("docker compose") não está disponível. Atualize o Docker Desktop.'));
}

function compose(args: string[], port: number): void {
  // HABBLAUD_PORT explícito: vale sobre um eventual .env na pasta do projeto.
  const res = spawnSync('docker', ['compose', ...args], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, HABBLAUD_PORT: String(port) } });
  if (res.error) fail(tr('não consegui rodar "docker compose {0}": {1}', [args.join(' '), res.error.message]));
  if (res.status !== 0) fail(tr('"docker compose {0}" falhou (código {1}).', [args.join(' '), res.status ?? res.signal]));
}

/** `docker <args>` sem mostrar nada no terminal: se deu certo, a saída e a última linha do erro. */
function dockerQuiet(args: string[]): { ok: boolean; out: string; error: string } {
  const res = spawnSync('docker', args, { encoding: 'utf8' });
  // A última linha do docker costuma ser só "Run 'docker run --help' for more information".
  const lines = (res.stderr ?? '').split('\n').filter((l) => l.trim() && !/^Run '.*--help'/.test(l));
  const error = res.error?.message || lines.pop()?.trim() || tr('código {0}', [res.status ?? res.signal]);
  return { ok: res.status === 0, out: res.stdout ?? '', error };
}

/** O que já existe no Docker do CodeTown e do Habblaud (entrada de planUp). */
function inspectDocker(): DockerState {
  const exists = (kind: 'network' | 'volume' | 'image', name: string) => dockerQuiet([kind, 'inspect', name]).ok;
  // Só sai o container `codetown` que é mesmo do CodeTown: da imagem antiga ou do projeto antigo do Compose.
  const { container, image } = LEGACY_DOCKER;
  const c = dockerQuiet(['container', 'inspect', '--format', '{{.Config.Image}} {{index .Config.Labels "com.docker.compose.project"}}', container]);
  const [cImage = '', cProject = ''] = c.out.trim().split(' ');
  const legacyContainer = c.ok && (cImage === image || cProject === LEGACY_NAME);
  if (c.ok && !legacyContainer) warn(tr('existe um container {0} que não é do CodeTown (imagem {1}); ele fica como está.', [container, cImage || '?']));
  return {
    legacyContainer,
    legacyNetwork: exists('network', LEGACY_DOCKER.network),
    legacyVolume: exists('volume', LEGACY_DOCKER.volume),
    legacyImage: exists('image', image),
    dataVolume: exists('volume', DATA_VOLUME),
  };
}

/** Copia os dados do volume do CodeTown para o do Habblaud. Falha é só um aviso: o escritório sobe sem eles. */
function copyVolume(from: string, to: string): boolean {
  // O volume novo tem de vir do Compose: o `docker run -v` criaria um sem os labels dele.
  if (!dockerQuiet(['volume', 'inspect', to]).ok) {
    warn(tr('o Compose não criou o volume {0}; os dados do CodeTown não foram copiados e continuam em {1}.', [to, from]));
    return false;
  }
  say(tr('Copiando os dados do CodeTown (nomes dos personagens, linha do tempo e estatísticas) de {0} para {1}…', [from, to]));
  const res = dockerQuiet(copyVolumeArgs(from, to));
  if (!res.ok) {
    warn(
      tr('não consegui copiar os dados do CodeTown ({0}). O escritório sobe sem eles; os dados continuam em {1}.\n', [res.error, from]) +
        tr('  Para tentar de novo: npm run docker:down && docker volume rm {0} && npm run docker:up', [to]),
    );
    return false;
  }
  say(tr('Dados copiados; o volume {0} ficou intacto.', [from]));
  return true;
}

/** Executa os passos de planUp. Derrubam o docker:up só o Compose e o container antigo que não sai. */
function runPlan(plan: UpPlan, port: number, build: boolean): { copyFailed: boolean } {
  let copyFailed = false;
  let created = false;
  for (const step of plan.steps) {
    switch (step.kind) {
      case 'remove-container': {
        say(tr('Removendo o container {0} (CodeTown, o nome antigo)…', [step.name]));
        const res = dockerQuiet(['rm', '-f', step.name]);
        if (!res.ok) fail(tr('não consegui remover o container antigo {0} ({1}). Remova com docker rm -f {2} e rode de novo.', [step.name, res.error, step.name]));
        break;
      }
      case 'remove-network': {
        const res = dockerQuiet(['network', 'rm', step.name]);
        if (!res.ok) warn(tr('não consegui remover a rede antiga {0} ({1}); apague depois com docker network rm {2}.', [step.name, res.error, step.name]));
        break;
      }
      case 'copy-volume':
        copyFailed = !copyVolume(step.from, step.to);
        break;
      case 'compose':
        if (step.args.includes('--no-start')) {
          say(tr('{0} o container, ainda parado, para receber os dados do CodeTown…', [build ? tr('Construindo a imagem e criando') : tr('Criando')]));
          created = true;
        } else if (created) say(tr('Subindo o container…'));
        else say(build ? tr('Construindo a imagem e subindo o container…') : tr('Subindo o container (sem reconstruir a imagem)…'));
        compose(step.args, port);
        break;
    }
  }
  return { copyFailed };
}

interface Health {
  ok: boolean;
  version?: string;
  demo?: boolean;
  docker?: boolean;
  sources?: SourceInfo[];
  accounts?: Array<{ id: string; usageStatus: AccountInfo['usageStatus'] }>;
}

async function fetchHealth(baseUrl: string, timeoutMs: number): Promise<Health | undefined> {
  try {
    const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return undefined;
    const body = (await res.json()) as Health;
    return body?.ok ? body : undefined;
  } catch {
    return undefined;
  }
}

const sleep = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

async function waitHealthy(baseUrl: string): Promise<Health | undefined> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const health = await fetchHealth(baseUrl, 3_000);
    if (health) return health;
    await sleep(1_000);
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Comandos
// ---------------------------------------------------------------------------------------------

function down(port: number): void {
  checkDocker();
  say(tr('Derrubando o container…'));
  compose(['down'], port);
  say(tr('Pronto. Os nomes dos personagens continuam guardados no volume habblaud-data.'));
}

async function up(opts: Options, port: number): Promise<void> {
  checkDocker();
  warnLegacyEnv();
  const baseUrl = `http://127.0.0.1:${port}`;
  const publicUrl = `http://localhost:${port}`;

  // Porta ocupada por um Habblaud fora do Docker (npm run dev / npm start)?
  const existing = await fetchHealth(baseUrl, 1_500);
  if (existing && !existing.docker) {
    fail(
      tr('já existe um Habblaud rodando fora do Docker em {0} (npm run dev ou npm start?).\n', [publicUrl]) +
        tr(`Pare-o antes, ou use outra porta: HABBLAUD_PORT=4848 npm run docker:up`),
    );
  }

  const dirs = discoverClaudeDirs(process.env, HOME);
  const accounts = detectAccounts(dirs, { home: HOME, env: process.env });
  const mounts = planMounts(dirs, accounts);
  if (!mounts.length) {
    warn(
      tr('nenhuma pasta do Claude Code (com projects/ ou sessions/) foi encontrada em ~/.claude*.\n') +
        tr('  O escritório vai abrir vazio (dá para ligar o modo demonstração na interface).\n') +
        tr('  Se as contas estiverem em outro lugar: HABBLAUD_CLAUDE_DIRS=/caminho/conta1,/caminho/conta2 npm run docker:up'),
    );
  }
  for (const m of mounts) {
    const subdirs = m.binds.map((b) => posix.basename(b.target)).join(' e ');
    say(tr('Conta {0} ({1}): monta {2} de {3}, somente leitura.', [m.account.short, m.account.id, subdirs, tildify(m.hostDir)]));
  }
  for (const dir of dirs) {
    if (!mounts.some((m) => m.hostDir === dir)) warn(tr('{0} não tem projects/ nem sessions/; conta ignorada.', [tildify(dir)]));
  }
  // Pasta do Codex (CODEX_HOME) listada ou achada como se fosse do Claude Code: não é montada como conta do Claude.
  // Ela entra (só as conversas e os locks) como conta do Codex, logo abaixo.
  const claudeRefused = codexDirsRefused(process.env, HOME);
  const codexDirs = codexDisabled(process.env) ? [] : discoverCodexDirs(process.env, HOME);
  for (const dir of claudeRefused) if (!codexDirs.includes(dir)) warn(tr('{0} é uma pasta do Codex, não do Claude Code; conta ignorada.', [tildify(dir)]));
  const codexAccounts = detectCodexAccounts(codexDirs, {
    home: HOME,
    env: process.env,
    taken: { shorts: accounts.map((a) => a.short), colors: accounts.map((a) => a.color) },
  });
  const codexMounts = planCodexMounts(codexDirs, codexAccounts);
  for (const m of codexMounts) {
    const subdirs = m.binds.map((b) => posix.basename(b.target)).join(', ');
    say(tr('Codex {0} ({1}): monta {2} de {3}, somente leitura.', [m.account.short, m.account.id, subdirs, tildify(m.hostDir)]));
    if (!m.binds.some((b) => b.target.endsWith('/thread-writer-locks'))) {
      warn(tr('{0} ainda não tem thread-writer-locks/: no container, sessão aberta = conversa modificada nos últimos 30 min (rode o docker:up de novo depois de usar o Codex).', [tildify(m.hostDir)]));
    }
  }

  migrateStateDir();
  const usageDir = ensureUsageDir();
  if (usageDir) say(tr('Uso ao vivo (mod ou tap de statusline): monta {0} em {1}, somente leitura.', [tildify(USAGE_DIR), CONTAINER_USAGE_DIR]));
  const remoteTlsDir = prepareRemoteTls();
  const remotePorts = remoteTlsDir || remoteInsecure() ? remotePortsToPublish() : [];
  const tmp = `${OVERRIDE_FILE}.tmp`;
  writeFileSync(tmp, renderOverride(mounts, new Date(), usageDir, hostTimeZone(), codexMounts, remoteTlsDir, remotePorts), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, OVERRIDE_FILE);
  say(tr('docker-compose.override.yml gerado.'));

  const plan = planUp(inspectDocker(), opts.build);
  const { copyFailed } = runPlan(plan, port, opts.build);

  say(tr('Aguardando o Habblaud responder em {0}…', [publicUrl]));
  const health = await waitHealthy(baseUrl);
  if (!health) fail(tr('o Habblaud não respondeu em {0} s. Veja o que aconteceu com: npm run docker:logs', [HEALTH_TIMEOUT_MS / 1000]));

  console.log('');
  say(tr('Habblaud{0} no ar: {1}', [health.version ? ` ${health.version}` : '', publicUrl]));
  for (const acc of accounts) {
    const src = health.sources?.find((s) => s.label === acc.id);
    if (!src) continue;
    const usage = health.accounts?.find((a) => a.id === acc.id)?.usageStatus;
    const state = src.ok ? plural(src.sessions, tr('sessão aberta'), tr('sessões abertas')) : tr('erro ao ler ({0})', [src.error ?? tr('desconhecido')]);
    say(tr('  Conta {0} ({1}): {2}{3}', [acc.short, acc.id, state, usage ? ` · ${USAGE_STATUS[usage]}` : '']));
  }
  for (const m of codexMounts) {
    const src = health.sources?.find((s) => s.label === m.account.id && s.provider === 'codex');
    if (!src) continue;
    const usage = health.accounts?.find((a) => a.id === m.account.id)?.usageStatus;
    const state = src.ok ? plural(src.sessions, tr('sessão aberta'), tr('sessões abertas')) : tr('erro ao ler ({0})', [src.error ?? tr('desconhecido')]);
    say(`  Codex ${m.account.short} (${m.account.id}): ${state}${usage ? ` · ${USAGE_STATUS[usage]}` : ''}`);
  }
  for (const line of modHint(updateMods(dirs, accounts))) say(line);
  // Com a cópia falha, os dados só existem no volume antigo: nada de sugerir apagá-lo.
  if (plan.cleanup.length && !copyFailed) say(tr('  Sobrou do CodeTown; depois de conferir o escritório, apague com: {0}', [plan.cleanup.join(' · ')]));
  say(`  ${worldLine(process.env, readEnvFile())}`);
  say(tr('  Logs: npm run docker:logs · Parar: npm run docker:down'));
}

/**
 * Acesso remoto ligado no .env (npm run remote:setup): confere o certificado do servidor e o refaz quando o IP do Wi-Fi
 * mudou ou ele está perto de vencer (a CA continua a mesma, então o celular segue confiando). Devolve a pasta a montar.
 */
function prepareRemoteTls(): string | undefined {
  let env = '';
  try {
    env = readFileSync(ENV_FILE, 'utf8');
  } catch {
    return undefined;
  }
  if (!readEnvValue(env, 'HABBLAUD_REMOTE_USER')) return undefined;
  const paths = tlsPaths(remoteTlsBase(HOME));
  if (!statOk(paths.caCert)) {
    warn(tr('acesso remoto configurado, mas sem a CA local: rode npm run remote:setup.'));
    return undefined;
  }
  try {
    const targets = remoteTargets({ name: readEnvValue(env, 'HABBLAUD_REMOTE_NAME'), domain: readEnvValue(env, 'HABBLAUD_REMOTE_DOMAIN') });
    const r = ensureServerCert(paths, targets);
    if (r.issued) say(tr('Acesso remoto: certificado do servidor renovado ({0}).', [r.reason]));
    say(tr('Acesso remoto: monta {0} em {1}, somente leitura.', [tildify(paths.serverDir), CONTAINER_REMOTE_TLS_DIR]));
    return paths.serverDir;
  } catch (err) {
    warn(tr('acesso remoto: não consegui conferir o certificado ({0}).', [(err as Error).message]));
    return statOk(paths.serverCert) ? paths.serverDir : undefined;
  }
}

/**
 * Portas do acesso pelo celular, só com ele configurado (HABBLAUD_REMOTE_USER no .env): a remota (HABBLAUD_REMOTE_PORT,
 * padrão 4748) e, se houver, HABBLAUD_REMOTE_HTTP_PORT (o setup grava 80 quando a remota é a 443), que cai na mesma
 * porta do container e responde HTTP com 308 para https:// — quem digita só "meuclaude.local" cai no HTTPS. Sem o
 * setup, nada é publicado além da 4747.
 */
export function remotePortsFrom(env: string): string[] {
  if (!readEnvValue(env, 'HABBLAUD_REMOTE_USER')) return [];
  const bind = readEnvValue(env, 'HABBLAUD_REMOTE_BIND') || '127.0.0.1';
  const valid = (n: number) => Number.isInteger(n) && n > 0 && n < 65536;
  const raw = readEnvValue(env, 'HABBLAUD_REMOTE_PORT');
  const port = raw ? Number(raw) : 4748;
  const out = valid(port) ? [`${bind}:${port}:4748`] : [];
  const http = Number(readEnvValue(env, 'HABBLAUD_REMOTE_HTTP_PORT'));
  if (valid(http) && http !== port) out.push(`${bind}:${http}:4748`);
  return out;
}

function remoteInsecure(): boolean {
  try {
    const env = readFileSync(ENV_FILE, 'utf8');
    return !!readEnvValue(env, 'HABBLAUD_REMOTE_USER') && /^(1|true|yes|sim|on)$/i.test(readEnvValue(env, 'HABBLAUD_REMOTE_INSECURE_HTTP') ?? '');
  } catch {
    return false;
  }
}

function remotePortsToPublish(): string[] {
  try {
    const ports = remotePortsFrom(readFileSync(ENV_FILE, 'utf8'));
    for (const p of ports) say(tr('Acesso remoto: publica {0} (porta {1} do container).', [p.split(':').slice(0, 2).join(':'), 4748]));
    return ports;
  } catch {
    return [];
  }
}

function statOk(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Atualiza o mod de quem já instalou (ver mod-install.ts). Nada aqui derruba o docker:up. */
function updateMods(dirs: string[], accounts: DetectedAccount[]): Pick<ModUpdateResult, 'installed' | 'unavailable'> {
  try {
    const labels = dirs.map((dir, i) => ({ dir, label: tr('Conta {0}', [accounts[i]?.short ?? tildify(dir)]) }));
    const mod = updateInstalledMods(labels, { env: process.env, home: HOME, root: ROOT, version: readPackageVersion(ROOT), claude: makeClaudeRunner() });
    for (const l of mod.lines) {
      if (l.level === 'warn') warn(l.text);
      else say(`  ${l.text}`);
    }
    return mod;
  } catch (err) {
    warn(tr('não consegui conferir o mod do Habblaud ({0}).', [(err as Error).message]));
    return { installed: false, unavailable: true };
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  const port = hostPort(process.env);
  if (opts.down) down(port);
  else await up(opts, port);
}

// Executa só quando chamado direto (importar o módulo, ex. em testes, não sobe nada).
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err: unknown) => {
    if (err instanceof FatalError) console.error(tr('[docker-up] Erro: {0}', [err.message]));
    else console.error(tr('[docker-up] Erro inesperado:'), err);
    process.exitCode = 1;
  });
}
