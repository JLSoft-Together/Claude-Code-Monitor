// "Ir para HB-XXXX" e "Visitar um prédio aleatório" (Fase 5): o único teletransporte da cidade. O campo e o botão
// ficam no minimapa; o código vai como foi digitado (só no formato) no ↑ `teleport {code}` e o servidor do mundo
// responde com `pos` na calçada da porta (ou `notice` not_found). A cena escurece num fade enquanto isso.
// Modelo puro (testado): o código digitado e as fases do fade. A parte DOM usa `ui-city-tp*` de city/social.css.
import { tr } from '../../../../shared/i18n';
import { h, setHidden, setText } from '../../ui/dom';

/** Os 30 símbolos do código (sem 0/O, 1/I/L e U, que se confundem). */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_RE = /^HB-[2-9A-HJKMNP-TV-Z]{4}$/;

/** O código como alguém digitou ("hb-4f2k", "HB 4F2K", "4f2k") no formato canônico, ou null se não é um código. */
export function normalizeBuildingCode(raw: string): string | null {
  const s = raw.trim().toUpperCase().replace(/[\s_]+/g, '');
  const body = s.startsWith('HB-') ? s.slice(3) : s.startsWith('HB') && s.length === 6 ? s.slice(2) : s;
  const code = `HB-${body}`;
  return CODE_RE.test(code) ? code : null;
}

/** Quanto dura cada parte do fade (ms): escurecer, esperar a resposta (no máximo) e clarear. */
export const FADE = { out: 320, wait: 5_000, in: 520 } as const;

export type FadePhase = 'idle' | 'out' | 'wait' | 'in';

/**
 * O fade do teletransporte: escurece, espera o `pos` (ou desiste em FADE.wait) e clareia. `arrived` vem do `pos`;
 * `failed` de um `notice` (o código não existe): clareia no mesmo lugar.
 */
export class TeleportFade {
  private phase: FadePhase = 'idle';
  private since = 0;
  private landed = false;

  get busy(): boolean {
    return this.phase !== 'idle';
  }

  start(now: number): void {
    this.phase = 'out';
    this.since = now;
    this.landed = false;
  }

  /** Chegou o `pos` (ou deu errado): clareia assim que terminar de escurecer. */
  arrived(): void {
    if (this.phase === 'out' || this.phase === 'wait') this.landed = true;
  }

  failed(): void {
    this.arrived();
  }

  /** A fase agora e a escuridão (0..1). Desiste da espera depois de FADE.wait. */
  tick(now: number): { phase: FadePhase; dark: number; timedOut: boolean } {
    let timedOut = false;
    if (this.phase === 'out' && now - this.since >= FADE.out) {
      this.phase = 'wait';
      this.since = now;
    }
    if (this.phase === 'wait' && (this.landed || now - this.since >= FADE.wait)) {
      timedOut = !this.landed;
      this.phase = 'in';
      this.since = now;
    }
    if (this.phase === 'in' && now - this.since >= FADE.in) this.phase = 'idle';
    const t = now - this.since;
    const dark = this.phase === 'out' ? Math.min(1, t / FADE.out) : this.phase === 'wait' ? 1 : this.phase === 'in' ? Math.max(0, 1 - t / FADE.in) : 0;
    return { phase: this.phase, dark, timedOut };
  }
}

// ====================================================================== DOM

export interface TeleportActions {
  /** "Ir para" com um código já no formato canônico. */
  go(code: string): void;
  /** "Visitar um prédio aleatório". */
  random(): void;
}

/** O campo "Ir para HB-XXXX" e o botão "Visitar um prédio aleatório", em cima do minimapa. */
export class TeleportPanel {
  readonly el: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly error: HTMLElement;
  private readonly goBtn: HTMLButtonElement;
  private readonly diceBtn: HTMLButtonElement;

  constructor(private readonly actions: TeleportActions) {
    this.input = h('input', {
      class: 'ui-city-tp__input',
      type: 'text',
      attrs: { placeholder: 'HB-XXXX', maxlength: 9, autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', 'aria-label': tr('Código do prédio') },
    });
    this.goBtn = h('button', { class: 'ui-city-tp__go', type: 'submit', text: tr('Ir'), title: tr('Ir até a porta deste prédio') });
    this.diceBtn = h(
      'button',
      { class: 'ui-city-tp__dice', type: 'button', title: tr('Visitar um prédio aleatório'), attrs: { 'aria-label': tr('Visitar um prédio aleatório') }, on: { click: () => this.actions.random() } },
      h('span', { text: '🎲', attrs: { 'aria-hidden': 'true' } }),
      h('span', { class: 'ui-city-tp__dice-text', text: tr('Aleatório') }),
    );
    this.error = h('p', { class: 'ui-city-tp__error', role: 'alert', hidden: true });
    const form = h(
      'form',
      { class: 'ui-city-tp__form', attrs: { 'aria-label': tr('Ir para um prédio pelo código') } },
      h('span', { class: 'ui-city-tp__label', text: tr('Ir para'), attrs: { 'aria-hidden': 'true' } }),
      this.input,
      this.goBtn,
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit();
    });
    this.input.addEventListener('input', () => setHidden(this.error, true));
    this.input.addEventListener('keydown', (e) => {
      // as teclas da cidade não valem com o campo em foco; Esc sai do campo
      e.stopPropagation();
      if (e.key === 'Escape') this.input.blur();
    });
    this.el = h('div', { class: 'ui-city-tp' }, form, this.diceBtn, this.error);
  }

  /** Erro embaixo do campo (código fora do formato, nenhum prédio com ele). */
  showError(text: string): void {
    setText(this.error, text);
    setHidden(this.error, false);
  }

  setBusy(on: boolean): void {
    this.goBtn.disabled = on;
    this.diceBtn.disabled = on;
  }

  clear(): void {
    this.input.value = '';
    setHidden(this.error, true);
  }

  private submit(): void {
    const code = normalizeBuildingCode(this.input.value);
    if (!code) {
      this.showError(tr('O código tem o formato HB-XXXX (letras e números, sem 0, O, 1, I, L e U).'));
      return;
    }
    this.input.value = code;
    this.input.blur();
    this.actions.go(code);
  }
}
