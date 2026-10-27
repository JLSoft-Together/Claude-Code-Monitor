// Mundo do escritório: liga a simulação (sim/), o desenho (render/), a câmera e a entrada,
// e implementa o contrato WorldApi consumido pela UI.
import * as artModule from '../art';
import { TILE, type ArtModule } from '../art/api';
import type { OfficeStore } from '../net/store';
import { DEFAULT_WORLD_OPTIONS, seasonalThemeFor, type Selection, type SocialEvent, type SoundCue, type WorldApi, type WorldOptions, type WorldPlayback } from './api';
import { loadWorldAssets, type WorldAssets } from './assets';
import { Camera, overviewFrame } from './camera';
import { createDebug, type WorldDebug } from './debug';
import { BUILDING_H, COL_W, ZOOM_MAX } from './constants';
import { RECEPTION_ID } from './layout/core';
import { inRect } from './layout/geometry';
import { attachInput, type Hit } from './input';
import type { AgentInfo } from '../../../shared/types';
import { rebaseSnapshot } from './playback';
import { Overlay, type OverlayTextStyle } from './render/overlay';
import { Renderer } from './render/renderer';
import { Sim, type VisitLight } from './sim/sim';
import { NO_INTENT, VISITOR_ID, visitorInfo, type VisitorIntent } from './sim/visitor';
import { SoundCues } from './sound-cues';
import type { Projection, RendererFactory, WorldRenderer } from './projection';

export * from './api';
export type { WorldDebug } from './debug';
export type { Projection, RendererFactory, ViewPoint, ViewRect, WorldRenderer } from './projection';
export type { OverlayTextStyle } from './render/overlay';

const art: ArtModule = artModule;

/** O que a cena Visita usa do mundo dela (createWorld com `visit: true`). */
export interface VisitWorld {
  /** O meu personagem entra pelo elevador (null tira). */
  setVisitor(me: { name: string; look: 'f' | 'm'; parts?: AgentInfo['parts'] } | null): void;
  /** O teclado: para onde o visitante anda. */
  setIntent(intent: VisitorIntent): void;
  /** Luzes do prédio (apagado, discreto, ao vivo). */
  setLight(mode: VisitLight): void;
  /** Perto de um elevador, livre para sair? */
  atExit(): boolean;
  /** Anda até o elevador mais perto, entra e some; `done` quando a porta fecha. */
  exit(done: () => void): boolean;
  /** Posição do visitante na tela (px CSS), para a dica "Sair (E)"; null fora da tela ou sem visitante. */
  visitorScreen(): { x: number; y: number } | null;
  /** O quadro da parede da recepção na tela (px CSS): o lugar do quadro de carimbos da portaria; null fora da tela. */
  boardScreen(): { x: number; y: number; w: number; h: number } | null;
}

export interface CreateWorldOptions {
  /**
   * Visita a um prédio do mundo (cena Visita): `Sim` sem nada que dependa do tempo do status (SimMode.visit), o
   * visitante andando com o teclado e o clique (a câmera o segue) e as carteiras da vida social na chave `world:`.
   */
  visit?: boolean;
  assetPack?: string;
  projection?: Projection;
  renderer?: RendererFactory;
  maxZoom?: (view: { w: number; h: number }) => number;
  text?: OverlayTextStyle;
  warmUpMs?: number;
  assets?: WorldAssets | null;
}

const IDLE_FRAME_MS = 1000 / 30 - 4;
const FULL_RATE_HOLD_MS = 300;

export function createWorld(canvas: HTMLCanvasElement, store: OfficeStore, o: CreateWorldOptions = {}): WorldApi & { debug: WorldDebug; visit: VisitWorld } {
  let options: WorldOptions = { ...DEFAULT_WORLD_OPTIONS };
  const visitMode = !!o.visit;
  const camera = new Camera();
  const proj = o.projection;
  const makeRenderer = (): WorldRenderer => (o.renderer ? o.renderer(canvas, art, sim, camera) : new Renderer(canvas, art, sim, camera));
  // Simulação e desenho são recriados quando o timelapse entra, pula ou sai (rebuild).
  let sim = new Sim(art, () => options, undefined, { visit: visitMode });
  let renderer = makeRenderer();
  if (o.warmUpMs && o.warmUpMs > 0) renderer.warmUp?.(o.warmUpMs);
  let overlay = new Overlay(renderer.ctx, sim, renderer, camera, proj, o.text);
  let assets: WorldAssets | null = o.assets ?? null;
  if (assets) renderer.setAssets(assets);
  const readyCbs = new Set<() => void>();
  let ready = false;
  /** Timelapse ligado: relógio próprio do mundo (`worldNow`), acelerado pelo fator de animação. */
  let playback: WorldPlayback | null = null;
  let worldNow = 0;
  const selectCbs = new Set<(s: Selection) => void>();
  const hoverCbs = new Set<(id: string | null) => void>();
  const socialCbs = new Set<(e: SocialEvent) => void>();
  const soundCbs = new Set<(c: SoundCue) => void>();
  const roomMenuCbs = new Set<(roomId: string, at: { x: number; y: number }) => void>();
  let cues = new SoundCues(sim, camera, undefined, proj);
  let selection: Selection = null;
  let hover: string | null = null;
  let mouse: { x: number; y: number } | null = null;
  let raf = 0;
  let lastTs = 0;
  let hiddenAt = 0;
  /** Escritório fora da tela (cidade aberta): sem laço de desenho nem teclado da câmera. */
  let suspended = false;
  let suspendedAt = 0;
  let userMoved = false;
  let framed = false;
  let overviewFill = false;
  let lastCols = -1;
  const abort = new AbortController();
  // Orrery local patch K: reading clientWidth every frame forced a layout of the whole app per frame.
  let sizeDirty = false;
  const sizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => (sizeDirty = true));
  // Orrery local patch L: an idle office draws at ~30 fps; camera motion gets every frame for a moment.
  const drawnCam = { x: NaN, y: NaN, zoom: NaN };
  let fullRateUntil = 0;

  // ------------------------------------------------------------------ tamanho/DPR

  const resize = () => {
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const pw = Math.floor(w * dpr);
    const ph = Math.floor(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    camera.setView(w, h, dpr);
    updateBounds();
  };

  const buildingRect = () => {
    const r = { x: 0, y: 0, w: sim.building.cols * COL_W * TILE, h: BUILDING_H * TILE };
    return proj ? proj.bounds(r, 3 * TILE) : r;
  };

  const updateBounds = () => {
    const b = buildingRect();
    camera.bounds = { x: b.x - 7 * TILE, y: b.y - 6 * TILE, w: b.w + 14 * TILE, h: b.h + 18 * TILE };
    const fit = camera.fitZoom(b, 16);
    camera.minZoom = Math.min(1, Math.max(0.25, fit));
    if (o.maxZoom) {
      camera.maxZoom = Math.max(camera.minZoom, Math.min(ZOOM_MAX, o.maxZoom({ w: camera.viewW, h: camera.viewH })));
      if (camera.zoom > camera.maxZoom) camera.zoom = camera.maxZoom;
    }
    camera.clamp();
  };

  const overviewTarget = () => {
    const f = overviewFrame(buildingRect(), camera.viewW, camera.viewH, camera.insets);
    const fit = Math.max(camera.minZoom, f.zoom);
    const snapped = camera.snapZoom(fit, 'down');
    const zoom = snapped >= fit * 0.82 ? snapped : fit;
    const z = Math.min(zoom, overviewFill ? camera.maxZoom : 4);
    const c = camera.centerFor(f.cx, f.cy, z);
    // as margens de tela (pílulas acima, meio-fio abaixo) não são simétricas
    return { x: c.x, y: c.y - f.dy / z, zoom: z };
  };

  const overview = (animate = true) => {
    camera.follow = null;
    const o = overviewTarget();
    if (animate) camera.animateTo(o.x, o.y, o.zoom, Date.now(), 420);
    else {
      camera.stop();
      camera.x = o.x;
      camera.y = o.y;
      camera.zoom = o.zoom;
      camera.clamp();
    }
  };

  // ------------------------------------------------------------------ seleção e foco

  const emitSelect = () => selectCbs.forEach((cb) => cb(selection));

  const sameSelection = (a: Selection, b: Selection) => a === b || (!!a && !!b && a.type === b.type && a.id === b.id);

  const setSelection = (sel: Selection, focus = false) => {
    const same = sameSelection(sel, selection);
    selection = sel;
    // com "seguir selecionado" ligado, a câmera acompanha o agente escolhido (ou para de seguir)
    if (options.followSelected) camera.follow = sel?.type === 'agent' ? sel.id : null;
    if (focus && sel) {
      if (sel.type === 'agent') focusAgent(sel.id, { follow: options.followSelected });
      else focusRoom(sel.id);
    }
    if (!same) emitSelect();
  };

  const personTarget = (ch: { x: number; y: number }) => {
    if (!proj) return { x: ch.x, y: ch.y - 12 };
    const p = proj.toView(ch.x, ch.y);
    return { x: p.x, y: p.y - 12 };
  };

  const focusAgent = (id: string, opts: { follow?: boolean } = {}) => {
    const ch = sim.person(id);
    if (!ch) return;
    userMoved = true;
    const zoom = Math.max(camera.zoom, camera.snapZoom(3));
    const pt = personTarget(ch);
    const c = camera.centerFor(pt.x, pt.y, zoom);
    camera.animateTo(c.x, c.y, zoom, Date.now(), 420);
    camera.follow = opts.follow ? id : null;
  };

  const focusRoom = (id: string) => {
    const room = sim.rooms.get(id);
    if (!room) return;
    userMoved = true;
    camera.follow = null;
    const r = room.layout.rect;
    const rect = proj ? proj.bounds({ x: r.x * TILE, y: r.y * TILE, w: r.w * TILE, h: r.h * TILE }, 3 * TILE) : { x: r.x * TILE, y: r.y * TILE - 8, w: r.w * TILE, h: r.h * TILE + 16 };
    const fit = camera.fitZoom(rect, 40);
    const zoom = Math.min(4, Math.max(camera.minZoom, camera.snapZoom(fit, 'down')));
    const c = camera.centerFor(rect.x + rect.w / 2, rect.y + rect.h / 2, zoom);
    camera.animateTo(c.x, c.y, zoom, Date.now(), 420);
  };

  const zoomStep = (steps: number, sx = camera.viewW / 2, sy = camera.viewH / 2) => {
    userMoved = true;
    camera.zoomAt(camera.stepZoom(steps), sx, sy, Date.now(), true);
  };

  // ------------------------------------------------------------------ hit-test

  const pick = (sx: number, sy: number): Hit => {
    const w = camera.screenToWorld(sx, sy);
    let best: string | null = null;
    let bestDepth = -Infinity;
    const slack = Math.max(1, 3 / camera.zoom);
    for (const [id, h] of renderer.heads) {
      if (!h.visible || id === VISITOR_ID) continue;
      if (w.x < h.bx - slack || w.x > h.bx + h.bw + slack || w.y < h.by - slack || w.y > h.by + h.bh + slack) continue;
      if (h.depth > bestDepth) {
        bestDepth = h.depth;
        best = id;
      }
    }
    if (best) return { type: 'agent', id: best };
    const g = proj ? proj.toWorld(w.x, w.y) : w;
    const tx = Math.floor(g.x / TILE);
    const ty = Math.floor(g.y / TILE);
    for (const room of sim.rooms.values()) if (room.present && !room.ghost && inRect(room.layout.rect, tx, ty)) return { type: 'room', id: room.id };
    return null;
  };

  const setHover = (id: string | null) => {
    if (id === hover) return;
    hover = id;
    canvas.style.cursor = id ? 'pointer' : 'grab';
    hoverCbs.forEach((cb) => cb(id));
  };

  /** Visita: um toque no chão leva o visitante até lá (num agente, abre o cartão dele). */
  const visitClick = (hit: Hit, at: { x: number; y: number }) => {
    if (hit?.type === 'agent') return setSelection(hit);
    setSelection(null);
    const s = camera.screenToWorld(at.x, at.y);
    const w = proj ? proj.toWorld(s.x, s.y) : s;
    if (sim.visitorWalkTo(Math.floor(w.x / TILE), Math.floor(w.y / TILE))) followVisitor();
  };
  const followVisitor = () => {
    if (!sim.visitor) return;
    userMoved = true;
    camera.follow = VISITOR_ID;
  };

  const detachInput = attachInput(canvas, camera, {
    pick,
    click: (hit, at) => (visitMode ? visitClick(hit, at) : setSelection(hit)),
    doubleClick: (hit) => {
      if (hit?.type === 'agent') {
        setSelection(hit);
        focusAgent(hit.id, { follow: true });
      } else if (hit?.type === 'room') focusRoom(hit.id);
    },
    hover: (sx, sy, inside) => {
      mouse = inside ? { x: sx, y: sy } : null;
      if (!inside) setHover(null);
    },
    interact: () => {
      userMoved = true;
      camera.follow = null;
      camera.stop();
    },
    overview: () => overview(true),
    zoomStep,
    active: () => !suspended,
    keys: () => !visitMode,
  });

  // ------------------------------------------------------------------ dados

  const onSnapshot = () => {
    const snap = store.snapshot;
    if (!snap) return;
    try {
      // No timelapse, os horários do snapshot vão para o relógio do mundo (world/playback.ts).
      if (playback) sim.applySnapshot(rebaseSnapshot(snap, worldNow - snap.serverTime), worldNow);
      else sim.applySnapshot(snap, Date.now());
    } catch (err) {
      console.error('[mundo] snapshot inválido ignorado', err);
    }
  };
  const offSnapshot = store.on('snapshot', onSnapshot);
  if (store.snapshot) onSnapshot();

  if (o.assets === undefined)
    void loadWorldAssets(abort.signal, { pack: o.assetPack }).then((a) => {
      if (!a) return;
      assets = a;
      renderer.setAssets(a);
    });

  // medições de texto em cache: refaz quando alguma fonte termina de carregar
  if (document.fonts) document.fonts.addEventListener?.('loadingdone', () => overlay.resetCaches(), { signal: abort.signal });

  // ------------------------------------------------------------------ laço

  const loop = (ts: number) => {
    raf = requestAnimationFrame(loop);
    const camMoved = camera.x !== drawnCam.x || camera.y !== drawnCam.y || camera.zoom !== drawnCam.zoom;
    if (camMoved) fullRateUntil = ts + FULL_RATE_HOLD_MS;
    if (!camMoved && !camera.animating && !camera.follow && ts >= fullRateUntil && lastTs && ts - lastTs < IDLE_FRAME_MS) return;
    const real = Date.now();
    const realDt = lastTs ? Math.min(0.1, Math.max(0, (ts - lastTs) / 1000)) : 1 / 60;
    lastTs = ts;
    // Timelapse: simulação e desenho no relógio do mundo (acelerado ou parado); a câmera segue no tempo real.
    const k = playback ? Math.max(0, playback.scale()) : 1;
    const dt = realDt * k;
    if (playback) worldNow += dt * 1000;
    const now = playback ? worldNow : real;
    try {
      const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      if (sizeDirty || dpr !== camera.dpr || (!sizeObserver && (canvas.clientWidth !== camera.viewW || canvas.clientHeight !== camera.viewH))) {
        sizeDirty = false;
        resize();
      }
      sim.update(dt, now);
      // partidas e apostas resolvidas: para o feed (as do timelapse são encenação do passado: ficam fora)
      const events = sim.social.events;
      if (events.length) {
        if (!playback) for (const e of events) for (const cb of socialCbs) cb(e);
        events.length = 0;
      }
      renderer.sync(seasonalThemeFor(options.theme, new Date()));
      if (sim.building.cols !== lastCols) {
        lastCols = sim.building.cols;
        updateBounds();
        if (!framed && sim.initialized) {
          overview(false);
          framed = true;
        } else if (!userMoved) overview(true);
      }
      // visita: andando pelo teclado, a câmera vai junto
      if (visitMode && sim.visitor && (sim.visitorIntent.dx || sim.visitorIntent.dy) && camera.follow !== VISITOR_ID) followVisitor();
      const followCh = camera.follow ? sim.person(camera.follow) : undefined;
      if (camera.follow && !followCh) camera.follow = null;
      const followPt = followCh ? personTarget(followCh) : null;
      camera.update(real, followPt ? camera.centerFor(followPt.x, followPt.y, camera.zoom) : null, realDt);
      drawnCam.x = camera.x;
      drawnCam.y = camera.y;
      drawnCam.zoom = camera.zoom;
      renderer.frame(now, dt, options, { agent: selection?.type === 'agent' ? selection.id : null, room: selection?.type === 'room' ? selection.id : null, hover });
      overlay.draw(now, options, { agent: selection?.type === 'agent' ? selection.id : null, room: selection?.type === 'room' ? selection.id : null, hover });
      renderer.pruneHeads();
      if (!ready && (renderer.settled?.() ?? true)) {
        ready = true;
        const cbs = [...readyCbs];
        readyCbs.clear();
        for (const cb of cbs) cb();
      }
      // No timelapse o mundo fica mudo: o teclado e o elevador em alta velocidade só fariam barulho.
      if (soundCbs.size && !playback) cues.update(now, (c) => soundCbs.forEach((cb) => cb(c)));
      if (mouse) {
        const hit = pick(mouse.x, mouse.y);
        setHover(hit?.type === 'agent' ? hit.id : null);
      }
      // seleção de quem já foi embora
      if (selection?.type === 'agent' && !sim.chars.has(selection.id)) setSelection(null);
      if (selection?.type === 'room' && !sim.rooms.has(selection.id)) setSelection(null);
    } catch (err) {
      console.error('[mundo] erro no frame', err);
    }
  };

  const onVisibility = () => {
    if (suspended) return;
    if (document.hidden) {
      hiddenAt = Date.now();
      return;
    }
    lastTs = 0;
    if (hiddenAt && Date.now() - hiddenAt > 5000) sim.fastForward(playback ? worldNow : Date.now());
    hiddenAt = 0;
  };

  // Botão direito numa sala (ou num agente dentro dela): a UI oferece renomear a sala.
  const onContextMenu = (e: MouseEvent) => {
    if (!roomMenuCbs.size) return;
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const hit = pick(sx, sy);
    const sw = camera.screenToWorld(sx, sy);
    const w = proj ? proj.toWorld(sw.x, sw.y) : sw;
    const roomId =
      hit?.type === 'room'
        ? hit.id
        : hit?.type === 'agent'
          ? (sim.chars.get(hit.id)?.roomId ?? null)
          : ([...sim.rooms.values()].find((room) => room.present && !room.ghost && inRect(room.layout.rect, Math.floor(w.x / TILE), Math.floor(w.y / TILE)))?.id ?? null);
    if (!roomId || !sim.rooms.has(roomId)) return;
    e.preventDefault();
    roomMenuCbs.forEach((cb) => cb(roomId, { x: e.clientX, y: e.clientY }));
  };
  canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('resize', resize);
  sizeObserver?.observe(canvas);
  document.addEventListener('visibilitychange', onVisibility);
  resize();
  raf = requestAnimationFrame(loop);

  // ------------------------------------------------------------------ depuração

  const markMoved = () => (userMoved = true);
  let debug = createDebug(sim, renderer, camera, markMoved);

  // ------------------------------------------------------------------ timelapse

  /**
   * Recomeça simulação e desenho do zero (o próximo snapshot é a carga inicial: todos já no lugar).
   * No timelapse as carteiras ficam só em memória, sem tocar nas moedinhas guardadas no navegador.
   */
  const rebuild = () => {
    // As carteiras ao vivo gravam a cada 5 s: não perde o que mudou desde a última vez (no replay, não grava nada).
    sim.social.wallets.save(Date.now());
    sim = new Sim(art, () => options, playback ? null : undefined, { visit: visitMode });
    renderer = makeRenderer();
    if (assets) renderer.setAssets(assets);
    if (playback) {
      const p = playback;
      renderer.clock = () => p.clock();
    }
    overlay = new Overlay(renderer.ctx, sim, renderer, camera, proj, o.text);
    debug = createDebug(sim, renderer, camera, markMoved);
    cues = new SoundCues(sim, camera, undefined, proj);
    lastCols = -1;
    setHover(null);
  };

  return {
    select: (sel, opts) => setSelection(sel, !!opts?.focus),
    getSelection: () => selection,
    onSelect: (cb) => {
      selectCbs.add(cb);
      return () => void selectCbs.delete(cb);
    },
    onHover: (cb) => {
      hoverCbs.add(cb);
      return () => void hoverCbs.delete(cb);
    },
    focusAgent,
    focusRoom,
    overview: (opts) => {
      userMoved = false;
      if (opts?.fill !== undefined) overviewFill = opts.fill;
      if (opts) {
        sizeDirty = false;
        resize();
      }
      overview(true);
    },
    zoomBy: (factor) => {
      if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return;
      const target = camera.snapZoom(camera.zoom * factor, factor > 1 ? 'up' : 'down');
      if (Math.abs(target - camera.zoom) < 1e-3) zoomStep(factor > 1 ? 1 : -1);
      else {
        userMoved = true;
        camera.zoomAt(target, camera.viewW / 2, camera.viewH / 2, Date.now(), true);
      }
    },
    onReady: (cb) => {
      if (ready) {
        cb();
        return () => {};
      }
      readyCbs.add(cb);
      return () => void readyCbs.delete(cb);
    },
    getOptions: () => ({ ...options }),
    setOptions: (o) => {
      options = { ...options, ...o };
      if (o.followSelected !== undefined) camera.follow = o.followSelected && selection?.type === 'agent' ? selection.id : null;
    },
    setViewInsets: (ins) => {
      const v = (n: number | undefined, cur: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, n) : cur);
      const cur = camera.insets;
      camera.insets = { top: v(ins.top, cur.top), right: v(ins.right, cur.right), bottom: v(ins.bottom, cur.bottom), left: v(ins.left, cur.left) };
      updateBounds();
      if (!userMoved && framed) overview(true);
    },
    screenPositionOf: (id) => {
      const h = renderer.heads.get(id);
      if (!h || !h.visible) return null;
      const p = camera.worldToScreen(h.x, h.y - 2);
      if (p.x < 0 || p.y < 0 || p.x > camera.viewW || p.y > camera.viewH) return null;
      return p;
    },
    social: (id) => sim.social.info(id),
    onRoomContextMenu: (cb) => {
      roomMenuCbs.add(cb);
      return () => void roomMenuCbs.delete(cb);
    },
    onSocialEvent: (cb) => {
      socialCbs.add(cb);
      return () => void socialCbs.delete(cb);
    },
    setPlayback: (p) => {
      playback = p;
      worldNow = p ? p.clock() : 0;
      rebuild();
    },
    onSound: (cb) => {
      soundCbs.add(cb);
      return () => void soundCbs.delete(cb);
    },
    setSuspended: (on) => {
      if (on === suspended) return;
      suspended = on;
      if (on) {
        cancelAnimationFrame(raf);
        suspendedAt = Date.now();
        setHover(null);
        mouse = null;
        return;
      }
      lastTs = 0;
      if (suspendedAt && Date.now() - suspendedAt > 5000) sim.fastForward(playback ? worldNow : Date.now());
      suspendedAt = 0;
      hiddenAt = 0;
      raf = requestAnimationFrame(loop);
    },
    destroy: () => {
      cancelAnimationFrame(raf);
      abort.abort();
      offSnapshot();
      detachInput();
      window.removeEventListener('resize', resize);
      sizeObserver?.disconnect();
      canvas.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('visibilitychange', onVisibility);
      selectCbs.clear();
      readyCbs.clear();
      hoverCbs.clear();
      socialCbs.clear();
      soundCbs.clear();
    },
    get debug() {
      return debug;
    },
    visit: {
      setVisitor: (me) => {
        if (!visitMode) return;
        sim.setVisitor(me ? visitorInfo(me, Date.now()) : null, Date.now());
      },
      setIntent: (intent) => {
        sim.visitorIntent = visitMode ? { ...intent } : { ...NO_INTENT };
      },
      setLight: (mode) => {
        if (!visitMode || sim.visitLight === mode) return;
        sim.visitLight = mode;
        sim.applyVisitLight(Date.now());
      },
      atExit: () => visitMode && !!sim.visitorElevator(),
      exit: (done) => {
        if (!visitMode || !sim.visitorExit(done)) return false;
        followVisitor();
        return true;
      },
      visitorScreen: () => {
        const h = renderer.heads.get(VISITOR_ID);
        if (!h || !h.visible) return null;
        const p = camera.worldToScreen(h.x, h.y - 2);
        if (p.x < 0 || p.y < 0 || p.x > camera.viewW || p.y > camera.viewH) return null;
        return p;
      },
      boardScreen: () => {
        const r = visitMode ? renderer.paintingRect(RECEPTION_ID) : null;
        if (!r) return null;
        const a = camera.worldToScreen(r.x, r.y);
        const b = camera.worldToScreen(r.x + r.w, r.y + r.h);
        if (b.x < 0 || b.y < 0 || a.x > camera.viewW || a.y > camera.viewH) return null;
        return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
      },
    },
  };
}
