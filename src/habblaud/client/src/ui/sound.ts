// Sons da interface (opt-in): liga a mesa de som às preferências, toca os sons do ambiente que o
// mundo sugere (teclado, elevador, rodas) e libera o áudio no primeiro gesto do usuário.
import { SoundBoard } from '../audio/board';
import type { SoundKind } from '../audio/scheduler';
import type { UiComponent, UiContext } from './context';

export class SoundControl implements UiComponent {
  readonly board = new SoundBoard();
  private previewAt = 0;

  constructor(private ctx: UiContext) {
    this.sync();
    ctx.world.onSound?.((cue) => this.board.play(cue.kind, cue));
    // O navegador só libera o áudio depois de um gesto do usuário.
    const unlock = () => {
      if (this.ctx.prefs.sound) void this.board.unlock();
    };
    addEventListener('pointerdown', unlock, { passive: true });
    addEventListener('keydown', unlock);
  }

  render(): void {
    this.sync();
  }

  /** Aplica as preferências atuais (interruptor geral, volume, categorias). */
  sync(): void {
    this.board.configure(this.ctx.prefs.sound, this.ctx.prefs.sounds);
  }

  /** Amostra ao mexer nas configurações (chamada a partir do clique: libera o áudio). */
  preview(kind: SoundKind = 'pop'): void {
    this.sync();
    const now = performance.now();
    const ready = this.board.unlock();
    if (now - this.previewAt < 250) return;
    this.previewAt = now;
    // o primeiro "resume" do AudioContext é assíncrono
    void ready.then(() => this.board.play(kind));
  }
}
