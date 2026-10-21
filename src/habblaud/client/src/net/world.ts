// Habblaud World no navegador: o cliente das rotas locais /api/world/* (o servidor local do Habblaud fala com o
// servidor do mundo; o token do dispositivo nunca chega ao navegador) e um FakeWorldApi para o modo demonstração
// (?mock=1&world=...) e para os testes. Erros chegam como `{error: {code}}`; a interface traduz o código
// (ui/world/world-model.ts) e nunca mostra o `message` do servidor.
//
// Fase 2 (prédio no mundo): `building` em meta.world e no status, GET /api/world/last-uplink (a última remessa, para
// "Ver o que foi enviado"), POST /api/world/pause, /resume e /leave e PUT /api/world/theme. Os tipos do prédio vêm
// de shared/world/api.ts (os mesmos do servidor local). Fase 3: POST /api/world/join ("Voltar ao mundo") e
// `meta.world.scene` (o botão Mundo); a cena fala com o servidor local por net/world-stream.ts. Fase 5 (social leve):
// likes do dia, batidas na porta e o "Enquanto você estava fora" no prédio, os bloqueados no status, "Avisar quando
// baterem na porta" (`knocks`) na visibilidade e POST /api/world/summary/seen e /unblock. Fase 6: excluir a conta
// (POST /api/world/delete-account e /confirm), baixar os dados (GET /api/world/export), o aviso de inatividade na
// visibilidade, o id da conta no status e o selo "não verificado" do prédio.
import type { AppearanceParts } from '../../../shared/appearance';
import type { Locale } from '../../../shared/i18n';
import type { OfficeSnapshot } from '../../../shared/types';
import {
  isWorldThemeChoice,
  WORLD_KNOWN_ERROR_CODES,
  WORLD_THEME_CHOICES,
  type WorldBlockedPlayer,
  type WorldBuildingMeta,
  type WorldBuildingStatus,
  type WorldBuildingStop,
  type WorldKnownErrorCode,
  type WorldLastUplink,
  type WorldThemeChoice,
  type WorldUplinkAck,
} from '../../../shared/world/api';
import type { TraitId } from '../../../shared/world/traits';
import type { IntroId } from '../../../shared/world/intro';
import { parsePlayerName, playerNameKey } from '../../../shared/world/names-rules';
import { GOODBYE_REASONS, UPLINK_ACK_ERRORS, type AwaySummary, type UplinkAckError, type WorldUplink } from '../../../shared/world/protocol';
import { parseAwaySummary, summaryHasNews } from '../../../shared/world/scene';
import { seasonalThemeFor } from '../world/api';
import { emailLooksValid, passwordProblem, traitsValid, DEFAULT_VISIBILITY } from '../ui/world/world-model';

export type WorldServerState = 'off' | 'logged_out' | 'waiting' | 'approved';
export type WorldAccess = 'waiting' | 'approved';

// Os tipos do prédio são os do servidor local (shared/world/api.ts); a interface os importa daqui.
export { WORLD_THEME_CHOICES };
export type { WorldBlockedPlayer, WorldBuildingMeta, WorldBuildingStatus, WorldBuildingStop, WorldLastUplink, WorldThemeChoice, WorldUplinkAck } from '../../../shared/world/api';

/** OfficeSnapshot.meta.world: o que a interface precisa para decidir se o World aparece (e o prédio, na Fase 2). */
export type WorldMeta = NonNullable<OfficeSnapshot['meta']['world']>;

export interface WorldVisibility {
  mode: 'live' | 'discreet';
  closed: boolean;
  hideCountry: boolean;
  tokensVisible: boolean;
  leaderboard: boolean;
  compactions: boolean;
  /** Aviso por e-mail antes de retirar o prédio por inatividade; ausente = o padrão da conta (ligado). */
  notifyInactivity?: boolean;
  /** Avisar quando baterem na porta do prédio (Fase 5, opt-in). */
  knocks: boolean;
}

export interface WorldPlayer {
  name: string;
  look: 'f' | 'm';
  parts: AppearanceParts;
  traits: TraitId[];
  intro: IntroId;
  /** ISO-2 visto pelo servidor na última conexão; ausente se escondido ou desconhecido. */
  country?: string;
  visibility: WorldVisibility;
  updatedAt?: number | string;
  /** A moderação trocou o nome à força (o nome vem "???"): falta escolher um novo, que entra sem esperar 30 dias. */
  mustRename?: true;
}

export interface WorldDevice {
  id: string;
  /** "Dispositivo N" (o servidor nunca usa o nome do computador). */
  label: string;
  createdAt?: number | string;
  lastSeenAt?: number | string;
  current: boolean;
}

/** GET /api/world/status. */
export interface WorldStatus {
  available: boolean;
  configured: boolean;
  state: WorldServerState;
  /**
   * `id`: o id da conta no mundo, quando o servidor local já sabe (vai no assunto do recurso por e-mail).
   * `reservedName`: o nome de jogador escolhido no cadastro, reservado enquanto o personagem não existe.
   */
  account?: { emailMasked: string; access: WorldAccess; id?: string; reservedName?: string };
  player?: WorldPlayer;
  devices?: WorldDevice[];
  /** Último erro da conexão com o mundo (código), se houver. */
  lastError?: string;
  /** O prédio (conta aprovada): conexão, pausa, contagens, a resposta à última remessa e por que parou. */
  building?: WorldBuildingStatus;
  /** Tema guardado para o prédio (PUT /api/world/theme); ausente = 'auto'. */
  theme?: WorldThemeChoice;
  /** Quem a conta bloqueou (Fase 5): Configurações › Habblaud World › Bloqueados. */
  blocked?: WorldBlockedPlayer[];
}

export interface WorldCharacterInput {
  /** Ausente ao criar com o nome reservado no cadastro (o servidor usa a reserva) e, ao editar, mantém o nome. */
  name?: string;
  look: 'f' | 'm';
  parts: AppearanceParts;
  traits: TraitId[];
  intro: IntroId;
}

/**
 * Códigos que a interface traduz: os do servidor do mundo e os do servidor local (shared/world/), mais dois só dela:
 * `offline` (o Habblaud local não respondeu) e `forbidden` (403 sem código: a guarda de origem recusou a página).
 */
export const WORLD_UI_ERROR_CODES = [...WORLD_KNOWN_ERROR_CODES, 'offline', 'forbidden'] as const;
export type WorldErrorCode = WorldKnownErrorCode | 'offline' | 'forbidden';

export type WorldResult<T = null> = { ok: true; data: T } | { ok: false; code: WorldErrorCode; status: number };

export interface WorldClient {
  /** `refresh`: o servidor local relê /v1/me antes de responder (a lista de bloqueados, por exemplo). */
  status(refresh?: boolean): Promise<WorldResult<WorldStatus>>;
  /** `name`: o nome de jogador, reservado na lista de espera (422 name_invalid | name_blocked, 409 name_taken). */
  register(body: { email: string; password: string; name: string; locale: Locale }): Promise<WorldResult>;
  verify(body: { email: string; code: string }): Promise<WorldResult>;
  login(body: { email: string; password: string }): Promise<WorldResult>;
  logout(): Promise<WorldResult>;
  resend(body: { email: string }): Promise<WorldResult>;
  forgotPassword(body: { email: string }): Promise<WorldResult>;
  resetPassword(body: { email: string; code: string; password: string }): Promise<WorldResult>;
  saveCharacter(body: WorldCharacterInput): Promise<WorldResult>;
  saveVisibility(body: WorldVisibility): Promise<WorldResult>;
  devices(): Promise<WorldResult<WorldDevice[]>>;
  revokeDevice(id: string): Promise<WorldResult>;
  /** A última remessa; `null` = nada saiu deste computador ainda. */
  lastUplink(): Promise<WorldResult<WorldLastUplink | null>>;
  /** Para o envio na hora (antes da resposta; a conexão só fica para a cena Mundo aberta): o prédio apaga. */
  pause(): Promise<WorldResult<{ paused: boolean }>>;
  /** Volta a enviar: o prédio acende de novo. */
  resume(): Promise<WorldResult<{ paused: boolean }>>;
  /** "Voltar ao mundo" depois de sair: o servidor do mundo aceita a volta e o prédio novo nasce em outro lote. */
  join(): Promise<WorldResult>;
  /** "Sair do mundo": o servidor local para o envio e o servidor do mundo retira o prédio antes da resposta. */
  leave(): Promise<WorldResult>;
  /** O tema escolhido em Aparência também vale para o prédio. */
  setTheme(theme: WorldThemeChoice): Promise<WorldResult>;
  /** "Excluir conta", primeira etapa: o código de confirmação vai ao e-mail da conta. */
  requestAccountDeletion(): Promise<WorldResult>;
  /** "Excluir conta" com o código: a conta sai do mundo e este computador sai da conta. */
  confirmAccountDeletion(body: { code: string }): Promise<WorldResult>;
  /** "Baixar meus dados": o JSON da conta, já formatado para salvar (uma vez por dia). */
  exportData(): Promise<WorldResult<string>>;
  /** O dono viu o "Enquanto você estava fora" (Fase 5). */
  summarySeen(): Promise<WorldResult>;
  /** Desbloqueia um jogador (Fase 5; precisa da conexão com o mundo). */
  unblock(playerId: string): Promise<WorldResult>;
}

// ------------------------------------------------------------------ leitura defensiva

const STATES: readonly WorldServerState[] = ['off', 'logged_out', 'waiting', 'approved'];

/** `meta.world` do snapshot, conferido (servidor antigo ou corpo torto: undefined = nada do World). */
export function readWorldMeta(snap: OfficeSnapshot | null | undefined): WorldMeta | undefined {
  const w = snap?.meta.world as Partial<WorldMeta> | undefined;
  if (!w || typeof w !== 'object' || typeof w.enabled !== 'boolean') return undefined;
  const state = STATES.includes(w.state as WorldServerState) ? (w.state as WorldServerState) : 'off';
  const out: WorldMeta = { enabled: w.enabled, configured: w.configured === true, state };
  const building = parseBuildingMeta(w.building);
  if (building) out.building = building;
  if (isObject(w.scene) && typeof w.scene.available === 'boolean') out.scene = { available: w.scene.available };
  return out;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function count(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

function epochMs(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

/** Motivo de recusa conhecido; um código de uma versão mais nova do servidor vira `internal` (como no servidor local). */
function ackError(v: unknown): UplinkAckError {
  return typeof v === 'string' && (UPLINK_ACK_ERRORS as readonly string[]).includes(v) ? (v as UplinkAckError) : 'internal';
}

/** `{ok, error?}` do `lastAck` do status. */
function parseAckState(v: unknown): { ok: boolean; error?: UplinkAckError } | undefined {
  if (!isObject(v) || typeof v.ok !== 'boolean') return undefined;
  return v.ok ? { ok: true } : { ok: false, error: ackError(v.error) };
}

/** O `ack` da última remessa: aceita (com os bytes que o mundo contou) ou recusada; sem horário, fora do formato. */
function parseUplinkAck(v: unknown): WorldUplinkAck | undefined {
  const state = parseAckState(v);
  const at = isObject(v) ? epochMs(v.at) : undefined;
  if (!state || !at) return undefined;
  const ack: WorldUplinkAck = { ...state, at };
  if (state.ok && isObject(v) && typeof v.bytes === 'number' && Number.isFinite(v.bytes) && v.bytes >= 0) ack.bytes = Math.floor(v.bytes);
  return ack;
}

/** Motivos com que o prédio para (o `deploy` só reconecta e nunca chega aqui). */
const STOPS = GOODBYE_REASONS.filter((r): r is WorldBuildingStop => r !== 'deploy');

/** `building` de meta.world, conferido (corpo torto: sem prédio). A parada vem só como sim/não. */
export function parseBuildingMeta(v: unknown): WorldBuildingMeta | undefined {
  if (!isObject(v)) return undefined;
  const b: WorldBuildingMeta = { connected: v.connected === true, paused: v.paused === true, floors: count(v.floors), agents: count(v.agents) };
  const at = epochMs(v.lastUplinkAt);
  if (at) b.lastUplinkAt = at;
  if (v.left === true) b.left = true;
  if (v.stopped === true) b.stopped = true;
  if (typeof v.visitors === 'number' && Number.isInteger(v.visitors) && v.visitors >= 0) b.visitors = Math.min(v.visitors, 999);
  // Fase 5: likes do dia, batidas desde que o Habblaud abriu e se há um resumo não visto.
  if (typeof v.likesToday === 'number' && Number.isInteger(v.likesToday) && v.likesToday >= 0) b.likesToday = v.likesToday;
  if (count(v.knocks) > 0) b.knocks = count(v.knocks);
  if (v.awaySummary === true) b.awaySummary = true;
  return b;
}

/** `building` do status, conferido (corpo torto: sem prédio): com a resposta à última remessa e o motivo da parada. */
export function parseBuilding(v: unknown): WorldBuildingStatus | undefined {
  const meta = parseBuildingMeta(v);
  if (!meta || !isObject(v)) return undefined;
  const { stopped: _stopped, ...b } = meta;
  const st: WorldBuildingStatus = b;
  const ack = parseAckState(v.lastAck);
  if (ack) st.lastAck = ack;
  if ((STOPS as readonly unknown[]).includes(v.stopped)) st.stopped = v.stopped as WorldBuildingStop;
  if (v.unverified === true) st.unverified = true;
  const summary = parseAwaySummary(v.summary);
  if (summary && summaryHasNews(summary)) st.summary = summary;
  if (typeof v.code === 'string' && /^HB-[2-9A-HJKMNP-TV-Z]{4}$/.test(v.code)) st.code = v.code;
  return st;
}

/** `blocked` do status: `[{id, name}]` (o que está torto fica de fora). */
export function parseBlockedList(v: unknown): WorldBlockedPlayer[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((p): p is WorldBlockedPlayer => isObject(p) && typeof p.id === 'string' && !!p.id && typeof p.name === 'string').map((p) => ({ id: p.id, name: p.name }));
}

/** O prédio do snapshot como o cartão usa antes do primeiro status (o motivo de uma parada só vem no status). */
export function buildingFromMeta(m: WorldBuildingMeta | undefined): WorldBuildingStatus | undefined {
  if (!m) return undefined;
  const { stopped: _stopped, ...b } = m;
  return b;
}

/**
 * Corpo do GET /api/world/last-uplink: `{}` (nada saiu ainda) vira null; fora do formato, undefined. O `uplink` passa
 * como veio: a tela mostra exatamente o que o servidor local guardou.
 */
export function parseLastUplink(v: unknown): WorldLastUplink | null | undefined {
  if (!isObject(v)) return undefined;
  if (v.at === undefined && v.uplink === undefined) return null;
  const at = epochMs(v.at);
  if (!at || typeof v.bytes !== 'number' || !Number.isFinite(v.bytes) || !isObject(v.uplink)) return undefined;
  const out: WorldLastUplink = { at, bytes: Math.max(0, Math.floor(v.bytes)), uplink: v.uplink as unknown as WorldUplink };
  const ack = parseUplinkAck(v.ack);
  if (ack) out.ack = ack;
  return out;
}

function parseDevices(v: unknown): WorldDevice[] | null {
  const list = Array.isArray(v) ? v : isObject(v) && Array.isArray(v.devices) ? v.devices : null;
  if (!list) return null;
  return list.filter((d): d is WorldDevice => isObject(d) && typeof d.id === 'string' && typeof d.label === 'string').map((d) => ({ ...d, current: d.current === true }));
}

/** Corpo do GET /api/world/status conferido; null se não for o formato do contrato. */
export function parseWorldStatus(v: unknown): WorldStatus | null {
  if (!isObject(v) || !STATES.includes(v.state as WorldServerState)) return null;
  const out: WorldStatus = { available: v.available !== false, configured: v.configured === true, state: v.state as WorldServerState };
  const acc = v.account;
  if (isObject(acc) && typeof acc.emailMasked === 'string') {
    out.account = { emailMasked: acc.emailMasked, access: acc.access === 'approved' ? 'approved' : 'waiting' };
    if (typeof acc.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(acc.id)) out.account.id = acc.id;
    if (typeof acc.reservedName === 'string' && acc.reservedName && acc.reservedName.length <= 64) out.account.reservedName = acc.reservedName;
  }
  const p = v.player;
  if (isObject(p) && typeof p.name === 'string' && isObject(p.parts) && Array.isArray(p.traits)) {
    out.player = {
      ...(p as unknown as WorldPlayer),
      look: p.look === 'm' ? 'm' : 'f',
      visibility: { ...DEFAULT_VISIBILITY, ...(isObject(p.visibility) ? (p.visibility as Partial<WorldVisibility>) : {}) },
    };
    if (p.mustRename !== true) delete out.player.mustRename;
  }
  const devices = v.devices === undefined ? null : parseDevices(v.devices);
  if (devices) out.devices = devices;
  if (typeof v.lastError === 'string' && v.lastError) out.lastError = v.lastError;
  const building = parseBuilding(v.building);
  if (building) out.building = building;
  if (isWorldThemeChoice(v.theme)) out.theme = v.theme;
  const blocked = parseBlockedList(v.blocked);
  if (blocked) out.blocked = blocked;
  return out;
}

/** Código do erro: `{error: {code}}` do contrato; senão pelo status HTTP (guarda, rota desligada...). */
export function worldErrorCode(status: number, body: unknown): WorldErrorCode {
  const err = isObject(body) ? body.error : undefined;
  const code = isObject(err) ? err.code : undefined;
  if (typeof code === 'string' && (WORLD_UI_ERROR_CODES as readonly string[]).includes(code)) return code as WorldErrorCode;
  if (status === 404) return 'not_configured';
  if (status === 429) return 'rate_limited';
  if (status === 403) return 'forbidden';
  return 'unknown';
}

// ------------------------------------------------------------------ cliente HTTP

/** Prazo de cada pedido: o cadastro resolve o desafio anti-robô e calcula o hash da senha antes de responder. */
export const WORLD_TIMEOUT_MS = 45_000;

export class HttpWorldApi implements WorldClient {
  constructor(
    // Arrow: o fetch do navegador recusa ser chamado como método de outro objeto ("Illegal invocation").
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
    private readonly base = '/api/world',
  ) {}

  private async call<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: object): Promise<WorldResult<T>> {
    const init: RequestInit = { method, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(WORLD_TIMEOUT_MS) };
    // A guarda do servidor só aceita POST/PUT com corpo JSON (mesmo vazio).
    if (method !== 'GET') Object.assign(init, { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, init);
    } catch {
      return { ok: false, code: 'offline', status: 0 };
    }
    let data: unknown = null;
    try {
      const text = await res.text();
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (res.ok) return { ok: true, data: data as T };
    return { ok: false, code: worldErrorCode(res.status, data), status: res.status };
  }

  private async done(p: Promise<WorldResult<unknown>>): Promise<WorldResult> {
    const r = await p;
    return r.ok ? { ok: true, data: null } : r;
  }

  async status(refresh = false): Promise<WorldResult<WorldStatus>> {
    const r = await this.call<unknown>('GET', refresh ? '/status?refresh=1' : '/status');
    if (!r.ok) return r;
    const s = parseWorldStatus(r.data);
    return s ? { ok: true, data: s } : { ok: false, code: 'unknown', status: 200 };
  }

  register(body: { email: string; password: string; name: string; locale: Locale }) {
    return this.done(this.call('POST', '/register', body));
  }
  verify(body: { email: string; code: string }) {
    return this.done(this.call('POST', '/verify', body));
  }
  login(body: { email: string; password: string }) {
    return this.done(this.call('POST', '/login', body));
  }
  logout() {
    return this.done(this.call('POST', '/logout'));
  }
  resend(body: { email: string }) {
    return this.done(this.call('POST', '/resend', body));
  }
  forgotPassword(body: { email: string }) {
    return this.done(this.call('POST', '/password/forgot', body));
  }
  resetPassword(body: { email: string; code: string; password: string }) {
    return this.done(this.call('POST', '/password/reset', body));
  }
  saveCharacter(body: WorldCharacterInput) {
    return this.done(this.call('PUT', '/character', body));
  }
  saveVisibility(body: WorldVisibility) {
    return this.done(this.call('PUT', '/visibility', body));
  }
  async devices(): Promise<WorldResult<WorldDevice[]>> {
    const r = await this.call<unknown>('GET', '/devices');
    if (!r.ok) return r;
    const list = parseDevices(r.data);
    return list ? { ok: true, data: list } : { ok: false, code: 'unknown', status: 200 };
  }
  revokeDevice(id: string) {
    return this.done(this.call('POST', `/devices/${encodeURIComponent(id)}/revoke`));
  }
  async lastUplink(): Promise<WorldResult<WorldLastUplink | null>> {
    const r = await this.call<unknown>('GET', '/last-uplink');
    if (!r.ok) return r;
    const last = parseLastUplink(r.data);
    return last === undefined ? { ok: false, code: 'unknown', status: 200 } : { ok: true, data: last };
  }
  pause() {
    return this.paused('/pause', true);
  }
  resume() {
    return this.paused('/resume', false);
  }
  leave() {
    return this.done(this.call('POST', '/leave'));
  }
  join() {
    return this.done(this.call('POST', '/join'));
  }
  setTheme(theme: WorldThemeChoice) {
    return this.done(this.call('PUT', '/theme', { theme }));
  }
  requestAccountDeletion() {
    return this.done(this.call('POST', '/delete-account'));
  }
  confirmAccountDeletion(body: { code: string }) {
    return this.done(this.call('POST', '/delete-account/confirm', body));
  }
  async exportData(): Promise<WorldResult<string>> {
    const r = await this.call<unknown>('GET', '/export');
    if (!r.ok) return r;
    return isObject(r.data) ? { ok: true, data: `${JSON.stringify(r.data, null, 2)}\n` } : { ok: false, code: 'unknown', status: 200 };
  }
  summarySeen() {
    return this.done(this.call('POST', '/summary/seen'));
  }
  unblock(playerId: string) {
    return this.done(this.call('POST', '/unblock', { playerId }));
  }

  /** POST /pause e /resume → WorldStatus; vale o `building.paused` dele (sem o campo: o que foi pedido). */
  private async paused(path: string, expected: boolean): Promise<WorldResult<{ paused: boolean }>> {
    const r = await this.call<unknown>('POST', path);
    if (!r.ok) return r;
    const b = isObject(r.data) ? r.data.building : undefined;
    return { ok: true, data: { paused: isObject(b) && typeof b.paused === 'boolean' ? b.paused : expected } };
  }
}

// ------------------------------------------------------------------ servidor falso (demonstração e testes)

export interface FakeWorldOptions {
  /** Estado inicial: sem servidor ('off': nada do World aparece), sem conta, ou com uma conta de exemplo já entrando (na espera ou liberada). */
  state?: WorldServerState;
  /** Espera de cada resposta, em ms (padrão 450; 0 nos testes). */
  delayMs?: number;
  now?: () => number;
}

interface FakeBuilding {
  connected: boolean;
  paused: boolean;
  /** Saiu do mundo (fica pausado até retomar, que traz um prédio "novo"). */
  left?: true;
  /** O "mundo" parou o prédio (goodbye), até retomar. */
  stopped?: WorldBuildingStop;
  /** O "mundo" marcou o prédio como "não verificado". */
  unverified?: true;
  last: WorldLastUplink | null;
  /** Quando acendeu (as visitas de mentira começam alguns segundos depois; os likes do dia sobem 1 por minuto). */
  since: number;
  /** Visitantes agora, fixados por `setVisitors` (sem isso: a demonstração da visita, pelo relógio). */
  visitors?: number;
  /** O social leve (Fase 5): o código, o resumo até ser visto e os bloqueados (nomes inventados). */
  code: string;
  summary?: AwaySummary;
  blocked: WorldBlockedPlayer[];
  /** Quando "Avisar quando baterem na porta" foi ligado (a 1ª batida chega 8 s depois, e outra a cada 45 s). */
  knocksOn?: number;
}

/** Visitas de mentira no prédio da demonstração: ninguém nos primeiros segundos, depois 1 e, um pouco depois, 2. */
export function fakeVisitorsAt(ms: number): number {
  return ms < 8_000 ? 0 : ms < 20_000 ? 1 : 2;
}

/** O "Enquanto você estava fora" do falso: visitas, likes e carimbos, sem quem. */
export const FAKE_SUMMARY: Readonly<AwaySummary> = {
  since: '2026-10-14',
  visits: 5,
  likes: 12,
  stamps: [
    { stampId: 'visited', count: 2 },
    { stampId: 'coffee', count: 1 },
    { stampId: 'rocket', count: 1 },
  ],
};

/** Bloqueados do falso (nomes inventados). */
const FAKE_BLOCKED: readonly WorldBlockedPlayer[] = [
  { id: 'p_spam', name: 'Spam Bot 3000' },
  { id: 'p_troll', name: 'Troll da Esquina' },
];

interface FakeAccount {
  email: string;
  password: string;
  verified: boolean;
  access: WorldAccess;
  player?: WorldPlayer;
  /** O nome de jogador do cadastro, reservado até o personagem existir. */
  reservedName?: string;
  devices: WorldDevice[];
  /** O prédio: nasce com a conta aprovada e com personagem. */
  building?: FakeBuilding;
  /** "Excluir conta" pedido (o código é FAKE_CODE). */
  deleteRequested?: boolean;
  /** Exportações dos dados (a segunda recebe 429, como a de verdade, uma por dia). */
  exports?: number;
}

/**
 * O que o prédio do falso "manda": o exemplo da seção 3.3 do plano (docs/world/privacidade.md), com as peças
 * completas nos três agentes (o plano abrevia duas com "..."). O tema é trocado pelo tema em vigor a cada remessa.
 */
export const FAKE_UPLINK: Readonly<WorldUplink> = {
  v: 1,
  version: '1.0.0',
  theme: 'halloween',
  floors: [
    {
      id: 'f_8c1e5f7a2b',
      agents: [
        {
          id: 'a_3f9d2c7e', kind: 'main', provider: 'claude', status: 'working', look: 'f', name: 'Marina',
          parts: {
            skin: '#e8b48c', hair: '#2b1d14', hairStyle: 'bob', eyes: '#3b5a7a', top: '#4a6fa5', topStyle: 'hoodie',
            bottom: '#2f3542', bottomStyle: 'pants', shoes: '#ffffff', accessory: 'glasses', accessoryColor: '#222222', facialHair: 'none',
          },
        },
        {
          id: 'a_71c0b5a9', kind: 'sub', parentId: 'a_3f9d2c7e', provider: 'claude', status: 'working', look: 'm', name: 'Caio',
          parts: {
            skin: '#c68642', hair: '#1c1c1c', hairStyle: 'short', eyes: '#4a3728', top: '#3d8b5f', topStyle: 'tshirt',
            bottom: '#2c2c35', bottomStyle: 'pants', shoes: '#3a2a20', accessory: 'headphones', accessoryColor: '#1f1f24', facialHair: 'stubble',
          },
        },
      ],
    },
    {
      id: 'f_02aa91c4de',
      agents: [
        {
          id: 'a_b2e74d10', kind: 'main', provider: 'codex', status: 'idle', look: 'm', name: 'Rafael',
          parts: {
            skin: '#8d5524', hair: '#0f0f0f', hairStyle: 'buzz', eyes: '#2b1d14', top: '#a5463d', topStyle: 'polo',
            bottom: '#4b5563', bottomStyle: 'shorts', shoes: '#f2f2f2', accessory: 'none', accessoryColor: '#222222', facialHair: 'beard',
          },
        },
      ],
    },
  ],
};

/** Tamanho de um pacote como vai para o fio (JSON compacto em UTF-8). */
export function uplinkBytes(uplink: WorldUplink): number {
  return new TextEncoder().encode(JSON.stringify(uplink)).length;
}

/** E-mail da conta de exemplo dos estados 'waiting' e 'approved'. */
export const FAKE_EMAIL = 'voce@exemplo.com';
/** Senha da conta de exemplo. */
export const FAKE_PASSWORD = 'uma senha bem comprida';
/** O código que o "e-mail" do FakeWorldApi manda (a tela mostra no modo demonstração). */
export const FAKE_CODE = '123456';

/** Nomes que o falso diz que já estão em uso (para ver o erro na demonstração). */
const FAKE_TAKEN = ['marina', 'caio', 'rafael'];

function maskEmail(email: string): string {
  const [user, domain = ''] = email.split('@');
  return `${user.slice(0, 2)}***@${domain}`;
}

/**
 * Servidor do World de mentira, todo em memória: cadastro com o código FAKE_CODE, lista de espera, personagem,
 * visibilidade e dispositivos. `failNext` simula um erro na próxima chamada; `approve` libera a conta da vez.
 */
export class FakeWorldApi implements WorldClient {
  private readonly accounts = new Map<string, FakeAccount>();
  private session: { email: string; deviceId: string } | null = null;
  private configured: boolean;
  private readonly delayMs: number;
  private readonly now: () => number;
  private readonly failures: WorldErrorCode[] = [];
  private readonly listeners = new Set<() => void>();
  private resends: number[] = [];
  private deviceSeq = 0;
  /** Tema do prédio (world.json no servidor de verdade). */
  private theme: WorldThemeChoice = 'auto';
  /** Código com que o "mundo" recusa as remessas (null: aceita). */
  private rejectCode: UplinkAckError | null = null;
  /** O lastError do status (a conta excluída deixa `account_deleted` até entrar de novo). */
  private lastError: WorldErrorCode | null = null;

  constructor(opts: FakeWorldOptions = {}) {
    this.delayMs = opts.delayMs ?? 450;
    this.now = opts.now ?? Date.now;
    const state = opts.state ?? 'logged_out';
    this.configured = state !== 'off';
    if (state === 'waiting' || state === 'approved') {
      const now = this.now();
      const acc: FakeAccount = { email: FAKE_EMAIL, password: FAKE_PASSWORD, verified: true, access: state, devices: [], reservedName: 'Pixel Dev' };
      if (state === 'approved') {
        delete acc.reservedName;
        acc.player = {
          name: 'Pixel Dev',
          look: 'f',
          parts: {
            skin: '#d69f78', hair: '#2b2530', hairStyle: 'bob', eyes: '#2f5f9e', top: '#4a86d8', topAccent: '#f4f4f0',
            topStyle: 'hoodie', bottom: '#2c2c35', bottomStyle: 'pants', shoes: '#ececec', accessory: 'glasses',
            accessoryColor: '#2b2b33', facialHair: 'none',
          },
          traits: ['cafeina', 'games'],
          intro: 'night_owl',
          country: 'BR',
          visibility: { ...DEFAULT_VISIBILITY },
          updatedAt: now,
        };
        this.ensureBuilding(acc);
      }
      this.accounts.set(FAKE_EMAIL, acc);
      const current = this.addDevice(acc);
      acc.devices.unshift({ id: 'fake-old', label: 'Dispositivo 2', createdAt: now - 21 * 86_400_000, lastSeenAt: now - 3 * 86_400_000, current: false });
      this.session = { email: FAKE_EMAIL, deviceId: current.id };
    }
  }

  /** O que o snapshot diria em `meta.world` (sem servidor, como o de verdade: desligado, nada aparece). */
  meta(): WorldMeta {
    const meta: WorldMeta = { enabled: this.configured, configured: this.configured, state: this.state() };
    const b = this.buildingOf(this.current());
    if (b) {
      // o resumo e o código só no status (local), como o de verdade: aqui, só se há um resumo não visto
      const { lastAck: _ack, stopped, summary, code: _code, ...building } = b;
      meta.building = stopped ? { ...building, stopped: true } : building;
      if (summary) meta.building.awaySummary = true;
    }
    // A cena Mundo do modo demonstração (FakeWorldStream) existe com a conta liberada e o personagem criado.
    if (b) meta.scene = { available: true };
    return meta;
  }

  /** Tema do prédio em vigor (o escolhido, antes de resolver o automático). */
  worldTheme(): WorldThemeChoice {
    return this.theme;
  }

  /** Visitantes no prédio de mentira (testes e capturas); null volta à demonstração pelo relógio. */
  setVisitors(n: number | null): void {
    const b = this.current()?.building;
    if (!b) return;
    if (n === null) delete b.visitors;
    else b.visitors = Math.max(0, Math.floor(n));
    this.changed();
  }

  /** O "mundo" passa a recusar as remessas com este código (null: volta a aceitar); manda uma remessa na hora. */
  rejectUplinks(code: UplinkAckError | null): void {
    this.rejectCode = code;
    const acc = this.current();
    if (acc?.building?.connected) this.sendUplink(acc);
    this.changed();
  }

  /** O "mundo" para o prédio com um `goodbye` (atualize, outro computador...), até retomar. */
  stopBuilding(reason: WorldBuildingStop): void {
    const b = this.current()?.building;
    if (!b || b.paused) return;
    b.connected = false;
    b.stopped = reason;
    this.changed();
  }

  /** O "mundo" marca (ou desmarca) o prédio da conta como "não verificado". */
  markUnverified(on: boolean): void {
    const b = this.current()?.building;
    if (!b) return;
    if (on) b.unverified = true;
    else delete b.unverified;
    this.changed();
  }

  /** O "mundo" entra (ou sai) em manutenção: o status traz `maintenance` e o prédio fica sem conexão até acabar. */
  setMaintenance(on: boolean): void {
    const b = this.current()?.building;
    this.lastError = on ? 'maintenance' : null;
    if (b && !b.paused && !b.stopped) b.connected = !on;
    this.changed();
  }

  /** A conexão com o mundo cai (o servidor de verdade tenta de novo sozinho; aqui, até pausar e retomar). */
  dropConnection(): void {
    const b = this.current()?.building;
    if (!b || b.paused) return;
    b.connected = false;
    this.changed();
  }

  /** Avisa quando o estado muda (a interface redesenha, como faria com um snapshot novo). */
  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }

  /** A próxima chamada falha com este código (testes e demonstração). */
  failNext(code: WorldErrorCode): void {
    this.failures.push(code);
  }

  /** A moderação troca à força o nome do personagem da conta que está entrando (vira "???" até escolher outro). */
  forceRename(): void {
    const acc = this.current();
    if (!acc?.player) return;
    acc.player = { ...acc.player, name: '???', mustRename: true };
    this.changed();
  }

  /** Libera da lista de espera a conta que está entrando (o painel do servidor faria isso por lote). */
  approve(): void {
    const acc = this.current();
    if (!acc) return;
    acc.access = 'approved';
    this.ensureBuilding(acc);
    this.changed();
  }

  /** Acende o prédio da conta aprovada e com personagem, com a primeira remessa (o uplink de verdade faz isso). */
  private ensureBuilding(acc: FakeAccount): void {
    if (acc.building || acc.access !== 'approved' || !acc.player) return;
    acc.building = { connected: true, paused: false, last: null, code: 'HB-4F2K', summary: structuredClone(FAKE_SUMMARY), blocked: [...FAKE_BLOCKED], since: this.now() };
    this.sendUplink(acc);
  }

  /** Uma remessa: o exemplo da 3.3 com o tema resolvido pela data; a resposta do "mundo" vem na hora. */
  private sendUplink(acc: FakeAccount): void {
    const b = acc.building;
    if (!b || b.paused) return;
    const at = this.now();
    const uplink: WorldUplink = { ...structuredClone(FAKE_UPLINK as WorldUplink), theme: seasonalThemeFor(this.theme, new Date(at)) };
    const bytes = uplinkBytes(uplink);
    const ack: WorldUplinkAck = this.rejectCode ? { ok: false, error: this.rejectCode, at } : { ok: true, at, bytes };
    b.last = { at, bytes, uplink, ack };
  }

  private buildingOf(acc: FakeAccount | undefined): WorldBuildingStatus | undefined {
    const b = acc?.building;
    if (!b) return undefined;
    const floors = b.last?.uplink.floors ?? [];
    const out: WorldBuildingStatus = { connected: b.connected, paused: b.paused, floors: floors.length, agents: floors.reduce((n, f) => n + f.agents.length, 0) };
    if (b.last) {
      out.lastUplinkAt = b.last.at;
      if (b.last.ack) out.lastAck = b.last.ack.ok ? { ok: true } : { ok: false, error: b.last.ack.error };
    }
    if (b.left) out.left = true;
    if (b.stopped) out.stopped = b.stopped;
    // visitantes: só aceso e aberto a visitas (fechado, o mundo não manda nem o 0)
    if (b.connected && !b.paused && !b.left && !acc?.player?.visibility.closed) out.visitors = b.visitors ?? fakeVisitorsAt(this.now() - b.since);
    if (b.unverified) out.unverified = true;
    // Fase 5: 3 likes hoje e mais um por minuto; batidas com "Avisar quando baterem na porta" ligado.
    const now = this.now();
    out.likesToday = 3 + Math.floor(Math.max(0, now - b.since) / 60_000);
    if (b.knocksOn !== undefined && acc.player?.visibility.knocks && b.connected) {
      const knocks = Math.floor((now - b.knocksOn - 8_000) / 45_000) + 1;
      if (knocks > 0) out.knocks = knocks;
    }
    if (b.summary) out.summary = structuredClone(b.summary);
    out.code = b.code;
    return out;
  }

  private state(): WorldServerState {
    if (!this.configured) return 'off';
    const acc = this.current();
    return acc ? acc.access : 'logged_out';
  }

  private current(): FakeAccount | undefined {
    return this.session ? this.accounts.get(this.session.email) : undefined;
  }

  private changed(): void {
    this.listeners.forEach((cb) => cb());
  }

  private addDevice(acc: FakeAccount): WorldDevice {
    const now = this.now();
    acc.devices.forEach((d) => (d.current = false));
    const used = new Set(acc.devices.map((d) => d.label));
    let n = 1;
    while (used.has(`Dispositivo ${n}`)) n++;
    const device: WorldDevice = { id: `fake-${++this.deviceSeq}`, label: `Dispositivo ${n}`, createdAt: now, lastSeenAt: now, current: true };
    acc.devices.push(device);
    return device;
  }

  /**
   * Responde depois da espera; um `failNext` pendente vira o erro desta resposta. Só as escritas (`write`) avisam quem
   * escuta: uma leitura que avisasse faria a interface reler o status sem parar.
   */
  private async reply<T>(run: () => WorldResult<T>, write = true): Promise<WorldResult<T>> {
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    const fail = this.failures.shift();
    if (fail) return { ok: false, code: fail, status: fail === 'offline' ? 0 : 400 };
    if (!this.configured) return { ok: false, code: 'not_configured', status: 404 };
    const r = run();
    if (r.ok && write) this.changed();
    return r;
  }

  private static ok(): WorldResult {
    return { ok: true, data: null };
  }

  private static fail(code: WorldErrorCode, status = 400): WorldResult<never> {
    return { ok: false, code, status };
  }

  status(): Promise<WorldResult<WorldStatus>> {
    return this.reply(() => {
      const acc = this.current();
      const state = this.state();
      const status: WorldStatus = { available: true, configured: this.configured, state };
      if (acc) {
        status.account = { emailMasked: maskEmail(acc.email), access: acc.access };
        if (!acc.player && acc.reservedName) status.account.reservedName = acc.reservedName;
        if (acc.player) status.player = structuredClone(acc.player);
        status.devices = structuredClone(acc.devices);
        const building = this.buildingOf(acc);
        if (building) status.building = building;
        if (acc.building) status.blocked = structuredClone(acc.building.blocked);
      }
      if (this.theme !== 'auto') status.theme = this.theme;
      if (this.lastError) status.lastError = this.lastError;
      return { ok: true, data: status };
    }, false);
  }

  register(body: { email: string; password: string; name: string; locale: Locale }): Promise<WorldResult> {
    return this.reply(() => {
      // Como o servidor de verdade: o nome é conferido antes da senha e fica reservado para a conta.
      const name = parsePlayerName(body.name);
      if (!name.ok) return FakeWorldApi.fail(name.code, 422);
      if (this.nameTaken(name.key, undefined)) return FakeWorldApi.fail('name_taken', 409);
      if (!emailLooksValid(body.email) || passwordProblem(body.password, body.email)) return FakeWorldApi.fail('invalid', 422);
      const email = body.email.trim().toLowerCase();
      // E-mail já cadastrado responde igual (nunca revela quem tem conta).
      if (!this.accounts.has(email)) this.accounts.set(email, { email, password: body.password, verified: false, access: 'waiting', devices: [], reservedName: name.name });
      return FakeWorldApi.ok();
    });
  }

  /** O nome (pela chave) já é de outra conta: os fixos de FAKE_TAKEN, uma reserva do cadastro ou um personagem. */
  private nameTaken(key: string, self: FakeAccount | undefined): boolean {
    if (FAKE_TAKEN.includes(key)) return true;
    for (const o of this.accounts.values()) {
      if (o === self) continue;
      const other = o.player?.name ?? o.reservedName;
      if (other && playerNameKey(other) === key) return true;
    }
    return false;
  }

  verify(body: { email: string; code: string }): Promise<WorldResult> {
    return this.reply(() => {
      const acc = this.accounts.get(body.email.trim().toLowerCase());
      if (!acc || body.code !== FAKE_CODE) return FakeWorldApi.fail('invalid_code');
      acc.verified = true;
      this.session = { email: acc.email, deviceId: this.addDevice(acc).id };
      this.lastError = null;
      return FakeWorldApi.ok();
    });
  }

  login(body: { email: string; password: string }): Promise<WorldResult> {
    return this.reply(() => {
      const email = body.email.trim().toLowerCase();
      if (email.startsWith('banido@')) return FakeWorldApi.fail('banned', 403);
      const acc = this.accounts.get(email);
      if (!acc || acc.password !== body.password) return FakeWorldApi.fail('invalid_credentials', 401);
      if (!acc.verified) return FakeWorldApi.fail('email_not_verified', 403);
      this.session = { email, deviceId: this.addDevice(acc).id };
      this.lastError = null;
      return FakeWorldApi.ok();
    });
  }

  logout(): Promise<WorldResult> {
    return this.reply(() => {
      const acc = this.current();
      if (acc && this.session) {
        const id = this.session.deviceId;
        acc.devices = acc.devices.filter((d) => d.id !== id);
      }
      this.session = null;
      return FakeWorldApi.ok();
    });
  }

  resend(_body: { email: string }): Promise<WorldResult> {
    return this.reply(() => {
      const now = this.now();
      this.resends = this.resends.filter((t) => now - t < 3_600_000);
      if (this.resends.length >= 3) return FakeWorldApi.fail('rate_limited', 429);
      this.resends.push(now);
      return FakeWorldApi.ok();
    });
  }

  forgotPassword(_body: { email: string }): Promise<WorldResult> {
    return this.reply(() => FakeWorldApi.ok());
  }

  resetPassword(body: { email: string; code: string; password: string }): Promise<WorldResult> {
    return this.reply(() => {
      const acc = this.accounts.get(body.email.trim().toLowerCase());
      if (!acc || body.code !== FAKE_CODE) return FakeWorldApi.fail('invalid_code');
      if (passwordProblem(body.password, body.email)) return FakeWorldApi.fail('invalid', 422);
      acc.password = body.password;
      acc.verified = true;
      // Trocar a senha desconecta todos os dispositivos (este também).
      acc.devices = [];
      if (this.session?.email === acc.email) this.session = null;
      return FakeWorldApi.ok();
    });
  }

  saveCharacter(body: WorldCharacterInput): Promise<WorldResult> {
    return this.reply(() => {
      const acc = this.current();
      if (!acc) return FakeWorldApi.fail('unknown', 401);
      // Criando com a reserva do cadastro, o nome É a reserva; editando sem `name`, mantém.
      const raw = !acc.player && acc.reservedName ? acc.reservedName : body.name === undefined && acc.player ? acc.player.name : body.name;
      const name = parsePlayerName(raw);
      if (!name.ok) return FakeWorldApi.fail(name.code, 422);
      if (this.nameTaken(name.key, acc) && playerNameKey(acc.player?.name ?? '') !== name.key) return FakeWorldApi.fail('name_taken', 409);
      if (!traitsValid(body.traits)) return FakeWorldApi.fail('invalid', 422);
      delete acc.reservedName;
      acc.player = {
        name: name.name,
        look: body.look,
        parts: { ...body.parts },
        traits: [...body.traits],
        intro: body.intro,
        country: 'BR',
        visibility: acc.player?.visibility ?? { ...DEFAULT_VISIBILITY },
        updatedAt: this.now(),
      };
      this.ensureBuilding(acc);
      return FakeWorldApi.ok();
    });
  }

  saveVisibility(body: WorldVisibility): Promise<WorldResult> {
    return this.reply(() => {
      const acc = this.current();
      if (!acc?.player) return FakeWorldApi.fail('invalid', 422);
      const was = acc.player.visibility.knocks;
      acc.player.visibility = { ...body };
      if (body.hideCountry) delete acc.player.country;
      else acc.player.country = 'BR';
      if (acc.building && body.knocks && !was) acc.building.knocksOn = this.now();
      return FakeWorldApi.ok();
    });
  }

  devices(): Promise<WorldResult<WorldDevice[]>> {
    return this.reply(() => {
      const acc = this.current();
      if (!acc) return FakeWorldApi.fail('unknown', 401);
      return { ok: true, data: structuredClone(acc.devices) };
    }, false);
  }

  revokeDevice(id: string): Promise<WorldResult> {
    return this.reply(() => {
      const acc = this.current();
      if (!acc) return FakeWorldApi.fail('unknown', 401);
      if (!acc.devices.some((d) => d.id === id)) return FakeWorldApi.fail('invalid', 404);
      acc.devices = acc.devices.filter((d) => d.id !== id);
      if (this.session?.deviceId === id) this.session = null;
      return FakeWorldApi.ok();
    });
  }

  lastUplink(): Promise<WorldResult<WorldLastUplink | null>> {
    return this.reply(() => {
      const acc = this.current();
      if (!acc) return FakeWorldApi.fail('not_logged_in', 401);
      return { ok: true, data: acc.building?.last ? structuredClone(acc.building.last) : null };
    }, false);
  }

  pause(): Promise<WorldResult<{ paused: boolean }>> {
    return this.setPaused(true);
  }

  resume(): Promise<WorldResult<{ paused: boolean }>> {
    return this.setPaused(false);
  }

  private setPaused(paused: boolean): Promise<WorldResult<{ paused: boolean }>> {
    return this.reply(() => {
      const acc = this.current();
      if (!acc) return FakeWorldApi.fail('not_logged_in', 401);
      const b = acc.building;
      if (!b) return FakeWorldApi.fail('no_player', 409);
      b.paused = paused;
      // Como o de verdade: pausar apaga o prédio (o selo deixa de mostrar "no mundo"); retomar (também depois de sair
      // do mundo ou de uma parada) reconecta e manda o pacote inteiro.
      b.connected = !paused;
      if (!paused) {
        delete b.left;
        delete b.stopped;
      }
      this.sendUplink(acc);
      return { ok: true, data: { paused } };
    });
  }

  /** "Voltar ao mundo": como retomar, mas só faz sentido depois de sair (sem ter saído, nada muda). */
  join(): Promise<WorldResult> {
    return this.reply(() => {
      const acc = this.current();
      if (!acc) return FakeWorldApi.fail('not_logged_in', 401);
      const b = acc.building;
      if (!b) return FakeWorldApi.fail('no_player', 409);
      if (b.left) {
        delete b.left;
        delete b.stopped;
        b.paused = false;
        b.connected = true;
        this.sendUplink(acc);
      }
      return FakeWorldApi.ok();
    });
  }

  leave(): Promise<WorldResult> {
    return this.reply(() => {
      const acc = this.current();
      if (!acc) return FakeWorldApi.fail('not_logged_in', 401);
      const b = acc.building;
      if (!b) return FakeWorldApi.fail('no_player', 409);
      b.paused = true;
      b.connected = false;
      b.left = true;
      delete b.stopped;
      return FakeWorldApi.ok();
    });
  }

  setTheme(theme: WorldThemeChoice): Promise<WorldResult> {
    return this.reply(() => {
      if (!WORLD_THEME_CHOICES.includes(theme)) return FakeWorldApi.fail('invalid', 422);
      this.theme = theme;
      const acc = this.current();
      if (acc?.building?.connected) this.sendUplink(acc);
      return FakeWorldApi.ok();
    });
  }

  requestAccountDeletion(): Promise<WorldResult> {
    return this.reply(() => {
      const acc = this.current();
      if (!acc) return FakeWorldApi.fail('not_logged_in', 401);
      acc.deleteRequested = true;
      return FakeWorldApi.ok();
    }, false);
  }

  /** Com o código: a conta some (e o tema, como o world.json apagado), e o status fica `account_deleted`. */
  confirmAccountDeletion(body: { code: string }): Promise<WorldResult> {
    return this.reply(() => {
      const acc = this.current();
      if (!acc) return FakeWorldApi.fail('not_logged_in', 401);
      if (!acc.deleteRequested || body.code !== FAKE_CODE) return FakeWorldApi.fail('invalid_code');
      this.accounts.delete(acc.email);
      this.session = null;
      this.theme = 'auto';
      this.lastError = 'account_deleted';
      return FakeWorldApi.ok();
    });
  }

  summarySeen(): Promise<WorldResult> {
    return this.reply(() => {
      const b = this.current()?.building;
      if (!b) return FakeWorldApi.fail('not_logged_in', 401);
      delete b.summary;
      return FakeWorldApi.ok();
    });
  }

  exportData(): Promise<WorldResult<string>> {
    return this.reply(() => {
      const acc = this.current();
      if (!acc) return FakeWorldApi.fail('not_logged_in', 401);
      acc.exports = (acc.exports ?? 0) + 1;
      if (acc.exports > 1) return FakeWorldApi.fail('rate_limited', 429);
      // O formato de WorldExport (protocol.ts), só com dados de mentira.
      const data = {
        format: 'habblaud-world-export',
        version: 1,
        exportedAt: new Date(this.now()).toISOString(),
        account: { email: acc.email, access: acc.access, notifyInactivity: acc.player?.visibility.notifyInactivity !== false },
        player: acc.player ?? null,
        visibility: acc.player?.visibility ?? null,
        devices: acc.devices.map((d) => ({ label: d.label, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt, revokedAt: null })),
        building: acc.building ? { floors: acc.building.last?.uplink.floors.length ?? 0, likes: 0 } : null,
        likesGiven: [],
        blocks: [],
        reportsMade: [],
        stampsReceived: [],
      };
      return { ok: true, data: `${JSON.stringify(data, null, 2)}\n` };
    }, false);
  }

  /** Como o de verdade: o `unblock` vai pela conexão com o mundo (pausado e sem a cidade aberta, não dá). */
  unblock(playerId: string): Promise<WorldResult> {
    return this.reply(() => {
      const b = this.current()?.building;
      if (!b) return FakeWorldApi.fail('not_logged_in', 401);
      if (!b.connected) return FakeWorldApi.fail('not_connected', 409);
      b.blocked = b.blocked.filter((p) => p.id !== playerId);
      return FakeWorldApi.ok();
    });
  }
}

// ------------------------------------------------------------------ de onde vêm os dados

export interface WorldSource {
  /** null = nada do World nesta página. */
  readonly client: WorldClient | null;
  /** Modo demonstração: o FakeWorldApi responde (sem servidor, sem as travas de acesso). */
  readonly fake: boolean;
  /** O `meta.world` em vigor. */
  meta(): WorldMeta | undefined;
  /** Avisa quando o estado muda fora dos snapshots (só o falso). */
  onChange?(cb: () => void): () => void;
}

/** `?world=` do modo demonstração: o estado inicial do FakeWorldApi (sem o parâmetro, o World não aparece). */
export function fakeWorldStateFrom(search: string): WorldServerState | null {
  const params = new URLSearchParams(search);
  if (!params.has('world')) return null;
  const v = params.get('world') ?? '';
  return (STATES as readonly string[]).includes(v) ? (v as WorldServerState) : 'logged_out';
}

/**
 * O World desta página: no ?mock=1, o FakeWorldApi só com `&world=` (as capturas do README em modo demonstração
 * continuam sem nada do World, que está desligado por padrão); fora dele, as rotas locais e o `meta.world` do
 * snapshot ao vivo.
 */
export function worldSource(store: { mock: boolean; readonly liveSnapshot: OfficeSnapshot | null }, search = typeof location === 'undefined' ? '' : location.search): WorldSource {
  if (store.mock) {
    const state = fakeWorldStateFrom(search);
    if (!state) return { client: null, fake: true, meta: () => undefined };
    const fake = new FakeWorldApi({ state });
    return { client: fake, fake: true, meta: () => fake.meta(), onChange: (cb) => fake.onChange(cb) };
  }
  return { client: new HttpWorldApi(), fake: false, meta: () => readWorldMeta(store.liveSnapshot) };
}
