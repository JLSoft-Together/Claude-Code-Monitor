// O conteúdo da janela "Habblaud World" (world-dialog.ts, o botão próprio da barra do topo): conta (cadastro com
// aceite dos termos e o resumo de privacidade, código do e-mail, login, esqueci a senha), lista de espera, personagem
// (o editor de aparência da gaveta do agente, mais nome, traços e frase de apresentação), o cartão "Seu prédio" com
// Pausar/Retomar e "Ver o que foi enviado" (building.ts), visibilidade do prédio, dispositivos e sair. Também a dica
// do tema em Configurações › Aparência, quando a escolha vai para o prédio. Fase 6: "Conta e dados" (o aviso de
// inatividade, "Baixar meus dados" e "Excluir conta" em três etapas: o que some e quando, a confirmação e o código do
// e-mail), o aviso da manutenção do mundo e o da conta excluída. Fala com as rotas locais /api/world/* (net/world.ts);
// as regras puras estão em world-model.ts.
//
// A janela chama render() a cada quadro sujo: o miolo só é refeito quando a tela muda (senão o que foi digitado e o
// foco se perderiam); o status é buscado ao abrir a janela, depois de cada ação e quando o meta.world do snapshot
// muda, nunca dentro do render.
import { getLocale, intlLocale, tr } from '../../../../shared/i18n';
import type { Appearance } from '../../art/api';
import { access } from '../../net/access';
import {
  buildingFromMeta,
  FAKE_CODE,
  type WorldClient,
  type WorldDevice,
  type WorldErrorCode,
  type WorldResult,
  type WorldSource,
  type WorldStatus,
  type WorldThemeChoice,
  type WorldVisibility,
} from '../../net/world';
import { BuildingCard, SentDialog } from './building';
import { buildBlocked } from './blocked';
import { TRAITS, TRAIT_IDS, type TraitId } from '../../../../shared/world/traits';
import { AppearanceFields } from '../appearance-fields';
import { createAvatar } from '../avatar';
import type { UiContext } from '../context';
import { h, setAttr, setHidden, setText, setVariant } from '../dom';
import { formatDateTime, relativeTime } from '../format';
import { segmented, switchRow } from '../settings';
import { INTRO_IDS, introLabel, isIntroId, type IntroId } from '../../../../shared/world/intro';
import { parsePlayerName } from '../../../../shared/world/names-rules';
import { PLAYER_NAME_LIMITS } from '../../../../shared/world/protocol';
import {
  APPEAL_EMAIL,
  characterProblem,
  codeLooksValid,
  DEFAULT_VISIBILITY,
  draftAppearance,
  emailLooksValid,
  EXPORT_FILENAME,
  fullParts,
  initialWorldUi,
  nameProblemText,
  normalizeCode,
  normalizeEmail,
  notifyInactivityOn,
  passwordProblem,
  passwordProblemText,
  themeGoesToWorld,
  traitBlock,
  toggleTrait,
  VISIBILITY_SWITCHES,
  worldErrorText,
  worldReduce,
  worldSectionMode,
  type VisibilitySwitch,
  type WorldAction,
  type WorldFlash,
  type WorldGate,
  type WorldScreen,
  type WorldSectionMode,
  type WorldUi,
  type WorldUiEvent,
} from './world-model';
import { extLink, WORLD_PRIVACY_URL, WORLD_TERMS_URL } from './links';

export { extLink, WORLD_PRIVACY_URL, WORLD_TERMS_URL } from './links';

/** Depois de reenviar o código, o botão espera este tempo (o servidor também limita: 3 por hora). */
const RESEND_COOLDOWN_MS = 30_000;

// ------------------------------------------------------------------ pedaços de DOM

/**
 * Frase traduzida com elementos no meio: as lacunas {0}, {1}... de `text` (já passado por tr(), sem argumentos) viram
 * os nós de `nodes`. Assim a tradução decide onde o link entra na frase.
 */
export function rich(text: string, nodes: readonly Node[]): (Node | string)[] {
  return text.split(/(\{\d+\})/).map((part) => {
    const m = /^\{(\d+)\}$/.exec(part);
    return m && nodes[Number(m[1])] ? nodes[Number(m[1])] : part;
  });
}

function para(cls: string, ...children: (Node | string)[]): HTMLParagraphElement {
  return h('p', { class: cls }, ...children);
}

function backButton(onClick: () => void): HTMLButtonElement {
  return h('button', { class: 'ui-link-btn ui-world__back', type: 'button', text: tr('← Voltar'), on: { click: onClick } });
}

function screenHead(title: string, onBack: () => void): HTMLElement {
  return h('div', { class: 'ui-world__head' }, backButton(onBack), h('h4', { class: 'ui-world__title', text: title }));
}

interface FieldRefs {
  label: HTMLElement;
  input: HTMLInputElement;
}

let fieldSeq = 0;

function field(labelText: string, input: HTMLInputElement, hint?: string): FieldRefs {
  const id = `ui-world-f${++fieldSeq}`;
  input.id = id;
  const hintEl = hint ? h('span', { class: 'ui-set__hint', text: hint, attrs: { id: `${id}-hint` } }) : null;
  if (hintEl) setAttr(input, 'aria-describedby', hintEl.id);
  const label = h('div', { class: 'ui-world__field' }, h('label', { class: 'ui-world__label', text: labelText, attrs: { for: id } }), input, hintEl);
  return { label, input };
}

function textInput(type: string, autocomplete: string, extra: Record<string, string | number | boolean> = {}): HTMLInputElement {
  return h('input', { class: 'ui-world__input', type, attrs: { autocomplete, spellcheck: 'false', autocapitalize: 'off', ...extra } });
}

/** Senha com "Mostrar senha" (a senha longa é a regra: dá vontade de conferir o que digitou). */
function passwordField(labelText: string, autocomplete: 'new-password' | 'current-password', hint?: string): FieldRefs {
  const input = textInput('password', autocomplete, { maxlength: 256 });
  const f = field(labelText, input, hint);
  const toggle = h('button', { class: 'ui-link-btn ui-world__peek', type: 'button', text: tr('Mostrar senha') });
  toggle.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    setText(toggle, show ? tr('Esconder senha') : tr('Mostrar senha'));
    setAttr(toggle, 'aria-pressed', String(show));
  });
  setAttr(toggle, 'aria-pressed', 'false');
  f.label.append(toggle);
  return f;
}

function emailField(): FieldRefs {
  return field(tr('E-mail'), textInput('email', 'email', { inputmode: 'email', maxlength: 254 }));
}

function codeField(): FieldRefs {
  const input = textInput('text', 'one-time-code', { inputmode: 'numeric', maxlength: 9, placeholder: '000000' });
  input.classList.add('ui-world__code');
  input.addEventListener('input', () => {
    const v = normalizeCode(input.value);
    if (v !== input.value && /^\d*$/.test(v)) input.value = v;
  });
  return field(tr('Código de 6 dígitos'), input);
}

/** Formulário de uma tela: botão principal com estado de "enviando" e a linha de erro. */
class Form {
  readonly el: HTMLFormElement;
  readonly error: HTMLElement;
  readonly submit: HTMLButtonElement;
  private readonly label: string;

  constructor(submitText: string, onSubmit: () => void, private readonly busyText: string) {
    this.label = submitText;
    this.submit = h('button', { class: 'ui-btn ui-btn--primary', type: 'submit', text: submitText });
    this.error = h('p', { class: 'ui-world__error', role: 'alert', hidden: true });
    this.el = h('form', { class: 'ui-world__form', attrs: { novalidate: true } });
    this.el.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (!this.submit.disabled) onSubmit();
    });
  }

  setBusy(on: boolean): void {
    this.submit.disabled = on;
    setAttr(this.submit, 'aria-busy', on ? 'true' : null);
    setText(this.submit, on ? this.busyText : this.label);
  }

  setError(text: string | null, focus?: HTMLElement): void {
    setText(this.error, text ?? '');
    setHidden(this.error, !text);
    if (text) focus?.focus();
  }
}

function toMillis(v: number | string | undefined): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/** "Dispositivo 2" chega em português do servidor: aqui vira o texto do idioma da interface. */
export function deviceLabel(label: string): string {
  const m = /^Dispositivo (\d+)$/.exec(label);
  return m ? tr('Dispositivo {0}', [m[1]]) : label;
}

/** Nome do país no idioma da interface ("BR" → "Brasil"). */
function countryName(code: string): string {
  try {
    return new Intl.DisplayNames([intlLocale()], { type: 'region' }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

function flashText(f: WorldFlash): string {
  switch (f) {
    case 'code_sent':
      return '';
    case 'code_resent':
      return tr('Mandamos outro código.');
    case 'password_changed':
      return tr('Senha trocada. Entre com a senha nova.');
    case 'signed_out':
      return tr('Você saiu da conta do Habblaud World neste computador.');
    case 'character_saved':
      return tr('Personagem salvo.');
    case 'device_revoked':
      return tr('Dispositivo revogado.');
  }
}

function visibilityText(key: VisibilitySwitch): { label: string; hint: string } {
  switch (key) {
    case 'closed':
      return { label: tr('Fechado a visitas'), hint: tr('Dá para ver o prédio por fora, mas ninguém entra.') };
    case 'hideCountry':
      return { label: tr('Esconder o país'), hint: tr('No lugar da bandeira do país (visto pelo IP da conexão) aparece uma bandeira neutra.') };
    case 'tokensVisible':
      return { label: tr('Mostrar o consumo de tokens'), hint: tr('Total do dia e da semana do prédio inteiro, só em faixas (até 100 mil, 1 milhão…). Nunca o custo.') };
    case 'leaderboard':
      return { label: tr('Entrar no placar'), hint: tr('O prédio pode aparecer nos placares de tokens da cidade.') };
    case 'compactions':
      return { label: tr('Mostrar as compactações'), hint: tr('Quando um agente compacta o contexto, a lixeira da sala enche. Sai só o fato, nada do conteúdo.') };
    case 'knocks':
      return { label: tr('Avisar quando baterem na porta'), hint: tr('Quem estiver na porta do seu prédio pode bater; o aviso chega aqui no Habblaud, sem o nome de quem bateu.') };
  }
}

/** As travas da seção nesta página (celular, endereço local, trava do terminal, modo demonstração). */
export function worldGate(ctx: UiContext, src: WorldSource): WorldGate {
  const a = access();
  return { remote: a.remote, local: a.local, terminal: !!ctx.store.liveSnapshot?.meta.terminal, fake: src.fake };
}

/** Tela montada: o elemento e, se precisar, o que atualizar sem refazer (texto, estado dos botões). */
interface View {
  el: HTMLElement;
  sync?(): void;
}

// ------------------------------------------------------------------ a seção

export class WorldSettingsGroup {
  readonly el: HTMLElement;
  /** O estado da conta ("Sem conta", "Na lista de espera", "Liberado"), no cabeçalho da janela. */
  readonly chip: HTMLElement;
  private readonly flashEl: HTMLElement;
  private readonly body: HTMLElement;
  private ui: WorldUi = initialWorldUi();
  private mode: WorldSectionMode = 'hidden';
  private status: WorldStatus | null = null;
  /** Sobe quando o status muda de fato: as telas que mostram dados da conta se refazem. */
  private statusRev = 0;
  private statusSig = '';
  private statusError: WorldErrorCode | null = null;
  private loading = false;
  private stale = true;
  private statusReq = 0;
  private metaState: string | undefined;
  private wasOpen = false;
  private builtKey = '';
  private view: View | null = null;
  /** Sobe a cada tela montada: a resposta de um pedido feito em outra tela não mexe na atual. */
  private epoch = 0;
  private lastFlash: WorldFlash | null = null;
  private resendUntil = 0;
  /** `meta.world.building` da última vez: quando muda (remessa nova, pausa), o status é relido com a seção aberta. */
  private metaBuildingSig = '';
  private readonly sent: SentDialog;
  /** Dica em Aparência › Tema do escritório (só quando a escolha também vai para o prédio). */
  readonly themeNote: HTMLElement;
  private readonly themeError: HTMLElement;
  private themeLinked = false;
  private themeReq = 0;
  /** Um PUT do tema a caminho (o status que chegar no meio não decide o tema). */
  private themeInflight = 0;
  /** Quando a última escolha de tema foi feita aqui (um status pedido antes dela não a desfaz). */
  private themePickedAt = 0;
  /** Relógio lógico das escolhas de tema e dos pedidos de status (qual veio antes). */
  private themeClock = 0;

  constructor(
    private readonly ctx: UiContext,
    private readonly src: WorldSource,
  ) {
    this.chip = h('span', { class: 'ui-world__chip' });
    this.flashEl = h('p', { class: 'ui-world__flash', role: 'status', hidden: true });
    this.body = h('div', { class: 'ui-world__body' });
    this.sent = new SentDialog(() => this.client, () => this.ctx.now());
    this.el = h('div', { class: 'ui-world', hidden: true, attrs: { id: 'ui-world' } }, this.flashEl, this.body, this.sent.el);
    this.themeError = h('span', { class: 'ui-world__error', role: 'alert', hidden: true });
    this.themeNote = h('span', { class: 'ui-set__hint ui-world-theme', hidden: true }, h('span', { text: tr('O tema também vale para o seu prédio no Habblaud World.') }), this.themeError);
    src.onChange?.(() => {
      this.stale = true;
      ctx.invalidate();
    });
  }

  private get client(): WorldClient | null {
    return this.src.client;
  }

  /** A cada render da janela, aberta ou não (barato: só refaz o miolo quando a tela muda). */
  render(open: boolean): void {
    const meta = this.src.meta();
    const gate = worldGate(this.ctx, this.src);
    this.mode = worldSectionMode(meta, gate);
    setHidden(this.el, this.mode === 'hidden');
    this.themeLinked = themeGoesToWorld(meta, gate);
    setHidden(this.themeNote, !this.themeLinked);
    if (this.mode === 'active' && meta) {
      if (meta.state !== this.metaState) {
        this.metaState = meta.state;
        this.stale = true;
        // Antes do primeiro status, a tela segue o snapshot.
        if (!this.status) this.ui = worldReduce(this.ui, { type: 'server', state: meta.state });
      }
      const buildingSig = JSON.stringify(meta.building ?? null);
      if (buildingSig !== this.metaBuildingSig) {
        this.metaBuildingSig = buildingSig;
        this.stale = true;
      }
      if (open && !this.wasOpen) this.stale = true;
      if (open && this.stale && !this.loading) void this.refresh();
    }
    this.wasOpen = open;
    this.paint();
  }

  /** Vai para uma tela (os popups de lançamento pedem o cadastro ou o personagem; o chip do topo, o prédio). */
  show(screen?: WorldScreen): void {
    if (screen) this.ui = worldReduce(this.ui, { type: 'go', screen });
    this.ctx.invalidate();
  }

  /**
   * A escolha de Aparência › Tema do escritório também vai para o prédio (PUT /api/world/theme), quando o World está
   * ligado e a conta aprovada. Se não der, a dica do tema mostra o erro (o escritório troca de tema do mesmo jeito).
   */
  async onThemePicked(theme: WorldThemeChoice): Promise<void> {
    const client = this.client;
    this.themePickedAt = ++this.themeClock;
    if (!this.themeLinked || !client) return;
    const req = ++this.themeReq;
    this.themeInflight++;
    const r = await client.setTheme(theme).finally(() => this.themeInflight--);
    if (req !== this.themeReq) return;
    setText(this.themeError, r.ok ? '' : ` ${tr('Não deu para mandar o tema para o prédio: {0}', [worldErrorText(r.code, 'theme')])}`);
    setHidden(this.themeError, r.ok);
  }

  /**
   * O tema do escritório e o do prédio ficam iguais (o status traz o do prédio, guardado em world.json): uma escolha
   * guardada neste computador (`theme` presente) vale também para o escritório desta página; sem escolha guardada (o
   * automático, padrão), a escolha desta página vai para o prédio. Nada disso com um PUT do tema a caminho, nem com um
   * status pedido antes da última escolha feita aqui.
   */
  private syncTheme(st: WorldStatus, askedAt: number): void {
    if (!this.themeLinked || st.state !== 'approved' || this.themeInflight > 0 || askedAt < this.themePickedAt) return;
    const pref = this.ctx.prefs.theme;
    if (st.theme && st.theme !== pref) this.ctx.updatePrefs({ theme: st.theme });
    else if (!st.theme && pref !== 'auto') void this.onThemePicked(pref);
  }

  /** Volta ao topo do corpo rolável da janela (a cada tela nova, o começo dela é o que importa). */
  private scrollToTop(): void {
    const host = this.el.parentElement;
    if (host) host.scrollTop = 0;
  }

  private dispatch(e: WorldUiEvent): void {
    this.ui = worldReduce(this.ui, e);
    this.ctx.invalidate();
  }

  private go(screen: WorldScreen): void {
    this.dispatch({ type: 'go', screen });
  }

  private async refresh(force = false): Promise<void> {
    const client = this.client;
    if (!client) return;
    const req = ++this.statusReq;
    const askedAt = this.themeClock;
    this.loading = true;
    this.stale = false;
    const r = await client.status(force);
    if (req !== this.statusReq) return;
    this.loading = false;
    if (r.ok) {
      this.status = r.data;
      this.syncTheme(r.data, askedAt);
      // O prédio muda a cada remessa: o cartão se atualiza sozinho (BuildingCard.sync), sem refazer a tela.
      const { building: _building, ...rest } = r.data;
      const sig = JSON.stringify(rest);
      if (sig !== this.statusSig) {
        this.statusSig = sig;
        this.statusRev++;
      }
      this.statusError = null;
      this.ui = worldReduce(this.ui, { type: 'server', state: r.data.state });
    } else {
      this.statusError = r.code;
    }
    this.ctx.invalidate();
  }

  /**
   * Roda uma ação da tela: trava o botão, mostra o erro traduzido. Devolve o resultado, ou null quando a tela mudou
   * no meio (a resposta não vale mais para o que está na frente).
   */
  private async run<T>(form: Form, action: WorldAction, call: (c: WorldClient) => Promise<WorldResult<T>>, focus?: HTMLElement): Promise<WorldResult<T> | null> {
    const client = this.client;
    if (!client) return null;
    const epoch = this.epoch;
    form.setBusy(true);
    form.setError(null);
    const r = await call(client);
    if (epoch !== this.epoch) return null;
    form.setBusy(false);
    if (!r.ok) form.setError(worldErrorText(r.code, action), focus);
    return r;
  }

  // ---------------------------------------------------------------- montagem

  private viewKey(): string {
    if (this.mode !== 'active') return this.mode;
    const signedIn = this.ui.server === 'waiting' || this.ui.server === 'approved';
    if (signedIn && !this.status) return this.statusError ? `error:${this.statusError}` : 'loading';
    return `screen:${this.ui.screen}`;
  }

  private paint(): void {
    const key = this.viewKey();
    if (key !== this.builtKey) {
      this.builtKey = key;
      this.epoch++;
      this.view = this.build();
      this.body.replaceChildren(this.view.el);
      this.scrollToTop();
    } else {
      this.view?.sync?.();
    }
    setText(this.chip, this.chipText());
    setVariant(this.chip, 'is-', this.mode === 'active' ? (this.ui.server ?? 'loading') : this.mode);
    const flash = this.ui.flash ? flashText(this.ui.flash) : '';
    setText(this.flashEl, flash);
    setHidden(this.flashEl, !flash);
    if (this.ui.flash !== this.lastFlash) {
      this.lastFlash = this.ui.flash;
      if (flash) this.ctx.announce(flash);
    }
  }

  private chipText(): string {
    if (this.mode === 'local_only') return tr('Só pelo computador');
    switch (this.ui.server) {
      case 'logged_out':
        return tr('Sem conta');
      case 'waiting':
        return tr('Na lista de espera');
      case 'approved':
        return tr('Liberado');
      default:
        return '';
    }
  }

  private build(): View {
    if (this.mode === 'local_only') return { el: para('ui-set__hint', tr('A conta do Habblaud World só pode ser mexida no próprio computador, com o Habblaud em acesso local (bind 127.0.0.1) e aberto por http://localhost.')) };
    if (this.mode !== 'active') return { el: h('div') };
    const key = this.builtKey;
    if (key === 'loading') return { el: para('ui-set__hint', tr('Carregando…')) };
    if (key.startsWith('error:')) return this.buildStatusError();
    switch (this.ui.screen) {
      case 'welcome':
        return this.buildWelcome();
      case 'register':
        return this.buildRegister();
      case 'login':
        return this.buildLogin();
      case 'verify':
        return this.buildVerify();
      case 'forgot':
        return this.buildForgot();
      case 'reset':
        return this.buildReset();
      case 'home':
        return this.buildHome();
      case 'character':
        return this.buildCharacter();
      case 'visibility':
        return this.buildVisibility();
      case 'devices':
        return this.buildDevices();
      case 'account':
        return this.buildAccount();
      case 'blocked':
        return this.buildBlocked();
    }
  }

  private buildStatusError(): View {
    const retry = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Tentar de novo'), on: { click: () => void this.refresh() } });
    return {
      el: h('div', { class: 'ui-world__stack' }, para('ui-world__error', worldErrorText(this.statusError ?? 'unknown', 'status')), h('div', { class: 'ui-world__actions' }, retry)),
    };
  }

  /** Frase de privacidade do cartão e das boas-vindas (2.1 do plano), com o link para a lista. */
  private privacyLine(): HTMLElement {
    return para(
      'ui-world__privacy',
      tr('Nada do seu trabalho sai do computador: só o tema, quantos andares e se cada personagem está ocupado ou à toa.'),
      ' ',
      extLink(tr('Ver a lista'), WORLD_PRIVACY_URL),
    );
  }

  private buildWelcome(): View {
    const create = h('button', { class: 'ui-btn ui-btn--primary', type: 'button', text: tr('Criar conta'), on: { click: () => this.go('register') } });
    const login = h('button', { class: 'ui-btn', type: 'button', text: tr('Já tenho conta'), on: { click: () => this.go('login') } });
    // A conta acabou de ser excluída (aqui ou em outro computador): o aviso fica até entrar de novo.
    const deleted = this.status?.lastError === 'account_deleted' ? para('ui-world__notice', worldErrorText('account_deleted', 'status')) : null;
    return {
      el: h(
        'div',
        { class: 'ui-world__stack' },
        deleted,
        para('ui-world__lead', tr('Leve o seu escritório para uma cidade em pixel art: um prédio seu, aceso enquanto os agentes trabalham, e um personagem para passear e visitar os prédios de outras pessoas.')),
        this.privacyLine(),
        para('ui-set__hint', tr('O acesso é liberado aos poucos: quem cria a conta entra numa lista de espera.')),
        h('div', { class: 'ui-world__actions' }, create, login),
      ),
    };
  }

  /** Resumo da seção 3 do plano (o que sai e o que nunca sai), na tela do aceite. */
  private privacySummary(): HTMLElement {
    return h(
      'section',
      { class: 'ui-world__summary', attrs: { 'aria-label': tr('O que sai do seu computador') } },
      h('h4', { class: 'ui-world__summary-title', text: tr('O que sai do seu computador') }),
      para(
        'ui-world__official',
        tr('Quem visita o mundo vê, ao vivo, quantos projetos e agentes você está rodando e o que cada personagem está fazendo (trabalhando, esperando, à toa). Ninguém vê quais projetos são, o que os agentes fazem, nem quem você é: só o nickname e o avatar que você escolheu.'),
      ),
      h(
        'ul',
        { class: 'ui-world__list' },
        h('li', {}, h('strong', { text: tr('Sai:') }), ' ', tr('o tema do escritório; um andar por sala aberta, com um código aleatório que muda todo dia; de cada agente, se é principal ou subagente, a ferramenta, o status, a aparência, um nome sorteado e a faixa de tarefas concluídas no dia; os tokens do prédio arredondados em faixas (dá para desligar); se você ligar, o fato de um agente ter compactado o contexto; a versão e o commit do Habblaud, com a marca de cópia modificada; e o idioma da interface, só para os e-mails.')),
        h('li', {}, h('strong', { text: tr('Nunca sai:') }), ' ', tr('caminhos e nomes de projetos, títulos de sessão, comandos, mensagens, código, custo, a sua conta do Claude, o seu e-mail e o nome do computador.')),
      ),
      para('ui-world__key', tr('Com os dados que saem não dá para saber quem você é nem em que trabalha.')),
      para('ui-set__hint', tr('Os agentes trabalham sem você: prédio aceso não quer dizer que você está no computador. Se preferir, use o modo discreto ou feche o prédio a visitas.')),
      extLink(tr('Ver a lista completa'), WORLD_PRIVACY_URL),
    );
  }

  private buildRegister(): View {
    const email = emailField();
    email.input.value = this.ui.email;
    // O nome de jogador (nickname) é escolhido no cadastro: fica reservado para a conta na lista de espera e vira o
    // nome do personagem. Conferido aqui pelas mesmas regras do personagem; o servidor do mundo decide (e diz se já
    // está em uso).
    const name = field(
      tr('Nome de jogador'),
      textInput('text', 'nickname', { maxlength: PLAYER_NAME_LIMITS.max * 2 }),
      tr('3 a 20 caracteres; é o nome do seu personagem e fica reservado para você, mesmo na lista de espera. Único no mundo.'),
    );
    name.input.value = this.ui.name;
    const password = passwordField(tr('Senha'), 'new-password', tr('Pelo menos 12 caracteres. Uma frase longa vale mais do que símbolos; senhas que já vazaram são recusadas.'));
    const accept = h('input', { class: 'ui-world__checkbox', type: 'checkbox' });
    const form = new Form(tr('Criar conta'), () => void submit(), tr('Criando a conta…'));
    const submit = async () => {
      const mail = normalizeEmail(email.input.value);
      if (!emailLooksValid(mail)) return form.setError(tr('Digite um e-mail válido.'), email.input);
      const parsed = parsePlayerName(name.input.value);
      if (!parsed.ok) return form.setError(nameProblemText(parsed.problem), name.input);
      const problem = passwordProblem(password.input.value, mail);
      if (problem) return form.setError(passwordProblemText(problem), password.input);
      if (!accept.checked) return form.setError(tr('Para criar a conta, aceite os Termos de Uso e a Política de Privacidade.'), accept);
      const r = await this.run(form, 'register', (c) => c.register({ email: mail, password: password.input.value.normalize('NFC'), name: parsed.name, locale: getLocale() }), email.input);
      if (!r) return;
      if (r.ok) return this.dispatch({ type: 'code_sent', email: mail, name: parsed.name });
      // Os erros do nome vão para o campo do nome (o `run` já mostrou o texto genérico do código).
      if (r.code === 'name_taken') form.setError(tr('Esse nome já está em uso. Escolha outro.'), name.input);
      else if (r.code === 'name_invalid' || r.code === 'name_blocked') form.setError(worldErrorText(r.code, 'register'), name.input);
    };
    form.el.append(
      email.label,
      name.label,
      password.label,
      this.privacySummary(),
      para('ui-world__truth', tr('O World só funciona se os prédios forem verdadeiros. Mandar dados inventados quebra os termos e bane a conta.')),
      h(
        'label',
        { class: 'ui-world__accept' },
        accept,
        h('span', {}, ...rich(tr('Li e aceito os {0} e a {1} do Habblaud World.'), [extLink(tr('Termos de Uso'), WORLD_TERMS_URL), extLink(tr('Política de Privacidade'), WORLD_PRIVACY_URL)])),
      ),
      form.error,
      h('div', { class: 'ui-world__actions' }, form.submit, h('button', { class: 'ui-btn', type: 'button', text: tr('Já tenho conta'), on: { click: () => this.go('login') } })),
    );
    return { el: h('div', { class: 'ui-world__stack' }, screenHead(tr('Criar conta'), () => this.go('welcome')), form.el) };
  }

  private buildLogin(): View {
    const email = emailField();
    email.input.value = this.ui.email;
    const password = passwordField(tr('Senha'), 'current-password');
    const form = new Form(tr('Entrar'), () => void submit(), tr('Entrando…'));
    const submit = async () => {
      const mail = normalizeEmail(email.input.value);
      if (!emailLooksValid(mail)) return form.setError(tr('Digite um e-mail válido.'), email.input);
      if (!password.input.value) return form.setError(tr('Digite a senha.'), password.input);
      const r = await this.run(form, 'login', (c) => c.login({ email: mail, password: password.input.value.normalize('NFC') }), password.input);
      if (!r) return;
      if (r.ok) {
        this.dispatch({ type: 'signed_in' });
        return void this.refresh();
      }
      // O servidor reenviou o código: segue para a confirmação do e-mail.
      if (r.code === 'email_not_verified') this.dispatch({ type: 'code_sent', email: mail });
    };
    const forgot = h('button', {
      class: 'ui-link-btn',
      type: 'button',
      text: tr('Esqueci a senha'),
      on: {
        click: () => {
          this.ui = { ...this.ui, email: normalizeEmail(email.input.value) };
          this.go('forgot');
        },
      },
    });
    form.el.append(email.label, password.label, form.error, h('div', { class: 'ui-world__actions' }, form.submit, forgot));
    return {
      el: h(
        'div',
        { class: 'ui-world__stack' },
        screenHead(tr('Entrar na conta'), () => this.go('welcome')),
        form.el,
        para('ui-set__hint', tr('Ainda não tem conta?'), ' ', h('button', { class: 'ui-link-btn', type: 'button', text: tr('Criar conta'), on: { click: () => this.go('register') } })),
      ),
    };
  }

  /** "Demonstração: o código é 123456" (só com o FakeWorldApi). */
  private demoCodeHint(): HTMLElement | null {
    return this.src.fake ? para('ui-world__demo', tr('Demonstração: o código é {0}.', [FAKE_CODE])) : null;
  }

  /** Botão "Reenviar código", que espera um pouco depois de usado. */
  private resendButton(form: Form, send: (c: WorldClient) => Promise<WorldResult>): { el: HTMLButtonElement; sync(): void } {
    const btn = h('button', { class: 'ui-btn', type: 'button', text: tr('Reenviar código') });
    const sync = () => {
      btn.disabled = Date.now() < this.resendUntil;
    };
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const epoch = this.epoch;
      form.setError(null);
      const client = this.client;
      if (!client) return;
      const r = await send(client);
      if (epoch !== this.epoch) return;
      if (r.ok) {
        this.resendUntil = Date.now() + RESEND_COOLDOWN_MS;
        setTimeout(() => this.ctx.invalidate(), RESEND_COOLDOWN_MS + 50);
        this.dispatch({ type: 'flash', flash: 'code_resent' });
      } else form.setError(worldErrorText(r.code, 'resend'));
      sync();
    });
    sync();
    return { el: btn, sync };
  }

  private buildVerify(): View {
    const email = this.ui.email;
    const code = codeField();
    const form = new Form(tr('Confirmar e-mail'), () => void submit(), tr('Conferindo…'));
    const submit = async () => {
      if (!codeLooksValid(code.input.value)) return form.setError(tr('Digite os 6 dígitos do código.'), code.input);
      const r = await this.run(form, 'verify', (c) => c.verify({ email, code: normalizeCode(code.input.value) }), code.input);
      if (!r?.ok) return;
      this.dispatch({ type: 'signed_in' });
      void this.refresh();
    };
    const resend = this.resendButton(form, (c) => c.resend({ email }));
    form.el.append(code.label, form.error, h('div', { class: 'ui-world__actions' }, form.submit, resend.el));
    return {
      el: h(
        'div',
        { class: 'ui-world__stack' },
        screenHead(tr('Confirmar o e-mail'), () => this.go('welcome')),
        para('ui-world__lead', ...rich(tr('Mandamos um código de 6 dígitos para {0}. Ele vale por 10 minutos.'), [h('strong', { class: 'ui-world__email', text: email })])),
        para('ui-set__hint', tr('Não chegou? Confira o spam ou peça outro. Se este e-mail já tinha conta, a mensagem avisa: aí é só entrar com a senha.')),
        this.demoCodeHint(),
        form.el,
        h('button', { class: 'ui-link-btn', type: 'button', text: tr('Usar outro e-mail'), on: { click: () => this.go('register') } }),
      ),
      sync: resend.sync,
    };
  }

  private buildForgot(): View {
    const email = emailField();
    email.input.value = this.ui.email;
    const form = new Form(tr('Mandar código'), () => void submit(), tr('Mandando…'));
    const submit = async () => {
      const mail = normalizeEmail(email.input.value);
      if (!emailLooksValid(mail)) return form.setError(tr('Digite um e-mail válido.'), email.input);
      const r = await this.run(form, 'forgot', (c) => c.forgotPassword({ email: mail }), email.input);
      if (r?.ok) this.dispatch({ type: 'reset_code_sent', email: mail });
    };
    form.el.append(email.label, form.error, h('div', { class: 'ui-world__actions' }, form.submit));
    return {
      el: h(
        'div',
        { class: 'ui-world__stack' },
        screenHead(tr('Esqueci a senha'), () => this.go('login')),
        para('ui-set__hint', tr('Digite o e-mail da conta. Se ele estiver cadastrado, chega um código para criar uma senha nova.')),
        form.el,
      ),
    };
  }

  private buildReset(): View {
    const email = this.ui.email;
    const code = codeField();
    const password = passwordField(tr('Senha nova'), 'new-password', tr('Pelo menos 12 caracteres. Uma frase longa vale mais do que símbolos; senhas que já vazaram são recusadas.'));
    const form = new Form(tr('Trocar a senha'), () => void submit(), tr('Trocando…'));
    const submit = async () => {
      if (!codeLooksValid(code.input.value)) return form.setError(tr('Digite os 6 dígitos do código.'), code.input);
      const problem = passwordProblem(password.input.value, email);
      if (problem) return form.setError(passwordProblemText(problem), password.input);
      const r = await this.run(form, 'reset', (c) => c.resetPassword({ email, code: normalizeCode(code.input.value), password: password.input.value.normalize('NFC') }), code.input);
      if (!r?.ok) return;
      this.dispatch({ type: 'password_changed' });
      void this.refresh();
    };
    const resend = this.resendButton(form, (c) => c.forgotPassword({ email }));
    form.el.append(code.label, password.label, para('ui-set__hint', tr('Trocar a senha desconecta todos os dispositivos da conta.')), form.error, h('div', { class: 'ui-world__actions' }, form.submit, resend.el));
    return {
      el: h(
        'div',
        { class: 'ui-world__stack' },
        screenHead(tr('Senha nova'), () => this.go('login')),
        para('ui-world__lead', ...rich(tr('Se {0} tiver conta, chegou um código de 6 dígitos. Digite o código e a senha nova.'), [h('strong', { class: 'ui-world__email', text: email })])),
        this.demoCodeHint(),
        form.el,
      ),
      sync: resend.sync,
    };
  }

  // ---------------------------------------------------------------- com conta

  private buildHome(): View {
    const wrap = h('div', { class: 'ui-world__stack' });
    const card = new BuildingCard({
      client: this.client,
      building: () => this.status?.building ?? buildingFromMeta(this.src.meta()?.building),
      hasPlayer: () => !!this.status?.player,
      refresh: () => void this.refresh(),
      openSent: (opener) => void this.sent.open(opener),
      now: () => this.ctx.now(),
      visitOwn: () => {
        const go = this.ctx.visitOwnBuilding;
        return go && this.src.meta()?.scene?.available === true ? () => go() : null;
      },
      accountId: () => this.status?.account?.id,
      maintenance: () => this.status?.lastError === 'maintenance',
    });
    // "Avisar quando alguém visitar" (o aviso do primeiro visitante de cada conexão; ui/world/world-chip.ts)
    const notify = switchRow(tr('Avisar quando alguém visitar'), tr('Um aviso quando o primeiro visitante entra no seu prédio. Você vê só quantos estão lá dentro, nunca quem.'), () =>
      this.ctx.updatePrefs({ worldVisitNotify: !this.ctx.prefs.worldVisitNotify }),
    );
    let rev = -1;
    const sync = () => {
      if (rev !== this.statusRev) {
        rev = this.statusRev;
        wrap.replaceChildren(...this.homeContent(card, notify.row));
      }
      card.sync();
      setAttr(notify.btn, 'aria-checked', String(this.ctx.prefs.worldVisitNotify));
    };
    sync();
    return { el: wrap, sync };
  }

  private homeContent(card: BuildingCard, notifyRow: HTMLElement): Node[] {
    const s = this.status;
    const approved = this.ui.server === 'approved';
    const out: Node[] = [];
    out.push(
      para(
        'ui-world__notice',
        approved ? tr('Acesso liberado!') : tr('Você está na lista de espera. Estamos liberando o acesso aos poucos e avisamos por e-mail quando chegar a sua vez.'),
      ),
    );
    // O mundo em manutenção (503 `maintenance`): o prédio tenta de novo sozinho, com espera. Com o cartão "Seu prédio",
    // é ele que diz (no lugar do "Reconectando"); sem ele (lista de espera), um aviso próprio.
    const maintenance = s?.lastError === 'maintenance';
    if (maintenance && !approved) out.push(para('ui-world__maint', worldErrorText('maintenance', 'status')));
    // Aprovado: o cartão "Seu prédio" (conexão, contagens, pausar, o que foi enviado). Na espera, o lote vazio.
    if (approved) out.push(card.el);
    else
      out.push(
        h(
          'div',
          { class: 'ui-world__lot' },
          h('span', { class: 'ui-world__lot-art', attrs: { 'aria-hidden': 'true' } }),
          h('span', { class: 'ui-world__lot-text', text: tr('Seu prédio vai aparecer aqui') }),
        ),
      );

    const player = s?.player;
    if (player?.mustRename) {
      out.push(para('ui-world__warn', tr('Escolha um nome novo: a moderação trocou o seu nome de jogador. O nome novo entra na hora, sem esperar os 30 dias.')));
    }
    if (player) {
      const traits = h('span', { class: 'ui-world__traits' }, ...player.traits.filter((t) => TRAITS[t]).map((t) => h('span', { class: 'ui-world__trait', text: `${TRAITS[t].emoji} ${TRAITS[t].label}` })));
      const country = player.country ? countryName(player.country) : player.visibility.hideCountry ? tr('país escondido') : '';
      out.push(
        h(
          'div',
          { class: 'ui-world__player' },
          createAvatar({ seed: 0, look: player.look, kind: 'main', parts: player.parts }, 'lg'),
          h(
            'div',
            { class: 'ui-world__player-text' },
            h('strong', { class: 'ui-world__player-name', text: player.name }),
            h('span', { class: 'ui-world__player-intro', text: `“${introLabel(player.intro)}”` }),
            traits,
            country ? h('span', { class: 'ui-set__hint', text: country }) : null,
          ),
        ),
        h(
          'div',
          { class: 'ui-world__actions' },
          player.mustRename
            ? h('button', { class: 'ui-btn ui-btn--primary', type: 'button', text: tr('Escolher nome novo'), on: { click: () => this.go('character') } })
            : h('button', { class: 'ui-btn', type: 'button', text: tr('Editar personagem'), on: { click: () => this.go('character') } }),
        ),
      );
    } else {
      // O nome de jogador escolhido no cadastro, reservado enquanto o personagem não existe.
      const reserved = s?.account?.reservedName;
      if (reserved) out.push(para('ui-world__reserved', ...rich(tr('Seu nome de jogador: {0} (reservado)'), [h('strong', { class: 'ui-world__player-name', text: reserved })])));
      out.push(
        para('ui-set__hint', approved ? tr('Crie o seu personagem para entrar no mundo.') : tr('Enquanto espera, já dá para criar o seu personagem.')),
        h('div', { class: 'ui-world__actions' }, h('button', { class: 'ui-btn ui-btn--primary', type: 'button', text: tr('Criar meu personagem'), attrs: { 'data-world': 'create-character' }, on: { click: () => this.go('character') } })),
      );
    }

    const nav = h('div', { class: 'ui-world__nav' });
    if (player) {
      const v = player.visibility;
      const summary = [v.mode === 'discreet' ? tr('Discreto') : tr('Ao vivo'), v.closed ? tr('fechado a visitas') : null].filter(Boolean).join(' · ');
      nav.append(this.navRow(tr('Visibilidade do prédio'), summary, () => this.go('visibility')));
    }
    const devices = s?.devices?.length;
    nav.append(this.navRow(tr('Dispositivos'), devices ? tr('{0} de 3', [devices]) : '', () => this.go('devices')));
    if (player && approved) nav.append(this.navRow(tr('Bloqueados'), s?.blocked?.length ? String(s.blocked.length) : '', () => this.go('blocked')));
    nav.append(this.navRow(tr('Conta e dados'), '', () => this.go('account')));
    out.push(nav);
    if (approved && player) out.push(notifyRow);

    if (s?.lastError && !maintenance) out.push(para('ui-world__warn', tr('Último problema com o mundo: {0}', [worldErrorText(s.lastError, 'status')])));

    out.push(this.signOutRow());
    if (s?.account) out.push(para('ui-set__hint ui-world__email', tr('Conta: {0}', [s.account.emailMasked])));
    out.push(h('p', { class: 'ui-world__links' }, extLink(tr('Termos de Uso'), WORLD_TERMS_URL), extLink(tr('Política de Privacidade'), WORLD_PRIVACY_URL)));
    return out;
  }

  private navRow(label: string, value: string, onClick: () => void): HTMLButtonElement {
    return h(
      'button',
      { class: 'ui-world__navrow', type: 'button', on: { click: onClick } },
      h('span', { class: 'ui-set__label', text: label }),
      h('span', { class: 'ui-world__navval', text: value }),
      h('span', { class: 'ui-world__chev', text: '›', attrs: { 'aria-hidden': 'true' } }),
    );
  }

  /** "Sair da conta" em dois cliques (o segundo confirma). */
  private signOutRow(): HTMLElement {
    let confirming = false;
    const btn = h('button', { class: 'ui-btn', type: 'button', text: tr('Sair da conta') });
    const hint = h('span', { class: 'ui-set__hint', text: tr('Este computador deixa de entrar no mundo; a conta e o personagem continuam.') });
    const error = h('p', { class: 'ui-world__error', role: 'alert', hidden: true });
    btn.addEventListener('click', async () => {
      if (!confirming) {
        confirming = true;
        setText(btn, tr('Confirmar: sair da conta'));
        btn.classList.add('is-danger');
        return;
      }
      const client = this.client;
      if (!client) return;
      btn.disabled = true;
      setAttr(btn, 'aria-busy', 'true');
      const epoch = this.epoch;
      const r = await client.logout();
      if (epoch !== this.epoch) return;
      btn.disabled = false;
      setAttr(btn, 'aria-busy', null);
      if (!r.ok) {
        setText(error, worldErrorText(r.code, 'logout'));
        setHidden(error, false);
        return;
      }
      this.dispatch({ type: 'flash', flash: 'signed_out' });
      void this.refresh();
    });
    return h('div', { class: 'ui-world__signout' }, h('div', { class: 'ui-set' }, h('div', { class: 'ui-set__text' }, hint), btn), error);
  }

  private buildCharacter(): View {
    const player = this.status?.player;
    let look: 'f' | 'm' = player?.look ?? (randomSeed() % 2 ? 'm' : 'f');
    let traits: TraitId[] = player ? player.traits.filter((t): t is TraitId => (TRAIT_IDS as readonly string[]).includes(t)) : [];
    const fields = new AppearanceFields();
    fields.set(player ? draftAppearance(look, player.parts) : draftAppearance(look, undefined, randomSeed()));

    const name = h('input', { class: 'ui-char__name', type: 'text', attrs: { maxlength: PLAYER_NAME_LIMITS.max * 2, autocomplete: 'nickname', spellcheck: 'false', 'aria-describedby': 'ui-world-name-hint' } });
    // Nome trocado à força pela moderação ("???"): o campo começa vazio e recebe o foco.
    const rename = player?.mustRename === true;
    // Criando com o nome reservado no cadastro: o campo mostra a reserva e não se edita (o pedido vai sem `name`; o
    // servidor do mundo usa a reserva). Conta antiga, sem reserva, escolhe o nome aqui, como antes.
    const reserved = !player ? this.status?.account?.reservedName : undefined;
    name.value = rename ? '' : (player?.name ?? reserved ?? '');
    if (reserved) {
      name.readOnly = true;
      name.classList.add('is-fixed');
    }
    if (rename) requestAnimationFrame(() => name.isConnected && name.focus());
    const roll = h('button', {
      class: 'ui-btn ui-btn--sm',
      type: 'button',
      text: tr('Sortear'),
      title: tr('Sortear outra aparência (desfaz as peças escolhidas)'),
      on: { click: () => fields.set(draftAppearance(look, undefined, randomSeed())) },
    });

    const lookSeg = segmented<'f' | 'm'>(
      tr('Dica visual'),
      [
        ['f', tr('Feminina')],
        ['m', tr('Masculina')],
      ],
      (v) => {
        look = v;
        lookSeg.set(v);
        const a = fields.value;
        if (a) fields.set({ ...a, look: v } satisfies Appearance);
      },
    );
    lookSeg.set(look);
    lookSeg.row.append(h('span', { class: 'ui-set__hint', text: tr('Muda detalhes do rosto e o sorteio de cabelo e roupa; tudo dá para trocar nas peças abaixo.') }));

    // Traços: 2 ou 3; os que não combinam com os escolhidos (e todos, com 3 escolhidos) ficam desabilitados.
    const count = h('span', { class: 'ui-world__count' });
    const chips = new Map<TraitId, HTMLButtonElement>();
    const syncTraits = () => {
      setText(count, tr('{0} de 3', [traits.length]));
      for (const [t, b] of chips) {
        const on = traits.includes(t);
        const block = traitBlock(traits, t);
        setAttr(b, 'aria-pressed', String(on));
        setAttr(b, 'aria-disabled', block ? 'true' : null);
        b.title = block ? (block.reason === 'full' ? tr('Já são 3 traços: desmarque um para trocar.') : tr('Não combina com {0}.', [TRAITS[block.with].label])) : TRAITS[t].desc;
      }
    };
    for (const t of TRAIT_IDS) {
      const info = TRAITS[t];
      const b = h('button', { class: 'ui-world__trait-opt', type: 'button', text: `${info.emoji} ${info.label}` });
      b.addEventListener('click', () => {
        if (b.getAttribute('aria-disabled') === 'true') return;
        traits = toggleTrait(traits, t);
        syncTraits();
      });
      chips.set(t, b);
    }
    syncTraits();

    const intro = h('select', { class: 'ui-world__select', attrs: { 'aria-label': tr('Frase de apresentação') } });
    intro.append(h('option', { text: tr('Escolha uma frase…'), attrs: { value: '' } }));
    for (const id of INTRO_IDS) intro.append(h('option', { text: introLabel(id), attrs: { value: id } }));
    intro.value = player?.intro ?? '';

    const form = new Form(tr('Salvar personagem'), () => void submit(), tr('Salvando…'));
    const traitsBox = h('div', { class: 'ui-world__traitopts', role: 'group', attrs: { 'aria-label': tr('Personalidade') } }, ...chips.values());
    const submit = async () => {
      const a = fields.value;
      if (!a) return;
      const chosen = isIntroId(intro.value) ? (intro.value as IntroId) : null;
      const problem = characterProblem({ name: reserved ?? name.value, traits, intro: chosen });
      if (problem?.field === 'name') return form.setError(nameProblemText(problem.problem), name);
      if (problem?.field === 'traits') return form.setError(tr('Escolha 2 ou 3 traços de personalidade.'), chips.get(TRAIT_IDS[0]));
      if (problem || !chosen) return form.setError(tr('Escolha uma frase de apresentação.'), intro);
      const parsed = parsePlayerName(name.value);
      const body = { ...(reserved ? {} : { name: parsed.ok ? parsed.name : name.value }), look, parts: fullParts(a), traits: [...traits], intro: chosen };
      const r = await this.run(form, 'character', (c) => c.saveCharacter(body), name);
      if (!r?.ok) return;
      this.dispatch({ type: 'go', screen: 'home' });
      this.dispatch({ type: 'flash', flash: 'character_saved' });
      void this.refresh();
    };
    form.el.append(
      rename ? para('ui-world__warn', tr('Escolha um nome novo')) : '',
      h(
        'div',
        { class: 'ui-char__top' },
        fields.preview,
        h('div', { class: 'ui-char__head' }, h('label', { class: 'ui-char__label' }, h('span', { text: tr('Nome de jogador') }), name), roll),
      ),
      reserved
        ? para('ui-set__hint', h('span', { attrs: { id: 'ui-world-name-hint' } }, tr('Escolhido no cadastro. Dá para trocar depois, uma vez a cada 30 dias.')))
        : para(
            'ui-set__hint',
            h('span', { attrs: { id: 'ui-world-name-hint' } }, tr('De 3 a 20 caracteres: letras de um só alfabeto, números, espaço, _ - e . É o seu nome no mundo e não pode repetir o de ninguém.')),
            rename ? ` ${tr('Desta vez o nome novo entra na hora, sem esperar os 30 dias.')}` : player ? ` ${tr('Dá para trocar uma vez a cada 30 dias.')}` : '',
          ),
      lookSeg.row,
      fields.groups,
      h(
        'fieldset',
        { class: 'ui-char__group ui-world__traitset' },
        h('legend', {}, tr('Personalidade'), ' ', count),
        para('ui-set__hint', tr('Escolha 2 ou 3 traços. Os que não combinam com os já escolhidos ficam apagados.')),
        traitsBox,
      ),
      h('label', { class: 'ui-world__field' }, h('span', { class: 'ui-world__label', text: tr('Frase de apresentação') }), intro, h('span', { class: 'ui-set__hint', text: tr('Aparece no seu perfil, traduzida para quem lê. No mundo não há texto livre além do nome.') })),
      form.error,
      h('div', { class: 'ui-world__actions' }, form.submit, h('button', { class: 'ui-btn', type: 'button', text: tr('Cancelar'), on: { click: () => this.go('home') } })),
    );
    return { el: h('div', { class: 'ui-world__stack ui-world__character' }, screenHead(player ? tr('Editar personagem') : tr('Criar personagem'), () => this.go('home')), form.el) };
  }

  private buildVisibility(): View {
    const player = this.status?.player;
    if (!player) return { el: h('div', { class: 'ui-world__stack' }, screenHead(tr('Visibilidade do prédio'), () => this.go('home')), para('ui-set__hint', tr('Disponível depois de criar o personagem.'))) };
    let vis: WorldVisibility = { ...DEFAULT_VISIBILITY, ...player.visibility };
    let saving = false;
    const error = h('p', { class: 'ui-world__error', role: 'alert', hidden: true });
    const switches = new Map<VisibilitySwitch, HTMLButtonElement>();
    const save = async (next: WorldVisibility) => {
      const client = this.client;
      if (saving || !client) return;
      const prev = vis;
      vis = next;
      saving = true;
      setHidden(error, true);
      sync();
      const epoch = this.epoch;
      const r = await client.saveVisibility(next);
      if (epoch !== this.epoch) return;
      saving = false;
      if (!r.ok) {
        vis = prev;
        setText(error, worldErrorText(r.code, 'visibility'));
        setHidden(error, false);
      } else void this.refresh();
      sync();
    };
    const mode = segmented<WorldVisibility['mode']>(
      tr('Modo do prédio'),
      [
        ['live', tr('Ao vivo')],
        ['discreet', tr('Discreto')],
      ],
      (v) => void save({ ...vis, mode: v }),
    );
    mode.row.append(h('span', { class: 'ui-set__hint', text: tr('Ao vivo: andares, contadores e o que cada personagem está fazendo, em tempo real. Discreto: só aceso ou apagado e o número de andares.') }));
    const rows = VISIBILITY_SWITCHES.map((key) => {
      const t = visibilityText(key);
      const r = switchRow(t.label, t.hint, () => void save({ ...vis, [key]: !vis[key] }));
      switches.set(key, r.btn);
      return r.row;
    });
    const country = h('p', { class: 'ui-set__hint' });
    const sync = () => {
      mode.set(vis.mode);
      for (const [key, btn] of switches) {
        setAttr(btn, 'aria-checked', String(vis[key]));
        btn.disabled = saving;
      }
      const code = this.status?.player?.country;
      setText(country, vis.hideCountry ? tr('País: escondido (aparece uma bandeira neutra).') : code ? tr('País visto na última conexão: {0}.', [countryName(code)]) : tr('País: aparece depois da primeira conexão com o mundo.'));
    };
    sync();
    return {
      el: h(
        'div',
        { class: 'ui-world__stack' },
        screenHead(tr('Visibilidade do prédio'), () => this.go('home')),
        mode.row,
        ...rows,
        country,
        error,
        para('ui-set__hint', tr('As mudanças valem na hora.')),
      ),
    };
  }

  /** Fase 5: quem a conta bloqueou, com Desbloquear (blocked.ts). A lista é relida do /v1/me ao abrir. */
  private buildBlocked(): View {
    const epoch = this.epoch;
    return buildBlocked(screenHead(tr('Bloqueados'), () => this.go('home')), {
      client: this.client,
      list: () => this.status?.blocked,
      refresh: () => this.refresh(true),
      current: () => epoch === this.epoch,
      announce: (t) => this.ctx.announce(t),
    });
  }

  private buildDevices(): View {
    const list = h('ul', { class: 'ui-world__devices' });
    const note = h('p', { class: 'ui-set__hint', text: tr('Carregando…') });
    const error = h('p', { class: 'ui-world__error', role: 'alert', hidden: true });
    let devices: WorldDevice[] | null = this.status?.devices ?? null;
    const draw = () => {
      setHidden(note, !!devices);
      if (!devices) return;
      list.replaceChildren(...devices.map((d) => this.deviceRow(d, error, (id) => {
        devices = (devices ?? []).filter((x) => x.id !== id);
        draw();
      })));
    };
    const load = async () => {
      const client = this.client;
      if (!client) return;
      const epoch = this.epoch;
      const r = await client.devices();
      if (epoch !== this.epoch) return;
      if (r.ok) {
        devices = r.data;
        setHidden(error, true);
      } else if (!devices) {
        setText(error, worldErrorText(r.code, 'devices'));
        setHidden(error, false);
        setHidden(note, true);
      }
      draw();
    };
    draw();
    void load();
    return {
      el: h(
        'div',
        { class: 'ui-world__stack' },
        screenHead(tr('Dispositivos'), () => this.go('home')),
        para('ui-set__hint', tr('Até 3 por conta. Revogar desconecta o dispositivo na hora; para voltar, ele entra de novo com a senha.')),
        note,
        list,
        error,
      ),
    };
  }

  private deviceRow(d: WorldDevice, error: HTMLElement, onRevoked: (id: string) => void): HTMLElement {
    const now = Date.now();
    const created = toMillis(d.createdAt);
    const seen = toMillis(d.lastSeenAt);
    const meta = [created ? tr('entrou em {0}', [formatDateTime(created)]) : null, !d.current && seen ? tr('último acesso {0}', [relativeTime(seen, now)]) : null].filter(Boolean).join(' · ');
    const head = h('span', { class: 'ui-world__device-name' }, deviceLabel(d.label), d.current ? h('span', { class: 'ui-world__tag', text: tr('este computador') }) : null);
    const text = h('div', { class: 'ui-set__text' }, head, meta ? h('span', { class: 'ui-set__hint', text: meta }) : null);
    if (d.current) return h('li', { class: 'ui-set ui-world__device' }, text);
    let confirming = false;
    const btn = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Revogar'), attrs: { 'aria-label': tr('Revogar {0}', [deviceLabel(d.label)]) } });
    btn.addEventListener('click', async () => {
      if (!confirming) {
        confirming = true;
        setText(btn, tr('Confirmar'));
        btn.classList.add('is-danger');
        return;
      }
      const client = this.client;
      if (!client) return;
      btn.disabled = true;
      setAttr(btn, 'aria-busy', 'true');
      const epoch = this.epoch;
      const r = await client.revokeDevice(d.id);
      if (epoch !== this.epoch) return;
      btn.disabled = false;
      setAttr(btn, 'aria-busy', null);
      if (!r.ok) {
        setText(error, worldErrorText(r.code, 'revoke'));
        setHidden(error, false);
        return;
      }
      onRevoked(d.id);
      this.dispatch({ type: 'flash', flash: 'device_revoked' });
      void this.refresh();
    });
    return h('li', { class: 'ui-set ui-world__device' }, text, btn);
  }

  // ---------------------------------------------------------------- conta e dados (Fase 6)

  /**
   * "Conta e dados": o aviso de inatividade (com o personagem: vai na visibilidade), "Baixar meus dados" (o JSON da
   * conta, uma vez por dia) e "Excluir conta" em três etapas. A tela é montada uma vez: o status relido no meio não apaga
   * o código digitado; `sync` só acompanha o interruptor.
   */
  private buildAccount(): View {
    const inactivity = this.inactivitySection();
    const exportBox = this.exportSection();
    const deletion = this.deletionSection();
    return {
      el: h(
        'div',
        { class: 'ui-world__stack' },
        screenHead(tr('Conta e dados'), () => this.go('home')),
        inactivity.el,
        exportBox,
        deletion,
        para('ui-set__hint', tr('Dúvidas ou pedidos sobre os seus dados: {0}.', [APPEAL_EMAIL])),
      ),
      sync: inactivity.sync,
    };
  }

  /** O interruptor do aviso por e-mail antes de retirar o prédio por inatividade. */
  private inactivitySection(): { el: HTMLElement; sync(): void } {
    let pending: boolean | null = null;
    const error = h('p', { class: 'ui-world__error', role: 'alert', hidden: true });
    const sw = switchRow(
      tr('Avisar por e-mail antes de retirar meu prédio por inatividade'),
      tr('Sem notícias deste Habblaud por 7 dias, o prédio some do mapa e, 30 dias depois, é retirado. O e-mail chega 3 dias antes da retirada.'),
      () => void toggle(),
    );
    const noPlayer = para('ui-set__hint', tr('O aviso de inatividade fica disponível depois de criar o personagem.'));
    const sync = () => {
      const player = this.status?.player;
      setHidden(sw.row, !player);
      setHidden(noPlayer, !!player);
      setAttr(sw.btn, 'aria-checked', String(pending ?? notifyInactivityOn(player?.visibility)));
      sw.btn.disabled = pending !== null;
    };
    const toggle = async () => {
      const client = this.client;
      const player = this.status?.player;
      if (!client || !player || pending !== null) return;
      const next = !notifyInactivityOn(player.visibility);
      pending = next;
      setHidden(error, true);
      sync();
      const epoch = this.epoch;
      const r = await client.saveVisibility({ ...DEFAULT_VISIBILITY, ...player.visibility, notifyInactivity: next });
      if (epoch !== this.epoch) return;
      pending = null;
      if (!r.ok) {
        setText(error, worldErrorText(r.code, 'inactivity'));
        setHidden(error, false);
      } else {
        // Até o status chegar, o interruptor fica no que foi salvo.
        const p = this.status?.player;
        if (p) p.visibility = { ...p.visibility, notifyInactivity: next };
        void this.refresh();
      }
      sync();
    };
    sync();
    return { el: h('section', { class: 'ui-world__acct' }, h('h4', { class: 'ui-world__acct-title', text: tr('Avisos') }), sw.row, noPlayer, error), sync };
  }

  /** "Baixar meus dados": pede o JSON ao servidor local e salva como habblaud-world-dados.json. */
  private exportSection(): HTMLElement {
    const btn = h('button', { class: 'ui-btn', type: 'button', text: tr('Baixar meus dados') });
    const note = h('p', { class: 'ui-set__hint', role: 'status', hidden: true });
    const error = h('p', { class: 'ui-world__error', role: 'alert', hidden: true });
    btn.addEventListener('click', async () => {
      const client = this.client;
      if (!client || btn.disabled) return;
      btn.disabled = true;
      setAttr(btn, 'aria-busy', 'true');
      setHidden(error, true);
      setHidden(note, true);
      const epoch = this.epoch;
      const r = await client.exportData();
      if (epoch !== this.epoch) return;
      btn.disabled = false;
      setAttr(btn, 'aria-busy', null);
      if (!r.ok) {
        setText(error, worldErrorText(r.code, 'export'));
        setHidden(error, false);
        return;
      }
      saveFile(this.el, r.data, EXPORT_FILENAME);
      setText(note, tr('Pronto: o arquivo {0} foi para a pasta de downloads.', [EXPORT_FILENAME]));
      setHidden(note, false);
    });
    return h(
      'section',
      { class: 'ui-world__acct' },
      h('h4', { class: 'ui-world__acct-title', text: tr('Seus dados') }),
      para(
        'ui-set__hint',
        tr('Um arquivo JSON com o que o Habblaud World guarda da sua conta: e-mail, datas, personagem, visibilidade, dispositivos, prédio, likes dados, bloqueios e denúncias feitas. Dá para baixar uma vez por dia.'),
      ),
      h('div', { class: 'ui-world__actions' }, btn),
      note,
      error,
    );
  }

  /** "Excluir conta" em três etapas: o que some e quando; a confirmação (manda o código); o código do e-mail. */
  private deletionSection(): HTMLElement {
    const box = h('div', { class: 'ui-world__stack' });
    const email = () => this.status?.account?.emailMasked ?? '';
    const explain = () => {
      const next = h('button', { class: 'ui-btn', type: 'button', text: tr('Excluir conta…'), on: { click: () => show(confirm()) } });
      return [
        para('ui-set__hint', tr('Excluir a conta tira você do Habblaud World:')),
        h(
          'ul',
          { class: 'ui-world__list' },
          h('li', {}, h('strong', { text: tr('Na hora:') }), ' ', tr('o prédio e o perfil somem do mundo, e este computador sai da conta.')),
          h('li', {}, h('strong', { text: tr('Em 7 dias:') }), ' ', tr('a conta, o personagem, os likes dados e recebidos, os bloqueios, as denúncias feitas e os dispositivos são apagados do banco.')),
          h('li', {}, h('strong', { text: tr('Em até 30 dias:') }), ' ', tr('somem também dos backups.')),
        ),
        para('ui-set__hint', tr('Se quiser guardar uma cópia, baixe os seus dados antes.')),
        h('div', { class: 'ui-world__actions' }, next),
      ];
    };
    const confirm = () => {
      const form = new Form(tr('Mandar o código'), () => void send(), tr('Mandando…'));
      form.submit.classList.add('is-danger');
      const send = async () => {
        const r = await this.run(form, 'delete', (c) => c.requestAccountDeletion());
        if (r?.ok) show(code());
      };
      form.el.append(
        para('ui-world__warn', tr('Tem certeza? O prédio e o perfil saem do mundo assim que você digitar o código.')),
        para('ui-set__hint', ...rich(tr('Para confirmar, mandamos um código de 6 dígitos para o e-mail da conta ({0}).'), [h('strong', { class: 'ui-world__email', text: email() })])),
        form.error,
        h('div', { class: 'ui-world__actions' }, form.submit, h('button', { class: 'ui-btn', type: 'button', text: tr('Cancelar'), on: { click: () => show(explain()) } })),
      );
      return [form.el];
    };
    const code = () => {
      const field = codeField();
      const form = new Form(tr('Excluir a conta'), () => void submit(), tr('Excluindo…'));
      form.submit.classList.add('is-danger');
      const submit = async () => {
        if (!codeLooksValid(field.input.value)) return form.setError(tr('Digite os 6 dígitos do código.'), field.input);
        const r = await this.run(form, 'delete', (c) => c.confirmAccountDeletion({ code: normalizeCode(field.input.value) }), field.input);
        if (!r?.ok) return;
        this.ctx.announce(worldErrorText('account_deleted', 'status'));
        void this.refresh();
      };
      const resend = this.resendButton(form, (c) => c.requestAccountDeletion());
      form.el.append(
        para('ui-world__lead', ...rich(tr('Mandamos um código de 6 dígitos para {0}. Digite o código para excluir a conta.'), [h('strong', { class: 'ui-world__email', text: email() })])),
        this.demoCodeHint() ?? '',
        field.label,
        form.error,
        h('div', { class: 'ui-world__actions' }, form.submit, resend.el, h('button', { class: 'ui-btn', type: 'button', text: tr('Cancelar'), on: { click: () => show(explain()) } })),
      );
      requestAnimationFrame(() => field.input.isConnected && field.input.focus());
      return [form.el];
    };
    const show = (nodes: (Node | string)[]) => box.replaceChildren(...nodes);
    show(explain());
    return h('section', { class: 'ui-world__acct ui-world__acct--danger' }, h('h4', { class: 'ui-world__acct-title', text: tr('Excluir conta') }), box);
  }
}

/** Salva um texto como arquivo (o link temporário fica dentro da seção, para nada fora dela receber o clique). */
function saveFile(host: HTMLElement, text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = h('a', { hidden: true, attrs: { href: url, download: filename } });
  host.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
