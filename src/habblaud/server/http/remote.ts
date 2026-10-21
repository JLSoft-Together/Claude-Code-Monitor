// Acesso remoto autenticado (celular na mesma rede): uma SEGUNDA porta, com usuário, senha e HTTPS.
//
// A porta principal continua só no loopback (hooks, plugins e o navegador do próprio computador, sem login). A porta
// remota aceita qualquer endereço, mas TODA requisição nela passa por aqui antes da API: sem o cookie de sessão, a
// página vira a tela de login e a API responde 401. O que separa "local" de "remoto" é a porta em que a conexão
// chegou, nunca o cabeçalho Host (que um cliente da rede imita à vontade).
//
// Configuração (escrita por `npm run remote:setup`, scripts/remote-setup.ts):
//   HABBLAUD_REMOTE_USER + HABBLAUD_REMOTE_PASSWORD_HASH  ligam a porta (o hash é scrypt, ver remote/password.ts;
//                                                         senha em texto puro não é aceita)
//   HABBLAUD_REMOTE_ALLOW   o que a sessão remota pode fazer além de ver: permissions, messages, terminal ("none" = só
//                           ver). Padrão: permissions.
//   HABBLAUD_REMOTE_TLS_DIR pasta com server.key, server.crt (e ca.crt, servido em /remote/ca.crt). Padrão:
//                           /remote-tls no Docker, ~/.habblaud/remote-tls/server no Node. Sem certificado a porta não
//                           sobe, a menos que HABBLAUD_REMOTE_INSECURE_HTTP=1 (HTTP puro: senha e cookie à vista na rede).
//   HABBLAUD_REMOTE_PORT / HABBLAUD_REMOTE_HOST  só no Node (padrão 0.0.0.0:4748); no Docker o container escuta sempre
//                           em 0.0.0.0:4748 e quem decide a exposição é a porta publicada (HABBLAUD_REMOTE_BIND).
//
// Sessão: cookie HttpOnly + SameSite=Strict (+ Secure com HTTPS) assinado com HMAC; chave = segredo aleatório em
// <dataDir>/remote-secret misturado com usuário e hash da senha: trocar a senha derruba todas as sessões.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unwatchFile, watchFile, writeFileSync } from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parsePasswordHash, verifyPassword, type PasswordHash } from '../remote/password';
import { hostAllowed } from './guard';
import { getLocale, tr } from '../../shared/i18n';

export type RemoteFeature = 'permissions' | 'messages' | 'terminal' | 'spawn';

const FEATURES: readonly RemoteFeature[] = ['permissions', 'messages', 'terminal', 'spawn'];

export interface RemoteTls {
  dir: string;
  keyFile: string;
  certFile: string;
  caFile: string;
}

export interface RemoteConfig {
  port: number;
  host: string;
  user: string;
  passwordHash: PasswordHash;
  /** Texto do hash como veio do ambiente (entra na chave das sessões). */
  passwordHashText: string;
  allow: ReadonlySet<RemoteFeature>;
  /** Ausente = HTTP puro (só com HABBLAUD_REMOTE_INSECURE_HTTP=1). */
  tls?: RemoteTls;
}

export const DEFAULT_REMOTE_PORT = 4748;
export const COOKIE = 'habblaud_remote';
export const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
/** Prazo para o primeiro byte de uma conexão na porta remota (antes de saber se é HTTPS). */
const FIRST_BYTE_MS = 15_000;

function truthy(v: string | undefined): boolean {
  return !!v && /^(1|true|yes|sim|on)$/i.test(v.trim());
}

export function defaultTlsDir(env: NodeJS.ProcessEnv, inDocker: boolean): string {
  if (env.HABBLAUD_REMOTE_TLS_DIR?.trim()) return env.HABBLAUD_REMOTE_TLS_DIR.trim();
  return inDocker ? '/remote-tls' : join(env.HOME || homedir(), '.habblaud', 'remote-tls', 'server');
}

/** Liga o acesso remoto a partir do ambiente. `warning` explica por que ficou desligado quando parece intencional. */
export function parseRemoteConfig(
  env: NodeJS.ProcessEnv,
  inDocker: boolean,
  exists: (path: string) => boolean = existsSync,
): { config?: RemoteConfig; warning?: string } {
  const user = env.HABBLAUD_REMOTE_USER?.trim() ?? '';
  const hashText = env.HABBLAUD_REMOTE_PASSWORD_HASH?.trim() ?? '';
  const plain = env.HABBLAUD_REMOTE_PASSWORD ?? '';
  if (!user && !hashText && !plain) return {};
  if (plain && !hashText) return { warning: tr('acesso remoto desligado: senha em texto puro (HABBLAUD_REMOTE_PASSWORD) não é aceita; rode npm run remote:setup') };
  if (!user || !hashText) return { warning: tr('acesso remoto desligado: faltam HABBLAUD_REMOTE_USER e HABBLAUD_REMOTE_PASSWORD_HASH; rode npm run remote:setup') };
  const passwordHash = parsePasswordHash(hashText);
  if (!passwordHash) return { warning: tr('acesso remoto desligado: HABBLAUD_REMOTE_PASSWORD_HASH inválido; rode npm run remote:setup') };
  const dir = defaultTlsDir(env, inDocker);
  const tls: RemoteTls = { dir, keyFile: join(dir, 'server.key'), certFile: join(dir, 'server.crt'), caFile: join(dir, 'ca.crt') };
  const hasTls = exists(tls.keyFile) && exists(tls.certFile);
  const insecure = truthy(env.HABBLAUD_REMOTE_INSECURE_HTTP);
  if (!hasTls && !insecure) return { warning: tr('acesso remoto desligado: sem certificado em {0} (HTTPS é obrigatório); rode npm run remote:setup', [dir]) };
  const rawPort = Number.parseInt(env.HABBLAUD_REMOTE_PORT ?? '', 10);
  const port = inDocker ? DEFAULT_REMOTE_PORT : Number.isInteger(rawPort) && rawPort > 0 && rawPort < 65536 ? rawPort : DEFAULT_REMOTE_PORT;
  const host = inDocker ? '0.0.0.0' : env.HABBLAUD_REMOTE_HOST?.trim() || '0.0.0.0';
  return {
    config: { port, host, user, passwordHash, passwordHashText: hashText, allow: parseAllow(env.HABBLAUD_REMOTE_ALLOW), tls: hasTls ? tls : undefined },
  };
}

export function parseAllow(raw: string | undefined): Set<RemoteFeature> {
  if (raw === undefined || !raw.trim()) return new Set<RemoteFeature>(['permissions']);
  const out = new Set<RemoteFeature>();
  for (const part of raw.split(',')) {
    const p = part.trim().toLowerCase();
    if ((FEATURES as readonly string[]).includes(p)) out.add(p as RemoteFeature);
  }
  return out;
}

/** Segredo de assinatura: lido de `file` ou criado (32 bytes, permissão 600). Sem disco gravável, vale só nesta execução. */
export function loadSecret(file: string): Buffer {
  try {
    if (existsSync(file)) {
      const hex = readFileSync(file, 'utf8').trim();
      if (/^[0-9a-f]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
    }
    const secret = randomBytes(32);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, secret.toString('hex'), { mode: 0o600 });
    chmodSync(file, 0o600);
    return secret;
  } catch {
    return randomBytes(32);
  }
}

/** Compara em tempo constante (os dois lados viram digests do mesmo tamanho). */
export function safeEqual(a: string, b: string): boolean {
  const h = (s: string) => createHash('sha256').update(s, 'utf8').digest();
  return timingSafeEqual(h(a), h(b));
}

export class RemoteSessions {
  private readonly key: Buffer;
  /** Assinatura -> validade dos tokens encerrados por "Sair" antes de vencer (o cookie apagado não basta: uma cópia valeria até expirar). */
  private readonly revoked = new Map<string, number>();

  constructor(
    secret: Buffer,
    cfg: Pick<RemoteConfig, 'user' | 'passwordHashText'>,
    private readonly now: () => number = Date.now,
    /** Onde a lista de tokens encerrados sobrevive a reinícios (ausente = só em memória). */
    private readonly revokedFile?: string,
  ) {
    this.key = createHmac('sha256', secret).update(`${cfg.user}\0${cfg.passwordHashText}`, 'utf8').digest();
    this.loadRevoked();
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.key).update(payload, 'utf8').digest('base64url');
  }

  issue(): { token: string; maxAgeS: number } {
    const exp = this.now() + SESSION_MS;
    const payload = `v1.${exp}`;
    return { token: `${payload}.${this.sign(payload)}`, maxAgeS: Math.floor(SESSION_MS / 1000) };
  }

  verify(token: string | undefined): boolean {
    const parsed = this.parse(token);
    return !!parsed && !this.revoked.has(parsed.sig);
  }

  /** Encerra este token (botão "Sair"); token inválido ou vencido não muda nada. */
  revoke(token: string | undefined): void {
    const parsed = this.parse(token);
    if (!parsed) return;
    const now = this.now();
    for (const [sig, exp] of this.revoked) if (exp <= now) this.revoked.delete(sig);
    this.revoked.set(parsed.sig, parsed.exp);
    this.saveRevoked();
  }

  private parse(token: string | undefined): { exp: number; sig: string } | undefined {
    if (!token) return undefined;
    const m = /^v1\.(\d{10,16})\.([A-Za-z0-9_-]{43})$/.exec(token);
    if (!m) return undefined;
    const exp = Number(m[1]);
    if (exp <= this.now()) return undefined;
    const expected = Buffer.from(this.sign(`v1.${m[1]}`));
    const got = Buffer.from(m[2]);
    return expected.length === got.length && timingSafeEqual(expected, got) ? { exp, sig: m[2] } : undefined;
  }

  private loadRevoked(): void {
    if (!this.revokedFile) return;
    try {
      const data: unknown = JSON.parse(readFileSync(this.revokedFile, 'utf8'));
      const now = this.now();
      for (const [sig, exp] of Object.entries(data as Record<string, unknown>)) {
        if (/^[A-Za-z0-9_-]{43}$/.test(sig) && typeof exp === 'number' && exp > now) this.revoked.set(sig, exp);
      }
    } catch {
      // sem arquivo (ou ilegível): ninguém encerrado ainda
    }
  }

  private saveRevoked(): void {
    if (!this.revokedFile) return;
    try {
      mkdirSync(dirname(this.revokedFile), { recursive: true });
      const tmp = `${this.revokedFile}.tmp`;
      writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.revoked)), { mode: 0o600 });
      renameSync(tmp, this.revokedFile);
    } catch {
      // segue valendo em memória até o próximo reinício
    }
  }
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

/**
 * Freio contra tentativa e erro: depois de 5 falhas seguidas, cada nova tentativa espera 2^(n-5) s (até 5 min).
 * Global, não por IP: no Docker todo cliente da rede chega com o endereço do gateway. Uma conferência de senha por vez
 * (begin/end), contada como falha desde o começo: tentativas em paralelo não passam pelo freio enquanto o scrypt roda.
 */
export class LoginThrottle {
  private failures = 0;
  private blockedUntil = 0;
  private busy = false;

  constructor(private readonly now: () => number = Date.now) {}

  /** Segundos até poder tentar de novo (0 = pode; 1 enquanto outra tentativa está em andamento). */
  retryAfter(): number {
    return Math.max(this.busy ? 1 : 0, Math.ceil((this.blockedUntil - this.now()) / 1000));
  }

  /** Começa uma tentativa (já contada como falha); false se o freio ou outra tentativa não deixam. */
  begin(): boolean {
    if (this.retryAfter() > 0) return false;
    this.busy = true;
    this.fail();
    return true;
  }

  /** Fim da tentativa começada em begin(): acertou zera o freio; errou fica a falha já contada. */
  end(ok: boolean): void {
    this.busy = false;
    if (ok) this.succeed();
  }

  fail(): void {
    this.failures++;
    if (this.failures >= 5) this.blockedUntil = this.now() + Math.min(300, 2 ** (this.failures - 5)) * 1000;
  }

  succeed(): void {
    this.failures = 0;
    this.blockedUntil = 0;
  }
}

/** Requisições que chegaram pela porta remota e passaram pelo login. */
const remoteRequests = new WeakSet<IncomingMessage>();
/** Arquivos que a porta remota serve sem login: manifesto e ícones (o celular os busca antes do login, sem o
 *  cookie). Nada da API nem do escritório. */
const PUBLIC_STATIC = /^\/(manifest\.webmanifest|assets\/brand\/[\w.@-]+\.png)$/;

export function isRemoteRequest(req: IncomingMessage): boolean {
  return remoteRequests.has(req);
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(data);
}

function readBody(req: IncomingMessage, max = 8 * 1024): Promise<string> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= max) chunks.push(c);
    });
    req.on('end', () => (size > max ? fail(new Error(tr('corpo grande demais'))) : ok(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', fail);
  });
}

export const CA_PATH = '/remote/ca.crt';

/** Texto nosso (tr) dentro do HTML: escapa o que o HTML interpretaria. */
function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function loginPage(opts: { caDownload: boolean }): string {
  const ca = opts.caDownload
    ? `<p class="ca">${esc(tr('Primeira vez neste celular?'))} <a href="${CA_PATH}" download="habblaud-ca.crt">${esc(tr('Instale o certificado do Habblaud'))}</a> ${esc(tr('para tirar o aviso de segurança (confira a impressão digital que o npm run remote:setup mostrou).'))}</p>`
    : '';
  // Dentro do <script>: JSON com "<" escapado, para nenhum texto fechar a tag.
  const js = (text: string) => JSON.stringify(text).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="${getLocale()}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${esc(tr('Habblaud · entrar'))}</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/assets/brand/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Habblaud">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #14161f; color: #e8e6df;
         font: 16px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 16px; }
  form { width: 100%; max-width: 360px; background: #1e2130; border: 2px solid #3a3f58; border-radius: 10px; padding: 24px; }
  h1 { margin: 0 0 4px; font-size: 22px; color: #f4c95d; }
  p { margin: 0 0 20px; color: #9aa0b8; font-size: 13px; }
  p.ca { margin: 20px 0 0; }
  a { color: #f4c95d; }
  code { color: #e8e6df; }
  label { display: block; font-size: 13px; color: #9aa0b8; margin: 12px 0 6px; }
  input { width: 100%; padding: 12px; font: inherit; color: inherit; background: #14161f; border: 2px solid #3a3f58; border-radius: 6px; }
  input:focus { outline: none; border-color: #f4c95d; }
  button { width: 100%; margin-top: 20px; padding: 12px; font: inherit; font-weight: 700; color: #14161f; background: #f4c95d;
           border: 0; border-radius: 6px; cursor: pointer; }
  button:disabled { opacity: .6; cursor: wait; }
  #err { min-height: 20px; margin-top: 12px; color: #ff8a80; font-size: 13px; }
</style>
</head>
<body>
<form id="f" autocomplete="on">
  <h1>Habblaud</h1>
  <p>${esc(tr('Acesso pelo celular. Entre com o usuário e a senha que você escolheu no npm run remote:setup.'))}</p>
  <label for="u">${esc(tr('Usuário'))}</label>
  <input id="u" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required>
  <label for="p">${esc(tr('Senha'))}</label>
  <input id="p" name="password" type="password" autocomplete="current-password" required>
  <button id="b" type="submit">${esc(tr('Entrar'))}</button>
  <div id="err" role="alert"></div>
  ${ca}
</form>
<script>
  const f = document.getElementById('f'), b = document.getElementById('b'), err = document.getElementById('err');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    b.disabled = true; err.textContent = '';
    try {
      const r = await fetch('/api/remote/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', body: JSON.stringify({ user: f.username.value, password: f.password.value }) });
      if (r.ok) { location.replace('/'); return; }
      const body = await r.json().catch(() => ({}));
      err.textContent = body.error || ${js(tr('Não deu para entrar.'))};
    } catch { err.textContent = ${js(tr('Sem conexão com o Habblaud.'))}; }
    b.disabled = false;
  });
</script>
</body>
</html>
`;
}

function sendHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(html);
}

function cookieHeader(value: string, maxAgeS: number, secure: boolean): string {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeS}${secure ? '; Secure' : ''}`;
}

export interface RemoteGateDeps {
  config: Pick<RemoteConfig, 'user' | 'passwordHash'>;
  sessions: RemoteSessions;
  /** Cookie com Secure (a porta fala HTTPS). */
  secure: boolean;
  /** Arquivo da CA pública servido em /remote/ca.crt (ausente = sem download). */
  caFile?: string;
  throttle?: LoginThrottle;
  /** Conferência da senha (injetável nos testes; padrão: scrypt). */
  verify?: (password: string, hash: PasswordHash) => Promise<boolean>;
}

/**
 * Filtro da porta remota, depois do guard (Host/Origin/JSON) e antes da API: devolve true quando já respondeu (login,
 * logout, 401, redirecionamento, CA) e false quando a requisição está autenticada — e então a marca como remota.
 */
export function createRemoteGate(deps: RemoteGateDeps): (req: IncomingMessage, res: ServerResponse, url: URL) => boolean {
  const throttle = deps.throttle ?? new LoginThrottle();
  const verify = deps.verify ?? verifyPassword;
  const caAvailable = () => !!deps.caFile && existsSync(deps.caFile);
  return (req, res, url) => {
    const path = url.pathname;
    const method = req.method ?? 'GET';
    const authed = deps.sessions.verify(readCookie(req.headers.cookie, COOKIE));

    if (path === '/api/remote/login') {
      if (method !== 'POST') {
        sendJson(res, 405, { error: tr('método não permitido') }, { Allow: 'POST' });
        return true;
      }
      const tooMany = () => {
        const wait = Math.max(1, throttle.retryAfter());
        sendJson(res, 429, { error: tr('Muitas tentativas. Tente de novo em {0} s.', [wait]) }, { 'Retry-After': String(wait) });
      };
      if (throttle.retryAfter() > 0) {
        req.resume();
        tooMany();
        return true;
      }
      // A tentativa só começa (e ocupa o freio) com o corpo inteiro na mão: um corpo que nunca termina não trava o
      // login de mais ninguém.
      let begun = false;
      let ok = false;
      readBody(req)
        .then(async (raw) => {
          if (!throttle.begin()) return tooMany();
          begun = true;
          let body: { user?: unknown; password?: unknown } = {};
          try {
            body = JSON.parse(raw) as typeof body;
          } catch {
            // corpo inválido: cai na recusa abaixo
          }
          const user = typeof body.user === 'string' ? body.user : '';
          const password = typeof body.password === 'string' ? body.password : '';
          // O scrypt roda sempre (sem atalho que denuncie se foi o usuário ou a senha que errou).
          const okPassword = await verify(password, deps.config.passwordHash);
          const okUser = safeEqual(user.trim(), deps.config.user);
          if (!(okUser && okPassword)) return sendJson(res, 401, { error: tr('Usuário ou senha incorretos.') });
          ok = true;
          const { token, maxAgeS } = deps.sessions.issue();
          sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(token, maxAgeS, deps.secure) });
        })
        .catch(() => {
          if (!res.headersSent) sendJson(res, 400, { error: tr('requisição inválida') });
        })
        .finally(() => {
          if (begun) throttle.end(ok);
        });
      return true;
    }

    if (path === '/api/remote/logout') {
      req.resume();
      if (method !== 'POST') sendJson(res, 405, { error: tr('método não permitido') }, { Allow: 'POST' });
      else {
        deps.sessions.revoke(readCookie(req.headers.cookie, COOKIE));
        sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader('', 0, deps.secure) });
      }
      return true;
    }

    if (path === CA_PATH) {
      // Público de propósito: é só o certificado da CA (a chave nunca sai do computador).
      req.resume();
      if (!caAvailable()) sendJson(res, 404, { error: tr('sem certificado da CA') });
      else {
        const pem = readFileSync(deps.caFile!);
        res.writeHead(200, {
          'Content-Type': 'application/x-x509-ca-cert',
          'Content-Disposition': 'attachment; filename="habblaud-ca.crt"',
          'Content-Length': pem.length,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(pem);
      }
      return true;
    }

    if (path === '/login') {
      req.resume();
      if (authed) {
        res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store' });
        res.end();
      } else sendHtml(res, loginPage({ caDownload: caAvailable() }));
      return true;
    }

    if (authed) {
      remoteRequests.add(req);
      return false;
    }
    // Ícone e manifesto do app (Tela de Início): públicos, o celular os busca antes do login (e sem o cookie).
    if ((method === 'GET' || method === 'HEAD') && PUBLIC_STATIC.test(path)) {
      remoteRequests.add(req);
      return false;
    }

    req.resume();
    if (path === '/api' || path.startsWith('/api/')) {
      sendJson(res, 401, { error: tr('faça login: abra o Habblaud por esta porta no navegador e entre com usuário e senha') });
    } else {
      res.writeHead(302, { Location: '/login', 'Cache-Control': 'no-store' });
      res.end();
    }
    return true;
  };
}

export interface RemoteListener {
  /** O que escuta a porta (TCP com HTTPS + redirecionamento, ou HTTP puro). */
  server: net.Server;
  close(): void;
}

/**
 * Sobe a porta remota. Com HTTPS, um servidor TCP olha o primeiro byte de cada conexão: 0x16 (TLS ClientHello) vai para
 * o HTTPS; qualquer outra coisa é HTTP digitado sem "s" e recebe 308 para https://. O certificado é recarregado sozinho
 * quando o arquivo muda (npm run remote:setup ou a renovação do docker:up), sem derrubar quem está conectado.
 */
export function startRemoteListener(
  cfg: Pick<RemoteConfig, 'port' | 'host' | 'tls'>,
  onRequest: (req: IncomingMessage, res: ServerResponse) => void,
  log: { info(m: string): void; warn(m: string): void; error(m: string): void },
  allowedHosts: ReadonlySet<string> = new Set(),
): RemoteListener {
  if (!cfg.tls) {
    const plain = http.createServer(onRequest);
    plain.on('error', (err) => log.error(tr('Acesso remoto: não deu para escutar na porta {0} ({1}).', [cfg.port, (err as Error).message])));
    plain.listen(cfg.port, cfg.host);
    return { server: plain, close: () => plain.close() };
  }
  const tls = cfg.tls;
  const read = () => ({ key: readFileSync(tls.keyFile), cert: readFileSync(tls.certFile) });
  const secure = https.createServer(read(), onRequest);
  secure.on('tlsClientError', () => {
    // Celular que ainda não confia na CA fecha o aperto de mão: normal até instalar o certificado.
  });
  const reload = () => {
    try {
      secure.setSecureContext(read());
      log.info(tr('   Acesso remoto: certificado recarregado.'));
    } catch (err) {
      log.warn(tr('   Acesso remoto: certificado novo ilegível, mantendo o anterior ({0}).', [(err as Error).message]));
    }
  };
  watchFile(tls.certFile, { interval: 15_000 }, (cur, prev) => {
    if (cur.mtimeMs !== prev.mtimeMs || cur.ino !== prev.ino) reload();
  });
  const redirect = http.createServer((req, res) => {
    const host = req.headers.host;
    req.resume();
    if (!host || !hostAllowed(host, allowedHosts)) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`${tr('Use https://')}\n`);
      return;
    }
    res.writeHead(308, { Location: `https://${host}${req.url ?? '/'}`, 'Cache-Control': 'no-store' });
    res.end();
  });
  const tcp = net.createServer((socket) => {
    // Conexão que não manda nada não fica pendurada para sempre.
    socket.setTimeout(FIRST_BYTE_MS, () => socket.destroy());
    socket.once('data', (first: Buffer) => {
      socket.setTimeout(0);
      socket.pause();
      socket.unshift(first);
      (first[0] === 0x16 ? secure : redirect).emit('connection', socket);
      process.nextTick(() => socket.resume());
    });
    socket.on('error', () => socket.destroy());
  });
  tcp.on('error', (err) => log.error(tr('Acesso remoto: não deu para escutar na porta {0} ({1}).', [cfg.port, (err as Error).message])));
  tcp.listen(cfg.port, cfg.host);
  return {
    server: tcp,
    close: () => {
      unwatchFile(tls.certFile);
      tcp.close();
      secure.close();
      redirect.close();
    },
  };
}
