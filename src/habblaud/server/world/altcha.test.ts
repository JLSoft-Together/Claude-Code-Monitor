import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ALTCHA_MAX_NUMBER, altchaHash, encodeAltchaPayload, parseAltchaChallenge, solveAltcha } from './altcha';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function challenge(n: number, maxnumber = 50_000) {
  const salt = 'abc123?expires=1800000000';
  return { algorithm: 'SHA-256' as const, challenge: sha(salt + n), salt, maxnumber, signature: 'assinatura-do-servidor' };
}

describe('ALTCHA', () => {
  it('acha o número por força bruta (SHA-256 de salt + n) e devolve a solução no formato do widget', async () => {
    const ch = challenge(12_345);
    let t = 100;
    const sol = await solveAltcha(ch, { now: () => (t += 7) });
    expect(sol).toEqual({ number: 12_345, took: 7 });
    expect(altchaHash(ch.salt, 12_345)).toBe(ch.challenge);
    const payload = JSON.parse(Buffer.from(encodeAltchaPayload(ch, sol!), 'base64').toString('utf8'));
    expect(payload).toEqual({ algorithm: 'SHA-256', challenge: ch.challenge, number: 12_345, salt: ch.salt, signature: ch.signature, took: 7 });
  });

  it('acha o 0 e o próprio maxnumber; sem solução até maxnumber, undefined', async () => {
    expect((await solveAltcha(challenge(0, 10)))?.number).toBe(0);
    expect((await solveAltcha(challenge(10, 10)))?.number).toBe(10);
    expect(await solveAltcha(challenge(11, 10))).toBeUndefined();
  });

  it('devolve a vez ao event loop entre os lotes e pode ser interrompido', async () => {
    let ticks = 0;
    const timer = setInterval(() => ticks++, 0);
    const ac = new AbortController();
    const run = solveAltcha(challenge(40_000), { signal: ac.signal });
    setTimeout(() => ac.abort(new Error('parou')), 1);
    await expect(run).rejects.toThrow('parou');
    clearInterval(timer);
    expect(ticks).toBeGreaterThan(0);
  });

  it('valida o desafio que vem do servidor', () => {
    const ok = challenge(1);
    expect(parseAltchaChallenge(ok)).toEqual(ok);
    expect(parseAltchaChallenge({ ...ok, challenge: ok.challenge.toUpperCase() })?.challenge).toBe(ok.challenge);
    expect(parseAltchaChallenge({ ...ok, algorithm: 'SHA-1' })).toBeUndefined();
    expect(parseAltchaChallenge({ ...ok, challenge: 'zz' })).toBeUndefined();
    expect(parseAltchaChallenge({ ...ok, maxnumber: ALTCHA_MAX_NUMBER + 1 })).toBeUndefined();
    expect(parseAltchaChallenge({ ...ok, maxnumber: 1.5 })).toBeUndefined();
    expect(parseAltchaChallenge({ ...ok, salt: '' })).toBeUndefined();
    expect(parseAltchaChallenge({ ...ok, signature: undefined })).toBeUndefined();
    expect(parseAltchaChallenge(null)).toBeUndefined();
  });
});
