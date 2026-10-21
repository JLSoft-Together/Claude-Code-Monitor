// O viewer da cena Mundo (viewer.ts) com uma conexão de mentira e respostas em memória: `view` só com stream aberto e
// `view.off` com o último fechado, o snapshot ao conectar e a cada recomeço, o resync no salto de rev (sem repassar o
// patch), a conexão nova e a queda, os limites e o filtro dos comandos.
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import type { WorldSceneSnapshot } from '../../shared/world/api';
import type { ClientMessage } from '../../shared/world/protocol';
import { WorldViewer, type CityLink } from './viewer';
import { sampleBuildingDetail } from '../../shared/world/visit-sample';

const WELCOME = {
  t: 'welcome',
  me: { id: 'acc_me', name: 'Ana Pixel', look: 'f', parts: {}, traits: ['games', 'cafeina'], intro: 'coffee' },
  city: { districts: ['centro'] },
};

class FakeLink implements CityLink {
  connected = false;
  sent: ClientMessage[] = [];
  /** O que a cena queria a cada aviso `cityChanged` (a conexão de quem está pausado abre ou fecha com isso). */
  changes: boolean[] = [];
  viewer?: WorldViewer;
  cityChanged(): void {
    this.changes.push(!!this.viewer?.wantsCity);
  }
  sendCity(msg: ClientMessage): boolean {
    if (!this.connected) return false;
    this.sent.push(msg);
    return true;
  }
  types(): string[] {
    return this.sent.map((m) => m.t);
  }
}

interface FakeStream {
  req: IncomingMessage;
  res: ServerResponse;
  chunks: string[];
  status?: number;
  /** Eventos SSE recebidos ({event, data}). */
  events(): Array<{ event: string; data: any }>;
  snapshots(): WorldSceneSnapshot[];
  world(): any[];
  close(): void;
}

function fakeStream(): FakeStream {
  const req = new EventEmitter() as unknown as IncomingMessage;
  (req as unknown as { socket: unknown }).socket = { setTimeout() {}, setNoDelay() {} };
  const chunks: string[] = [];
  const emitter = new EventEmitter();
  const s: FakeStream = {
    req,
    chunks,
    res: Object.assign(emitter, {
      destroyed: false,
      writableEnded: false,
      writableLength: 0,
      writeHead(status: number) {
        s.status = status;
        return this;
      },
      write(chunk: string) {
        chunks.push(chunk);
        return true;
      },
      end() {
        (this as { writableEnded: boolean }).writableEnded = true;
      },
      destroy() {
        (this as { destroyed: boolean }).destroyed = true;
      },
    }) as unknown as ServerResponse,
    events: () =>
      chunks
        .filter((c) => c.startsWith('event: '))
        .map((c) => {
          const [ev, data] = c.split('\n');
          return { event: ev.slice(7), data: JSON.parse(data.slice(6)) };
        }),
    snapshots: () => s.events().filter((e) => e.event === 'world.snapshot').map((e) => e.data),
    world: () => s.events().filter((e) => e.event === 'world').map((e) => e.data),
    close: () => {
      (s.res as unknown as { destroyed: boolean }).destroyed = true;
      (req as unknown as EventEmitter).emit('close');
    },
  };
  return s;
}

function setup(opts: { connected?: boolean } = {}) {
  const clock = { t: 1_000 };
  const link = new FakeLink();
  let n = 0;
  const viewer = new WorldViewer({ now: () => clock.t, streamId: () => `s${++n}`, pingMs: 60_000 });
  viewer.attach(link);
  link.viewer = viewer;
  if (opts.connected ?? true) {
    link.connected = true;
    viewer.opened(WELCOME);
  }
  const open = () => {
    const st = fakeStream();
    const r = viewer.open(st.req, st.res);
    return { st, r };
  };
  return { clock, link, viewer, open };
}

describe('WorldViewer: a cidade só com a cena aberta', () => {
  it('sem stream, nada de view; o primeiro stream manda view e o snapshot; o último fechado manda view.off', () => {
    const { link, viewer, open } = setup();
    expect(link.sent).toEqual([]);
    const a = open();
    expect(a.r).toEqual({ ok: true, data: { stream: 's1' } });
    expect(a.st.status).toBe(200);
    expect(a.st.chunks[0]).toBe('retry: 2000\n\n');
    expect(link.types()).toEqual(['view']);
    const snap = a.st.snapshots();
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({ stream: 's1', connected: true, viewing: true, district: 'centro', me: { id: 'acc_me', name: 'Ana Pixel' }, chunks: [], players: [], afk: false, minimap: null });
    const b = open();
    expect(link.types()).toEqual(['view']);
    expect(b.st.snapshots()[0]).toMatchObject({ stream: 's2', viewing: true });
    a.st.close();
    expect(link.types()).toEqual(['view']);
    b.st.close();
    expect(link.types()).toEqual(['view', 'view.off']);
    expect(viewer.size).toBe(0);
    expect(viewer.isViewing).toBe(false);
  });

  it('avisa a conexão quando passa a querer a cidade e quando deixa (pausado, ela abre e fecha com a cena), depois do view.off', async () => {
    const { link, viewer, open } = setup({ connected: false });
    const a = open();
    expect(viewer.wantsCity).toBe(true);
    await Promise.resolve();
    expect(link.changes).toEqual([true]);
    const b = open();
    await Promise.resolve();
    expect(link.changes).toEqual([true]);
    // a conexão abriu por causa da cena: `view` a cada welcome
    link.connected = true;
    viewer.opened(WELCOME);
    expect(link.types()).toEqual(['view']);
    a.st.close();
    b.st.close();
    expect(link.types()).toEqual(['view', 'view.off']);
    expect(link.changes).toEqual([true]);
    await Promise.resolve();
    expect(link.changes).toEqual([true, false]);
  });

  it('no máximo 4 streams', () => {
    const { open } = setup();
    for (let i = 0; i < 4; i++) expect(open().r.ok).toBe(true);
    expect(open().r).toEqual({ ok: false, status: 429, code: 'too_many_streams' });
  });

  it('sem conexão: o stream abre com connected false; o welcome manda view e o snapshot novo; a queda esquece a cidade', () => {
    const { link, viewer, open } = setup({ connected: false });
    const a = open();
    expect(a.st.snapshots()).toEqual([expect.objectContaining({ connected: false, viewing: false })]);
    expect(link.sent).toEqual([]);
    link.connected = true;
    viewer.opened(WELCOME);
    expect(link.types()).toEqual(['view']);
    viewer.message({ t: 'area', chunk: 'centro:0,0', rev: 1, buildings: [] });
    viewer.message({ t: 'pos', x: 21, y: 15 });
    expect(a.st.world().map((m) => m.t)).toEqual(['area', 'pos']);
    link.connected = false;
    viewer.closed();
    expect(a.st.snapshots().at(-1)).toMatchObject({ connected: false, viewing: false, chunks: [] });
    expect(a.st.snapshots().at(-1)).not.toHaveProperty('pos');
    // Reconectou: view de novo, cidade do zero.
    link.connected = true;
    viewer.opened(WELCOME);
    expect(link.types()).toEqual(['view', 'view']);
    expect(a.st.snapshots().at(-1)).toMatchObject({ connected: true, viewing: true, chunks: [] });
  });
});

describe('WorldViewer: mensagens da cidade', () => {
  it('repassa como veio; salto de rev pede resync e não repassa o patch; o que não é da cena fica', () => {
    const { link, viewer, open } = setup();
    const a = open();
    const area = { t: 'area', chunk: 'centro:0,0', rev: 4, buildings: [{ id: 'b1', likes: 0, lot: { district: 'centro', x: 3, y: 0 } }] };
    viewer.message(area);
    viewer.message({ t: 'area.patch', chunk: 'centro:0,0', rev: 5, changes: [{ id: 'b1', likes: 2 }] });
    viewer.message({ t: 'area.patch', chunk: 'centro:0,0', rev: 7, changes: [{ id: 'b1', likes: 9 }] });
    viewer.message({ t: 'uplink.ack', at: 1, bytes: 2 });
    viewer.message({ t: 'player.join', player: { id: 'p1', name: 'Zeca', pos: { x: 1, y: 1, dir: 's', moving: false } } });
    expect(a.st.world()).toEqual([area, { t: 'area.patch', chunk: 'centro:0,0', rev: 5, changes: [{ id: 'b1', likes: 2 }] }, { t: 'player.join', player: { id: 'p1', name: 'Zeca', pos: { x: 1, y: 1, dir: 's', moving: false } } }]);
    expect(link.sent).toEqual([{ t: 'view' }, { t: 'resync', chunk: 'centro:0,0' }]);
    // Um stream novo recebe tudo o que há no snapshot.
    const b = open();
    expect(b.st.snapshots()[0]).toMatchObject({ chunks: [{ chunk: 'centro:0,0', rev: 5, buildings: [{ id: 'b1', likes: 2 }] }], players: [{ id: 'p1' }] });
    expect(viewer.current().chunks[0]?.rev).toBe(5);
  });

  it('sem a cena aberta, só os avisos passam', () => {
    const { viewer, open } = setup();
    const a = open();
    a.st.close();
    const b = open();
    b.st.close();
    viewer.message({ t: 'area', chunk: 'centro:0,0', rev: 1, buildings: [] });
    expect(viewer.current().chunks).toEqual([]);
  });

  it('com a cena fechada, os likes do dia e o resumo do dono ficam para a cena que abrir depois (o knock, não)', () => {
    const { viewer, open } = setup();
    const summary = { since: '2026-10-15', visits: 1, likes: 1, stamps: [{ stampId: 'coffee', count: 1 }] };
    viewer.message({ t: 'likes.today', count: 1 });
    viewer.message({ t: 'away.summary', ...summary });
    viewer.message({ t: 'knock' });
    const a = open();
    expect(a.st.snapshots()[0]).toMatchObject({ likesToday: 1, summary });
    expect(a.st.world()).toEqual([]);
  });
});

describe('WorldViewer: visita (Fase 4)', () => {
  const detail = () => sampleBuildingDetail();
  const ID = 'o_7a8b9c0d1e2f';

  it('repassa building, building.patch e visitors; salto no rev do prédio pede resync {building} e não repassa', () => {
    const { link, viewer, open } = setup();
    const a = open();
    viewer.command({ stream: 's1', cmds: [{ t: 'enter', buildingId: ID, extra: 'x' }] });
    expect(link.sent.at(-1)).toEqual({ t: 'enter', buildingId: ID });
    viewer.message({ t: 'building', rev: 3, detail: detail() });
    viewer.message({ t: 'building.patch', rev: 4, visitors: 2 });
    viewer.message({ t: 'building.patch', rev: 6, visitors: 5 });
    viewer.message({ t: 'visitors', count: 1 });
    expect(a.st.world().map((m) => `${m.t}${m.rev ?? ''}`)).toEqual(['building3', 'building.patch4', 'visitors']);
    expect(link.sent.at(-1)).toEqual({ t: 'resync', building: ID });
    expect(viewer.current().inside).toMatchObject({ id: ID, rev: 4, detail: { visitors: 2 } });
    // Um stream novo no meio da visita recebe o interior no snapshot.
    const b = open();
    expect(b.st.snapshots()[0]?.inside).toMatchObject({ id: ID, rev: 4 });
    // O navegador pede o prédio de novo: só o id, campo a campo.
    expect(viewer.command({ stream: 's1', cmds: [{ t: 'resync', building: ID, token: 'x' }] })).toEqual({ ok: true, data: { sent: 1 } });
    expect(link.sent.at(-1)).toEqual({ t: 'resync', building: ID });
  });

  it('dentro, pos é a volta à rua; leave sobe como veio; fechar o último stream manda view.off (e esquece o interior)', () => {
    const { link, viewer, open } = setup();
    const a = open();
    viewer.message({ t: 'building', rev: 1, detail: detail() });
    viewer.command({ stream: 's1', cmds: [{ t: 'leave' }] });
    expect(link.sent.at(-1)).toEqual({ t: 'leave' });
    viewer.message({ t: 'pos', x: 40, y: 13 });
    expect(viewer.current().inside).toBeUndefined();
    expect(a.st.world().at(-1)).toEqual({ t: 'pos', x: 40, y: 13 });
    viewer.message({ t: 'building', rev: 1, detail: detail() });
    a.st.close();
    expect(link.types().at(-1)).toBe('view.off');
    expect(viewer.current().inside).toBeUndefined();
  });
});

describe('WorldViewer: comandos', () => {
  it('só os da cena, refeitos; de cada lote só o último move; o move entra na minha posição', () => {
    const { link, viewer, open } = setup();
    const { st } = open();
    const r = viewer.command({
      stream: 's1',
      cmds: [
        { t: 'move', x: 22, y: 15, dir: 'e', moving: true },
        { t: 'profile', playerId: 'p1', extra: 'x' },
        { t: 'move', x: 23, y: 15, dir: 'e', moving: true },
      ],
    });
    expect(r).toEqual({ ok: true, data: { sent: 2 } });
    expect(link.sent.slice(1)).toEqual([{ t: 'profile', playerId: 'p1' }, { t: 'move', x: 23, y: 15, dir: 'e', moving: true }]);
    expect(viewer.current().pos).toEqual({ x: 23, y: 15, dir: 'e', moving: true });
    for (const bad of [{ t: 'hello', v: 1, token: 'x' }, { t: 'uplink', uplink: {} }, { t: 'ping' }]) {
      expect(viewer.command({ stream: 's1', cmds: [{ t: 'view' }, bad] }), bad.t).toEqual({ ok: false, status: 400, code: 'invalid' });
    }
    expect(link.sent).toHaveLength(3);
    expect(viewer.command({ stream: 's1', cmds: [] })).toMatchObject({ status: 400 });
    expect(viewer.command({ stream: 's1', cmds: Array(21).fill({ t: 'view' }) })).toMatchObject({ status: 400 });
    expect(viewer.command({ cmds: [{ t: 'view' }] })).toMatchObject({ status: 400 });
    expect(viewer.command({ stream: 'outro', cmds: [{ t: 'view' }] })).toEqual({ ok: false, status: 409, code: 'no_stream' });
    expect(st.status).toBe(200);
  });

  it('até 5 lotes por segundo por stream: um lote a cada 200 ms nunca é recusado; a rajada passa do limite', () => {
    const { clock, viewer, open } = setup();
    open();
    open();
    const move = (x: number) => ({ stream: 's1', cmds: [{ t: 'move', x, y: 15, dir: 'e', moving: true }] });
    for (let i = 0; i < 50; i++) {
      clock.t += 200;
      expect(viewer.command(move(21 + i * 0.1)).ok, `lote ${i}`).toBe(true);
    }
    // Parado 1 s, o balde enche: 5 de uma vez passam, o sexto não.
    clock.t += 1_000;
    for (let i = 0; i < 5; i++) expect(viewer.command(move(30)).ok).toBe(true);
    expect(viewer.command(move(30))).toEqual({ ok: false, status: 429, code: 'rate_limited', retryAfter: 1 });
    // O outro stream tem o seu próprio balde.
    expect(viewer.command({ ...move(30), stream: 's2' }).ok).toBe(true);
    clock.t += 200;
    expect(viewer.command(move(30)).ok).toBe(true);
  });

  it('sem conexão: 409 not_connected', () => {
    const { link, viewer, open } = setup();
    open();
    link.connected = false;
    viewer.closed();
    expect(viewer.command({ stream: 's1', cmds: [{ t: 'move', x: 1, y: 1, dir: 'n', moving: false }] })).toEqual({ ok: false, status: 409, code: 'not_connected' });
  });

  it('view.off de um stream: sem nenhum querendo, view.off; view volta; view com a cidade aberta recomeça (snapshot novo)', () => {
    const { link, viewer, open } = setup();
    const { st } = open();
    viewer.message({ t: 'area', chunk: 'centro:0,0', rev: 1, buildings: [] });
    expect(viewer.command({ stream: 's1', cmds: [{ t: 'view.off' }] })).toEqual({ ok: true, data: { sent: 1 } });
    expect(link.types()).toEqual(['view', 'view.off']);
    expect(st.snapshots().at(-1)).toMatchObject({ viewing: false, chunks: [] });
    expect(viewer.command({ stream: 's1', cmds: [{ t: 'view' }] })).toEqual({ ok: true, data: { sent: 1 } });
    expect(link.types()).toEqual(['view', 'view.off', 'view']);
    viewer.message({ t: 'area', chunk: 'centro:0,0', rev: 1, buildings: [] });
    const before = st.snapshots().length;
    expect(viewer.command({ stream: 's1', cmds: [{ t: 'view' }] }).ok).toBe(true);
    expect(link.types()).toEqual(['view', 'view.off', 'view', 'view']);
    expect(st.snapshots()).toHaveLength(before + 1);
    expect(st.snapshots().at(-1)).toMatchObject({ viewing: true, chunks: [] });
  });

  it('cliente lento (buffer acima do teto) é desconectado e, sem stream, sai o view.off', () => {
    const { link, viewer, open } = setup();
    const { st } = open();
    (st.res as unknown as { writableLength: number }).writableLength = 2 * 1024 * 1024;
    viewer.message({ t: 'pos', x: 21, y: 15 });
    expect((st.res as unknown as { destroyed: boolean }).destroyed).toBe(true);
    expect(viewer.size).toBe(0);
    expect(link.types()).toEqual(['view', 'view.off']);
  });
});
