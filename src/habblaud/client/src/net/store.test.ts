import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OfficeSnapshot } from '../../../shared/types';
import { mockOptionsFrom, OfficeStore, pageBuild, reconnectDelay, type EventSourceLike } from './store';

/** EventSource falso: o teste dispara open/error e muda o readyState. */
class FakeSource implements EventSourceLike {
  readyState = 0;
  closed = false;
  private handlers = new Map<string, ((ev: Event) => void)[]>();

  addEventListener(type: string, listener: (ev: Event) => void): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
    this.readyState = 2;
  }

  fire(type: string, data?: unknown): void {
    const ev = (data === undefined ? { type } : { type, data: JSON.stringify(data) }) as unknown as Event;
    this.handlers.get(type)?.forEach((fn) => fn(ev));
  }

  open(): void {
    this.readyState = 1;
    this.fire('open');
  }

  /** Erro definitivo (ex.: HTTP 502): o navegador desiste e fecha o stream. */
  fail(): void {
    this.readyState = 2;
    this.fire('error');
  }
}

describe('mockOptionsFrom', () => {
  it('usa os padrões sem parâmetros', () => {
    expect(mockOptionsFrom('')).toEqual({ speed: 1, sessions: 4 });
  });

  it('aceita sessions=0 (escritório vazio)', () => {
    expect(mockOptionsFrom('?mock=1&sessions=0').sessions).toBe(0);
  });

  it('ignora valores inválidos e limita os exagerados', () => {
    expect(mockOptionsFrom('?sessions=abc&speed=-2')).toEqual({ speed: 1, sessions: 4 });
    expect(mockOptionsFrom('?sessions=&speed=')).toEqual({ speed: 1, sessions: 4 });
    expect(mockOptionsFrom('?sessions=6.7&speed=2')).toEqual({ speed: 2, sessions: 6 });
    expect(mockOptionsFrom('?sessions=999&speed=999')).toEqual({ speed: 50, sessions: 40 });
  });

  it('para capturas de tela: semente fixa e o Codex sem cota', () => {
    expect(mockOptionsFrom('?mock=1&seed=7&noquota=1')).toEqual({ speed: 1, sessions: 4, seed: 7, codexNoQuota: true });
    expect(mockOptionsFrom('?seed=-1&noquota=0')).toEqual({ speed: 1, sessions: 4 });
  });
});

describe('reconnectDelay', () => {
  it('dobra a cada tentativa até 30 s', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(reconnectDelay)).toEqual([2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
  });
});

describe('OfficeStore: reconexão', () => {
  let sources: FakeSource[];
  let store: OfficeStore;
  const last = () => sources[sources.length - 1];

  beforeEach(() => {
    vi.useFakeTimers();
    sources = [];
    store = new OfficeStore({
      eventSource: () => {
        const s = new FakeSource();
        sources.push(s);
        return s;
      },
    });
  });

  afterEach(() => {
    store.disconnect();
    vi.useRealTimers();
  });

  it('connect() repetido mantém um único stream, fechado por disconnect()', () => {
    store.connect();
    store.connect();
    last().open();
    store.connect();
    store.disconnect();
    expect(sources.map((s) => s.closed)).toEqual([true]);
  });

  it('religa sozinho com espera crescente quando o navegador desiste do stream', () => {
    const states: string[] = [];
    store.on('connection', (s) => states.push(s));
    store.connect();
    last().fail();
    expect(store.connection).toBe('closed');
    expect(sources).toHaveLength(1);

    vi.advanceTimersByTime(1_999);
    expect(sources).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sources).toHaveLength(2);
    expect(sources[0].closed).toBe(true);

    // Segunda falha seguida: espera 4 s.
    last().fail();
    vi.advanceTimersByTime(3_999);
    expect(sources).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sources).toHaveLength(3);

    // Conectou: zera a espera.
    last().open();
    expect(store.connection).toBe('open');
    last().fail();
    vi.advanceTimersByTime(2_000);
    expect(sources).toHaveLength(4);
    expect(states).toEqual(['closed', 'connecting', 'closed', 'connecting', 'open', 'closed', 'connecting']);
  });

  it('erro transitório (o navegador ainda tenta) não agenda reconexão própria', () => {
    store.connect();
    last().open();
    last().readyState = 0;
    last().fire('error');
    expect(store.connection).toBe('connecting');
    vi.advanceTimersByTime(60_000);
    expect(sources).toHaveLength(1);
  });

  it('"Tentar agora" religa na hora e cancela a tentativa agendada', () => {
    store.connect();
    last().fail();
    expect(store.nextRetryAt).not.toBeNull();
    store.reconnectNow();
    expect(sources).toHaveLength(2);
    expect(store.connection).toBe('connecting');
    expect(store.nextRetryAt).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(sources).toHaveLength(2);
  });

  it('disconnect() remove o listener de rede e connect() o restaura sem acumular', () => {
    const online = new Set<EventListener>();
    vi.stubGlobal('addEventListener', (type: string, cb: EventListener) => {
      if (type === 'online') online.add(cb);
    });
    vi.stubGlobal('removeEventListener', (type: string, cb: EventListener) => {
      if (type === 'online') online.delete(cb);
    });
    store = new OfficeStore({
      eventSource: () => {
        const s = new FakeSource();
        sources.push(s);
        return s;
      },
    });
    try {
      for (let i = 0; i < 3; i++) {
        store.connect();
        expect(online.size).toBe(1);
        last().fail();
        online.forEach((cb) => cb(new Event('online')));
        expect(sources).toHaveLength((i + 1) * 2);
        expect(store.nextRetryAt).toBeNull();
        store.disconnect();
        expect(online.size).toBe(0);
        vi.advanceTimersByTime(60_000);
        expect(sources).toHaveLength((i + 1) * 2);
      }
    } finally {
      store.disconnect();
      vi.unstubAllGlobals();
    }
  });

  it('disconnect() não reconecta e eventos do stream antigo são ignorados', () => {
    store.connect();
    const old = last();
    store.disconnect();
    old.fail();
    vi.advanceTimersByTime(60_000);
    expect(sources).toHaveLength(1);
    expect(store.connection).toBe('connecting');
  });

  it('aplica snapshot, feed e avisos; JSON inválido é ignorado', () => {
    const notices: unknown[] = [];
    store.on('notice', (n) => notices.push(n));
    store.connect();
    last().open();
    const snap = { rev: 1, serverTime: 0, rooms: [], agents: [], accounts: [], meta: { demo: false, sources: [], startedAt: 1, version: 't' } };
    last().fire('snapshot', snap);
    expect(store.snapshot?.rev).toBe(1);
    last().fire('feed', [{ id: 'f1', agentId: 'a', roomId: 'r', agentName: 'Ana', roomName: 'x', activity: { id: 'x', at: 0, kind: 'tool', icon: '·', text: 't' } }]);
    expect(store.feed).toHaveLength(1);
    last().fire('notice', { id: 'n', level: 'info', text: 'oi', at: 0 });
    expect(notices).toHaveLength(1);
    expect(() => last().fire('snapshot', undefined)).not.toThrow();
    const bad = { type: 'snapshot', data: '{quebrado' } as unknown as Event;
    expect(() => (last() as unknown as { handlers: Map<string, ((e: Event) => void)[]> }).handlers.get('snapshot')![0](bad)).not.toThrow();
    expect(store.snapshot?.rev).toBe(1);
  });
});

const snap = (rev: number, build?: string): OfficeSnapshot => ({
  rev,
  serverTime: 0,
  rooms: [],
  agents: [],
  accounts: [],
  meta: { demo: false, sources: [], startedAt: 1, version: '0.1.0', build },
});

describe('detecção de versão nova', () => {
  it('lê o build da URL do bundle e ignora o código-fonte do modo dev', () => {
    expect(pageBuild('http://localhost:4747/bundle/main-BFqheOCa.js')).toBe('main-BFqheOCa');
    expect(pageBuild('http://192.168.0.10:4747/bundle/main-a_b-C1.js')).toBe('main-a_b-C1');
    expect(pageBuild('http://localhost:5173/src/net/store.ts')).toBeUndefined();
    expect(pageBuild('não é url')).toBeUndefined();
  });

  it('avisa uma vez quando o servidor serve outro build', () => {
    const store = new OfficeStore();
    store.pageBuildId = 'main-velho';
    const seen: string[] = [];
    store.on('update', (u) => seen.push(`${u.current}->${u.build}`));
    const apply = (s: OfficeSnapshot) => (store as unknown as { applySnapshot(s: OfficeSnapshot): void }).applySnapshot(s);
    apply(snap(1, 'main-velho'));
    expect(seen).toEqual([]);
    apply(snap(2, 'main-novo'));
    apply(snap(3, 'main-novo'));
    expect(seen).toEqual(['main-velho->main-novo']);
  });

  it('não avisa sem build no servidor, no modo dev nem no mock', () => {
    const dev = new OfficeStore();
    dev.pageBuildId = undefined;
    const mock = new OfficeStore({ mock: true });
    mock.pageBuildId = 'main-velho';
    const semBuild = new OfficeStore();
    semBuild.pageBuildId = 'main-velho';
    let count = 0;
    for (const s of [dev, mock, semBuild]) s.on('update', () => count++);
    const apply = (s: OfficeStore, x: OfficeSnapshot) => (s as unknown as { applySnapshot(s: OfficeSnapshot): void }).applySnapshot(x);
    apply(dev, snap(1, 'main-novo'));
    apply(mock, snap(1, 'main-novo'));
    apply(semBuild, snap(1));
    expect(count).toBe(0);
  });
});

describe('fonte alternativa (timelapse)', () => {
  it('guarda os snapshots ao vivo durante o replay e volta a eles no fim', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    try {
      const store = new OfficeStore();
      const seen: number[] = [];
      store.on('snapshot', (s) => seen.push(s.rev));
      const apply = (s: OfficeSnapshot) => (store as unknown as { applySnapshot(s: OfficeSnapshot): void }).applySnapshot(s);
      apply({ ...snap(5), serverTime: 9_000 });
      expect(store.replaying).toBe(false);

      const replayed = { ...snap(1), serverTime: 1_000, agents: [{ id: 'tl', roomId: 'r' } as OfficeSnapshot['agents'][number]] };
      store.pushReplay(replayed);
      expect(store.replaying).toBe(true);
      expect(store.snapshot).toBe(replayed);
      expect(store.agent('tl')).toBeDefined();
      // Ao vivo chegando por baixo: guardado, sem emitir, e o mais antigo continua descartado.
      apply({ ...snap(6), serverTime: 9_500 });
      apply(snap(4));
      expect(store.snapshot).toBe(replayed);
      expect(store.liveSnapshot?.rev).toBe(6);
      expect(seen).toEqual([5, 1]);

      vi.setSystemTime(12_000);
      store.stopReplay();
      expect(store.replaying).toBe(false);
      expect(store.snapshot?.rev).toBe(6);
      // O relógio da interface sai do serverTime: avança o tempo que o snapshot ficou guardado.
      expect(store.snapshot?.serverTime).toBe(9_500 + 2_000);
      expect(store.agent('tl')).toBeUndefined();
      expect(seen).toEqual([5, 1, 6]);
      store.stopReplay();
      expect(seen).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('personagem do projeto (store)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('saveCharacter: PUT JSON na rota do agente; devolve undefined ou a mensagem de erro do servidor', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'Ana já está no escritório em api' }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    const store = new OfficeStore();
    expect(await store.saveCharacter('.claude:1', { name: 'Ana', seed: 1, parts: {} })).toBe('Ana já está no escritório em api');
    expect(fetchMock).toHaveBeenCalledWith('/api/agents/.claude%3A1/character', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{"name":"Ana","seed":1,"parts":{}}',
    });
    fetchMock.mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    expect(await store.saveCharacter('.claude:1', { name: 'Ana', seed: 1, parts: {} })).toBeUndefined();
  });

  it('resetCharacter: DELETE com corpo JSON; sem conexão vira mensagem; no mock não chama a rede', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await new OfficeStore().resetCharacter('a')).toBeUndefined();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/agents/a/character', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    fetchMock.mockRejectedValueOnce(new TypeError('failed to fetch'));
    expect(await new OfficeStore().resetCharacter('a')).toBe('Sem conexão com o Habblaud.');
    const calls = fetchMock.mock.calls.length;
    expect(await new OfficeStore({ mock: true }).resetCharacter('a')).toMatch(/ao vivo/);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });
});
