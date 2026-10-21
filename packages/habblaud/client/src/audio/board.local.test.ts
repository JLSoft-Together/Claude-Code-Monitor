import { afterEach, describe, expect, it } from 'vitest';
import { SoundBoard } from './board';

interface FakeNode {
  kind: string;
  to: FakeNode[];
  gain?: { value: number };
  threshold?: { value: number };
  knee?: { value: number };
  ratio?: { value: number };
  connect(n: FakeNode): FakeNode;
}

function node(kind: string, extra: Partial<FakeNode> = {}): FakeNode {
  const n: FakeNode = { kind, to: [], connect: (m) => (n.to.push(m), m), ...extra };
  return n;
}

let made: FakeNode[] = [];
class FakeContext {
  state = 'running';
  sampleRate = 8000;
  currentTime = 0;
  destination = node('destination');
  createDynamicsCompressor() {
    const n = node('compressor', { threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 } });
    made.push(n);
    return n;
  }
  createGain() {
    const n = node('gain', { gain: { value: 1 } });
    made.push(n);
    return n;
  }
  createBuffer() {
    return { getChannelData: () => new Float32Array(8) };
  }
  resume() {
    return Promise.resolve();
  }
}

function install(): void {
  made = [];
  (globalThis as { window?: unknown }).window = { AudioContext: FakeContext };
}

describe('local patch: SoundBoard boost', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('keeps upstream routing without a boost (soft compressor straight to the speakers)', async () => {
    install();
    const board = new SoundBoard();
    board.configure(true, { volume: 1, alerts: true, keys: true, elevator: true, social: true });
    await board.unlock();
    expect(made.map((n) => n.kind)).toEqual(['compressor']);
    expect(made[0].threshold?.value).toBe(-18);
  });

  it('puts the boost before a peak limiter', async () => {
    install();
    const board = new SoundBoard({ boost: 6 });
    board.configure(true, { volume: 1, alerts: true, keys: true, elevator: true, social: true });
    await board.unlock();
    const comp = made.find((n) => n.kind === 'compressor')!;
    const pre = made.find((n) => n.kind === 'gain')!;
    expect(pre.gain?.value).toBe(6);
    expect(pre.to).toEqual([comp]);
    expect(comp.to.map((n) => n.kind)).toEqual(['destination']);
    expect(comp.threshold?.value).toBeGreaterThan(-18);
  });
});
