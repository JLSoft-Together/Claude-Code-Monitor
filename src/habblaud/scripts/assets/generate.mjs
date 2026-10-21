// Gerador de imagens via OpenRouter para os assets do Habblaud.
//
// Uso (a partir da raiz do projeto, com OPENROUTER_KEY exportada):
//   node scripts/assets/generate.mjs models                 lista os modelos com saída de imagem
//   node scripts/assets/generate.mjs list                   lista os assets de specs.json e o estado do cache
//   node scripts/assets/generate.mjs gen [ids...]           gera os assets ainda sem imagem bruta em cache
//        [--force]            regera mesmo com cache (a tomada anterior fica em .cache/takes/)
//        [--model <id>]       sobrescreve o modelo definido em specs.json
//        [--as <sufixo>]      grava como "<id>@<sufixo>" (comparações/tomadas extras sem trocar a escolhida)
//        [--concurrency <n>]  requisições simultâneas (padrão 3)
//        [--budget <n>]       limite total de requisições registradas no log (padrão 45)
//   node scripts/assets/generate.mjs pick <id> <sufixo>     escolhe a tomada "<id>@<sufixo>" como imagem bruta oficial
//
// As imagens brutas ficam em scripts/assets/.cache/raw/<id>.png; o pós-processamento
// (scripts/assets/postprocess.py) gera os arquivos finais em client/public/assets/.
// Cada requisição é registrada em scripts/assets/generation-log.json (modelo, prompt, arquivo, custo).
// A chave nunca é impressa nem gravada: só vai no header Authorization.
import { mkdir, readFile, writeFile, copyFile, access, open, rm } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const CACHE = join(HERE, '.cache');
const RAW = join(CACHE, 'raw');
const TAKES = join(CACHE, 'takes');
const SPECS = join(HERE, 'specs.json');
const LOG = join(HERE, 'generation-log.json');
// Trava contra execuções simultâneas (cada uma reescreveria o log da outra).
const LOCK = join(CACHE, 'generate.lock');
const API = 'https://openrouter.ai/api/v1';
const MAX_RETRIES = 2;
const TIMEOUT_MS = 240_000;

// Argumentos: primeiro o comando, depois ids posicionais e flags (--force, --model <id>...).
const VALUE_FLAGS = new Set(['model', 'as', 'concurrency', 'budget']);
const BOOL_FLAGS = new Set(['force']);

function parseArgs(argv) {
  const [command = 'help', ...rest] = argv;
  const flags = {};
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (BOOL_FLAGS.has(name)) flags[name] = true;
    else if (VALUE_FLAGS.has(name) && rest[i + 1] !== undefined) flags[name] = rest[++i];
    else throw new Error(`opção desconhecida ou sem valor: ${arg}`);
  }
  return { command, flags, positional };
}

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (err) {
  console.error(`erro: ${err.message}`);
  process.exit(2);
}
const { command, flags, positional } = args;
const flagValue = (name, fallback) => flags[name] ?? fallback;
const hasFlag = (name) => flags[name] === true;

const exists = (p) => access(p).then(() => true, () => false);
const rel = (p) => relative(ROOT, p);

async function loadSpecs() {
  return JSON.parse(await readFile(SPECS, 'utf8'));
}

async function loadLog() {
  let text;
  try {
    text = await readFile(LOG, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { budget: 45, entries: [] };
    throw err;
  }
  // JSON inválido aborta (nunca reinicia o log por engano)
  return JSON.parse(text);
}

/** Monta o prompt final: o pedido do asset seguido dos estilos compartilhados que ele referencia (specs.styles). */
function buildPrompt(specs, asset) {
  const styles = (asset.styles ?? []).map((key) => {
    const text = specs.styles[key];
    if (!text) throw new Error(`estilo desconhecido "${key}" em ${asset.id}`);
    return text;
  });
  return [asset.prompt, ...styles].join('\n\n');
}

function apiKey() {
  const key = process.env.OPENROUTER_KEY;
  if (!key) throw new Error('OPENROUTER_KEY não definida no ambiente.');
  return key;
}

async function listModels() {
  const res = await fetch(`${API}/models`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`GET /models -> HTTP ${res.status}`);
  const { data } = await res.json();
  const image = data.filter((m) => (m.architecture?.output_modalities ?? []).includes('image'));
  for (const m of image) {
    const created = new Date(m.created * 1000).toISOString().slice(0, 10);
    console.log(`${m.id.padEnd(48)} entrada: ${(m.architecture.input_modalities ?? []).join(',').padEnd(28)} criado: ${created}`);
  }
  console.log(`\n${image.length} modelos com saída de imagem (de ${data.length}).`);
}

/** Uma requisição de geração. Lança erro com mensagem curta (sem dados sensíveis) em caso de falha. */
async function requestImage(model, prompt, aspect) {
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    modalities: ['image', 'text'],
    usage: { include: true },
  };
  if (aspect) body.image_config = { aspect_ratio: aspect };
  const res = await fetch(`${API}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
      'X-Title': 'Habblaud assets',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${res.status}: resposta não-JSON`);
  }
  if (!res.ok || json.error) {
    const msg = json.error?.message ?? `HTTP ${res.status}`;
    throw new Error(String(msg).slice(0, 300));
  }
  const message = json.choices?.[0]?.message;
  const url = message?.images?.[0]?.image_url?.url;
  if (!url?.startsWith('data:image/')) {
    throw new Error(`sem imagem na resposta (texto: ${String(message?.content ?? '').slice(0, 120)})`);
  }
  const b64 = url.slice(url.indexOf(',') + 1);
  return {
    bytes: Buffer.from(b64, 'base64'),
    mime: url.slice(5, url.indexOf(';')),
    cost: json.usage?.cost,
    provider: json.provider,
  };
}

/** Executa tarefas com limite de concorrência. */
async function pool(items, limit, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await worker(queue.shift());
  });
  await Promise.all(runners);
}

async function generate() {
  const specs = await loadSpecs();
  const log = await loadLog();
  const budget = Number(flagValue('budget', log.budget ?? 45));
  const force = hasFlag('force');
  const modelOverride = flagValue('model', null);
  const suffix = flagValue('as', null);
  const concurrency = Number(flagValue('concurrency', 3));
  const wanted = positional;

  const assets = specs.assets.filter((a) => a.prompt && (wanted.length === 0 || wanted.includes(a.id)));
  const unknown = wanted.filter((id) => !specs.assets.some((a) => a.id === id));
  if (unknown.length) throw new Error(`ids desconhecidos: ${unknown.join(', ')}`);

  const todo = [];
  for (const asset of assets) {
    const key = suffix ? `${asset.id}@${suffix}` : asset.id;
    const out = join(RAW, `${key}.png`);
    if (!force && (await exists(out))) continue;
    todo.push({ asset, key, out });
  }
  if (!todo.length) {
    console.log('Nada a gerar (tudo em cache). Use --force para regerar.');
    return;
  }

  await mkdir(RAW, { recursive: true });
  await mkdir(TAKES, { recursive: true });
  const lock = await open(LOCK, 'wx').catch(() => {
    throw new Error(`outra geração em andamento (${rel(LOCK)}); use --concurrency em vez de processos paralelos.`);
  });
  try {
    await runJobs(specs, log, todo, { budget, modelOverride, concurrency });
  } finally {
    await lock.close();
    await rm(LOCK, { force: true });
  }
}

async function runJobs(specs, log, todo, { budget, modelOverride, concurrency }) {
  let used = log.entries.length;
  let saving = Promise.resolve();
  const persist = () => {
    saving = saving.then(() => writeFile(LOG, `${JSON.stringify({ ...log, budget }, null, 2)}\n`));
    return saving;
  };

  await pool(todo, concurrency, async ({ asset, key, out }) => {
    const model = modelOverride ?? asset.model ?? specs.defaultModel;
    const prompt = buildPrompt(specs, asset);
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (used >= budget) {
        console.error(`[${key}] orçamento esgotado (${used}/${budget} requisições).`);
        return;
      }
      used++;
      const started = Date.now();
      const entry = {
        n: log.entries.length + 1,
        at: new Date().toISOString(),
        id: key,
        model,
        aspect: asset.aspect ?? null,
        prompt,
      };
      log.entries.push(entry);
      try {
        const img = await requestImage(model, prompt, asset.aspect);
        const stamp = entry.at.replace(/[:.]/g, '-');
        const take = join(TAKES, `${key}--${stamp}.png`);
        await writeFile(take, img.bytes);
        await copyFile(take, out);
        Object.assign(entry, {
          status: 'ok',
          file: rel(out),
          take: rel(take),
          mime: img.mime,
          provider: img.provider ?? null,
          cost: img.cost ?? null,
          ms: Date.now() - started,
        });
        console.log(`[${key}] ok em ${((Date.now() - started) / 1000).toFixed(1)}s (${model}) -> ${rel(out)}`);
        await persist();
        return;
      } catch (err) {
        Object.assign(entry, { status: 'error', error: String(err.message ?? err), ms: Date.now() - started });
        console.error(`[${key}] tentativa ${attempt + 1} falhou: ${entry.error}`);
        await persist();
      }
    }
  });
  await saving;
  const spent = log.entries.reduce((s, e) => s + (typeof e.cost === 'number' ? e.cost : 0), 0);
  console.log(`\nRequisições registradas: ${log.entries.length}/${budget}. Custo acumulado informado: US$ ${spent.toFixed(4)}.`);
}

/** Copia raw/<id>@<sufixo>.png para raw/<id>.png e registra a escolha em log.picks. */
async function pick() {
  const [id, suffix] = positional;
  if (!id || !suffix) throw new Error('uso: pick <id> <sufixo>');
  const specs = await loadSpecs();
  if (!specs.assets.some((a) => a.id === id)) throw new Error(`id desconhecido: ${id}`);
  const from = join(RAW, `${id}@${suffix}.png`);
  if (!(await exists(from))) throw new Error(`tomada inexistente: ${rel(from)}`);
  await copyFile(from, join(RAW, `${id}.png`));
  const log = await loadLog();
  const take = log.entries.findLast((e) => e.id === `${id}@${suffix}` && e.status === 'ok');
  log.picks = { ...log.picks, [id]: { take: `${id}@${suffix}`, model: take?.model ?? null, entry: take?.n ?? null } };
  await writeFile(LOG, `${JSON.stringify(log, null, 2)}\n`);
  console.log(`[${id}] tomada escolhida: ${id}@${suffix} (${take?.model ?? 'modelo desconhecido'})`);
}

async function list() {
  const specs = await loadSpecs();
  for (const a of specs.assets) {
    const cached = a.prompt ? ((await exists(join(RAW, `${a.id}.png`))) ? 'em cache' : 'pendente') : 'sem IA';
    console.log(`${a.id.padEnd(26)} ${cached.padEnd(9)} ${a.model ?? specs.defaultModel}`);
  }
}

const commands = { models: listModels, gen: generate, list, pick };
const run = commands[command];
if (!run) {
  console.log('Comandos: models | list | gen [ids...] [--force] [--model id] [--as sufixo] [--concurrency n] [--budget n] | pick <id> <sufixo>');
  process.exit(command === 'help' ? 0 : 2);
}
run().catch((err) => {
  console.error(`erro: ${err.message ?? err}`);
  process.exit(1);
});
