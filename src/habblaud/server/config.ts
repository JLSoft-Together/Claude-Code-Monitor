// Configuração do servidor a partir das variáveis de ambiente (documentadas em server/README.md).
import { existsSync, readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverClaudeDirs } from './accounts/detect';
import { parseAllowedHosts } from './http/guard';
import { parseRemoteConfig, type RemoteConfig } from './http/remote';
import { parseGithubRepo } from './updates/checker';
import { tr } from '../shared/i18n';

export interface ServerConfig {
  port: number;
  host: string;
  /** `--dev`: Vite em middleware mode (HMR) no mesmo servidor. */
  dev: boolean;
  /** Liga o simulador de demonstração ao iniciar. */
  demo: boolean;
  /** Rodando dentro de um container (PIDs do registro são do host: não dá para checá-los). */
  inDocker: boolean;
  home: string;
  /** Config dirs do Claude Code observados (um por conta). */
  claudeDirs: string[];
  /** Onde o Habblaud guarda o próprio estado (nomes persistidos). */
  dataDir: string;
  /**
   * Pasta com o uso capturado pelo statusline do Claude Code (scripts/statusline-tap.mjs):
   * HABBLAUD_USAGE_DIR ou ~/.habblaud/usage. No Docker, o docker-up monta essa pasta em /usage.
   */
  usageDir: string;
  /** Nomes extras aceitos no cabeçalho Host/Origin (HABBLAUD_ALLOWED_HOSTS); localhost e IPs sempre valem. */
  allowedHosts: Set<string>;
  /**
   * Terminal (GET /api/agents/:id/terminal) ligado: só com bind local, isto é, com o Habblaud acessível apenas
   * pelo próprio computador (ver terminalOffReason). É a trava de tudo o que mostra ou age sobre as sessões.
   */
  terminal: boolean;
  /**
   * Mensagens pelo escritório (POST /api/messages e a caixa de entrada do plugin habblaud-mensagens) ligadas: a
   * trava do terminal e HABBLAUD_MENSAGENS sem desligar (ver messagesOffReason).
   */
  messages: boolean;
  /** Grava a linha do tempo do escritório para o timelapse (<dataDir>/timeline); HABBLAUD_TIMELINE=0 desliga. */
  timeline: boolean;
  /** Raiz do projeto (onde fica o package.json); serve dist/client a partir daqui. */
  rootDir: string;
  version: string;
  /** Repositório no GitHub ("dono/nome", do campo `repository` do package.json) onde saem as versões novas. */
  repo?: string;
  /** Consulta o GitHub atrás de versão nova (server/updates/checker.ts); HABBLAUD_UPDATE_CHECK=0 desliga. */
  updateCheck: boolean;
  /** Observa as sessões do Codex (sources/codex/); HABBLAUD_CODEX=0 desliga. */
  codex: boolean;
  /** Segunda porta, com login, para o celular na rede local (http/remote.ts); ausente = desligada. */
  remote?: RemoteConfig;
  /** Por que o acesso remoto ficou desligado quando as variáveis estão incompletas. */
  remoteWarning?: string;
  /** Habblaud World (server/world/): conta, personagem e, nas próximas fases, o prédio no mundo. */
  world: WorldConfig;
}

export interface WorldConfig {
  /** HABBLAUD_WORLD diferente de 0 (false, off, no): as rotas /api/world/* existem e a interface mostra a seção. */
  enabled: boolean;
  /**
   * Base HTTP(S) do servidor do mundo, sem barra no fim (de HABBLAUD_WORLD_URL ou, sem ela, DEFAULT_WORLD_URL;
   * `wss://` vira `https://`). Ausente = HABBLAUD_WORLD_URL recusada (`warning` diz por quê): o recurso fica desligado
   * e nada sai do computador. O WebSocket é a mesma origem com /v1/socket.
   */
  url?: string;
  /** A URL veio do padrão (HABBLAUD_WORLD_URL ausente ou vazia). */
  defaultUrl?: true;
  /**
   * `--dev` ou HABBLAUD_WORLD_DEV=1: aceita também `http://` e `ws://` para 127.0.0.1 e host.docker.internal (servidor do
   * mundo local; do container do Habblaud, o host é host.docker.internal).
   */
  dev: boolean;
  /** Por que HABBLAUD_WORLD_URL foi recusada (vai para o log ao iniciar). */
  warning?: string;
}

export function isTruthy(v: string | undefined): boolean {
  return !!v && /^(1|true|yes|sim|on)$/i.test(v.trim());
}

/** Sobe a partir de `from` até achar o package.json do projeto. */
export function findRoot(from: string): string {
  let dir = from;
  for (let i = 0; i < 6; i++) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        const name = (JSON.parse(readFileSync(pkg, 'utf8')) as { name?: unknown }).name;
        if (name === 'habblaud') return dir;
      } catch {
        // package.json ilegível: continua subindo
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(from, '..');
}

/** Versão e repositório do package.json. */
function readPackage(rootDir: string): { version: string; repo?: string } {
  try {
    const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')) as { version?: unknown; repository?: unknown };
    return { version: typeof pkg.version === 'string' ? pkg.version : '0.0.0', repo: parseGithubRepo(pkg.repository) };
  } catch {
    return { version: '0.0.0' };
  }
}

export function detectDocker(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.HABBLAUD_IN_DOCKER !== undefined) return isTruthy(env.HABBLAUD_IN_DOCKER);
  return existsSync('/.dockerenv');
}

/**
 * Endereço de escuta que só o próprio computador alcança: 127.0.0.0/8, `::1` (com ou sem colchetes)
 * ou `localhost`. `0.0.0.0`, `::`, IPs de rede e nomes quaisquer não contam.
 */
export function isLoopbackBind(value: string | undefined): boolean {
  let v = value?.trim().toLowerCase() ?? '';
  if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1);
  if (v === 'localhost') return true;
  const family = isIP(v);
  if (family === 4) return v.startsWith('127.');
  if (family !== 6) return false;
  try {
    // Forma canônica (0:0:0:0:0:0:0:1 -> [::1]).
    return new URL(`http://[${v}]/`).hostname === '[::1]';
  } catch {
    return false;
  }
}

/**
 * Por que o terminal fica desligado (undefined = ligado). Os transcripts têm a conversa inteira, então ele
 * só liga quando o Habblaud não fica exposto além do próprio computador:
 * - Node: o HABBLAUD_HOST precisa ser loopback;
 * - Docker: o processo sempre escuta em 0.0.0.0 dentro do container e quem decide a exposição é a porta
 *   publicada no host, HABBLAUD_BIND (o docker-compose.yml repassa o mesmo valor ao container). Ausente
 *   ou vazia = desligado: sem ela não dá para saber se a porta está exposta.
 * HABBLAUD_TERMINAL com qualquer valor que não seja "ligado" (0, false, off...) desliga; não existe forma
 * de ligar com a porta exposta.
 */
export function terminalOffReason(env: NodeJS.ProcessEnv, host: string, inDocker: boolean): string | undefined {
  const flag = env.HABBLAUD_TERMINAL?.trim();
  if (flag && !isTruthy(flag)) return `HABBLAUD_TERMINAL=${flag}`;
  if (inDocker) {
    const bind = env.HABBLAUD_BIND?.trim();
    if (!bind) return tr('HABBLAUD_BIND não chegou ao container, então a porta pode estar exposta na rede');
    return isLoopbackBind(bind) ? undefined : tr('a porta está exposta na rede: HABBLAUD_BIND={0}', [bind]);
  }
  return isLoopbackBind(host) ? undefined : tr('a porta está exposta na rede: HABBLAUD_HOST={0}', [host]);
}

/**
 * Por que as mensagens pelo escritório ficam desligadas (undefined = ligadas). Elas entram na sessão como se você
 * as tivesse digitado, então seguem a trava do terminal; HABBLAUD_MENSAGENS com qualquer valor que não seja
 * "ligado" (0, false, off, no...) desliga só elas.
 */
export function messagesOffReason(env: NodeJS.ProcessEnv, host: string, inDocker: boolean): string | undefined {
  const flag = env.HABBLAUD_MENSAGENS?.trim();
  if (flag && !isTruthy(flag)) return `HABBLAUD_MENSAGENS=${flag}`;
  const terminal = terminalOffReason(env, host, inDocker);
  return terminal ? tr('mesma trava do terminal: {0}', [terminal]) : undefined;
}

/**
 * O servidor do Habblaud World quando HABBLAUD_WORLD_URL está ausente ou vazia: o World vem ligado por padrão, mas nada
 * sai do computador antes de a pessoa criar a conta e entrar (server/world/service.ts). HABBLAUD_WORLD=0 desliga tudo.
 */
export const DEFAULT_WORLD_URL = 'https://server.habblaud.com';

/** Hosts aceitos sem TLS no modo de desenvolvimento: o próprio computador e, de dentro do Docker, o host. */
const LOCAL_WORLD_HOSTS: readonly string[] = ['127.0.0.1', 'host.docker.internal'];

/**
 * Habblaud World a partir do ambiente. Sem HABBLAUD_WORLD_URL, DEFAULT_WORLD_URL. A URL só vale com `https://` ou
 * `wss://` (o token do dispositivo nunca anda sem TLS); `http://` e `ws://` só no modo de desenvolvimento e só para
 * 127.0.0.1 ou host.docker.internal (o servidor do mundo rodando no próprio computador, visto de fora ou de dentro do
 * Docker). Nada de caminho, usuário, senha ou parâmetros: só o endereço do servidor. Uma URL definida e recusada não
 * cai no padrão: o recurso fica desligado, com o motivo em `warning`.
 */
export function parseWorldConfig(env: NodeJS.ProcessEnv, argv: string[]): WorldConfig {
  const flag = env.HABBLAUD_WORLD?.trim();
  const enabled = !flag || isTruthy(flag);
  const dev = argv.includes('--dev') || isTruthy(env.HABBLAUD_WORLD_DEV);
  if (!enabled) return { enabled, dev };
  const raw = env.HABBLAUD_WORLD_URL?.trim();
  if (!raw) return { enabled, dev, url: DEFAULT_WORLD_URL, defaultUrl: true };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { enabled, dev, warning: tr('HABBLAUD_WORLD_URL não é um endereço válido') };
  }
  const secure = u.protocol === 'https:' || u.protocol === 'wss:';
  const local = (u.protocol === 'http:' || u.protocol === 'ws:') && LOCAL_WORLD_HOSTS.includes(u.hostname);
  if (!secure && !(local && dev)) {
    return {
      enabled,
      dev,
      warning: local
        ? tr('HABBLAUD_WORLD_URL com http:// (127.0.0.1 ou host.docker.internal) só vale no modo de desenvolvimento (--dev ou HABBLAUD_WORLD_DEV=1)')
        : tr('HABBLAUD_WORLD_URL precisa começar com https:// ou wss://'),
    };
  }
  if (u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) {
    return { enabled, dev, warning: tr('HABBLAUD_WORLD_URL deve ter só o endereço do servidor (sem caminho, usuário, senha ou parâmetros)') };
  }
  return { enabled, dev, url: `${secure ? 'https:' : 'http:'}//${u.host}` };
}

/** Endereço do WebSocket do mundo a partir da base HTTP(S) (ServerConfig.world.url). */
export function worldSocketUrl(base: string): string {
  return `${base.replace(/^http/, 'ws').replace(/\/+$/, '')}/v1/socket`;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv): ServerConfig {
  const home = env.HOME || homedir();
  const inDocker = detectDocker(env);
  const port = Number.parseInt(env.HABBLAUD_PORT ?? '', 10);
  const rootDir = findRoot(dirname(fileURLToPath(import.meta.url)));
  const host = env.HABBLAUD_HOST?.trim() || '127.0.0.1';
  const pkg = readPackage(rootDir);
  const remote = parseRemoteConfig(env, inDocker);
  return {
    port: Number.isFinite(port) && port > 0 && port < 65536 ? port : 4747,
    host,
    dev: argv.includes('--dev'),
    demo: isTruthy(env.HABBLAUD_DEMO),
    inDocker,
    home,
    claudeDirs: discoverClaudeDirs(env, home),
    dataDir: resolve(env.HABBLAUD_DATA_DIR?.trim() || (inDocker ? '/data' : join(home, '.habblaud'))),
    usageDir: resolve(env.HABBLAUD_USAGE_DIR?.trim() || join(home, '.habblaud', 'usage')),
    allowedHosts: parseAllowedHosts(env.HABBLAUD_ALLOWED_HOSTS),
    terminal: terminalOffReason(env, host, inDocker) === undefined,
    messages: messagesOffReason(env, host, inDocker) === undefined,
    timeline: !env.HABBLAUD_TIMELINE?.trim() || isTruthy(env.HABBLAUD_TIMELINE),
    rootDir,
    version: pkg.version,
    repo: pkg.repo,
    updateCheck: !env.HABBLAUD_UPDATE_CHECK?.trim() || isTruthy(env.HABBLAUD_UPDATE_CHECK),
    codex: !env.HABBLAUD_CODEX?.trim() || isTruthy(env.HABBLAUD_CODEX),
    remote: remote.config,
    remoteWarning: remote.warning,
    world: parseWorldConfig(env, argv),
  };
}
