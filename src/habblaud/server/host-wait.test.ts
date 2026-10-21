import { describe, expect, it } from 'vitest';
import { HostWait, pollWithWait } from './host-wait';

describe('espera longa do auxiliar do host', () => {
  it('sem trabalho, espera; o wake solta na hora e a rodada leva o que chegou', async () => {
    const wait = new HostWait(10_000);
    const queue: string[] = [];
    const take = () => queue.splice(0);
    const round = pollWithWait(wait, take, 60_000);
    expect(wait.present()).toBe(true);
    queue.push('a');
    wait.wake();
    await expect(round).resolves.toEqual(['a']);
  });

  it('com trabalho na fila, responde na hora; sem espera pedida (ms 0), também', async () => {
    const wait = new HostWait(10_000);
    await expect(pollWithWait(wait, () => ['x'], 60_000)).resolves.toEqual(['x']);
    await expect(pollWithWait(wait, () => [], 0)).resolves.toEqual([]);
  });

  it('conexão que cai no meio: devolve vazio sem tirar nada da fila', async () => {
    const wait = new HostWait(10_000);
    const ac = new AbortController();
    let taken = 0;
    const round = pollWithWait(wait, () => (taken++, []), 60_000, ac.signal);
    ac.abort();
    await expect(round).resolves.toEqual([]);
    expect(taken).toBe(1);
  });

  it('presença: quem espera conta; depois, só até presenceMs da última rodada', async () => {
    let now = 0;
    const wait = new HostWait(1_000, () => now);
    expect(wait.present()).toBe(false);
    wait.seen();
    now = 900;
    expect(wait.present()).toBe(true);
    now = 2_000;
    expect(wait.present()).toBe(false);
    const round = wait.wait(60_000);
    expect(wait.present()).toBe(true);
    wait.wake();
    await round;
    expect(wait.present()).toBe(true);
  });
});
