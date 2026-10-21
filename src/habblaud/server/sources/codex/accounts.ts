// Contas do Codex: uma pasta CODEX_HOME por conta (~/.codex, ~/.codex-trabalho...). Node puro e sem dependências
// do servidor: também é importado por scripts/docker-up.ts (via tsx) no host.
//
// Descoberta: HABBLAUD_CODEX_DIRS (lista separada por vírgula) substitui tudo; senão CODEX_HOME e `$HOME/.codex*`
// que tenham cara de pasta do Codex (isCodexHome). Letra da conta: o alias de shell `alias x='CODEX_HOME=... codex'`
// (sem CODEX_HOME = a pasta padrão); sem alias, uma letra derivada que não colide com as do Claude Code. Cor: da
// paleta das contas, sem repetir as do Claude Code. Nome: "Codex" (ou "Codex X" com mais de uma conta). O plano
// vem depois, dos arquivos de sessão (rate_limits.plan_type).
//
// Privacidade: NUNCA lê `auth.json` nem `config.toml` (só confere se existem, em isCodexHome); dos arquivos de shell,
// só as linhas `alias X='... codex ...'`. No Docker o host manda tudo pronto em HABBLAUD_ACCOUNTS (`provider:
// 'codex'`, com o `configDir` do host: é nele que o `codex queue` roda).
import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import {
  ACCOUNT_COLORS,
  accountIds,
  expandHome,
  isCodexHome,
  parseAccountOverrides,
  readShellAliases,
  shortcutsByDir,
  type AccountOverride,
  type DetectedAccount,
} from '../../accounts/detect';

function splitList(v: string | undefined): string[] {
  return (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** Pasta padrão do Codex: CODEX_HOME ou $HOME/.codex. */
export function defaultCodexHome(env: NodeJS.ProcessEnv, home: string): string {
  const raw = env.CODEX_HOME?.trim();
  return raw ? expandHome(raw, home) : join(home, '.codex');
}

/**
 * Pastas do Codex observadas. HABBLAUD_CODEX_DIRS (lista separada por vírgula) substitui a detecção e vale como
 * veio (só precisa existir: uma conta recém-criada ainda não tem sessões). Senão: CODEX_HOME e `$HOME/.codex*` que
 * passem em isCodexHome. Ordem estável: a padrão primeiro, depois alfabética.
 */
export function discoverCodexDirs(env: NodeJS.ProcessEnv = process.env, home: string = env.HOME || homedir()): string[] {
  const override = splitList(env.HABBLAUD_CODEX_DIRS);
  if (override.length) return [...new Set(override.map((p) => expandHome(p, home)))].filter(isDir);
  const found: string[] = [];
  const main = defaultCodexHome(env, home);
  if (isCodexHome(main)) found.push(main);
  try {
    for (const ent of readdirSync(home, { withFileTypes: true })) {
      if (!ent.name.startsWith('.codex')) continue;
      if (!ent.isDirectory() && !ent.isSymbolicLink()) continue;
      const p = join(home, ent.name);
      if (isCodexHome(p)) found.push(p);
    }
  } catch {
    // $HOME ilegível (ex.: container sem home)
  }
  const dirs = [...new Set(found.map((p) => expandHome(p, home)))];
  dirs.sort((a, b) => (a === main ? 0 : 1) - (b === main ? 0 : 1) || a.localeCompare(b));
  return dirs;
}

/** Overrides das contas do Codex em HABBLAUD_ACCOUNTS (vindos do host, no Docker). */
export function codexOverrides(raw: string | undefined): AccountOverride[] {
  return parseAccountOverrides(raw).filter((o) => o.provider === 'codex');
}

function matchOverride(overrides: AccountOverride[], id: string, dir: string, home: string): AccountOverride | undefined {
  const norm = (p: unknown) => (typeof p === 'string' && p.trim() ? expandHome(p, home) : undefined);
  return overrides.find((o) => norm(o.mountDir) === dir) ?? overrides.find((o) => norm(o.configDir) === dir) ?? overrides.find((o) => o.id === id);
}

/** Letras candidatas de uma conta sem alias: a inicial do sufixo (".codex-trabalho" → T), X, Y, Z... e o alfabeto. */
function letterCandidates(dir: string): string[] {
  const suffix = /^\.?codex[-_.]+([A-Za-z])/i.exec(basename(dir))?.[1]?.toUpperCase();
  const out = suffix ? [suffix] : [];
  out.push('X', 'Y', 'Z', 'W', 'V', 'U');
  for (let i = 0; i < 26; i++) out.push(String.fromCharCode(65 + i));
  return out;
}

export interface CodexDetectOptions {
  home?: string;
  env?: NodeJS.ProcessEnv;
  /** Letras e cores já usadas pelas contas do Claude Code (não se repetem). */
  taken?: { shorts?: Iterable<string>; colors?: Iterable<string> };
}

/**
 * Uma conta por pasta do Codex, NA MESMA ORDEM de `dirs`. `configDir` é o caminho para exibição e para o `codex
 * queue` (no Docker, o do host, vindo de HABBLAUD_ACCOUNTS). Sem e-mail (não sai sem ler credenciais) e sem plano
 * (vem dos arquivos de sessão).
 */
export function detectCodexAccounts(dirs: string[], opts: CodexDetectOptions = {}): DetectedAccount[] {
  const env = opts.env ?? process.env;
  const home = opts.home ?? (env.HOME || homedir());
  const overrides = codexOverrides(env.HABBLAUD_ACCOUNTS);
  const shortcuts = shortcutsByDir(readShellAliases(home, 'codex'), home, defaultCodexHome(env, home));
  const ids = accountIds(dirs);
  const usedShorts = new Set([...(opts.taken?.shorts ?? [])].map((s) => s.toUpperCase()));
  const usedColors = new Set(opts.taken?.colors ?? []);

  const partial = dirs.map((dir, i) => {
    const ov = matchOverride(overrides, ids[i], resolve(dir), home);
    const short = str(ov?.short)?.slice(0, 3) ?? shortcuts.get(resolve(dir));
    return { dir, id: str(ov?.id) ?? ids[i], ov, short: short && !usedShorts.has(short.toUpperCase()) ? short : undefined };
  });
  for (const p of partial) if (p.short) usedShorts.add(p.short.toUpperCase());

  return partial.map((p) => {
    const short = p.short ?? letterCandidates(p.dir).find((l) => !usedShorts.has(l)) ?? '?';
    usedShorts.add(short.toUpperCase());
    let color = str(p.ov?.color);
    if (!color) {
      color = ACCOUNT_COLORS.find((c) => !usedColors.has(c)) ?? ACCOUNT_COLORS[usedColors.size % ACCOUNT_COLORS.length];
      usedColors.add(color);
    }
    const acc: DetectedAccount = {
      id: p.id,
      provider: 'codex',
      configDir: str(p.ov?.configDir) ?? p.dir,
      short,
      name: str(p.ov?.name) ?? (dirs.length > 1 ? `Codex ${short}` : 'Codex'),
      color,
    };
    const plan = str(p.ov?.plan);
    if (plan) acc.plan = plan;
    return acc;
  });
}

const PLAN_NAMES: Record<string, string> = {
  free: 'Free',
  go: 'Go',
  plus: 'Plus',
  pro: 'Pro',
  prolite: 'Pro Lite',
  promax: 'Pro Max',
  team: 'Team',
  business: 'Business',
  enterprise: 'Enterprise',
  edu: 'Edu',
  edu_plus: 'Edu Plus',
  edu_pro: 'Edu Pro',
};

/** `rate_limits.plan_type` do Codex ("plus", "pro", "self_serve_business_usage_based"...) para exibir. */
export function codexPlanLabel(raw: unknown): string | undefined {
  const v = str(raw)?.toLowerCase();
  if (!v || v === 'unknown') return undefined;
  if (PLAN_NAMES[v]) return PLAN_NAMES[v];
  return v
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
    .slice(0, 40);
}
