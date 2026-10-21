// Peças do personagem (pele, cabelo e estilo, olhos, roupa, calça, sapato, acessório, barba) com a prévia de corpo
// inteiro: o miolo do editor de personagem, usado na gaveta do agente (character-editor.ts) e no personagem do Habblaud
// World (world/settings-world.ts). Quem usa guarda o nome, salva e decide o que mandar; aqui só se escolhe a aparência.
import type { PartKey } from '../../../shared/appearance';
import { characterSprite, editorConflict, editorOptions, fitToOptions } from '../art';
import type { Appearance } from '../art/api';
import { EDITOR_GROUPS, rowVisible, styleLabel, type EditorRow } from './character-model';
import { h } from './dom';
import { tr } from '../../../shared/i18n';

/** Pixels de tela por pixel do personagem na prévia. */
const PREVIEW_SCALE = 4;

export class AppearanceFields {
  /** Prévia de corpo inteiro (canvas). */
  readonly preview: HTMLCanvasElement;
  /** Grupos de peças (pele, cabelo...), redesenhados a cada escolha. */
  readonly groups: HTMLElement;
  private draft: Appearance | null = null;

  constructor(private readonly onChange: (a: Appearance) => void = () => {}) {
    this.preview = h('canvas', { class: 'ui-char__preview', role: 'img', attrs: { 'aria-label': tr('Prévia do personagem') } });
    this.groups = h('div', { class: 'ui-char__groups' });
  }

  /** Aparência em edição (null antes do primeiro `set`). */
  get value(): Appearance | null {
    return this.draft;
  }

  /** Troca a aparência inteira (começo da edição, "Sortear") e redesenha. */
  set(a: Appearance): void {
    this.draft = a;
    this.paint();
  }

  private pick(key: PartKey, value: string): void {
    if (!this.draft) return;
    this.draft = fitToOptions({ ...this.draft, [key]: value });
    this.paint(key);
    this.onChange(this.draft);
  }

  /** Redesenha a prévia e as opções; `focusKey` devolve o foco à opção marcada daquela linha. */
  paint(focusKey?: PartKey): void {
    const a = this.draft;
    if (!a) return;
    this.drawPreview(a);
    const options = editorOptions(a);
    this.groups.replaceChildren(
      ...EDITOR_GROUPS.map((g) =>
        h(
          'fieldset',
          { class: 'ui-char__group' },
          h('legend', { text: g.title }),
          ...g.rows.filter((r) => rowVisible(r, a)).map((r) => this.row(g.title, r, a, options[r.key])),
        ),
      ),
    );
    if (focusKey) this.groups.querySelector<HTMLElement>(`[data-key="${focusKey}"] [aria-checked="true"]`)?.focus();
  }

  private row(group: string, r: EditorRow, a: Appearance, values: readonly string[]): HTMLElement {
    const current = a[r.key] ?? '';
    const isColor = r.kind === 'color';
    const buttons = values.map((v) => {
      const conflict = editorConflict(a, r.key, v);
      const label = isColor ? v : styleLabel(r.key, v);
      return h('button', {
        class: isColor ? 'ui-char__swatch' : 'ui-char__chip',
        type: 'button',
        role: 'radio',
        tabIndex: v === current ? 0 : -1,
        title: conflict ?? label,
        style: isColor ? `--swatch: ${v}` : undefined,
        text: isColor ? undefined : label,
        attrs: { 'aria-checked': String(v === current), 'aria-disabled': conflict ? 'true' : undefined, 'aria-label': isColor ? v : undefined },
        on: { click: () => (conflict ? undefined : this.pick(r.key, v)) },
      });
    });
    if (buttons.length && !buttons.some((b) => b.tabIndex === 0)) buttons[0].tabIndex = 0;
    const list = h(
      'div',
      { class: `ui-char__opts ui-char__opts--${r.kind}`, role: 'radiogroup', attrs: { 'aria-label': `${group}: ${r.label}`, 'data-key': r.key } },
      ...buttons,
    );
    list.addEventListener('keydown', (ev) => this.onRadioKey(ev, buttons, r.key, values));
    return h('div', { class: 'ui-char__row' }, h('span', { class: 'ui-char__row-label', text: r.label }), list);
  }

  /** Setas mudam a escolha dentro da linha (padrão de radiogroup), pulando opções desabilitadas. */
  private onRadioKey(ev: KeyboardEvent, buttons: HTMLButtonElement[], key: PartKey, values: readonly string[]): void {
    const step = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    ev.preventDefault();
    const n = buttons.length;
    const from = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement));
    for (let i = 1; i < n; i++) {
      const j = (((from + step * i) % n) + n) % n;
      if (buttons[j].getAttribute('aria-disabled') !== 'true') return this.pick(key, values[j]);
    }
  }

  private drawPreview(a: Appearance): void {
    try {
      const s = characterSprite({ appearance: a, dir: 'down', pose: 'stand', frame: 0 });
      const c = this.preview;
      c.width = s.canvas.width * PREVIEW_SCALE;
      c.height = s.canvas.height * PREVIEW_SCALE;
      const g = c.getContext('2d');
      if (!g) return;
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, c.width, c.height);
      g.drawImage(s.canvas, 0, 0, c.width, c.height);
    } catch (err) {
      // A arte ainda pode estar em construção: o editor continua utilizável sem a prévia.
      console.warn('[ui] falha ao desenhar a prévia do personagem', err);
    }
  }
}
