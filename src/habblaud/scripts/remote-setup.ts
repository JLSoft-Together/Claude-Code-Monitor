// npm run remote:setup — liga o acesso pelo celular com login e HTTPS, num passo só.
//
// Pergunta (ou recebe por opção) o usuário, a senha (escondida, duas vezes), o nome do endereço (<nome>.local) e, se
// quiser, um endereço próprio (ex.: meuclaude.home); e então:
//   1. cria a CA local e o certificado do servidor (server/remote/tls.ts) em ~/.habblaud/remote-tls;
//   2. grava no .env SÓ o hash scrypt da senha (nunca a senha), o nome, a porta e HABBLAUD_REMOTE_BIND=0.0.0.0;
//   3. deixa o anúncio do <nome>.local rodando como serviço (npm run remote:mdns; LaunchAgent/systemd);
//   4. mostra os endereços, a impressão digital da CA e o passo a passo do celular.
// Depois: npm run docker:up. Para desligar: npm run remote:setup -- --off.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { homedir, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { addToList, readEnvValue, updateEnv } from '../server/remote/envfile';
import { hashPassword } from '../server/remote/password';
import { tr } from '../shared/i18n';
import { caFingerprint, ensureServerCert, isValidDomain, isValidName, primaryIp, remoteTargets, remoteTlsBase, tlsPaths } from '../server/remote/tls';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = join(ROOT, '.env');
const HOME = process.env.HOME || homedir();
export const MIN_PASSWORD = 10;
const SERVICE_LABEL = 'com.habblaud.remote-mdns';
const REMOTE_KEYS = [
  'HABBLAUD_REMOTE_USER',
  'HABBLAUD_REMOTE_PASSWORD',
  'HABBLAUD_REMOTE_PASSWORD_HASH',
  'HABBLAUD_REMOTE_BIND',
  'HABBLAUD_REMOTE_PORT',
  'HABBLAUD_REMOTE_HTTP_PORT',
  'HABBLAUD_REMOTE_NAME',
  'HABBLAUD_REMOTE_DOMAIN',
  'HABBLAUD_REMOTE_ALLOW',
];

export interface SetupArgs {
  user?: string;
  name?: string;
  domain?: string;
  port?: number;
  allow?: string;
  passwordStdin: boolean;
  service: boolean;
  off: boolean;
  help: boolean;
}

const USAGE = tr(`Uso: npm run remote:setup [-- opções]

Liga o acesso pelo celular (https://<nome>.local) com usuário, senha e HTTPS.

  --user <nome>        usuário do login (padrão: o seu usuário do sistema)
  --name <nome>        endereço <nome>.local (padrão: habblaud)
  --domain <endereço>  endereço próprio, ex.: meuclaude.home (precisa de uma entrada no DNS do roteador)
  --port <n>           porta no computador (padrão: 443 se estiver livre, senão 4748)
  --allow <lista>      o que o celular pode fazer: permissions, messages, terminal, spawn, none (padrão: permissions)
  --password-stdin     lê a senha da entrada padrão (automação), em vez de perguntar
  --no-service         não instala o serviço do anúncio <nome>.local (rode npm run remote:mdns você mesmo)
  --off                desliga o acesso pelo celular (tira as linhas do .env e o serviço; mantém a CA)`);

export function parseArgs(argv: string[]): SetupArgs {
  const out: SetupArgs = { passwordStdin: false, service: true, off: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(tr('falta o valor de {0}', [a]));
      return v;
    };
    if (a === '--user') out.user = val();
    else if (a === '--name') out.name = val().toLowerCase();
    else if (a === '--domain') out.domain = val().toLowerCase();
    else if (a === '--port') out.port = Number(val());
    else if (a === '--allow') out.allow = val();
    else if (a === '--password-stdin') out.passwordStdin = true;
    else if (a === '--no-service') out.service = false;
    else if (a === '--off') out.off = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(tr('opção desconhecida: {0}', [a]));
  }
  if (out.port !== undefined && !(Number.isInteger(out.port) && out.port > 0 && out.port < 65536)) throw new Error(tr('porta inválida'));
  return out;
}

/** Por que a senha não serve (undefined = serve). */
export function passwordProblem(password: string, user: string): string | undefined {
  if (password.length < MIN_PASSWORD) return tr('use pelo menos {0} caracteres', [MIN_PASSWORD]);
  if (password.trim() !== password) return tr('sem espaços no começo ou no fim');
  if (password.toLowerCase() === user.toLowerCase()) return tr('a senha não pode ser o usuário');
  return undefined;
}

/** O .env com o acesso remoto ligado (o resto do arquivo fica igual). */
export function remoteEnv(
  current: string,
  s: { user: string; hash: string; name: string; domain?: string; port: number; httpPort?: number; allow?: string },
): string {
  const hosts = addToList(readEnvValue(current, 'HABBLAUD_ALLOWED_HOSTS'), `${s.name}.local`, ...(s.domain ? [s.domain] : []));
  return updateEnv(current, {
    HABBLAUD_REMOTE_USER: s.user,
    HABBLAUD_REMOTE_PASSWORD: null,
    HABBLAUD_REMOTE_PASSWORD_HASH: s.hash,
    HABBLAUD_REMOTE_BIND: '0.0.0.0',
    HABBLAUD_REMOTE_PORT: String(s.port),
    HABBLAUD_REMOTE_HTTP_PORT: s.httpPort ? String(s.httpPort) : null,
    HABBLAUD_REMOTE_NAME: s.name,
    HABBLAUD_REMOTE_DOMAIN: s.domain ?? null,
    HABBLAUD_REMOTE_ALLOW: s.allow ?? readEnvValue(current, 'HABBLAUD_REMOTE_ALLOW') ?? null,
    HABBLAUD_ALLOWED_HOSTS: hosts,
  });
}

export function urlFor(host: string, port: number): string {
  return port === 443 ? `https://${host}` : `https://${host}:${port}`;
}

function portFree(port: number): Promise<boolean> {
  return new Promise((ok) => {
    const srv = net.createServer();
    srv.once('error', () => ok(false));
    srv.listen(port, '0.0.0.0', () => srv.close(() => ok(true)));
  });
}

function ask(question: string, fallback?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((ok) =>
    rl.question(fallback ? `${question} [${fallback}]: ` : `${question}: `, (a) => {
      rl.close();
      ok(a.trim() || fallback || '');
    }),
  );
}

/** Pergunta sem ecoar o que é digitado (só no terminal de verdade). */
function askHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) throw new Error(tr('sem terminal para perguntar a senha: use --password-stdin'));
  return new Promise((ok) => {
    process.stdout.write(`${question}: `);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buf = '';
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          ok(buf);
          return;
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          process.stdout.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') buf = buf.slice(0, -1);
        else if (ch >= ' ') buf += ch;
      }
    };
    stdin.on('data', onData);
  });
}

function readStdinLine(): Promise<string> {
  return new Promise((ok) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c: string) => (data += c));
    process.stdin.on('end', () => ok(data.split(/\r?\n/)[0] ?? ''));
  });
}

function writeEnv(content: string): void {
  writeFileSync(ENV_FILE, content, { mode: 0o600 });
  chmodSync(ENV_FILE, 0o600);
}

function tsxCommand(): string[] {
  return [process.execPath, join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(ROOT, 'scripts', 'remote-mdns.ts')];
}

function plistPath(): string {
  return join(HOME, 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`);
}

function unitPath(): string {
  return join(HOME, '.config', 'systemd', 'user', 'habblaud-remote-mdns.service');
}

function xml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Instala (ou reinstala) o anúncio do <nome>.local como serviço. Devolve uma linha de status. */
function installService(): string {
  const cmd = tsxCommand();
  const logDir = join(HOME, '.habblaud', 'logs');
  mkdirSync(logDir, { recursive: true });
  const pathEnv = [dirname(process.execPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
  if (process.platform === 'darwin') {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${SERVICE_LABEL}</string>
  <key>WorkingDirectory</key><string>${xml(ROOT)}</string>
  <key>ProgramArguments</key>
  <array>${cmd.map((c) => `<string>${xml(c)}</string>`).join('')}</array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${xml(pathEnv)}</string><key>HOME</key><string>${xml(HOME)}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xml(join(logDir, 'remote-mdns.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(join(logDir, 'remote-mdns.log'))}</string>
</dict>
</plist>
`;
    mkdirSync(dirname(plistPath()), { recursive: true });
    writeFileSync(plistPath(), plist);
    const domain = `gui/${process.getuid?.() ?? userInfo().uid}`;
    spawnSync('launchctl', ['bootout', `${domain}/${SERVICE_LABEL}`], { stdio: 'ignore' });
    const r = spawnSync('launchctl', ['bootstrap', domain, plistPath()], { encoding: 'utf8' });
    return r.status === 0 ? tr('serviço {0} ligado (log: ~/.habblaud/logs/remote-mdns.log)', [SERVICE_LABEL]) : tr('não consegui ligar o serviço: {0}', [String(r.stderr).trim()]);
  }
  if (process.platform === 'linux') {
    const unit = `[Unit]
Description=${tr('Habblaud: anuncia o endereço .local do acesso pelo celular')}
After=network-online.target

[Service]
WorkingDirectory=${ROOT}
Environment=PATH=${pathEnv}
ExecStart=${cmd.map((c) => (/\s/.test(c) ? `"${c}"` : c)).join(' ')}
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
`;
    mkdirSync(dirname(unitPath()), { recursive: true });
    writeFileSync(unitPath(), unit);
    spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
    const r = spawnSync('systemctl', ['--user', 'enable', '--now', 'habblaud-remote-mdns.service'], { encoding: 'utf8' });
    return r.status === 0
      ? tr('serviço habblaud-remote-mdns ligado (para seguir ligado sem login: loginctl enable-linger)')
      : tr('não consegui ligar o serviço: {0}', [String(r.stderr).trim()]);
  }
  return tr('{0}: sem serviço automático; deixe npm run remote:mdns rodando ou use o IP', [process.platform]);
}

function removeService(): void {
  if (process.platform === 'darwin' && existsSync(plistPath())) {
    spawnSync('launchctl', ['bootout', `gui/${process.getuid?.() ?? userInfo().uid}/${SERVICE_LABEL}`], { stdio: 'ignore' });
    rmSync(plistPath(), { force: true });
  }
  if (process.platform === 'linux' && existsSync(unitPath())) {
    spawnSync('systemctl', ['--user', 'disable', '--now', 'habblaud-remote-mdns.service'], { stdio: 'ignore' });
    rmSync(unitPath(), { force: true });
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return void console.log(USAGE);
  const current = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : '';

  if (args.off) {
    writeEnv(updateEnv(current, Object.fromEntries(REMOTE_KEYS.map((k) => [k, null]))));
    removeService();
    console.log(tr('[remote-setup] Acesso pelo celular desligado (a CA continua em ~/.habblaud/remote-tls). Agora: npm run docker:up'));
    return;
  }

  const user = args.user ?? (args.passwordStdin ? undefined : await ask(tr('Usuário do login'), readEnvValue(current, 'HABBLAUD_REMOTE_USER') ?? userInfo().username));
  if (!user || /\s/.test(user)) throw new Error(tr('usuário inválido (sem espaços)'));

  let password: string;
  if (args.passwordStdin) {
    password = await readStdinLine();
    const problem = passwordProblem(password, user);
    if (problem) throw new Error(tr('senha recusada: {0}', [problem]));
  } else {
    for (;;) {
      password = await askHidden(tr('Senha ({0}+ caracteres; não aparece enquanto você digita)', [MIN_PASSWORD]));
      const problem = passwordProblem(password, user);
      if (problem) {
        console.log(`  ${problem}.`);
        continue;
      }
      if ((await askHidden(tr('Repita a senha'))) !== password) {
        console.log(tr('  as duas não batem; de novo.'));
        continue;
      }
      break;
    }
  }

  const name = args.name ?? (args.passwordStdin ? 'habblaud' : await ask(tr('Nome do endereço (vira <nome>.local)'), readEnvValue(current, 'HABBLAUD_REMOTE_NAME') ?? 'habblaud')).toLowerCase();
  if (!isValidName(name)) throw new Error(tr('nome inválido: "{0}" (letras, números e hífen)', [name]));
  const domainAnswer =
    args.domain ??
    (args.passwordStdin ? '' : await ask(tr('Endereço próprio, opcional (ex.: meuclaude.home; Enter pula)'), readEnvValue(current, 'HABBLAUD_REMOTE_DOMAIN') ?? ''));
  const domain = domainAnswer.trim().toLowerCase() || undefined;
  if (domain && !isValidDomain(domain)) throw new Error(tr('endereço inválido: "{0}"', [domain]));

  const existingPort = Number(readEnvValue(current, 'HABBLAUD_REMOTE_PORT'));
  const port = args.port ?? (Number.isInteger(existingPort) && existingPort > 0 ? existingPort : (await portFree(443)) ? 443 : 4748);

  // Na 443, a 80 (se livre) só redireciona para https://: digitar "meuclaude.local" sem https:// também funciona.
  const existingHttp = Number(readEnvValue(current, 'HABBLAUD_REMOTE_HTTP_PORT'));
  const httpPort = port !== 443 ? undefined : existingHttp === 80 || (await portFree(80)) ? 80 : undefined;

  console.log(tr('[remote-setup] Gerando o hash da senha…'));
  const hash = await hashPassword(password);
  const paths = tlsPaths(remoteTlsBase(HOME));
  const hadCa = caFingerprint(paths);
  const cert = ensureServerCert(paths, remoteTargets({ name, domain }), { force: true, newCa: true });
  writeEnv(remoteEnv(current, { user, hash, name, domain, port, httpPort, allow: args.allow }));
  const service = args.service ? installService() : tr('serviço não instalado (--no-service): rode npm run remote:mdns');

  const fp = caFingerprint(paths);
  // O IP do Wi-Fi/cabo (rota padrão), não o de uma VPN que também entra no certificado.
  const ip = primaryIp() ?? cert.targets.ips.find((i) => i !== '127.0.0.1');
  const caNote = !cert.createdCa ? '' : hadCa ? tr(' CA local nova (o endereço mudou ou a anterior não tinha restrição de nomes): instale o certificado de novo no celular.') : tr(' CA local criada.');
  const urls = [
    `${urlFor(`${name}.local`, port)}${ip ? tr('   (ou {0})', [urlFor(ip, port)]) : ''}`,
    ...(domain ? [tr('{0}   (depois de criar no roteador: {1} -> {2})', [urlFor(domain, port), domain, ip ?? tr('IP deste computador')])] : []),
  ];
  console.log(
    [
      '',
      tr('[remote-setup] Pronto.{0}', [caNote]),
      tr('  .env:        usuário "{0}", senha guardada só como hash (scrypt), porta {1}', [user, port]),
      tr('  Certificado: {0}', [cert.targets.dns.concat(cert.targets.ips).join(', ')]),
      tr('  Anúncio:     {0}', [service]),
      '',
      tr('  Agora rode:  npm run docker:up'),
      '',
      tr('  No celular (mesmo Wi-Fi):'),
      ...urls.map((u) => `    ${u}`),
      tr('  Primeira vez: aceite o aviso, toque em "Instale o certificado do Habblaud" e confie nele'),
      tr('    iPhone:  Ajustes > Perfil Baixado > Instalar; depois Ajustes > Geral > Sobre > Ajustes de Confiança de Certificados'),
      tr('    Android: Configurações > Segurança > Criptografia e credenciais > Instalar certificado > Certificado de CA'),
      tr('  Impressão digital da CA (confira no celular antes de confiar):'),
      `    ${fp ?? tr('(indisponível)')}`,
    ].join('\n'),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err: unknown) => {
    console.error(tr('[remote-setup] Erro: {0}', [(err as Error).message]));
    process.exitCode = 1;
  });
}
