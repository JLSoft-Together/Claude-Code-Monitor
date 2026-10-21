// Editor do personagem na gaveta do agente: nome, "Sortear" e as peças (pele, cabelo, roupa...) com prévia de corpo
// inteiro (appearance-fields.ts, o mesmo do personagem do Habblaud World). "Salvar" grava o personagem do projeto (a
// sala) no servidor; as regras puras (quando aparece, rótulos, o que vai em `parts`) estão em character-model.ts.
import { NAME_MAX } from '../../../shared/appearance';
import type { AgentInfo } from '../../../shared/types';
import { appearanceFromSeed } from '../art';
import type { Appearance } from '../art/api';
import { AppearanceFields } from './appearance-fields';
import { canEditCharacter, changedParts } from './character-model';
import type { UiContext } from './context';
import { h, iconButton, setAttr, setHidden, setText } from './dom';
import { ICONS } from './icons';
import { access } from '../net/access';
import { tr } from '../../../shared/i18n';

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

export class CharacterEditor {
  /** Lápis "Editar personagem", ao lado do nome no topo da gaveta. */
  readonly button: HTMLButtonElement;
  /** Painel do editor (escondido enquanto não está editando). */
  readonly el: HTMLElement;
  private agentId = '';
  private editId = 0;
  private editing = false;
  private busy = false;
  private confirmingReset = false;
  private seed = 0;
  private look: 'f' | 'm' = 'f';
  /** Aparência sorteada pela seed (sem peças): o que não mudar não vai em `parts`. */
  private base: Appearance | null = null;
  private readonly fields = new AppearanceFields();
  private readonly nameInput: HTMLInputElement;
  private readonly error: HTMLElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly resetBtn: HTMLButtonElement;

  constructor(private ctx: UiContext) {
    this.button = iconButton(ICONS.pencil, tr('Editar personagem'), () => (this.editing ? this.cancel() : this.start()), 'ui-icon-btn--sm ui-char-edit');
    setAttr(this.button, 'aria-expanded', 'false');
    this.button.hidden = true;

    this.nameInput = h('input', { class: 'ui-char__name', type: 'text', attrs: { maxlength: NAME_MAX, autocomplete: 'off', spellcheck: 'false' } });
    const roll = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Sortear'), title: tr('Sortear outra aparência (desfaz as peças escolhidas)'), on: { click: () => this.roll() } });
    this.error = h('p', { class: 'ui-char__error', role: 'alert', hidden: true });
    this.saveBtn = h('button', { class: 'ui-btn ui-btn--primary', type: 'button', text: tr('Salvar'), on: { click: () => void this.save() } });
    const cancel = h('button', { class: 'ui-btn', type: 'button', text: tr('Cancelar'), on: { click: () => this.cancel() } });
    this.resetBtn = h('button', { class: 'ui-link-btn ui-char__reset', type: 'button', text: tr('Voltar ao sorteio'), on: { click: () => void this.reset() } });
    this.el = h(
      'section',
      { class: 'ui-char', hidden: true, attrs: { 'aria-label': tr('Editar personagem') }, on: { keydown: (ev) => this.onKey(ev) } },
      h(
        'div',
        { class: 'ui-char__top' },
        this.fields.preview,
        h('div', { class: 'ui-char__head' }, h('label', { class: 'ui-char__label' }, h('span', { text: tr('Nome') }), this.nameInput), roll),
      ),
      h('p', { class: 'ui-muted ui-small', text: tr('Vale para o projeto: a próxima sessão nesta sala chega com este personagem.') }),
      this.fields.groups,
      this.error,
      h('div', { class: 'ui-char__actions' }, this.saveBtn, cancel, this.resetBtn),
    );
  }

  /** Outro agente na gaveta: descarta a edição em andamento. */
  open(id: string): void {
    if (id !== this.agentId) this.close();
    this.agentId = id;
  }

  /** A cada render da gaveta: o lápis só aparece quando dá para editar; o editor fecha se o agente saiu. */
  render(a: AgentInfo, live: boolean): void {
    const store = this.ctx.store;
    const allowed = canEditCharacter(a, {
      live,
      terminal: !!store.snapshot?.meta.terminal,
      local: access().local,
      replaying: store.replaying,
      mock: store.mock,
    });
    setHidden(this.button, !allowed);
    if (this.editing && !allowed) {
      this.close();
      if (!live || a.status === 'offline') this.ctx.announce(tr('O agente saiu do escritório.'));
    }
    if (this.editing && !this.confirmingReset) setHidden(this.resetBtn, !a.custom);
  }

  private start(): void {
    const a = this.ctx.agent(this.agentId);
    if (!a) return;
    this.editId++;
    this.seed = a.seed;
    this.look = a.look;
    this.base = appearanceFromSeed(a.seed, { look: a.look });
    this.nameInput.value = a.name;
    this.confirmingReset = false;
    setText(this.resetBtn, tr('Voltar ao sorteio'));
    setHidden(this.resetBtn, !a.custom);
    this.showError(null);
    this.editing = true;
    setHidden(this.el, false);
    setAttr(this.button, 'aria-expanded', 'true');
    this.fields.set({ ...this.base, ...a.parts });
    this.nameInput.focus();
    this.nameInput.select();
  }

  /** Fecha o editor e descarta o rascunho (também quando a gaveta fecha ou sai do agente). */
  close(): void {
    if (!this.editing) return;
    this.editing = false;
    this.busy = false;
    this.saveBtn.disabled = false;
    setHidden(this.el, true);
    setAttr(this.button, 'aria-expanded', 'false');
  }

  private cancel(): void {
    this.close();
    this.button.focus();
  }

  private roll(): void {
    this.seed = randomSeed();
    this.base = appearanceFromSeed(this.seed, { look: this.look });
    this.fields.set({ ...this.base });
  }

  private async save(): Promise<void> {
    const draft = this.fields.value;
    if (this.busy || !this.base || !draft) return;
    const name = this.nameInput.value.trim();
    if (!name) return this.showError(tr('Dê um nome ao personagem.'));
    const id = this.agentId;
    const editId = this.editId;
    this.busy = true;
    this.saveBtn.disabled = true;
    const err = await this.ctx.store.saveCharacter(id, { name, seed: this.seed, parts: changedParts(this.base, draft) });
    if (!this.editing || this.agentId !== id || this.editId !== editId) return;
    this.busy = false;
    this.saveBtn.disabled = false;
    if (err) return this.showError(err);
    this.close();
    this.button.focus();
    this.ctx.announce(tr('Personagem salvo: {0}.', [name]));
  }

  private async reset(): Promise<void> {
    if (this.busy) return;
    if (!this.confirmingReset) {
      this.confirmingReset = true;
      setText(this.resetBtn, tr('Confirmar: voltar ao sorteio'));
      return;
    }
    const id = this.agentId;
    const editId = this.editId;
    this.busy = true;
    const err = await this.ctx.store.resetCharacter(id);
    if (!this.editing || this.agentId !== id || this.editId !== editId) return;
    this.busy = false;
    if (err) return this.showError(err);
    this.close();
    this.button.focus();
    this.ctx.announce(tr('O personagem voltou ao sorteio.'));
  }

  private showError(message: string | null): void {
    setText(this.error, message ?? '');
    setHidden(this.error, !message);
    if (message) this.nameInput.focus();
  }

  private onKey(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      this.cancel();
    } else if (ev.key === 'Enter' && ev.target === this.nameInput) {
      ev.preventDefault();
      void this.save();
    }
  }
}
