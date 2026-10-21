// Timelapse do dia (botão "Timelapse" da barra superior ou tecla L): barra de reprodução com o dia,
// play/pausa, velocidade, linha do tempo arrastável (com o gráfico de agentes presentes/trabalhando e as
// marcas dos picos) e "Voltar ao vivo"; selo "REPLAY 14:32" e tom sépia no escritório.
// Durante o replay o store recebe os snapshots reconstruídos (net/timeline.ts) no lugar dos do SSE, que
// segue conectado por baixo, e o mundo roda no relógio da reprodução, com as animações aceleradas
// (world/playback.ts). Pular para outro ponto (arrastar, picos, trocar de dia) recomeça o mundo: todos já
// aparecem no lugar, sem andar até a mesa.
import { dayKey, dayStart, shiftDay } from '../../../shared/timeline';
import { BUCKET_MS, fetchTimelineDay, fetchTimelineDays, TimelineReplay, type TimelineDayInfo } from '../net/timeline';
import type { WorldPlayback } from '../world/api';
import { animScale } from '../world/playback';
import type { UiComponent, UiContext } from './context';
import { h, iconButton, setAttr, setHidden, setStyleVar, setText, setTitle } from './dom';
import { formatClock } from './format';
import { pixelIcon } from './icons';
import { intlLocale, tr } from '../../../shared/i18n';

export const SPEEDS = [60, 180, 600] as const;
export type Speed = (typeof SPEEDS)[number];
const DEFAULT_SPEED: Speed = 180;
/** Snapshot reconstruído para o store (e a interface) no máximo a cada 200 ms, como o hub do servidor. */
const PUSH_MS = 200;
/** Arrastando a linha do tempo, o mundo recomeça no máximo a cada 120 ms. */
const SEEK_MS = 120;
/** Passo do teclado na linha do tempo (setas): 1 min. */
const STEP_S = 60;

export const TIMELAPSE_ICONS = {
  // Relógio com a seta de voltar no tempo.
  timelapse: pixelIcon([
    '....#####..',
    '..##.....#.',
    '##.#......#',
    '.###..#...#',
    '..##..#...#',
    '......###.#',
    '#.........#',
    '.#.......#.',
    '..#######..',
  ]),
  play: pixelIcon(['##......', '####....', '######..', '########', '######..', '####....', '##......']),
  pause: pixelIcon(['###..###', '###..###', '###..###', '###..###', '###..###', '###..###', '###..###']),
  peak: pixelIcon(['#####', '.###.', '..#..']),
};

const dayFmt = new Intl.DateTimeFormat(intlLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
const hhmm = (at: number) => formatClock(at, false);

/** "Hoje", "Ontem" ou "ter., 6 de out.". */
export function dayLabel(day: string, today: string): string {
  if (day === today) return tr('Hoje');
  if (day === shiftDay(today, -1)) return tr('Ontem');
  return dayFmt.format(dayStart(day));
}

/** Horas cheias para as marcas da régua: no máximo ~6, de 1, 2, 3, 4 ou 6 em 6 horas. */
export function hourTicks(from: number, to: number): number[] {
  const span = (to - from) / 3_600_000;
  const step = [1, 2, 3, 4, 6].find((s) => span / s <= 6) ?? 12;
  const out: number[] = [];
  const d = new Date(from);
  d.setMinutes(0, 0, 0);
  for (let t = d.getTime(); t <= to; ) {
    if (t > from && new Date(t).getHours() % step === 0) out.push(t);
    d.setHours(d.getHours() + 1);
    t = d.getTime();
  }
  return out;
}

type Status = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export class TimelapsePlayer implements UiComponent {
  readonly el: HTMLElement;
  readonly badge: HTMLElement;
  readonly vignette: HTMLElement;

  private open = false;
  /** Último valor gravado em --lapse-h (-1 = ainda nenhum). */
  private lapseH = -1;
  private status: Status = 'idle';
  private message = '';
  private days: TimelineDayInfo[] = [];
  /** Carga de dia mais recente (trocas rápidas de dia: só a última vale). */
  private loadSeq = 0;
  private replay: TimelineReplay | null = null;
  /** Dias já carregados nesta abertura (o de hoje é buscado de novo a cada abertura: ainda está crescendo). */
  private cache = new Map<string, TimelineReplay>();
  /** Store e mundo no modo replay. */
  private active = false;
  private t = 0;
  private playing = false;
  private speed: Speed = DEFAULT_SPEED;
  private includeDemo = true;
  private raf = 0;
  private lastReal = 0;
  private lastPush = 0;
  private lastSeek = 0;
  private seekTimer: ReturnType<typeof setTimeout> | null = null;
  private abort: AbortController | null = null;
  private chartSig = '';
  private daysSig = '';
  private readonly playback: WorldPlayback = {
    clock: () => this.t,
    scale: () => (this.playing ? animScale(this.speed) : 0),
  };

  private playBtn: HTMLButtonElement;
  private timeEl: HTMLElement;
  private spanEl: HTMLElement;
  private daySel: HTMLSelectElement;
  private speedBtns = new Map<Speed, HTMLButtonElement>();
  private demoBtn: HTMLButtonElement;
  private msgEl: HTMLElement;
  private track: HTMLElement;
  private chart: HTMLCanvasElement;
  private range: HTMLInputElement;
  private peaksEl: HTMLElement;
  private ticksEl: HTMLElement;
  private badgeTime: HTMLElement;
  private badgeDay: HTMLElement;
  private badgeNote: HTMLElement;

  constructor(private ctx: UiContext) {
    this.playBtn = iconButton(TIMELAPSE_ICONS.play, tr('Reproduzir'), () => this.togglePlay(), 'ui-lapse__play');
    this.timeEl = h('strong', { class: 'ui-lapse__time', text: '--:--' });
    this.spanEl = h('span', { class: 'ui-lapse__span' });
    this.daySel = h('select', { class: 'ui-lapse__day', attrs: { 'aria-label': tr('Dia gravado') }, on: { change: () => void this.loadDay(this.daySel.value) } });
    const speedGroup = h('div', { class: 'ui-seg ui-lapse__speed', role: 'radiogroup', attrs: { 'aria-label': tr('Velocidade') } });
    for (const s of SPEEDS) {
      const b = h('button', { class: 'ui-seg__opt', type: 'button', role: 'radio', text: `${s}×`, title: speedHint(s), attrs: { 'aria-checked': 'false' } });
      b.addEventListener('click', () => {
        this.speed = s;
        this.ctx.invalidate();
      });
      b.addEventListener('keydown', (e) => {
        // Setas navegam entre as opções (padrão de radiogroup) e não seguem para a câmera.
        const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!dir) return;
        e.preventDefault();
        e.stopPropagation();
        const next = SPEEDS[(SPEEDS.indexOf(s) + dir + SPEEDS.length) % SPEEDS.length];
        this.speed = next;
        this.syncSpeed(next);
        this.ctx.invalidate();
      });
      this.speedBtns.set(s, b);
      speedGroup.append(b);
    }
    this.demoBtn = h(
      'button',
      { class: 'ui-btn ui-btn--sm ui-lapse__demo', type: 'button', text: tr('Demonstração'), title: tr('Mostrar também os agentes do modo demonstração gravados neste dia'), hidden: true },
    );
    this.demoBtn.addEventListener('click', () => {
      this.includeDemo = !this.includeDemo;
      if (this.active) this.seek(this.t);
      this.ctx.invalidate();
    });
    const liveBtn = h('button', { class: 'ui-btn ui-btn--sm ui-lapse__live', type: 'button', title: tr('Sair do timelapse e voltar ao escritório ao vivo (L)') }, h('span', { class: 'ui-lapse__live-dot', attrs: { 'aria-hidden': 'true' } }), tr('Voltar ao vivo'));
    liveBtn.addEventListener('click', () => this.close());

    this.chart = h('canvas', { class: 'ui-lapse__chart', attrs: { 'aria-hidden': 'true' } });
    this.range = h('input', { class: 'ui-lapse__range', type: 'range', attrs: { min: 0, max: 0, step: STEP_S, value: 0, 'aria-label': tr('Momento da reprodução') } });
    this.range.addEventListener('input', () => this.scrub(this.rangeTime(), false));
    this.range.addEventListener('change', () => this.scrub(this.rangeTime(), true));
    this.range.addEventListener('keydown', (e) => {
      if (e.key === ' ') {
        e.preventDefault();
        this.togglePlay();
      }
    });
    this.peaksEl = h('div', { class: 'ui-lapse__peaks' });
    this.ticksEl = h('div', { class: 'ui-lapse__ticks', attrs: { 'aria-hidden': 'true' } });
    this.track = h('div', { class: 'ui-lapse__track' }, this.chart, this.peaksEl, this.range);
    this.msgEl = h('p', { class: 'ui-lapse__msg', role: 'status', hidden: true });

    this.el = h(
      'section',
      { class: 'ui-panel ui-lapse', hidden: true, attrs: { 'aria-label': tr('Timelapse do dia') } },
      h(
        'div',
        { class: 'ui-lapse__row' },
        this.playBtn,
        h('div', { class: 'ui-lapse__clock' }, this.timeEl, this.spanEl),
        this.daySel,
        h('span', { class: 'ui-lapse__grow' }),
        speedGroup,
        this.demoBtn,
        liveBtn,
      ),
      this.msgEl,
      h('div', { class: 'ui-lapse__timeline' }, this.track, this.ticksEl),
    );
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        this.close();
      }
    });

    this.badgeTime = h('strong', { class: 'ui-lapse-badge__time' });
    this.badgeDay = h('span', { class: 'ui-lapse-badge__day' });
    this.badgeNote = h('span', { class: 'ui-lapse-badge__note' });
    this.badge = h(
      'div',
      { class: 'ui-lapse-badge', hidden: true, role: 'status', attrs: { 'aria-live': 'off' } },
      h('span', { class: 'ui-lapse-badge__rec', attrs: { 'aria-hidden': 'true' } }),
      h('span', { class: 'ui-lapse-badge__label', text: 'REPLAY' }),
      this.badgeTime,
      this.badgeDay,
      this.badgeNote,
    );
    this.vignette = h('div', { class: 'ui-lapse-vignette', hidden: true, attrs: { 'aria-hidden': 'true' } });

    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => this.drawChart(true)).observe(this.track);
      new ResizeObserver(() => this.syncHeight()).observe(this.el);
    }
  }

  /**
   * Altura da barra para os avisos (.ui-toasts) ficarem acima dela durante o replay; 0 com a barra fechada. Chamada pelo
   * ResizeObserver (abrir e fechar também mudam o tamanho), não a cada render: no replay o render roda a todo quadro, e
   * medir forçaria o layout da página. A variável só é regravada quando muda.
   */
  private syncHeight(): void {
    const h = this.open ? Math.round(this.el.getBoundingClientRect().height) : 0;
    if (h === this.lapseH) return;
    this.lapseH = h;
    this.ctx.root.style.setProperty('--lapse-h', `${h}px`);
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Instante reproduzido (o mesmo do selo e do mundo), ou null ao vivo. */
  get replayTime(): number | null {
    return this.active ? this.t : null;
  }

  toggle(): void {
    if (this.open) this.close();
    else void this.show();
  }

  /** Abre a barra, busca os dias gravados e começa a reproduzir o mais recente (hoje, se houver). */
  async show(): Promise<void> {
    if (this.open) return;
    this.open = true;
    this.cache.clear();
    this.status = 'loading';
    this.message = tr('Carregando os dias gravados…');
    this.ctx.invalidate();
    this.abort?.abort();
    const abort = (this.abort = new AbortController());
    try {
      const r = await fetchTimelineDays(abort.signal);
      if (!this.open || abort.signal.aborted) return;
      this.days = r.days;
      if (!r.days.length) {
        this.status = 'empty';
        this.message = r.recording
          ? tr('Nada gravado ainda: o Habblaud grava o escritório enquanto está ligado. Volte daqui a pouco.')
          : tr('A gravação está desligada neste servidor (HABBLAUD_TIMELINE=0) e não há dias gravados.');
        this.ctx.invalidate();
        return;
      }
      const today = dayKey(Date.now());
      await this.loadDay(r.days.find((d) => d.day === today)?.day ?? r.days[0].day, true);
    } catch (err) {
      if (abort.signal.aborted) return;
      this.status = 'error';
      this.message = tr('Não foi possível buscar a linha do tempo no servidor.');
      console.warn('[timelapse]', err);
      this.ctx.invalidate();
    }
  }

  /** Fecha a barra e volta ao vivo. */
  close(): void {
    if (!this.open) return;
    this.open = false;
    this.abort?.abort();
    this.abort = null;
    this.exit();
    this.status = 'idle';
    this.ctx.invalidate();
    this.ctx.announce(tr('De volta ao escritório ao vivo.'));
  }

  /** Marca a velocidade atual e deixa só ela na ordem do Tab; com `focus`, move o foco para ela. */
  private syncSpeed(focus?: Speed): void {
    for (const [s, b] of this.speedBtns) {
      const on = s === this.speed;
      setAttr(b, 'aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    if (focus !== undefined) this.speedBtns.get(focus)?.focus();
  }

  render(): void {
    setHidden(this.el, !this.open);
    const on = this.active;
    setHidden(this.badge, !on);
    setHidden(this.vignette, !on);
    this.ctx.root.classList.toggle('is-replay', on);
    document.documentElement.classList.toggle('is-replay', on);
    if (!this.open) return;

    const r = this.replay;
    const ready = this.status === 'ready' && !!r;
    setHidden(this.msgEl, ready || !this.message);
    setText(this.msgEl, this.message);
    this.el.classList.toggle('is-loading', this.status === 'loading');
    this.playBtn.disabled = !ready;
    this.range.disabled = !ready;
    this.daySel.disabled = !this.days.length;

    this.playBtn.innerHTML = this.playing ? TIMELAPSE_ICONS.pause : TIMELAPSE_ICONS.play;
    const playLabel = this.playing ? tr('Pausar') : r && this.t >= r.to ? tr('Reproduzir de novo') : tr('Reproduzir');
    setAttr(this.playBtn, 'aria-label', playLabel);
    setTitle(this.playBtn, tr('{0} (espaço na linha do tempo)', [playLabel]));
    this.syncSpeed();
    setHidden(this.demoBtn, !(r?.hasDemo && r.hasReal));
    this.demoBtn.classList.toggle('is-on', this.includeDemo);
    setAttr(this.demoBtn, 'aria-pressed', String(this.includeDemo));

    this.renderDays();
    if (r) {
      const max = Math.max(0, Math.round((r.to - r.from) / 1000));
      setAttr(this.range, 'max', String(max));
      setText(this.spanEl, `${hhmm(r.from)}–${hhmm(r.to)}`);
    }
    this.drawChart(false);
    this.renderClock();
  }

  // ---------------------------------------------------------------- dias e carga

  private renderDays(): void {
    const today = dayKey(Date.now());
    const sig = `${today}|${this.days.map((d) => `${d.day}:${d.from}:${d.to}`).join(',')}`;
    if (sig !== this.daysSig) {
      this.daysSig = sig;
      this.daySel.replaceChildren(
        ...this.days.map((d) => h('option', { text: `${dayLabel(d.day, today)} · ${hhmm(d.from)}–${hhmm(d.to)}`, attrs: { value: d.day } })),
      );
    }
    if (this.replay && this.daySel.value !== this.replay.day) this.daySel.value = this.replay.day;
  }

  private async loadDay(day: string, autoplay = false): Promise<void> {
    const wasPlaying = this.playing || autoplay;
    const seq = ++this.loadSeq;
    this.pause();
    let replay = this.cache.get(day);
    if (!replay) {
      this.status = 'loading';
      this.message = tr('Carregando o dia…');
      this.ctx.invalidate();
      const abort = this.abort ?? new AbortController();
      try {
        replay = new TimelineReplay(day, await fetchTimelineDay(day, abort.signal));
      } catch (err) {
        if (abort.signal.aborted || !this.open || seq !== this.loadSeq) return;
        this.status = 'error';
        this.message = tr('Não foi possível carregar este dia.');
        console.warn('[timelapse]', err);
        this.ctx.invalidate();
        return;
      }
      if (!this.open) return;
      this.cache.set(day, replay);
      if (seq !== this.loadSeq) return;
    }
    if (replay.empty) {
      this.status = 'empty';
      this.message = tr('Nada gravado neste dia.');
      this.ctx.invalidate();
      return;
    }
    this.replay = replay;
    // Só demonstração no dia (ex.: o gerador do GIF): mostra; com agentes de verdade, eles primeiro.
    this.includeDemo = !replay.hasReal;
    this.status = 'ready';
    this.message = '';
    this.chartSig = '';
    this.seek(replay.from);
    if (wasPlaying) this.play();
    this.ctx.invalidate();
  }

  // ---------------------------------------------------------------- reprodução

  private togglePlay(): void {
    if (this.playing) this.pause();
    else this.play();
    this.ctx.invalidate();
  }

  private play(): void {
    const r = this.replay;
    if (!r || this.playing) return;
    if (this.t >= r.to) this.seek(r.from);
    this.playing = true;
    this.lastReal = performance.now();
    this.lastPush = this.lastReal;
    this.raf ||= requestAnimationFrame(this.loop);
  }

  private pause(): void {
    this.playing = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    // Último ponto exato para a interface (a pausa congela o mundo nele).
    if (this.active) this.push();
  }

  /** Relógio da reprodução: com a aba oculta o rAF para e a reprodução espera junto. */
  private loop = (): void => {
    this.raf = 0;
    const r = this.replay;
    if (!this.playing || !r) return;
    const real = performance.now();
    const dt = Math.min(250, Math.max(0, real - this.lastReal));
    this.lastReal = real;
    this.t = Math.min(r.to, this.t + dt * this.speed);
    const end = this.t >= r.to;
    if (end || real - this.lastPush >= PUSH_MS) {
      this.lastPush = real;
      this.push();
    }
    this.renderClock();
    if (end) {
      this.playing = false;
      this.ctx.announce(tr('Fim da gravação deste dia.'));
      this.ctx.invalidate();
      return;
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  /** Snapshot do instante atual para o store (o primeiro liga o modo replay; o mundo aplica na hora). */
  private push(): void {
    const r = this.replay;
    if (!r) return;
    r.moveTo(this.t);
    this.ctx.store.pushReplay(r.snapshot(this.t, { includeDemo: this.includeDemo }));
  }

  /** Pula para `t`: recomeça o mundo (todos já no lugar) e publica o estado daquele instante. */
  private seek(t: number): void {
    const r = this.replay;
    if (!r) return;
    this.t = Math.min(r.to, Math.max(r.from, t));
    this.active = true;
    this.ctx.world.setPlayback?.(this.playback);
    this.push();
    this.lastPush = performance.now();
    this.renderClock();
  }

  /** Arrastando a linha do tempo: segue o dedo com o relógio e recomeça o mundo com throttle. */
  private scrub(t: number, final: boolean): void {
    if (!this.replay) return;
    this.t = t;
    this.renderClock();
    if (this.seekTimer) clearTimeout(this.seekTimer);
    this.seekTimer = null;
    const wait = SEEK_MS - (performance.now() - this.lastSeek);
    if (final || wait <= 0) {
      this.lastSeek = performance.now();
      this.seek(t);
      return;
    }
    this.seekTimer = setTimeout(() => {
      this.seekTimer = null;
      this.lastSeek = performance.now();
      this.seek(this.t);
    }, wait);
  }

  /** Sai do modo replay: mundo recomeçado ao vivo e o store de volta ao SSE. */
  private exit(): void {
    this.pause();
    if (this.seekTimer) clearTimeout(this.seekTimer);
    this.seekTimer = null;
    if (!this.active) return;
    this.active = false;
    this.ctx.world.setPlayback?.(null);
    this.ctx.store.stopReplay();
    this.replay = null;
  }

  private rangeTime(): number {
    return (this.replay?.from ?? 0) + Number(this.range.value) * 1000;
  }

  // ---------------------------------------------------------------- desenho

  /** Hora atual (barra e selo) e posição da linha do tempo: barato, roda a cada quadro da reprodução. */
  private renderClock(): void {
    const r = this.replay;
    if (!r) {
      setText(this.timeEl, '--:--');
      return;
    }
    const time = hhmm(this.t);
    setText(this.timeEl, time);
    setText(this.badgeTime, time);
    const today = dayKey(Date.now());
    setText(this.badgeDay, r.day === today ? '' : dayLabel(r.day, today));
    r.moveTo(this.t);
    setText(this.badgeNote, r.isOff(this.t) ? (r.limited ? tr('gravação pausada (limite do dia)') : tr('sem dados (servidor desligado)')) : '');
    const v = String(Math.round((this.t - r.from) / 1000));
    if (this.range.value !== v && document.activeElement !== this.range) this.range.value = v;
    const p = r.to > r.from ? ((this.t - r.from) / (r.to - r.from)) * 100 : 0;
    setStyleVar(this.track, '--p', `${p.toFixed(2)}%`);
    setAttr(this.range, 'aria-valuetext', `${time}${r.day === today ? '' : `, ${dayLabel(r.day, today)}`}`);
  }

  /** Gráfico de agentes presentes (cinza) e trabalhando (verde) por minuto, picos e régua de horas. */
  private drawChart(force: boolean): void {
    const r = this.replay;
    const w = this.chart.clientWidth;
    const hgt = this.chart.clientHeight;
    const sig = `${r?.day}|${r?.records.length}|${this.includeDemo}|${w}x${hgt}`;
    if (!force && sig === this.chartSig) return;
    this.chartSig = sig;
    const g = this.chart.getContext('2d');
    if (!g || !w || !hgt) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.chart.width = Math.round(w * dpr);
    this.chart.height = Math.round(hgt * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hgt);
    this.peaksEl.replaceChildren();
    this.ticksEl.replaceChildren();
    if (!r) return;
    const view = { includeDemo: this.includeDemo };
    const span = Math.max(1, r.to - r.from);
    const x = (at: number) => ((at - r.from) / span) * w;
    const buckets = r.buckets(view);
    const max = Math.max(1, ...buckets.map((b) => b.present));
    const bw = Math.max(1, (BUCKET_MS / span) * w + 0.5);
    const css = getComputedStyle(this.ctx.root);
    const working = css.getPropertyValue('--st-working').trim() || '#4fd18b';
    const waiting = css.getPropertyValue('--st-waiting').trim() || '#ffb547';
    for (const b of buckets) {
      const bx = x(b.at);
      const hp = Math.round((b.present / max) * (hgt - 3));
      const hw = Math.round((b.working / max) * (hgt - 3));
      if (hp) {
        g.fillStyle = 'rgba(160, 176, 210, 0.28)';
        g.fillRect(bx, hgt - hp, bw, hp);
      }
      if (hw) {
        g.globalAlpha = 0.8;
        g.fillStyle = working;
        g.fillRect(bx, hgt - hw, bw, hw);
        g.globalAlpha = 1;
      }
      if (b.waiting) {
        g.fillStyle = waiting;
        g.fillRect(bx, hgt - Math.max(hp, hw) - 2, bw, 2);
      }
    }
    for (const p of r.peaks(view)) {
      const label = tr('Pico às {0}: {1} {2}', [hhmm(p.at), p.working, p.working === 1 ? tr('agente trabalhando') : tr('agentes trabalhando')]);
      const btn = h('button', { class: 'ui-lapse__peak', type: 'button', title: label, attrs: { 'aria-label': label }, style: `left: ${((p.at - r.from) / span) * 100}%` });
      btn.innerHTML = TIMELAPSE_ICONS.peak;
      btn.addEventListener('click', () => {
        this.seek(p.at);
        this.ctx.invalidate();
      });
      this.peaksEl.append(btn);
    }
    for (const t of hourTicks(r.from, r.to)) {
      this.ticksEl.append(h('span', { class: 'ui-lapse__tick', text: hhmm(t), style: `left: ${((t - r.from) / span) * 100}%` }));
    }
  }
}

/** "180× — 1 min de reprodução = 3 h do dia". */
function speedHint(s: Speed): string {
  return tr('{0}× — 1 min de reprodução = {1} h do dia', [s, s / 60]);
}
