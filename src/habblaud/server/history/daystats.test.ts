import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentInfo, OfficeSnapshot } from '../../shared/types';
import { setQuiet } from '../log';
import { tempDir } from '../test/fixtures';
import { DayStatsService } from './daystats';

setQuiet(true);

const S = 1_000;
const MIN = 60 * S;
const H = 60 * MIN;
/** 08/10/2026 10:00 UTC. */
const T0 = Date.UTC(2026, 9, 8, 10);
const DAY = '2026-10-08';

function agent(p: Partial<AgentInfo> & { id: string }): AgentInfo {
  return {
    kind: 'main',
    roomId: '/p/loja',
    name: 'Ana',
    look: 'f',
    role: 'Agente principal',
    sessionId: `sess-${p.id}`,
    account: '.claude',
    status: 'working',
    recent: [],
    tasks: [],
    startedAt: T0 - 2 * H,
    lastEventAt: T0,
    statusSince: T0 - 5 * MIN,
    stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 },
    seed: 1,
    ...p,
  };
}

type Snap = Pick<OfficeSnapshot, 'agents' | 'rooms' | 'accounts' | 'meta'>;

function snapOf(agents: AgentInfo[], demo = false): Snap {
  return {
    agents,
    rooms: [
      { id: '/p/loja', name: 'loja', path: '/p/loja', slot: 0, seed: 1, createdAt: 0 },
      { id: '/demo/loja-virtual', name: 'loja-virtual', path: '/demo/loja-virtual', slot: 1, seed: 2, createdAt: 0 },
    ],
    accounts: [
      { id: '.claude', short: 'C', name: 'Conta C', color: '#f08a3c', configDir: '~/.claude', sessions: 1, usageStatus: 'disabled' },
      { id: 'demo:.claude', short: 'X', name: 'Demo X', color: '#5cc97b', configDir: '(demonstração)', sessions: 1, usageStatus: 'ok' },
    ],
    meta: { demo, sources: [], startedAt: 0, version: 'teste' },
  };
}

function setup(dir: string | null) {
  const clock = { now: T0 };
  let snap = snapOf([]);
  const make = () =>
    new DayStatsService({
      dir,
      tz: 'UTC',
      now: () => clock.now,
      snapshot: () => snap,
    });
  return {
    clock,
    make,
    set: (s: Snap) => {
      snap = s;
    },
    /** Amostras de segundo em segundo até `until`. */
    run(svc: DayStatsService, until: number) {
      while (clock.now < until) {
        clock.now = Math.min(until, clock.now + S);
        svc.sample();
      }
    },
  };
}

describe('DayStatsService: persistência', () => {
  it('grava o dia, recarrega no boot e continua somando', () => {
    const tmp = tempDir();
    try {
      const dir = join(tmp.dir, 'stats');
      const env = setup(dir);
      const svc = env.make();
      svc.load();
      env.set(snapOf([agent({ id: 'a', status: 'waiting', statusSince: T0 - MIN, waitingFor: 'aprovar uma permissão' })]));
      svc.sample();
      env.run(svc, T0 + 90 * S);
      svc.stop();
      const file = join(dir, `${DAY}.json`);
      expect(existsSync(file)).toBe(true);
      const json = JSON.parse(readFileSync(file, 'utf8'));
      expect(json.version).toBe(1);
      expect(json.day).toBe(DAY);
      // Nada de arquivos temporários esquecidos.
      expect(readdirSync(dir)).toEqual([`${DAY}.json`]);

      // Reinício: outro processo carrega o arquivo; a espera aberta continua a mesma.
      env.clock.now = T0 + 100 * S;
      const again = env.make();
      again.load();
      expect(again.day(DAY, 'UTC')!.stats.totals.ms.waiting).toBe(90 * S);
      again.sample();
      env.run(again, T0 + 130 * S);
      const d = again.day(DAY, 'UTC')!.stats;
      expect(d.totals.ms.waiting).toBe(120 * S);
      expect(d.waits).toHaveLength(1);
      expect(d.waits[0]).toMatchObject({ agentName: 'Ana', roomName: 'loja', start: T0, end: T0 + 130 * S, ongoing: true });
      expect(again.days('UTC').days).toEqual([DAY]);
    } finally {
      tmp.cleanup();
    }
  });

  it('arquivo corrompido não derruba: fica de lado como .corrupt e o dia recomeça', () => {
    const tmp = tempDir();
    try {
      const dir = join(tmp.dir, 'stats');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${DAY}.json`), '{"version":1,"hours":[{"t":');
      const env = setup(dir);
      const svc = env.make();
      expect(() => svc.load()).not.toThrow();
      expect(existsSync(join(dir, `${DAY}.json.corrupt`))).toBe(true);
      env.set(snapOf([agent({ id: 'a' })]));
      svc.sample();
      env.run(svc, T0 + 10 * S);
      svc.flush();
      expect(JSON.parse(readFileSync(join(dir, `${DAY}.json`), 'utf8')).hours).toHaveLength(1);
      expect(svc.day(DAY, 'UTC')!.stats.totals.ms.working).toBe(10 * S);
    } finally {
      tmp.cleanup();
    }
  });

  it('disco indisponível: segue só na memória, sem exceções', () => {
    const tmp = tempDir();
    try {
      // A "pasta" é um arquivo: nem ler nem gravar funciona.
      const dir = join(tmp.dir, 'nao-e-pasta');
      writeFileSync(dir, 'x');
      const env = setup(dir);
      const svc = env.make();
      svc.load();
      env.set(snapOf([agent({ id: 'a' })]));
      svc.sample();
      env.run(svc, T0 + 5 * S);
      expect(() => svc.flush()).not.toThrow();
      expect(() => svc.stop()).not.toThrow();
      expect(svc.day(DAY, 'UTC')!.stats.totals.ms.working).toBe(5 * S);
    } finally {
      tmp.cleanup();
    }
  });

  it('retenção de 30 dias, lista de dias e virada do dia', () => {
    const tmp = tempDir();
    try {
      const dir = join(tmp.dir, 'stats');
      mkdirSync(dir, { recursive: true });
      const day = (key: string, t: number) =>
        JSON.stringify({ version: 1, day: key, updatedAt: t, hours: [{ t, ms: { working: MIN, waiting: 0, idle: 0, shell: 0 } }], rooms: [], accounts: [], waits: [] });
      writeFileSync(join(dir, '2026-09-07.json'), day('2026-09-07', Date.UTC(2026, 8, 7, 12)));
      writeFileSync(join(dir, '2026-09-08.json'), day('2026-09-08', Date.UTC(2026, 8, 8, 12)));
      writeFileSync(join(dir, '2026-10-01.json'), day('2026-10-01', Date.UTC(2026, 9, 1, 12)));
      writeFileSync(join(dir, 'outro.txt'), 'não mexe');
      const env = setup(dir);
      const svc = env.make();
      svc.load();
      expect(readdirSync(dir).sort()).toEqual(['2026-09-08.json', '2026-10-01.json', 'outro.txt']);
      expect(svc.days('UTC').days).toEqual([DAY, '2026-10-01', '2026-09-08']);
      // Em São Paulo, 01/10 12:00 UTC ainda é 01/10.
      expect(svc.days('America/Sao_Paulo').days).toContain('2026-10-01');
      expect(svc.day('2026-10-01', 'UTC')!.stats.totals.ms.working).toBe(MIN);
      expect(svc.day('2026-10-02', 'UTC')).toBeNull();

      // Virada do dia: o trabalho depois da meia-noite vai para o arquivo de amanhã; 08/09 sai da retenção.
      env.clock.now = Date.UTC(2026, 9, 8, 23, 59, 50);
      env.set(snapOf([agent({ id: 'a' })]));
      svc.sample();
      env.run(svc, Date.UTC(2026, 9, 9, 0, 0, 10));
      svc.flush();
      expect(readdirSync(dir).sort()).toEqual(['2026-10-01.json', '2026-10-08.json', '2026-10-09.json', 'outro.txt']);
      expect(svc.day('2026-10-09', 'UTC')!.stats.totals.ms.working).toBe(10 * S);
      expect(svc.day('2026-10-08', 'UTC')!.stats.totals.ms.working).toBe(10 * S);
    } finally {
      tmp.cleanup();
    }
  });
});

describe('DayStatsService: modo demonstração', () => {
  it('agentes do demo ficam num balde à parte, semeado e só em memória', () => {
    const tmp = tempDir();
    try {
      const dir = join(tmp.dir, 'stats');
      const env = setup(dir);
      const svc = env.make();
      svc.load();
      const real = agent({ id: '.claude:1' });
      // Uma pasta de conta chamada "demo" continua real.
      const realDemoDir = agent({ id: 'demo:42', sessionId: 'sess-42', account: 'demo', status: 'idle' });
      const demo = agent({ id: 'demo:abc-1', roomId: '/demo/loja-virtual', account: 'demo:.claude', name: 'Bruno', status: 'waiting', statusSince: T0 });
      env.set(snapOf([real, realDemoDir, demo], true));
      svc.sample();
      env.run(svc, T0 + 20 * S);
      expect(svc.isDemo()).toBe(true);

      const r = svc.day(DAY, 'UTC', 'real')!;
      expect(r.source).toBe('real');
      expect(r.demoAvailable).toBe(true);
      expect(r.stats.totals.ms).toEqual({ working: 20 * S, waiting: 0, idle: 20 * S, shell: 0 });
      expect(r.stats.rooms.map((x) => x.id)).toEqual(['/p/loja']);

      // Sem `source`, com o demo ligado e o dia de hoje: o demo (histórico fictício + o que acontece ao vivo).
      const d = svc.day(DAY, 'UTC')!;
      expect(d.source).toBe('demo');
      expect(d.stats.rooms.map((x) => x.name)).toContain('loja-virtual');
      expect(d.stats.rooms.every((x) => x.id.startsWith('/demo/'))).toBe(true);
      expect(d.stats.totals.ms.working).toBeGreaterThan(20 * MIN);
      expect(d.stats.accounts.every((a) => a.id.startsWith('demo:'))).toBe(true);
      expect(svc.days('UTC').demoDays).toContain(DAY);

      svc.flush();
      const saved = readFileSync(join(dir, `${DAY}.json`), 'utf8');
      expect(saved).not.toContain('demo:');
      expect(saved).not.toContain('loja-virtual');
      expect(saved).not.toContain('Bruno');

      // Demo desligado: o balde some.
      env.set(snapOf([real]));
      svc.sample();
      expect(svc.isDemo()).toBe(false);
      expect(svc.day(DAY, 'UTC', 'demo')).toBeNull();
      expect(svc.day(DAY, 'UTC')!.source).toBe('real');
      expect(svc.days('UTC').demoDays).toBeUndefined();
    } finally {
      tmp.cleanup();
    }
  });
});
