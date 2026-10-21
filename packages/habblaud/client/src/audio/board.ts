// Mesa de som: um AudioContext para tudo (criado só depois de um gesto do usuário, como pede a
// política de autoplay), volume mestre com limitador e o agendador que decide o que toca.
import { SoundScheduler, type SoundKind, type SoundSettings } from './scheduler';
import { makeNoise, playVoice } from './synth';

export class SoundBoard {
  readonly scheduler = new SoundScheduler();
  private ac: AudioContext | null = null;
  private out: AudioNode | null = null;
  private noise: AudioBuffer | null = null;
  private enabled = false;

  configure(enabled: boolean, settings: SoundSettings): void {
    this.enabled = enabled;
    this.scheduler.configure(enabled, settings);
  }

  /**
   * Precisa ser chamado a partir de um gesto do usuário (clique/tecla) para o navegador liberar o
   * áudio. Resolve quando o áudio está pronto (ou não pôde ser liberado).
   */
  unlock(): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    try {
      if (!this.ac) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return Promise.resolve();
        const ac = new Ctor();
        // limitador suave: vários sons juntos nunca estouram
        const comp = ac.createDynamicsCompressor();
        comp.threshold.value = -18;
        comp.knee.value = 12;
        comp.ratio.value = 6;
        comp.connect(ac.destination);
        this.ac = ac;
        this.out = comp;
        this.noise = makeNoise(ac);
      }
      if (this.ac.state === 'suspended') return this.ac.resume().catch(() => undefined);
    } catch {
      this.ac = null;
      this.out = null;
    }
    return Promise.resolve();
  }

  /** Toca `kind` se a preferência e os limites deixarem. Devolve se tocou. */
  play(kind: SoundKind, opts: { gain?: number; pan?: number; count?: number } = {}): boolean {
    const ac = this.ac;
    if (!ac || !this.out || ac.state !== 'running') return false;
    const hidden = typeof document !== 'undefined' && document.hidden;
    const gain = this.scheduler.decide(kind, performance.now(), { hidden, gain: opts.gain });
    if (gain === null) return false;
    try {
      playVoice(ac, this.out, kind, ac.currentTime + 0.01, { gain, pan: opts.pan, count: opts.count, rng: Math.random, noise: this.noise });
      return true;
    } catch {
      return false;
    }
  }
}
