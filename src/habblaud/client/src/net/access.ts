// O que esta página pode fazer, segundo o servidor (GET /api/access, ver AccessInfo). Lido antes de conectar e de novo a
// cada reconexão (app.ts): HABBLAUD_REMOTE_ALLOW pode mudar com o servidor reiniciado e a página do celular continua aberta.
// Sem resposta (servidor antigo, rede), cai na regra de antes: só a página aberta pelo próprio computador age, e nunca
// o Novo agente (opt-in no servidor). Login vencido na porta remota (401): volta à tela de entrada.
import type { AccessInfo } from '../../../shared/types';

let current: AccessInfo | null = null;
const listeners = new Set<() => void>();

/** Avisa quando o acesso muda (a UI redesenha os botões). Devolve a função que cancela. */
export function onAccessChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

function sameAccess(a: AccessInfo | null, b: AccessInfo | null): boolean {
  return !!a && !!b && (Object.keys(a) as (keyof AccessInfo)[]).every((k) => a[k] === b[k]) && Object.keys(a).length === Object.keys(b).length;
}

/** Hostname do próprio computador (localhost, *.localhost, 127.x, ::1). */
export function isLoopbackHostname(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return name === 'localhost' || name.endsWith('.localhost') || name === '::1' || /^127(?:\.\d{1,3}){3}$/.test(name);
}

export function fallbackAccess(hostname: string): AccessInfo {
  const local = isLoopbackHostname(hostname);
  return { remote: false, local, permissions: local, messages: local, terminal: local, spawn: false };
}

/** Prazo do GET /api/access (a página não fica esperando para conectar). */
export const ACCESS_TIMEOUT_MS = 5_000;

function isAccessInfo(v: unknown): v is AccessInfo {
  const a = v as Partial<AccessInfo> | null;
  return !!a && ['remote', 'local', 'permissions', 'messages', 'terminal'].every((k) => typeof a[k as keyof AccessInfo] === 'boolean');
}

/** Acesso desta página (o do servidor, quando já chegou). */
export function access(): AccessInfo {
  return current ?? fallbackAccess(typeof location === 'undefined' ? '' : location.hostname);
}

export async function loadAccess(fetchImpl: typeof fetch = fetch, go: (url: string) => void = (u) => location.assign(u)): Promise<AccessInfo> {
  try {
    const res = await fetchImpl('/api/access', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(ACCESS_TIMEOUT_MS) });
    if (res.status === 401) {
      go('/login');
      return access();
    }
    if (res.ok) {
      const body: unknown = await res.json();
      if (isAccessInfo(body)) {
        const next = { ...body, spawn: (body as { spawn?: unknown }).spawn === true };
        const changed = !sameAccess(current, next);
        current = next;
        if (changed) listeners.forEach((cb) => cb());
      }
    }
  } catch {
    // fica a regra antiga (fallbackAccess)
  }
  return access();
}

/** Encerra o login deste aparelho (porta remota) e volta à tela de entrada. Devolve false se o servidor não respondeu. */
export async function remoteLogout(fetchImpl: typeof fetch = fetch, go: (url: string) => void = (u) => location.assign(u)): Promise<boolean> {
  try {
    const res = await fetchImpl('/api/remote/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!res.ok) return false;
  } catch {
    return false;
  }
  go('/login');
  return true;
}

/** Só para testes. */
export function setAccess(a: AccessInfo | null): void {
  current = a;
}
