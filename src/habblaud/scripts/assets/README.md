# Assets do Habblaud (imagens com IA + pixel art)

Marca, ilustrações da UI e arte de parede do Habblaud. Os modelos de imagem da OpenRouter desenham
as imagens, que o pós-processamento em Python transforma em pixel art de verdade: grade nítida,
paleta limitada, sem dithering, alfa binário e ampliações só com NEAREST. Personagens e móveis
**não** estão aqui: são procedurais (`client/src/art`).

```
scripts/assets/
  specs.json            receita de cada asset: modelo, proporção, prompt, estilos e parâmetros de pós-processamento
  generate.mjs          chama a OpenRouter (Node 24, sem dependências), com cache, retries, orçamento e log
  postprocess.py        CLI: processa as imagens brutas e compõe marca, ícones, molduras, og-image e manifest
  pixelops.py           operações de imagem (chroma key, detecção de grade, redução por moda, paleta...)
  pixelart.py           pixel art desenhada à mão: mark 32/16 px, fonte bitmap e placa "Habblaud"
  test_pixelops.py      testes (unittest da stdlib)
  generation-log.json   todas as requisições: modelo, prompt exato, arquivo, custo e tomadas escolhidas
  .cache/               (ignorado) raw/ = imagem bruta em uso, takes/ = todas as tomadas, contact-sheet.png
client/public/assets/   saída final, servida pelo Vite em /assets/ (manifest.json descreve tudo)
```

## Uso

Requisitos: Node 24, a variável `OPENROUTER_KEY` exportada (só para gerar) e Python 3 com Pillow e
numpy (no macOS desta máquina, o `/usr/bin/python3` já tem os dois no site-packages do usuário).

```sh
node scripts/assets/generate.mjs models            # modelos com saída de imagem
node scripts/assets/generate.mjs list              # assets e estado do cache
node scripts/assets/generate.mjs gen               # gera o que falta em .cache/raw/
node scripts/assets/generate.mjs gen poster-cat --force                          # nova tomada
node scripts/assets/generate.mjs gen logo-mark --model openai/gpt-5.4-image-2 --as gpt   # tomada alternativa
node scripts/assets/generate.mjs pick logo-mark gpt                              # adota a tomada alternativa
python3 -E scripts/assets/postprocess.py           # gera client/public/assets/** + manifest + folha de contato
python3 -E scripts/assets/postprocess.py --only painting-cat --out /tmp/teste    # testa um asset isolado
python3 -E scripts/assets/test_pixelops.py         # testes (grade/desampliação, chroma key, moda, fonte, marks)
```

- `gen` usa até 2 retries por asset, roda com `--concurrency` (padrão 3) e recusa passar do
  orçamento (`--budget`, padrão 45 requisições no log). Uma trava (`.cache/generate.lock`) impede
  duas execuções simultâneas, porque uma reescreveria o log da outra.
- O pós-processamento é determinístico: rode-o quantas vezes quiser, sem custo.
- A chave só vai no header `Authorization`: nunca é impressa, registrada nem gravada.
- `python3 -E` (e não `-I`): o `-I` desliga o site-packages do usuário, onde estão Pillow e numpy.
  O `-E` continua ignorando `PYTHONPATH`. Os scripts ficam em `scripts/assets/` e os dados baixados
  em `.cache/` (outra pasta), então o `sys.path` só contém código nosso.
- QA: abra `scripts/assets/.cache/contact-sheet.png` (marca e arte de parede em 4x, ilustração e og-image).

## Direção de arte (prompts originais)

Os prompts descrevem o estilo com palavras genéricas, sem citar jogos, tilesets, artistas ou marcas:
escritório moderno, claro e aconchegante, cinzas neutros frios, porcelanato claro, madeira cor de mel,
vidro azulado, monitores azuis acesos, sofás azuis com almofadas laranja, vasos de terracota e pastas
coloridas, contorno azul-acinzentado escuro (`#2b3245`) e luz vinda de cima à esquerda. O estilo
compartilhado `pixel` (em `specs.json`) ainda pede arte original, sem copiar nem imitar obra existente.

As primeiras tomadas do logo e da ilustração usavam uma versão anterior desse estilo, que citava obras
comerciais de terceiros como referência. Elas foram descartadas e saíram do log; o logo, os marks
desenhados à mão a partir dele, os ícones, o og-image e a ilustração foram refeitos com os prompts
atuais. Pinturas e pôsteres nunca usaram essa referência (o estilo deles é `wallart`/`poster`).

## Escolha do modelo

Lista de 06/10/2026: 11 modelos com `image` em `output_modalities`. Comparei três modelos fortes com o
mesmo prompt (pintura "montanhas") e, no logo, o Flash e o Pro com o mesmo prompt, julgando o
resultado **depois** da redução ao tamanho nativo, que é o que aparece no jogo:

| Modelo | Bruto | Reduzido | Tempo | Custo/img |
|---|---|---|---|---|
| `google/gemini-3.1-flash-image` | formas chapadas e ousadas, magenta limpo; "pixels" de tamanho irregular | **o mais legível em 26x16 e 12x16** | ~10 s | ~US$ 0,07 |
| `google/gemini-3-pro-image` | pixel art rica e coerente, grade mais regular | o melhor no logo nativo e em cenas | ~25–35 s | ~US$ 0,14 |
| `openai/gpt-5.4-image-2` | o mais detalhado | detalhe demais: vira ruído | 75–120 s | maior |

Decisão:
- **Gemini 3.1 Flash Image** (padrão): pinturas e pôsteres. Formas grandes e chapadas sobrevivem a
  26x16 e 12x16; é rápido e barato, o que deixou orçamento para refazer o que ficou fraco.
- **Gemini 3 Pro Image**: logo e ilustração do escritório vazio. No logo, as tomadas do Flash tinham
  "pixels" fora da grade (a desampliação deixava ruído nas janelas); a do Pro sai limpa. Na
  ilustração, ele reproduz os elementos do próprio jogo: porcelanato claro, mesas brancas com
  monitores azuis, sofá azul com almofadas laranja, bebedouro, terracota e pastas coloridas. Com isso,
  fica coerente com o mundo.

## Pipeline de pós-processamento

1. **Chroma key**: a cor de fundo é a mediana da moldura da imagem (a IA nem sempre acerta o
   `#FF00FF`), mais qualquer tom claramente magenta (franja). Ilhas pequenas são removidas.
2. **Desampliação** (`kind: native`): a IA desenha numa grade de "pixels grandes" (~10 px por pixel
   numa imagem de 1024). Um detector de periodicidade (pente sobre as bordas de cor, nos dois eixos,
   preferindo o menor divisor do melhor período) encontra a grade, e cada bloco vira um pixel (moda do
   miolo). O resultado é a pixel art nativa da IA, sem perdas. É assim que nasce `logo-detailed.png` (78x86).
3. **Redução por moda** (`art`, `poster`, `scene`): corte na proporção e redução em que cada célula
   recebe a cor mais frequente de uma paleta intermediária, sem misturar cores. Isso dá bordas
   nítidas, ao contrário da média. `darkBias` favorece tons escuros (contornos) ou, se negativo,
   claros (janelas acesas).
4. **Paleta**: median cut + k-means, **sem dithering**. A opção `balance` reamostra por 1/frequência^b,
   para cores de área pequena (o verde das plantas) não sumirem. Com ela, a cena coube em 32 cores.
   No logo, `merge` funde tons quase iguais (distância RGB menor que o valor) que o k-means às vezes
   cria numa mesma área chapada; sobra um tom por material (24 cores).
5. **Acabamento**: `despeckle` remove pixels isolados; contorno de 1px `#2b3245` nos pôsteres;
   molduras de 3px (madeira, preta, branca, dourada) com luz em cima e à esquerda nas pinturas.

### O que foi desenhado à mão (e por quê)

- **Mark 32x32 e favicon 16x16** (`pixelart.py`). A arte nativa da IA tem 78x86 px, e reduzi-la para 32
  ou 16 sempre embaralha janelas e faixas. Então o mark pequeno é um "hinting" do desenho da IA:
  mesmo prédio (laje com borda clara, vaso à direita, faixas de madeira, duas telas azuis no 2º andar,
  porta de vidro com toldo), mesma paleta amostrada, redesenhado pixel a pixel. A versão da IA aparece onde há
  espaço (`logo-detailed.png`, `icon-512.png`, og-image).
- **Placa e textos do og-image**: texto de IA reduzido fica ilegível, e a Pixelify Sans em tamanhos
  de pixel fecha a abertura do "C" ("Oode Town"). Por isso há uma fonte bitmap proporcional 5x7
  própria, com minúsculas, descendentes e acentos do português (á à â ã é ê í ó ô õ ú ç).

## Entregáveis (`client/public/assets/`)

| Arquivo | Tamanho | Observação |
|---|---|---|
| `brand/logo-mark.png` / `@4x` | 32x32 / 128x128 | transparente, desenhado à mão a partir da IA |
| `brand/logo-detailed.png` | 78x86 | arte nativa da IA (transparente) |
| `brand/favicon-16.png`, `favicon-32.png` | 16, 32 | transparentes |
| `brand/apple-touch-icon.png`, `icon-192.png`, `icon-512.png` | 180, 192, 512 | céu de entardecer em faixas + calçada; 512 usa o prédio detalhado |
| `brand/signage.png` / `@4x` | 64x16 / 256x64 | placa da recepção |
| `illustrations/empty-office.png` | 960x540 | 480x270 nativo, x2 NEAREST, 32 cores |
| `art/painting-*.png` (8) | 26x16 | só a tela (sem moldura), para `rects.art` do sprite `painting` |
| `art/painting-wide-*.png` (3) | 58x24 | lounge |
| `art/framed/painting-*.png` | 32x22 e 64x30 | mesma arte com moldura de 3px, ocupando exatamente 2 ou 4 tiles |
| `art/poster-*.png` (6) | 12x16 | com contorno; ids batem com as variants do móvel `poster` |
| `og-image.png` | 1200x630 | 600x315 nativo x2 |

### manifest.json

```jsonc
{
  "version": 1,
  "brand": {
    "mark": { "file": "brand/logo-mark.png", "w": 32, "h": 32 },
    "markLarge": { "file": "brand/logo-mark@4x.png", "w": 128, "h": 128 },
    "markDetailed": { "file": "brand/logo-detailed.png", "w": 78, "h": 86 },   // extra
    "signage": { "file": "brand/signage.png", "w": 64, "h": 16 },
    "signageLarge": { "file": "brand/signage@4x.png", "w": 256, "h": 64 },    // extra
    "favicon16": "brand/favicon-16.png", "favicon32": "brand/favicon-32.png",
    "appleTouch": "brand/apple-touch-icon.png", "icon192": "brand/icon-192.png", "icon512": "brand/icon-512.png"
  },
  "illustrations": { "emptyOffice": { "file": "illustrations/empty-office.png", "w": 960, "h": 540, "scale": 2 } },
  "wallArt": [
    { "id": "painting-mountains", "kind": "painting", "file": "art/painting-mountains.png", "w": 26, "h": 16,
      "tiles": 2, "title": "Montanhas ao amanhecer", "framed": { "file": "art/framed/painting-mountains.png", "w": 32, "h": 22 } },
    { "id": "poster-coffee", "kind": "poster", "variant": "coffee", "file": "art/poster-coffee.png", "w": 12, "h": 16, "tiles": 1, "title": "Café" }
  ],
  "og": "og-image.png"
}
```

Caminhos relativos a `/assets/`. `w`/`h` são do arquivo. `tiles` é a largura do vão na parede em
tiles (pôster 1, pintura 2, pintura larga 4), útil para escolher a arte certa para cada moldura. Na ilustração, `scale` indica a ampliação
NEAREST já aplicada (nativo = w/scale). `variant` dos pôsteres é o valor da variant do móvel `poster`
em `client/src/art/api.ts` (`ship_it` incluso).

## Orçamento e log

32 requisições de 45 no log (25 Flash, 6 Pro, 1 GPT 5.4), nenhuma falha, ~US$ 2,58 informados pela
API. O log não inclui as 10 tomadas descartadas do logo e da ilustração (ver "Direção de arte"); os
números `n` foram renumerados em sequência. O detalhe está em `generation-log.json`. `picks` registra
as tomadas adotadas a partir de comparações (`logo-mark@v2e`, `empty-office@v2a`,
`painting-mountains@gemini31flash`). A entrada da tomada Flash de `painting-mountains` foi
reconstruída (sem custo informado), porque duas execuções paralelas sobrescreveram o log; foi isso
que motivou a trava. `specs.json` é a receita atual; o log guarda o prompt exato de cada tomada (as
pinturas geradas antes do reforço de "sangria total" no estilo `wallart` usaram a versão anterior
desse texto, e as tomadas `logo-mark@v2a` a `@v2c` usaram versões anteriores do prompt do logo).
