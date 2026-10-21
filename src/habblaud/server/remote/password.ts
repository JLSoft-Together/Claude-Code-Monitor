// Senha do acesso remoto guardada como hash scrypt (nunca em texto puro no .env).
//
// Formato: scrypt:<log2 N>:<r>:<p>:<sal base64url>:<hash base64url>. Sem "$" de propósito: o Docker Compose interpola
// "$" no .env. Gerado por `npm run remote:setup` (scripts/remote-setup.ts) e conferido no login (http/remote.ts).
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export interface PasswordHash {
  logN: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

/** 2^15 com r=8: ~32 MB e algumas dezenas de ms por tentativa; caro o bastante para quem chuta, barato no login. */
export const DEFAULT_LOG_N = 15;
const KEY_LEN = 32;
const SALT_LEN = 16;
const HASH_RE = /^scrypt:(\d{1,2}):(\d{1,2}):(\d{1,2}):([A-Za-z0-9_-]{16,}):([A-Za-z0-9_-]{40,})$/;

function maxmem(logN: number, r: number): number {
  // O scrypt usa ~128 * N * r bytes; folga para não estourar o limite padrão (32 MB) do Node.
  return 256 * 2 ** logN * r;
}

function derive(password: string, salt: Buffer, logN: number, r: number, p: number): Promise<Buffer> {
  return new Promise((ok, fail) =>
    scrypt(password.normalize('NFC'), salt, KEY_LEN, { N: 2 ** logN, r, p, maxmem: maxmem(logN, r) }, (err, key) => (err ? fail(err) : ok(key))),
  );
}

export async function hashPassword(password: string, logN = DEFAULT_LOG_N): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const r = 8;
  const p = 1;
  const hash = await derive(password, salt, logN, r, p);
  return `scrypt:${logN}:${r}:${p}:${salt.toString('base64url')}:${hash.toString('base64url')}`;
}

/** Lê o hash; undefined quando o texto não tem o formato (ou parâmetros fora do razoável). */
export function parsePasswordHash(value: string | undefined): PasswordHash | undefined {
  const m = HASH_RE.exec(value?.trim() ?? '');
  if (!m) return undefined;
  const [logN, r, p] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (logN < 10 || logN > 20 || r < 1 || r > 32 || p < 1 || p > 16) return undefined;
  const hash = Buffer.from(m[5], 'base64url');
  if (hash.length !== KEY_LEN) return undefined;
  return { logN, r, p, salt: Buffer.from(m[4], 'base64url'), hash };
}

/** Confere a senha em tempo constante (o scrypt roda sempre, até com senha vazia). */
export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  const key = await derive(password, stored.salt, stored.logN, stored.r, stored.p);
  return key.length === stored.hash.length && timingSafeEqual(key, stored.hash);
}
