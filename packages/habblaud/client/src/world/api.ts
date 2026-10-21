// CONTRATO do mundo (canvas do escritório) consumido pela UI (client/src/ui/**).
// Implementação: client/src/world/index.ts -> createWorld().
// Regra: mudanças aqui devem ser ADITIVAS.

export type Selection = { type: 'agent'; id: string } | { type: 'room'; id: string } | null;

export interface WorldOptions {
  /** Mostrar etiquetas com os nomes dos personagens. */
  showNames: boolean;
  /** Balões de atividade: todos, só importantes (precisa de você, selecionado, mudanças recentes) ou nenhum. */
  bubbles: 'all' | 'important' | 'none';
  /** Frequência de passeios pelo escritório quando os agentes estão ociosos. */
  liveliness: 'calm' | 'normal' | 'lively';
  /** Câmera acompanha o agente selecionado. */
  followSelected: boolean;
  /** Ciclo dia/noite pela hora local (janelas, iluminação). */
  dayNight: boolean;
  /** (Opcional, aditivo) Ciclo dia/noite: automático, sempre dia ou sempre noite. Vale sobre `dayNight`. */
  daylight?: DaylightMode;
  /** Tema visual: automático (segue o calendário; ver seasonalThemeFor), nenhum, Natal ou Halloween. */
  theme?: OfficeTheme;
}

/** Tema que o renderer desenha: o escritório original ('none') ou um dos sazonais. */
export type SeasonalTheme = 'none' | 'christmas' | 'halloween';
export type OfficeTheme = 'auto' | SeasonalTheme;

/**
 * Tema desenhado numa data (hora local). No automático: Halloween de 1º a 31 de outubro, Natal de 1º de novembro a
 * 26 de dezembro e, no resto do ano, o escritório original.
 */
export function seasonalThemeFor(theme: OfficeTheme | undefined, date: Date): SeasonalTheme {
  if (theme && theme !== 'auto') return theme;
  const month = date.getMonth();
  if (month === 9) return 'halloween';
  if (month === 10 || (month === 11 && date.getDate() <= 26)) return 'christmas';
  return 'none';
}

/** Ciclo dia/noite: segue a hora local, ou fixa o dia ou a noite. */
export type DaylightMode = 'auto' | 'day' | 'night';

/** Sons do ambiente que o mundo sugere (quem toca, e se toca, é a UI). */
export type SoundCueKind = 'keys' | 'elevator' | 'pingpong' | 'table' | 'arcade';

export interface SoundCue {
  kind: SoundCueKind;
  /** 0..1: proximidade (zoom, fora da tela...). */
  gain: number;
  /** -1 (esquerda) .. 1 (direita): posição na tela. */
  pan: number;
  /** Teclado: quantas teclas na rajada. */
  count?: number;
}

export interface WorldApi {
  /** Seleciona (ou limpa) um agente/sala. `focus` move a câmera até ele. */
  select(sel: Selection, opts?: { focus?: boolean }): void;
  getSelection(): Selection;
  /** Disparado quando a seleção muda (por clique no canvas ou por select()). */
  onSelect(cb: (sel: Selection) => void): () => void;
  /** Agente sob o cursor (para tooltips da UI). */
  onHover(cb: (agentId: string | null) => void): () => void;
  focusAgent(id: string, opts?: { follow?: boolean }): void;
  focusRoom(id: string): void;
  /** Enquadra o prédio inteiro. */
  overview(): void;
  zoomBy(factor: number): void;
  getOptions(): WorldOptions;
  setOptions(o: Partial<WorldOptions>): void;
  /** Posição na tela (CSS px, relativo à viewport) logo acima da cabeça do personagem, ou null se não visível. */
  screenPositionOf(agentId: string): { x: number; y: number } | null;
  /**
   * (Opcional, aditivo) Área da tela coberta por painéis da UI, em px CSS. O mundo passa a enquadrar
   * (visão geral) e centralizar (focusAgent/focusRoom/seguir) dentro da área livre.
   */
  setViewInsets?(insets: Partial<ViewInsets>): void;
  /**
   * (Opcional, aditivo) Vida social de um agente presente no escritório: personalidade, carteira de
   * moedinhas, amizades/rivalidades com quem está lá agora e a roda de que participa. null se não está.
   */
  social?(agentId: string): AgentSocial | null;
  /** (Opcional, aditivo) Botão direito numa sala do escritório: id da sala e o ponto do clique (px da janela). */
  onRoomContextMenu?(cb: (roomId: string, at: { x: number; y: number }) => void): () => void;
  /** (Opcional, aditivo) Acontecimentos sociais (partidas e apostas) para o feed. */
  onSocialEvent?(cb: (e: SocialEvent) => void): () => void;
  /**
   * (Opcional, aditivo) Timelapse: com `p`, o mundo passa a desenhar o dia reproduzido (relógio e fator de
   * animação de `p`); `null` volta ao vivo. Cada chamada recomeça o mundo do zero (ninguém anda até a mesa:
   * todos já aparecem no lugar), então chame ao entrar, ao pular para outro ponto e ao sair; o próximo
   * snapshot do store é aplicado como carga inicial.
   */
  setPlayback?(p: WorldPlayback | null): void;
  /** (Opcional, aditivo) Sons do ambiente: teclado de quem trabalha à vista, elevador, rodas. */
  onSound?(cb: (cue: SoundCue) => void): () => void;
  /**
   * (Opcional, aditivo) Escritório fora da tela (a cena da cidade está aberta): para o desenho e o teclado da
   * câmera; ao voltar, a simulação avança o tempo que passou (como com a aba em segundo plano).
   */
  setSuspended?(suspended: boolean): void;
  destroy(): void;
}

/** Relógios do timelapse (ver world/playback.ts). */
export interface WorldPlayback {
  /** Instante reproduzido (epoch ms): hora do céu, da iluminação e do relógio de parede. */
  clock(): number;
  /** Fator de animação (1 = tempo real; 0 = pausado). */
  scale(): number;
}

export interface AgentSocial {
  traits: { emoji: string; label: string; desc: string }[];
  /** Bordão ("Tá pago!"). */
  catchphrase: string;
  /** Saldo de moedinhas (🪙). */
  coins: number;
  /** Quanto já ganhou trabalhando (saldo inicial + tarefas + pedidos + entregas). */
  earned: number;
  wins: number;
  losses: number;
  /** Colegas presentes com quem tem amizade ou rivalidade; `record` = [vitórias, derrotas] contra ele. */
  bonds: { id: string; name: string; kind: 'amizade' | 'rivalidade'; record: [number, number] | null }[];
  /** O que está fazendo numa roda agora ("📺 Vendo futebol na TV com Rafaela"), ou null. */
  doing: string | null;
  /** Extrato: movimentações mais recentes primeiro. */
  ledger: { at: number; delta: number; icon: string; text: string }[];
}

/** Partida/aposta resolvida (vira uma linha do feed). */
export interface SocialEvent {
  id: string;
  at: number;
  icon: string;
  /** Protagonista (quem venceu). */
  agentId: string;
  /** Texto sem o nome do protagonista: "ganhou 🪙10 de Caio no jokenpô". */
  text: string;
  /** Onde aconteceu ("Lounge", "Copa"...). */
  place: string;
}

/** Margens da viewport cobertas pela UI (px CSS). */
export interface ViewInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const DEFAULT_WORLD_OPTIONS: WorldOptions = {
  showNames: true,
  bubbles: 'important',
  liveliness: 'normal',
  followSelected: false,
  dayNight: true,
  theme: 'auto',
};
