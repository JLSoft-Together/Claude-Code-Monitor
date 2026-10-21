// Estado da cidade no navegador (puro): prédios por chunk e por lote, jogadores visíveis com as amostras de posição,
// minimapa e eu. Começa do `world.snapshot` do servidor local (net/world-stream.ts, evento `snapshot`) e consome as
// mensagens do servidor do mundo como vieram (evento `message`; o servidor local já conferiu o `rev` dos patches);
// devolve os efeitos que a cena precisa tratar (correção de posição, ausente, perfil, aviso). As regras são as de
// shared/world/scene.ts: `area` substitui o chunk; item de `area.patch` com `lot` substitui o prédio e sem `lot` mescla;
// ficam só os chunks dos 3×3 em volta da minha posição (o servidor não avisa quando deixa de assinar).
import type { WorldSceneInside, WorldSceneMe, WorldSceneSnapshot } from '../../../../shared/world/api';
import { blockAt, chunkId, chunkOf, chunksAround, parseChunkId } from '../../../../shared/world/city';
import type { BuildingPatchMessage, WorldBuildingDetail, WorldBuildingPublic, WorldPlayerPublic, WorldPosition } from '../../../../shared/world/protocol';
import { lotKey } from './layout';
import { pushSample, type Sample } from './players';

export interface RemotePlayer {
  info: WorldPlayerPublic;
  samples: Sample[];
  /** Atraso (ms) com que este jogador é desenhado agora (players.ts, `interpDelay`); sobe e desce devagar. */
  delay?: number;
}

export type CityEffect =
  | { type: 'pos'; x: number; y: number }
  | { type: 'afk' }
  | { type: 'profile'; player: WorldPlayerPublic }
  | { type: 'notice'; level: 'info' | 'warn' | 'error'; text: string }
  /** Fase 4: o interior do prédio onde entrei (ao entrar, num `resync` ou num `enter` repetido). */
  | { type: 'building'; inside: WorldSceneInside }
  /** Fase 4: mudança no interior (o servidor local já conferiu o `rev`; a cena Visita confere de novo). */
  | { type: 'building.patch'; msg: BuildingPatchMessage };

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function isBuilding(v: unknown): v is WorldBuildingPublic {
  return isObject(v) && typeof v.id === 'string' && isObject(v.lot) && finite(v.lot.x) && finite(v.lot.y) && isObject(v.owner) && typeof v.owner.name === 'string';
}

export function isPlayer(v: unknown): v is WorldPlayerPublic {
  return isObject(v) && typeof v.id === 'string' && typeof v.name === 'string' && isObject(v.pos) && finite(v.pos.x) && finite(v.pos.y);
}

function readPosition(v: unknown): WorldPosition | null {
  if (!isObject(v) || !finite(v.x) || !finite(v.y)) return null;
  const dir = v.dir === 'n' || v.dir === 's' || v.dir === 'e' || v.dir === 'w' ? v.dir : 's';
  return { x: v.x, y: v.y, dir, moving: v.moving === true };
}

function isInside(v: unknown): v is WorldSceneInside {
  return isObject(v) && typeof v.id === 'string' && finite(v.rev) && isObject(v.detail) && isBuilding(v.detail.building) && Array.isArray(v.detail.floors);
}

const isBlock = (b: unknown): b is { x: number; y: number; lit: number } => isObject(b) && finite(b.x) && finite(b.y) && finite(b.lit);

export class CityState {
  me: WorldSceneMe | null = null;
  /** Posição validada que veio no snapshot ou num `pos` antes de a cena me pôr na rua (consumida uma vez). */
  startPos: { x: number; y: number } | null = null;
  myBuildingId: string | null = null;
  /** O servidor local está ligado ao servidor do mundo (sem isso, nada desce). */
  connected = false;
  /** O servidor do mundo já mandou `afk` e ninguém mexeu desde então. */
  afk = false;
  /** Dentro de um prédio, segundo o último snapshot do servidor local (um stream novo no meio da visita). */
  inside: WorldSceneInside | null = null;
  /** Distrito dos ids de chunk (`<distrito>:<cx>,<cy>`). */
  district: string | undefined;
  readonly buildings = new Map<string, WorldBuildingPublic>();
  private readonly lots = new Map<string, string>();
  private readonly chunkIds = new Map<string, Set<string>>();
  readonly chunkRev = new Map<string, number>();
  readonly players = new Map<string, RemotePlayer>();
  minimap: Array<{ x: number; y: number; lit: number }> = [];
  /** Sobe quando algum prédio muda (caches de quem desenha). */
  version = 0;
  minimapVersion = 0;

  /** O prédio do lote, se houver. */
  buildingAt(lot: { x: number; y: number }): WorldBuildingPublic | undefined {
    const id = this.lots.get(lotKey(lot));
    return id ? this.buildings.get(id) : undefined;
  }

  myBuilding(): WorldBuildingPublic | undefined {
    return this.myBuildingId ? this.buildings.get(this.myBuildingId) : undefined;
  }

  /** O `world.snapshot`: troca o estado inteiro (prédios, jogadores, minimapa) pelo do servidor local. */
  applySnapshot(snap: WorldSceneSnapshot, now: number): void {
    this.buildings.clear();
    this.lots.clear();
    this.chunkIds.clear();
    this.chunkRev.clear();
    this.players.clear();
    this.connected = snap.connected !== false;
    this.afk = snap.afk === true;
    this.inside = isInside(snap.inside) ? structuredClone(snap.inside) : null;
    this.district = typeof snap.district === 'string' ? snap.district : undefined;
    if (snap.me) {
      this.me = snap.me;
      // O id do prédio é o id opaco do dono (protocolo): sem `buildingId` no `welcome` (o prédio nasceu da primeira
      // remessa, depois dele), o meu prédio é o que tem o meu id.
      this.myBuildingId = snap.me.buildingId ?? snap.me.id;
    }
    const pos = readPosition(snap.pos);
    if (pos) this.startPos = { x: pos.x, y: pos.y };
    for (const a of Array.isArray(snap.chunks) ? snap.chunks : []) {
      if (isObject(a) && typeof a.chunk === 'string' && Array.isArray(a.buildings)) this.applyArea(a.chunk, finite(a.rev) ? a.rev : 0, a.buildings.filter(isBuilding));
    }
    for (const p of Array.isArray(snap.players) ? snap.players : []) if (isPlayer(p)) this.join(p, now);
    this.minimap = [];
    if (Array.isArray(snap.minimap)) this.setMinimap(snap.minimap.filter(isBlock));
    this.minimapVersion++;
    this.version++;
  }

  /** Uma mensagem do servidor do mundo; devolve o efeito para a cena, se houver. */
  apply(msg: unknown, now: number): CityEffect | null {
    if (!isObject(msg) || typeof msg.t !== 'string') return null;
    switch (msg.t) {
      case 'area':
        if (typeof msg.chunk === 'string' && Array.isArray(msg.buildings)) {
          this.applyArea(msg.chunk, finite(msg.rev) ? msg.rev : 0, msg.buildings.filter(isBuilding));
          this.version++;
        }
        return null;
      case 'area.patch':
        if (typeof msg.chunk === 'string') this.applyPatch(msg.chunk, msg);
        return null;
      case 'players':
        if (Array.isArray(msg.players)) {
          for (const p of msg.players) {
            if (!isObject(p) || typeof p.id !== 'string' || p.id === this.me?.id) continue;
            const rp = this.players.get(p.id);
            const pos = readPosition(p.pos);
            if (!rp || !pos) continue;
            rp.info.pos = pos;
            if (isObject(p.greeting)) rp.info.greeting = p.greeting as WorldPlayerPublic['greeting'];
            pushSample(rp.samples, { t: now, ...pos });
          }
        }
        return null;
      case 'player.join':
        if (isPlayer(msg.player)) this.join(msg.player, now);
        return null;
      case 'player.leave':
        if (typeof msg.id === 'string') this.players.delete(msg.id);
        return null;
      case 'profile':
        if (isPlayer(msg.player)) {
          const rp = this.players.get(msg.player.id);
          if (rp) rp.info = { ...rp.info, ...msg.player, pos: rp.info.pos };
          return { type: 'profile', player: msg.player };
        }
        return null;
      case 'minimap':
        if (Array.isArray(msg.blocks)) {
          this.setMinimap(msg.blocks.filter(isBlock));
          this.minimapVersion++;
        }
        return null;
      case 'like.update': {
        const b = typeof msg.buildingId === 'string' ? this.buildings.get(msg.buildingId) : undefined;
        if (b && finite(msg.likes)) {
          b.likes = msg.likes;
          b.likedByMe = msg.likedByMe === true;
          this.version++;
        }
        return null;
      }
      case 'pos':
        if (finite(msg.x) && finite(msg.y)) return { type: 'pos', x: msg.x, y: msg.y };
        return null;
      case 'afk':
        this.afk = true;
        return { type: 'afk' };
      case 'notice':
        if (typeof msg.text === 'string') return { type: 'notice', level: msg.level === 'warn' || msg.level === 'error' ? msg.level : 'info', text: msg.text };
        return null;
      case 'building': {
        const d = msg.detail;
        if (!finite(msg.rev) || !isObject(d) || !isBuilding(d.building) || !Array.isArray(d.floors)) return null;
        return { type: 'building', inside: { id: d.building.id, rev: msg.rev, detail: { building: d.building, floors: d.floors, visitors: finite(d.visitors) ? d.visitors : 0 } as WorldBuildingDetail } };
      }
      case 'building.patch':
        if (!finite(msg.rev)) return null;
        return { type: 'building.patch', msg: msg as unknown as BuildingPatchMessage };
      default:
        return null;
    }
  }

  /**
   * Ficam só os chunks dos 3×3 em volta de (x, y) tiles (os que o servidor assina); o resto sai, com os prédios. A cena
   * chama ao trocar de chunk. Devolve se tirou algum.
   */
  keepAround(x: number, y: number): boolean {
    let district = this.district;
    if (district === undefined) {
      for (const id of this.chunkIds.keys()) {
        district = parseChunkId(id)?.district;
        if (district !== undefined) break;
      }
    }
    if (district === undefined) return false;
    const d = district;
    const keep = new Set(chunksAround(chunkOf(blockAt(x, y))).map((c) => chunkId(d, c)));
    let removed = false;
    for (const [chunk, ids] of [...this.chunkIds]) {
      if (keep.has(chunk)) continue;
      for (const id of ids) this.removeBuilding(id);
      this.chunkIds.delete(chunk);
      this.chunkRev.delete(chunk);
      removed = true;
    }
    if (removed) this.version++;
    return removed;
  }

  private join(p: WorldPlayerPublic, now: number): void {
    if (p.id === this.me?.id) return;
    const prev = this.players.get(p.id);
    const samples = prev?.samples ?? [];
    pushSample(samples, { t: now, ...readPosition(p.pos)! });
    this.players.set(p.id, { info: { ...p }, samples, ...(prev?.delay !== undefined ? { delay: prev.delay } : {}) });
  }

  private setMinimap(blocks: Array<{ x: number; y: number; lit: number }>): void {
    this.minimap = blocks.map((b) => ({ x: Math.floor(b.x), y: Math.floor(b.y), lit: Math.max(0, Math.floor(b.lit)) }));
  }

  private putBuilding(b: WorldBuildingPublic, chunk: string): void {
    const prev = this.buildings.get(b.id);
    if (prev && lotKey(prev.lot) !== lotKey(b.lot) && this.lots.get(lotKey(prev.lot)) === b.id) this.lots.delete(lotKey(prev.lot));
    this.buildings.set(b.id, b);
    this.lots.set(lotKey(b.lot), b.id);
    for (const [c, set] of this.chunkIds) if (c !== chunk) set.delete(b.id);
    let set = this.chunkIds.get(chunk);
    if (!set) this.chunkIds.set(chunk, (set = new Set()));
    set.add(b.id);
  }

  private removeBuilding(id: string): void {
    const b = this.buildings.get(id);
    if (!b) return;
    if (this.lots.get(lotKey(b.lot)) === id) this.lots.delete(lotKey(b.lot));
    this.buildings.delete(id);
    for (const set of this.chunkIds.values()) set.delete(id);
  }

  /** `area`: o conteúdo inteiro do chunk e o `rev` (mesmo menor): quem saiu da lista sai da cidade. */
  private applyArea(chunk: string, rev: number, list: WorldBuildingPublic[]): void {
    const keep = new Set(list.map((b) => b.id));
    for (const id of this.chunkIds.get(chunk) ?? []) if (!keep.has(id)) this.removeBuilding(id);
    this.chunkIds.set(chunk, new Set());
    this.chunkRev.set(chunk, rev);
    for (const b of list) this.putBuilding({ ...b }, chunk);
  }

  /**
   * `area.patch`: item com `lot` é o prédio inteiro e substitui o que havia (prédio novo, ou um campo opcional que sumiu,
   * como `agents` no modo discreto); sem `lot`, só os campos que mudaram, mesclados; `removed` (ids) tira prédios.
   */
  private applyPatch(chunk: string, msg: Record<string, unknown>): void {
    if (finite(msg.rev)) this.chunkRev.set(chunk, msg.rev);
    for (const c of Array.isArray(msg.changes) ? msg.changes : []) {
      if (!isObject(c) || typeof c.id !== 'string') continue;
      if (c.lot !== undefined) {
        if (isBuilding(c)) this.putBuilding({ ...c }, chunk);
        continue;
      }
      const cur = this.buildings.get(c.id);
      if (cur) this.putBuilding({ ...cur, ...(c as Partial<WorldBuildingPublic>) } as WorldBuildingPublic, chunk);
    }
    if (Array.isArray(msg.removed)) for (const id of msg.removed) if (typeof id === 'string') this.removeBuilding(id);
    this.version++;
  }
}
