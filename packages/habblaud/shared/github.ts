// GitHub no escritório: PR aberto ou mergeado, push, CI e release viram avisos e efeitos na sala do
// projeto (festa ou alarme). Código puro, usado pelo servidor (eventos detectados nos transcripts, ver
// server/sources/github.ts) e pelo simulador de demonstração.
import { maskSecrets, truncate, type MarkedDescription } from './activity';
import type { NoticeLevel, RoomEffect } from './types';
import { tr } from './i18n';

export type GitHubEventKind = 'pr_opened' | 'pr_merged' | 'push' | 'ci_failed' | 'ci_passed' | 'release';

/** Um evento do GitHub visto num transcript (ou inventado pelo demo). */
export interface GitHubEvent {
  kind: GitHubEventKind;
  /** Número do PR (aberto, mergeado ou cujas checagens rodaram). */
  number?: number;
  /** "dono/repo", quando aparece na URL ou nos argumentos. */
  repo?: string;
  /** Branch do push ou do CI. */
  branch?: string;
  /** Tag da release. */
  tag?: string;
  /** Workflow ou checagem do CI (ex.: "CI", "build-test"). */
  workflow?: string;
  url?: string;
}

/** Marcador (Activity.tool) das atividades sintetizadas a partir de eventos do GitHub. */
export const GITHUB_TOOL = 'GitHub';
/** Duração da festa (PR, merge, release). */
export const PARTY_MS = 12_000;
/** O alarme de CI vermelho acaba com um CI verde na sala ou depois disto. */
export const ALARM_MS = 600_000;

const MAX_TEXT = 46;
const MAX_BANNER = 30;

function clean(s: string, max: number): string {
  return truncate(maskSecrets(s.slice(0, max * 4)), max);
}

/** Onde o CI rodou, para os textos: branch, PR ou workflow. */
function ciWhere(ev: GitHubEvent): string | undefined {
  if (ev.branch) return clean(ev.branch, 28);
  if (ev.number !== undefined) return `PR #${ev.number}`;
  return ev.workflow ? clean(ev.workflow, 28) : undefined;
}

/** O que rodou, para a atividade: o workflow (se não for só "CI"), senão onde. */
function ciWhat(ev: GitHubEvent): string | undefined {
  return ev.workflow && !/^ci$/i.test(ev.workflow.trim()) ? ev.workflow : ciWhere(ev);
}

/** Faixa curta da festa/alarme na sala (undefined = o evento não mexe na sala, ex.: push). */
export function bannerOf(ev: GitHubEvent): string | undefined {
  const pr = ev.number !== undefined ? `PR #${ev.number}` : 'PR';
  switch (ev.kind) {
    case 'pr_opened':
      return tr('{0} aberto!', [pr]);
    case 'pr_merged':
      return tr('{0} mergeado!', [pr]);
    case 'release':
      return ev.tag ? clean(tr('Release {0} no ar!', [ev.tag]), MAX_BANNER) : tr('Release no ar!');
    case 'ci_failed': {
      const where = ciWhere(ev);
      return clean(where ? tr('CI falhou ({0})', [where]) : tr('CI falhou'), MAX_BANNER);
    }
    case 'ci_passed':
      return tr('CI verde de novo!');
    default:
      return undefined;
  }
}

/** Chave de deduplicação dos avisos (o mesmo PR/branch visto por dois comandos seguidos). */
export function githubEventKey(ev: GitHubEvent): string {
  return `${ev.kind}:${ev.number ?? ''}:${ev.branch ?? ''}:${ev.tag ?? ''}`;
}

export interface GitHubEventText {
  /** Aviso (toast). Ex.: "🎉 Danilo abriu o PR #12 em habblaud". */
  notice: string;
  level: NoticeLevel;
  /** Atividade do agente (feed e linha do tempo), com o marcador GITHUB_TOOL. */
  activity: MarkedDescription;
}

/** Textos em PT-BR de um evento: aviso e atividade. */
export function describeGitHubEvent(ev: GitHubEvent, agentName: string, roomName: string): GitHubEventText {
  const pr = ev.number !== undefined ? tr('o PR #{0}', [ev.number]) : tr('um PR');
  const act = (icon: string, text: string, detail?: string, error = false): MarkedDescription => {
    const d: MarkedDescription = { kind: 'git', icon, text: clean(text, MAX_TEXT), tool: GITHUB_TOOL };
    const det = detail ?? ev.url ?? ev.repo;
    if (det) d.detail = clean(det, 300);
    if (error) d.error = true;
    return d;
  };
  switch (ev.kind) {
    case 'pr_opened':
      return { notice: tr('🎉 {0} abriu {1} em {2}', [agentName, pr, roomName]), level: 'success', activity: act('🎉', tr('Abriu {0}', [pr])) };
    case 'pr_merged':
      return { notice: tr('🎉 {0} mergeou {1} em {2}', [agentName, pr, roomName]), level: 'success', activity: act('🎉', tr('Mergeou {0}', [pr])) };
    case 'release': {
      const tag = ev.tag ? clean(ev.tag, 24) : undefined;
      return {
        notice: tr('🎉 {0} publicou {1} em {2}', [agentName, tag ? tr('a release {0}', [tag]) : tr('uma release'), roomName]),
        level: 'success',
        activity: act('🎉', tag ? tr('Publicou a release {0}', [tag]) : tr('Publicou uma release')),
      };
    }
    case 'push': {
      const branch = ev.branch ? clean(ev.branch, 28) : undefined;
      return {
        notice: tr('🚀 {0} enviou commits {1}em {2}', [agentName, branch ? tr('para {0} ', [branch]) : '', roomName]),
        level: 'info',
        activity: act('🚀', branch ? tr('Enviou commits para {0}', [branch]) : tr('Enviou commits ao GitHub')),
      };
    }
    case 'ci_failed': {
      const where = ciWhere(ev);
      const what = ciWhat(ev);
      return {
        notice: tr('🚨 CI falhou em {0}{1}', [roomName, where ? ` (${where})` : '']),
        level: 'warn',
        activity: act('🚨', what ? tr('CI falhou: {0}', [what]) : tr('CI falhou'), [ev.workflow, ev.branch, ev.url].filter(Boolean).join(' — ') || undefined, true),
      };
    }
    case 'ci_passed': {
      const where = ciWhere(ev);
      const what = ciWhat(ev);
      return {
        notice: tr('✅ CI passou em {0}{1}', [roomName, where ? ` (${where})` : '']),
        level: 'success',
        activity: act('✅', what ? tr('CI passou: {0}', [what]) : tr('CI passou'), [ev.workflow, ev.branch, ev.url].filter(Boolean).join(' — ') || undefined),
      };
    }
  }
}

// ------------------------------------------------------------------ efeitos das salas

interface RoomSlots {
  party?: RoomEffect;
  alarm?: RoomEffect;
}

/**
 * Ciclo de vida dos efeitos das salas: festa (PR aberto/mergeado, release; e CI verde que apaga um
 * alarme) por PARTY_MS; alarme (CI vermelho) até um CI verde na sala ou ALARM_MS. Uma festa passa na
 * frente do alarme enquanto dura (o alarme continua valendo por baixo); um CI vermelho novo encerra
 * a festa. Uma sala que sai e volta antes de o alarme vencer volta com ele (o CI continua vermelho).
 */
export class RoomEffects {
  private rooms = new Map<string, RoomSlots>();

  /** Aplica um evento à sala; true se o efeito visível mudou. */
  apply(roomId: string, ev: GitHubEvent, now: number, agentId?: string): boolean {
    const slots = this.rooms.get(roomId) ?? {};
    const make = (kind: RoomEffect['kind'], text: string, ms: number): RoomEffect => {
      const fx: RoomEffect = { kind, text, at: now, until: now + ms };
      if (agentId) fx.agentId = agentId;
      return fx;
    };
    switch (ev.kind) {
      case 'pr_opened':
      case 'pr_merged':
      case 'release':
        slots.party = make('party', bannerOf(ev)!, PARTY_MS);
        break;
      case 'ci_failed':
        // o vermelho mais novo vale na hora (encerra uma festa em andamento)
        slots.alarm = make('alarm', bannerOf(ev)!, ALARM_MS);
        delete slots.party;
        break;
      case 'ci_passed':
        // CI verde só muda a sala se apagar um alarme (aí vira festa).
        if (!slots.alarm || slots.alarm.until <= now) return false;
        delete slots.alarm;
        slots.party = make('party', bannerOf(ev)!, PARTY_MS);
        break;
      default:
        return false;
    }
    this.rooms.set(roomId, slots);
    return true;
  }

  /** Efeito visível da sala agora (a festa na frente do alarme), ou undefined. */
  get(roomId: string, now: number): RoomEffect | undefined {
    const slots = this.rooms.get(roomId);
    if (!slots) return undefined;
    if (slots.party && slots.party.until > now) return slots.party;
    if (slots.alarm && slots.alarm.until > now) return slots.alarm;
    return undefined;
  }

  /** Esquece os efeitos vencidos; true se algum saiu (o snapshot precisa ser refeito). */
  prune(now: number): boolean {
    let changed = false;
    for (const [id, slots] of this.rooms) {
      if (slots.party && slots.party.until <= now) {
        delete slots.party;
        changed = true;
      }
      if (slots.alarm && slots.alarm.until <= now) {
        delete slots.alarm;
        changed = true;
      }
      if (!slots.party && !slots.alarm) this.rooms.delete(id);
    }
    return changed;
  }
}
