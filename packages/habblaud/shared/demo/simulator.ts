// Simulador de escritório para demonstração e desenvolvimento.
// Puro (sem Node/DOM): roda no servidor (HABBLAUD_DEMO=1) e no navegador (?mock=1).
//
// Gera sessões fictícias com ciclos realistas: prompt -> trabalho -> (permissão ou pergunta, com pedido
// fictício para responder pelo escritório) -> (subagentes)
// -> (comando longo em primeiro plano) -> fim de turno -> (esperando shell em segundo plano) ->
// pausa -> ... e encerra sessões de tempos em tempos para exercitar as animações de chegada,
// saída, "apagar a luz" e sumiço de salas.
//
// Parte das sessões é do Codex (conta própria, modelos gpt-*-codex, uso lido "dos arquivos do Codex", pedidos de
// aprovação sem "sempre permitir" e mensagens que entram na fila da sessão). A abertura sempre tem uma sala com
// Claude Code e Codex juntos. Quem é do Codex e o uso dele saem de um sorteio à parte (hash do id da sessão e
// `codexRng`), sem chamadas a mais no sorteio principal; ainda assim o escritório de cada semente mudou em relação
// às versões sem o Codex (a 2ª sessão muda de sala, e os agentes do Codex não sorteiam custo). Vale sempre: a mesma
// semente gera o mesmo escritório.
import type { AccountInfo, AccountUsage, Activity, AgentInfo, FeedItem, Notice, OfficeSnapshot, PermissionDecision, RoomInfo, ShellJob, TaskItem } from '../types';
import { describePrompt, describeShellJob, describeTool, SHELL_DONE_TOOL, SHELL_WAIT_TOOL, SPECIAL, type ActivityDescription, type ShellOutcome } from '../activity';
import { answerSummary, ASK_TOOL, checkAnswers } from '../answers';
import { describeGitHubEvent, GITHUB_TOOL, RoomEffects } from '../github';
import { hash32, mulberry32 } from '../hash';
import { describeMessage, MESSAGE_TOOL } from '../messages';
import { pickName } from '../names';
import { demoGitHubEvent } from './github';
import { demoCodexPermission, demoPermission, type DemoPermissionKind } from './permission';
import { tr } from '../i18n';

interface DemoProject {
  name: string;
  files: string[];
  prompts: string[];
  tasks: string[];
  queries: string[];
  commands: string[];
  greps: string[];
}

const ROOT = '/Users/dev/projetos';

const PROJECTS: DemoProject[] = [
  {
    name: 'loja-virtual',
    files: ['src/pages/Checkout.tsx', 'src/components/Cart.tsx', 'src/api/orders.ts', 'src/hooks/useCart.ts', 'src/styles/theme.css', 'tests/cart.test.ts', 'package.json'],
    prompts: [tr('Cria a página de checkout com resumo do pedido'), tr('O total do carrinho não atualiza ao remover item'), tr('Adiciona cupom de desconto no checkout'), tr('Melhora o layout mobile da vitrine')],
    tasks: [tr('Criar página de checkout'), tr('Validar formulário de endereço'), tr('Integrar cálculo de frete'), tr('Escrever testes do carrinho'), tr('Ajustar layout mobile')],
    queries: ['react checkout form validation', tr('cálculo de frete correios api')],
    commands: ['npm test', 'npm run build', 'git status', 'git diff', 'npm run lint', 'git commit -m "feat: checkout"'],
    greps: ['useCart', 'calculateTotal', 'TODO'],
  },
  {
    name: 'api-pagamentos',
    files: ['src/routes/payments.ts', 'src/services/pix.ts', 'src/db/migrations/004_refunds.sql', 'src/middleware/auth.ts', 'tests/pix.test.ts', 'docker-compose.yml'],
    prompts: [tr('Implementa estorno de pagamentos via Pix'), tr('Os webhooks estão duplicando cobranças, investiga'), tr('Adiciona rate limit nas rotas públicas')],
    tasks: [tr('Mapear fluxo de estorno'), tr('Criar migration de refunds'), tr('Implementar rota POST /refunds'), tr('Idempotência nos webhooks'), tr('Cobrir com testes')],
    queries: [tr('pix devolução api bacen'), 'idempotency key webhook best practices'],
    commands: ['npm test', 'docker compose up -d db', 'psql -c "select count(*) from payments"', 'git status', 'curl -s http://localhost:3000/health'],
    greps: ['webhook', 'idempotencyKey', 'refund'],
  },
  {
    name: 'app-mobile',
    files: ['app/screens/Home.tsx', 'app/screens/Profile.tsx', 'app/navigation/index.tsx', 'app/services/api.ts', 'app.json'],
    prompts: [tr('Cria a tela de perfil com foto e edição'), tr('A navegação trava ao voltar da tela de detalhes'), tr('Adiciona modo escuro no app')],
    tasks: [tr('Criar tela de perfil'), tr('Upload de foto'), tr('Corrigir navegação'), tr('Tema escuro')],
    queries: ['react native navigation goBack freeze', 'expo image picker permissions'],
    commands: ['npx expo start', 'npm test', 'git status', 'npm install react-native-reanimated'],
    greps: ['navigation.goBack', 'useTheme'],
  },
  {
    name: 'data-pipeline',
    files: ['pipelines/ingest.py', 'pipelines/transform.py', 'dags/daily_report.py', 'requirements.txt', 'tests/test_transform.py'],
    prompts: [tr('O relatório diário está vindo com datas erradas'), tr('Adiciona deduplicação na ingestão'), tr('Otimiza a transformação que está lenta')],
    tasks: [tr('Investigar fuso horário'), tr('Corrigir parse de datas'), tr('Deduplicar eventos'), tr('Testes de regressão')],
    queries: ['pandas tz_convert daylight saving', 'airflow dag catchup false'],
    commands: ['pytest -q', 'python pipelines/ingest.py --dry-run', 'pip install -r requirements.txt', 'git status'],
    greps: ['tz_localize', 'drop_duplicates'],
  },
  {
    name: 'site-institucional',
    files: ['src/pages/index.astro', 'src/components/Hero.astro', 'src/content/blog/lancamento.md', 'astro.config.mjs', 'public/robots.txt'],
    prompts: [tr('Cria a seção de depoimentos na home'), tr('Melhora o SEO das páginas do blog'), tr('Adiciona formulário de contato')],
    tasks: [tr('Seção de depoimentos'), tr('Meta tags do blog'), 'Sitemap', tr('Formulário de contato')],
    queries: ['astro sitemap integration', 'schema.org organization json-ld'],
    commands: ['npm run build', 'npm run dev', 'git status', 'npx lighthouse http://localhost:4321'],
    greps: ['<meta', 'description'],
  },
  {
    name: 'chatbot-suporte',
    files: ['bot/handlers/faq.ts', 'bot/llm/prompt.ts', 'bot/integrations/zendesk.ts', 'bot/index.ts', 'tests/faq.test.ts'],
    prompts: [tr('O bot não está encaminhando para humano'), tr('Adiciona integração com o Zendesk'), tr('Melhora o prompt para respostas mais curtas')],
    tasks: [tr('Regra de escalonamento'), tr('Cliente Zendesk'), tr('Ajustar prompt'), tr('Testes de conversa')],
    queries: ['zendesk tickets api create', 'llm handoff to human patterns'],
    commands: ['npm test', 'npm run dev', 'git status', 'git push'],
    greps: ['handoff', 'escalate'],
  },
];

/** Projetos do demo (o histórico fictício do "Meu dia" usa todos, não só as salas abertas no momento). */
export const DEMO_PROJECT_NAMES: readonly string[] = PROJECTS.map((p) => p.name);

const SUB_TYPES = ['Explore', 'general-purpose', 'Plan', 'code-reviewer', 'test-runner'];
const SUB_TASKS = [
  tr('Mapear arquivos envolvidos'),
  tr('Revisar código existente'),
  tr('Pesquisar documentação'),
  tr('Rodar suíte de testes'),
  tr('Investigar causa do bug'),
  tr('Propor plano de implementação'),
  tr('Verificar cobertura de testes'),
  tr('Analisar logs de erro'),
];
const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1'];
/** Modelos das sessões do Codex. */
const CODEX_MODELS = ['gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.1-codex-mini'];
/** Papéis dos subagentes do Codex (o `agent_role` de quem o Codex dispara). */
const CODEX_SUB_ROLES = ['explorer', 'worker', 'reviewer'];
/** Parte das sessões novas que abre no Codex (decidida pelo hash do id da sessão). */
const CODEX_SHARE = 30;

/** Comandos que os agentes deixam rodando em segundo plano (e encerram o turno esperando). */
const BACKGROUND_JOBS: Array<{ description: string; command: string }> = [
  { description: tr('Rodar a suíte de testes'), command: 'npm test -- --runInBand' },
  { description: tr('Build de produção'), command: 'npm run build -- --mode production' },
  { description: tr('Migração do banco'), command: 'npm run db:migrate && npm run db:seed' },
  { description: tr('Rodar os testes de integração'), command: 'pytest -q tests/integration' },
  { description: tr('Gerar o relatório completo'), command: 'python pipelines/report.py --full' },
  { description: tr('Subir os containers'), command: 'docker compose up --build --wait' },
  { description: tr('Testes de ponta a ponta'), command: 'npx playwright test' },
  { description: tr('Auditoria de desempenho'), command: 'npx lighthouse http://localhost:4321 --quiet' },
];
/** Comandos demorados em primeiro plano (o agente fica parado esperando o resultado). */
const FOREGROUND_JOBS: Array<{ description: string; command: string }> = [
  { description: tr('Instalar as dependências'), command: 'npm ci' },
  { description: tr('Rodar os testes do módulo'), command: 'npm test -- src/api' },
  { description: tr('Compilar o projeto'), command: 'npm run build' },
  { description: tr('Baixar a imagem do banco'), command: 'docker pull postgres:17' },
];
/** Chance de, ao fim de um turno, deixar um shell em segundo plano rodando. */
const SHELL_CHANCE = 0.35;
/** Chance, a cada ação, de rodar um comando longo em primeiro plano (no máximo um por turno). */
const FOREGROUND_CHANCE = 0.07;
/** Chance de um shell em segundo plano falhar. */
const SHELL_FAIL_CHANCE = 0.15;

type DemoAccount = Omit<AccountInfo, 'sessions' | 'usage' | 'usageStatus'>;

// No ?mock=1 as contas imitam o cenário real (C e D no Claude Code, mais uma do Codex). Misturado aos dados reais
// no servidor (idPrefix), o demo usa contas próprias, inconfundíveis com as de verdade.
const DEMO_ACCOUNTS: DemoAccount[] = [
  { id: '.claude', short: 'C', name: 'Conta C', email: 'dev@empresa.example', organization: tr('Empresa'), plan: 'Max', color: '#f08a3c', configDir: '~/.claude' },
  { id: '.claude-conta2', short: 'D', name: 'Conta D', email: 'dev@pessoal.example', plan: 'Max', color: '#4aa8e8', configDir: '~/.claude-conta2' },
];
/** Conta do Codex (um CODEX_HOME): sem e-mail (o Habblaud não lê credenciais), com o plano dos `rate_limits`. */
const DEMO_CODEX_ACCOUNT: DemoAccount = { id: '.codex', provider: 'codex', short: 'X', name: 'Codex', plan: 'Team', color: '#a77bf3', configDir: '~/.codex' };
const MERGED_ACCOUNTS: Array<Pick<DemoAccount, 'short' | 'name' | 'color'>> = [
  { short: 'X', name: 'Demo X', color: '#5cc97b' },
  { short: 'Y', name: 'Demo Y', color: '#a77bf3' },
];
const MERGED_CODEX_ACCOUNT: Pick<DemoAccount, 'short' | 'name' | 'color'> = { short: 'Z', name: 'Demo Codex', color: '#f06fa0' };
const HOUR = 3_600_000;
const MINUTE = 60_000;
/** Uso do Codex com mais de 30 min (sem sessão rodando) aparece como antigo, como no servidor. */
const CODEX_STALE_MS = 30 * MINUTE;
/** Mensagem para uma sessão ociosa do Codex: o dono consulta a fila a cada ~10 s (entra entre 2 e 8 s, no demo). */
const CODEX_QUEUE_MIN_MS = 2_000;
const CODEX_QUEUE_SPREAD_MS = 6_000;

type Phase = 'working' | 'waiting' | 'idle' | 'delegating' | 'shell' | 'leaving';

interface SimAgent {
  info: AgentInfo;
  project: DemoProject;
  rng: () => number;
  phase: Phase;
  phaseUntil: number;
  nextActionAt: number;
  actionsLeft: number;
  children: string[];
  closeAt: number;
  removeAt?: number;
  taskCursor: number;
  /** Fim (e desfecho) de cada shell em segundo plano rodando, por id do job. */
  shellEnds: Map<string, { at: number; outcome: ShellOutcome }>;
  /** Comando em primeiro plano rodando até este instante. */
  foregroundUntil?: number;
  /** Já disparou shell (segundo plano) ou comando longo (primeiro plano) neste turno. */
  shelledThisTurn: boolean;
  foregroundThisTurn: boolean;
  /** Codex: mensagens na fila da sessão (entram quando ela fica ociosa) e a partir de quando entram. */
  inbox?: string[];
  inboxAt?: number;
}

export interface DemoTickResult {
  changed: boolean;
  feed: FeedItem[];
  notices: Notice[];
}

export interface DemoOptions {
  seed?: number;
  /** Multiplicador de velocidade (2 = tudo acontece 2x mais rápido). */
  speed?: number;
  /** Quantas sessões principais manter abertas (aprox.). */
  sessions?: number;
  /** Prefixo de ids (o servidor usa "demo:" para não colidir com dados reais). */
  idPrefix?: string;
  /** Conta do Codex sempre "sem cota" (capturas de tela e testes); sem isso, ela fica sem cota só de vez em quando. */
  codexNoQuota?: boolean;
}

const SLOT_COOLDOWN_MS = 30_000;
const OFFLINE_GRACE_MS = 20_000;
const DONE_GRACE_MS = 25_000;

export class DemoSimulator {
  private rng: () => number;
  private speed: number;
  private target: number;
  private prefix: string;
  /** Marca desta instância: ids de agentes/atividades/avisos não se repetem ao religar o demo. */
  private tag: string;
  private accounts: DemoAccount[];
  private agents = new Map<string, SimAgent>();
  private rooms = new Map<string, RoomInfo>();
  private slotFreedAt = new Map<number, number>();
  private rev = 0;
  private dirty = true;
  private seq = 0;
  private nextSpawnAt = 0;
  private startedAt: number;
  private pendingFeed: FeedItem[] = [];
  private pendingNotices: Notice[] = [];
  private usage = new Map<string, { five: number; week: number; fiveReset: number; weekReset: number }>();
  /** Eventos do GitHub fictícios (festa/alarme nas salas): sorteio próprio, sem mexer no resto. */
  private ghRng: () => number;
  private effects = new RoomEffects();
  private nextGitHubAt: number;
  private prSeq: number;
  /** Conta do Codex (fica depois das do Claude Code no snapshot). */
  private codexAccount: DemoAccount;
  /** Sorteio próprio do Codex (uso, "sem cota"): não mexe na sequência do resto. */
  private codexRng: () => number;
  /** Quando os números de uso do Codex foram "lidos" pela última vez: a última atividade de uma sessão do Codex. */
  private codexFetchedAt: number;
  /** "Sem cota" do Codex: sempre (opção) ou em janelas de alguns minutos, de tempos em tempos. */
  private codexNoQuotaAlways: boolean;
  private noQuotaFrom: number;
  private noQuotaUntil: number;
  /** A última leitura do uso do Codex veio "sem cota". */
  private codexReadNoQuota: boolean;
  /** Sessões principais abertas até agora (a 2ª da abertura é a do Codex dividindo a sala da 1ª). */
  private mainsSpawned = 0;

  constructor(opts: DemoOptions = {}, now = Date.now()) {
    this.rng = mulberry32(opts.seed ?? hash32(String(now)));
    this.speed = opts.speed ?? 1;
    // o primeiro evento do GitHub vem logo (para os prints), os outros a cada 35–80 s
    this.ghRng = mulberry32(((opts.seed ?? hash32(String(now))) ^ 0x6a09e667) >>> 0);
    this.nextGitHubAt = now + (10_000 + this.ghRng() * 10_000) / this.speed;
    this.prSeq = 12 + Math.floor(this.ghRng() * 80);
    this.codexRng = mulberry32(((opts.seed ?? hash32(String(now))) ^ 0x3c6ef372) >>> 0);
    this.target = opts.sessions ?? 4;
    this.prefix = opts.idPrefix ?? '';
    this.tag = now.toString(36);
    this.accounts = this.prefix
      ? DEMO_ACCOUNTS.map((acc, i) => ({ ...acc, ...MERGED_ACCOUNTS[i], id: `${this.prefix}${acc.id}`, configDir: tr('(demonstração)') }))
      : DEMO_ACCOUNTS;
    this.codexAccount = this.prefix
      ? { ...DEMO_CODEX_ACCOUNT, ...MERGED_CODEX_ACCOUNT, id: `${this.prefix}${DEMO_CODEX_ACCOUNT.id}`, configDir: tr('(demonstração)') }
      : DEMO_CODEX_ACCOUNT;
    this.startedAt = now;
    this.accounts.forEach((acc, i) =>
      this.usage.set(acc.id, {
        five: 12 + this.rng() * 30,
        week: 20 + this.rng() * 35,
        fiveReset: now + (1.5 + i * 1.7) * HOUR,
        weekReset: now + (2 + i * 2.5) * 24 * HOUR,
      }),
    );
    // Codex: números de antes de o escritório abrir (a última sessão rodou há alguns minutos).
    this.usage.set(this.codexAccount.id, {
      five: 30 + this.codexRng() * 40,
      week: 25 + this.codexRng() * 45,
      fiveReset: now + (0.8 + this.codexRng() * 3) * HOUR,
      weekReset: now + (1 + this.codexRng() * 5) * 24 * HOUR,
    });
    this.codexFetchedAt = now - (4 + this.codexRng() * 20) * MINUTE;
    this.codexNoQuotaAlways = !!opts.codexNoQuota;
    this.noQuotaFrom = now + (6 + this.codexRng() * 6) * MINUTE / this.speed;
    this.noQuotaUntil = this.noQuotaFrom + (2 + this.codexRng() * 2) * MINUTE / this.speed;
    this.codexReadNoQuota = this.codexNoQuotaAlways;
    // Começa com o escritório já movimentado — e com alguém esperando um shell (a espera leva minutos;
    // sem isso, a primeira só apareceria depois do primeiro turno completo).
    for (let i = 0; i < this.target - 1; i++) this.spawnSession(now, true);
    const first = [...this.agents.values()].find((a) => a.info.kind === 'main');
    if (first) this.startBackgroundShells(first, now, true);
    this.nextSpawnAt = now + this.ms(20_000, 40_000);
    // Descarta o feed/avisos de abertura.
    this.pendingFeed = [];
    this.pendingNotices = [];
  }

  /** Muda quantas sessões principais manter abertas (o gerador de timelapse varia isso ao longo do dia). */
  setSessions(n: number): void {
    this.target = Math.max(0, Math.floor(n));
  }

  /**
   * Mensagem mandada pelo escritório a um agente principal (fictícia: nada vai a uma sessão de verdade): a
   * atividade "Mensagem pelo Habblaud" e, se ele estava à toa, o próximo turno começa logo, como se respondesse.
   * false = agente desconhecido, subagente ou que já saiu.
   */
  receiveMessage(agentId: string, text: string, now = Date.now()): boolean {
    const a = this.agents.get(agentId);
    if (!a || a.info.kind !== 'main' || a.removeAt !== undefined || a.phase === 'leaving') return false;
    if (a.info.provider === 'codex') {
      // Codex (`codex queue`): a mensagem entra na fila da sessão e só vira prompt quando ela fica ociosa.
      (a.inbox ??= []).push(text);
      a.inboxAt = Math.max(a.inboxAt ?? 0, now + (CODEX_QUEUE_MIN_MS + (hash32(`${agentId}:${text}:${now}`) % CODEX_QUEUE_SPREAD_MS)) / this.speed);
      return true;
    }
    this.activity(a, now, describeMessage(text));
    if (a.phase === 'idle') a.phaseUntil = Math.min(a.phaseUntil, now + this.ms(1_500, 3_000));
    return true;
  }

  /** Avança a simulação até `now`. */
  tick(now: number): DemoTickResult {
    if (now >= this.nextSpawnAt) {
      const open = [...this.agents.values()].filter((a) => a.info.kind === 'main' && a.phase !== 'leaving').length;
      if (open < this.target) this.spawnSession(now, false);
      this.nextSpawnAt = now + this.ms(25_000, 70_000);
    }
    for (const a of [...this.agents.values()]) this.step(a, now);
    if (now >= this.nextGitHubAt) {
      this.nextGitHubAt = now + (35_000 + this.ghRng() * 45_000) / this.speed;
      this.gitHubEvent(now);
    }
    if (this.effects.prune(now)) this.dirty = true;
    this.gc(now);
    const changed = this.dirty;
    if (changed) this.rev++;
    this.dirty = false;
    const feed = this.pendingFeed;
    const notices = this.pendingNotices;
    this.pendingFeed = [];
    this.pendingNotices = [];
    return { changed, feed, notices };
  }

  snapshot(now = Date.now()): OfficeSnapshot {
    return {
      rev: this.rev,
      serverTime: now,
      rooms: [...this.rooms.values()].map((r) => {
        const effect = this.effects.get(r.id, now);
        return effect ? { ...r, effect: { ...effect } } : { ...r };
      }),
      agents: [...this.agents.values()].map((a) => structuredCloneAgent(a.info)),
      accounts: [
        ...this.accounts.map((acc) => {
          const u = this.usage.get(acc.id)!;
          return {
            ...acc,
            sessions: this.sessionsOf(acc.id),
            usage: {
              fiveHour: { utilization: Math.round(u.five), resetsAt: u.fiveReset },
              sevenDay: { utilization: Math.round(u.week), resetsAt: u.weekReset },
              source: 'statusline' as const,
              fetchedAt: now,
            },
            usageStatus: 'ok' as const,
          };
        }),
        this.codexAccountInfo(now),
      ],
      meta: { demo: true, sources: [], startedAt: this.startedAt, version: 'demo' },
    };
  }

  private sessionsOf(accountId: string): number {
    return [...this.agents.values()].filter((a) => a.info.kind === 'main' && a.info.account === accountId && a.info.status !== 'offline').length;
  }

  /**
   * Conta do Codex: o uso vem "dos arquivos do Codex", lido na última atividade de uma sessão dele (sem sessão
   * rodando, os números envelhecem); "sem cota" = sem janelas, nunca 0%.
   */
  private codexAccountInfo(now: number): AccountInfo {
    const acc = this.codexAccount;
    const u = this.usage.get(acc.id)!;
    const fetchedAt = this.codexFetchedAt;
    const usage: AccountUsage = this.codexReadNoQuota
      ? { source: 'codex', noQuota: true, fetchedAt }
      : {
          fiveHour: { utilization: Math.round(u.five), resetsAt: u.fiveReset },
          sevenDay: { utilization: Math.round(u.week), resetsAt: u.weekReset },
          source: 'codex',
          fetchedAt,
        };
    return { ...acc, sessions: this.sessionsOf(acc.id), usage, usageStatus: now - fetchedAt > CODEX_STALE_MS ? 'stale' : 'ok' };
  }

  /** Sem cota agora: sempre (opção) ou numa janela de alguns minutos que se repete. */
  private codexNoQuota(now: number): boolean {
    if (now >= this.noQuotaUntil) {
      this.noQuotaFrom = now + ((12 + this.codexRng() * 8) * MINUTE) / this.speed;
      this.noQuotaUntil = this.noQuotaFrom + ((2 + this.codexRng() * 2) * MINUTE) / this.speed;
    }
    return this.codexNoQuotaAlways || now >= this.noQuotaFrom;
  }

  // ---------------------------------------------------------------- pedidos de permissão (fictícios)

  /**
   * Resposta a um pedido fictício pelo escritório: aprovar, recusar ou responder a pergunta retomam o
   * trabalho na hora; "responder no terminal" só tira o pedido do escritório (o agente continua esperando
   * um pouco). false = pedido desconhecido (já respondido ou de outra instância) ou resposta que não serve
   * (pergunta só se responde com as respostas, conferidas como no servidor).
   */
  decidePermission(requestId: string, d: PermissionDecision, now = Date.now()): boolean {
    const a = [...this.agents.values()].find((x) => x.info.permission?.id === requestId);
    if (!a || a.phase !== 'waiting') return false;
    const p = a.info.permission!;
    // Codex (como no servidor): sem respostas, sem "sempre permitir" nem interromper, e recusa só com motivo.
    if (p.provider === 'codex' && (d.behavior === 'answer' || d.suggestion !== undefined || d.interrupt || (d.behavior === 'deny' && !d.message?.trim()))) return false;
    const ask = p.tool === ASK_TOOL;
    const answers = d.behavior === 'answer' && ask ? checkAnswers(p.questions ?? [], d.answers) : undefined;
    if ((d.behavior === 'answer' && !answers) || (d.behavior === 'allow' && ask)) return false;
    const title = p.title;
    delete a.info.permission;
    this.dirty = true;
    if (d.behavior === 'terminal') {
      a.phaseUntil = Math.min(a.phaseUntil, now + this.ms(3_000, 8_000));
      return true;
    }
    if (answers) {
      this.activity(a, now, { kind: 'other', icon: '💬', text: tr('Respondido no Habblaud'), detail: answerSummary(p.questions ?? [], answers), tool: 'PermissionRequest' });
    } else if (d.behavior === 'allow') {
      this.activity(a, now, { kind: 'other', icon: '✅', text: d.suggestion !== undefined ? tr('Aprovado no Habblaud (sempre permitir)') : tr('Aprovado no Habblaud'), detail: title, tool: 'PermissionRequest' });
    } else {
      this.activity(a, now, { kind: 'wait', icon: '🚫', text: tr('Recusado no Habblaud'), detail: d.message ? `${title} — ${d.message}` : title, tool: 'PermissionRequest' });
    }
    this.resumeFromWaiting(a, now);
    return true;
  }

  /**
   * Faz um agente principal que está trabalhando (ou, sem nenhum, um ocioso ou esperando um shell) pedir permissão
   * agora (`kind` força uma permissão ou uma pergunta do AskUserQuestion; sem ele, é sorteado). Para testes
   * e capturas de tela; devolve o id do agente. `provider` escolhe a ferramenta do agente (padrão: Claude Code);
   * no Codex o pedido é sempre de aprovação (ele não pergunta pelo escritório).
   */
  forcePermission(now = Date.now(), kind?: DemoPermissionKind, provider: 'claude' | 'codex' = 'claude'): string | undefined {
    const mains = [...this.agents.values()].filter((a) => a.info.kind === 'main' && a.removeAt === undefined && (a.info.provider ?? 'claude') === provider);
    const a = mains.find((x) => x.phase === 'working') ?? mains.find((x) => x.phase === 'idle') ?? mains.find((x) => x.phase === 'shell');
    if (!a) return undefined;
    if (a.phase !== 'working') {
      a.phase = 'working';
      a.actionsLeft = 3;
      this.setStatus(a, 'working', now);
    }
    this.askPermission(a, now, kind);
    return a.info.id;
  }

  /** Para no meio do turno pedindo permissão ou perguntando (com o pedido fictício para responder pelo escritório). */
  private askPermission(a: SimAgent, now: number, kind?: DemoPermissionKind): void {
    a.phase = 'waiting';
    // Com o cartão para responder, a espera é mais longa (dá tempo de clicar).
    a.phaseUntil = now + this.ms(25_000, 50_000);
    const id = `${this.prefix}perm-${this.tag}-${++this.seq}`;
    const codex = a.info.provider === 'codex';
    a.info.permission = codex ? demoCodexPermission(id, a.project, a.rng, now) : demoPermission(id, a.project, a.rng, now, kind);
    const reason = codex ? tr('aprovar um comando') : a.info.permission.tool === ASK_TOOL ? tr('responder uma pergunta') : tr('aprovar uma permissão');
    a.info.waitingFor = reason;
    this.setStatus(a, 'waiting', now);
    this.activity(a, now, SPECIAL.waiting(reason));
    this.notice(now, 'alert', tr('✋ {0} precisa de você em {1}: {2}', [a.info.name, a.project.name, reason]), a.info.id, a.info.roomId);
  }

  private resumeFromWaiting(a: SimAgent, now: number): void {
    a.phase = 'working';
    a.info.waitingFor = undefined;
    delete a.info.permission;
    this.setStatus(a, 'working', now);
    a.nextActionAt = now + this.ms(800, 1_500);
    this.dirty = true;
  }

  // ---------------------------------------------------------------- internos

  private ms(min: number, max: number): number {
    return (min + this.rng() * (max - min)) / this.speed;
  }

  private pick<T>(arr: readonly T[], rng = this.rng): T {
    return arr[Math.floor(rng() * arr.length)];
  }

  private usedNames(): Set<string> {
    return new Set([...this.agents.values()].map((a) => a.info.name));
  }

  private ensureRoom(project: DemoProject, now: number): RoomInfo {
    const id = `${this.prefix}${ROOT}/${project.name}`;
    const existing = this.rooms.get(id);
    if (existing) return existing;
    const used = new Set([...this.rooms.values()].map((r) => r.slot));
    let slot = 0;
    while (used.has(slot) || now - (this.slotFreedAt.get(slot) ?? -Infinity) < SLOT_COOLDOWN_MS) slot++;
    const room: RoomInfo = { id, name: project.name, path: `${ROOT}/${project.name}`, slot, seed: hash32(id), createdAt: now };
    this.rooms.set(id, room);
    this.notice(now, 'info', tr('🏗️ Nova sala: {0}', [project.name]), undefined, id);
    this.dirty = true;
    return room;
  }

  private spawnSession(now: number, warm: boolean): void {
    const k = this.mainsSpawned++;
    const activeRooms = new Set([...this.rooms.values()].map((r) => r.name));
    // 35% de chance de reaproveitar uma sala existente (2 sessões no mesmo projeto).
    const reuse = activeRooms.size > 0 && this.rng() < 0.35;
    const candidates = PROJECTS.filter((p) => (reuse ? activeRooms.has(p.name) : !activeRooms.has(p.name)));
    let project = this.pick(candidates.length ? candidates : PROJECTS);
    // Abertura: a 2ª sessão é do Codex e entra na sala da 1ª (Claude Code e Codex dividindo a sala). O sorteio da
    // sala acontece igual (a sequência das outras sessões não muda); só o resultado é trocado.
    const host = warm && k === 1 ? [...this.agents.values()].find((x) => x.info.kind === 'main') : undefined;
    if (host) project = host.project;
    const room = this.ensureRoom(project, now);
    const n = ++this.seq;
    const sessionId = `${this.prefix}sess-${this.tag}-${n}-${Math.floor(this.rng() * 1e9).toString(36)}`;
    const id = `${this.prefix || 'demo:'}${this.tag}-${n}`;
    // Codex: na abertura, só a 2ª; depois, ~30% das sessões novas (pelo hash do id, sem gastar o sorteio).
    const codex = !!host || (!warm && hash32(`codex:${sessionId}`) % 100 < CODEX_SHARE);
    const person = pickName(sessionId, this.usedNames());
    const rng = mulberry32(hash32(sessionId));
    const tasks: TaskItem[] = project.tasks
      .slice(0, 3 + Math.floor(rng() * 2))
      .map((title, i) => ({ id: String(i + 1), title, status: 'pending' }));
    const claudeAccount = this.rng() < 0.6 ? this.accounts[0].id : this.accounts[1].id;
    const info: AgentInfo = {
      id,
      kind: 'main',
      roomId: room.id,
      name: person.name,
      look: person.look,
      role: tr('Agente principal'),
      title: this.pick(project.prompts, rng),
      sessionId,
      account: codex ? this.codexAccount.id : claudeAccount,
      status: 'idle',
      recent: [],
      tasks,
      model: this.pick(codex ? CODEX_MODELS : MODELS, rng),
      gitBranch: this.pick(['main', 'develop', 'feat/checkout', 'fix/webhooks'], rng),
      // Codex: a política de aprovação (approval_policy) no lugar do modo de permissão do Claude Code.
      permissionMode: codex ? 'on-request' : 'default',
      startedAt: now,
      lastEventAt: now,
      statusSince: now,
      // O Codex não grava custo: só tokens.
      stats: codex
        ? { toolCalls: 0, tokensIn: 0, tokensOut: 0, linesAdded: 0, linesRemoved: 0, subagents: 0 }
        : { toolCalls: 0, tokensIn: 0, tokensOut: 0, costUSD: 0, linesAdded: 0, linesRemoved: 0, subagents: 0 },
      seed: hash32(id),
      // Sessão fictícia "com o plugin de mensagens" (no Codex, "com o entregador"): dá para mandar mensagem pelo
      // escritório (receiveMessage).
      canMessage: true,
    };
    if (codex) info.provider = 'codex';
    const a: SimAgent = {
      info,
      project,
      rng,
      phase: 'idle',
      phaseUntil: now + (warm ? this.ms(0, 8_000) : this.ms(2_000, 5_000)),
      nextActionAt: now,
      actionsLeft: 0,
      children: [],
      closeAt: now + this.ms(150_000, 420_000),
      taskCursor: 0,
      shellEnds: new Map(),
      shelledThisTurn: false,
      foregroundThisTurn: false,
    };
    this.agents.set(id, a);
    const acc = this.accounts.find((x) => x.id === info.account);
    if (!warm) this.notice(now, 'info', tr('👋 {0} chegou em {1}{2}', [info.name, project.name, acc ? ` (${acc.name})` : '']), id, room.id);
    this.dirty = true;
  }

  private spawnSub(parent: SimAgent, now: number): void {
    const n = ++this.seq;
    const agentId = `a${Math.floor(this.rng() * 1e12).toString(16)}`;
    const id = `${parent.info.sessionId}:${agentId}`;
    const person = pickName(id, this.usedNames());
    const rng = mulberry32(hash32(id));
    const desc = this.pick(SUB_TASKS, rng);
    const info: AgentInfo = {
      id,
      kind: 'sub',
      parentId: parent.info.id,
      roomId: parent.info.roomId,
      name: person.name,
      look: person.look,
      role: this.pick(parent.info.provider === 'codex' ? CODEX_SUB_ROLES : SUB_TYPES, rng),
      title: desc,
      sessionId: parent.info.sessionId,
      account: parent.info.account,
      status: 'working',
      recent: [],
      tasks: [],
      model: parent.info.model,
      gitBranch: parent.info.gitBranch,
      startedAt: now,
      lastEventAt: now,
      statusSince: now,
      stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 },
      seed: hash32(id),
      background: rng() < 0.3,
    };
    if (parent.info.provider === 'codex') info.provider = 'codex';
    const sub: SimAgent = {
      info,
      project: parent.project,
      rng,
      phase: 'working',
      phaseUntil: now + this.ms(18_000, 55_000),
      nextActionAt: now + this.ms(1_500, 3_000),
      actionsLeft: 99,
      children: [],
      closeAt: Infinity,
      taskCursor: n,
      shellEnds: new Map(),
      shelledThisTurn: true,
      foregroundThisTurn: true,
    };
    this.agents.set(id, sub);
    parent.children.push(id);
    parent.info.stats.subagents++;
    this.activity(sub, now, { kind: 'prompt', icon: '📨', text: tr('Nova tarefa: “{0}”', [desc]), detail: desc });
    this.dirty = true;
  }

  private step(a: SimAgent, now: number): void {
    if (a.removeAt !== undefined) return;
    if (a.info.kind === 'sub') return this.stepSub(a, now);
    // Codex: as mensagens da fila entram quando a sessão fica ociosa (e ela começa um turno logo depois).
    if (a.inbox?.length && a.phase === 'idle' && now >= (a.inboxAt ?? 0)) {
      for (const text of a.inbox.splice(0)) this.activity(a, now, describeMessage(text));
      a.phaseUntil = Math.min(a.phaseUntil, now + 1_500 / this.speed);
      a.closeAt = Math.max(a.closeAt, now + 30_000 / this.speed);
    }

    // Encerramento da sessão (só quando ocioso, como um usuário fechando o terminal).
    if (now >= a.closeAt && a.phase === 'idle') {
      a.phase = 'leaving';
      this.setStatus(a, 'offline', now);
      delete a.info.canMessage;
      a.removeAt = now + OFFLINE_GRACE_MS;
      this.notice(now, 'info', tr('🚪 {0} encerrou a sessão', [a.info.name]), a.info.id, a.info.roomId);
      return;
    }

    switch (a.phase) {
      case 'idle':
        if (now >= a.phaseUntil) {
          const prompt = this.pick(a.project.prompts, a.rng);
          a.info.title = prompt;
          a.phase = 'working';
          a.shelledThisTurn = false;
          a.foregroundThisTurn = false;
          a.actionsLeft = 5 + Math.floor(a.rng() * 9);
          a.nextActionAt = now + this.ms(1_200, 2_500);
          this.setStatus(a, 'working', now);
          this.activity(a, now, describePrompt(prompt));
          this.advanceTask(a, 'in_progress');
        }
        break;
      case 'waiting':
        // O "hook" desistiu de esperar (no Codex, em segundos): o pedido sai do escritório e vale o terminal.
        if (a.info.permission && now >= a.info.permission.expiresAt) {
          delete a.info.permission;
          this.dirty = true;
        }
        if (now >= a.phaseUntil) {
          // Respondido "no terminal": o pedido some do escritório.
          this.resumeFromWaiting(a, now);
        }
        break;
      case 'delegating': {
        const pending = a.children.filter((c) => this.agents.get(c)?.info.status === 'working');
        if (pending.length === 0) {
          a.phase = 'working';
          a.children = [];
          this.activity(a, now, { kind: 'think', icon: '📥', text: tr('Juntando os resultados da equipe') });
          a.nextActionAt = now + this.ms(2_000, 4_000);
        }
        break;
      }
      case 'shell': {
        // Shell(s) terminando: a notificação acorda o agente, que lê o resultado e trabalha mais um pouco.
        const due = [...a.shellEnds].filter(([, e]) => e.at <= now).map(([id]) => id);
        if (!due.length) break;
        for (const id of due) this.finishShell(a, id, now);
        a.phase = 'working';
        a.actionsLeft = 1 + Math.floor(a.rng() * 3);
        a.nextActionAt = now + this.ms(2_000, 3_500);
        this.setStatus(a, 'working', now);
        break;
      }
      case 'working':
        if (now < a.nextActionAt) break;
        if (a.foregroundUntil !== undefined) this.endForeground(a);
        // Shell em segundo plano terminando no meio do turno: a notificação chega e o agente segue trabalhando.
        for (const [id, end] of [...a.shellEnds]) {
          if (end.at > now) continue;
          this.finishShell(a, id, now);
          a.actionsLeft = Math.max(a.actionsLeft, 1);
          a.nextActionAt = now + this.ms(2_000, 3_500);
        }
        if (now < a.nextActionAt) break;
        if (a.actionsLeft <= 0) {
          // Ainda há shell em segundo plano rodando (já pedido antes): volta a esperar por ele.
          if (a.shellEnds.size) {
            this.waitForShells(a, now, false);
            break;
          }
          if (!a.shelledThisTurn && a.rng() < SHELL_CHANCE) {
            this.startBackgroundShells(a, now, false);
            break;
          }
          a.phase = 'idle';
          a.phaseUntil = now + this.ms(20_000, 75_000);
          this.advanceTask(a, 'completed');
          this.activity(a, now, SPECIAL.turnDone(this.ms(40_000, 240_000) * this.speed));
          this.setStatus(a, 'idle', now);
          this.notice(now, 'success', tr('✅ {0} concluiu em {1}', [a.info.name, a.project.name]), a.info.id, a.info.roomId);
          break;
        }
        a.actionsLeft--;
        {
          const roll = a.rng();
          if (roll < 0.1) {
            this.askPermission(a, now);
          } else if (roll < 0.2 && a.children.length === 0) {
            const count = 2 + Math.floor(a.rng() * 3);
            this.activity(a, now, describeTool('Agent', { description: tr('{0} frentes em paralelo', [count]), subagent_type: 'general-purpose' }));
            for (let i = 0; i < count; i++) this.spawnSub(a, now);
            a.phase = 'delegating';
          } else if (roll < 0.2 + FOREGROUND_CHANCE && !a.foregroundThisTurn && a.actionsLeft > 0) {
            this.startForeground(a, now);
          } else {
            this.activity(a, now, this.randomTool(a));
            a.nextActionAt = now + this.ms(1_800, 5_500);
          }
        }
        break;
      case 'leaving':
        break;
    }
  }

  private stepSub(a: SimAgent, now: number): void {
    if (a.info.status !== 'working') return;
    if (now >= a.phaseUntil) {
      this.activity(a, now, SPECIAL.turnDone(now - a.info.startedAt));
      this.setStatus(a, 'done', now);
      a.removeAt = now + DONE_GRACE_MS;
      const parent = a.info.parentId ? this.agents.get(a.info.parentId) : undefined;
      this.notice(now, 'success', tr('📦 {0} entregou “{1}” para {2}', [a.info.name, a.info.title, parent?.info.name ?? tr('o agente')]), a.info.id, a.info.roomId);
      return;
    }
    if (now >= a.nextActionAt) {
      this.activity(a, now, this.randomTool(a));
      a.nextActionAt = now + this.ms(1_500, 4_500);
    }
  }

  // ---------------------------------------------------------------- shells

  /**
   * Deixa 1 (ou 2) comandos rodando em segundo plano e encerra o turno esperando por eles (status 'shell').
   * `warm` = abertura do escritório: o shell já roda há um tempo e não há aviso.
   */
  private startBackgroundShells(a: SimAgent, now: number, warm: boolean): void {
    const count = a.rng() < 0.25 ? 2 : 1;
    const specs = BACKGROUND_JOBS.slice();
    const jobs: ShellJob[] = [];
    if (warm) {
      a.info.title = this.pick(a.project.prompts, a.rng);
      this.activity(a, now, describePrompt(a.info.title));
    }
    const base = warm ? now - this.ms(20_000, 150_000) : now;
    for (let i = 0; i < count; i++) {
      const spec = specs.splice(Math.floor(a.rng() * specs.length), 1)[0];
      const d = describeShellJob('Bash', spec);
      const id = `b${Math.floor(this.rng() * 2 ** 40).toString(36)}`;
      // Um tool_use depois do outro: o primeiro é o mais antigo (é ele que dá o tempo da espera).
      const job: ShellJob = { id, label: d.label, startedAt: base - (count - 1 - i) * 1_200, background: true, kind: 'shell' };
      if (d.command) job.command = d.command;
      jobs.push(job);
      a.shellEnds.set(id, { at: now + this.ms(40_000, 150_000), outcome: a.rng() < SHELL_FAIL_CHANCE ? 'failed' : 'ok' });
      this.activity(a, now, describeTool('Bash', { ...spec, run_in_background: true }));
    }
    a.info.shells = [...(a.info.shells ?? []), ...jobs].sort(byStart);
    a.shelledThisTurn = true;
    if (!warm) this.advanceTask(a, 'completed');
    this.waitForShells(a, now, !warm);
  }

  /** Fim de turno com shell(s) em segundo plano rodando: fica na mesa esperando. */
  private waitForShells(a: SimAgent, now: number, notify: boolean): void {
    const jobs = (a.info.shells ?? []).filter((j) => j.background);
    const main = jobs[0];
    a.phase = 'shell';
    this.setStatus(a, 'shell', now);
    this.activity(a, now, SPECIAL.waitingShell(main?.label, jobs.length, main?.command));
    if (notify && main) this.notice(now, 'info', tr('⏳ {0} está esperando o shell em {1}: {2}', [a.info.name, a.project.name, main.label]), a.info.id, a.info.roomId);
  }

  /** Um shell em segundo plano terminou: atividade 'ShellDone' (o mundo comemora ou lamenta) e aviso. */
  private finishShell(a: SimAgent, id: string, now: number): void {
    const end = a.shellEnds.get(id);
    a.shellEnds.delete(id);
    const job = a.info.shells?.find((j) => j.id === id);
    this.setShells(a, (a.info.shells ?? []).filter((j) => j.id !== id));
    if (!job || !end) return;
    this.activity(a, now, SPECIAL.shellDone(job.label, end.outcome, now - job.startedAt, job.command));
    if (end.outcome === 'ok') this.notice(now, 'success', tr('✅ {0}: shell terminou em {1} — {2}', [a.info.name, a.project.name, job.label]), a.info.id, a.info.roomId);
    else this.notice(now, 'warn', tr('❌ {0}: shell falhou em {1} — {2}', [a.info.name, a.project.name, job.label]), a.info.id, a.info.roomId);
  }

  /**
   * Evento do GitHub fictício (PR aberto/mergeado, CI, release) num agente principal que está trabalhando
   * ou à toa: atividade, aviso e festa/alarme na sala. Sala com alarme tende a ver o CI voltar a passar.
   */
  private gitHubEvent(now: number): void {
    const mains = [...this.agents.values()].filter((a) => a.info.kind === 'main' && (a.phase === 'working' || a.phase === 'idle'));
    if (!mains.length) return;
    const alarmed = mains.filter((a) => this.effects.get(a.info.roomId, now)?.kind === 'alarm');
    const pool = alarmed.length && this.ghRng() < 0.6 ? alarmed : mains;
    const a = pool[Math.floor(this.ghRng() * pool.length)];
    const alarm = this.effects.get(a.info.roomId, now)?.kind === 'alarm';
    const ev = demoGitHubEvent(this.ghRng, { branch: a.info.gitBranch, alarm, pr: this.prSeq });
    if (ev.kind === 'pr_opened') this.prSeq++;
    const d = describeGitHubEvent(ev, a.info.name, a.project.name);
    this.activity(a, now, d.activity);
    this.notice(now, d.level, d.notice, a.info.id, a.info.roomId);
    if (this.effects.apply(a.info.roomId, ev, now, a.info.id)) this.dirty = true;
  }

  /** Comando demorado em primeiro plano: o agente fica parado esperando o resultado (status continua 'working'). */
  private startForeground(a: SimAgent, now: number): void {
    const spec = this.pick(FOREGROUND_JOBS, a.rng);
    const d = describeShellJob('Bash', spec);
    const job: ShellJob = { id: `toolu_demo_${this.tag}_${++this.seq}`, label: d.label, startedAt: now, background: false, kind: 'shell' };
    if (d.command) job.command = d.command;
    this.setShells(a, [...(a.info.shells ?? []), job]);
    a.foregroundThisTurn = true;
    a.foregroundUntil = now + this.ms(15_000, 40_000);
    a.nextActionAt = a.foregroundUntil;
    this.activity(a, now, describeTool('Bash', spec));
  }

  /** O comando em primeiro plano devolveu o resultado. */
  private endForeground(a: SimAgent): void {
    a.foregroundUntil = undefined;
    this.setShells(a, (a.info.shells ?? []).filter((j) => j.background));
  }

  private setShells(a: SimAgent, jobs: ShellJob[]): void {
    if (jobs.length) a.info.shells = jobs.sort(byStart);
    else delete a.info.shells;
    this.dirty = true;
  }

  private randomTool(a: SimAgent): ActivityDescription {
    const p = a.project;
    const r = a.rng();
    const file = this.pick(p.files, a.rng);
    if (r < 0.26) return describeTool('Read', { file_path: `${ROOT}/${p.name}/${file}` });
    if (r < 0.44) return describeTool('Edit', { file_path: `${ROOT}/${p.name}/${file}` });
    if (r < 0.5) return describeTool('Write', { file_path: `${ROOT}/${p.name}/${file}` });
    if (r < 0.62) return describeTool('Grep', { pattern: this.pick(p.greps, a.rng) });
    if (r < 0.66) return describeTool('Glob', { pattern: '**/*.ts' });
    if (r < 0.82) return describeTool('Bash', { command: this.pick(p.commands, a.rng) });
    if (r < 0.88) return describeTool('WebSearch', { query: this.pick(p.queries, a.rng) });
    if (r < 0.91) return describeTool('WebFetch', { url: 'https://developer.mozilla.org/pt-BR/docs/Web' });
    if (r < 0.95) return SPECIAL.think();
    return describeTool('TodoWrite', { todos: a.info.tasks.map((t) => ({ status: t.status })) });
  }

  private advanceTask(a: SimAgent, status: 'in_progress' | 'completed'): void {
    const tasks = a.info.tasks;
    if (!tasks.length) return;
    if (status === 'in_progress') {
      const next = tasks.find((t) => t.status === 'pending');
      if (next && !tasks.some((t) => t.status === 'in_progress')) next.status = 'in_progress';
    } else {
      const cur = tasks.find((t) => t.status === 'in_progress');
      if (cur) cur.status = 'completed';
    }
    this.dirty = true;
  }

  private setStatus(a: SimAgent, status: AgentInfo['status'], now: number): void {
    if (a.info.status !== status) {
      a.info.status = status;
      a.info.statusSince = now;
      this.dirty = true;
    }
  }

  private activity(a: SimAgent, now: number, d: ActivityDescription & { tool?: string; error?: boolean }): void {
    const act: Activity = { id: `${this.prefix}${this.tag}-a${++this.seq}`, at: now, ...d };
    a.info.activity = act;
    a.info.recent = [...a.info.recent, act].slice(-30);
    a.info.lastEventAt = now;
    const synthetic = d.tool === SHELL_DONE_TOOL || d.tool === SHELL_WAIT_TOOL || d.tool === GITHUB_TOOL || d.tool === MESSAGE_TOOL;
    if (!synthetic && d.kind !== 'prompt' && d.kind !== 'done' && d.kind !== 'wait' && d.kind !== 'think') {
      a.info.stats.toolCalls++;
    }
    // Codex: cada atividade de uma sessão dele renova a leitura do uso (é quando os arquivos ganham rate_limits).
    if (a.info.provider === 'codex') {
      this.codexFetchedAt = now;
      this.codexReadNoQuota = this.codexNoQuota(now);
    }
    const u = this.usage.get(a.info.account);
    if (u) {
      if (now > u.fiveReset) Object.assign(u, { five: 0, fiveReset: now + 5 * HOUR });
      u.five = Math.min(100, u.five + 0.01 + a.rng() * 0.02);
      u.week = Math.min(100, u.week + 0.001 + a.rng() * 0.002);
    }
    a.info.stats.tokensIn += Math.floor(2_000 + a.rng() * 12_000);
    a.info.stats.tokensOut += Math.floor(80 + a.rng() * 900);
    if (a.info.stats.costUSD !== undefined) a.info.stats.costUSD = +(a.info.stats.costUSD + a.rng() * 0.04).toFixed(4);
    if (d.kind === 'edit' || d.kind === 'write') {
      a.info.stats.linesAdded = (a.info.stats.linesAdded ?? 0) + Math.floor(a.rng() * 40);
      a.info.stats.linesRemoved = (a.info.stats.linesRemoved ?? 0) + Math.floor(a.rng() * 15);
    }
    const room = this.rooms.get(a.info.roomId);
    this.pendingFeed.push({
      id: act.id,
      agentId: a.info.id,
      roomId: a.info.roomId,
      agentName: a.info.name,
      roomName: room?.name ?? '',
      account: a.info.account,
      activity: act,
    });
    this.dirty = true;
  }

  private notice(now: number, level: Notice['level'], text: string, agentId?: string, roomId?: string): void {
    const n: Notice = { id: `${this.prefix}${this.tag}-n${++this.seq}`, level, text, at: now };
    if (agentId) n.agentId = agentId;
    if (roomId) n.roomId = roomId;
    this.pendingNotices.push(n);
  }

  private gc(now: number): void {
    for (const [id, a] of this.agents) {
      if (a.removeAt !== undefined && now >= a.removeAt) {
        this.agents.delete(id);
        this.dirty = true;
      }
    }
    const occupied = new Set([...this.agents.values()].map((a) => a.info.roomId));
    for (const [id, room] of this.rooms) {
      if (!occupied.has(id)) {
        this.rooms.delete(id);
        this.slotFreedAt.set(room.slot, now);
        this.dirty = true;
      }
    }
  }
}

const byStart = (x: ShellJob, y: ShellJob) => x.startedAt - y.startedAt || x.id.localeCompare(y.id);

function structuredCloneAgent(a: AgentInfo): AgentInfo {
  const c: AgentInfo = {
    ...a,
    recent: a.recent.slice(),
    tasks: a.tasks.map((t) => ({ ...t })),
    stats: { ...a.stats },
    activity: a.activity ? { ...a.activity } : undefined,
  };
  if (a.shells) c.shells = a.shells.map((j) => ({ ...j }));
  if (a.permission) {
    c.permission = { ...a.permission, suggestions: a.permission.suggestions?.map((s) => ({ ...s, rules: s.rules.slice() })) };
    if (a.permission.questions) c.permission.questions = a.permission.questions.map((q) => ({ ...q, options: q.options.map((o) => ({ ...o })) }));
  }
  return c;
}
