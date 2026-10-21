// O que a cena Visita mostra, sem DOM (testável): a faixa do topo, o painel lateral (salas e agentes, só leitura), o
// cartão de um agente e as luzes do prédio. Tudo sai do `WorldBuildingDetail` que desceu do mundo: nomes fictícios de
// sala, nome, papel, ferramenta e status de cada agente, e nada de tempo ("há quanto tempo" não existe na visita).
import { tr } from '../../../../shared/i18n';
import { floorLabel } from '../../../../shared/world/floor-labels';
import { hidesAgents, WORLD_TOOL_ACCOUNTS, worldId } from '../../../../shared/world/office-from-world';
import type { WorldAgent, WorldBuildingDetail, WorldBuildingPublic } from '../../../../shared/world/protocol';
import { floorsLabel } from '../city/cards';
import type { VisitLight } from '../sim/sim';

/** As luzes do prédio na visita: apagado (pausado, longe), discreto (salas vazias acesas) ou ao vivo. */
export function visitLightOf(b: Pick<WorldBuildingPublic, 'state' | 'discreet'>): VisitLight {
  if (b.state === 'away') return 'away';
  return b.discreet === true ? 'discreet' : 'live';
}

/** "1 agente", "6 agentes". */
export function agentsLabel(n: number): string {
  return n === 1 ? tr('1 agente') : tr('{0} agentes', [n]);
}

/** "1 visitante agora", "3 visitantes agora". */
export function visitorsLabel(n: number): string {
  return n === 1 ? tr('1 visitante agora') : tr('{0} visitantes agora', [n]);
}

/** Agentes que aparecem (no modo discreto e apagado, nenhum, mesmo que algum venha no pacote por engano). */
function shownAgents(d: WorldBuildingDetail): number {
  if (hidesAgents(d.building)) return 0;
  return d.floors.reduce((n, f) => n + (Array.isArray(f.agents) ? f.agents.length : 0), 0);
}

export interface VisitBanner {
  /** "Prédio de Helena" (ou "Seu prédio, como os outros veem"). */
  title: string;
  /** "3 andares · 6 agentes · modo discreto". */
  details: string[];
  /** Selo do estado: null ao vivo. */
  mode: 'discreet' | 'away' | null;
}

/** A faixa do topo: de quem é, quantos andares e agentes, e se está discreto ou apagado. */
export function visitBanner(d: WorldBuildingDetail, mine: boolean): VisitBanner {
  const b = d.building;
  const light = visitLightOf(b);
  const details = [floorsLabel(d.floors.length)];
  if (light === 'live') details.push(agentsLabel(shownAgents(d)));
  else details.push(light === 'away' ? tr('apagado') : tr('modo discreto'));
  return {
    title: mine ? tr('Seu prédio, como os outros veem') : tr('Prédio de {0}', [b.owner.name]),
    details,
    mode: light === 'live' ? null : light,
  };
}

export type VisitStatus = 'working' | 'waiting' | 'idle' | 'shell';

export interface VisitAgentRow {
  /** Id do agente no escritório da visita (`world:` + id do mundo): o mesmo do personagem desenhado. */
  id: string;
  name: string;
  role: string;
  tool: string;
  status: VisitStatus;
  statusText: string;
}

export interface VisitRoomRow {
  id: string;
  name: string;
  agents: VisitAgentRow[];
}

export interface VisitPanel {
  rooms: VisitRoomRow[];
  /** Por que as salas estão vazias (discreto, apagado), ou null. */
  empty: string | null;
}

const STATUS: readonly VisitStatus[] = ['working', 'waiting', 'idle', 'shell'];

/** "trabalhando", "esperando o dono", "à toa", "de olho no terminal". */
export function statusText(s: VisitStatus): string {
  switch (s) {
    case 'working':
      return tr('trabalhando');
    case 'waiting':
      return tr('esperando o dono');
    case 'shell':
      return tr('de olho no terminal');
    default:
      return tr('à toa');
  }
}

/** Uma linha do painel (nome, papel, ferramenta e status: nada mais existe na visita). */
export function agentRow(a: WorldAgent): VisitAgentRow {
  const status: VisitStatus = STATUS.includes(a.status) ? a.status : 'idle';
  const provider = a.provider === 'codex' ? 'codex' : 'claude';
  return {
    id: worldId(a.id),
    name: typeof a.name === 'string' && a.name ? a.name : tr('Agente'),
    role: a.kind === 'sub' ? tr('Subagente') : tr('Agente principal'),
    tool: WORLD_TOOL_ACCOUNTS[provider].name,
    status,
    statusText: statusText(status),
  };
}

/** O painel lateral: cada sala (o nome fictício traduzido) com os agentes dela. */
export function visitPanel(d: WorldBuildingDetail): VisitPanel {
  const hidden = hidesAgents(d.building);
  const rooms = d.floors.map((f) => ({
    id: f.id,
    name: floorLabel(typeof f.label === 'string' ? f.label : ''),
    agents: hidden || !Array.isArray(f.agents) ? [] : f.agents.map(agentRow),
  }));
  const light = visitLightOf(d.building);
  const empty =
    light === 'away'
      ? tr('Prédio apagado: o dono pausou ou não está com o Habblaud aberto. As salas ficam escuras e vazias.')
      : light === 'discreet'
        ? tr('Modo discreto: o dono não mostra os agentes. As salas aparecem vazias, com a luz acesa.')
        : null;
  return { rooms, empty };
}

/** O agente do painel pelo id do escritório da visita (`world:...`), para o cartão. */
export function findAgent(d: WorldBuildingDetail, id: string): (VisitAgentRow & { room: string }) | null {
  if (hidesAgents(d.building)) return null;
  for (const f of d.floors) {
    for (const a of Array.isArray(f.agents) ? f.agents : []) {
      if (worldId(a.id) === id) return { ...agentRow(a), room: floorLabel(f.label) };
    }
  }
  return null;
}
