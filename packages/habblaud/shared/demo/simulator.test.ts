import { describe, expect, it } from 'vitest';
import { DemoSimulator } from './simulator';

describe('DemoSimulator', () => {
  it('no ?mock=1 imita as contas C e D (e a do Codex, por último)', () => {
    const sim = new DemoSimulator({ seed: 1 }, 1_000);
    expect(sim.snapshot(1_000).accounts.map((a) => [a.id, a.short, a.provider])).toEqual([
      ['.claude', 'C', undefined],
      ['.claude-conta2', 'D', undefined],
      ['.codex', 'X', 'codex'],
    ]);
  });

  it('com idPrefix usa contas próprias e ids que não colidem com dados reais', () => {
    const sim = new DemoSimulator({ seed: 1, idPrefix: 'demo:', sessions: 5 }, 1_000);
    const snap = sim.snapshot(1_000);
    expect(snap.accounts.map((a) => [a.id, a.short, a.name])).toEqual([
      ['demo:.claude', 'X', 'Demo X'],
      ['demo:.claude-conta2', 'Y', 'Demo Y'],
      ['demo:.codex', 'Z', 'Demo Codex'],
    ]);
    expect(snap.agents.every((a) => a.id.startsWith('demo:') && a.account.startsWith('demo:'))).toBe(true);
    expect(snap.rooms.every((r) => r.id.startsWith('demo:'))).toBe(true);
  });

  it('ids de atividades não se repetem entre instâncias (religar o demo)', () => {
    const ids = new Set<string>();
    for (const start of [1_000, 2_000]) {
      const sim = new DemoSimulator({ seed: 7, idPrefix: 'demo:', speed: 20 }, start);
      for (let t = start; t < start + 60_000; t += 250) for (const f of sim.tick(t).feed) {
        expect(ids.has(f.id)).toBe(false);
        ids.add(f.id);
      }
    }
    expect(ids.size).toBeGreaterThan(10);
  });

  it('abre com alguém esperando um shell em segundo plano (com job e balão), e o shell termina com ShellDone', () => {
    const start = 5_000;
    const sim = new DemoSimulator({ seed: 3 }, start);
    const waiting = sim.snapshot(start).agents.filter((a) => a.status === 'shell');
    expect(waiting.length).toBeGreaterThanOrEqual(1);
    const a = waiting[0];
    expect(a.shells?.length).toBeGreaterThanOrEqual(1);
    expect(a.shells!.every((j) => j.background && j.kind === 'shell' && j.startedAt < start && j.label)).toBe(true);
    expect(a.activity).toMatchObject({ tool: 'ShellWait' });
    const done: string[] = [];
    for (let t = start; t < start + 200_000; t += 250) {
      for (const f of sim.tick(t).feed) if (f.activity.tool === 'ShellDone') done.push(f.agentId);
    }
    expect(done).toContain(a.id);
  });

  it('com o tempo: shells em segundo plano (status shell), comandos longos em primeiro plano e falhas', () => {
    for (const seed of [1, 2, 3]) {
      const sim = new DemoSimulator({ seed, speed: 10, sessions: 5 }, 0);
      const seen = { shell: 0, foreground: 0, ok: 0, failed: 0, noticeWait: 0 };
      for (let t = 0; t < 3_600_000 / 10; t += 250) {
        const r = sim.tick(t);
        for (const f of r.feed) {
          if (f.activity.tool !== 'ShellDone') continue;
          if (f.activity.error) seen.failed++;
          else seen.ok++;
        }
        seen.noticeWait += r.notices.filter((n) => n.text.includes('está esperando o shell')).length;
        if (!r.changed) continue;
        for (const a of sim.snapshot(t).agents) {
          if (a.status === 'shell') {
            seen.shell++;
            expect(a.shells?.some((j) => j.background)).toBe(true);
          }
          if (a.status === 'working' && a.shells?.some((j) => !j.background)) seen.foreground++;
          if (a.status === 'idle') expect(a.shells).toBeUndefined();
        }
      }
      expect(seen.shell).toBeGreaterThan(0);
      expect(seen.foreground).toBeGreaterThan(0);
      expect(seen.ok).toBeGreaterThan(0);
      expect(seen.noticeWait).toBeGreaterThan(0);
      if (seed === 1) expect(seen.ok + seen.failed).toBeGreaterThan(3);
    }
  });
});

describe('DemoSimulator: Codex', () => {
  const MIN = 60_000;

  it('abre com uma sala de Claude Code e Codex juntos (e o resto das sessões no Claude Code)', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const snap = new DemoSimulator({ seed }, 1_000).snapshot(1_000);
      const mains = snap.agents.filter((a) => a.kind === 'main');
      const codex = mains.filter((a) => a.provider === 'codex');
      expect(codex).toHaveLength(1);
      const room = codex[0].roomId;
      expect(mains.some((a) => a.roomId === room && a.provider === undefined)).toBe(true);
      // Agente do Codex: conta própria, modelo gpt-*-codex, papel neutro, aprovação no lugar do modo de permissão, sem custo.
      expect(codex[0]).toMatchObject({ account: '.codex', role: 'Agente principal', permissionMode: 'on-request', canMessage: true });
      expect(codex[0].model).toMatch(/^gpt-5\.\d-codex/);
      expect(codex[0].stats.costUSD).toBeUndefined();
      // Nunca grava provider 'claude'.
      expect(mains.every((a) => a.provider === undefined || a.provider === 'codex')).toBe(true);
    }
  });

  it('determinístico: a mesma semente gera o mesmo escritório', () => {
    const run = () => {
      const sim = new DemoSimulator({ seed: 9, speed: 6, sessions: 6 }, 0);
      for (let t = 0; t < 600_000; t += 250) sim.tick(t);
      return sim.snapshot(600_000);
    };
    expect(run()).toEqual(run());
  });

  it('com o tempo, ~30% das sessões novas são do Codex; os subagentes herdam a ferramenta', () => {
    const sim = new DemoSimulator({ seed: 11, speed: 10, sessions: 6 }, 0);
    const seen = new Map<string, boolean>();
    let codexSub = false;
    for (let t = 0; t < 3_600_000 / 5; t += 250) {
      if (!sim.tick(t).changed) continue;
      for (const a of sim.snapshot(t).agents) {
        if (a.kind === 'main') seen.set(a.id, a.provider === 'codex');
        else if (a.provider === 'codex') {
          codexSub = true;
          expect(['explorer', 'worker', 'reviewer']).toContain(a.role);
        }
      }
    }
    const codex = [...seen.values()].filter(Boolean).length;
    expect(codex).toBeGreaterThan(1);
    expect(codex).toBeLessThan(seen.size);
    expect(codexSub).toBe(true);
  });

  it('uso do Codex: "arquivos do Codex", lido na última atividade de uma sessão dele (envelhece sem sessão)', () => {
    const sim = new DemoSimulator({ seed: 3 }, 0);
    const acc = () => sim.snapshot(t).accounts.find((a) => a.provider === 'codex')!;
    let t = 0;
    expect(acc()).toMatchObject({ id: '.codex', short: 'X', name: 'Codex', plan: 'Team', usageStatus: 'ok' });
    expect(acc().email).toBeUndefined();
    expect(acc().usage).toMatchObject({ source: 'codex' });
    // Leitura de antes de abrir: a idade aparece.
    expect(acc().usage!.fetchedAt).toBeLessThan(0);
    const before = acc().usage!.fetchedAt;
    for (; t < 120_000; t += 250) sim.tick(t);
    // Alguma sessão do Codex trabalhou: a leitura é nova (e nunca "agora" por conta própria).
    expect(acc().usage!.fetchedAt).toBeGreaterThan(before);
    expect(acc().usage!.fetchedAt).toBeLessThanOrEqual(t);
    expect(acc().usage!.fiveHour?.utilization).toBeGreaterThan(0);
    expect(acc().usage!.sevenDayOpus).toBeUndefined();
  });

  it('"sem cota": sem janelas (nunca 0%), sempre com a opção e de vez em quando sem ela', () => {
    const forced = new DemoSimulator({ seed: 3, codexNoQuota: true }, 0).snapshot(0).accounts.find((a) => a.provider === 'codex')!;
    expect(forced.usage).toEqual({ source: 'codex', noQuota: true, fetchedAt: forced.usage!.fetchedAt });
    const sim = new DemoSimulator({ seed: 4, speed: 4, sessions: 6 }, 0);
    let noQuota = 0;
    let numbers = 0;
    for (let t = 0; t < (90 * MIN) / 4; t += 1_000) {
      sim.tick(t);
      const u = sim.snapshot(t).accounts.find((a) => a.provider === 'codex')!.usage!;
      if (u.noQuota) {
        noQuota++;
        expect(u.fiveHour).toBeUndefined();
        expect(u.sevenDay).toBeUndefined();
      } else numbers++;
    }
    expect(noQuota).toBeGreaterThan(0);
    expect(numbers).toBeGreaterThan(noQuota);
  });

  it('mensagem para o Codex: entra na fila e só vira atividade quando a sessão fica ociosa', () => {
    const start = 10_000;
    const sim = new DemoSimulator({ seed: 6 }, start);
    const codex = sim.snapshot(start).agents.find((a) => a.provider === 'codex')!;
    expect(sim.receiveMessage(codex.id, 'roda o lint também', start)).toBe(true);
    // Na hora, nada aparece (está na fila).
    expect(sim.snapshot(start).agents.find((a) => a.id === codex.id)!.recent.some((r) => r.text === 'Mensagem pelo Habblaud')).toBe(false);
    let t = start;
    let deliveredAt = 0;
    let statusAtDelivery = '';
    while (t < start + 400_000 && !deliveredAt) {
      t += 250;
      sim.tick(t);
      const a = sim.snapshot(t).agents.find((x) => x.id === codex.id)!;
      const m = a.recent.find((r) => r.text === 'Mensagem pelo Habblaud');
      if (m) {
        deliveredAt = m.at;
        statusAtDelivery = a.recent[a.recent.indexOf(m) - 1]?.kind ?? '';
        expect(m.detail).toBe('roda o lint também');
      }
    }
    expect(deliveredAt).toBeGreaterThan(start);
    // Entrou depois do fim de um turno (o Codex só usa a fila com a sessão ociosa).
    expect(['done', 'communicate']).toContain(statusAtDelivery);
  });
});
