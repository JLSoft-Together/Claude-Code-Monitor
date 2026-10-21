// O social leve na cena da cidade (Fase 5): o que dá para fazer com os outros sem nenhum texto livre.
//   L ou ❤️ perto da porta (até 4 passos) = like; o coração voa até a placa e o contador pula.
//   G = a roda de cumprimentos (10 frases da lista, para quem acabou de me cumprimentar, o selecionado ou o mais perto);
//       os balões ficam 5 s sobre as cabeças.
//   K perto da porta de quem aceita (até 2 passos) = bater na porta (o dono recebe sem o meu nome).
//   Cartão de perfil: Cumprimentar, Bloquear (com confirmação) e Denunciar (motivos fixos).
//   Minimapa: "Ir para HB-XXXX" e "Visitar um prédio aleatório" (com fade).
//   Praça: o termômetro da meta da semana, a placa da prefeitura, os fogos de 20 s e o enfeite depois da meta.
//   Fachadas: o medidor de tokens do dia ao lado da porta, o letreiro pela faixa da semana, o confete do fim de turno e
//   o selo "não verificado" na placa (quando o mundo marca).
// Liga-se à cena por poucos ganchos (city/index.ts): as mensagens antes do estado, o snapshot, o quadro, os ganchos de
// desenho do CityRenderer (CityFx), os extras dos cartões e as teclas. Comandos só no formato do protocolo, com os
// limites do lado de cá (o servidor fecha a conexão depois de 3 recusas por limite num minuto).
import { tr } from '../../../../shared/i18n';
import { blockAt, chunkOf, lotDoor } from '../../../../shared/world/city';
import type { WorldSceneCity, WorldSceneCommand, WorldSceneSnapshot } from '../../../../shared/world/api';
import type { GreetingId, ReportReason, WorldBuildingPublic } from '../../../../shared/world/protocol';
import { parseCityStatus } from '../../../../shared/world/scene';
import { GREETINGS, REPORT_REASONS, greetingIcon, greetingLabel, reportLabel } from '../../../../shared/world/social-labels';
import { TILE } from '../../art/api';
import { h, setHidden, setText } from '../../ui/dom';
import type { Camera } from '../camera';
import { modalOpen } from '../input';
import { Particles } from '../render/particles';
import type { CityCards } from './cards';
import { signRect } from './facade';
import {
  BOARDS,
  boardTextRects,
  BUNTING,
  cityHallView,
  drawBunting,
  drawBuntingLights,
  drawGoalBoard,
  drawHallBoard,
  drawSeasonal,
  Fireworks,
  FIREWORKS_MS,
  goalView,
  ornamentFor,
  reachedGoalView,
  type GoalView,
  seasonalSpots,
} from './fireworks';
import { BalloonBook, GreetingWheel, pickGreetTarget, RateGate, REPLY_WINDOW_MS, suggestedReply, type WheelTarget } from './greetings';
import { doorActions, doorTarget, HEART_PIXELS, heartAt, KnockBook, KNOCK_DISTANCE, LIKE_DISTANCE, type HeartFlight } from './likes';
import type { BuildingVis, CityFx, CityFxProp, CityRenderer, CityScreenMap, CityView } from './scene';
import type { CityState } from './state';
import { TeleportFade, TeleportPanel } from './teleport';
import { drawMeter, drawMeterGlow, drawSignGlow, meterBars, meterRect, shiftEnded, signGlowLevel } from './tokens-facade';
import './social.css';

const UI_FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
/** Um aviso do mundo logo depois de um comando é a resposta a ele (para o texto certo). */
const PENDING_MS = 4_000;
/** Quanto o ponteiro do medidor balança depois de a faixa do dia mudar. */
const WIGGLE_MS = 1_600;
/** Quanto dura o pulo do contador de likes na placa. */
const BUMP_MS = 1_100;
/** A partir deste zoom os textos das placas da praça aparecem (como as placas dos prédios). */
const BOARD_TEXT_ZOOM = 1.05;

type Pending =
  | { kind: 'like' | 'unlike' | 'knock' | 'stamp'; at: number; buildingId: string }
  | { kind: 'teleport'; at: number; code?: string }
  | { kind: 'greet' | 'block' | 'report'; at: number; playerId: string };

export interface CitySocialOptions {
  /** O estado da cena (troca a cada stream novo). */
  state(): CityState;
  renderer(): CityRenderer;
  camera: Camera;
  canvas: HTMLCanvasElement;
  /** Manda comandos pelo stream (só os da cena). */
  send(cmds: WorldSceneCommand[]): void;
  /** Meu personagem na rua (tiles), ou null antes do `pos`. */
  me(): { x: number; y: number } | null;
  cards: CityCards;
  /** O aviso rápido da cena. */
  toast(text: string): void;
  /** A cena está na tela. */
  active(): boolean;
  /** Fui teletransportado: a câmera vai junto, sem animação, e os chunks em volta se atualizam. */
  teleported(): void;
  /** Aplica uma mensagem guardada (o `pos` do teletransporte, que só vale com a tela já escura). */
  replay(msg: unknown): void;
  /** Modo demonstração com `?fireworks=1`: o botão de teste dos fogos chama isto (a cidade falsa comemora). */
  testFireworks?: () => void;
}

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? ''));
}

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** O servidor do mundo só aceita cumprimentar quem está no mesmo chunk (os 2×2 quarteirões). */
const sameChunk = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  const ca = chunkOf(blockAt(a.x, a.y));
  const cb = chunkOf(blockAt(b.x, b.y));
  return ca.x === cb.x && ca.y === cb.y;
};
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export class CitySocial implements CityFx {
  readonly el: HTMLElement;
  private readonly wheel = new GreetingWheel();
  private readonly balloons = new BalloonBook();
  // Os limites do lado de cá ficam um pouco abaixo dos do servidor do mundo (3 recusas por limite num minuto fecham a
  // conexão): os comandos saem em lotes a cada 200 ms e podem chegar mais juntos do que saíram.
  private readonly greetGate = new RateGate(18, 3_300);
  private readonly likeGate = new RateGate(9, 400);
  private readonly teleportGate = new RateGate(9, 1_500);
  /** Denúncias de hoje (dia UTC), no máximo 5 (o servidor também confere). */
  private reports = { day: '', n: 0 };
  private readonly knocks = new KnockBook();
  private readonly hearts: HeartFlight[] = [];
  private readonly bumps = new Map<string, number>();
  private readonly wiggles = new Map<string, { band: number; at: number }>();
  private readonly pops: Array<{ x: number; y: number; at: number; text: string }> = [];
  private readonly fireworks = new Fireworks();
  private readonly confetti = new Particles(500);
  private readonly fade = new TeleportFade();
  private readonly fadeEl: HTMLElement;
  private readonly panel: TeleportPanel;
  private readonly dock: HTMLElement;
  private readonly testBtn: HTMLButtonElement | null = null;
  private dockKey = '';
  private city: WorldSceneCity | null = null;
  /** A meta que acabou de bater: o termômetro fica cheio durante os fogos. */
  private celebrating: { goal: GoalView; until: number } | null = null;
  private replyTo: { id: string; at: number; got: GreetingId } | null = null;
  private pending: Pending | null = null;
  private snapCamera = false;
  /** O `pos` do teletransporte, guardado até o fade escurecer a tela (ninguém vê o pulo). */
  private heldPos: unknown = null;
  private lastNow = 0;
  private readonly reported = new Set<string>();
  private readonly blocked = new Set<string>();
  private readonly extras = { building: null as BuildingExtras | null, player: null as PlayerExtras | null };
  private readonly propsPool: CityFxProp[] = [];
  private readonly onKeyDown = (e: KeyboardEvent) => this.onKey(e);

  constructor(private readonly o: CitySocialOptions) {
    this.fadeEl = h('div', { class: 'ui-city-fade', hidden: true, attrs: { 'aria-hidden': 'true' } });
    this.panel = new TeleportPanel({ go: (code) => this.teleport(code), random: () => this.teleport() });
    this.dock = h('div', { class: 'ui-city-dock', role: 'toolbar', attrs: { 'aria-label': tr('Ações perto de você') } });
    const params = typeof location === 'undefined' ? null : new URLSearchParams(location.search);
    if (o.testFireworks && params?.has('fireworks')) {
      const test = o.testFireworks;
      this.testBtn = h('button', { class: 'ui-city-testfw', type: 'button', text: `🎆 ${tr('Testar os fogos')}`, on: { click: () => test() } });
    }
    this.el = h('div', { class: 'ui-city-social' }, this.dock, this.panel.el, this.wheel.el, this.fadeEl, this.testBtn);
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  /** As dicas das teclas novas (para a barra de ajuda da cena). */
  helpItems(): HTMLElement[] {
    return [
      h('span', {}, h('kbd', { text: 'L' }), ' ', tr('curtir')),
      h('span', {}, h('kbd', { text: 'G' }), ' ', tr('cumprimentar')),
      h('span', {}, h('kbd', { text: 'K' }), ' ', tr('bater')),
    ];
  }

  /** Stream novo (a cena abriu de novo): esquece o que era do anterior. */
  reset(): void {
    this.wheel.close();
    this.balloons.clear();
    this.hearts.length = 0;
    this.bumps.clear();
    this.wiggles.clear();
    this.pops.length = 0;
    this.fireworks.stop();
    this.confetti.clear();
    this.pending = null;
    this.replyTo = null;
    this.city = null;
    this.celebrating = null;
    this.blocked.clear();
    this.snapCamera = false;
    this.heldPos = null;
    this.fadeEl.hidden = true;
    this.panel.setBusy(false);
  }

  /** A cena saiu da tela. */
  hide(): void {
    this.wheel.close();
  }

  /** Esc: fecha a roda (true) ou não havia nada aberto. */
  escape(): boolean {
    if (this.wheel.open) {
      this.wheel.close();
      return true;
    }
    return false;
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.el.remove();
  }

  // ------------------------------------------------------------------ do stream

  /** O `world.snapshot`: a meta da cidade que veio guardada. */
  snapshot(snap: WorldSceneSnapshot): void {
    this.city = snap.city ? parseCityStatus(snap.city) ?? null : null;
  }

  /**
   * Uma mensagem do mundo, ANTES do estado (o que mudou precisa do valor de antes). true = já tratada aqui (um aviso
   * que é a resposta a um comando do social, com o texto certo): a cena não mostra o genérico.
   */
  message(msg: unknown, now: number): boolean {
    if (!obj(msg) || typeof msg.t !== 'string') return false;
    const state = this.o.state();
    switch (msg.t) {
      case 'greeting':
        this.onGreeting(msg, now);
        return false;
      case 'player.join':
        // desbloqueado (em Configurações, por exemplo): a pessoa voltou à rua e à roda
        if (obj(msg.player) && typeof msg.player.id === 'string') this.blocked.delete(msg.player.id);
        return false;
      case 'like.update': {
        const id = msg.buildingId;
        const b = typeof id === 'string' ? state.buildings.get(id) : undefined;
        if (b && num(msg.likes) && msg.likes > b.likes) this.bumps.set(b.id, now);
        if (this.pending && (this.pending.kind === 'like' || this.pending.kind === 'unlike') && this.pending.buildingId === id) this.pending = null;
        return false;
      }
      case 'area.patch':
        this.onPatch(msg, state, now);
        return false;
      case 'city': {
        const c = parseCityStatus(msg);
        if (c) this.city = c;
        return false;
      }
      case 'city.fireworks': {
        this.fireworks.start(now);
        const g = typeof msg.goalId === 'string' ? reachedGoalView(msg.goalId) : null;
        if (g) this.celebrating = { goal: g, until: now + FIREWORKS_MS };
        this.o.toast(g ? `🎆 ${tr('A cidade bateu a meta da semana: {0}!', [g.label])}` : `🎆 ${tr('A cidade bateu a meta da semana!')}`);
        return false;
      }
      case 'pos':
        if (this.pending?.kind === 'teleport') {
          this.pending = null;
          this.fade.arrived();
          this.heldPos = msg;
          return true;
        }
        return false;
      case 'notice':
        return typeof msg.text === 'string' && this.onNotice(msg.text, now);
      default:
        return false;
    }
  }

  private onGreeting(msg: Record<string, unknown>, now: number): void {
    const from = msg.from;
    const id = msg.greetingId as GreetingId;
    if (typeof from !== 'string' || !(id in GREETINGS)) return;
    const me = this.o.state().me?.id;
    this.balloons.add(from, id, now);
    if (from === me) {
      if (this.pending?.kind === 'greet') this.pending = null;
      return;
    }
    if (msg.to === me && me) {
      // alguém me cumprimentou: G responde para essa pessoa
      this.replyTo = { id: from, at: now, got: id };
      const name = this.o.state().players.get(from)?.info.name ?? tr('Alguém');
      this.o.toast(tr('{0}: {1} {2} — G para responder', [name, greetingIcon(id), greetingLabel(id)]));
    }
  }

  private onPatch(msg: Record<string, unknown>, state: CityState, now: number): void {
    if (!Array.isArray(msg.changes)) return;
    for (const c of msg.changes) {
      if (!obj(c) || typeof c.id !== 'string') continue;
      const prev = state.buildings.get(c.id);
      if (!prev) continue;
      if (num(c.likes) && c.likes > prev.likes) this.bumps.set(c.id, now);
      // fim de turno: agentes trabalhando a menos e à toa a mais → confete na fachada
      if (shiftEnded(prev.agents, c.agents)) this.celebrateShift(c.id, now);
      const day = obj(c.tokens) && num(c.tokens.day) ? c.tokens.day : undefined;
      if (day !== undefined && day !== prev.tokens?.day) this.wiggles.set(c.id, { band: day, at: now });
    }
  }

  private celebrateShift(id: string, now: number): void {
    const v = this.drawn(id);
    if (!v) return;
    const r = signRect(v.m);
    const x = v.x + r.x + r.w / 2;
    const y = v.y + r.y;
    this.confetti.confetti(x, y, 40);
    this.confetti.sparkle(x, y - 4, 10);
    this.pops.push({ x, y: y - 6, at: now, text: '🎉' });
  }

  /** O aviso que responde a um comando do social: o texto certo para ele. */
  private onNotice(text: string, now: number): boolean {
    const p = this.pending;
    if (!p || now - p.at > PENDING_MS) return false;
    let say: string | null = null;
    switch (p.kind) {
      case 'like':
      case 'unlike':
        if (text === 'too_far') say = tr('Chegue mais perto da porta para curtir (até 4 passos).');
        else if (text === 'daily_limit') say = tr('Você já deu os 50 likes de hoje. Amanhã tem mais!');
        else if (text === 'invalid') say = tr('Não dá para curtir o próprio prédio.');
        else if (text === 'not_found') say = tr('Este prédio não está mais aqui.');
        else if (text === 'rate_limited') say = tr('Devagar com os likes: espere um pouquinho.');
        break;
      case 'knock':
        if (text === 'too_far') say = tr('Chegue mais perto da porta para bater (até 2 passos).');
        else if (text === 'rate_limited') say = tr('Você bateu nesta porta há pouco. Espere um minuto.');
        else if (text === 'not_found') say = tr('Este prédio não está mais aqui.');
        break;
      case 'stamp':
        if (text === 'already_done') say = tr('Você já deixou um carimbo aqui hoje.');
        else if (text === 'too_far') say = tr('Chegue mais perto da porta para carimbar.');
        else if (text === 'not_found') say = tr('Este prédio não está mais aqui.');
        break;
      case 'teleport':
        if (text === 'not_found') say = p.code ? tr('Nenhum prédio com o código {0}.', [p.code]) : tr('Nenhum prédio aceso para visitar agora.');
        else if (text === 'rate_limited') say = tr('Devagar: espere um pouco antes de ir para outro prédio.');
        if (say) {
          this.fade.failed();
          if (p.code) this.panel.showError(say);
        }
        break;
      case 'greet':
        if (text === 'not_found') say = tr('Essa pessoa não está mais por perto.');
        else if (text === 'rate_limited') say = tr('Devagar: um cumprimento a cada 3 segundos.');
        break;
      case 'block':
      case 'report':
        // a confirmação (`blocked_ok`, `reported`) já foi dita na hora, no toast do bloqueio ou da denúncia
        if (text === (p.kind === 'block' ? 'blocked_ok' : 'reported')) {
          this.pending = null;
          return true;
        }
        if (text === 'daily_limit') say = tr('Você já mandou as 5 denúncias de hoje.');
        else if (text === 'not_found') say = tr('Essa pessoa não está mais por perto.');
        break;
    }
    if (!say) return false;
    this.pending = null;
    this.o.toast(say);
    return true;
  }

  // ------------------------------------------------------------------ ações

  private send(cmd: WorldSceneCommand, pending: Pending | null): void {
    this.o.send([cmd]);
    if (pending) this.pending = pending;
  }

  /** O prédio de uma porta perto de mim, para curtir (L ou o botão). */
  likeNearest(now: number): void {
    const me = this.o.me();
    const state = this.o.state();
    if (!me) return;
    const t = doorTarget(me, (lot) => state.buildingAt(lot), state.myBuildingId, LIKE_DISTANCE);
    if (!t) {
      this.o.toast(tr('Chegue perto da porta de um prédio (até 4 passos) e aperte L para curtir.'));
      return;
    }
    this.toggleLike(t.building, now);
  }

  /** Curtir ou desfazer (o coração voa até a placa, ou cai partido). */
  toggleLike(b: WorldBuildingPublic, now: number): void {
    const me = this.o.me();
    const state = this.o.state();
    if (!me || b.id === state.myBuildingId || this.fade.busy) return;
    const a = doorActions(b, me, state.myBuildingId);
    if (!a.canLike) {
      this.o.toast(tr('Chegue mais perto da porta para curtir (até 4 passos).'));
      return;
    }
    if (!this.likeGate.take(now)) {
      this.o.toast(tr('Devagar com os likes: espere um pouquinho.'));
      return;
    }
    const on = !b.likedByMe;
    this.send({ t: on ? 'like' : 'unlike', buildingId: b.id }, { kind: on ? 'like' : 'unlike', at: now, buildingId: b.id });
    const v = this.drawn(b.id);
    const to = v ? this.likeSpot(v) : { x: lotDoor(b.lot).front.x * TILE, y: lotDoor(b.lot).front.y * TILE - 40 };
    this.hearts.push({ from: { x: me.x * TILE, y: me.y * TILE - 30 }, to, start: now, ...(on ? {} : { broken: true }) });
  }

  /** Bater na porta (K): perto (até 2 passos) de quem aceita. */
  knockNearest(now: number): void {
    const me = this.o.me();
    const state = this.o.state();
    if (!me) return;
    const t = doorTarget(me, (lot) => state.buildingAt(lot), state.myBuildingId, KNOCK_DISTANCE);
    if (!t) {
      this.o.toast(tr('Chegue a 2 passos da porta de um prédio e aperte K para bater.'));
      return;
    }
    this.knock(t.building, now);
  }

  knock(b: WorldBuildingPublic, now: number): void {
    const me = this.o.me();
    if (!me || this.fade.busy) return;
    const a = doorActions(b, me, this.o.state().myBuildingId);
    if (!b.knocks) {
      this.o.toast(tr('O dono deste prédio não recebe batidas na porta.'));
      return;
    }
    if (!a.canKnock) {
      this.o.toast(tr('Chegue mais perto da porta para bater (até 2 passos).'));
      return;
    }
    if (!this.knocks.take(b.id, now)) {
      this.o.toast(tr('Você bateu nesta porta há pouco. Espere um minuto.'));
      return;
    }
    this.send({ t: 'knock', buildingId: b.id }, { kind: 'knock', at: now, buildingId: b.id });
    const v = this.drawn(b.id);
    if (v) {
      const d = lotDoor(b.lot).front;
      this.pops.push({ x: d.x * TILE, y: v.m.side === 'front' ? v.y + v.m.height - 26 : v.y + 8, at: now, text: '✊' });
    }
    this.o.toast(`🚪 ${tr('Toc, toc! Você bateu na porta de {0}.', [b.owner.name])}`);
  }

  /** A roda de cumprimentos para quem me cumprimentou há pouco, o selecionado no cartão ou o mais perto. */
  openWheel(now: number, forceTarget?: string): void {
    const me = this.o.me();
    const state = this.o.state();
    if (!me || this.fade.busy) return;
    const near: Array<{ id: string; x: number; y: number }> = [];
    for (const [id, rp] of state.players) if (!this.blocked.has(id) && sameChunk(me, rp.info.pos)) near.push({ id, x: rp.info.pos.x, y: rp.info.pos.y });
    const reply = this.replyTo && now - this.replyTo.at < REPLY_WINDOW_MS ? this.replyTo : null;
    const selected = forceTarget ?? (this.o.cards.kind === 'player' ? this.o.cards.id : null);
    const id = forceTarget && state.players.has(forceTarget) ? forceTarget : pickGreetTarget(me, near, { selected, replyTo: reply?.id ?? null });
    if (!id) {
      this.o.toast(tr('Ninguém por perto para cumprimentar.'));
      return;
    }
    const rp = state.players.get(id);
    if (!rp) return;
    const target: WheelTarget = { id, name: rp.info.name };
    const at = this.toWindow(me.x * TILE, me.y * TILE - 24);
    const toward = this.toWindow(rp.info.pos.x * TILE, rp.info.pos.y * TILE - 24);
    const first = reply && reply.id === id ? suggestedReply(reply.got) : null;
    this.wheel.show(target, at, toward, first, (gid) => this.greet(id, gid, performance.now()));
  }

  greet(playerId: string, greetingId: GreetingId, now: number): void {
    if (this.fade.busy) return;
    const wait = this.greetGate.wait(now);
    if (wait > 0) {
      this.o.toast(tr('Devagar: um cumprimento a cada 3 segundos.'));
      return;
    }
    this.greetGate.take(now);
    this.send({ t: 'greet', playerId, greetingId }, { kind: 'greet', at: now, playerId });
    const me = this.o.state().me?.id;
    if (me) this.balloons.add(me, greetingId, now);
    if (this.replyTo?.id === playerId) this.replyTo = null;
  }

  /** "Ir para HB-XXXX" (com código) ou "Visitar um prédio aleatório" (sem). */
  teleport(code?: string): void {
    const now = performance.now();
    if (!this.o.me()) return;
    if (this.fade.busy) return;
    if (!this.teleportGate.take(now)) {
      this.o.toast(tr('Devagar: espere um pouco antes de ir para outro prédio.'));
      return;
    }
    this.wheel.close();
    this.o.cards.hide();
    this.send(code ? { t: 'teleport', code } : { t: 'teleport' }, code ? { kind: 'teleport', at: now, code } : { kind: 'teleport', at: now });
    this.fade.start(now);
    this.panel.setBusy(true);
  }

  private block(playerId: string, name: string, now: number): void {
    if (this.fade.busy) return;
    this.send({ t: 'block', playerId }, { kind: 'block', at: now, playerId });
    this.blocked.add(playerId);
    this.o.cards.hide();
    this.o.toast(tr('{0} bloqueado. Para desfazer: Configurações › Habblaud World › Bloqueados.', [name]));
  }

  private report(playerId: string, reason: ReportReason, now: number): boolean {
    if (this.fade.busy) return false;
    const day = new Date().toISOString().slice(0, 10);
    if (this.reports.day !== day) this.reports = { day, n: 0 };
    if (this.reports.n >= 5) {
      this.o.toast(tr('Você já mandou as 5 denúncias de hoje.'));
      return false;
    }
    this.reports.n++;
    this.send({ t: 'report', playerId, reason }, { kind: 'report', at: now, playerId });
    this.reported.add(playerId);
    this.o.toast(tr('Denúncia enviada. Obrigado: a moderação vai olhar.'));
    return true;
  }

  // ------------------------------------------------------------------ teclas

  private onKey(e: KeyboardEvent): void {
    if (!this.o.active()) return;
    if (this.wheel.open) {
      if (this.wheel.key(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (isTyping(e.target) || modalOpen(e.target as HTMLElement | null)) return;
    // indo para outro prédio (tela escura): nada até chegar
    if (this.fade.busy) return;
    const now = performance.now();
    switch (e.key) {
      case 'l':
      case 'L':
        e.preventDefault();
        this.likeNearest(now);
        return;
      case 'g':
      case 'G':
        e.preventDefault();
        this.openWheel(now);
        return;
      case 'k':
      case 'K':
        e.preventDefault();
        this.knockNearest(now);
        return;
    }
  }

  // ------------------------------------------------------------------ quadro

  /** A cada quadro: fogos, confete, fade, câmera depois do teletransporte, os botões perto de mim e os cartões. */
  frame(now: number, dt: number): void {
    this.lastNow = now;
    this.fireworks.update(now, dt);
    this.confetti.update(dt);
    for (let i = this.hearts.length - 1; i >= 0; i--) {
      const f = this.hearts[i]!;
      if (now - f.start > 1_000) {
        this.hearts.splice(i, 1);
        // chegou: o contador da placa pula
        if (!f.broken) {
          const v = this.findAt(f.to);
          if (v) this.bumps.set(v.b.id, now);
        }
      }
    }
    for (let i = this.pops.length - 1; i >= 0; i--) if (now - this.pops[i]!.at > 1_300) this.pops.splice(i, 1);
    const f = this.fade.tick(now);
    if (this.heldPos && f.phase !== 'out') {
      // a tela já está escura: agora sim o personagem (e a câmera) vão para o lugar novo
      const msg = this.heldPos;
      this.heldPos = null;
      this.o.replay(msg);
      this.snapCamera = true;
    }
    this.fadeEl.hidden = f.phase === 'idle';
    if (f.phase !== 'idle') this.fadeEl.style.opacity = f.dark.toFixed(3);
    if (f.phase === 'idle' || f.phase === 'in') this.panel.setBusy(false);
    if (f.timedOut) {
      this.pending = null;
      this.o.toast(tr('O mundo não respondeu a tempo. Tente de novo.'));
    }
    if (this.snapCamera && this.o.me()) {
      this.snapCamera = false;
      this.o.teleported();
      this.panel.clear();
    }
    this.syncDock(now);
    this.extras.building?.sync();
    this.extras.player?.sync();
  }

  private syncDock(now: number): void {
    const me = this.o.me();
    const state = this.o.state();
    let like: WorldBuildingPublic | null = null;
    let knock: WorldBuildingPublic | null = null;
    let greet = false;
    if (me) {
      like = doorTarget(me, (lot) => state.buildingAt(lot), state.myBuildingId, LIKE_DISTANCE)?.building ?? null;
      const k = doorTarget(me, (lot) => state.buildingAt(lot), state.myBuildingId, KNOCK_DISTANCE)?.building ?? null;
      knock = k?.knocks ? k : null;
      for (const rp of state.players.values()) {
        if ((rp.info.pos.x - me.x) ** 2 + (rp.info.pos.y - me.y) ** 2 <= 144 && !this.blocked.has(rp.info.id) && sameChunk(me, rp.info.pos)) {
          greet = true;
          break;
        }
      }
    }
    const key = `${like?.id ?? ''}|${like?.likedByMe ? 1 : 0}|${knock?.id ?? ''}|${greet ? 1 : 0}|${this.wheel.open ? 1 : 0}`;
    if (key === this.dockKey) return;
    this.dockKey = key;
    const buttons: HTMLElement[] = [];
    const btn = (icon: string, text: string, k: string, title: string, fn: () => void, cls = '') =>
      h('button', { class: `ui-city-dock__btn ${cls}`.trim(), type: 'button', title, attrs: { 'aria-label': title, 'aria-keyshortcuts': k }, on: { click: fn } }, h('span', { class: 'ui-city-dock__icon', text: icon, attrs: { 'aria-hidden': 'true' } }), h('span', { class: 'ui-city-dock__text', text }), h('kbd', { text: k }));
    if (like) {
      const b = like;
      buttons.push(
        b.likedByMe
          ? btn('💔', tr('Descurtir'), 'L', tr('Desfazer o like no prédio de {0}', [b.owner.name]), () => this.toggleLike(this.o.state().buildings.get(b.id) ?? b, performance.now()), 'is-liked')
          : btn('❤️', tr('Curtir'), 'L', tr('Curtir o prédio de {0}', [b.owner.name]), () => this.toggleLike(this.o.state().buildings.get(b.id) ?? b, performance.now()), 'is-like'),
      );
    }
    if (knock) {
      const b = knock;
      buttons.push(btn('🚪', tr('Bater'), 'K', tr('Bater na porta de {0}', [b.owner.name]), () => this.knock(this.o.state().buildings.get(b.id) ?? b, performance.now())));
    }
    if (greet) buttons.push(btn('👋', tr('Cumprimentar'), 'G', tr('Cumprimentar quem está perto'), () => this.openWheel(performance.now())));
    this.dock.replaceChildren(...buttons);
    setHidden(this.dock, !buttons.length);
    void now;
  }

  // ------------------------------------------------------------------ cartões (extras)

  /** O elemento extra do cartão aberto (cards.ts o põe no fim): ações do prédio ou do jogador. */
  cardExtras(kind: 'building' | 'player', id: string): HTMLElement | null {
    if (kind === 'building') {
      if (!this.extras.building) this.extras.building = new BuildingExtras(this);
      this.extras.building.bind(id);
      return this.extras.building.el;
    }
    if (!this.extras.player) this.extras.player = new PlayerExtras(this);
    this.extras.player.bind(id);
    return this.extras.player.el;
  }

  /** Para os extras dos cartões. */
  get ctx(): { state: CityState; me: { x: number; y: number } | null; reported: ReadonlySet<string> } {
    return { state: this.o.state(), me: this.o.me(), reported: this.reported };
  }

  /** Ações chamadas pelos extras dos cartões. */
  act = {
    like: (b: WorldBuildingPublic) => this.toggleLike(b, performance.now()),
    knock: (b: WorldBuildingPublic) => this.knock(b, performance.now()),
    greet: (playerId: string) => this.openWheel(performance.now(), playerId),
    block: (playerId: string, name: string) => this.block(playerId, name, performance.now()),
    report: (playerId: string, reason: ReportReason) => this.report(playerId, reason, performance.now()),
  };

  // ------------------------------------------------------------------ desenho (CityFx)

  private drawn(id: string): BuildingVis | undefined {
    for (const v of this.o.renderer().buildingsDrawn) if (v.b.id === id) return v;
    return undefined;
  }

  private findAt(p: { x: number; y: number }): BuildingVis | undefined {
    for (const v of this.o.renderer().buildingsDrawn) if (p.x >= v.x && p.x <= v.x + 192 && p.y >= v.y - 4 && p.y <= v.y + v.m.height) return v;
    return undefined;
  }

  /** Onde fica o contador de likes na placa (px de mundo). */
  private likeSpot(v: BuildingVis): { x: number; y: number } {
    const r = signRect(v.m);
    return { x: v.x + r.x + r.w - 10, y: v.y + r.y + r.h / 2 };
  }

  /** O termômetro agora: a meta que acabou de bater (cheia) durante os fogos, depois a da semana. */
  private goal(now: number): GoalView | null {
    if (this.celebrating && now < this.celebrating.until) return this.celebrating.goal;
    return goalView(this.city);
  }

  /** Px de mundo → px da janela (para pôr a roda no lugar do personagem). */
  private toWindow(wx: number, wy: number): { x: number; y: number } {
    const p = this.o.camera.worldToScreen(wx, wy);
    const r = this.o.canvas.getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }

  /** Depois de cada fachada: o medidor de tokens do dia ao lado da porta. */
  building(ctx: CanvasRenderingContext2D, v: BuildingVis, now: number): void {
    const day = v.b.tokens?.day;
    if (day === undefined || !v.s) return;
    const r = meterRect(v.m);
    const w = this.wiggles.get(v.b.id);
    const wiggle = w ? Math.max(0, 1 - (now - w.at) / WIGGLE_MS) : 0;
    drawMeter(ctx, v.x + r.x, v.y + r.y, meterBars(day), now, wiggle, v.b.state === 'online');
  }

  /** As placas da praça e, com a meta batida, as bandeirinhas e os enfeites da estação (com profundidade). */
  props(view: CityView, push: (p: CityFxProp) => void): void {
    const pool = this.propsPool;
    let used = 0;
    const take = (y: number, draw: (ctx: CanvasRenderingContext2D, now: number) => void) => {
      let p = pool[used];
      if (!p) pool[used] = p = { y, draw };
      p.y = y;
      p.draw = draw;
      used++;
      push(p);
    };
    const inView = (x: number, y: number, w: number, hh: number) => x < view.x1 && x + w > view.x0 && y < view.y1 && y + hh > view.y0;
    const bw = BOARDS.w;
    const bh = BOARDS.h + BOARDS.posts;
    if (inView(BOARDS.goal.x - bw / 2, BOARDS.goal.y - bh, bw, bh)) take(BOARDS.goal.y, (ctx, now) => drawGoalBoard(ctx, this.goal(now), now));
    if (inView(BOARDS.hall.x - bw / 2, BOARDS.hall.y - bh, bw, bh)) take(BOARDS.hall.y, (ctx) => drawHallBoard(ctx, (this.city?.lit ?? 0) > 0));
    const reached = this.goal(this.lastNow)?.reached ?? 0;
    if (reached < 1) return;
    for (const [x0, y0, x1, y1] of BUNTING) {
      if (inView(x0, y0 - 4, x1 - x0, 30)) take(y0 + 40, (ctx, now) => drawBunting(ctx, x0, y0, x1, y1, now));
    }
    for (const s of seasonalSpots(ornamentFor(new Date()))) {
      if (inView(s.x - 20, s.y - 60, 40, 64)) take(s.y, (ctx) => drawSeasonal(ctx, s.kind, s.x, s.y));
    }
  }

  /** Por cima da noite: o letreiro e o medidor brilhando, os corações, o confete e os fogos. */
  world(ctx: CanvasRenderingContext2D, now: number, view: CityView): void {
    const r = this.o.renderer();
    const night = r.night;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const v of r.buildingsDrawn) {
      const t = v.b.tokens;
      if (!t || !v.s) continue;
      const on = v.b.state === 'online';
      if (on) drawSignGlow(ctx, v.x, v.y, v.m, signGlowLevel(t.week), now, night, (v.b.lot.x * 7 + v.b.lot.y * 13) & 15);
      if (on) {
        const mr = meterRect(v.m);
        drawMeterGlow(ctx, v.x + mr.x, v.y + mr.y, meterBars(t.day), night);
      }
    }
    ctx.restore();
    // corações voando até a placa
    for (const f of this.hearts) {
      const p = heartAt(f, now);
      if (p) this.drawHeart(ctx, p.x, p.y, p.scale, p.alpha, f.broken === true, night);
    }
    // a praça de noite: as placas acesas por trás, as lampadazinhas das bandeirinhas e as abóboras brilhando
    if (night > 0.15) this.plazaLights(ctx, now, view, night);
    this.confetti.draw(ctx, view.x0, view.y0, view.x1, view.y1, now);
    this.fireworks.draw(ctx, now, view, night);
  }

  private plazaLights(ctx: CanvasRenderingContext2D, now: number, view: CityView, night: number): void {
    const inView = (x: number, y: number, w: number, hh: number) => x < view.x1 && x + w > view.x0 && y < view.y1 && y + hh > view.y0;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const [b, tint] of [
      [BOARDS.goal, 'rgba(255,150,110,'],
      [BOARDS.hall, 'rgba(130,180,255,'],
    ] as const) {
      const x = b.x - BOARDS.w / 2 + 3;
      const y = b.y - BOARDS.posts - BOARDS.h + 3;
      if (!inView(x, y, BOARDS.w, BOARDS.h)) continue;
      ctx.fillStyle = `${tint}${(0.16 * night).toFixed(3)})`;
      ctx.fillRect(x, y, BOARDS.w - 6, BOARDS.h - 6);
      ctx.fillStyle = `${tint}${(0.07 * night).toFixed(3)})`;
      ctx.fillRect(x - 6, y - 6, BOARDS.w + 6, BOARDS.h + 6);
    }
    const reached = this.goal(now)?.reached ?? 0;
    if (reached >= 1) {
      for (const [x0, y0, x1, y1] of BUNTING) if (inView(x0, y0 - 4, x1 - x0, 34)) drawBuntingLights(ctx, x0, y0, x1, y1, now, night);
      if (ornamentFor(new Date()) === 'halloween') {
        for (const s of seasonalSpots('halloween')) {
          if (s.kind !== 'pumpkin' || !inView(s.x - 20, s.y - 30, 40, 40)) continue;
          const flicker = 0.75 + 0.25 * Math.sin(now / 90 + s.x);
          const g = ctx.createRadialGradient(s.x, s.y - 10, 0, s.x, s.y - 10, 18);
          g.addColorStop(0, `rgba(255,150,40,${(0.32 * night * flicker).toFixed(3)})`);
          g.addColorStop(1, 'rgba(255,150,40,0)');
          ctx.fillStyle = g;
          ctx.fillRect(s.x - 18, s.y - 28, 36, 36);
        }
      }
    }
    ctx.restore();
  }

  private drawHeart(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, alpha: number, broken: boolean, night: number): void {
    const s = Math.max(1, Math.round(scale * 1.5)) / 1.5;
    const px = Math.max(1, s);
    const w = 7 * px;
    const hh = 6 * px;
    const x0 = Math.round(x - w / 2);
    const y0 = Math.round(y - hh / 2);
    ctx.save();
    ctx.globalAlpha = alpha;
    if (night > 0.2) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,90,120,0.25)';
      ctx.fillRect(x0 - 3, y0 - 3, w + 6, hh + 6);
      ctx.globalCompositeOperation = 'source-over';
    }
    HEART_PIXELS.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const c = row[i];
        if (c === '.') continue;
        // partido: a metade da direita desce um pouco
        const dy = broken && i >= 4 ? 1 : 0;
        ctx.fillStyle = c === '2' ? '#ffd1da' : broken ? '#9a6b78' : '#ff4f6d';
        ctx.fillRect(x0 + i * px, y0 + (j + dy) * px, px, px);
      }
    });
    ctx.restore();
  }

  /** Espaço de tela: balões dos cumprimentos, o pulo do contador, os textos das placas da praça e o selo. */
  screen(ctx: CanvasRenderingContext2D, now: number, map: CityScreenMap): void {
    const r = this.o.renderer();
    // selo "não verificado" na placa e o pulo do contador de likes
    for (const v of r.buildingsDrawn) {
      const sr = signRect(v.m);
      const x0 = map.sx(v.x + sr.x);
      const y0 = map.sy(v.y + sr.y);
      const w = sr.w * map.k;
      const hh = sr.h * map.k;
      if ((v.b as { unverified?: boolean }).unverified === true && map.zoom >= 1.05 && hh >= 9) this.drawSeal(ctx, x0 - 2, y0 + hh / 2);
      const bump = this.bumps.get(v.b.id);
      if (bump !== undefined) {
        const t = (now - bump) / BUMP_MS;
        if (t >= 1) this.bumps.delete(v.b.id);
        else this.drawBump(ctx, x0 + w - 12 * map.k, y0 + hh / 2, t);
      }
    }
    // emojis que pulam (bater na porta, fim de turno)
    for (const p of this.pops) {
      const t = (now - p.at) / 1_300;
      if (t < 0 || t >= 1) continue;
      ctx.globalAlpha = t > 0.7 ? (1 - t) / 0.3 : 1;
      ctx.font = `${Math.round(14 + 6 * Math.sin(Math.min(1, t * 3) * Math.PI * 0.5))}px ${EMOJI_FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(p.text, map.sx(p.x), map.sy(p.y) - t * 18);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }
    if (map.zoom >= BOARD_TEXT_ZOOM) this.drawBoardTexts(ctx, map);
    // balões dos cumprimentos sobre as cabeças (um não cobre o outro: o de baixo empurra o de cima)
    const meId = this.o.state().me?.id;
    const placed = this.placed;
    placed.length = 0;
    const list: Array<{ x: number; y: number; id: GreetingId; age: number; me: boolean }> = [];
    for (const v of r.charsDrawn) {
      if (!v.visible) continue;
      const id = v.me ? meId : v.id;
      if (!id) continue;
      const bal = this.balloons.get(id, now);
      if (!bal) continue;
      const nameGap = map.zoom >= 0.85 ? 20 : 4;
      list.push({ x: map.sx(v.x), y: map.sy(v.headY) - nameGap, id: bal.id, age: bal.age, me: v.me });
    }
    list.sort((a, b) => b.y - a.y);
    for (const b of list) {
      const w = this.balloonWidth(ctx, b.id, map.zoom);
      let bottom = b.y;
      for (let tries = 0; tries < 6; tries++) {
        let hit = false;
        for (let j = 0; j < placed.length; j += 4) {
          if (b.x + w / 2 > placed[j]! && b.x - w / 2 < placed[j]! + placed[j + 2]! && bottom > placed[j + 1]! && bottom - 30 < placed[j + 1]! + placed[j + 3]!) {
            bottom = placed[j + 1]! - 2;
            hit = true;
          }
        }
        if (!hit) break;
      }
      placed.push(b.x - w / 2, bottom - 30, w, 30);
      this.drawBalloon(ctx, b.x, bottom, b.id, b.age, b.me, map.zoom);
    }
  }

  private readonly placed: number[] = [];

  /** Largura (px CSS) do balão de um cumprimento. */
  private balloonWidth(ctx: CanvasRenderingContext2D, id: GreetingId, zoom: number): number {
    if (zoom < 0.85) return 28;
    ctx.font = `700 11.5px ${UI_FONT}`;
    return Math.round(22 + Math.min(170, ctx.measureText(greetingLabel(id)).width) + 6 + 6);
  }

  private drawSeal(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.save();
    ctx.fillStyle = 'rgba(20,24,33,0.85)';
    ctx.strokeStyle = 'rgba(200,206,220,0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(Math.round(x), Math.round(y), 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#c8cedc';
    ctx.font = `800 9px ${UI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', Math.round(x), Math.round(y) + 0.5);
    ctx.restore();
  }

  private drawBump(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
    ctx.save();
    // anel que se abre
    ctx.globalAlpha = (1 - t) * 0.9;
    ctx.strokeStyle = '#ff7b93';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 6 + t * 16, 0, Math.PI * 2);
    ctx.stroke();
    // "+1" subindo
    ctx.globalAlpha = t < 0.8 ? 1 : (1 - t) / 0.2;
    ctx.font = `800 12px ${UI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(10,14,24,0.6)';
    ctx.fillText('+❤', x + 0.5, y - 12 - t * 16 + 1);
    ctx.fillStyle = '#ffd1da';
    ctx.fillText('+❤', x, y - 12 - t * 16);
    ctx.restore();
  }

  private drawBalloon(ctx: CanvasRenderingContext2D, cx: number, bottom: number, id: GreetingId, age: number, mine: boolean, zoom: number): void {
    const pop = Math.min(1, age / 180);
    const scale = pop < 1 ? 0.6 + 0.4 * (1 - (1 - pop) * (1 - pop)) + Math.sin(pop * Math.PI) * 0.08 : 1;
    const fadeOut = age > 4_600 ? Math.max(0, 1 - (age - 4_600) / 400) : 1;
    const icon = greetingIcon(id);
    const small = zoom < 0.85;
    const text = small ? '' : greetingLabel(id);
    ctx.save();
    ctx.globalAlpha = fadeOut;
    ctx.translate(Math.round(cx), Math.round(bottom));
    ctx.scale(scale, scale);
    ctx.font = `700 11.5px ${UI_FONT}`;
    const tw = text ? Math.min(170, ctx.measureText(text).width) : 0;
    const w = Math.round(22 + (text ? tw + 6 : 0) + 6);
    const hh = 22;
    const x = -w / 2;
    const y = -hh - 7;
    // corpo do balão
    ctx.fillStyle = 'rgba(10,14,24,0.35)';
    ctx.beginPath();
    ctx.roundRect(x + 1, y + 2, w, hh, 9);
    ctx.fill();
    ctx.fillStyle = mine ? '#e6f4ff' : '#fffaf0';
    ctx.strokeStyle = mine ? '#7cc8ff' : '#2a2f3a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, y, w, hh, 9);
    ctx.fill();
    ctx.stroke();
    // rabinho
    ctx.beginPath();
    ctx.moveTo(-5, y + hh - 1);
    ctx.lineTo(0, y + hh + 6);
    ctx.lineTo(5, y + hh - 1);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-5, y + hh);
    ctx.lineTo(0, y + hh + 6);
    ctx.lineTo(5, y + hh);
    ctx.stroke();
    ctx.fillStyle = mine ? '#e6f4ff' : '#fffaf0';
    ctx.fillRect(-4, y + hh - 2, 8, 2);
    // ícone e frase
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `14px ${EMOJI_FONT}`;
    ctx.fillText(icon, x + 6, y + hh / 2 + 1);
    if (text) {
      ctx.font = `700 11.5px ${UI_FONT}`;
      ctx.fillStyle = '#1b2030';
      let t = text;
      while (t.length > 1 && ctx.measureText(t).width > 170) t = `${t.slice(0, -2).trimEnd()}…`;
      ctx.fillText(t, x + 26, y + hh / 2 + 0.5);
    }
    ctx.restore();
  }

  /** Os textos das duas placas da praça (o termômetro e a prefeitura), nítidos, em cima do desenho delas. */
  private drawBoardTexts(ctx: CanvasRenderingContext2D, map: CityScreenMap): void {
    const rects = boardTextRects();
    const k = map.k;
    const g = this.goal(this.lastNow);
    const hall = cityHallView(this.city);
    const line = (text: string, x: number, y: number, maxW: number, size: number, color: string, weight = 700, align: CanvasTextAlign = 'left') => {
      ctx.font = `${weight} ${size.toFixed(1)}px ${UI_FONT}`;
      let t = text;
      while (t.length > 1 && ctx.measureText(t).width > maxW) t = `${t.slice(0, -2).trimEnd()}…`;
      ctx.textAlign = align;
      ctx.fillStyle = 'rgba(5,8,14,0.6)';
      ctx.fillText(t, x + 0.5, y + 1);
      ctx.fillStyle = color;
      ctx.fillText(t, x, y);
    };
    const wrap = (text: string, maxW: number, size: number, weight = 600): string[] => {
      ctx.font = `${weight} ${size.toFixed(1)}px ${UI_FONT}`;
      const out: string[] = [];
      let cur = '';
      for (const word of text.split(' ')) {
        const next = cur ? `${cur} ${word}` : word;
        if (ctx.measureText(next).width <= maxW || !cur) cur = next;
        else {
          out.push(cur);
          cur = word;
        }
      }
      if (cur) out.push(cur);
      return out;
    };
    ctx.save();
    ctx.textBaseline = 'middle';
    const small = Math.max(7, Math.min(11, 4.2 * k));
    const step = small * 1.18;
    // o termômetro: título, porcentagem grande e a meta
    {
      const r = rects.goal;
      const x = map.sx(r.x);
      const y = map.sy(r.y);
      const w = r.w * k;
      line(tr('META DA CIDADE'), x + w / 2, y + 4 * k, w - 4, Math.max(7, Math.min(11, 4.6 * k)), '#fff1e0', 800, 'center');
      const left = x + 16 * k;
      const tw = w - 19 * k;
      if (g) {
        const big = Math.max(10, Math.min(24, 9.5 * k));
        line(g.pctText, left, y + 17 * k, tw, big, g.pct >= 1 ? '#ffd166' : '#ff9c74', 800);
        let yy = y + 17 * k + big * 0.75 + step * 0.5;
        for (const l of wrap(g.label, tw, small).slice(0, 2)) {
          line(l, left, yy, tw, small, '#d6dcea', 600);
          yy += step;
        }
        line(g.progressText, left, yy, tw, small * 0.92, '#9aa4b8', 600);
      } else {
        let yy = y + 17 * k;
        for (const l of wrap(tr('A meta aparece com 10 prédios acesos.'), tw, small).slice(0, 4)) {
          line(l, left, yy, tw, small, '#9aa4b8', 600);
          yy += step;
        }
      }
    }
    // a prefeitura: título, prédios acesos e os tokens da semana
    {
      const r = rects.hall;
      const x = map.sx(r.x);
      const y = map.sy(r.y);
      const w = r.w * k;
      line(tr('PREFEITURA'), x + w / 2, y + 4 * k, w - 4, Math.max(7, Math.min(11, 4.6 * k)), '#e3f1ff', 800, 'center');
      const left = x + 23 * k;
      const tw = w - 26 * k;
      if (hall) {
        let yy = y + 15 * k;
        for (const l of wrap(hall.lit, tw, small, 700).slice(0, 2)) {
          line(l, left, yy, tw, small, '#ffd27a', 700);
          yy += step;
        }
        yy += step * 0.3;
        for (const l of wrap(hall.tokens, tw, small).slice(0, 4)) {
          line(l, left, yy, tw, small, '#d6dcea', 600);
          yy += step;
        }
      }
    }
    ctx.restore();
  }
}

// ====================================================================== extras dos cartões

/** As ações no cartão do prédio: curtir (perto da porta), bater (quem aceita), o código e o selo. */
class BuildingExtras {
  readonly el: HTMLElement;
  private readonly likeBtn: HTMLButtonElement;
  private readonly knockBtn: HTMLButtonElement;
  private readonly hint: HTMLElement;
  private readonly code: HTMLElement;
  private readonly seal: HTMLElement;
  private id = '';
  private key = '';

  constructor(private readonly s: CitySocial) {
    this.likeBtn = h('button', { class: 'ui-city-x__btn', type: 'button', on: { click: () => this.like() } });
    this.knockBtn = h('button', { class: 'ui-city-x__btn', type: 'button', on: { click: () => this.knock() } }, h('span', { text: '🚪', attrs: { 'aria-hidden': 'true' } }), ` ${tr('Bater')}`);
    this.hint = h('span', { class: 'ui-city-x__hint' });
    this.code = h('span', { class: 'ui-city-x__code', title: tr('Código do prédio: "Ir para", no minimapa, leva até a porta') });
    this.seal = h('div', { class: 'ui-city-x__seal', text: `❔ ${tr('Não verificado: os dados deste prédio estão em revisão.')}` });
    this.el = h('div', { class: 'ui-city-x' }, h('div', { class: 'ui-city-x__row' }, this.likeBtn, this.knockBtn, this.code), this.hint, this.seal);
  }

  bind(id: string): void {
    this.id = id;
    this.key = '';
    this.sync();
  }

  private building(): WorldBuildingPublic | undefined {
    return this.s.ctx.state.buildings.get(this.id);
  }

  sync(): void {
    const b = this.building();
    if (!b || !this.el.isConnected) return;
    const { me, state } = this.s.ctx;
    const a = doorActions(b, me, state.myBuildingId);
    const key = `${b.id}|${a.canLike}|${a.canKnock}|${a.liked}|${a.mine}|${b.knocks ? 1 : 0}|${b.code ?? ''}|${(b as { unverified?: boolean }).unverified ? 1 : 0}`;
    if (key === this.key) return;
    this.key = key;
    setHidden(this.likeBtn, a.mine);
    this.likeBtn.replaceChildren(h('span', { text: a.liked ? '💔' : '❤️', attrs: { 'aria-hidden': 'true' } }), ` ${a.liked ? tr('Descurtir') : tr('Curtir')}`);
    this.likeBtn.classList.toggle('is-liked', a.liked);
    this.likeBtn.disabled = !a.canLike;
    setHidden(this.knockBtn, a.mine || !b.knocks);
    this.knockBtn.disabled = !a.canKnock;
    setText(this.code, b.code ?? '');
    setHidden(this.code, !b.code);
    const hint = a.mine ? tr('Seu prédio: os likes de hoje aparecem na barra do escritório.') : !a.canLike ? tr('Chegue perto da porta para curtir (L).') : b.knocks && !a.canKnock ? tr('Mais perto da porta, dá para bater (K).') : '';
    setText(this.hint, hint);
    setHidden(this.hint, !hint);
    setHidden(this.seal, (b as { unverified?: boolean }).unverified !== true);
  }

  private like(): void {
    const b = this.building();
    if (b) this.s.act.like(b);
  }

  private knock(): void {
    const b = this.building();
    if (b) this.s.act.knock(b);
  }
}

/** As ações no cartão de um jogador: Cumprimentar, Bloquear (dois cliques) e Denunciar (motivos fixos). */
class PlayerExtras {
  readonly el: HTMLElement;
  private readonly greetBtn: HTMLButtonElement;
  private readonly blockBtn: HTMLButtonElement;
  private readonly reportBtn: HTMLButtonElement;
  private readonly reasons: HTMLElement;
  private readonly done: HTMLElement;
  private id = '';
  private confirming = false;

  constructor(private readonly s: CitySocial) {
    this.greetBtn = h('button', { class: 'ui-city-x__btn is-primary', type: 'button', on: { click: () => this.s.act.greet(this.id) } }, h('span', { text: '👋', attrs: { 'aria-hidden': 'true' } }), ` ${tr('Cumprimentar')}`, h('kbd', { text: 'G' }));
    this.blockBtn = h('button', { class: 'ui-city-x__btn is-quiet', type: 'button', on: { click: () => this.block() } });
    this.reportBtn = h('button', { class: 'ui-city-x__btn is-quiet', type: 'button', attrs: { 'aria-expanded': 'false' }, on: { click: () => this.toggleReasons() } });
    this.reasons = h(
      'div',
      { class: 'ui-city-x__reasons', hidden: true, role: 'group', attrs: { 'aria-label': tr('Motivo da denúncia') } },
      h('span', { class: 'ui-city-x__hint', text: tr('Qual o motivo?') }),
      ...REPORT_REASONS.map((r) => h('button', { class: 'ui-city-x__reason', type: 'button', text: reportLabel(r), on: { click: () => this.report(r) } })),
    );
    this.done = h('div', { class: 'ui-city-x__done', hidden: true, text: `✓ ${tr('Denúncia enviada.')}` });
    this.el = h('div', { class: 'ui-city-x' }, h('div', { class: 'ui-city-x__row' }, this.greetBtn, this.blockBtn, this.reportBtn), this.reasons, this.done);
  }

  bind(id: string): void {
    if (id !== this.id) {
      this.confirming = false;
      setHidden(this.reasons, true);
    }
    this.id = id;
    this.sync();
  }

  sync(): void {
    if (!this.el.isConnected) return;
    const reported = this.s.ctx.reported.has(this.id);
    setText(this.blockBtn, this.confirming ? `🚫 ${tr('Confirmar: bloquear')}` : `🚫 ${tr('Bloquear')}`);
    this.blockBtn.classList.toggle('is-danger', this.confirming);
    this.blockBtn.title = tr('Vocês deixam de se ver: na rua, nos prédios, nos cumprimentos e nos carimbos.');
    setText(this.reportBtn, reported ? `✓ ${tr('Denunciado')}` : `⚑ ${tr('Denunciar')}`);
    this.reportBtn.disabled = reported;
    setHidden(this.done, !reported);
    if (reported) setHidden(this.reasons, true);
  }

  private block(): void {
    if (!this.confirming) {
      this.confirming = true;
      this.sync();
      return;
    }
    this.confirming = false;
    const name = this.s.ctx.state.players.get(this.id)?.info.name ?? '';
    this.s.act.block(this.id, name);
  }

  private toggleReasons(): void {
    const open = this.reasons.hidden;
    setHidden(this.reasons, !open);
    this.reportBtn.setAttribute('aria-expanded', String(open));
  }

  private report(reason: ReportReason): void {
    if (this.s.act.report(this.id, reason)) this.sync();
  }
}
