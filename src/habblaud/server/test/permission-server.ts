// Servidor de teste para "responder pelo escritório": Office + Hub + rotas de verdade (guard, app e
// /api/permissions) numa porta livre do 127.0.0.1, com um agente principal na sessão "sess-1".
// Usado pelos testes das rotas e do hook (mod/habblaud-permissoes/hooks/permission-hook.mjs rodado como processo).
// Com `codex`, também um agente principal do Codex (conta ".codex", thread CODEX_THREAD) e a fonte do Codex ao vivo
// (`codexLive`, um falso) para o hook do Codex (mod/habblaud-codex/hook.mjs).
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { AccountsService } from '../accounts/service';
import { createApiHandler } from '../http/app';
import { createRequestGuard } from '../http/guard';
import { Hub } from '../http/sse';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { createPermissionRoutes } from '../permissions/http';
import { PermissionRegistry, type RegistryOptions } from '../permissions/registry';
import type { CodexLive } from '../sources/codex/live';
import { tempDir } from './fixtures';

export const MAIN = 'acc:1';
export const SESSION = 'sess-1';
/** Thread (sintético) do agente do Codex do servidor de teste. */
export const CODEX_THREAD = '0199b0c0-1234-7abc-8def-0123456789ab';
export const CODEX_MAIN = `.codex:${CODEX_THREAD}`;

export interface PermissionServer {
  base: string;
  port: number;
  office: Office;
  registry?: PermissionRegistry;
  /** Páginas locais "abertas" (o que Hub.localSize diria). */
  setViewers(n: number): void;
  close(): Promise<void>;
}

export async function servePermissions(
  opts: { enabled?: boolean; viewers?: number; demo?: boolean; registry?: Partial<RegistryOptions>; codex?: boolean; codexLive?: CodexLive } = {},
): Promise<PermissionServer> {
  const tmp = tempDir();
  const enabled = opts.enabled ?? true;
  let viewers = opts.viewers ?? 1;
  const late: { registry?: PermissionRegistry } = {};
  const office = new Office({
    names: new NameStore(null),
    version: 't',
    startedAt: Date.now(),
    accounts: () => [],
    sources: () => [],
    accountName: () => undefined,
    terminal: enabled,
    permissions: () => late.registry?.snapshot() ?? new Map(),
  });
  const hub = new Hub(office, { throttleMs: 10 });
  const registry = enabled
    ? new PermissionRegistry({
        office,
        viewers: () => viewers,
        demoDecide: (id, d) => office.decideDemoPermission(id, d),
        demoDetail: (id) => office.demoPermission(id),
        tickMs: 50,
        ...opts.registry,
      })
    : undefined;
  late.registry = registry;
  registry?.start();
  const accounts = new AccountsService({ dirs: [], home: tmp.dir, env: {}, onChange: () => {} });
  const api = createApiHandler({
    office,
    hub,
    accounts,
    sources: () => [],
    version: 't',
    inDocker: false,
    terminal: enabled,
    permissions: registry ? createPermissionRoutes(registry) : undefined,
    codexLive: opts.codexLive,
  });
  const guard = createRequestGuard({ allowedHosts: new Set(['habblaud.lan']) });
  const server = http.createServer((req, res) => {
    if (guard(req, res)) return;
    if (!api(req, res, new URL(req.url ?? '/', 'http://x'))) res.writeHead(404).end();
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as AddressInfo).port;
  office.addMain({ id: MAIN, account: 'acc', sessionId: SESSION, cwd: '/p/loja', role: 'Agente principal', startedAt: Date.now(), status: 'working' });
  if (opts.codex) {
    office.addMain({ id: CODEX_MAIN, provider: 'codex', account: '.codex', sessionId: CODEX_THREAD, cwd: '/p/loja', role: 'Agente principal', startedAt: Date.now(), status: 'working' });
  }
  if (opts.demo) office.setDemo(true);
  return {
    base: `http://127.0.0.1:${port}`,
    port,
    office,
    registry,
    setViewers: (n) => (viewers = n),
    close: () =>
      new Promise((ok) => {
        registry?.stop();
        hub.stop();
        server.closeAllConnections();
        server.close(() => {
          tmp.cleanup();
          ok();
        });
      }),
  };
}

/** Requisição crua (dá para trocar Host, Origin e Content-Type). */
export function request(
  base: string,
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; json: unknown; text: string }> {
  const u = new URL(base);
  const data = opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  const headers: Record<string, string> = { ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}), ...opts.headers };
  return new Promise((ok, fail) => {
    const req = http.request({ host: u.hostname, port: u.port, path, method: opts.method ?? 'GET', headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (text += c));
      res.on('end', () => {
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          json = undefined;
        }
        ok({ status: res.statusCode ?? 0, json, text });
      });
    });
    req.on('error', fail);
    if (data !== undefined) req.write(data);
    req.end();
  });
}

/** JSON do hook PermissionRequest (sintético) para a sessão de teste. */
export function hookJson(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_id: SESSION,
    transcript_path: '/tmp/x/projects/-p-loja/sess-1.jsonl',
    cwd: '/p/loja',
    permission_mode: 'default',
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'npm test', description: 'Rodar os testes' },
    permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'localSettings' }],
    ...over,
  };
}
