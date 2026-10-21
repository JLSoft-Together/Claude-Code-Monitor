// Pedidos de permissão fictícios do demo: aparecem na espera, respondem pelo escritório (aprovar, recusar,
// responder a pergunta, devolver ao terminal) e somem quando a espera acaba sozinha.
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../hash';
import { DEMO_CODEX_PERMISSION_MS, demoCodexPermission, demoPermission } from './permission';
import { DemoSimulator } from './simulator';

describe('demoPermission', () => {
  it('monta pedidos completos (título, resumo, argumentos) com prazo', () => {
    const kinds = new Set<string>();
    for (let seed = 1; seed < 60; seed++) {
      const p = demoPermission(`p${seed}`, { files: ['src/app.ts'], commands: ['npm test'] }, mulberry32(seed), 1_000);
      kinds.add(p.tool);
      expect(p).toMatchObject({ id: `p${seed}`, createdAt: 1_000 });
      expect(p.expiresAt).toBeGreaterThan(1_000);
      expect(p.title).toMatch(/^(Bash|Edit|WebFetch|AskUserQuestion)\(/);
      expect(p.input).toBeTruthy();
      expect(p.text).toBeTruthy();
      if (p.tool === 'Bash') expect(p.suggestions).toEqual([{ index: 0, rules: ['Bash(npm test:*)'], destination: 'localSettings' }]);
    }
    expect(kinds).toEqual(new Set(['Bash', 'Edit', 'WebFetch', 'AskUserQuestion']));
  });

  it('pergunta (AskUserQuestion): uma de escolha única e uma de várias, com as posições para responder', () => {
    const p = demoPermission('q', { files: [], commands: [] }, mulberry32(3), 1_000, 'question');
    expect(p).toMatchObject({ tool: 'AskUserQuestion', icon: '❓', inputKind: 'text' });
    expect(p.suggestions).toBeUndefined();
    const qs = p.questions!;
    expect(qs).toHaveLength(2);
    expect(qs.map((q) => q.index)).toEqual([0, 1]);
    expect(qs[0]!.multiSelect).toBeUndefined();
    expect(qs[1]!.multiSelect).toBe(true);
    for (const q of qs) {
      expect(q.header).toBeTruthy();
      expect(q.options.map((o) => o.index)).toEqual(q.options.map((_, i) => i));
      expect(p.input).toContain(q.question);
    }
  });
});

describe('DemoSimulator: pedidos de permissão', () => {
  const start = 10_000;

  it('forcePermission: o agente espera com o pedido; aprovar retoma o trabalho e registra a atividade', () => {
    const sim = new DemoSimulator({ seed: 4, idPrefix: 'demo:' }, start);
    const id = sim.forcePermission(start, 'permission')!;
    let a = sim.snapshot(start).agents.find((x) => x.id === id)!;
    expect(a).toMatchObject({ status: 'waiting', waitingFor: 'aprovar uma permissão' });
    const p = a.permission!;
    expect(p.id.startsWith('demo:perm-')).toBe(true);
    expect(sim.decidePermission('outro', { behavior: 'allow' }, start + 1)).toBe(false);
    expect(sim.decidePermission(p.id, { behavior: 'allow', suggestion: 0 }, start + 1)).toBe(true);
    a = sim.snapshot(start + 1).agents.find((x) => x.id === id)!;
    expect(a.status).toBe('working');
    expect(a.permission).toBeUndefined();
    expect(a.recent.map((r) => r.text)).toContain('Aprovado no Habblaud (sempre permitir)');
    expect(sim.decidePermission(p.id, { behavior: 'allow' }, start + 2)).toBe(false);
  });

  it('recusar retoma com a atividade de recusa; terminal só tira o pedido (a espera continua um pouco)', () => {
    const sim = new DemoSimulator({ seed: 5 }, start);
    const a1 = sim.forcePermission(start, 'permission')!;
    const p1 = sim.snapshot(start).agents.find((x) => x.id === a1)!.permission!;
    sim.decidePermission(p1.id, { behavior: 'deny', message: 'agora não' }, start + 1);
    const after = sim.snapshot(start + 1).agents.find((x) => x.id === a1)!;
    expect(after.status).toBe('working');
    expect(after.recent.at(-1)).toMatchObject({ icon: '🚫', text: 'Recusado no Habblaud' });

    const sim2 = new DemoSimulator({ seed: 6 }, start);
    const a2 = sim2.forcePermission(start, 'permission')!;
    const p2 = sim2.snapshot(start).agents.find((x) => x.id === a2)!.permission!;
    expect(sim2.decidePermission(p2.id, { behavior: 'terminal' }, start + 1)).toBe(true);
    const still = sim2.snapshot(start + 1).agents.find((x) => x.id === a2)!;
    expect(still.status).toBe('waiting');
    expect(still.permission).toBeUndefined();
    let t = start + 1;
    while (t < start + 20_000 && sim2.snapshot(t).agents.find((x) => x.id === a2)?.status === 'waiting') sim2.tick((t += 250));
    expect(sim2.snapshot(t).agents.find((x) => x.id === a2)?.status).toBe('working');
  });

  it('pergunta: responder (answer) retoma com o resumo das escolhas; aprovar ou respostas incompletas não valem', () => {
    const sim = new DemoSimulator({ seed: 7, idPrefix: 'demo:' }, start);
    const id = sim.forcePermission(start, 'question')!;
    const a = sim.snapshot(start).agents.find((x) => x.id === id)!;
    expect(a).toMatchObject({ status: 'waiting', waitingFor: 'responder uma pergunta' });
    const p = a.permission!;
    expect(p.tool).toBe('AskUserQuestion');
    const [single, multi] = p.questions!;
    expect(sim.decidePermission(p.id, { behavior: 'allow' }, start + 1)).toBe(false);
    // Falta a segunda pergunta; escolha única com duas opções.
    expect(sim.decidePermission(p.id, { behavior: 'answer', answers: [{ question: single!.index, options: [0] }] }, start + 1)).toBe(false);
    expect(
      sim.decidePermission(p.id, { behavior: 'answer', answers: [{ question: single!.index, options: [0, 1] }, { question: multi!.index, options: [0] }] }, start + 1),
    ).toBe(false);
    expect(
      sim.decidePermission(p.id, { behavior: 'answer', answers: [{ question: single!.index, options: [1] }, { question: multi!.index, options: [2, 0], other: 'lint também' }] }, start + 1),
    ).toBe(true);
    const after = sim.snapshot(start + 1).agents.find((x) => x.id === id)!;
    expect(after.status).toBe('working');
    expect(after.permission).toBeUndefined();
    const act = after.recent.at(-1)!;
    expect(act).toMatchObject({ icon: '💬', text: 'Respondido no Habblaud' });
    expect(act.detail).toBe(`${single!.header}: ${single!.options[1]!.label} · ${multi!.header}: ${multi!.options[0]!.label}, ${multi!.options[2]!.label}, “lint também”`);
  });

  it('pergunta: recusar e "responder no terminal" também valem', () => {
    const sim = new DemoSimulator({ seed: 8 }, start);
    const id = sim.forcePermission(start, 'question')!;
    const p = sim.snapshot(start).agents.find((x) => x.id === id)!.permission!;
    expect(sim.decidePermission(p.id, { behavior: 'deny', message: 'decida você' }, start + 1)).toBe(true);
    expect(sim.snapshot(start + 1).agents.find((x) => x.id === id)!.recent.at(-1)).toMatchObject({ icon: '🚫', text: 'Recusado no Habblaud' });
  });

  it('com o tempo, as esperas por permissão trazem pedido e ele some quando a espera acaba', () => {
    const sim = new DemoSimulator({ seed: 2, speed: 10, sessions: 5 }, 0);
    let withPermission = 0;
    for (let t = 0; t < 600_000; t += 250) {
      sim.tick(t);
      for (const a of sim.snapshot(t).agents) {
        if (a.permission) {
          withPermission++;
          expect(a.status).toBe('waiting');
        }
        if (a.status !== 'waiting') expect(a.permission).toBeUndefined();
      }
    }
    expect(withPermission).toBeGreaterThan(0);
  });
});

describe('pedidos do Codex (demo)', () => {
  const start = 10_000;

  it('demoCodexPermission: comando, apply_patch ou rede; sem sugestões nem perguntas; prazo de segundos', () => {
    const tools = new Set<string>();
    for (let seed = 1; seed < 80; seed++) {
      const p = demoCodexPermission(`c${seed}`, { files: ['src/app.ts'], commands: ['npm test'] }, mulberry32(seed), 1_000);
      tools.add(p.text.startsWith('Acesso à rede') ? 'rede' : p.tool);
      expect(p).toMatchObject({ provider: 'codex', createdAt: 1_000, expiresAt: 1_000 + DEMO_CODEX_PERMISSION_MS });
      expect(p.suggestions).toBeUndefined();
      expect(p.questions).toBeUndefined();
      expect(p.input).toBeTruthy();
      if (p.tool === 'apply_patch') expect(p.input).toMatch(/^\*\*\* Begin Patch\n\*\*\* Update File: src\/app\.ts\n/);
    }
    expect(tools).toEqual(new Set(['Bash', 'apply_patch', 'rede']));
  });

  it('forcePermission no Codex: espera "aprovar um comando"; recusa só com motivo; sem sempre permitir nem interromper', () => {
    const sim = new DemoSimulator({ seed: 4, idPrefix: 'demo:' }, start);
    const id = sim.forcePermission(start, 'question', 'codex')!;
    const a = sim.snapshot(start).agents.find((x) => x.id === id)!;
    expect(a).toMatchObject({ provider: 'codex', status: 'waiting', waitingFor: 'aprovar um comando' });
    const p = a.permission!;
    expect(p.provider).toBe('codex');
    expect(p.tool).not.toBe('AskUserQuestion');
    expect(sim.decidePermission(p.id, { behavior: 'deny' }, start + 1)).toBe(false);
    expect(sim.decidePermission(p.id, { behavior: 'deny', message: '   ' }, start + 1)).toBe(false);
    expect(sim.decidePermission(p.id, { behavior: 'allow', suggestion: 0 }, start + 1)).toBe(false);
    expect(sim.decidePermission(p.id, { behavior: 'deny', message: 'não', interrupt: true }, start + 1)).toBe(false);
    expect(sim.decidePermission(p.id, { behavior: 'answer', answers: [] }, start + 1)).toBe(false);
    expect(sim.decidePermission(p.id, { behavior: 'deny', message: 'use pnpm' }, start + 1)).toBe(true);
    expect(sim.snapshot(start + 1).agents.find((x) => x.id === id)!.recent.at(-1)).toMatchObject({ text: 'Recusado no Habblaud' });
  });

  it('o prazo do Codex acaba: o pedido sai do escritório e o agente segue esperando no terminal', () => {
    const sim = new DemoSimulator({ seed: 5 }, start);
    const id = sim.forcePermission(start, 'permission', 'codex')!;
    sim.tick(start + DEMO_CODEX_PERMISSION_MS - 1_000);
    expect(sim.snapshot(start + DEMO_CODEX_PERMISSION_MS - 1_000).agents.find((x) => x.id === id)!.permission).toBeDefined();
    sim.tick(start + DEMO_CODEX_PERMISSION_MS);
    const after = sim.snapshot(start + DEMO_CODEX_PERMISSION_MS).agents.find((x) => x.id === id)!;
    expect(after.permission).toBeUndefined();
    expect(after.status).toBe('waiting');
  });

  it('forcePermission sem ferramenta continua escolhendo um agente do Claude Code', () => {
    for (const seed of [4, 5, 6, 7, 8]) {
      const sim = new DemoSimulator({ seed }, start);
      const id = sim.forcePermission(start)!;
      expect(sim.snapshot(start).agents.find((x) => x.id === id)!.provider).toBeUndefined();
    }
  });
});
