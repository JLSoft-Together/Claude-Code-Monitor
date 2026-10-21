// Screenshot isolado (Chromium headless do Playwright, sem tocar no navegador do usuário).
// Uso:
//   node scripts/shot.mjs <url> <saida.png> [--size 1400x900] [--wait 3000] [--scale 1]
//        [--eval "js executado na página antes da foto"] [--frames 3 --interval 800] [--full]
//        [--clip x,y,w,h]
// Imprime erros de console/página encontrados (útil para depurar sem DevTools).
import { chromium } from 'playwright-core';

const [url, out, ...rest] = process.argv.slice(2);
if (!url || !out) {
  console.error('uso: node scripts/shot.mjs <url> <saida.png> [opções]');
  process.exit(2);
}
const opt = (name, def) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : def;
};
const flag = (name) => rest.includes(`--${name}`);
const [width, height] = opt('size', '1400x900').split('x').map(Number);
const wait = Number(opt('wait', '3000'));
const scale = Number(opt('scale', '1'));
const frames = Number(opt('frames', '1'));
const interval = Number(opt('interval', '800'));
const evalJs = opt('eval', '');
const clipArg = opt('clip', '');
const clip = clipArg ? (([x, y, w, h]) => ({ x, y, width: w, height: h }))(clipArg.split(',').map(Number)) : undefined;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') problems.push(`[console.${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(wait);
if (evalJs) {
  const r = await page.evaluate(evalJs);
  if (r !== undefined) console.log('eval =>', typeof r === 'string' ? r : JSON.stringify(r));
  await page.waitForTimeout(500);
}
for (let i = 0; i < frames; i++) {
  const path = frames > 1 ? out.replace(/\.png$/, `-${i + 1}.png`) : out;
  await page.screenshot({ path, fullPage: flag('full'), clip });
  console.log('salvo:', path);
  if (i < frames - 1) await page.waitForTimeout(interval);
}
await browser.close();
if (problems.length) console.log(problems.slice(0, 30).join('\n'));
