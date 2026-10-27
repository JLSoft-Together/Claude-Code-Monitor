import type { ArtModule } from '../art/api';
import type { SeasonalTheme, WorldOptions } from './api';
import type { WorldAssets } from './assets';
import type { Camera } from './camera';
import type { HeadInfo } from './render/renderer';
import type { AreaVis } from './render/scene';
import type { Sim } from './sim/sim';

export interface ViewPoint {
  x: number;
  y: number;
}

export interface ViewRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Projection {
  toView(x: number, y: number, h?: number): ViewPoint;
  toWorld(vx: number, vy: number): ViewPoint;
  bounds(r: ViewRect, h?: number): ViewRect;
  roomOutline?(r: ViewRect): ViewPoint[];
}

export interface WorldRenderer {
  readonly ctx: CanvasRenderingContext2D;
  readonly heads: Map<string, HeadInfo>;
  readonly areas: Map<string, AreaVis>;
  setAssets(a: WorldAssets | null): void;
  sync(theme?: SeasonalTheme): void;
  frame(now: number, dt: number, opts: WorldOptions, sel: { agent: string | null; room: string | null; hover: string | null }): void;
  pruneHeads(): void;
  clock: () => number;
  paintingRect(areaId: string): ViewRect | null;
  signRect(vis: AreaVis): ViewRect | null;
  signIsDark(vis: AreaVis): boolean;
  hourOverride: number | null;
  warmUp?(budgetMs: number): void;
  settled?(): boolean;
}

export type RendererFactory = (canvas: HTMLCanvasElement, art: ArtModule, sim: Sim, camera: Camera) => WorldRenderer;
