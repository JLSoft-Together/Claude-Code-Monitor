#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BUDGET = 75;
const CONCURRENCY = Math.min(3, Number(process.env.GEN_CONC ?? 3));
const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const specs = JSON.parse(fs.readFileSync(path.join(dir, 'prompts.json'), 'utf8'));
const logPath = path.join(dir, 'generation-log.json');
const rawDir = path.join(dir, '.cache', 'raw');
fs.mkdirSync(rawDir, { recursive: true });
const imagesRoots = [
  path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'generated_images'),
  'D:/work/AI/codex/cache/generated_images',
];

const argv = process.argv.slice(2);
const note = (argv.find((a) => a.startsWith('--note=')) ?? '').slice(7);
const ids = argv.filter((a) => !a.startsWith('--'));

function item(id) {
  const it = specs.items[id];
  if (!it) throw new Error(`unknown id ${id}`);
  const blocks = it.blocks ?? specs.defaultBlocks;
  return {
    aspect: it.aspect,
    refs: it.refs ?? specs.defaultRefs,
    refNote: it.refNote ?? specs.defaultRefNote,
    prompt: [it.prompt, note, ...blocks.map((b) => specs.blocks[b])].filter(Boolean).join('\n\n'),
  };
}

if (!ids.length) {
  for (const id of Object.keys(specs.items)) console.log(id);
  process.exit(0);
}
const readLog = () => (fs.existsSync(logPath) ? JSON.parse(fs.readFileSync(logPath, 'utf8')) : { budget: BUDGET, requests: [] });
const appendLog = (entry) => {
  const log = readLog();
  log.requests.push(entry);
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2) + '\n');
  return log.requests.length;
};

if (argv.includes('--dry')) {
  for (const id of ids) console.log(JSON.stringify({ id, ...item(id) }, null, 1));
  process.exit(0);
}
const done = readLog().requests.length;
if (done + ids.length > BUDGET) {
  console.error(`budget: ${done} + ${ids.length} > ${BUDGET}`);
  process.exit(3);
}
for (const id of ids) item(id);

function listPngs(d) {
  return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.toLowerCase().endsWith('.png')).map((f) => path.join(d, f)) : [];
}

function run(id) {
  const it = item(id);
  const refs = it.refs.map((r) => path.resolve(dir, r));
  for (const r of refs) if (!fs.existsSync(r)) throw new Error(`missing ref ${r}`);
  const refNote = refs.length ? `The attached image(s) are the STYLE REFERENCE. ${it.refNote}` : '';
  const instruction = [
    `Use your image generation tool to create exactly ONE image with aspect ratio ${it.aspect}.`,
    'Do not run shell commands, do not write or copy files, do not generate more than one image. After the image is generated reply only with the word done.',
    refNote,
    'Image prompt:',
    it.prompt,
  ]
    .filter(Boolean)
    .join('\n\n');
  const args = ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '-', ...refs.map((r) => `--image=${r}`)];
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('codex', args, { cwd: os.tmpdir(), shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.stdin.end(instruction);
    const timer = setTimeout(() => child.kill(), 10 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      const threadIds = [...new Set([...out.matchAll(/"thread_id"\s*:\s*"([0-9a-f-]{36})"/g)].map((m) => m[1]))];
      let files = [];
      for (const root of imagesRoots) for (const t of threadIds) files.push(...listPngs(path.join(root, t)));
      files = [...new Set(files.map((f) => fs.realpathSync(f)))];
      const n = fs.readdirSync(rawDir).filter((f) => f.startsWith(`${id}.`)).length + 1;
      const outFile = files.length ? path.join(rawDir, `${id}.${n}.png`) : null;
      if (outFile) fs.copyFileSync(files[files.length - 1], outFile);
      const count = appendLog({
        id,
        at: new Date().toISOString(),
        aspect: it.aspect,
        refs: it.refs,
        note: note || undefined,
        prompt: it.prompt,
        instruction,
        ok: !!outFile,
        exit: code,
        output: outFile ? path.relative(dir, outFile).replace(/\\/g, '/') : null,
        threadIds,
        ms: Date.now() - started,
        stderrTail: outFile ? undefined : err.slice(-600),
      });
      console.log(`${outFile ? 'ok  ' : 'FAIL'} ${id} -> ${outFile ?? '-'} (${Math.round((Date.now() - started) / 1000)} s) [${count}/${BUDGET}]`);
      resolve();
    });
  });
}

const queue = [...ids];
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) await run(queue.shift());
  }),
);
