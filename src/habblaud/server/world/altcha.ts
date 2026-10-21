// ALTCHA: prova de trabalho que o servidor do Habblaud World pede no cadastro e nos envios de e-mail (no lugar de um
// captcha). O servidor manda {algorithm, challenge, salt, maxnumber, signature}; quem pede acha o número n (0..maxnumber)
// com SHA-256(salt + n) = challenge e devolve, em base64, o JSON {algorithm, challenge, number, salt, signature, took}
// (o formato do widget ALTCHA). Quem resolve é o servidor local do Habblaud, por força bruta, sem dependências.
//
// A busca roda em lotes, devolvendo a vez ao event loop entre eles: o escritório continua respondendo enquanto isso.
import { createHash } from 'node:crypto';
import type { AltchaChallenge } from '../../shared/world/protocol';

/** Teto aceito para `maxnumber` (acima disso o desafio é recusado em vez de travar o computador por minutos). */
export const ALTCHA_MAX_NUMBER = 10_000_000;
/** Tentativas por lote entre duas devoluções da vez ao event loop. */
const BATCH = 5_000;

/** Valida o desafio que veio do servidor do mundo; undefined se algo estiver fora do formato. */
export function parseAltchaChallenge(raw: unknown, maxNumber = ALTCHA_MAX_NUMBER): AltchaChallenge | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const v = raw as Record<string, unknown>;
  if (v.algorithm !== 'SHA-256') return undefined;
  if (typeof v.challenge !== 'string' || !/^[0-9a-f]{64}$/i.test(v.challenge)) return undefined;
  if (typeof v.salt !== 'string' || !v.salt || v.salt.length > 512) return undefined;
  if (typeof v.signature !== 'string' || !v.signature || v.signature.length > 512) return undefined;
  if (!Number.isInteger(v.maxnumber) || (v.maxnumber as number) < 1 || (v.maxnumber as number) > maxNumber) return undefined;
  return { algorithm: 'SHA-256', challenge: v.challenge.toLowerCase(), salt: v.salt, maxnumber: v.maxnumber as number, signature: v.signature };
}

export function altchaHash(salt: string, n: number): string {
  return createHash('sha256').update(salt + n).digest('hex');
}

export interface AltchaSolution {
  number: number;
  /** Quanto a busca levou (ms). */
  took: number;
}

/**
 * Acha o número do desafio. Devolve undefined se nenhum n até `maxnumber` servir (desafio inválido). Interrompe com
 * `signal` (lança o motivo do abort).
 */
export async function solveAltcha(
  ch: AltchaChallenge,
  opts: { signal?: AbortSignal; now?: () => number } = {},
): Promise<AltchaSolution | undefined> {
  const now = opts.now ?? Date.now;
  const start = now();
  for (let n = 0; n <= ch.maxnumber; n++) {
    if (altchaHash(ch.salt, n) === ch.challenge) return { number: n, took: Math.max(0, now() - start) };
    if (n % BATCH === BATCH - 1) {
      await new Promise<void>((ok) => setImmediate(ok));
      opts.signal?.throwIfAborted();
    }
  }
  return undefined;
}

/** A solução no formato do campo `altcha` do cadastro: base64 de {algorithm, challenge, number, salt, signature, took}. */
export function encodeAltchaPayload(ch: AltchaChallenge, sol: AltchaSolution): string {
  const payload = { algorithm: ch.algorithm, challenge: ch.challenge, number: sol.number, salt: ch.salt, signature: ch.signature, took: sol.took };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}
