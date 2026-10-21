// Rotas locais do Habblaud World (/api/world/*, server/world/http.ts): o que a página do Habblaud pede ao servidor
// local, que fala com o servidor do mundo por ela. Só na porta local, com Host local (nunca pela porta do celular), e
// tudo o que age pela conta só com a trava do terminal (bind local). O token do dispositivo nunca chega aqui.
//
//   GET  /api/world/status[?refresh=1]       → WorldStatus
//   POST /api/world/register                 {email, password, name, locale?, invite?} → 202 {} (name: o nome de jogador,
//                                                reservado na lista de espera; 422 name_invalid | name_blocked, 409 name_taken)
//   POST /api/world/verify                   {email, code} → 200 WorldStatus (entra: grava o token neste computador)
//   POST /api/world/login                    {email, password} → 200 WorldStatus
//   POST /api/world/logout                   {} → 200 WorldStatus (apaga o token daqui e revoga no servidor)
//   POST /api/world/resend                   {email} → 202 {}
//   POST /api/world/password/forgot          {email} → 202 {}
//   POST /api/world/password/reset           {email, code, password} → 204
//   PUT  /api/world/character                PlayerInput → 200 Player (ao criar com nome reservado no cadastro, sem `name`)
//   PUT  /api/world/visibility               Visibility → 200 Visibility
//   GET  /api/world/devices                  → {devices: DeviceInfo[]}
//   POST /api/world/devices/:id/revoke       {} → 204 (o próprio dispositivo: sai daqui também)
//   PUT  /api/world/theme                    {theme: WorldThemeChoice} → 200 {theme} (com ou sem conta: fica em world.json)
//   POST /api/world/pause                    {} → 200 WorldStatus (para o envio do pacote antes de responder; a
//                                                conexão fecha, ou fica só para a cena Mundo aberta, sem `uplink`;
//                                                avisa POST /v1/me/building/pause, documentada em protocol.ts)
//   POST /api/world/resume                   {} → 200 WorldStatus (avisa POST /v1/me/building/resume e reabre o uplink;
//                                                sem resposta do servidor do mundo, tenta de novo com espera crescente)
//   POST /api/world/leave                    {} → 200 WorldStatus ("Sair do mundo": para o envio como a pausa, chama
//                                                DELETE /v1/me/building e só então responde; a conta e o personagem
//                                                continuam)
//   POST /api/world/join                     {} → 200 WorldStatus ("Voltar ao mundo": POST /v1/me/building/join e,
//                                                com a resposta, tira a saída e a pausa e reabre o uplink; o próximo
//                                                pacote cria um prédio novo, em outro lote; sem ter saído, é o
//                                                resume)
//   GET  /api/world/last-uplink              → WorldLastUplink | {} (o que foi enviado por último, exato)
//
// A conta e os dados (Fase 6):
//   POST /api/world/delete-account           {} → 202 {} ("Excluir conta": POST /v1/me/delete manda o código ao e-mail)
//   POST /api/world/delete-account/confirm   {code} → 200 WorldStatus (POST /v1/me/delete/confirm; com a resposta boa,
//                                                fecha a conexão do prédio e apaga o world.json inteiro: a sessão
//                                                some daqui e o status volta sem conta, com lastError
//                                                `account_deleted`)
//   GET  /api/world/export                   → 200 WorldExport (o JSON da conta como veio de GET /v1/me/export), anexo
//                                                (habblaud-world-dados.json); uma vez por dia (429 rate_limited); só
//                                                pela própria página, como o stream (gasta a cota do dia)
//   PUT  /api/world/visibility               aceita também `notifyInactivity` (opcional): o aviso por e-mail antes
//                                                de retirar o prédio por inatividade
// O social leve (Fase 5; server/world/social.ts), pela conexão do prédio, com a cena Mundo aberta ou não:
//   POST /api/world/summary/seen             {} → 204 (manda ↑ `summary.seen`: o dono viu "Enquanto você estava fora";
//                                                409 not_connected sem a conexão com o mundo)
//   POST /api/world/unblock                  {playerId} → 204 (manda ↑ `unblock`; tira da lista de bloqueados daqui
//                                                na hora e relê /v1/me; 409 not_connected sem a conexão)
// O código do prédio ("Ir para HB-XXXX") vai direto no ↑ `teleport {code}` da cena: a rota GET /v1/buildings/:code do
// protocolo (BuildingCodeResponse) não é usada pela página.
//
// A cena Mundo (Fase 3; server/world/viewer.ts), com as mesmas travas e sem a porta do celular:
//   GET  /api/world/stream                   → text/event-stream: `world.snapshot` (WorldSceneSnapshot) ao conectar e
//                                                a cada recomeço (conexão com o mundo aberta ou caída, `view` de
//                                                novo), `world` (WorldSceneMessage) com cada mensagem da cidade como
//                                                veio, já na ordem e sem salto de `rev`, e `: ping` a cada 15 s. No
//                                                máximo 4 abertos (429 too_many_streams). Abrir o primeiro manda
//                                                `view` ao servidor do mundo; fechar o último, `view.off`
//   POST /api/world/cmd                      {stream, cmds: WorldSceneCommand[]} → 202 {sent} (até 5 lotes/s por
//                                                stream, 20 comandos por lote; de cada lote, só o último `move` vai)
//
// Erros: {error: {code, message?, retryAfter?}} com o status do servidor do mundo quando vêm de lá (códigos em
// WORLD_ERROR_CODES do protocolo; um código novo passa como veio) ou com os códigos locais abaixo. A interface traduz
// pelo `code`; `message` é só para quem lê o log ou usa o curl.
import {
  WORLD_ERROR_CODES,
  type AfkMessage,
  type AppearanceParts,
  type AreaMessage,
  type AreaPatchMessage,
  type AwaySummary,
  type AwaySummaryMessage,
  type CityFireworksMessage,
  type CityStatusMessage,
  type KnockedMessage,
  type KnockMessage,
  type LikesTodayMessage,
  type StampMessage,
  type SummarySeenMessage,
  type TeleportMessage,
  type BlockMessage,
  type BuildingMessage,
  type BuildingPatchMessage,
  type DeviceInfo,
  type EnterMessage,
  type GoodbyeReason,
  type GreetingMessage,
  type GreetMessage,
  type IntroId,
  type LeaveMessage,
  type LikeMessage,
  type LikeUpdateMessage,
  type MinimapMessage,
  type MoveMessage,
  type NoticeMessage,
  type Player,
  type PlayerJoinMessage,
  type PlayerLeaveMessage,
  type PlayersMessage,
  type PosMessage,
  type ProfileMessage,
  type ProfileRequestMessage,
  type ReportMessage,
  type ResyncMessage,
  type TraitId,
  type ViewMessage,
  type ViewOffMessage,
  type VisitorsMessage,
  type WorldBuildingDetail,
  type WorldAccess,
  type WorldBuildingPublic,
  type WorldErrorCode,
  type UplinkAckError,
  type WorldPlayerPublic,
  type WorldPosition,
  type WorldTheme,
  type WorldUplink,
} from './protocol';

/**
 * Tema escolhido em Configurações › Aparência, guardado em world.json (PUT /api/world/theme). O pacote leva o tema já
 * resolvido: o automático vira o tema do calendário (server/world/theme.ts).
 */
export const WORLD_THEME_CHOICES = ['auto', 'none', 'halloween', 'christmas'] as const;
export type WorldThemeChoice = 'auto' | WorldTheme;

export function isWorldThemeChoice(v: unknown): v is WorldThemeChoice {
  return typeof v === 'string' && (WORLD_THEME_CHOICES as readonly string[]).includes(v);
}

/** Estado da conta neste computador. */
export type WorldState = 'off' | 'logged_out' | 'waiting' | 'approved';

/** Por que o prédio parou de subir: o motivo do `goodbye` do servidor do mundo (o `deploy` só reconecta). */
export type WorldBuildingStop = Exclude<GoodbyeReason, 'deploy'>;

/**
 * Resposta do servidor do mundo à remessa (`uplink.ack`): aceita (`at` e `bytes` contados por ele) ou recusada com o
 * motivo (`error`, só os códigos de UPLINK_ACK_ERRORS; um código que esta versão não conhece vira `internal`; `at` é a
 * hora em que a recusa chegou aqui).
 */
export interface WorldUplinkAck {
  ok: boolean;
  error?: UplinkAckError;
  /** Horário (ms). */
  at: number;
  bytes?: number;
}

/**
 * O prédio deste computador no mundo: GET /api/world/status → `building`, só com a conta aprovada e o personagem
 * criado. `floors` e `agents` são os da última remessa (antes dela, os que o servidor mandou no `welcome`; 0 sem nada).
 */
export interface WorldBuildingStatus {
  /**
   * WebSocket aberto e aceito (`welcome`) e o prédio subindo. Pausado ou fora do mundo é sempre false: a conexão que a
   * cena Mundo abre para andar pela cidade não leva o prédio.
   */
  connected: boolean;
  /** Pausado pelo dono (POST /api/world/pause). */
  paused: boolean;
  floors: number;
  agents: number;
  /** Última remessa (ms). */
  lastUplinkAt?: number;
  /** Resposta à última remessa (ausente enquanto não chega). */
  lastAck?: { ok: boolean; error?: UplinkAckError };
  /**
   * O servidor do mundo fechou a conexão e o prédio parou: `banned`/`suspended` (conta), `update` (versão antiga: atualize),
   * `other-device` (a conta conectou em outro lugar; volta com "Retomar" ou ao reabrir o Habblaud), `waiting`,
   * `no_player`, `unauthorized` (a conta mudou do outro lado; o estado daqui é atualizado).
   */
  stopped?: WorldBuildingStop;
  /** Saiu do mundo (POST /api/world/leave): o prédio foi retirado e nenhum pacote sai até o join (prédio novo, lote novo). */
  left?: true;
  /** Visitantes dentro do prédio agora (veja WorldBuildingMeta.visitors). */
  visitors?: number;
  /**
   * O mundo marcou o prédio como "não verificado" (WorldBuildingPublic.unverified, do `welcome` ou da cidade): os dados
   * pareceram fora do plausível e estão em revisão; o prédio fica fora de placares e destaques. Dá para contestar.
   */
  unverified?: true;
  /** Likes recebidos hoje (veja WorldBuildingMeta.likesToday). */
  likesToday?: number;
  /** Batidas na porta desde que este Habblaud abriu (veja WorldBuildingMeta.knocks). */
  knocks?: number;
  /** "Enquanto você estava fora" ainda não visto (↓ `away.summary` ou /v1/me): visitas, likes e carimbos, sem quem. */
  summary?: AwaySummary;
  /** O código do prédio ("HB-4F2K", do /v1/me), para mandar a um amigo. */
  code?: string;
}

/** OfficeSnapshot.meta.world.building: o resumo do prédio (sem a conta), para a interface mostrar sem pedir o status. */
export interface WorldBuildingMeta {
  connected: boolean;
  paused: boolean;
  floors: number;
  agents: number;
  lastUplinkAt?: number;
  /** Saiu do mundo (veja WorldBuildingStatus.left). */
  left?: true;
  /** O servidor do mundo parou o prédio (`goodbye`); o motivo só vai no status, que não chega ao celular. */
  stopped?: true;
  /**
   * Visitantes dentro do prédio agora (↓ `visitors {count}` na conexão do prédio, Fase 4): ausente antes da primeira
   * contagem, sem conexão e com o prédio fechado a visitas (fechado, o servidor não manda nem o 0).
   */
  visitors?: number;
  /** Likes recebidos hoje (↓ `likes.today` ou /v1/me; Fase 5): o chip "❤️ 3 hoje" da barra. */
  likesToday?: number;
  /**
   * Batidas na porta desde que este Habblaud abriu (↓ `knock {}`, sem nome; só com `knocks` ligado na visibilidade):
   * a página mostra o aviso quando o número sobe.
   */
  knocks?: number;
  /** Há um "Enquanto você estava fora" ainda não visto (o resumo em si só vai no status, que não chega ao celular). */
  awaySummary?: true;
}

/** GET /api/world/last-uplink ("Ver o que foi enviado"): o pacote exato da última remessa, os bytes e a resposta. */
export interface WorldLastUplink {
  at: number;
  /** Bytes do JSON do pacote (UTF-8), como o servidor do mundo mede. */
  bytes: number;
  uplink: WorldUplink;
  ack?: WorldUplinkAck;
}

/**
 * OfficeSnapshot.meta.world: só o necessário para a interface decidir se mostra a seção (o snapshot também vai ao
 * celular e à linha do tempo: nada da conta aqui).
 */
export interface WorldMeta {
  /**
   * A seção aparece: HABBLAUD_WORLD não é 0 e o servidor do mundo foi aceito (o padrão, server.habblaud.com, ou uma
   * HABBLAUD_WORLD_URL válida). Com a URL recusada o recurso está desligado e nada do World aparece na interface.
   */
  enabled: boolean;
  /** Servidor do mundo aceito (o padrão ou HABBLAUD_WORLD_URL válida). */
  configured: boolean;
  state: WorldState;
  /** O prédio no mundo (só com a conta aprovada e o personagem criado). */
  building?: WorldBuildingMeta;
  /**
   * A cena Mundo (Fase 3), só com o World configurado, a conta aprovada e o personagem criado; `available` pede ainda a
   * trava do terminal (as rotas da cena exigem) e nenhuma parada de banimento, suspensão, versão recusada ou outro
   * computador (a conexão não volta sozinha). Pausado ou fora do mundo, vale (anda-se com o prédio apagado). A barra
   * mostra o botão Mundo com `available`.
   */
  scene?: WorldSceneMeta;
}

export interface WorldSceneMeta {
  available: boolean;
}

// ------------------------------------------------------------------------------------------- a cena Mundo (Fase 3)

/** Os comandos que o navegador pode mandar em POST /api/world/cmd (nada do prédio: hello, uplink e ping nunca). */
export const WORLD_SCENE_COMMANDS = [
  'move', 'profile', 'resync', 'view', 'view.off', 'enter', 'leave', 'like', 'unlike', 'greet', 'block', 'unblock', 'report',
  'stamp', 'teleport', 'knock', 'summary.seen',
] as const;
export type WorldSceneCommand =
  | MoveMessage
  | ProfileRequestMessage
  | ResyncMessage
  | ViewMessage
  | ViewOffMessage
  | EnterMessage
  | LeaveMessage
  | LikeMessage
  | GreetMessage
  | BlockMessage
  | ReportMessage
  | StampMessage
  | TeleportMessage
  | KnockMessage
  | SummarySeenMessage;

/** Comandos por lote (POST /api/world/cmd) e lotes por segundo por stream. */
export const WORLD_SCENE_LIMITS = { cmdsPerBatch: 20, batchesPerSec: 5, streams: 4 } as const;

/**
 * As mensagens da cidade que o stream repassa (evento `world`), como vieram do servidor do mundo. O servidor local já
 * conferiu o `rev` dos patches (um salto vira `resync` e o patch não passa) e descartou o que não é da cena.
 */
export type WorldSceneMessage =
  | AreaMessage
  | AreaPatchMessage
  | PlayersMessage
  | PlayerJoinMessage
  | PlayerLeaveMessage
  | PosMessage
  | MinimapMessage
  | AfkMessage
  | ProfileMessage
  | NoticeMessage
  | LikeUpdateMessage
  | GreetingMessage
  | BuildingMessage
  | BuildingPatchMessage
  | VisitorsMessage
  | CityStatusMessage
  | CityFireworksMessage
  | LikesTodayMessage
  | AwaySummaryMessage
  | KnockedMessage;

export const WORLD_SCENE_MESSAGES = [
  'area', 'area.patch', 'players', 'player.join', 'player.leave', 'pos', 'minimap', 'afk', 'profile', 'notice', 'like.update',
  'greeting', 'building', 'building.patch', 'visitors',
  'city', 'city.fireworks', 'likes.today', 'away.summary', 'knock',
] as const satisfies readonly WorldSceneMessage['t'][];

/**
 * Dentro de um prédio (Fase 4, cena Visita): o interior que o servidor do mundo mandou no `building` (ao entrar ou no
 * `resync {building}`), com cada `building.patch` já aplicado, e o `rev` do prédio em que está.
 */
export interface WorldSceneInside {
  /** Id do prédio (o id do dono). */
  id: string;
  rev: number;
  detail: WorldBuildingDetail;
}

/** A cidade (↓ `city`, Fase 5): prédios acesos, a meta da semana e a faixa dos tokens (as duas só com 10 prédios ou mais). */
export type WorldSceneCity = Omit<CityStatusMessage, 't'>;

/** Eu na cena: o jogador desta conta (do `welcome`), sem as opções de visibilidade. */
export interface WorldSceneMe {
  id: string;
  name: string;
  look: 'f' | 'm';
  parts: AppearanceParts;
  traits: TraitId[];
  intro?: IntroId;
  country?: string;
  /** O prédio desta conta (o id do prédio é o id do dono), se ela tem um no mundo. */
  buildingId?: string;
}

/** Os prédios de um chunk, com o `rev` em que estão. */
export interface WorldSceneChunk {
  chunk: string;
  rev: number;
  buildings: WorldBuildingPublic[];
}

/** O estado da cidade que o servidor local tem (evento `world.snapshot`): o navegador troca o dele inteiro por este. */
export interface WorldSceneSnapshot {
  /** Id deste stream: vai em POST /api/world/cmd. */
  stream: string;
  /**
   * A conexão com o servidor do mundo está aberta (`welcome`). Sem ela (caiu, reconectando, parada pelo servidor), nada
   * desce. Pausado ou fora do mundo, ela abre só com a cena aberta, sem pacote do prédio.
   */
  connected: boolean;
  /** `view` mandado: o servidor do mundo está mandando a área e os jogadores. */
  viewing: boolean;
  /** Distrito dos ids de chunk (`<distrito>:<cx>,<cy>`), do `welcome`. */
  district?: string;
  me?: WorldSceneMe;
  /** Minha posição: a do último `pos` do servidor (ou do meu id num `players`) ou a do último `move` mandado. */
  pos?: WorldPosition;
  /** O servidor mandou `afk` e ainda não houve comando de verdade (andar, virar, `view`, `profile`). */
  afk: boolean;
  /** Os chunks assinados (só os 3×3 em volta da minha posição). */
  chunks: WorldSceneChunk[];
  /** Os outros jogadores visíveis (nunca eu), com a posição mais recente. */
  players: WorldPlayerPublic[];
  /** O minimapa (prédios acesos por quarteirão), ou null antes do primeiro. */
  minimap: MinimapMessage['blocks'] | null;
  /** Dentro de um prédio: o interior (até o `pos` que diz "de volta à rua"). Ausente na rua. */
  inside?: WorldSceneInside;
  /** O último `city` (Fase 5): o servidor do mundo manda um ao abrir a cena e depois um por minuto. */
  city?: WorldSceneCity;
  /** Likes recebidos hoje pelo meu prédio (último ↓ `likes.today` desta conexão). */
  likesToday?: number;
  /** O último "Enquanto você estava fora" desta conexão, até o `summary.seen`. */
  summary?: AwaySummary;
}

/** GET /api/world/status (e a resposta de verify, login e logout). */
export interface WorldStatus {
  /** Dá para agir pela conta neste Habblaud (trava do terminal ligada: acesso só pelo próprio computador). */
  available: boolean;
  configured: boolean;
  state: WorldState;
  /**
   * `id`: o id da conta no mundo, quando já se sabe (do `welcome` da conexão do prédio); vai no assunto do recurso.
   * `reservedName`: o nome de jogador escolhido no cadastro, reservado enquanto não há personagem (de `GET /v1/me`).
   */
  account?: { emailMasked: string; access: WorldAccess; id?: string; reservedName?: string };
  player?: Player;
  devices?: DeviceInfo[];
  /** Código do último problema (worldLastError: só códigos conhecidos), quando os dados podem estar velhos. */
  lastError?: WorldKnownErrorCode;
  /** O prédio no mundo (só com a conta aprovada e o personagem criado). */
  building?: WorldBuildingStatus;
  /** Tema guardado para o prédio (PUT /api/world/theme); ausente = 'auto'. */
  theme?: WorldThemeChoice;
  /** Quem esta conta bloqueou (/v1/me; Fase 5): Configurações › Habblaud World › Bloqueados. */
  blocked?: WorldBlockedPlayer[];
}

/** Um jogador bloqueado (só o id que o mundo deu e o nome). */
export interface WorldBlockedPlayer {
  id: string;
  name: string;
}

export interface WorldErrorResponse {
  error: { code: string; message?: string; retryAfter?: number };
}

/**
 * Códigos dados pelo próprio servidor local. Ele também usa, com o mesmo sentido, alguns de WORLD_ERROR_CODES (os do
 * servidor do mundo): invalid, invalid_code, password_invalid, name_invalid, name_blocked, invalid_json, too_large,
 * unsupported_media_type, method_not_allowed, not_found e internal (500: erro do próprio servidor local).
 */
export const WORLD_LOCAL_ERROR_CODES = [
  'not_configured', // 409: sem servidor do mundo aceito (HABBLAUD_WORLD_URL recusada)
  'local_only', // 403: pela porta do celular ou com Host que não é local
  'terminal_off', // 403: trava do terminal desligada (porta exposta na rede ou HABBLAUD_TERMINAL=0)
  'not_logged_in', // 401: ação da conta sem ter entrado
  'session_expired', // em lastError: o servidor do mundo recusou o token (revogado ou vencido) e a sessão foi apagada
  'invalid_email', // 400
  'altcha_failed', // 502: o desafio anti-robô do servidor do mundo não teve solução
  'world_unreachable', // 502: sem conexão com o servidor do mundo
  'world_timeout', // 504
  'world_bad_response', // 502: resposta fora do formato
  'world_error', // erro do servidor do mundo sem código legível (mesmo status)
  'storage_failed', // em lastError: não deu para gravar world.json (a sessão vale só até reiniciar)
  'too_many_streams', // 429: a cena Mundo já está aberta em 4 abas
  'no_stream', // 409: comando de um stream que não está aberto (a cena fechou ou o servidor reiniciou)
  'not_connected', // 409: comando sem a conexão com o servidor do mundo aberta
  'account_deleted', // em lastError: a conta foi excluída (daqui ou de outro computador) e o world.json, apagado
  'network', // em lastError: sem conexão com o servidor do mundo ou sem resposta no prazo
  'unknown', // em lastError: outro problema (resposta fora do formato, código que esta versão não conhece)
] as const;
export type WorldLocalErrorCode = (typeof WORLD_LOCAL_ERROR_CODES)[number];

/** Todo código de erro conhecido: os do servidor do mundo e os do servidor local, sem repetir. */
export const WORLD_KNOWN_ERROR_CODES: readonly (WorldErrorCode | WorldLocalErrorCode)[] = [...new Set([...WORLD_ERROR_CODES, ...WORLD_LOCAL_ERROR_CODES])];
export type WorldKnownErrorCode = WorldErrorCode | WorldLocalErrorCode;

export function isWorldKnownErrorCode(v: unknown): v is WorldKnownErrorCode {
  return typeof v === 'string' && (WORLD_KNOWN_ERROR_CODES as readonly string[]).includes(v);
}

/**
 * O código que vai em WorldStatus.lastError: só os da lista; falta de conexão ou de resposta no prazo vira `network`, e
 * o resto (resposta fora do formato, erro sem código, código que esta versão não conhece) vira `unknown`.
 */
export function worldLastError(code: string): WorldKnownErrorCode {
  if (code === 'world_unreachable' || code === 'world_timeout') return 'network';
  if (code === 'world_bad_response' || code === 'world_error') return 'unknown';
  return isWorldKnownErrorCode(code) ? code : 'unknown';
}
