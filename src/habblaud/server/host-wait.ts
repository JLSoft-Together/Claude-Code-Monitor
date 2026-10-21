// Espera longa das rodadas do auxiliar do host (scripts/codex-bridge.ts): em vez de perguntar a cada meio segundo, ele
// pede com `?wait=1` e a resposta fica parada aqui até chegar trabalho (ou até HOST_WAIT_MS). Enquanto espera, o
// auxiliar conta como presente.

/** Quanto uma rodada fica parada esperando trabalho (o auxiliar pergunta de novo em seguida). */
export const HOST_WAIT_MS = 20_000;

export class HostWait {
  private readonly waiters = new Set<() => void>();
  private seenAt = -Infinity;

  constructor(
    private readonly presenceMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** O auxiliar está esperando agora ou passou há menos de `presenceMs`. */
  present(): boolean {
    return this.waiters.size > 0 || this.now() - this.seenAt <= this.presenceMs;
  }

  seen(): void {
    this.seenAt = this.now();
  }

  /** Chegou trabalho: solta quem espera. */
  wake(): void {
    const list = [...this.waiters];
    this.waiters.clear();
    for (const done of list) done();
  }

  /** Espera wake(), `ms` ou `signal` (a conexão do auxiliar caiu). */
  wait(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted || ms <= 0) return Promise.resolve();
    return new Promise((ok) => {
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', done);
        this.waiters.delete(done);
        this.seen();
        ok();
      };
      const timer = setTimeout(done, ms);
      timer.unref?.();
      signal?.addEventListener('abort', done, { once: true });
      this.waiters.add(done);
    });
  }
}

/**
 * Rodada com espera: devolve o que `take` tiver na hora; se vier vazio, espera trabalho e tenta de novo. Com a conexão
 * caída no meio, devolve vazio sem tirar nada da fila.
 */
export async function pollWithWait<T>(wait: HostWait, take: () => T[], ms: number, signal?: AbortSignal): Promise<T[]> {
  wait.seen();
  const now = take();
  if (now.length || ms <= 0) return now;
  await wait.wait(ms, signal);
  return signal?.aborted ? [] : take();
}
