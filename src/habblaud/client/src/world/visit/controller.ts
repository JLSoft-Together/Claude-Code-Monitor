// O miolo da cena Visita, sem DOM (testável): o interior do prédio que desceu do mundo vira o escritório do `Sim`
// (shared/world/office-from-world.ts) e cada `building.patch` é aplicado na hora, com o `rev` do prédio conferido
// (salto: ↑ `resync {building}`, no máximo um a cada 5 s). Os únicos comandos que saem daqui são `leave` e
// `resync {building}`, pelo stream da cena Mundo (POST /api/world/cmd): nenhum `move` (a posição lá dentro não vai ao
// servidor do mundo) e nenhum `view` (o viewer entenderia como "voltou à cidade").
import type { WorldSceneCommand, WorldSceneInside } from '../../../../shared/world/api';
import { applyBuildingPatch, checkBuildingRev, officeFromBuilding } from '../../../../shared/world/office-from-world';
import type { BuildingPatchMessage, WorldBuildingDetail } from '../../../../shared/world/protocol';
import type { OfficeSnapshot } from '../../../../shared/types';
import type { VisitLight } from '../sim/sim';
import { visitLightOf } from './model';

/** Espera mínima entre dois `resync {building}`. */
export const VISIT_RESYNC_GAP_MS = 5_000;

export interface VisitControllerDeps {
  /** Publica o escritório da visita (o `store.pushReplay` do mundo da visita). */
  push(snap: OfficeSnapshot): void;
  /** Manda comandos pelo stream da cena Mundo (só `leave` e `resync {building}` saem daqui). */
  send(cmds: WorldSceneCommand[]): void;
  now(): number;
  /** Versão do Habblaud (vai em `meta.version` do escritório da visita). */
  version: string;
  /** O interior mudou (faixa, painel, luzes, tema). */
  changed?(): void;
}

export class VisitController {
  readonly id: string;
  rev: number;
  /** O interior como está agora (com os patches aplicados). */
  detail: WorldBuildingDetail;
  snapshot: OfficeSnapshot;
  /** `leave` já mandado: esperando o `pos` (a volta à rua). */
  leaving = false;
  private resyncAt = -Infinity;

  constructor(
    inside: WorldSceneInside,
    private readonly deps: VisitControllerDeps,
  ) {
    this.id = inside.id;
    this.rev = inside.rev;
    this.detail = structuredClone(inside.detail);
    this.snapshot = officeFromBuilding(this.detail, deps.now(), { version: deps.version });
    deps.push(this.snapshot);
  }

  /** As luzes do prédio agora. */
  get light(): VisitLight {
    return visitLightOf(this.detail.building);
  }

  /**
   * O interior inteiro de novo (`building` de um `resync`, um `enter` repetido ou o snapshot de um stream novo):
   * substitui tudo, inclusive o `rev`, mas como patch (quem continua no mesmo status não se mexe).
   */
  replace(inside: Pick<WorldSceneInside, 'rev' | 'detail'>): void {
    const d = structuredClone(inside.detail);
    const r = applyBuildingPatch(this.snapshot, { rev: inside.rev, floors: d.floors, building: d.building }, this.deps.now());
    this.rev = inside.rev;
    this.detail = d;
    this.resyncAt = -Infinity;
    this.publish(r.snapshot);
  }

  /** Um `building.patch`: aplica o seguinte, ignora o repetido ou velho e pede o prédio de novo num salto. */
  patch(msg: Pick<BuildingPatchMessage, 'rev' | 'floors' | 'visitors' | 'building'>): 'apply' | 'stale' | 'resync' {
    const what = checkBuildingRev(this.rev, msg.rev);
    if (what === 'stale') return what;
    if (what === 'resync') {
      const now = this.deps.now();
      if (now - this.resyncAt >= VISIT_RESYNC_GAP_MS) {
        this.resyncAt = now;
        this.deps.send([{ t: 'resync', building: this.id }]);
      }
      return what;
    }
    // o `building` atual decide se os agentes aparecem quando o patch só traz os andares
    const r = applyBuildingPatch(this.snapshot, msg, this.deps.now(), this.detail.building);
    this.rev = msg.rev;
    if (msg.floors) this.detail.floors = structuredClone(msg.floors);
    if (msg.building) this.detail.building = structuredClone(msg.building);
    if (typeof msg.visitors === 'number') this.detail.visitors = msg.visitors;
    this.publish(r.snapshot);
    return what;
  }

  /** Sair do prédio: `leave` (uma vez); a volta à rua é o `pos` que o servidor responde. */
  leave(): boolean {
    if (this.leaving) return false;
    this.leaving = true;
    this.deps.send([{ t: 'leave' }]);
    this.deps.changed?.();
    return true;
  }

  private publish(snap: OfficeSnapshot): void {
    if (snap !== this.snapshot) {
      this.snapshot = snap;
      this.deps.push(snap);
    }
    this.deps.changed?.();
  }
}
