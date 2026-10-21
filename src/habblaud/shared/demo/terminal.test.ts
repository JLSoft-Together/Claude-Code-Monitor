import { describe, expect, it } from 'vitest';
import type { Activity, AgentInfo, TerminalEntry } from '../types';
import { describePrompt, describeTool, SPECIAL, type ActivityDescription } from '../activity';
import { DemoSimulator } from './simulator';
import { demoTerminalEntries } from './terminal';

const ROOT = '/Users/dev/projetos/loja-virtual';
const T0 = 1_000_000;

function agent(over: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'demo:x-1',
    kind: 'main',
    roomId: `demo:${ROOT}`,
    name: 'Marina',
    look: 'f',
    role: 'Agente principal',
    title: 'Cria a página de checkout com resumo do pedido',
    sessionId: 'demo:sess-1',
    account: 'demo:.claude',
    status: 'working',
    recent: [],
    tasks: [
      { id: '1', title: 'Criar página de checkout', status: 'completed' },
      { id: '2', title: 'Validar formulário de endereço', status: 'in_progress' },
      { id: '3', title: 'Escrever testes do carrinho', status: 'pending' },
    ],
    gitBranch: 'feat/checkout',
    startedAt: T0,
    lastEventAt: T0,
    statusSince: T0,
    stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 },
    seed: 1,
    ...over,
  };
}

/** Atividades como o simulador as cria (mesmas funções de descrição). */
function history(): Activity[] {
  let seq = 0;
  let at = T0;
  const act = (d: ActivityDescription & { tool?: string; error?: boolean }, sameTick = false): Activity => {
    if (!sameTick) at += 2_000;
    return { id: `demo:x-a${++seq}`, at, ...d };
  };
  const bg = { description: 'Rodar a suíte de testes', command: 'npm test -- --runInBand' };
  return [
    act(describePrompt('Cria a página de checkout com resumo do pedido')),
    act(SPECIAL.think()),
    act(describeTool('Read', { file_path: `${ROOT}/src/pages/Checkout.tsx` })),
    act(describeTool('Grep', { pattern: 'useCart' })),
    act(describeTool('Glob', { pattern: '**/*.ts' })),
    act(describeTool('Edit', { file_path: `${ROOT}/src/components/Cart.tsx` })),
    act(describeTool('Write', { file_path: `${ROOT}/src/api/orders.ts` })),
    act(describeTool('Bash', { command: 'npm test' })),
    act(describeTool('Bash', { command: 'git status' })),
    act(describeTool('Bash', { command: 'npm run build' })),
    act(describeTool('WebSearch', { query: 'react checkout form validation' })),
    act(describeTool('WebFetch', { url: 'https://developer.mozilla.org/pt-BR/docs/Web' })),
    act(describeTool('TodoWrite', { todos: [{ status: 'completed' }, { status: 'in_progress' }, { status: 'pending' }] })),
    act(describeTool('Agent', { description: '3 frentes em paralelo', subagent_type: 'general-purpose' })),
    act({ kind: 'think', icon: '📥', text: 'Juntando os resultados da equipe' }),
    act(SPECIAL.waiting('aprovar uma permissão')),
    act(describeTool('Bash', { ...bg, run_in_background: true })),
    act(SPECIAL.waitingShell('Rodar a suíte de testes', 1, bg.command), true),
    act(SPECIAL.shellDone('Rodar a suíte de testes', 'ok', 95_000, bg.command)),
    act(SPECIAL.shellDone('Build de produção', 'failed', 40_000, 'npm run build -- --mode production')),
    act(SPECIAL.turnDone(130_000)),
    act({ kind: 'compact', icon: '🧹', text: 'Organizando a memória (compactando)' }),
    act({ kind: 'error', icon: '⚠️', text: 'Erro em Bash', detail: 'Exit code 1' }),
    act(describeTool('SendMessage', { to: 'Bruno', message: 'pode revisar?' })),
  ];
}

const byActivity = (entries: TerminalEntry[], h: Activity[]) => h.map((a) => entries.filter((e) => e.id.startsWith(`${a.id}:`)));

describe('demoTerminalEntries', () => {
  it('é determinístico e não altera a entrada', () => {
    const h = history();
    const before = JSON.stringify(h);
    const a = demoTerminalEntries(agent(), h);
    const b = demoTerminalEntries(agent(), structuredClone(h));
    expect(b).toEqual(a);
    expect(JSON.stringify(h)).toBe(before);
  });

  it('cada atividade vira entradas com ids derivados dela, únicos, e cada ferramenta tem resultado', () => {
    const h = history();
    const e = demoTerminalEntries(agent(), h);
    expect(new Set(e.map((x) => x.id)).size).toBe(e.length);
    const groups = byActivity(e, h);
    groups.forEach((g) => expect(g.length).toBeGreaterThan(0));
    expect(groups.flat()).toHaveLength(e.length);
    for (const t of e.filter((x) => x.kind === 'tool')) {
      const r = e.find((x) => x.kind === 'result' && x.toolUseId === t.id);
      expect(r && r.kind === 'result' && r.text.length).toBeTruthy();
    }
    // Ordem cronológica.
    expect(e.map((x) => x.at)).toEqual([...e.map((x) => x.at)].sort((x, y) => x - y));
  });

  it('cobre os tipos de atividade com entradas coerentes', () => {
    const h = history();
    const groups = byActivity(demoTerminalEntries(agent(), h), h);
    const kinds = (i: number) => groups[i].map((x) => x.kind);
    const tool = (i: number) => groups[i].find((x) => x.kind === 'tool') as Extract<TerminalEntry, { kind: 'tool' }>;
    const result = (i: number) => groups[i].find((x) => x.kind === 'result') as Extract<TerminalEntry, { kind: 'result' }>;
    const system = (i: number) => groups[i].find((x) => x.kind === 'system') as Extract<TerminalEntry, { kind: 'system' }>;

    expect(groups[0]).toEqual([expect.objectContaining({ kind: 'user', text: 'Cria a página de checkout com resumo do pedido' })]);
    expect(kinds(1)).toEqual(['thinking']);
    expect(tool(2)).toMatchObject({ tool: 'Read', title: 'Read(src/pages/Checkout.tsx)' });
    expect(result(2).text).toMatch(/^ +1\t/);
    expect(tool(3)).toMatchObject({ tool: 'Grep', title: 'Grep(useCart)' });
    expect(result(3).text).toMatch(/^src\/\S+:\d+: .*useCart/);
    expect(tool(4)).toMatchObject({ tool: 'Glob', title: 'Glob(**/*.ts)' });
    // Edit com diff.
    expect(tool(5)).toMatchObject({ tool: 'Edit', title: 'Edit(src/components/Cart.tsx)', inputKind: 'diff' });
    expect(tool(5).input).toMatch(/^- .+\n\+ .+$/);
    expect(tool(6)).toMatchObject({ tool: 'Write', title: 'Write(src/api/orders.ts)', inputKind: 'diff' });
    expect(tool(6).input!.split('\n').every((l) => l.startsWith('+ '))).toBe(true);
    // Bash com comando e saída.
    expect(tool(7)).toMatchObject({ tool: 'Bash', title: 'Bash(npm test)', input: 'npm test', inputKind: 'command' });
    expect(result(7).text).toMatch(/✓ \d+ testes passaram/);
    expect(result(8).text).toContain('On branch feat/checkout');
    expect(result(9).text).toContain('built in');
    expect(tool(10)).toMatchObject({ tool: 'WebSearch', title: 'WebSearch(react checkout form validation)' });
    expect(tool(11)).toMatchObject({ tool: 'WebFetch', title: 'WebFetch(https://developer.mozilla.org/pt-BR/docs/Web)' });
    expect(tool(12)).toMatchObject({ tool: 'TodoWrite', title: 'TodoWrite(1/3 concluídas)' });
    expect(tool(12).input).toBe('☒ Criar página de checkout\n◐ Validar formulário de endereço\n☐ Escrever testes do carrinho');
    expect(tool(13)).toMatchObject({ tool: 'Agent', title: 'Agent(general-purpose: 3 frentes em paralelo)' });
    expect(kinds(14)).toEqual(['thinking']);
    expect(system(15)).toMatchObject({ text: 'Aguardando você: aprovar uma permissão', level: 'warn' });
    // Shell em segundo plano: lançamento, espera e fim (ok e falha).
    expect(result(16).text).toMatch(/segundo plano/);
    expect(groups[17]).toEqual([expect.objectContaining({ kind: 'assistant' })]);
    expect(system(18)).toMatchObject({ text: 'Tarefa em segundo plano concluída: npm test -- --runInBand (1min 35s)', level: 'info' });
    expect(system(19)).toMatchObject({ text: 'Tarefa em segundo plano falhou: npm run build -- --mode production', level: 'warn' });
    // Fim do turno: resumo do assistant e a duração.
    expect(kinds(20)).toEqual(['assistant', 'system']);
    expect(system(20).text).toBe('Turno concluído em 2min 10s');
    expect(system(21).text).toBe('Conversa compactada automaticamente');
    expect(system(22)).toMatchObject({ text: 'Erro em Bash', level: 'error', detail: 'Exit code 1' });
    expect(tool(23)).toMatchObject({ tool: 'SendMessage' });
  });

  it('ids e conteúdo das entradas antigas não mudam quando chegam atividades novas', () => {
    const h = history();
    const full = demoTerminalEntries(agent(), h);
    for (const n of [1, 5, 10, 16, 18, 21]) {
      const part = demoTerminalEntries(agent(), h.slice(0, n));
      expect(full.slice(0, part.length)).toEqual(part);
    }
    // Janela deslizando (o histórico guarda só as últimas atividades): as entradas em comum continuam iguais.
    const slid = demoTerminalEntries(agent(), h.slice(8));
    expect(slid).toEqual(full.slice(full.length - slid.length));
    expect(slid.length).toBeGreaterThan(10);
  });

  it('sem atividades, o título abre a conversa; depois, os prompts vêm das atividades', () => {
    const empty = demoTerminalEntries(agent(), []);
    expect(empty).toEqual([expect.objectContaining({ kind: 'user', text: 'Cria a página de checkout com resumo do pedido', at: T0 })]);
    expect(demoTerminalEntries(agent({ title: undefined }), [])).toEqual([]);
    const withPrompt = demoTerminalEntries(agent(), history().slice(0, 1));
    expect(withPrompt.map((x) => x.kind)).toEqual(['user']);
    expect(withPrompt[0].id).not.toBe(empty[0].id);
  });

  it('com o simulador: conversa de principais e subagentes, estável entre ticks', () => {
    const sim = new DemoSimulator({ seed: 5, idPrefix: 'demo:', speed: 8, sessions: 5 }, 0);
    const lists = new Map<string, TerminalEntry[]>();
    let checked = 0;
    for (let t = 0; t < 300_000; t += 250) {
      sim.tick(t);
      if (t % 5_000) continue;
      for (const a of sim.snapshot(t).agents) {
        const entries = demoTerminalEntries(a, a.recent);
        expect(new Set(entries.map((x) => x.id)).size).toBe(entries.length);
        const prev = lists.get(a.id);
        if (prev) {
          // O que já existia e continua na janela tem o mesmo conteúdo.
          const now = new Map(entries.map((x) => [x.id, x]));
          for (const old of prev) if (now.has(old.id)) expect(now.get(old.id)).toEqual(old);
          checked++;
        }
        lists.set(a.id, entries);
      }
    }
    expect(checked).toBeGreaterThan(20);
    const all = [...lists.values()].flat();
    expect(all.some((x) => x.kind === 'tool' && x.tool === 'Bash' && x.input)).toBe(true);
    expect(all.some((x) => x.kind === 'tool' && x.inputKind === 'diff')).toBe(true);
  });
});

describe('demoTerminalEntries: agente do Codex', () => {
  it('comandos no shell (inclusive ler e buscar), apply_patch com o patch, update_plan, web_search e spawn_agent', () => {
    const h = history();
    const e = demoTerminalEntries(agent({ provider: 'codex', account: 'demo:.codex' }), h);
    expect(new Set(e.map((x) => x.id)).size).toBe(e.length);
    const groups = byActivity(e, h);
    groups.forEach((g) => expect(g.length).toBeGreaterThan(0));
    const tool = (i: number) => groups[i].find((x) => x.kind === 'tool') as Extract<TerminalEntry, { kind: 'tool' }>;
    const result = (i: number) => groups[i].find((x) => x.kind === 'result') as Extract<TerminalEntry, { kind: 'result' }>;
    expect(tool(2)).toMatchObject({ tool: 'Shell', inputKind: 'command' });
    expect(tool(2).title).toMatch(/^Shell\(sed -n '1,\d+p' src\/pages\/Checkout\.tsx\)$/);
    expect(result(2).text).toMatch(/^import /);
    expect(tool(3)).toMatchObject({ tool: 'Shell', title: 'Shell(rg -n "useCart")' });
    expect(tool(4)).toMatchObject({ tool: 'Shell', title: "Shell(rg --files -g '**/*.ts')" });
    // Edição: o patch inteiro (Update File) e a resposta do apply_patch; arquivo novo: Add File.
    expect(tool(5)).toMatchObject({ tool: 'apply_patch', title: 'apply_patch(src/components/Cart.tsx)', inputKind: 'diff' });
    expect(tool(5).input).toMatch(/^\*\*\* Begin Patch\n\*\*\* Update File: src\/components\/Cart\.tsx\n@@\n-.+\n\+.+\n\*\*\* End Patch$/);
    expect(result(5).text).toBe('Success. Updated the following files:\nM src/components/Cart.tsx');
    expect(tool(6).input).toMatch(/^\*\*\* Begin Patch\n\*\*\* Add File: src\/api\/orders\.ts\n\+/);
    expect(result(6).text).toBe('Success. Updated the following files:\nA src/api/orders.ts');
    expect(tool(7)).toMatchObject({ tool: 'Shell', title: 'Shell(npm test)', input: 'npm test' });
    expect(result(7).text).toMatch(/✓ \d+ testes passaram/);
    expect(tool(10)).toMatchObject({ tool: 'web_search', title: 'web_search(react checkout form validation)' });
    expect(tool(11).title).toMatch(/^Shell\(curl -sL https:\/\/developer\.mozilla\.org/);
    expect(tool(12)).toMatchObject({ tool: 'update_plan', title: 'update_plan(1/3 concluídas)' });
    expect(tool(13)).toMatchObject({ tool: 'spawn_agent', title: 'spawn_agent(worker: 3 frentes em paralelo)' });
    expect(result(16).text).toMatch(/segundo plano/);
    // Nada do jeito do Claude Code.
    expect(e.some((x) => x.kind === 'tool' && ['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash', 'TodoWrite', 'Agent', 'WebSearch', 'WebFetch'].includes(x.tool))).toBe(false);
  });

  it('com o simulador: os agentes do Codex ganham a conversa do Codex', () => {
    const sim = new DemoSimulator({ seed: 2, speed: 8, sessions: 5 }, 0);
    for (let t = 0; t < 120_000; t += 250) sim.tick(t);
    const codex = sim.snapshot(120_000).agents.filter((a) => a.provider === 'codex' && a.recent.length);
    expect(codex.length).toBeGreaterThan(0);
    const entries = codex.flatMap((a) => demoTerminalEntries(a, a.recent));
    expect(entries.some((x) => x.kind === 'tool' && (x.tool === 'Shell' || x.tool === 'apply_patch'))).toBe(true);
    expect(entries.some((x) => x.kind === 'tool' && x.tool === 'Bash')).toBe(false);
  });
});
