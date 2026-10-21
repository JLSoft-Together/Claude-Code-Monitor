// Modelo de apresentação da UI: agrupamento salas -> agentes -> subagentes, filtros, contadores e rótulos.
// Funções puras (sem DOM), testadas em ui/model.test.ts.
import type { AccountInfo, Activity, AgentInfo, AgentStatus, OfficeSnapshot, RoomInfo, ShellJob, TaskItem } from '../../../shared/types';
import { formatElapsed, normalizeSearch } from './format';
import { tr } from '../../../shared/i18n';

export const STATUS_LABEL: Record<AgentStatus, string> = {
  working: tr('Trabalhando'),
  waiting: tr('Precisa de você'),
  shell: tr('Esperando o shell'),
  idle: tr('Ocioso'),
  done: tr('Concluído'),
  offline: tr('Saindo'),
};

/** Ordem de urgência (menor = mais urgente), usada para destacar quem precisa de atenção. */
const STATUS_URGENCY: Record<AgentStatus, number> = { waiting: 0, shell: 1, working: 2, idle: 3, done: 4, offline: 5 };

export function statusLabel(status: AgentStatus): string {
  return STATUS_LABEL[status];
}

/** Texto da linha de atividade quando o agente ainda não tem nenhuma (ex.: sessão recém-aberta, sem pedido). */
export function activityFallback(agent: Pick<AgentInfo, 'status' | 'waitingFor'>): string {
  switch (agent.status) {
    case 'working':
      return tr('Trabalhando…');
    case 'waiting':
      return agent.waitingFor ? tr('Precisa de você: {0}', [agent.waitingFor]) : tr('Precisa de você');
    case 'shell':
      return tr('Esperando o shell terminar');
    case 'done':
      return tr('Concluiu a tarefa');
    case 'offline':
      return tr('Saindo do escritório');
    default:
      return tr('Aguardando instruções');
  }
}

/** Selo de papel: "Agente principal" ou o tipo do subagente ("Explore", "Plan"...). */
export function roleLabel(agent: Pick<AgentInfo, 'kind' | 'role'>): string {
  if (agent.kind === 'main') return agent.role || tr('Agente principal');
  return agent.role || tr('Subagente');
}

/** Agente ainda "presente" (não está indo embora). */
export function isPresent(agent: Pick<AgentInfo, 'status'>): boolean {
  return agent.status !== 'offline';
}

export interface Counters {
  rooms: number;
  /** Agentes presentes (principais + subagentes, exceto os que estão saindo). */
  agents: number;
  /** Agentes processando um pedido (sem contar quem está parado esperando um comando longo). */
  working: number;
  /** Subagentes ativos (não concluídos nem saindo). */
  subagents: number;
  waiting: number;
  /** Shells que algum agente está esperando terminar (segundo plano e comandos longos em primeiro plano). */
  shells: number;
}

/** `now` (relógio do servidor) decide quando um comando em primeiro plano já conta como espera. */
export function computeCounters(snap: Pick<OfficeSnapshot, 'rooms' | 'agents'> | null, now = Date.now()): Counters {
  const c: Counters = { rooms: 0, agents: 0, working: 0, subagents: 0, waiting: 0, shells: 0 };
  if (!snap) return c;
  c.rooms = snap.rooms.length;
  for (const a of snap.agents) {
    if (!isPresent(a)) continue;
    c.agents++;
    const wait = shellWaitIn(a, snap.agents, now);
    if (wait) c.shells += Math.max(1, wait.jobs.length);
    else if (a.status === 'working') c.working++;
    if (a.status === 'waiting') c.waiting++;
    if (a.kind === 'sub' && a.status !== 'done') c.subagents++;
  }
  return c;
}

/** Agentes esperando o usuário, do que espera há mais tempo para o mais recente. */
export function waitingAgents(agents: readonly AgentInfo[]): AgentInfo[] {
  return agents.filter((a) => a.status === 'waiting').sort((a, b) => a.statusSince - b.statusSince);
}

// ---------------------------------------------------------------- esperando o shell

/** Um comando em primeiro plano só conta como "esperando o shell" depois deste tempo (o mesmo limiar do mundo). */
export const FOREGROUND_WAIT_MS = 10_000;
/** Na gaveta, comandos em primeiro plano só aparecem depois deste tempo (comandos rápidos não fazem a lista piscar). */
export const FOREGROUND_SHOW_MS = 2_000;

export interface ShellWait {
  /** Comandos que o agente está esperando, do mais antigo para o mais recente. */
  jobs: ShellJob[];
  /** Comando que dirige o tempo e a fase da espera (o shell mais antigo); ausente se o servidor ainda não conhece os comandos. */
  main?: ShellJob;
  /** Desde quando espera (epoch ms). */
  since: number;
  /** true = parado num comando longo em primeiro plano (status 'working'); false = terminou o turno (status 'shell'). */
  foreground: boolean;
}

const byStart = (a: ShellJob, b: ShellJob) => a.startedAt - b.startedAt || a.id.localeCompare(b.id);

/**
 * O agente está esperando algum shell terminar? Vale para o status 'shell' (terminou o turno com shells em segundo plano)
 * e para 'working' parado num comando em primeiro plano há mais de FOREGROUND_WAIT_MS. Devolve null caso contrário.
 * O tempo é o do shell (Bash) mais antigo; monitores só contam se não houver nenhum shell.
 */
export function shellWait(agent: Pick<AgentInfo, 'status' | 'shells' | 'statusSince'>, now: number): ShellWait | null {
  const all = agent.shells ?? [];
  let jobs: ShellJob[];
  if (agent.status === 'shell') jobs = all.slice().sort(byStart);
  else if (agent.status === 'working') jobs = all.filter((j) => !j.background && now - j.startedAt >= FOREGROUND_WAIT_MS).sort(byStart);
  else return null;
  if (agent.status === 'working' && jobs.length === 0) return null;
  const main = jobs.find((j) => j.kind === 'shell') ?? jobs[0];
  return { jobs, main, since: Math.min(main?.startedAt ?? agent.statusSince, now), foreground: agent.status === 'working' };
}

/** Shells em segundo plano disparados pelos subagentes (e subagentes deles) de um agente. */
function descendantShells(id: string, agents: readonly AgentInfo[]): ShellJob[] {
  const out: ShellJob[] = [];
  const seen = new Set([id]);
  const queue = [id];
  while (queue.length) {
    const parent = queue.shift()!;
    for (const a of agents) {
      if (a.parentId !== parent || seen.has(a.id)) continue;
      seen.add(a.id);
      queue.push(a.id);
      for (const j of a.shells ?? []) if (j.background) out.push(j);
    }
  }
  return out;
}

/**
 * Como `shellWait`, olhando o escritório todo: um agente em 'shell' sem shells próprios conhecidos pode estar
 * esperando um comando que um subagente dele deixou rodando em segundo plano (o servidor faz o mesmo no balão).
 */
export function shellWaitIn(agent: AgentInfo, agents: readonly AgentInfo[], now: number): ShellWait | null {
  if (agent.status === 'shell' && !agent.shells?.length) {
    const inherited = descendantShells(agent.id, agents);
    if (inherited.length) return shellWait({ status: agent.status, statusSince: agent.statusSince, shells: inherited }, now);
  }
  return shellWait(agent, now);
}

/** Status mostrado na interface: quem está parado esperando um comando longo aparece como "Esperando o shell". */
export function displayStatus(agent: Pick<AgentInfo, 'status' | 'shells' | 'statusSince'>, now: number): AgentStatus {
  return shellWait(agent, now) ? 'shell' : agent.status;
}

/** Comandos listados na gaveta ("Shells rodando"): todos, menos os em primeiro plano recém-iniciados. */
export function visibleShells(agent: Pick<AgentInfo, 'shells'>, now: number): ShellJob[] {
  return (agent.shells ?? []).filter((j) => j.background || j.kind === 'monitor' || now - j.startedAt >= FOREGROUND_SHOW_MS).sort(byStart);
}

/** Agentes esperando shells, de quem espera há mais tempo para o mais recente (botão "⏳ N shells"). */
export function shellWaitingAgents(agents: readonly AgentInfo[], now: number): AgentInfo[] {
  return agents
    .filter((a) => isPresent(a))
    .map((a) => ({ a, w: shellWaitIn(a, agents, now) }))
    .filter((x): x is { a: AgentInfo; w: ShellWait } => !!x.w)
    .sort((x, y) => x.w.since - y.w.since || byArrival(x.a, y.a))
    .map((x) => x.a);
}

/** Há algum shell rodando? (A interface passa a atualizar o cronômetro a cada segundo.) */
export function hasRunningShells(snap: Pick<OfficeSnapshot, 'agents'> | null): boolean {
  return !!snap?.agents.some((a) => isPresent(a) && (a.status === 'shell' || (a.shells?.length ?? 0) > 0));
}

/** Selo do tipo de comando. */
export function shellKindLabel(job: Pick<ShellJob, 'kind' | 'background'>): string {
  if (job.kind === 'monitor') return 'monitor';
  return job.background ? tr('segundo plano') : tr('primeiro plano');
}

export interface ShellLine {
  /** Rótulo do shell principal (ou um texto genérico). */
  label: string;
  /** Cronômetro: "0:42", "12:31", "1:02:10". */
  time: string;
  /** "×2" quando espera mais de um comando; "" com um só. */
  count: string;
  /** Frase completa para dicas e leitores de tela: "⏳ Rodar a suíte · 12:31 (2 shells)". */
  text: string;
}

/** Linha de atividade de quem espera um shell: "⏳ <label> · <tempo>" (e "×N" se vários). */
export function shellLine(wait: ShellWait, now: number): ShellLine {
  const label = wait.main?.label?.trim() || (wait.foreground ? tr('Esperando o comando terminar') : tr('Esperando o shell terminar'));
  const time = formatElapsed(now - wait.since);
  const n = wait.jobs.length;
  const count = n > 1 ? `×${n}` : '';
  return { label, time, count, text: `⏳ ${label} · ${time}${n > 1 ? ` (${n} shells)` : ''}` };
}

/** Texto da caixa "Esperando o shell". */
export function shellBoxText(wait: Pick<ShellWait, 'foreground' | 'jobs'>): string {
  if (wait.foreground) return tr('Está parado num comando no terminal, esperando ele terminar para continuar o turno.');
  const n = wait.jobs.length;
  return n > 1
    ? tr('Terminou o turno e está esperando {0} shells terminarem. A cada um que termina, o agente recebe o resultado.', [n])
    : tr('Terminou o turno e está esperando o shell terminar. Quando ele terminar, o agente recebe o resultado.');
}

export type ShellStage = 'popcorn' | 'spin' | 'cobweb' | 'nap';

export interface ShellStageInfo {
  stage: ShellStage;
  /** A partir de quanto tempo de espera a fase começa (ms). */
  from: number;
  emoji: string;
  /** Frase curta do que o personagem está fazendo. */
  text: string;
  /** Explicação para a ajuda. */
  help: string;
}

const MIN = 60_000;

/** As fases da espera no escritório (a "escalada cômica"), pela idade do shell mais antigo. */
export const SHELL_STAGES: readonly ShellStageInfo[] = [
  {
    stage: 'popcorn',
    from: 0,
    emoji: '🍿',
    text: tr('Comendo pipoca e assistindo ao terminal'),
    help: tr('Até 3 min: recosta na cadeira com um balde de pipoca e assiste ao terminal como se fosse um filme.'),
  },
  {
    stage: 'spin',
    from: 3 * MIN,
    emoji: '🪑',
    text: tr('A pipoca acabou: girando na cadeira'),
    help: tr('De 3 a 10 min: a pipoca acaba; braços cruzados, dedos batendo e, de vez em quando, um giro completo na cadeira.'),
  },
  {
    stage: 'cobweb',
    from: 10 * MIN,
    emoji: '🕸️',
    text: tr('Já tem teia de aranha na cadeira'),
    help: tr('Depois de 10 min: aparece uma teia de aranha na cadeira (ela cresce depois de 20 min) e escapa um bocejo.'),
  },
  {
    stage: 'nap',
    from: 25 * MIN,
    emoji: '😴',
    text: tr('Cochilou esperando o shell'),
    help: tr('Depois de 25 min: cochila na mesa, coberto de teia.'),
  },
];

/** Fase da espera para um shell rodando há `ms`, e quanto falta para a próxima (null na última). */
export function shellStage(ms: number): ShellStageInfo & { nextIn: number | null } {
  const v = Math.max(0, ms);
  let i = 0;
  while (i + 1 < SHELL_STAGES.length && v >= SHELL_STAGES[i + 1].from) i++;
  const next = SHELL_STAGES[i + 1];
  return { ...SHELL_STAGES[i], nextIn: next ? next.from - v : null };
}

/** Marcador do servidor para o fim de um shell (Activity com tool 'ShellDone'; error = falhou ou foi interrompido). */
export function shellDoneKind(activity: Pick<Activity, 'tool' | 'error'> | undefined): 'ok' | 'fail' | null {
  if (activity?.tool !== 'ShellDone') return null;
  return activity.error ? 'fail' : 'ok';
}

export interface TaskProgress {
  completed: number;
  inProgress: number;
  total: number;
}

export function taskProgress(tasks: readonly Pick<TaskItem, 'status'>[]): TaskProgress {
  const p: TaskProgress = { completed: 0, inProgress: 0, total: tasks.length };
  for (const t of tasks) {
    if (t.status === 'completed') p.completed++;
    else if (t.status === 'in_progress') p.inProgress++;
  }
  return p;
}

/** Soma as tarefas de vários agentes (progresso agregado de uma sala). */
export function aggregateTasks(agents: readonly Pick<AgentInfo, 'tasks'>[]): TaskProgress {
  return taskProgress(agents.flatMap((a) => a.tasks));
}

// ---------------------------------------------------------------- agrupamento e filtros

export interface AgentFilter {
  /** Texto livre: nome, papel, título, sala, caminho ou conta. */
  query: string;
  /** Contas ocultas (AccountInfo.id). */
  hiddenAccounts: ReadonlySet<string>;
}

export interface AgentNode {
  agent: AgentInfo;
  /** Subagentes visíveis (após filtros), ordenados por chegada. */
  subs: AgentInfo[];
  /** Total de subagentes presentes no snapshot (independe do filtro). */
  subTotal: number;
}

export interface RoomGroup {
  room: RoomInfo;
  /** Contas presentes na sala (ids, na ordem de `accounts` do snapshot). */
  accounts: string[];
  nodes: AgentNode[];
  /** Todos os agentes da sala (sem filtro). */
  agents: AgentInfo[];
  tasks: TaskProgress;
  /** Quantos agentes da sala passam no filtro. */
  matches: number;
}

function accountText(account: AccountInfo | undefined): string {
  if (!account) return '';
  // A ferramenta entra na busca: "codex" acha os agentes do Codex.
  return [account.short, account.name, account.email ?? '', account.id, account.provider === 'codex' ? 'Codex' : ''].join(' ');
}

/** Verdadeiro se o agente bate com a busca textual (sem acentos, sem diferenciar maiúsculas). */
export function matchesQuery(agent: AgentInfo, room: RoomInfo | undefined, account: AccountInfo | undefined, query: string): boolean {
  const q = normalizeSearch(query);
  if (!q) return true;
  const hay = normalizeSearch(
    [
      agent.name,
      roleLabel(agent),
      agent.title ?? '',
      room?.name ?? '',
      room?.path ?? '',
      accountText(account),
      agent.activity?.text ?? '',
      // Quem espera um shell também aparece ao buscar "shell" (ou pelo rótulo do comando).
      agent.status === 'shell' ? STATUS_LABEL.shell : '',
      ...(agent.shells ?? []).map((j) => `shell ${j.label}`),
    ].join(' \u0001 '),
  );
  return q.split(/\s+/).every((term) => hay.includes(term));
}

const byArrival = (a: AgentInfo, b: AgentInfo) => a.startedAt - b.startedAt || a.id.localeCompare(b.id);

/**
 * Agrupa o snapshot em salas (ordenadas por slot) -> agentes principais -> subagentes.
 * Subagentes cujo pai não está na mesma sala viram itens de primeiro nível.
 * Com filtro: um principal aparece se ele ou algum subagente bater; se o principal bate, todos os subs aparecem.
 * Salas sem nenhum agente visível são omitidas (exceto sem filtro ativo).
 */
export function groupRooms(snap: Pick<OfficeSnapshot, 'rooms' | 'agents' | 'accounts'> | null, filter?: AgentFilter): RoomGroup[] {
  if (!snap) return [];
  const accounts = new Map(snap.accounts.map((a) => [a.id, a]));
  const accountOrder = new Map(snap.accounts.map((a, i) => [a.id, i]));
  const query = filter?.query.trim() ?? '';
  const hidden = filter?.hiddenAccounts ?? new Set<string>();
  const filtering = query.length > 0 || hidden.size > 0;

  const byRoom = new Map<string, AgentInfo[]>();
  for (const a of snap.agents) {
    let list = byRoom.get(a.roomId);
    if (!list) byRoom.set(a.roomId, (list = []));
    list.push(a);
  }

  const groups: RoomGroup[] = [];
  for (const room of [...snap.rooms].sort((a, b) => a.slot - b.slot)) {
    const agents = (byRoom.get(room.id) ?? []).slice().sort(byArrival);
    const visible = (a: AgentInfo) => !hidden.has(a.account) && matchesQuery(a, room, accounts.get(a.account), query);
    const ids = new Set(agents.map((a) => a.id));
    const subsOf = new Map<string, AgentInfo[]>();
    const top: AgentInfo[] = [];
    for (const a of agents) {
      if (a.kind === 'sub' && a.parentId && ids.has(a.parentId)) {
        let list = subsOf.get(a.parentId);
        if (!list) subsOf.set(a.parentId, (list = []));
        list.push(a);
      } else {
        top.push(a);
      }
    }

    const nodes: AgentNode[] = [];
    let matches = 0;
    for (const a of top) {
      const subs = subsOf.get(a.id) ?? [];
      const selfVisible = visible(a);
      const visibleSubs = selfVisible ? subs.filter((s) => !hidden.has(s.account)) : subs.filter(visible);
      if (!selfVisible && visibleSubs.length === 0) continue;
      matches += (selfVisible ? 1 : 0) + visibleSubs.length;
      nodes.push({ agent: a, subs: visibleSubs, subTotal: subs.length });
    }
    if (filtering && nodes.length === 0) continue;

    const present = [...new Set(agents.map((a) => a.account))].sort((x, y) => (accountOrder.get(x) ?? 99) - (accountOrder.get(y) ?? 99));
    groups.push({ room, accounts: present, nodes, agents, tasks: aggregateTasks(agents), matches });
  }
  return groups;
}

/** Contas distintas presentes em uma lista de agentes, na ordem das contas do snapshot. */
export function accountsOf(agents: readonly Pick<AgentInfo, 'account'>[], accounts: readonly Pick<AccountInfo, 'id'>[]): string[] {
  const present = new Set(agents.map((a) => a.account));
  const ordered = accounts.map((a) => a.id).filter((id) => present.has(id));
  for (const id of present) if (!ordered.includes(id)) ordered.push(id);
  return ordered;
}

/** Ordena por urgência e depois por chegada (para listas de subagentes na gaveta). */
export function sortByUrgency(agents: readonly AgentInfo[]): AgentInfo[] {
  return agents.slice().sort((a, b) => STATUS_URGENCY[a.status] - STATUS_URGENCY[b.status] || byArrival(a, b));
}

/** Atalhos de shell para o texto do estado vazio: ["c", "d"] -> "atalhos c ou d". */
export function shortcutHint(accounts: readonly Pick<AccountInfo, 'short'>[]): string {
  const keys = accounts.map((a) => a.short.toLowerCase()).filter((s) => /^[a-z0-9]{1,3}$/.test(s));
  if (keys.length === 0) return '';
  if (keys.length === 1) return tr('atalho {0}', [keys[0]]);
  return tr('atalhos {0} ou {1}', [keys.slice(0, -1).join(', '), keys[keys.length - 1]]);
}

/**
 * Mescla histórico longo (servidor) com as atividades recentes, sem duplicar, do mais antigo ao mais recente.
 * `until` (instante do replay) descarta o que aconteceu depois — ao retroceder, a gaveta não fica com o futuro.
 */
export function mergeHistory<T extends { id: string; at: number }>(history: readonly T[], recent: readonly T[], limit = 200, until?: number): T[] {
  const seen = new Map<string, T>();
  const keep = (a: T) => until === undefined || a.at <= until;
  for (const a of history) if (keep(a)) seen.set(a.id, a);
  for (const a of recent) if (keep(a)) seen.set(a.id, a);
  return [...seen.values()].sort((a, b) => a.at - b.at).slice(-limit);
}
