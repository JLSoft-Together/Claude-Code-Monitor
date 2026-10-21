// API de depuração do mundo (console: `habblaud.world.debug`), usada em testes visuais para
// forçar cenários: sessões simuladas chegando/saindo, salas fechando, hora do dia, câmera e a
// espera de shell (shells rodando, envelhecer a espera, terminar com sucesso/falha).
import type { Activity, AgentInfo, AgentStatus, RoomInfo, ShellJob } from '../../../shared/types';
import { SPECIAL, type ShellOutcome } from '../../../shared/activity';
import { hash32 } from '../../../shared/hash';
import { TILE } from '../art/api';
import type { Camera } from './camera';
import type { Renderer } from './render/renderer';
import { oldestShell } from './sim/shell';
import type { Sim } from './sim/sim';
import type { GatherKind } from './social/gathering';

/** Um shell para os cenários de depuração: campos de ShellJob opcionais + idade relativa. */
export interface ShellJobInput extends Partial<ShellJob> {
  /** Há quantos minutos o comando começou (ignorado se `startedAt` vier). */
  ageMinutes?: number;
  ageSeconds?: number;
}

export interface SpawnOptions {
  /** Nome do projeto (sala). Padrão: um nome novo; se a sala existir, reaproveita. */
  project?: string;
  name?: string;
  /** Id da conta (AccountInfo.id). */
  account?: string;
  status?: AgentStatus;
  /** Quantos subagentes (trabalhando) disparar junto. */
  subs?: number;
  /**
   * Já começa esperando shell(s): status 'shell' (ou 'working' com `background: false`, um comando
   * longo em primeiro plano). `count` > 1 cria vários (o "×N" da ampulheta).
   */
  shell?: { label?: string; command?: string; ageMinutes?: number; count?: number; background?: boolean; kind?: 'shell' | 'monitor' };
}

export interface WorldDebug {
  /** Resumo do estado: salas (fase, luz) e personagens (modo, passo, posição). */
  state(): unknown;
  /** Abre uma sessão simulada (sala nova se preciso). Retorna o id do agente principal. */
  spawnSession(opts?: SpawnOptions): string;
  /** Muda o status de uma sessão simulada (ex.: 'waiting', 'idle') ou de um subagente simulado. */
  setStatus(agentId: string, status: AgentStatus, waitingFor?: string): void;
  /** Encerra uma sessão simulada (o agente some do snapshot; os subagentes também). */
  endSession(agentId: string): void;
  /** Simula o encerramento de uma sessão real (vai embora; se for o último, apaga a luz). */
  closeSession(agentId: string): void;
  /** Simula o fim de todas as sessões de uma sala: todos saem e a sala some do "snapshot". */
  closeRoom(roomId: string): void;
  /** Desfaz os encerramentos simulados e remove as sessões simuladas. */
  reset(): void;
  /** Força a hora do dia (0–24) para o ciclo dia/noite; null volta à hora local. */
  setHour(hour: number | null): void;
  /** Centraliza a câmera num ponto (tiles) com zoom opcional, sem animação. */
  lookAt(tx: number, ty: number, zoom?: number): void;
  /** Centraliza a câmera numa sala (id ou nome). */
  lookAtRoom(idOrName: string, zoom?: number): void;
  /** Avança todos os comportamentos até o destino (como ao voltar de uma aba oculta). */
  fastForward(): void;
  /** Faz todos os ociosos saírem para passear agora. */
  wanderNow(): void;
  /**
   * Começa uma roda agora com quem estiver ocioso/esperando shell (ou com `ids`): todos voltam à mesa
   * na hora e saem juntos. Retorna os nomes dos participantes ou null.
   */
  socialize(kind: GatherKind, ids?: string[]): string[] | null;
  /** Rodas em andamento: tipo, fase, participantes, placar e aposta. */
  gatherings(): unknown;
  /** Soma (ou tira) moedinhas da carteira de um agente. Retorna o saldo. */
  coins(agentId: string, delta: number): number;
  /**
   * Define os shells que um agente espera (sessão simulada ou agente real; o real fica sobreposto
   * até reset()). Algum em segundo plano -> status 'shell'; só em primeiro plano -> 'working';
   * lista vazia -> 'idle' (se estava em 'shell').
   */
  setShells(agentId: string, jobs: ShellJobInput[]): void;
  /** Envelhece os shells (todas as sessões com shells, ou só um agente) em `minutes` — para ver os estágios. */
  ageShells(minutes: number, agentId?: string): void;
  /**
   * Termina o shell mais antigo (ou todos, `opts.all`) de um agente: registra a Activity 'ShellDone'
   * (error em 'failed'/'killed'), o que dispara o confete ou a chuva. Sem shells em segundo plano
   * restantes, o status vira `opts.then` (padrão 'working': o agente acorda com a notificação).
   */
  finishShell(agentId: string, result?: 'completed' | 'failed' | 'killed', opts?: { all?: boolean; then?: AgentStatus }): void;
  /**
   * Liga a festa (~12 s) ou o alarme (até desligar com `null`) de uma sala (id ou nome), como um evento
   * do GitHub; `agentId` = o responsável (estrela na festa, balão "!" no alarme).
   */
  roomEffect(idOrName: string, kind: 'party' | 'alarm' | null, opts?: { text?: string; agentId?: string }): void;
  readonly sim: Sim;
  readonly camera: Camera;
}

const NAMES = ['Lia', 'Otávio', 'Bruna', 'Caio', 'Iara', 'Rui', 'Nina', 'Davi', 'Tais', 'Ivo'];

export function createDebug(sim: Sim, renderer: Renderer, camera: Camera, onCameraMoved: () => void): WorldDebug {
  let seq = 0;
  const now = () => Date.now();
  const reapply = () => sim.reapply(now());

  const freeSlot = (): number => {
    const used = new Set<number>([...sim.rooms.values()].map((r) => r.slot));
    for (const r of sim.injected.rooms) used.add(r.slot);
    let s = 0;
    while (used.has(s)) s++;
    return s;
  };

  const makeAgent = (base: Partial<AgentInfo> & Pick<AgentInfo, 'id' | 'name' | 'roomId' | 'kind' | 'account' | 'sessionId'>): AgentInfo => {
    const t = now();
    return {
      look: seq % 2 ? 'f' : 'm',
      role: base.kind === 'main' ? 'Agente principal' : 'Explore',
      status: 'working',
      recent: [],
      tasks: base.kind === 'main' ? [{ id: '1', title: 'Testar o mundo', status: 'in_progress' }, { id: '2', title: 'Revisar', status: 'pending' }] : [],
      startedAt: t,
      lastEventAt: t,
      statusSince: t,
      stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 },
      seed: hash32(base.id),
      activity: { id: `dbg-act-${++seq}`, kind: 'edit', icon: '✏️', text: 'Editando world.ts', at: t },
      ...base,
    };
  };

  const makeJobs = (jobs: readonly ShellJobInput[]): ShellJob[] =>
    jobs.map((j) => ({
      id: j.id ?? `bdbg${(++seq).toString(36)}`,
      label: j.label ?? 'Rodar a suíte de testes',
      command: j.command ?? 'npm test',
      startedAt: j.startedAt ?? now() - (j.ageMinutes ?? 0) * 60_000 - (j.ageSeconds ?? 0) * 1000,
      background: j.background ?? true,
      kind: j.kind ?? 'shell',
    }));

  /** Status coerente com os shells: segundo plano -> 'shell'; só primeiro plano -> 'working'. */
  const statusFor = (cur: AgentStatus, shells: readonly ShellJob[]): AgentStatus => {
    if (cur === 'waiting' || cur === 'offline' || cur === 'done') return cur;
    if (shells.some((j) => j.background)) return 'shell';
    if (shells.length) return 'working';
    return cur === 'shell' ? 'idle' : cur;
  };

  /**
   * Edita um agente como um snapshot novo faria (cópia alterada): sessões simuladas diretamente;
   * agentes reais por sobreposição (sim.agentPatches) até reset().
   */
  const editAgent = (id: string, fn: (a: AgentInfo) => void): boolean => {
    const i = sim.injected.agents.findIndex((x) => x.id === id);
    if (i >= 0) {
      const a: AgentInfo = { ...sim.injected.agents[i] };
      fn(a);
      sim.injected.agents[i] = a;
      return true;
    }
    const ch = sim.chars.get(id);
    if (!ch) return false;
    const a: AgentInfo = { ...ch.info };
    fn(a);
    const patch: Partial<AgentInfo> = { ...sim.agentPatches.get(id) };
    for (const k of ['status', 'statusSince', 'shells', 'activity'] as const) if (a[k] !== ch.info[k]) Object.assign(patch, { [k]: a[k] });
    sim.agentPatches.set(id, patch);
    return true;
  };

  const applyShells = (a: AgentInfo, shells: ShellJob[]) => {
    const status = statusFor(a.status, shells);
    if (status !== a.status) a.statusSince = now();
    a.status = status;
    a.shells = shells;
    // como o servidor: o status 'shell' vale desde o início da espera
    const oldest = oldestShell(shells, false);
    if (status === 'shell' && oldest) a.statusSince = Math.min(a.statusSince, oldest.startedAt);
  };

  return {
    state: () => ({
      cols: sim.building.cols,
      camera: { x: Math.round(camera.x), y: Math.round(camera.y), zoom: camera.zoom },
      rooms: [...sim.rooms.values()].map((r) => ({
        id: r.id,
        name: r.info.name,
        slot: r.slot,
        phase: r.phase,
        listed: r.listed,
        lightOn: r.lightOn,
        light: Math.round(r.light(now()) * 100) / 100,
        occupants: sim.occupants(r),
      })),
      chars: [...sim.chars.values()].map((c) => ({
        id: c.id,
        name: c.info.name,
        kind: c.info.kind,
        status: c.info.status,
        mode: c.mode,
        step: c.step?.t ?? null,
        queue: c.queue.map((s) => s.t),
        tile: [c.tx, c.ty],
        room: c.roomId,
        spot: c.atSpot,
        leaving: c.leaving,
        pose: c.pose,
        held: c.held,
        dir: c.dir,
        icon: c.icon,
        shell: c.mode === 'shell' ? { stage: c.shellStage, count: c.shellCount, label: c.shellLabel, ageMin: Math.round(((now() - c.shellSince) / 60_000) * 10) / 10 } : null,
      })),
    }),

    spawnSession: (opts = {}) => {
      const project = opts.project ?? `projeto-teste-${seq + 1}`;
      let room: RoomInfo | undefined = [...sim.rooms.values()].map((r) => r.info).find((r) => r.name === project) ?? sim.injected.rooms.find((r) => r.name === project);
      if (!room) {
        const id = `/debug/${project}`;
        room = { id, name: project, path: id, slot: freeSlot(), seed: hash32(id), createdAt: now() };
        sim.injected.rooms.push(room);
      }
      const n = ++seq;
      const sessionId = `dbg-sess-${n}`;
      const account = opts.account ?? [...sim.accounts.keys()][n % Math.max(1, sim.accounts.size)] ?? '.claude';
      const main = makeAgent({
        id: `dbg:${n}`,
        kind: 'main',
        name: opts.name ?? NAMES[n % NAMES.length],
        roomId: room.id,
        account,
        sessionId,
        status: opts.status ?? 'working',
        title: `Sessão de teste ${n}`,
      });
      if (opts.shell) {
        const sh = opts.shell;
        const n = Math.max(1, Math.floor(sh.count ?? 1));
        const jobs: ShellJobInput[] = [];
        for (let i = 0; i < n; i++) {
          jobs.push({
            label: i === 0 ? sh.label : `${sh.label ?? 'Rodar a suíte de testes'} (${i + 1})`,
            command: sh.command,
            // os demais começaram depois do primeiro
            ageMinutes: Math.max(0, (sh.ageMinutes ?? 0) - i * 0.5),
            background: sh.background ?? true,
            kind: sh.kind,
          });
        }
        applyShells(main, makeJobs(jobs));
        main.activity = { id: `dbg-act-${++seq}`, kind: 'run', icon: '💻', text: 'Rodando em segundo plano', tool: 'Bash', at: now() };
      }
      sim.injected.agents.push(main);
      for (let i = 0; i < (opts.subs ?? 0); i++) {
        const k = ++seq;
        sim.injected.agents.push(
          makeAgent({ id: `${sessionId}:sub${k}`, kind: 'sub', parentId: main.id, name: NAMES[k % NAMES.length], roomId: room.id, account, sessionId, title: 'Investigar o bug' }),
        );
      }
      reapply();
      return main.id;
    },

    setStatus: (id, status, waitingFor) => {
      const i = sim.injected.agents.findIndex((x) => x.id === id);
      if (i < 0) return;
      // cópia nova (como um snapshot de verdade), para o mundo perceber a mudança
      const a: AgentInfo = { ...sim.injected.agents[i] };
      sim.injected.agents[i] = a;
      a.status = status;
      a.statusSince = now();
      a.waitingFor = status === 'waiting' ? (waitingFor ?? 'aprovar uma permissão') : undefined;
      a.activity = {
        id: `dbg-act-${++seq}`,
        kind: status === 'idle' || status === 'done' ? 'done' : status === 'waiting' ? 'wait' : 'run',
        icon: status === 'idle' || status === 'done' ? '✅' : status === 'waiting' ? '✋' : '💻',
        text: status === 'idle' || status === 'done' ? 'Concluiu' : status === 'waiting' ? 'Precisa de você' : 'Rodando testes',
        at: now(),
      };
      reapply();
    },

    endSession: (id) => {
      const main = sim.injected.agents.find((x) => x.id === id);
      sim.injected.agents = sim.injected.agents.filter((x) => x.id !== id && x.parentId !== id);
      if (main && !sim.injected.agents.some((x) => x.roomId === main.roomId)) sim.injected.rooms = sim.injected.rooms.filter((r) => r.id !== main.roomId);
      reapply();
    },

    closeSession: (id) => {
      sim.forcedOffline.add(id);
      for (const c of sim.chars.values()) if (c.info.parentId === id) sim.forcedOffline.add(c.id);
      reapply();
    },

    closeRoom: (roomId) => {
      for (const c of sim.chars.values()) if (c.roomId === roomId) sim.forcedOffline.add(c.id);
      sim.hiddenRooms.add(roomId);
      reapply();
    },

    reset: () => {
      sim.agentPatches.clear();
      sim.forcedOffline.clear();
      sim.hiddenRooms.clear();
      sim.injected.agents = [];
      sim.injected.rooms = [];
      reapply();
    },

    setHour: (h) => {
      renderer.hourOverride = h;
    },

    lookAt: (tx, ty, zoom) => {
      onCameraMoved();
      camera.follow = null;
      camera.stop();
      camera.x = tx * TILE;
      camera.y = ty * TILE;
      if (zoom) camera.zoom = zoom;
      camera.clamp();
    },

    lookAtRoom: (idOrName, zoom = 2.5) => {
      const room = [...sim.rooms.values()].find((r) => r.id === idOrName || r.info.name === idOrName);
      if (!room) return;
      const r = room.layout.rect;
      onCameraMoved();
      camera.follow = null;
      camera.stop();
      camera.x = (r.x + r.w / 2) * TILE;
      camera.y = (r.y + r.h / 2) * TILE;
      camera.zoom = zoom;
      camera.clamp();
    },

    fastForward: () => sim.fastForward(now()),

    wanderNow: () => {
      for (const c of sim.chars.values()) c.nextOutingAt = 1;
    },

    socialize: (kind, ids) => {
      sim.fastForward(now());
      return sim.social.force(kind, now(), ids);
    },

    gatherings: () =>
      [...sim.social.gatherings].map((g) => ({
        kind: g.kind,
        phase: g.phase,
        program: g.program,
        bet: g.bet,
        score: g.score,
        members: g.members.map((m) => ({ name: sim.chars.get(m.id)?.info.name ?? m.id, role: m.role, arrived: m.arrived, left: m.left, pose: m.pose })),
      })),

    coins: (id, delta) => {
      const w = sim.social.wallets.get(id);
      if (!w) return 0;
      if (delta > 0) sim.social.wallets.credit(id, delta, '🛠️', 'Ajuste (depuração)', now());
      else w.coins = Math.max(0, w.coins + delta);
      return w.coins;
    },

    setShells: (id, jobs) => {
      if (editAgent(id, (a) => applyShells(a, makeJobs(jobs)))) reapply();
    },

    ageShells: (minutes, agentId) => {
      const ms = minutes * 60_000;
      if (!Number.isFinite(ms) || !ms) return;
      const ids = agentId ? [agentId] : [...sim.injected.agents.map((a) => a.id), ...sim.agentPatches.keys()];
      for (const id of ids) {
        editAgent(id, (a) => {
          if (!a.shells?.length) return;
          a.shells = a.shells.map((j) => ({ ...j, startedAt: j.startedAt - ms }));
          if (a.status === 'shell') a.statusSince -= ms;
        });
      }
      reapply();
    },

    finishShell: (id, result = 'completed', opts = {}) => {
      const ok = result === 'completed';
      const done = editAgent(id, (a) => {
        const shells = [...(a.shells ?? [])].sort((x, y) => x.startedAt - y.startedAt);
        const ended = opts.all ? shells : shells.slice(0, 1);
        const rest = opts.all ? [] : shells.slice(1);
        const t = now();
        const ms = ended[0] ? t - ended[0].startedAt : undefined;
        // mesmos textos do servidor ("Shell terminou: <rótulo> (<duração>)", "Shell falhou: …")
        const outcome: ShellOutcome = ok ? 'ok' : result === 'killed' ? 'killed' : 'failed';
        const detail = ended.map((j) => j.command ?? j.label).join(' | ') || undefined;
        const activity: Activity = { id: `dbg-act-${++seq}`, at: t, ...SPECIAL.shellDone(ended[0]?.label, outcome, ms, detail) };
        if (ok && ms !== undefined) activity.durationMs = ms;
        a.activity = activity;
        a.recent = [...(a.recent ?? []), activity].slice(-30);
        a.shells = rest;
        const next = rest.some((j) => j.background) ? 'shell' : rest.length ? 'working' : (opts.then ?? 'working');
        if (next !== a.status) {
          a.status = next;
          a.statusSince = t;
        }
      });
      if (done) reapply();
    },

    roomEffect: (idOrName, kind, opts = {}) => {
      const room = [...sim.rooms.values()].find((r) => r.id === idOrName || r.info.name === idOrName);
      if (!room) return;
      if (!kind) {
        sim.roomFx.active.delete(room.id);
        return;
      }
      const t = now();
      const text = opts.text ?? (kind === 'party' ? 'PR #12 mergeado!' : 'CI falhou (main)');
      const agentId = opts.agentId ?? [...sim.chars.values()].find((c) => c.roomId === room.id && !c.leaving)?.id;
      const end = t + (kind === 'party' ? 12_000 : 3_600_000);
      sim.roomFx.active.set(room.id, { roomId: room.id, kind, text, agentId, key: t, start: t, end, cheered: new Set(), sticky: true });
    },

    sim,
    camera,
  };
}
