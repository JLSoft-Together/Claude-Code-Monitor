// Terminal dos agentes de demonstração: uma conversa fictícia e determinística montada
// a partir do título e das atividades do agente simulado (nenhum dado real). Código puro.
//
// Cada atividade vira uma ou mais entradas com ids derivados do id da atividade: quando o servidor
// recalcula a lista com atividades novas, as antigas mantêm os mesmos ids (e só as novas são enviadas).
// O conteúdo inventado (pensamentos, saídas de comandos, trechos de código) sai de um hash do id e só
// depende da própria atividade e de dados fixos do agente: o histórico desliza (guarda só as últimas
// atividades) sem mudar o que já foi mostrado.
//
// Agentes do Codex ganham a conversa no jeito do Codex: comandos no shell (inclusive para ler e buscar: sed, rg),
// edições por apply_patch (o patch inteiro, com a resposta "Success. Updated the following files"), update_plan,
// web_search e spawn_agent.
import type { Activity, AgentInfo, TerminalEntry } from '../types';
import { SHELL_DONE_TOOL, SHELL_WAIT_TOOL } from '../activity';
import { hash32 } from '../hash';
import { MESSAGE_TOOL } from '../messages';
import { demoPatchText } from './permission';
import { tr } from '../i18n';

/**
 * O texto da atividade vem de describeTool, no idioma ativo: compara pelo começo do texto em PT ou da
 * tradução (o que vem antes da primeira lacuna), para a demonstração funcionar em qualquer idioma.
 */
function startsWithText(text: string, key: string): boolean {
  return text.startsWith(key.split('{0}')[0]) || text.startsWith(tr(key, ['\u0000']).split('\u0000')[0]);
}

type ToolEntry = Extract<TerminalEntry, { kind: 'tool' }>;

interface Ctx {
  agent: AgentInfo;
  history: Activity[];
  /** Pasta do projeto (para caminhos relativos), tirada do id da sala. */
  root: string;
  project: string;
  /** Arquivos genéricos do projeto (buscas, git status), na linguagem que o nome do projeto sugere. */
  pool: readonly string[];
  /** Agente do Codex: ferramentas e saídas no jeito dele. */
  codex: boolean;
}

const POOLS: Record<'ts' | 'py' | 'astro', readonly string[]> = {
  ts: ['src/app.ts', 'src/utils/format.ts', 'src/components/Item.tsx', 'tests/app.test.ts'],
  py: ['pipelines/ingest.py', 'pipelines/transform.py', 'tests/test_transform.py', 'requirements.txt'],
  astro: ['src/pages/index.astro', 'src/components/Hero.astro', 'src/content/blog/lancamento.md', 'astro.config.mjs'],
};

function poolFor(project: string): readonly string[] {
  if (/pipeline|data|etl|python/i.test(project)) return POOLS.py;
  if (/site|blog|institucional|landing/i.test(project)) return POOLS.astro;
  return POOLS.ts;
}

/** `n` arquivos distintos do conjunto, escolhidos pelo hash. */
function pickFiles(pool: readonly string[], seed: number, n: number): string[] {
  return Array.from({ length: Math.min(n, pool.length) }, (_, k) => pool[(seed + k) % pool.length]);
}

const pick = <T>(arr: readonly T[], seed: number): T => arr[seed % arr.length];
const num = (seed: number, min: number, max: number) => min + (seed % (max - min + 1));
const hex = (seed: number) => seed.toString(16).padStart(8, '0').slice(0, 7);

function rel(path: string, ctx: Ctx): string {
  return ctx.root && path.startsWith(`${ctx.root}/`) ? path.slice(ctx.root.length + 1) : path;
}

const extOf = (file: string) => /\.([a-z0-9]+)$/i.exec(file)?.[1]?.toLowerCase() ?? 'txt';
const baseName = (file: string) => file.replace(/^.*\//, '').replace(/\.[^.]+$/, '');
const pascal = (s: string) => s.replace(/(^|[-_.\s])(\w)/g, (_, __, c: string) => c.toUpperCase());

// ------------------------------------------------------------------ conteúdo inventado

const THOUGHTS = [
  tr('Antes de mexer, vale entender como esse fluxo está montado hoje.'),
  tr('O mais seguro é cobrir com um teste primeiro e depois ajustar o código.'),
  tr('Acho que o problema está no cálculo; vou conferir quem chama essa função.'),
  tr('Dá para resolver com uma mudança pequena, sem quebrar a API existente.'),
  tr('Preciso checar se outros lugares dependem desse comportamento.'),
];

const SUMMARIES = [
  tr('Pronto! Ajustei o necessário e os testes passaram.'),
  tr('Feito. A mudança ficou pequena e coberta por testes.'),
  tr('Concluí a tarefa; deixei tudo verde no build e nos testes.'),
  tr('Terminei. Se quiser, posso abrir um PR com essas mudanças.'),
];

/** Trecho de código plausível por extensão (para Read e Write). */
function snippet(file: string): string[] {
  const name = pascal(baseName(file));
  switch (extOf(file)) {
    case 'tsx':
      return [
        `import { useMemo } from 'react';`,
        '',
        `export function ${name}({ items }: ${name}Props) {`,
        '  const total = useMemo(() => items.reduce((soma, item) => soma + item.preco * item.qtd, 0), [items]);',
        '  return <Resumo total={total} itens={items.length} />;',
        '}',
      ];
    case 'ts':
    case 'js':
    case 'mjs':
      return [
        `import { db } from './db';`,
        '',
        `export async function ${name.charAt(0).toLowerCase()}${name.slice(1)}(id: string) {`,
        `  const registro = await db.find(id);`,
        `  if (!registro) throw new Error('não encontrado');`,
        '  return registro;',
        '}',
      ];
    case 'py':
      return ['import pandas as pd', '', 'def transformar(df: pd.DataFrame) -> pd.DataFrame:', '    df = df.drop_duplicates(subset=["evento_id"])', '    df["criado_em"] = pd.to_datetime(df["criado_em"], utc=True)', '    return df'];
    case 'sql':
      return ['CREATE TABLE refunds (', '  id UUID PRIMARY KEY,', '  payment_id UUID NOT NULL REFERENCES payments(id),', '  amount NUMERIC(12, 2) NOT NULL,', '  created_at TIMESTAMPTZ NOT NULL DEFAULT now()', ');'];
    case 'css':
      return [':root {', '  --cor-primaria: #1f5fa8;', '  --raio: 8px;', '}', '', '.botao { border-radius: var(--raio); }'];
    case 'json':
      return ['{', `  "name": "projeto-demo",`, '  "version": "1.5.0",', '  "scripts": { "test": "vitest run", "build": "vite build" }', '}'];
    case 'md':
      return ['---', tr('titulo: Lançamento'), '---', '', '# Novidades', '', tr('Agora o site carrega mais rápido.')];
    case 'yml':
    case 'yaml':
      return ['services:', '  db:', '    image: postgres:17', '    ports:', '      - "5432:5432"'];
    case 'astro':
      return ['---', `import Layout from '../layouts/Layout.astro';`, '---', '', '<Layout titulo="Início">', '  <h1>Bem-vindo</h1>', '</Layout>'];
    default:
      return ['User-agent: *', 'Allow: /', '', 'Sitemap: https://www.example.com/sitemap.xml'];
  }
}

/** Par antigo → novo plausível por extensão (para Edit). */
function editPair(file: string, seed: number): [string, string] {
  const pairs: Record<string, Array<[string, string]>> = {
    tsx: [
      ['  const total = items.reduce((soma, item) => soma + item.preco, 0);', '  const total = items.reduce((soma, item) => soma + item.preco * item.qtd, 0);'],
      ['  return <Resumo total={total} />;', '  return <Resumo total={total} itens={items.length} />;'],
    ],
    ts: [
      ["  if (!registro) return null;", "  if (!registro) throw new Error('não encontrado');"],
      ['const LIMITE = 10;', 'const LIMITE = 50;'],
    ],
    py: [['    df["criado_em"] = pd.to_datetime(df["criado_em"])', '    df["criado_em"] = pd.to_datetime(df["criado_em"], utc=True)']],
    sql: [['  amount NUMERIC(10, 2),', '  amount NUMERIC(12, 2) NOT NULL,']],
    css: [['  --cor-primaria: #2b6cb0;', '  --cor-primaria: #1f5fa8;']],
    json: [['  "version": "1.4.0",', '  "version": "1.5.0",']],
    md: [['# Novidades', tr('# Novidades da versão 1.5')]],
    yml: [['    image: postgres:16', '    image: postgres:17']],
    astro: [['  <h1>Bem-vindo</h1>', '  <h1>Bem-vindo à nossa loja</h1>']],
  };
  const ext = extOf(file);
  const key = ext === 'js' || ext === 'mjs' ? 'ts' : ext === 'yaml' ? 'yml' : ext;
  return pick(pairs[key] ?? [['Allow: /', 'Allow: /\nDisallow: /admin']], seed);
}

/** Saída inventada (e coerente) de um comando de shell. */
function commandOutput(command: string, seed: number, ctx: Ctx): string {
  const branch = ctx.agent.gitBranch ?? 'main';
  const [f1, f2] = pickFiles(ctx.pool, seed, 2);
  const n = (min: number, max: number) => num(seed, min, max);
  const secs = `${n(1, 9)}.${n(10, 99)}`;
  if (/playwright\s+test/.test(command)) return `Running ${n(8, 30)} tests using 4 workers\n\n  ✓ ${n(8, 30)} passed (${secs}s)`;
  if (/pytest/.test(command)) return `${'.'.repeat(n(12, 40))}\n${n(12, 40)} passed in ${secs}s`;
  if (/\b(npm|pnpm|yarn)\s+(run\s+)?test\b|vitest|jest/.test(command)) {
    return tr('✓ {0} testes passaram ({1} arquivos)\nDuração: {2}s', [n(20, 140), n(3, 12), secs]);
  }
  if (/^git status/.test(command)) return `On branch ${branch}\nChanges not staged for commit:\n\tmodified:   ${f1}\n\tmodified:   ${f2}\n\nno changes added to commit`;
  if (/^git diff/.test(command)) {
    const [a, b] = editPair(f1, seed);
    return `diff --git a/${f1} b/${f1}\n--- a/${f1}\n+++ b/${f1}\n@@ -${n(5, 80)},1 +${n(5, 80)},1 @@\n-${a}\n+${b}`;
  }
  if (/^git commit/.test(command)) {
    const msg = /-m\s+["']([^"']+)["']/.exec(command)?.[1] ?? 'ajustes';
    return `[${branch} ${hex(seed)}] ${msg}\n ${n(1, 6)} files changed, ${n(10, 160)} insertions(+), ${n(1, 40)} deletions(-)`;
  }
  if (/^git push/.test(command)) return `To git.example.com:empresa/${ctx.project}.git\n   ${hex(seed)}..${hex(hash32(String(seed)))}  ${branch} -> ${branch}`;
  if (/^git pull/.test(command)) return 'Already up to date.';
  if (/\bdb:migrate\b/.test(command)) return tr('Migração 004_refunds aplicada\nSeed concluído ({0} registros)', [n(10, 90)]);
  if (/\b(npm|pnpm|yarn)\s+(run\s+)?build\b|vite\s+build/.test(command)) return `vite v6.3.5 building for production...\n✓ ${n(80, 900)} modules transformed.\n✓ built in ${secs}s`;
  if (/\blint\b/.test(command)) return tr('✓ Nenhum problema encontrado ({0} arquivos)', [n(20, 200)]);
  if (/\bnpm\s+(ci|install|i)\b/.test(command)) return `added ${n(120, 900)} packages, and audited ${n(900, 1200)} packages in ${n(3, 20)}s\n\nfound 0 vulnerabilities`;
  if (/\bpip3?\s+install\b/.test(command)) return 'Successfully installed pandas-2.2.3 numpy-2.1.3 python-dateutil-2.9.0';
  if (/docker\s+pull/.test(command)) return '17: Pulling from library/postgres\nDigest: sha256:3f1a…\nStatus: Downloaded newer image for postgres:17';
  if (/docker\s+compose\s+up/.test(command)) return `[+] Running 2/2\n ✔ Container ${ctx.project}-db-1   Started\n ✔ Container ${ctx.project}-api-1  Started`;
  if (/^psql\b/.test(command)) return ` count\n-------\n  ${n(100, 9000)}\n(1 row)`;
  if (/^curl\b/.test(command)) return `{"status":"ok","uptime":${n(100, 99_999)}}`;
  if (/lighthouse/.test(command)) return tr('Performance: {0}\nAcessibilidade: {1}\nBoas práticas: 100\nSEO: 100', [n(85, 99), n(90, 100)]);
  if (/\b(expo\s+start|npm\s+run\s+dev)\b/.test(command)) return tr('Servidor de desenvolvimento rodando em http://localhost:5173');
  if (/^python3?\s/.test(command)) return tr('Processados {0} registros em {1}s', [n(500, 20_000), secs]);
  return tr('✓ Comando concluído');
}

// ------------------------------------------------------------------ atividades → entradas

/** Chamada de ferramenta seguida do resultado. */
function call(out: TerminalEntry[], a: Activity, tool: string, title: string, result: string, input?: Pick<ToolEntry, 'input' | 'inputKind'>): void {
  const id = `${a.id}:t`;
  const entry: ToolEntry = { kind: 'tool', id, at: a.at, tool, title };
  if (input?.input) Object.assign(entry, input);
  out.push(entry, { kind: 'result', id: `${a.id}:r`, at: a.at, toolUseId: id, text: result });
}

/** O texto da atividade depois do prefixo ("Shell terminou: x" → "x"). */
const afterColon = (s: string) => s.replace(/^[^:]*:\s*/, '');
const quoted = (s: string) => /“(.+)”/.exec(s)?.[1];

/** Comando lançado em segundo plano: na mesma leva (mesmo instante) vem o balão "Esperando o shell". */
function isBackground(i: number, ctx: Ctx): boolean {
  const at = ctx.history[i].at;
  for (let k = i + 1; k < ctx.history.length && ctx.history[k].at === at; k++) {
    if (ctx.history[k].tool === SHELL_WAIT_TOOL) return true;
  }
  return false;
}

function shellCall(out: TerminalEntry[], a: Activity, i: number, command: string, seed: number, ctx: Ctx, output?: string): void {
  const bg = isBackground(i, ctx);
  const result = bg
    ? ctx.codex
      ? tr('Comando rodando em segundo plano (sessão {0}).', [num(seed, 1000, 9999)])
      : tr('Comando rodando em segundo plano (id b{0}). Você recebe um aviso quando ele terminar.', [hex(seed)])
    : (output ?? commandOutput(command, seed, ctx));
  const firstLine = command.split('\n')[0];
  const tool = ctx.codex ? 'Shell' : 'Bash';
  call(out, a, tool, `${tool}(${firstLine}${command.includes('\n') ? ' …' : ''})`, result, { input: command, inputKind: 'command' });
}

/** Codex: edição por apply_patch (o patch é o que se aprova) e a resposta dele. */
function patchCall(out: TerminalEntry[], a: Activity, file: string, lines: readonly string[], add: boolean): void {
  const result = `Success. Updated the following files:\n${add ? 'A' : 'M'} ${file}`;
  call(out, a, 'apply_patch', `apply_patch(${file})`, result, { input: demoPatchText(file, lines, add), inputKind: 'diff' });
}

function entriesFor(a: Activity, i: number, ctx: Ctx, out: TerminalEntry[]): void {
  const seed = hash32(a.id);
  const detail = a.detail?.trim();
  if (a.tool === SHELL_DONE_TOOL) {
    // O rótulo da atividade vem cortado (≤ 46 caracteres): o comando (detalhe) diz mais.
    const took = /\(([^)]+)\)$/.exec(a.text)?.[1];
    const label = detail ? `${detail.split('\n')[0]}${took ? ` (${took})` : ''}` : afterColon(a.text);
    const failed = a.error === true;
    out.push({
      kind: 'system',
      id: `${a.id}:s`,
      at: a.at,
      text: failed ? tr('Tarefa em segundo plano falhou: {0}', [label]) : tr('Tarefa em segundo plano concluída: {0}', [label]),
      level: failed ? 'warn' : 'info',
      detail: failed ? 'exit code 1' : 'exit code 0',
    });
    return;
  }
  if (a.tool === SHELL_WAIT_TOOL) {
    const what = detail ? `\`${detail.split('\n')[0]}\`` : `**${afterColon(a.text)}**`;
    out.push({ kind: 'assistant', id: `${a.id}:a`, at: a.at, text: tr('Deixei rodando em segundo plano: {0}. Volto assim que terminar.', [what]) });
    return;
  }
  // Mensagem mandada pelo escritório: entra na conversa como um prompt seu.
  if (a.tool === MESSAGE_TOOL) {
    out.push({ kind: 'user', id: `${a.id}:u`, at: a.at, text: detail ?? a.text });
    return;
  }
  switch (a.kind) {
    case 'prompt':
      out.push({ kind: 'user', id: `${a.id}:u`, at: a.at, text: detail ?? quoted(a.text) ?? a.text });
      return;
    case 'think': {
      const text = startsWithText(a.text, tr('Pensando')) ? (seed % 3 === 0 ? undefined : pick(THOUGHTS, seed >>> 3)) : tr('Os subagentes terminaram; vou juntar o que cada um encontrou.');
      out.push(text ? { kind: 'thinking', id: `${a.id}:k`, at: a.at, text } : { kind: 'thinking', id: `${a.id}:k`, at: a.at });
      return;
    }
    case 'respond':
      out.push({ kind: 'assistant', id: `${a.id}:a`, at: a.at, text: detail ?? tr('Encontrei o ponto do problema; vou ajustar agora.') });
      return;
    case 'read': {
      if (!detail?.startsWith('/')) break;
      const file = rel(detail, ctx);
      const lines = snippet(file);
      if (ctx.codex) shellCall(out, a, i, `sed -n '1,${lines.length + 40}p' ${file}`, seed, ctx, lines.join('\n'));
      else call(out, a, 'Read', `Read(${file})`, lines.map((l, n) => `${String(n + 1).padStart(6)}\t${l}`).join('\n'));
      return;
    }
    case 'edit': {
      if (!detail?.startsWith('/')) break;
      const file = rel(detail, ctx);
      const [before, after] = editPair(file, seed);
      const lines = [...before.split('\n').map((l) => `- ${l}`), ...after.split('\n').map((l) => `+ ${l}`)];
      if (ctx.codex) patchCall(out, a, file, lines, false);
      else call(out, a, 'Edit', `Edit(${file})`, tr('Arquivo atualizado: {0}', [file]), { input: lines.join('\n'), inputKind: 'diff' });
      return;
    }
    case 'write': {
      if (!detail?.startsWith('/')) break;
      const file = rel(detail, ctx);
      const lines = snippet(file);
      if (ctx.codex) return patchCall(out, a, file, lines, true);
      call(out, a, 'Write', `Write(${file})`, tr('Arquivo criado: {0} ({1} linhas)', [file, lines.length]), { input: lines.map((l) => `+ ${l}`).join('\n'), inputKind: 'diff' });
      return;
    }
    case 'search': {
      const pattern = detail ?? quoted(a.text);
      if (!pattern) break;
      if (startsWithText(a.text, 'Procurando {0}')) {
        const ext = /\*\.(\w+)$/.exec(pattern)?.[1];
        const known = ctx.pool.filter((f) => !ext || f.endsWith(`.${ext}`));
        const found = known.length ? known : [`src/index.${ext}`, `src/app.${ext}`];
        if (ctx.codex) shellCall(out, a, i, `rg --files -g '${pattern}'`, seed, ctx, found.join('\n'));
        else call(out, a, 'Glob', `Glob(${pattern})`, found.join('\n'));
        return;
      }
      const files = pickFiles(ctx.pool, seed, 1 + (seed % 3));
      const matches = files.map((f, k) => `${f}:${num(hash32(`${a.id}:${k}`), 3, 180)}:  ${/^\w+$/.test(pattern) ? `const resultado = ${pattern}(dados);` : pattern}`);
      if (ctx.codex) shellCall(out, a, i, `rg -n ${JSON.stringify(pattern)}`, seed, ctx, matches.join('\n'));
      else call(out, a, 'Grep', `Grep(${pattern})`, matches.join('\n'), { input: '{\n  "output_mode": "content"\n}', inputKind: 'json' });
      return;
    }
    case 'run':
    case 'test':
    case 'git':
      if (!detail) break;
      shellCall(out, a, i, detail.includes(' — ') ? detail.slice(detail.lastIndexOf(' — ') + 3) : detail, seed, ctx);
      return;
    case 'web': {
      if (!detail) break;
      if (startsWithText(a.text, 'Pesquisando “{0}”')) {
        const slug = detail
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
        const results = [tr('{0} — guia completo', [detail]), tr('Documentação oficial: {0}', [detail]), tr('Discussão no fórum: {0}', [detail])];
        const urls = [`https://blog.example.com/${slug}`, `https://docs.example.com/${slug}`, `https://forum.example.com/t/${slug}`];
        const tool = ctx.codex ? 'web_search' : 'WebSearch';
        call(out, a, tool, `${tool}(${detail})`, results.map((r, k) => `${k + 1}. ${r}\n   ${urls[k]}`).join('\n'));
        return;
      }
      if (/^https?:\/\//.test(detail) && ctx.codex) {
        shellCall(out, a, i, `curl -sL ${detail} | head -n 40`, seed, ctx, '<!doctype html>\n<title>Fetch API</title>\n…');
        return;
      }
      if (/^https?:\/\//.test(detail)) {
        call(out, a, 'WebFetch', `WebFetch(${detail})`, tr('A página explica a API com exemplos; o trecho relevante confirma o formato esperado.'), {
          input: tr('Resuma o que importa para a nossa implementação'),
          inputKind: 'text',
        });
        return;
      }
      shellCall(out, a, i, detail, seed, ctx);
      return;
    }
    case 'plan': {
      const [done = 0, total = ctx.agent.tasks.length] = (/(\d+)\/(\d+)/.exec(detail ?? '') ?? []).slice(1).map(Number);
      const list = ctx.agent.tasks.slice(0, total || undefined).map((t, k) => `${k < done ? '☒' : k === done ? '◐' : '☐'} ${t.title}`);
      const tool = ctx.codex ? 'update_plan' : 'TodoWrite';
      call(out, a, tool, total ? tr('{0}({1}/{2} concluídas)', [tool, done, total]) : tool, ctx.codex ? 'Plan updated' : tr('Lista de tarefas atualizada'), list.length ? { input: list.join('\n'), inputKind: 'text' } : undefined);
      return;
    }
    case 'delegate': {
      const desc = afterColon(a.text);
      const type = ctx.codex ? 'worker' : detail?.split(' — ')[0];
      const tool = ctx.codex ? 'spawn_agent' : 'Agent';
      call(out, a, tool, `${tool}(${type ? `${type}: ` : ''}${desc})`, tr('Subagentes trabalhando em paralelo; os resultados chegam quando terminarem.'), {
        input: tr('{0}. Investigue o código de {1} e devolva um resumo curto com os arquivos envolvidos.', [desc, ctx.project]),
        inputKind: 'text',
      });
      return;
    }
    case 'wait':
      out.push({
        kind: 'system',
        id: `${a.id}:s`,
        at: a.at,
        text: startsWithText(a.text, tr('Precisa de você'))
          ? tr('Aguardando você: {0}', [a.text.includes(':') ? afterColon(a.text) : tr('responder no terminal')])
          : startsWithText(a.text, tr('Interrompido por você'))
            ? tr('Interrompido pelo usuário')
            : a.text,
        level: 'warn',
      });
      return;
    case 'done': {
      const text = ctx.agent.kind === 'sub' && ctx.agent.title ? tr('Entrega: {0}. Resumo enviado ao agente principal.', [ctx.agent.title]) : pick(SUMMARIES, seed);
      out.push({ kind: 'assistant', id: `${a.id}:a`, at: a.at, text });
      const took = /Concluiu em (.+)$/.exec(a.text)?.[1];
      if (took) out.push({ kind: 'system', id: `${a.id}:s`, at: a.at, text: tr('Turno concluído em {0}', [took]), level: 'info' });
      return;
    }
    case 'error':
      out.push({ kind: 'system', id: `${a.id}:s`, at: a.at, text: a.text, level: 'error', ...(detail ? { detail } : {}) });
      return;
    case 'compact':
      out.push({ kind: 'system', id: `${a.id}:s`, at: a.at, text: tr('Conversa compactada automaticamente'), level: 'info' });
      return;
    default:
      break;
  }
  // Qualquer outra coisa: uma ferramenta genérica com o detalhe como argumento.
  const tool = a.tool ?? TOOL_BY_KIND[a.kind] ?? tr('Ferramenta');
  call(out, a, tool, detail ? `${tool}(${detail.split('\n')[0]})` : tool, tr('✓ Concluído'));
}

const TOOL_BY_KIND: Partial<Record<Activity['kind'], string>> = {
  communicate: 'SendMessage',
  ask: 'AskUserQuestion',
  skill: 'Skill',
  browser: 'playwright - browser_navigate (MCP)',
  mcp: 'MCP',
  read: 'Read',
  edit: 'Edit',
  write: 'Write',
  search: 'Grep',
  run: 'Bash',
  test: 'Bash',
  git: 'Bash',
  web: 'WebFetch',
};

/** Conversa fictícia do agente de demonstração (da mais antiga para a mais recente). */
export function demoTerminalEntries(agent: AgentInfo, history: Activity[]): TerminalEntry[] {
  const slash = agent.roomId.indexOf('/');
  const root = slash >= 0 ? agent.roomId.slice(slash).replace(/\/+$/, '') : '';
  const project = root.replace(/^.*\//, '') || 'projeto';
  const ctx: Ctx = { agent, history, root, project, pool: poolFor(project), codex: agent.provider === 'codex' };
  const out: TerminalEntry[] = [];
  // Sem nenhuma atividade ainda, o título (a tarefa) abre a conversa. Depois disso, os prompts vêm das
  // próprias atividades: um id ligado ao histórico mudaria quando ele desliza e reapareceria no fim.
  if (!history.length && agent.title) out.push({ kind: 'user', id: `${agent.id}:titulo:${hash32(agent.title).toString(36)}`, at: agent.startedAt, text: agent.title });
  history.forEach((a, i) => entriesFor(a, i, ctx, out));
  return out;
}
