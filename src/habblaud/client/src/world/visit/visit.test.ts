// A cena Visita sem DOM: o que a faixa e o painel mostram (model.ts), o miolo que aplica o interior e os patches
// (controller.ts), as rotas chamadas durante uma visita inteira (só /api/world/*) e o bloqueio por construção (nada
// que age da interface do escritório entra no módulo da visita).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorldSceneCommand, WorldSceneSnapshot } from '../../../../shared/world/api';
import type { WorldBuildingDetail } from '../../../../shared/world/protocol';
import { sampleBuildingDetail } from '../../../../shared/world/visit-sample';
import type { Appearance, ArtModule, RoomTheme } from '../../art/api';
import { OfficeStore, type EventSourceLike } from '../../net/store';
import { HttpWorldStream } from '../../net/world-stream';
import { DEFAULT_WORLD_OPTIONS } from '../api';
import { CityState } from '../city/state';
import { Sim } from '../sim/sim';
import { VISIT_RESYNC_GAP_MS, VisitController } from './controller';
import { agentRow, findAgent, statusText, visitBanner, visitLightOf, visitPanel } from './model';

const ID = 'o_7a8b9c0d1e2f';
const inside = (detail: WorldBuildingDetail = sampleBuildingDetail(), rev = 1) => ({ id: detail.building.id, rev, detail });

describe('model da visita', () => {
  it('faixa: de quem é, andares, agentes; discreto e apagado no lugar dos agentes; o próprio prédio', () => {
    expect(visitBanner(sampleBuildingDetail(), false)).toEqual({ title: 'Prédio de Helena', details: ['3 andares', '6 agentes'], mode: null });
    expect(visitBanner(sampleBuildingDetail('discreet'), false)).toEqual({ title: 'Prédio de Helena', details: ['3 andares', 'modo discreto'], mode: 'discreet' });
    expect(visitBanner(sampleBuildingDetail('away'), false)).toMatchObject({ details: ['3 andares', 'apagado'], mode: 'away' });
    expect(visitBanner(sampleBuildingDetail(), true).title).toBe('Seu prédio, como os outros veem');
    // um agente que venha por engano num prédio discreto não conta
    const d = sampleBuildingDetail('discreet');
    d.floors[0]!.agents = sampleBuildingDetail().floors[0]!.agents;
    expect(visitBanner(d, false).details).toEqual(['3 andares', 'modo discreto']);
  });

  it('luzes: apagado, discreto ou ao vivo', () => {
    expect(visitLightOf(sampleBuildingDetail().building)).toBe('live');
    expect(visitLightOf(sampleBuildingDetail('discreet').building)).toBe('discreet');
    expect(visitLightOf(sampleBuildingDetail('away').building)).toBe('away');
  });

  it('painel: salas com o nome fictício traduzido e agentes com nome, papel, ferramenta e status (nada de tempo)', () => {
    const p = visitPanel(sampleBuildingDetail());
    expect(p.empty).toBeNull();
    expect(p.rooms.map((r) => [r.name, r.agents.length])).toEqual([
      ['Projeto Ipê', 2],
      ['Projeto Jade', 2],
      ['Projeto Aurora', 2],
    ]);
    expect(p.rooms[0]!.agents[1]).toEqual({ id: 'world:a_2a3b4c5d', name: 'Rafael', role: 'Subagente', tool: 'Claude Code', status: 'working', statusText: 'trabalhando' });
    expect(p.rooms[1]!.agents.map((a) => [a.tool, a.statusText])).toEqual([
      ['Codex', 'esperando o dono'],
      ['Codex', 'de olho no terminal'],
    ]);
    for (const a of p.rooms.flatMap((r) => r.agents)) expect(Object.keys(a).sort()).toEqual(['id', 'name', 'role', 'status', 'statusText', 'tool']);
    expect(visitPanel(sampleBuildingDetail('discreet'))).toMatchObject({ empty: expect.stringContaining('Modo discreto') });
    expect(visitPanel(sampleBuildingDetail('away')).rooms.every((r) => r.agents.length === 0)).toBe(true);
    // status de uma versão mais nova do servidor: à toa
    expect(agentRow({ ...sampleBuildingDetail().floors[0]!.agents[0]!, status: 'dormindo' as never }).status).toBe('idle');
    expect(statusText('idle')).toBe('à toa');
  });

  it('cartão: o agente pelo id do escritório da visita, com a sala; discreto, nenhum', () => {
    expect(findAgent(sampleBuildingDetail(), 'world:a_3c4d5e6f')).toMatchObject({ name: 'Beatriz', room: 'Projeto Jade', tool: 'Codex' });
    expect(findAgent(sampleBuildingDetail(), 'world:nao_existe')).toBeNull();
    expect(findAgent(sampleBuildingDetail('discreet'), 'world:a_3c4d5e6f')).toBeNull();
  });
});

function controller(detail = sampleBuildingDetail(), rev = 1) {
  const clock = { t: 1_790_000_000_000 };
  const pushed: unknown[] = [];
  const sent: WorldSceneCommand[] = [];
  const c = new VisitController(inside(detail, rev), { push: (s) => pushed.push(s), send: (cmds) => sent.push(...cmds), now: () => clock.t, version: '0.11.0' });
  return { c, clock, pushed, sent };
}

describe('VisitController', () => {
  it('publica o escritório do interior ao entrar; o patch seguinte aplica, o repetido e o velho não', () => {
    const { c, pushed } = controller();
    expect(pushed).toHaveLength(1);
    expect(c.snapshot.agents).toHaveLength(6);
    expect(c.snapshot.meta.version).toBe('0.11.0');
    const floors = sampleBuildingDetail().floors;
    floors[1]!.agents[0]!.status = 'working';
    expect(c.patch({ rev: 2, floors })).toBe('apply');
    expect(c.snapshot.agents.find((a) => a.name === 'Beatriz')?.status).toBe('working');
    expect(pushed).toHaveLength(2);
    expect(c.patch({ rev: 2, visitors: 9 })).toBe('stale');
    expect(c.patch({ rev: 1, visitors: 9 })).toBe('stale');
    expect(c.detail.visitors).toBe(1);
    // só visitantes: não muda o escritório (nada publicado), mas a contagem sim
    expect(c.patch({ rev: 3, visitors: 4 })).toBe('apply');
    expect(c.detail.visitors).toBe(4);
    expect(pushed).toHaveLength(2);
  });

  it('o prédio ficou discreto (só `building` no patch): salas vazias; as luzes seguem o prédio', () => {
    const { c } = controller();
    expect(c.light).toBe('live');
    expect(c.patch({ rev: 2, building: sampleBuildingDetail('discreet').building })).toBe('apply');
    expect(c.snapshot.agents).toHaveLength(0);
    expect(c.light).toBe('discreet');
    // os andares chegam depois, ainda discreto: o `building` atual (o 4º argumento) esconde os agentes
    expect(c.patch({ rev: 3, floors: sampleBuildingDetail().floors })).toBe('apply');
    expect(c.snapshot.agents).toHaveLength(0);
    expect(c.patch({ rev: 4, building: sampleBuildingDetail('away').building })).toBe('apply');
    expect(c.light).toBe('away');
  });

  it('salto no rev: pede resync {building} (no máximo um a cada 5 s); o interior inteiro substitui tudo, como patch', () => {
    const { c, clock, sent } = controller();
    const marina = () => c.snapshot.agents.find((a) => a.name === 'Marina')!;
    const since = marina().statusSince;
    expect(c.patch({ rev: 5, visitors: 2 })).toBe('resync');
    expect(c.patch({ rev: 6, visitors: 2 })).toBe('resync');
    expect(sent).toEqual([{ t: 'resync', building: ID }]);
    clock.t += VISIT_RESYNC_GAP_MS;
    c.patch({ rev: 7, visitors: 2 });
    expect(sent).toHaveLength(2);
    clock.t += 1000;
    const d = sampleBuildingDetail();
    d.floors[1]!.agents[0]!.status = 'working';
    c.replace({ rev: 7, detail: d });
    expect(c.rev).toBe(7);
    // quem continua no mesmo status não se mexe (o statusSince fica); quem mudou recomeça
    expect(marina().statusSince).toBe(since);
    expect(c.snapshot.agents.find((a) => a.name === 'Beatriz')).toMatchObject({ status: 'working', statusSince: clock.t });
    expect(c.patch({ rev: 8, visitors: 1 })).toBe('apply');
  });

  it('sair: um leave só, e nada de move nem view', () => {
    const { c, sent } = controller();
    expect(c.leave()).toBe(true);
    expect(c.leave()).toBe(false);
    expect(sent).toEqual([{ t: 'leave' }]);
  });
});

// ------------------------------------------------------------------------------------------------ rotas

class FakeES implements EventSourceLike {
  readyState = 1;
  private readonly l = new Map<string, Array<(ev: Event) => void>>();
  constructor(readonly url: string) {}
  addEventListener(type: string, cb: (ev: Event) => void): void {
    if (!this.l.has(type)) this.l.set(type, []);
    this.l.get(type)!.push(cb);
  }
  close(): void {
    this.readyState = 2;
  }
  emit(type: string, data: unknown): void {
    for (const cb of this.l.get(type) ?? []) cb({ data: JSON.stringify(data) } as unknown as Event);
  }
}

const appearance: Appearance = {
  skin: '#f0c8a0', hair: '#3a2a20', hairStyle: 'short', eyes: '#222', top: '#3f7fd8', topAccent: '#fff', topStyle: 'tshirt',
  bottom: '#333', shoes: '#111', accessory: 'none', accessoryColor: '#000', lanyard: null, look: 'm',
};
const theme: RoomTheme = { carpet: '#4f6d8f', carpet2: '#486685', wall: { base: '#e6e2da', trim: '#9a8f80', pattern: 'plain' }, accent: '#3f7fd8', deskVariant: 'wood', chairVariant: 'black' };
const art = { appearanceFromSeed: () => appearance, roomTheme: () => theme } as unknown as ArtModule;

describe('rotas durante a visita', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uma visita inteira (entrar, patches, andar, sair) só fala com /api/world/* (nada de terminal, mensagens, permissões...)', async () => {
    const urls: string[] = [];
    // qualquer fetch fora do stream (store, mundo, interface) também é registrado
    vi.stubGlobal('fetch', (input: unknown) => {
      urls.push(`global:${String(input)}`);
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    let es: FakeES | null = null;
    const timers: Array<() => void> = [];
    const stream = new HttpWorldStream({
      eventSource: (url) => {
        urls.push(url);
        return (es = new FakeES(url));
      },
      fetch: ((input: string, init?: RequestInit) => {
        urls.push(`${init?.method ?? 'GET'} ${input} ${String(init?.body ?? '')}`);
        return Promise.resolve(new Response('{}', { status: 200 }));
      }) as typeof fetch,
      setTimeout: (cb) => timers.push(cb),
      clearTimeout: () => undefined,
    });
    const flush = async () => {
      while (timers.length) {
        timers.shift()!();
        await Promise.resolve();
        await Promise.resolve();
      }
    };
    const city = new CityState();
    const store = new OfficeStore({ search: '' });
    const sim = new Sim(art, () => ({ ...DEFAULT_WORLD_OPTIONS }), null, { visit: true });
    let now = 1_790_000_000_000;
    store.on('snapshot', (s) => sim.applySnapshot(s, now));
    let visit: VisitController | null = null;
    stream.on((ev) => {
      if (ev.type === 'snapshot') city.applySnapshot(ev.snapshot, now);
      if (ev.type !== 'message') return;
      const eff = city.apply(ev.msg, now);
      if (eff?.type === 'building') visit = new VisitController(eff.inside, { push: (s) => store.pushReplay(s), send: (c) => stream.send(c), now: () => now, version: 't' });
      if (eff?.type === 'building.patch') visit?.patch(eff.msg);
      if (eff?.type === 'pos') visit = null;
    });
    const snap: WorldSceneSnapshot = { stream: 's1', connected: true, viewing: true, afk: false, chunks: [], players: [], minimap: null, pos: { x: 40, y: 13, dir: 's', moving: false } };
    es!.emit('world.snapshot', snap);
    stream.send([{ t: 'enter', buildingId: ID }]);
    await flush();
    es!.emit('world', { t: 'building', rev: 1, detail: sampleBuildingDetail() });
    expect(visit).not.toBeNull();
    sim.setVisitor({ ...sim.chars.values().next().value!.info, id: 'visita:eu' }, now);
    for (let i = 0; i < 300; i++) {
      now += 33;
      sim.visitorIntent = { dx: i < 150 ? 1 : 0, dy: i < 150 ? 0 : 1, run: false };
      sim.update(1 / 30, now);
    }
    const floors = sampleBuildingDetail().floors;
    floors[0]!.agents[0]!.status = 'waiting';
    es!.emit('world', { t: 'building.patch', rev: 2, floors });
    es!.emit('world', { t: 'building.patch', rev: 4, visitors: 3 });
    await flush();
    visit!.leave();
    await flush();
    es!.emit('world', { t: 'pos', x: 40, y: 13 });
    expect(visit).toBeNull();
    expect(store.snapshot?.agents.find((a) => a.name === 'Marina')?.status).toBe('waiting');
    // nenhuma rota fora de /api/world/*, nenhum move lá dentro e nenhum view
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u, u).toMatch(/^(GET |POST )?\/api\/world\/(stream|cmd)\b/);
    const sentCmds = urls.filter((u) => u.startsWith('POST')).flatMap((u) => (JSON.parse(u.slice(u.indexOf('{'))) as { cmds: WorldSceneCommand[] }).cmds);
    expect(sentCmds.map((c) => c.t)).toEqual(['enter', 'resync', 'leave']);
    expect(sentCmds[1]).toEqual({ t: 'resync', building: ID });
    stream.close();
  });
});

// ------------------------------------------------------------------------------------------------ por construção

/** Junta um caminho relativo a uma pasta (posix, sem node:path). */
function join(dir: string, rel: string): string {
  const parts = dir ? dir.split('/') : [];
  for (const seg of rel.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

/** O código de todos os arquivos do cliente (chave: o caminho a partir de client/src; o Vite dá relativo a esta pasta). */
const SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob('../../**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>).map(([k, v]) => [join('world/visit', k), v]),
);

/** Os arquivos do cliente que um módulo importa, recursivamente (pelos caminhos relativos; o resto fica de fora). */
function importGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const dir = file.split('/').slice(0, -1).join('/');
    for (const m of (SOURCES[file] ?? '').matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+'(\.{1,2}\/[^']+)'/gm)) {
      const base = join(dir, m[1]!);
      const hit = [`${base}.ts`, `${base}/index.ts`].find((f) => f in SOURCES);
      if (hit) visit(hit);
    }
  };
  visit(entry);
  return seen;
}

describe('bloqueio por construção', () => {
  it('a cena Visita não importa nada da interface do escritório além do DOM básico (nem terminal, gaveta, feed, permissões, mensagens...)', () => {
    expect(Object.keys(SOURCES)).toContain('world/visit/index.ts');
    const files = importGraph('world/visit/index.ts');
    expect(files.has('world/index.ts')).toBe(true);
    const ui = [...files].filter((f) => f.startsWith('ui/'));
    expect(ui).toEqual(['ui/dom.ts']);
    // e, da rede, só o store (que nunca conecta): nem o cliente das rotas do World (net/world.ts) nem o stream
    expect([...files].filter((f) => f.startsWith('net/')).sort()).toEqual(['net/store.ts']);
  });
});
