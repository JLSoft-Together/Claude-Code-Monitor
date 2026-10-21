// Grupo "Sons" das configurações: interruptor geral, volume mestre e categorias.
import { SOUND_CATEGORIES, type SoundCategory, type SoundKind } from '../audio/scheduler';
import type { UiContext } from './context';
import { h, setAttr, setText } from './dom';
import type { SoundControl } from './sound';
import { tr } from '../../../shared/i18n';

const CATEGORY_UI: Readonly<Record<SoundCategory, { label: string; hint: string; sample: SoundKind }>> = {
  alerts: { label: tr('Avisos'), hint: tr('Sino quando alguém precisa de você; estalo quando uma tarefa termina.'), sample: 'chime' },
  keys: { label: tr('Teclado'), hint: tr('Digitação baixinha de quem trabalha nas salas à vista.'), sample: 'keys' },
  elevator: { label: tr('Elevador'), hint: tr('"Ding" quando alguém chega ou vai embora.'), sample: 'elevator' },
  social: { label: tr('Rodas'), hint: tr('Pingue-pongue e fliperama no lounge.'), sample: 'pingpong' },
};

export class SoundSettingsGroup {
  readonly el: HTMLElement;
  private master: HTMLButtonElement;
  private volume: HTMLInputElement;
  private volumeOut: HTMLElement;
  private chips = new Map<SoundCategory, HTMLButtonElement>();
  private details: HTMLElement;

  constructor(
    private ctx: UiContext,
    private sound: SoundControl,
  ) {
    const id = 'ui-snd-master';
    this.master = h('button', { class: 'ui-switch', type: 'button', role: 'switch', attrs: { 'aria-checked': 'false', 'aria-labelledby': id } }, h('span', { class: 'ui-switch__knob' }));
    this.master.addEventListener('click', () => {
      const on = !ctx.prefs.sound;
      ctx.updatePrefs({ sound: on });
      if (on) this.sound.preview('pop');
    });

    this.volume = h('input', { class: 'ui-snd__range', type: 'range', attrs: { min: 0, max: 100, step: 5, 'aria-label': tr('Volume dos sons') } });
    this.volume.addEventListener('input', () => {
      ctx.updatePrefs({ sounds: { ...ctx.prefs.sounds, volume: Number(this.volume.value) / 100 } });
      setText(this.volumeOut, `${this.volume.value}%`);
    });
    // amostra ao soltar o controle (não a cada passo do arrasto)
    this.volume.addEventListener('change', () => this.sound.preview('pop'));
    this.volumeOut = h('span', { class: 'ui-snd__value', attrs: { 'aria-hidden': 'true' } });

    const chipRow = h('div', { class: 'ui-snd__chips', role: 'group', attrs: { 'aria-label': tr('Categorias de som') } });
    for (const cat of SOUND_CATEGORIES) {
      const ui = CATEGORY_UI[cat];
      const b = h('button', { class: 'ui-snd__chip', type: 'button', text: ui.label, title: ui.hint, attrs: { 'aria-pressed': 'true' } });
      b.addEventListener('click', () => {
        const on = !ctx.prefs.sounds[cat];
        ctx.updatePrefs({ sounds: { ...ctx.prefs.sounds, [cat]: on } });
        if (on) this.sound.preview(ui.sample);
      });
      this.chips.set(cat, b);
      chipRow.append(b);
    }

    this.details = h(
      'div',
      { class: 'ui-snd__details' },
      h('div', { class: 'ui-set ui-snd__vol' }, h('span', { class: 'ui-set__label', text: tr('Volume') }), this.volume, this.volumeOut),
      h('div', { class: 'ui-set ui-set--stack' }, h('span', { class: 'ui-set__label', text: tr('Tocar') }), chipRow, h('span', { class: 'ui-set__hint', text: tr('Avisos: sino e estalo · Teclado: quem digita nas salas à vista · Elevador: chegadas e saídas · Rodas: pingue-pongue e fliperama.') })),
    );

    this.el = h(
      'div',
      { class: 'ui-set-group ui-snd' },
      h('h3', { text: tr('Sons') }),
      h(
        'div',
        { class: 'ui-set' },
        h(
          'div',
          { class: 'ui-set__text' },
          h('span', { class: 'ui-set__label', text: tr('Sons do escritório'), attrs: { id } }),
          h('span', { class: 'ui-set__hint', text: tr('Sintetizados no navegador e baixinhos. Com a aba oculta, só o sino de "precisa de você".') }),
        ),
        this.master,
      ),
      this.details,
    );
  }

  render(): void {
    const p = this.ctx.prefs;
    setAttr(this.master, 'aria-checked', String(p.sound));
    const pct = String(Math.round(p.sounds.volume * 100));
    if (document.activeElement !== this.volume && this.volume.value !== pct) this.volume.value = pct;
    setText(this.volumeOut, `${this.volume.value}%`);
    this.volume.disabled = !p.sound;
    for (const [cat, b] of this.chips) {
      setAttr(b, 'aria-pressed', String(p.sounds[cat]));
      b.disabled = !p.sound;
    }
    this.details.classList.toggle('is-off', !p.sound);
  }
}
