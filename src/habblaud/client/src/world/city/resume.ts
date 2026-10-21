// De volta à cidade na mesma página (Escritório → Mundo): o jogador volta EXATAMENTE onde estava. O servidor do mundo
// guarda a última posição por conta (no `view.off` ou na queda) e manda o `pos` inicial igual a ela; a cena guarda, ao
// esconder, a câmera, o zoom e onde o meu personagem estava, e ao reabrir decide com o `pos` que chega:
//   * o mesmo lugar: nada muda (nem o personagem, nem a câmera; a cidade de antes fica na tela até o snapshot novo);
//   * outro lugar: o personagem e a câmera vão direto para lá, sem animar um "teleporte", com o mesmo zoom;
//   * nada guardado (a primeira vez, ou fechou antes de nascer): o nascimento de sempre.

/** Onde a cidade estava ao esconder: a câmera (px de mundo), o zoom, se seguia o personagem e onde ele estava (tiles). */
export interface CityResume {
  camX: number;
  camY: number;
  zoom: number;
  following: boolean;
  me: { x: number; y: number } | null;
}

/** Até onde (tiles) o `pos` do servidor é "o mesmo lugar": a posição sobe arredondada e o último passo pode faltar. */
export const RESUME_SAME_TILES = 0.6;

export type ResumePlacement = 'keep' | 'snap' | 'fresh';

/** O que fazer com o `pos` inicial ao reabrir a cena (veja o topo do arquivo). */
export function resumePlacement(resume: CityResume | null, pos: { x: number; y: number } | null): ResumePlacement {
  if (!resume?.me || !pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return 'fresh';
  return Math.hypot(pos.x - resume.me.x, pos.y - resume.me.y) <= RESUME_SAME_TILES ? 'keep' : 'snap';
}
