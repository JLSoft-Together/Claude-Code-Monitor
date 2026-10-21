// Falas curtas dos personagens (balõezinhos) — puro. `{nome}` = um colega, `{sala}` = um projeto,
// `{v}` = valor da aposta, `{a}`/`{b}` = placar. Nada aqui depende do gênero de quem fala.
import type { TraitId } from './persona';
import { tr } from '../../../../shared/i18n';

export type Pool = readonly string[];

export const INVITE = {
  tv: [tr('Bora ver TV? 📺'), tr('Sessão pipoca? 🍿'), tr('Vai começar o programa!'), tr('Bora ver um pouco de TV?')],
  futebol: [tr('Vai começar o jogo! ⚽'), tr('Bora ver o futebol?'), tr('Tá passando o clássico! ⚽')],
  novela: [tr('Tá passando a novela! 📺'), tr('Bora ver o capítulo de hoje?')],
  desenho: [tr('Tá passando desenho! 😄'), tr('Bora ver desenho?')],
  videogame: [tr('Bora uma partida no videogame? 🎮'), tr('Duvido você me ganhar 🎮'), tr('Videogame? Melhor de três!')],
  arcade: [tr('Fliperama? 👾'), tr('Aposto que bato teu recorde 👾'), tr('Bora no fliperama?')],
  pingpong: [tr('Pingue-pongue? 🏓'), tr('Bora uma partidinha? 🏓'), tr('Vem jogar ping-pong!')],
  pingpongRival: [tr('Vem tomar uma surra no ping-pong 😏'), tr('Revanche no ping-pong? 🏓')],
  kitchen: [tr('Bora tomar um café? ☕'), tr('Pausa pro café? ☕'), tr('Bora dar uma pausa na copa?')],
  kitchenGossip: [tr('Tenho uma fofoca… 👀'), tr('Copa. Agora. Tenho novidade 👀')],
  talk: [tr('E aí, tudo certo?'), tr('Ei, {nome}!'), tr('Bora trocar uma ideia?'), tr('Opa, {nome}! Beleza?')],
  rps: [tr('Jokenpô valendo 🪙{v}?'), tr('Aposto 🪙{v} no jokenpô!'), tr('Pedra, papel e tesoura? 🪙{v}!')],
  rpsHonor: [tr('Jokenpô? Só pela honra 😅'), tr('Jokenpô valendo nada?')],
  mirror: [tr('Bora dar um tapa no visual? 💄'), tr('Espelho? Preciso me arrumar ✨')],
} satisfies Record<string, Pool>;

export const ACCEPT: Pool = [tr('Bora!'), tr('Partiu!'), 'Fechado! 🤝', tr('Só se for agora!'), tr('Opa!'), tr('Já é!'), tr('Demorou!')];
export const ACCEPT_BET: Pool = ['Fechado! 🤝', tr('Prepara o bolso 💰'), tr('Vai perder!'), tr('Aceito!')];
export const ACCEPT_BROKE: Pool = [tr('Tô liso 😅 Só pela honra!'), tr('Sem 🪙… valendo nada?')];
export const ACCEPT_SLEEPY: Pool = [tr('Hã? Ah… bora 😴'), tr('Acordei! Bora.'), tr('Cinco minutinhos… tá, bora.')];
export const ACCEPT_SHELL: Pool = [tr('Enquanto o build roda… bora! ⏳'), tr('Meu comando tá rodando, dá tempo ⏳'), tr('Tô esperando o terminal mesmo…')];
export const ACCEPT_STINGY: Pool = [tr('Aposta? Só um pouquinho 💰'), tr('Valendo pouco, hein')];

export const TV = {
  futebol: {
    goal: ['GOOOL! ⚽', tr('É GOL!!'), tr('GOLAÇO! ⚽'), tr('Que golaço!')],
    miss: ['Uuuuh! 😱', tr('Na trave!'), tr('Quase!'), tr('Perdeu essa?!')],
    against: [tr('Ah não! Gol deles 😩'), tr('Que fase…'), tr('Acorda, zaga!'), tr('Não acredito…')],
    talk: [tr('Juiz ladrão! 😤'), tr('Que jogada!'), tr('Esse goleiro é bom demais'), tr('Bora, time!'), tr('Isso foi pênalti!'), tr('Tá jogando muito!')],
  },
  novela: {
    twist: [tr('Não acredito! 😱'), tr('Eu sabia!'), tr('Que reviravolta!'), tr('Mentira!!')],
    love: [tr('Esse casal! 😍'), 'Finalmente! 😍', tr('Que romance…')],
    talk: [tr('Shhh, vai começar!'), tr('Chora não… 😭'), tr('Esse vilão não presta'), tr('Amanhã é o último capítulo!')],
  },
  desenho: {
    funny: ['KKKKK 😂', tr('Hahaha!'), tr('Muito bom 😂'), tr('Esse desenho é demais!')],
    talk: [tr('Eu assistia isso criança!'), tr('Clássico!'), tr('Olha a cara dele 😂')],
  },
  end: [tr('Bom demais!'), tr('Amanhã tem mais 📺'), tr('Que episódio!'), tr('Valeu a pausa!')],
} as const;

export const GAME = {
  trash: [tr('Vou te passar! 🏎️'), tr('Que lag é esse?!'), 'Combo! 💥', tr('Não vale!'), tr('Tá fácil 😎'), tr('Só aquecendo…'), tr('Ninguém me para!'), tr('Olha essa!')],
  round: [tr('Ganhei essa! 🏆'), tr('Uma a zero!'), tr('Toma!')],
  cheer: [tr('Vai, {nome}!'), tr('Uooou!'), tr('Que jogada!'), tr('Aperta o botão!')],
};

export const PINGPONG = {
  point: [tr('Ponto! 🏓'), tr('Toma!'), tr('Na quina!'), tr('Corta!'), tr('Defende essa!')],
  cheer: [tr('Boa!'), tr('Vai, {nome}!'), tr('Uooou!'), tr('Que ralo!')],
  final: ['{a} a {b}! 🏆', tr('Ganhei de {a} a {b}! 🏆')],
};

export const RPS = {
  count: [tr('Jo…'), tr('Ken…'), tr('Pô!')],
  tie: [tr('Empate! De novo!'), tr('Pensamos igual 😂'), tr('De novo!')],
  win: [tr('Ganhei! 💰'), tr('Hoje é meu dia!'), tr('Passa o 🪙!'), tr('Mole demais 😎'), tr('Sabia!')],
  winHonor: [tr('Ganhei! 😎'), tr('Sabia!'), tr('Hoje é meu dia!')],
  lose: [tr('Não valeu!'), tr('Sorte sua…'), tr('Meu dinheiro… 😭'), tr('Tá, tá…'), tr('Era pra ser pedra!')],
  rematch: [tr('Revanche!'), tr('Melhor de três!'), tr('De novo, valendo!')],
  stalemate: [tr('Deixa quieto 😅'), tr('Empatamos, então.')],
  watch: ['KKKKK', tr('Uou!'), tr('Eita!'), tr('Paga!')],
};

export const MIRROR = {
  solo: ['Arrasei ✨', tr('Hoje eu tô on 😎'), tr('Cabelo no lugar ✅'), tr('Look aprovado ✨'), tr('Esse cabelo não colabora…'), tr('Pronto pra próxima reunião ✨')],
  lipstick: [tr('Batom perfeito 💄'), tr('Agora sim 💋')],
  duo: [tr('Empresta o pente?'), tr('Ficou ótimo!'), tr('Que tal?'), tr('Tá arrasando!')],
};

export const CHAT = {
  fofoca: [tr('Viram o commit de {nome}? 👀'), tr('Dizem que {sala} vai pro ar hoje…'), tr('{nome} tá há horas no mesmo bug 🤫'), tr('Ouvi dizer que vai ter pizza 🍕'), tr('Sabia que {nome} aposta tudo no jokenpô?')],
  work: [tr('Meu build passou de primeira 😎'), tr('Esse bug em {sala} tá osso'), tr('Deploy na sexta? 😈'), tr('Quem mexeu no package-lock?!'), tr('Os testes estão verdes ✅'), tr('Tô esperando o review…'), tr('Escrevi 300 linhas e apaguei 400'), tr('Refatorei {sala} inteiro hoje')],
  cafeina: [tr('Esse café tá forte!'), tr('Já é o quinto café ☕'), tr('Sem café não compila ☕')],
  piadas: [tr('Funciona na minha máquina! 😂'), tr('Por que o dev foi ao médico? Muitos bugs 🐛'), tr('Existem 10 tipos de pessoas… 😏'), tr('Commit: "ajustes finais (agora vai)"'), tr('Meu código não tem bug, tem feature surpresa')],
  esporte: [tr('Viu o jogo ontem? ⚽'), tr('Bora correr no fim de semana?')],
  series: [tr('Viram o último episódio? 📺'), tr('Sem spoiler, por favor!')],
  games: [tr('Zerei aquele jogo ontem 🎮'), tr('Bora jogar online hoje?')],
  leitura: [tr('Tô lendo um livro ótimo 📚'), tr('Terminei aquele livro!')],
  calma: [tr('Respira… tudo vai compilar 🧘'), tr('Um passo de cada vez.')],
  apostas: [tr('Quem topa um jokenpô depois? 🎲'), tr('Tô com sorte hoje 🍀')],
  economia: [tr('Tô juntando 🪙 pra férias'), tr('Café de graça é o melhor café')],
  generic: [tr('E o fim de semana?'), tr('Preciso de férias 🏖️'), tr('Que dia, hein'), tr('Tá tudo corrido hoje')],
  react: ['KKKKK', tr('Sério?!'), tr('Não acredito 😮'), tr('Verdade!'), tr('Hahaha'), tr('Nem me fala…'), '👀', tr('Pois é'), tr('Mentira!'), tr('Que isso!')],
  laugh: ['KKKKK', tr('Hahaha!'), '😂😂😂'],
};

/** Saindo de uma roda porque o trabalho chamou. */
export const CALLED: Pool = [tr('Opa, me chamaram! 🏃'), tr('Fui! Trabalho chegou'), tr('Volto já!'), tr('Ih, tenho que ir!')];
export const SHELL_DONE: Pool = [tr('Meu comando terminou! 🏃'), tr('Terminou o build, fui!')];

/** Temas de papo que cada traço puxa. */
export const TRAIT_TOPICS: Partial<Record<TraitId, keyof typeof CHAT>> = {
  fofoca: 'fofoca',
  cafeina: 'cafeina',
  piadas: 'piadas',
  esporte: 'esporte',
  series: 'series',
  games: 'games',
  leitura: 'leitura',
  calma: 'calma',
  apostas: 'apostas',
  economia: 'economia',
};

/** Fala ligada ao dia/hora local, quando houver (sexta, segunda, manhã, almoço, noite). */
export function timeLine(d: Date): string | null {
  const day = d.getDay();
  const h = d.getHours();
  if (day === 5 && h >= 12) return tr('Sextou! 🎉');
  if (day === 1 && h < 12) return tr('Segunda-feira, né…');
  if (h >= 6 && h < 10) return tr('Bom dia! ☀️');
  if (h >= 11 && h < 14) return tr('Que fome… almoço? 🍽️');
  if (h >= 20 || h < 5) return tr('Ainda aqui a essa hora? 🌙');
  return null;
}

export interface LineVars {
  nome?: string;
  sala?: string;
  v?: number | string;
  a?: number | string;
  b?: number | string;
}

/** Preenche os campos da fala. Sem valor para um campo, a fala é descartada (retorna null). */
export function fill(line: string, vars: LineVars): string | null {
  let ok = true;
  const out = line.replace(/\{(nome|sala|v|a|b)\}/g, (_, k: keyof LineVars) => {
    const v = vars[k];
    if (v === undefined || v === '') {
      ok = false;
      return '';
    }
    return String(v);
  });
  return ok ? out : null;
}

/** Sorteia uma fala do conjunto (evitando `avoid` e as que não dá para preencher). */
export function pick(pool: Pool, rng: () => number, vars: LineVars = {}, avoid?: string | null): string {
  const n = pool.length;
  const start = Math.floor(rng() * n);
  let fallback: string | null = null;
  for (let i = 0; i < n; i++) {
    const s = fill(pool[(start + i) % n], vars);
    if (s === null) continue;
    if (s !== avoid) return s;
    fallback ??= s;
  }
  return fallback ?? pool.find((l) => !/\{\w+\}/.test(l)) ?? '…';
}
