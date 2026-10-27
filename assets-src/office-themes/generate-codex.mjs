#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const usage = `usage: node assets-src/office-themes/generate-codex.mjs <pack-id> [list|gen] [asset-id ...] [--force] [--concurrency N] [--budget N]`;
const packId = args[0];
if (!packId || !/^[a-z0-9-]{3,24}$/.test(packId)) {
  console.error(usage);
  process.exit(2);
}
const cmd = args[1] && !args[1].startsWith('--') ? args[1] : 'list';
const flags = new Set(args.filter((a) => a.startsWith('--')));
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : def;
};
const only = args.slice(2).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && all[i - 1].startsWith('--') && /^\d+$/.test(a)));
const force = flags.has('--force');
const concurrency = opt('--concurrency', 3);
const budget = opt('--budget', 40);

const packDir = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), packId);
const specsPath = path.join(packDir, 'specs.json');
const logPath = path.join(packDir, 'generation-log.json');
const rawDir = path.join(packDir, '.cache', 'raw');
const takesDir = path.join(packDir, '.cache', 'takes');
const imagesRoot = path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'generated_images');

if (!fs.existsSync(specsPath)) {
  console.error(`missing ${specsPath}`);
  process.exit(2);
}
const specs = JSON.parse(fs.readFileSync(specsPath, 'utf8'));
const log = fs.existsSync(logPath) ? JSON.parse(fs.readFileSync(logPath, 'utf8')) : { requests: [] };
fs.mkdirSync(rawDir, { recursive: true });
fs.mkdirSync(takesDir, { recursive: true });

const assets = specs.assets.filter((a) => a.id !== 'logo-mark');
const fullPrompt = (a) => [a.prompt, ...(a.styles ?? []).map((s) => specs.styles[s])].filter(Boolean).join('\n\n');
const rawFile = (id) => path.join(rawDir, `${id}.png`);

if (cmd === 'list') {
  for (const a of assets) console.log(`${fs.existsSync(rawFile(a.id)) ? 'ok ' : '-- '} ${a.id}  (${a.aspect})`);
  console.log(`requests logged: ${log.requests.length}/${budget}`);
  process.exit(0);
}
if (cmd !== 'gen') {
  console.error(usage);
  process.exit(2);
}

const todo = assets.filter((a) => (only.length ? only.includes(a.id) : true) && (force || !fs.existsSync(rawFile(a.id))));
const unknown = only.filter((id) => !assets.some((a) => a.id === id));
if (unknown.length) {
  console.error(`unknown asset ids: ${unknown.join(', ')}`);
  process.exit(2);
}
if (log.requests.length + todo.length > budget) {
  console.error(`budget: ${log.requests.length} logged + ${todo.length} new > ${budget}. Stop and report.`);
  process.exit(3);
}

const saveLog = () => fs.writeFileSync(logPath, JSON.stringify(log, null, 2) + '\n');

function listPngs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .map((f) => path.join(dir, f));
}

function runCodex(a) {
  const instruction = [
    `Use your image generation tool to create exactly ONE image with aspect ratio ${a.aspect}.`,
    'Do not run shell commands, do not write or copy files, do not generate more than one image. After the image is generated reply only with the word done.',
    'Image prompt:',
    fullPrompt(a),
  ].join('\n\n');
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('codex', ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '-'], {
      cwd: os.tmpdir(),
      shell: process.platform === 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', () => {});
    child.stdin.end(instruction);
    const timer = setTimeout(() => child.kill(), 8 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      const threadIds = [...out.matchAll(/"thread_id"\s*:\s*"([0-9a-f-]{36})"/g)].map((m) => m[1]);
      const pathHits = [...out.matchAll(/generated_images[\\/]+([0-9a-f-]{36})[\\/]+([\w.-]+\.png)/gi)].map((m) =>
        path.join(imagesRoot, m[1], m[2]),
      );
      let files = pathHits.filter((f) => fs.existsSync(f));
      if (!files.length) for (const t of threadIds) files.push(...listPngs(path.join(imagesRoot, t)));
      const tokens = [...out.matchAll(/"input_tokens"\s*:\s*(\d+)/g)].map((m) => Number(m[1])).pop() ?? null;
      resolve({ code, files: [...new Set(files)], ms: Date.now() - started, tokens, instruction });
    });
  });
}

async function genOne(a) {
  const r = await runCodex(a);
  const at = new Date().toISOString();
  if (!r.files.length) {
    log.requests.push({ id: a.id, at, model: 'codex image_generation', prompt: fullPrompt(a), ok: false, exit: r.code, ms: r.ms });
    saveLog();
    console.log(`FAIL ${a.id} (exit ${r.code}, ${Math.round(r.ms / 1000)} s)`);
    return;
  }
  const src = r.files[r.files.length - 1];
  const n = fs.readdirSync(takesDir).filter((f) => f.startsWith(`${a.id}.`)).length + 1;
  const take = path.join(takesDir, `${a.id}.${n}.png`);
  fs.copyFileSync(src, take);
  fs.copyFileSync(src, rawFile(a.id));
  log.requests.push({
    id: a.id,
    at,
    model: 'codex image_generation',
    prompt: fullPrompt(a),
    ok: true,
    take: path.relative(packDir, take).replace(/\\/g, '/'),
    file: path.relative(packDir, rawFile(a.id)).replace(/\\/g, '/'),
    ms: r.ms,
    inputTokens: r.tokens,
  });
  log.chosen = { ...(log.chosen ?? {}), [a.id]: path.basename(take) };
  saveLog();
  console.log(`ok   ${a.id} -> .cache/takes/${path.basename(take)} (${Math.round(r.ms / 1000)} s)`);
}

const queue = [...todo];
await Promise.all(
  Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, async () => {
    while (queue.length) await genOne(queue.shift());
  }),
);
console.log(`done. requests logged: ${log.requests.length}/${budget}`);
