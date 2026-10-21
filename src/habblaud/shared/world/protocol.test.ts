// O exemplo da seção 3.3 do plano (docs/world/privacidade.md) contra o schema.json, com um validador mínimo próprio (o
// Habblaud não tem dependências de runtime nem o Ajv; o servidor do mundo valida o mesmo arquivo com o Ajv), e as listas
// do protocolo conferidas contra o resto do código.
import { describe, expect, it } from 'vitest';
import * as appearance from '../appearance';
import { LOCALES as UI_LOCALES } from '../i18n';
import schemaJson from './schema.json';
import { compileValidator } from './schema-validator';
import {
  ACCESSORIES,
  BOTTOM_STYLES,
  FACIAL_HAIR,
  GOODBYE_REASONS,
  GREETING_IDS,
  HAIR_STYLES,
  INTRO_IDS,
  LOCALES,
  NOTICE_IDS,
  PLAYER_NAME_LIMITS,
  REPORT_REASONS,
  STAMP_IDS,
  CITY_GOAL_IDS,
  TOP_STYLES,
  TRAIT_CLASHES,
  TRAIT_IDS,
  UPLINK_ACK_ERRORS,
  UPLINK_LIMITS,
  VISIBILITY_DEFAULTS,
  WORLD_ERROR_CODES,
  WORLD_LOCALES,
  type AppearanceParts,
  type DeleteConfirmRequest,
  type MeBuilding,
  type Visibility,
  type WorldBuildingPublic,
  type WorldExport,
  type WorldAgentStatus,
  type WorldTheme,
  type WorldUplink,
} from './protocol';

const schema = schemaJson as unknown as { [k: string]: unknown } & {
  properties: Record<string, { maxItems?: number }>;
  $defs: Record<string, { [k: string]: unknown }>;
};
const validate = compileValidator(schema);
const valid = (data: unknown) => validate(data).length === 0;

// ---------------------------------------------------------------------------------------------------------------
// O exemplo da seção 3.3
// ---------------------------------------------------------------------------------------------------------------

const MARINA_PARTS = {
  skin: '#e8b48c', hair: '#2b1d14', hairStyle: 'bob', eyes: '#3b5a7a', top: '#4a6fa5',
  topStyle: 'hoodie', bottom: '#2f3542', bottomStyle: 'pants', shoes: '#ffffff',
  accessory: 'glasses', accessoryColor: '#222222', facialHair: 'none',
} as const satisfies AppearanceParts;

/** O exemplo exatamente como está na seção 3.3 (com a abreviação `"...": "..."` nas peças de dois agentes). */
const EXEMPLO_3_3 = JSON.parse(`{
  "v": 1,
  "version": "1.0.0",
  "theme": "halloween",
  "floors": [
    {
      "id": "f_8c1e5f7a2b",
      "agents": [
        { "id": "a_3f9d2c7e", "kind": "main", "provider": "claude", "status": "working",
          "look": "f", "name": "Marina",
          "parts": { "skin": "#e8b48c", "hair": "#2b1d14", "hairStyle": "bob", "eyes": "#3b5a7a", "top": "#4a6fa5",
                     "topStyle": "hoodie", "bottom": "#2f3542", "bottomStyle": "pants", "shoes": "#ffffff",
                     "accessory": "glasses", "accessoryColor": "#222222", "facialHair": "none" } },
        { "id": "a_71c0b5a9", "kind": "sub", "parentId": "a_3f9d2c7e", "provider": "claude", "status": "working",
          "look": "m", "name": "Caio", "parts": { "...": "..." } }
      ]
    },
    { "id": "f_02aa91c4de",
      "agents": [ { "id": "a_b2e74d10", "kind": "main", "provider": "codex", "status": "idle",
                    "look": "m", "name": "Rafael", "parts": { "...": "..." } } ] }
  ]
}`) as unknown;

/** O mesmo exemplo com a abreviação desfeita (peças de verdade), e nada mais. Também confere o tipo WorldUplink. */
const EXEMPLO_COMPLETO: WorldUplink = {
  v: 1,
  version: '1.0.0',
  theme: 'halloween',
  floors: [
    {
      id: 'f_8c1e5f7a2b',
      agents: [
        { id: 'a_3f9d2c7e', kind: 'main', provider: 'claude', status: 'working', look: 'f', name: 'Marina', parts: MARINA_PARTS },
        {
          id: 'a_71c0b5a9', kind: 'sub', parentId: 'a_3f9d2c7e', provider: 'claude', status: 'working', look: 'm', name: 'Caio',
          parts: { ...MARINA_PARTS, hairStyle: 'short', facialHair: 'stubble', accessory: 'none' },
        },
      ],
    },
    {
      id: 'f_02aa91c4de',
      agents: [
        {
          id: 'a_b2e74d10', kind: 'main', provider: 'codex', status: 'idle', look: 'm', name: 'Rafael',
          parts: { skin: '#8d5524', hairStyle: 'buzz', topStyle: 'polo', bottomStyle: 'shorts' },
        },
      ],
    },
  ],
};

const clone = <T>(x: T): T => structuredClone(x);

describe('schema.json do WorldUplink (validador mínimo)', () => {
  it('aceita o exemplo da seção 3.3 com a abreviação desfeita', () => {
    expect(validate(EXEMPLO_COMPLETO)).toEqual([]);
  });

  it('o exemplo literal só falha pela abreviação "..." das peças', () => {
    const motivos = validate(EXEMPLO_3_3).map((e) => `${e.keyword} ${e.path}`);
    expect(motivos.sort()).toEqual(['additionalProperties /floors/0/agents/1/parts', 'additionalProperties /floors/1/agents/0/parts']);
  });

  it('aceita o pacote mínimo e o opcional de tokens', () => {
    expect(valid({ v: 1, version: '0.11.0', theme: 'none', floors: [] })).toBe(true);
    expect(valid({ v: 1, version: '1.2.3-beta.1', theme: 'christmas', floors: [], tokens: { day: 12000, week: 340000 } })).toBe(true);
  });

  it('recusa campo desconhecido em qualquer profundidade', () => {
    const raiz = { ...clone(EXEMPLO_COMPLETO), path: '/Users/fulano/projeto' };
    const andar = clone(EXEMPLO_COMPLETO);
    (andar.floors[0] as unknown as Record<string, unknown>)['name'] = 'Projeto secreto';
    const agente = clone(EXEMPLO_COMPLETO);
    (agente.floors[0]!.agents[0] as unknown as Record<string, unknown>)['title'] = 'Corrigir login';
    const pecas = clone(EXEMPLO_COMPLETO);
    (pecas.floors[0]!.agents[0]!.parts as Record<string, unknown>)['seed'] = 123;
    const tokens = clone(EXEMPLO_COMPLETO);
    tokens.tokens = { day: 1, week: 2, costUSD: 3 } as WorldUplink['tokens'];
    for (const p of [raiz, andar, agente, pecas, tokens]) expect(valid(p)).toBe(false);
  });

  it('recusa enumerações, formatos e limites fora do protocolo', () => {
    const casos: Array<(u: WorldUplink) => void> = [
      (u) => { (u as { v: number }).v = 2; },
      (u) => { (u as { theme: string }).theme = 'auto'; },
      (u) => { u.version = 'mais nova'; },
      (u) => { u.floors[0]!.id = 'f_projeto-x'; },
      (u) => { u.floors[0]!.agents[0]!.id = 'a_3f9d'; }, // 4 hex: a 6.1 pede 8
      (u) => { (u.floors[0]!.agents[0] as { status: string }).status = 'done'; },
      (u) => { (u.floors[0]!.agents[0] as { tasksDone: number }).tasksDone = 4; },
      (u) => { (u.floors[0]!.agents[0] as { compacted: boolean }).compacted = false; },
      (u) => { u.floors[0]!.agents[0]!.parts.skin = 'red'; },
      (u) => { (u.floors[0]!.agents[0]!.parts as { hairStyle: string }).hairStyle = 'moicano'; },
      (u) => { u.floors[0]!.agents[0]!.name = 'x'.repeat(25); },
      (u) => { u.floors[0]!.agents[0]!.name = 'Projeto /Users/x'; },
      (u) => { u.tokens = { day: -1, week: 0 }; },
      (u) => { u.tokens = { day: 1.5, week: 0 }; },
      (u) => { u.floors[0]!.agents[0]!.parentId = 'a_71c0b5a9'; }, // principal com pai
      (u) => { u.floors = Array.from({ length: 65 }, (_, i) => ({ id: `f_${i.toString(16).padStart(10, '0')}`, agents: [] })); },
    ];
    for (const [i, mudar] of casos.entries()) {
      const u = clone(EXEMPLO_COMPLETO);
      mudar(u);
      expect(valid(u), `caso ${i}`).toBe(false);
    }
  });

  it('subagente sem o pai no pacote vai sem parentId (o pai já saiu); principal nunca leva parentId', () => {
    const u = clone(EXEMPLO_COMPLETO);
    delete u.floors[0]!.agents[1]!.parentId;
    expect(validate(u)).toEqual([]);
    u.floors[0]!.agents[0]!.parentId = 'a_71c0b5a9';
    expect(valid(u)).toBe(false);
  });

  it('o validador mínimo não ignora palavra-chave nenhuma', () => {
    expect(() => compileValidator({ type: 'string', format: 'email' })('x')).toThrow(/format/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// As listas do protocolo contra o schema e o resto do código
// ---------------------------------------------------------------------------------------------------------------

describe('listas do protocolo', () => {
  it('estilos da aparência: iguais aos de shared/appearance.ts e aos do schema, e as mesmas peças', () => {
    expect(HAIR_STYLES).toEqual(appearance.HAIR_STYLES);
    expect(TOP_STYLES).toEqual(appearance.TOP_STYLES);
    expect(ACCESSORIES).toEqual(appearance.ACCESSORIES);
    expect(FACIAL_HAIR).toEqual(appearance.FACIAL_HAIR);
    expect(BOTTOM_STYLES).toEqual(appearance.BOTTOM_STYLES);
    const parts = schema.$defs.parts.properties as Record<string, { enum?: unknown[] }>;
    expect(Object.keys(parts)).toEqual([...appearance.PART_KEYS]);
    expect(parts.hairStyle.enum).toEqual([...HAIR_STYLES]);
    expect(parts.topStyle.enum).toEqual([...TOP_STYLES]);
    expect(parts.accessory.enum).toEqual([...ACCESSORIES]);
    expect(parts.facialHair.enum).toEqual([...FACIAL_HAIR]);
    expect(parts.bottomStyle.enum).toEqual([...BOTTOM_STYLES]);
  });

  it('limites e enumerações do schema batem com os tipos', () => {
    expect(schema.properties.floors.maxItems).toBe(UPLINK_LIMITS.floors);
    expect((schema.$defs.floor.properties as Record<string, { maxItems: number }>).agents.maxItems).toBe(UPLINK_LIMITS.agentsPerFloor);
    const themes: WorldTheme[] = ['none', 'halloween', 'christmas'];
    expect(schema.$defs.theme.enum).toEqual(themes);
    const statuses: WorldAgentStatus[] = ['working', 'waiting', 'idle', 'shell'];
    expect((schema.$defs.agent.properties as Record<string, { enum: unknown[] }>).status.enum).toEqual(statuses);
  });

  it('ids fixos do contrato: 14 traços, 5 pares que não combinam, 20 frases, 10 cumprimentos, 4 idiomas', () => {
    const unique = (l: readonly string[]) => new Set(l).size === l.length;
    expect(TRAIT_IDS).toHaveLength(14);
    expect(INTRO_IDS).toHaveLength(20);
    expect(GREETING_IDS).toHaveLength(10);
    for (const l of [TRAIT_IDS, INTRO_IDS, GREETING_IDS, REPORT_REASONS, GOODBYE_REASONS]) expect(unique(l)).toBe(true);
    expect(TRAIT_CLASHES.map((p) => p.join('×'))).toEqual(['timidez×piadas', 'timidez×fofoca', 'apostas×economia', 'esporte×sonecas', 'calma×competicao']);
    for (const [a, b] of TRAIT_CLASHES) expect(TRAIT_IDS.includes(a) && TRAIT_IDS.includes(b)).toBe(true);
    expect(LOCALES).toBe(WORLD_LOCALES);
    expect([...WORLD_LOCALES]).toEqual(UI_LOCALES.map((l) => l.id));
    expect(GOODBYE_REASONS).toEqual(expect.arrayContaining(['waiting', 'unauthorized', 'banned', 'suspended', 'update', 'no_player']));
    expect(PLAYER_NAME_LIMITS).toEqual({ min: 3, max: 20 });
  });

  it('Fases 3 a 5: os ids dos avisos (o `text` do notice) e o `left` do ack, só acrescentados', () => {
    expect([...NOTICE_IDS]).toEqual([
      'ignored', 'invalid', 'rate_limited', 'view_required', 'not_found', 'street_left', 'chunk_full', 'afk', 'server_restart', 'left',
      // Fase 4 (a porta de um prédio): só no fim.
      'too_far', 'closed', 'blocked', 'full',
      // Fase 5 (social leve): só no fim.
      'daily_limit', 'already_done', 'reported', 'blocked_ok', 'stamped',
    ]);
    for (const id of NOTICE_IDS) expect(id).toMatch(/^[a-z]+(_[a-z]+)*$/);
    // Os códigos da Fase 2 continuam na mesma ordem; `left` (Fase 3) e `implausible` (Fase 6) entram no fim.
    expect([...UPLINK_ACK_ERRORS]).toEqual(['schema', 'limits', 'name_pool', 'parts', 'ids', 'rate', 'internal', 'left', 'implausible']);
  });

  it('Fase 5: 8 carimbos, 3 metas da cidade, os 6 motivos de denúncia e "bater na porta" desligado por padrão', () => {
    const unique = (l: readonly string[]) => new Set(l).size === l.length;
    expect([...STAMP_IDS]).toEqual(['visited', 'nice_building', 'keep_going', 'coffee', 'wave', 'star', 'heart', 'rocket']);
    expect([...CITY_GOAL_IDS]).toEqual(['agent_hours_10k', 'agent_hours_50k', 'agent_hours_100k']);
    expect([...REPORT_REASONS]).toEqual(['offensive_name', 'impersonation', 'harassment', 'greeting_spam', 'fake_building', 'other']);
    for (const l of [STAMP_IDS, CITY_GOAL_IDS]) expect(unique(l)).toBe(true);
    for (const id of [...STAMP_IDS, ...CITY_GOAL_IDS]) expect(id).toMatch(/^[a-z0-9]+(_[a-z0-9]+)*$/);
    expect(VISIBILITY_DEFAULTS.knocks).toBe(false);
  });

  it('Fase 6: `deleted` no goodbye, `maintenance` nos erros, `implausible` no ack, o aviso de inatividade e o selo "não verificado", só acrescentados', () => {
    expect([...GOODBYE_REASONS]).toEqual(['deploy', 'other-device', 'banned', 'suspended', 'waiting', 'update', 'unauthorized', 'no_player', 'deleted']);
    expect(WORLD_ERROR_CODES).toContain('maintenance');
    expect(UPLINK_ACK_ERRORS.at(-1)).toBe('implausible');
    // Opcionais: um corpo sem eles continua valendo, e o padrão da visibilidade não muda.
    const v: Visibility = { ...VISIBILITY_DEFAULTS };
    expect('notifyInactivity' in v).toBe(false);
    const b: Pick<WorldBuildingPublic, 'unverified'> & Pick<MeBuilding, 'unverified'> = {};
    expect(b.unverified).toBeUndefined();
    // O pedido de exclusão e o arquivo "Baixar meus dados" (WorldExport) também são do protocolo.
    const del: DeleteConfirmRequest = { code: '123456' };
    expect(del.code).toHaveLength(6);
    const exp: Pick<WorldExport, 'format' | 'version'> = { format: 'habblaud-world-export', version: 1 };
    expect(exp.version).toBe(1);
  });
});
