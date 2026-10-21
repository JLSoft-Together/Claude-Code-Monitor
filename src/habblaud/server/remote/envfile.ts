// Edita o .env do projeto sem perder o resto: troca (ou tira) só as chaves pedidas e mantém comentários e ordem.

/** `set[k] = valor` grava/troca; `null` remove. Chaves repetidas viram uma (a primeira posição). */
export function updateEnv(content: string, set: Record<string, string | null>): string {
  const lines = content.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    const key = m?.[1];
    if (!key || !(key in set)) {
      out.push(line);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    const value = set[key];
    if (value !== null) out.push(`${key}=${value}`);
  }
  for (const [key, value] of Object.entries(set)) {
    if (!seen.has(key) && value !== null) out.push(`${key}=${value}`);
  }
  return out.length ? `${out.join('\n')}\n` : '';
}

/** Valor de uma chave do .env (a primeira ocorrência), sem aspas. */
export function readEnvValue(content: string, key: string): string | undefined {
  for (const line of content.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (m?.[1] === key) return m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return undefined;
}

/** Junta nomes a uma lista separada por vírgula (HABBLAUD_ALLOWED_HOSTS), sem repetir. */
export function addToList(current: string | undefined, ...names: string[]): string {
  const list = (current ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const n of names) if (n && !list.includes(n)) list.push(n);
  return list.join(',');
}
