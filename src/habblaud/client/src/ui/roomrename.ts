// Renomear uma sala (botão direito na sala, na lista lateral ou no escritório): um campo flutuante perto do clique.
// O nome fica no servidor (POST /api/rooms/rename, model/room-aliases.ts) e vale para todas as abas; vazio volta ao
// nome da pasta. Enter salva, Esc cancela, clicar fora salva. A gaveta da sala tem também um lápis ao lado do nome.
import { isDemoId } from '../../../shared/timeline';
import type { UiContext } from './context';
import { h, setText } from './dom';
import { access } from '../net/access';
import { tr } from '../../../shared/i18n';

const NAME_MAX = 40;

/**
 * Dá para renomear esta sala daqui? O servidor recusa as de demonstração, quem não abriu o Habblaud pelo próprio
 * computador e o Habblaud exposto na rede (sem a trava do terminal); no modo mock e no timelapse não há servidor para
 * gravar.
 */
export function canRenameRoom(ctx: UiContext, roomId: string): boolean {
  return (
    !!ctx.renameRoom &&
    !isDemoId(roomId) &&
    !ctx.store.mock &&
    !ctx.store.replaying &&
    !!ctx.store.snapshot?.meta.terminal &&
    access().local
  );
}

async function renameRequest(id: string, name: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/rooms/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name }) });
  } catch {
    throw new Error(tr('o Habblaud não respondeu'));
  }
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? tr('erro {0}', [res.status]));
}

export class RoomRenamer {
  readonly el: HTMLElement;
  private input: HTMLInputElement;
  private hint: HTMLElement;
  private roomId: string | null = null;
  private original = '';
  private onDocDown = (e: PointerEvent) => {
    if (!this.el.contains(e.target as Node)) void this.commit();
  };

  constructor(private ctx: UiContext) {
    this.input = h('input', { class: 'ui-rename__input', type: 'text', attrs: { maxlength: NAME_MAX, 'aria-label': tr('Nome da sala'), spellcheck: 'false' } });
    this.hint = h('p', { class: 'ui-rename__hint' });
    this.el = h('div', { class: 'ui-rename', role: 'dialog', hidden: true, attrs: { 'aria-label': tr('Renomear sala') } }, h('label', { class: 'ui-rename__label', text: tr('Renomear sala') }), this.input, this.hint);
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        void this.commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
    this.input.addEventListener('keyup', (e) => e.stopPropagation());
  }

  /** Abre o campo para a sala, perto do ponto (px da janela). */
  open(roomId: string, at: { x: number; y: number }): void {
    const room = this.ctx.store.room(roomId);
    if (!room) return;
    this.roomId = roomId;
    this.original = room.name;
    this.input.value = room.name;
    setText(this.hint, tr('Enter salva · Esc cancela · vazio volta a “{0}”', [room.path.split(/[\\/]/).filter(Boolean).pop() ?? room.path]));
    this.hint.classList.remove('is-error');
    this.el.hidden = false;
    const w = this.el.offsetWidth || 260;
    const hgt = this.el.offsetHeight || 80;
    this.el.style.left = `${Math.max(8, Math.min(at.x, innerWidth - w - 8))}px`;
    this.el.style.top = `${Math.max(8, Math.min(at.y, innerHeight - hgt - 8))}px`;
    this.input.focus();
    this.input.select();
    document.addEventListener('pointerdown', this.onDocDown, true);
  }

  close(): void {
    this.el.hidden = true;
    this.roomId = null;
    document.removeEventListener('pointerdown', this.onDocDown, true);
  }

  private async commit(): Promise<void> {
    const id = this.roomId;
    const name = this.input.value.trim();
    if (!id || name === this.original) return this.close();
    try {
      await renameRequest(id, name);
      if (this.roomId === id) this.close();
      this.ctx.announce(name ? tr('Sala renomeada para {0}.', [name]) : tr('A sala voltou ao nome da pasta.'));
    } catch (err) {
      // fica aberto com o motivo (ex.: sala de demonstração, Habblaud aberto por outro endereço)
      setText(this.hint, tr('Não deu: {0}', [(err as Error).message]));
      this.hint.classList.add('is-error');
    }
  }
}
