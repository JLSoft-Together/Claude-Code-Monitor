// Configurações (popover): opções do escritório, avisos, modo demonstração e Sobre (versão). O Habblaud World tem a
// janela própria (ui/world/world-dialog.ts); daqui só sai a dica do tema em Aparência, que também vai para o prédio.
import { access, remoteLogout } from '../net/access';
import type { UiComponent, UiContext } from './context';
import { h, iconButton, setAttr, setHidden, setText } from './dom';
import { ICONS } from './icons';
import { notificationState, type Notifier } from './notify';
import type { UiPrefs } from './prefs';
import { SoundSettingsGroup } from './settings-sound';
import type { SoundControl } from './sound';
import { AboutGroup } from './version';
import type { WorldThemeLink } from './world/world-dialog';
import { LOCALE_STORAGE_KEY, LOCALES, normalizeLocale, tr, type Locale } from '../../../shared/i18n';

type LanguageChoice = 'auto' | Locale;

/** Idioma escolhido nas Configurações ("auto" = o do navegador). */
function savedLanguage(): LanguageChoice {
  try {
    return normalizeLocale(localStorage.getItem(LOCALE_STORAGE_KEY)) ?? 'auto';
  } catch {
    return 'auto';
  }
}

/** Salva a escolha e recarrega: os textos são montados uma vez, ao carregar a página. */
function pickLanguage(v: LanguageChoice): void {
  if (v === savedLanguage()) return;
  try {
    if (v === 'auto') localStorage.removeItem(LOCALE_STORAGE_KEY);
    else localStorage.setItem(LOCALE_STORAGE_KEY, v);
  } catch {
    return;
  }
  location.reload();
}

type BoolPref = { [K in keyof UiPrefs]: UiPrefs[K] extends boolean ? K : never }[keyof UiPrefs];

interface SwitchRefs {
  btn: HTMLButtonElement;
  hint: HTMLElement;
}

export function switchRow(label: string, hintText: string, onToggle: () => void): SwitchRefs & { row: HTMLElement } {
  const id = `ui-sw-${label.replace(/\W+/g, '-').toLowerCase()}`;
  const btn = h('button', { class: 'ui-switch', type: 'button', role: 'switch', attrs: { 'aria-checked': 'false', 'aria-labelledby': id } }, h('span', { class: 'ui-switch__knob' }));
  btn.addEventListener('click', onToggle);
  const hint = h('span', { class: 'ui-set__hint', text: hintText });
  const row = h('div', { class: 'ui-set' }, h('div', { class: 'ui-set__text' }, h('span', { class: 'ui-set__label', text: label, attrs: { id } }), hint), btn);
  return { row, btn, hint };
}

export function segmented<T extends string>(label: string, options: readonly [T, string][], onPick: (v: T) => void): { row: HTMLElement; set(v: T): void } {
  const group = h('div', { class: 'ui-seg', role: 'radiogroup', attrs: { 'aria-label': label } });
  const buttons = options.map(([value, text]) => {
    const b = h('button', { class: 'ui-seg__opt', type: 'button', role: 'radio', text, attrs: { 'aria-checked': 'false' } });
    b.addEventListener('click', () => onPick(value));
    b.addEventListener('keydown', (e) => {
      // Setas navegam entre as opções (padrão de radiogroup).
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      e.stopPropagation();
      const i = options.findIndex(([v]) => v === value);
      const next = options[(i + (e.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length];
      onPick(next[0]);
      buttons[options.indexOf(next)].focus();
    });
    group.append(b);
    return b;
  });
  const row = h('div', { class: 'ui-set ui-set--stack' }, h('span', { class: 'ui-set__label', text: label }), group);
  return {
    row,
    set(v: T) {
      options.forEach(([value], i) => {
        const on = value === v;
        setAttr(buttons[i], 'aria-checked', String(on));
        buttons[i].tabIndex = on ? 0 : -1;
      });
    },
  };
}

export class SettingsPopover implements UiComponent {
  readonly el: HTMLElement;
  private switches = new Map<BoolPref | 'demo', SwitchRefs>();
  private bubbles: ReturnType<typeof segmented<UiPrefs['bubbles']>>;
  private liveliness: ReturnType<typeof segmented<UiPrefs['liveliness']>>;
  private daylight: ReturnType<typeof segmented<UiPrefs['daylight']>>;
  private theme: ReturnType<typeof segmented<UiPrefs['theme']>>;
  private language: ReturnType<typeof segmented<LanguageChoice>>;
  private soundGroup: SoundSettingsGroup;
  private demoGroup: HTMLElement;
  /** Só na página do celular (porta remota com login): sair deste aparelho. */
  private remoteGroup: HTMLElement;
  private logoutBtn: HTMLButtonElement;
  private about: AboutGroup;
  private demoBusy = false;
  private anchor: HTMLElement | null = null;

  constructor(
    private ctx: UiContext,
    private notifier: Notifier,
    sound: SoundControl,
    /** A janela do Habblaud World: a dica do tema em Aparência e o envio do tema ao prédio. */
    private readonly world: WorldThemeLink,
  ) {
    const sw = (key: BoolPref | 'demo', label: string, hint: string, onToggle: () => void) => {
      const r = switchRow(label, hint, onToggle);
      this.switches.set(key, r);
      return r.row;
    };
    const flip = (key: BoolPref) => () => ctx.updatePrefs({ [key]: !ctx.prefs[key] } as Partial<UiPrefs>);

    this.bubbles = segmented<UiPrefs['bubbles']>(
      tr('Balões de atividade'),
      [
        ['all', tr('Todos')],
        ['important', tr('Importantes')],
        ['none', tr('Nenhum')],
      ],
      (v) => ctx.updatePrefs({ bubbles: v }),
    );
    this.liveliness = segmented<UiPrefs['liveliness']>(
      tr('Movimento pelo escritório'),
      [
        ['calm', tr('Calmo')],
        ['normal', tr('Normal')],
        ['lively', tr('Agitado')],
      ],
      (v) => ctx.updatePrefs({ liveliness: v }),
    );
    this.daylight = segmented<UiPrefs['daylight']>(
      tr('Ciclo dia/noite'),
      [
        ['auto', tr('Automático')],
        ['day', tr('Sempre dia')],
        ['night', tr('Sempre noite')],
      ],
      (v) => ctx.updatePrefs({ daylight: v }),
    );
    this.daylight.row.append(h('span', { class: 'ui-set__hint', text: tr('Automático: céu, luzes e sol nas janelas seguem a hora local.') }));
    this.theme = segmented<UiPrefs['theme']>(
      tr('Tema do escritório'),
      [['auto', tr('Automático')], ['none', tr('Nenhum')], ['christmas', tr('Natal')], ['halloween', tr('Halloween')]],
      (v) => {
        ctx.updatePrefs({ theme: v });
        // Com o World ligado e a conta aprovada, o tema também vai para o prédio (clicar de novo reenvia).
        void this.world.onThemePicked(v);
      },
    );
    this.theme.row.append(h('span', { class: 'ui-set__hint', text: tr('Automático: Halloween em outubro e Natal de 1º de novembro a 26 de dezembro; no resto do ano, o visual original. Nenhum: sempre o original.') }));
    this.soundGroup = new SoundSettingsGroup(ctx, sound);

    // Nomes dos idiomas sempre na própria língua, para quem não entende o idioma atual achar o seu.
    this.language = segmented<LanguageChoice>(
      tr('Idioma da interface'),
      [['auto', tr('Automático')], ...LOCALES.map((l): [LanguageChoice, string] => [l.id, l.name])],
      (v) => pickLanguage(v),
    );
    this.language.row.append(
      h('span', { class: 'ui-set__hint', text: tr('Os textos das atividades vêm do servidor: seguem HABBLAUD_LANG ou o idioma do sistema onde o Habblaud roda (o inglês, só com HABBLAUD_LANG=en).') }),
    );

    this.demoGroup = h(
      'div',
      { class: 'ui-set-group' },
      h('h3', { text: tr('Dados') }),
      sw('demo', tr('Modo demonstração'), tr('Coloca agentes fictícios no escritório, junto com os reais.'), () => void this.toggleDemo()),
    );

    this.logoutBtn = h('button', { class: 'ui-btn', type: 'button', text: tr('Sair'), on: { click: () => void this.logout() } }) as HTMLButtonElement;
    this.remoteGroup = h(
      'div',
      { class: 'ui-set-group', hidden: true },
      h('h3', { text: tr('Acesso pelo celular') }),
      h(
        'div',
        { class: 'ui-set' },
        h(
          'div',
          { class: 'ui-set__text' },
          h('span', { class: 'ui-set__label', text: tr('Sair deste aparelho') }),
          h('span', { class: 'ui-set__hint', text: tr('Encerra o login aqui (uma cópia do cookie também deixa de valer). Para voltar, entre com usuário e senha.') }),
        ),
        this.logoutBtn,
      ),
    );

    this.theme.row.append(world.themeNote);
    this.about = new AboutGroup(ctx);

    const close = iconButton(ICONS.close, tr('Fechar configurações'), () => this.hide(), 'ui-icon-btn--sm');
    this.el = h(
      'div',
      { class: 'ui-popover ui-settings', role: 'dialog', tabIndex: -1, attrs: { 'aria-label': tr('Configurações'), id: 'ui-settings', popover: 'auto' } },
      h('div', { class: 'ui-popover__head' }, h('h2', { text: tr('Configurações') }), close),
      h('div', { class: 'ui-set-group' }, h('h3', { text: tr('Aparência') }), this.theme.row),
      h(
        'div',
        { class: 'ui-set-group' },
        h('h3', { text: tr('Escritório') }),
        sw('showNames', tr('Mostrar nomes'), tr('Etiqueta com o nome acima de cada personagem.'), flip('showNames')),
        this.bubbles.row,
        this.liveliness.row,
        this.daylight.row,
      ),
      h(
        'div',
        { class: 'ui-set-group' },
        h('h3', { text: tr('Avisos') }),
        sw('browserNotifications', tr('Notificações do navegador'), tr('Avisa quando alguém precisa de você e a aba está em segundo plano.'), () => void this.toggleNotifications()),
      ),
      this.soundGroup.el,
      h('div', { class: 'ui-set-group' }, h('h3', { text: tr('Idioma') }), this.language.row),
      this.demoGroup,
      this.remoteGroup,
      this.about.el,
    );
    this.el.addEventListener('toggle', () => {
      this.anchor?.setAttribute('aria-expanded', String(this.isOpen));
      this.syncRootClass();
      if (this.isOpen) this.render();
    });
  }

  get isOpen(): boolean {
    try {
      return this.el.matches(':popover-open');
    } catch {
      return this.el.classList.contains('is-open');
    }
  }

  toggle(anchor: HTMLElement): void {
    this.anchor = anchor;
    if (this.isOpen) return this.hide();
    const r = anchor.getBoundingClientRect();
    this.el.style.top = `${Math.round(r.bottom + 8)}px`;
    this.el.style.right = `${Math.max(8, Math.round(innerWidth - r.right - 4))}px`;
    if (typeof this.el.showPopover === 'function') this.el.showPopover();
    else this.el.classList.add('is-open');
    anchor.setAttribute('aria-expanded', 'true');
    this.syncRootClass();
    // Leva o foco para dentro do popover (sem anel de foco num controle específico).
    this.el.focus();
  }

  /** Abre (se fechado) e leva até a seção "Sobre". */
  showAbout(anchor: HTMLElement): void {
    if (!this.isOpen) this.toggle(anchor);
    this.render();
    requestAnimationFrame(() => this.about.highlight());
  }

  hide(): void {
    if (typeof this.el.hidePopover === 'function' && this.isOpen) this.el.hidePopover();
    this.el.classList.remove('is-open');
    this.anchor?.setAttribute('aria-expanded', 'false');
    this.syncRootClass();
  }

  /** Com o popover aberto, os avisos recolhem (não aparecem por trás nem ao lado dele). */
  private syncRootClass(): void {
    this.ctx.root.classList.toggle('has-popover', this.isOpen);
  }

  private async logout(): Promise<void> {
    this.logoutBtn.disabled = true;
    if (!(await remoteLogout())) {
      this.logoutBtn.disabled = false;
      this.ctx.announce(tr('Não foi possível sair: sem resposta do servidor.'));
    }
  }

  render(): void {
    const p = this.ctx.prefs;
    for (const [key, r] of this.switches) {
      const on = key === 'demo' ? !!this.ctx.store.liveSnapshot?.meta.demo : p[key];
      setAttr(r.btn, 'aria-checked', String(on));
      r.btn.disabled = key === 'demo' && this.demoBusy;
    }
    this.bubbles.set(p.bubbles);
    this.liveliness.set(p.liveliness);
    this.daylight.set(p.daylight);
    this.theme.set(p.theme);
    this.language.set(savedLanguage());
    this.soundGroup.render();
    setHidden(this.demoGroup, this.ctx.store.mock || access().remote);
    setHidden(this.remoteGroup, !access().remote);
    this.about.render();

    const notif = this.switches.get('browserNotifications')!;
    const state = notificationState();
    const hint =
      state === 'unsupported'
        ? tr('Este navegador não oferece notificações.')
        : state === 'denied'
          ? tr('Bloqueadas pelo navegador: libere nas permissões do site.')
          : tr('Avisa quando alguém precisa de você e a aba está em segundo plano.');
    setText(notif.hint, hint);
    notif.btn.disabled = state === 'unsupported';
  }

  private async toggleNotifications(): Promise<void> {
    if (this.ctx.prefs.browserNotifications) {
      this.ctx.updatePrefs({ browserNotifications: false });
      return;
    }
    const state = await this.notifier.enableBrowserNotifications();
    this.ctx.updatePrefs({ browserNotifications: state === 'granted' });
    if (state === 'denied') this.ctx.announce(tr('Notificações bloqueadas pelo navegador.'));
  }

  private async toggleDemo(): Promise<void> {
    if (this.demoBusy) return;
    this.demoBusy = true;
    this.render();
    const enable = !this.ctx.store.snapshot?.meta.demo;
    try {
      const ok = await this.ctx.store.setDemo(enable);
      this.ctx.announce(ok ? (enable ? tr('Modo demonstração ligado.') : tr('Modo demonstração desligado.')) : tr('Não foi possível mudar o modo demonstração.'));
    } catch {
      this.ctx.announce(tr('Não foi possível falar com o servidor.'));
    } finally {
      this.demoBusy = false;
      this.ctx.invalidate();
    }
  }
}
