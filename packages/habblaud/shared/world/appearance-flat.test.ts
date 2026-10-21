// appearanceFromSeed saiu de client/src/art/character/appearance.ts para shared/world/appearance-flat.ts: estas são as
// saídas do módulo antigo (gravadas antes da mudança) para 20 sementes, sem look, com look 'f', com look 'm' de
// subagente e com peças do editor por cima. Qualquer diferença muda a aparência de todos os personagens.
import { describe, expect, it } from 'vitest';
import { PART_KEYS, parseAppearanceParts } from '../appearance';
import { hash32 } from '../hash';
import { appearanceFromSeed, flattenAppearance, type SeedAppearance } from './appearance-flat';

const SIG_KEYS = [
  'skin', 'hair', 'hairStyle', 'eyes', 'top', 'topAccent', 'topStyle', 'bottom', 'bottomStyle', 'shoes', 'accessory',
  'accessoryColor', 'facialHair', 'lanyard', 'look',
] as const;
const sig = (a: SeedAppearance) => SIG_KEYS.map((k) => String(a[k] ?? '-')).join('|');

/** [semente, sem opções, look 'f', look 'm' + sub, look 'f' + peças] — saída do módulo antigo. */
const GOLDEN: Array<[number, string, string, string, string]> = [
  [0, "#eab894|#3f2c22|buzz|#5a3b22|#4a6a8a|#e8e3d6|jacket|#5f6845|pants|#6b4630|none|#2b2b33|mustache|-|m", "#eab894|#3f2c22|curly|#5a3b22|#f2d16b|#f1efe9|blouse|#2c2c35|skirt|#3f63a8|glasses|#2b2b33|none|-|f", "#eab894|#3f2c22|buzz|#5a3b22|#4a6a8a|#e8e3d6|jacket|#5f6845|pants|#6b4630|none|#2b2b33|mustache|#f2b33d|m", "#eab894|#3f2c22|bob|#5a3b22|#4a86d8|#f1efe9|blouse|#2c2c35|skirt|#3f63a8|cap|#2b2b33|none|-|f"],
  [1, "#5a3623|#3f2c22|wavy|#2b2236|#dfe3e8|#c0392b|shirt_tie|#3f5f8c|pants|#2b2b33|cap|#4bab72|none|-|m", "#5a3623|#3f2c22|wavy|#2b2236|#c9713f|#4bab72|sweater|#3f5f8c|skirt|#2b2b33|earrings|#f2c14e|none|-|f", "#5a3623|#3f2c22|wavy|#2b2236|#dfe3e8|#c0392b|shirt_tie|#3f5f8c|pants|#2b2b33|cap|#4bab72|none|#4bab72|m", "#5a3623|#3f2c22|bob|#2b2236|#4a86d8|#4bab72|sweater|#3f5f8c|skirt|#2b2b33|cap|#f2c14e|none|-|f"],
  [2, "#eab894|#2b2530|bun|#4a2f22|#e47aa8|#2f4c7d|polo|#2e3e5e|pants|#b88752|headphones|#efb54a|none|-|m", "#eab894|#2b2530|pigtails|#4a2f22|#e47aa8|#e3d3b2|blouse|#b49c72|pants|#2b2b33|earrings|#d9dde3|none|-|f", "#eab894|#2b2530|bun|#4a2f22|#e47aa8|#2f4c7d|polo|#2e3e5e|pants|#b88752|headphones|#efb54a|none|#4bab72|m", "#eab894|#2b2530|bob|#4a2f22|#4a86d8|#e3d3b2|blouse|#b49c72|pants|#2b2b33|cap|#d9dde3|none|-|f"],
  [7, "#bd8560|#3f2c22|long|#2f5f9e|#e9f1dc|#5b3a8c|shirt_tie|#3f5f8c|skirt|#ececec|headphones|#e2604f|none|-|f", "#bd8560|#3f2c22|long|#2f5f9e|#e9f1dc|#5b3a8c|shirt_tie|#3f5f8c|skirt|#ececec|headphones|#e2604f|none|-|f", "#bd8560|#3f2c22|curly|#2f5f9e|#76913f|#e2604f|hoodie|#b49c72|pants|#ececec|none|#2b2b33|stubble|#4bab72|m", "#bd8560|#3f2c22|bob|#2f5f9e|#4a86d8|#5b3a8c|shirt_tie|#3f5f8c|skirt|#ececec|cap|#e2604f|none|-|f"],
  [42, "#bd8560|#87593a|bun|#4a2f22|#f29b72|#3d4352|sweater|#b49c72|skirt|#d04848|bow|#e2604f|none|-|f", "#bd8560|#87593a|bun|#4a2f22|#f29b72|#3d4352|sweater|#b49c72|skirt|#d04848|bow|#e2604f|none|-|f", "#bd8560|#87593a|bun|#4a2f22|#e9f1dc|#7b2d44|shirt_tie|#b49c72|pants|#d04848|earrings|#f2c14e|none|#4a86d8|m", "#bd8560|#87593a|bob|#4a2f22|#4a86d8|#3d4352|sweater|#b49c72|skirt|#d04848|cap|#e2604f|none|-|f"],
  [255, "#9a6444|#5f3c28|bob|#2b2236|#f1efe9|#3d4352|sweater|#2c2c35|pants|#ececec|none|#2b2b33|none|-|f", "#9a6444|#5f3c28|bob|#2b2236|#f1efe9|#3d4352|sweater|#2c2c35|pants|#ececec|none|#2b2b33|none|-|f", "#9a6444|#5f3c28|side_part|#2b2236|#f3d6de|#2e7d4f|shirt_tie|#2c2c35|pants|#ececec|none|#2b2b33|goatee|#36b0b0|m", "#9a6444|#5f3c28|bob|#2b2236|#4a86d8|#3d4352|sweater|#2c2c35|pants|#ececec|cap|#2b2b33|none|-|f"],
  [1000, "#ffe2cc|#2b2530|long|#2f5f9e|#8d66cf|#76913f|blouse|#6e4c38|pants|#ececec|sunglasses|#22232b|none|-|f", "#ffe2cc|#2b2530|long|#2f5f9e|#8d66cf|#76913f|blouse|#6e4c38|pants|#ececec|sunglasses|#22232b|none|-|f", "#ffe2cc|#2b2530|curly|#2f5f9e|#6b4a35|#f6e7c8|jacket|#6d7480|pants|#ececec|glasses|#8a8f99|none|#36b0b0|m", "#ffe2cc|#2b2530|bob|#2f5f9e|#4a86d8|#76913f|blouse|#6e4c38|pants|#ececec|cap|#22232b|none|-|f"],
  [4242, "#5a3623|#5f3c28|ponytail|#4a2f22|#76913f|#e47aa8|blouse|#2e3e5e|skirt|#3f63a8|headphones|#36b0b0|none|-|f", "#5a3623|#5f3c28|ponytail|#4a2f22|#76913f|#e47aa8|blouse|#2e3e5e|skirt|#3f63a8|headphones|#36b0b0|none|-|f", "#5a3623|#5f3c28|afro|#4a2f22|#76913f|#e47aa8|blouse|#2e3e5e|pants|#3f63a8|glasses|#8a8f99|stubble|#e2604f|m", "#5a3623|#5f3c28|bob|#4a2f22|#4a86d8|#e47aa8|blouse|#2e3e5e|skirt|#3f63a8|cap|#36b0b0|none|-|f"],
  [65535, "#d69f78|#2b2530|pigtails|#2f5f9e|#262a33|#f4f4f0|jacket|#9b3b3b|pants|#ececec|none|#2b2b33|none|-|f", "#d69f78|#2b2530|pigtails|#2f5f9e|#262a33|#f4f4f0|jacket|#9b3b3b|pants|#ececec|none|#2b2b33|none|-|f", "#d69f78|#2b2530|mohawk|#2f5f9e|#8a96a3|#4a86d8|sweater|#3f5f8c|pants|#7d8592|sunglasses|#22232b|none|#8d66cf|m", "#d69f78|#2b2530|bob|#2f5f9e|#4a86d8|#f4f4f0|jacket|#9b3b3b|pants|#ececec|cap|#2b2b33|none|-|f"],
  [99991, "#f6cfb0|#3f2c22|long|#3c7a52|#5bc0de|#f2d16b|sweater|#6d7480|shorts|#2b2b33|none|#2b2b33|none|-|f", "#f6cfb0|#3f2c22|long|#3c7a52|#5bc0de|#f2d16b|sweater|#6d7480|shorts|#2b2b33|none|#2b2b33|none|-|f", "#f6cfb0|#3f2c22|curly|#3c7a52|#5bc0de|#f2d16b|sweater|#6d7480|pants|#2b2b33|none|#2b2b33|none|#36b0b0|m", "#f6cfb0|#3f2c22|bob|#3c7a52|#4a86d8|#f2d16b|sweater|#6d7480|shorts|#2b2b33|cap|#2b2b33|none|-|f"],
  [123456, "#5a3623|#2b2530|afro|#4a2f22|#5bc0de|#f29b72|blouse|#2c3655|skirt|#2b2b33|none|#2b2b33|none|-|f", "#5a3623|#2b2530|afro|#4a2f22|#5bc0de|#f29b72|blouse|#2c3655|skirt|#2b2b33|none|#2b2b33|none|-|f", "#5a3623|#2b2530|spiky|#4a2f22|#5bc0de|#f29b72|polo|#3f5f8c|pants|#2b2b33|none|#2b2b33|goatee|#f2b33d|m", "#5a3623|#2b2530|bob|#4a2f22|#4a86d8|#f29b72|blouse|#2c3655|skirt|#2b2b33|cap|#2b2b33|none|-|f"],
  [777777, "#ffe2cc|#5f3c28|buzz|#2b2236|#b04a5a|#f1efe9|sweater|#2e3e5e|pants|#6b4630|none|#2b2b33|none|-|m", "#ffe2cc|#5f3c28|curly|#2b2236|#4a6a8a|#e8e3d6|jacket|#2c2c35|pants|#6b4630|glasses|#8a8f99|none|-|f", "#ffe2cc|#5f3c28|buzz|#2b2236|#b04a5a|#f1efe9|sweater|#2e3e5e|pants|#6b4630|none|#2b2b33|none|#36b0b0|m", "#ffe2cc|#5f3c28|bob|#2b2236|#4a86d8|#e8e3d6|jacket|#2c2c35|pants|#6b4630|cap|#8a8f99|none|-|f"],
  [1000000, "#d69f78|#8e3b2b|curly|#2f5f9e|#f1efe9|#e2604f|sweater|#2e3e5e|pants|#ececec|none|#2b2b33|none|-|f", "#d69f78|#8e3b2b|curly|#2f5f9e|#f1efe9|#e2604f|sweater|#2e3e5e|pants|#ececec|none|#2b2b33|none|-|f", "#d69f78|#8e3b2b|buzz|#2f5f9e|#f3d6de|#c0392b|shirt_tie|#2e3e5e|pants|#ececec|none|#2b2b33|none|#8d66cf|m", "#d69f78|#8e3b2b|bob|#2f5f9e|#4a86d8|#e2604f|sweater|#2e3e5e|pants|#ececec|cap|#2b2b33|none|-|f"],
  [16777216, "#eab894|#3f2c22|curly|#2b2236|#55613b|#f2d16b|jacket|#3f5f8c|shorts|#6b4630|headphones|#4a86d8|beard|-|m", "#eab894|#3f2c22|long|#2b2236|#3d4352|#f2d16b|blouse|#e2ded5|skirt|#2b2b33|glasses|#b03a3a|none|-|f", "#eab894|#3f2c22|curly|#2b2236|#55613b|#f2d16b|jacket|#3f5f8c|shorts|#6b4630|headphones|#4a86d8|beard|#8d66cf|m", "#eab894|#3f2c22|bob|#2b2236|#4a86d8|#f2d16b|blouse|#e2ded5|skirt|#2b2b33|cap|#b03a3a|none|-|f"],
  [2654435769, "#ffe2cc|#2b2530|long|#5a3b22|#b08a5e|#dfe7ef|jacket|#2e3e5e|skirt|#2b2b33|earrings|#f2c14e|none|-|f", "#ffe2cc|#2b2530|long|#5a3b22|#b08a5e|#dfe7ef|jacket|#2e3e5e|skirt|#2b2b33|earrings|#f2c14e|none|-|f", "#ffe2cc|#2b2530|side_part|#5a3b22|#c9713f|#f1efe9|sweater|#b49c72|pants|#2b2b33|none|#2b2b33|stubble|#4a86d8|m", "#ffe2cc|#2b2530|bob|#5a3b22|#4a86d8|#dfe7ef|jacket|#2e3e5e|skirt|#2b2b33|cap|#f2c14e|none|-|f"],
  [3735928559, "#bd8560|#d6ae68|bald|#4a2f22|#f2d16b|#5bc0de|polo|#2c3655|pants|#2b2b33|none|#2b2b33|stubble|-|m", "#bd8560|#d6ae68|wavy|#4a2f22|#f2d16b|#e3d3b2|blouse|#2c3655|shorts|#b88752|none|#2b2b33|none|-|f", "#bd8560|#d6ae68|bald|#4a2f22|#f2d16b|#5bc0de|polo|#2c3655|pants|#2b2b33|none|#2b2b33|stubble|#4a86d8|m", "#bd8560|#d6ae68|bob|#4a2f22|#4a86d8|#e3d3b2|blouse|#2c3655|shorts|#b88752|cap|#2b2b33|none|-|f"],
  [2147483648, "#d69f78|#2b2530|long|#5a3b22|#e3d3b2|#2f4c7d|sweater|#3f5f8c|pants|#6b4630|bow|#efb54a|none|-|f", "#d69f78|#2b2530|long|#5a3b22|#e3d3b2|#2f4c7d|sweater|#3f5f8c|pants|#6b4630|bow|#efb54a|none|-|f", "#d69f78|#2b2530|side_part|#5a3b22|#e9f1dc|#d9a42e|shirt_tie|#3f5f8c|pants|#6b4630|beanie|#4bab72|none|#36b0b0|m", "#d69f78|#2b2530|bob|#5a3b22|#4a86d8|#2f4c7d|sweater|#3f5f8c|pants|#6b4630|cap|#efb54a|none|-|f"],
  [3141592653, "#9a6444|#3f2c22|buzz|#2b2236|#3d4352|#c9713f|polo|#2e3e5e|pants|#ececec|none|#2b2b33|none|-|m", "#9a6444|#3f2c22|curly|#2b2236|#3d4352|#f29b72|blouse|#6d7480|pants|#2b2b33|glasses|#3f63a8|none|-|f", "#9a6444|#3f2c22|buzz|#2b2236|#3d4352|#c9713f|polo|#2e3e5e|pants|#ececec|none|#2b2b33|none|#f2b33d|m", "#9a6444|#3f2c22|bob|#2b2236|#4a86d8|#f29b72|blouse|#6d7480|pants|#2b2b33|cap|#3f63a8|none|-|f"],
  [4294967295, "#7a4a31|#2b2530|side_part|#4a2f22|#8d66cf|#f6e7c8|hoodie|#2c2c35|shorts|#d04848|none|#2b2b33|goatee|-|m", "#7a4a31|#2b2530|long|#4a2f22|#8d66cf|#4bab72|sweater|#6e4c38|skirt|#6b4630|cap|#2b2b33|none|-|f", "#7a4a31|#2b2530|side_part|#4a2f22|#8d66cf|#f6e7c8|hoodie|#2c2c35|shorts|#d04848|none|#2b2b33|goatee|#4a86d8|m", "#7a4a31|#2b2530|bob|#4a2f22|#4a86d8|#4bab72|sweater|#6e4c38|skirt|#6b4630|cap|#2b2b33|none|-|f"],
  [2718281828, "#bd8560|#3f2c22|short|#2b2236|#2f4c7d|#4a86d8|blouse|#2e3e5e|pants|#2b2b33|none|#2b2b33|none|-|f", "#bd8560|#3f2c22|short|#2b2236|#2f4c7d|#4a86d8|blouse|#2e3e5e|pants|#2b2b33|none|#2b2b33|none|-|f", "#bd8560|#3f2c22|short|#2b2236|#262a33|#e8e3d6|jacket|#2e3e5e|pants|#2b2b33|none|#2b2b33|none|#36b0b0|m", "#bd8560|#3f2c22|bob|#2b2236|#4a86d8|#4a86d8|blouse|#2e3e5e|pants|#2b2b33|cap|#2b2b33|none|-|f"],
];

describe('appearanceFromSeed (movida para shared/world)', () => {
  it('as mesmas aparências do módulo antigo em 20 sementes', () => {
    expect(GOLDEN).toHaveLength(20);
    for (const [seed, plain, f, mSub, parts] of GOLDEN) {
      expect(sig(appearanceFromSeed(seed)), `semente ${seed}`).toBe(plain);
      expect(sig(appearanceFromSeed(seed, { look: 'f' })), `semente ${seed} f`).toBe(f);
      expect(sig(appearanceFromSeed(seed, { look: 'm', sub: true })), `semente ${seed} m sub`).toBe(mSub);
      expect(sig(appearanceFromSeed(seed, { look: 'f', parts: { hairStyle: 'bob', top: '#4a86d8', accessory: 'cap' } })), `semente ${seed} peças`).toBe(parts);
    }
  });
});

describe('flattenAppearance', () => {
  it('só as 13 peças de PART_KEYS, nessa ordem, sem lanyard, look nem semente', () => {
    for (const seed of [0, 1, 99, hash32('a_3f9d2c7e'), 4294967295]) {
      const flat = flattenAppearance(seed);
      expect(Object.keys(flat)).toEqual([...PART_KEYS]);
      expect(parseAppearanceParts(flat)).toEqual(flat);
      expect(JSON.stringify(flat)).not.toMatch(/lanyard|look|seed/);
    }
  });

  it('é o sorteio da semente com o look pedido, e as peças do editor vão por cima', () => {
    const seed = hash32('a_71c0b5a9');
    const a = appearanceFromSeed(seed, { look: 'm' });
    const flat = flattenAppearance(seed, undefined, 'm');
    for (const k of PART_KEYS) expect(flat[k]).toBe(a[k]);
    const edited = flattenAppearance(seed, { hair: '#e47aa8', hairStyle: 'afro' }, 'm');
    expect(edited.hair).toBe('#e47aa8');
    expect(edited.hairStyle).toBe('afro');
    expect(edited.skin).toBe(a.skin);
    // Um undefined explícito não apaga a peça sorteada.
    expect(flattenAppearance(seed, { skin: undefined }, 'm').skin).toBe(a.skin);
  });

  it('look feminino nunca leva barba', () => {
    for (let i = 0; i < 200; i++) expect(flattenAppearance(hash32(`a_${i}`), undefined, 'f').facialHair).toBe('none');
  });
});
