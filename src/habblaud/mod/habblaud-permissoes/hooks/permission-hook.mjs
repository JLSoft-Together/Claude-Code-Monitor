#!/usr/bin/env node
// Hook PermissionRequest do Habblaud: deixa aprovar ou recusar pelo escritório os pedidos de permissão
// do Claude Code ("Do you want to…") e responder as perguntas do AskUserQuestion. Chega à sessão de um
// destes jeitos (este arquivo é a fonte única dos dois):
//
// - plugin `habblaud-permissoes` do marketplace do repositório (Claude Code 2.1.287+): o hooks.json ao
//   lado roda `node "${CLAUDE_PLUGIN_ROOT}/hooks/permission-hook.mjs"`, com a porta vinda de HABBLAUD_PORT.
//   O Claude Code copia SÓ a pasta do plugin para o cache de plugins: por isso nada de imports fora de
//   `node:*` aqui;
// - `npm run hooks:install` (versões anteriores), que grava em cada <conta>/settings.json:
//
//   node /caminho/do/habblaud/mod/habblaud-permissoes/hooks/permission-hook.mjs [--port 4747] [--timeout 300]
//
// O Claude Code mostra o diálogo no terminal e roda este hook AO MESMO TEMPO (vale o que responder
// primeiro); em subagentes em segundo plano o diálogo só aparece depois que o hook termina. O hook:
// 1. lê do stdin o JSON do pedido (session_id, tool_name, tool_input, permission_suggestions...);
// 2. manda para POST http://127.0.0.1:<porta>/api/permissions. Se o Habblaud não responder, recusar
//    (recurso desligado) ou disser que não há página aberta ou que não conhece a sessão, sai na hora,
//    sem decidir: o terminal segue normal;
// 3. senão, espera a decisão em GET /api/permissions/:id/wait (respostas de até 25 s, em laço) até o
//    tempo limite (padrão 5 min: --timeout <s> ou HABBLAUD_PERMISSION_TIMEOUT);
// 4. aprovado/recusado: imprime a decisão (hookSpecificOutput.decision). Pergunta respondida: aprova
//    a chamada com a entrada ORIGINAL mais `answers` ({texto da pergunta: rótulos escolhidos}, como a
//    documentação dos hooks manda responder o AskUserQuestion); a página escolhe por posição e os textos
//    vêm do stdin. "Responder no terminal", tempo esgotado ou qualquer erro: sai sem imprimir nada, e
//    vale o que você responder no terminal.
//
// Regras: Node puro (22+), sem dependências; nunca trava nem quebra a sessão (todo erro = sair sem
// decidir). Só fala com 127.0.0.1. HABBLAUD_HOOK_DEBUG=1 escreve o que acontece no stderr.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PORT = 4747;
export const DEFAULT_TIMEOUT_S = 300;
const MIN_TIMEOUT_S = 5;
const MAX_TIMEOUT_S = 86_400;
/** Espera máxima de cada long-poll (o servidor responde "pending" e o hook pergunta de novo). */
const WAIT_S = 25;
/** Registrar o pedido: se o Habblaud não responder nisso, ele está fora do ar (ou travado). */
const REGISTER_TIMEOUT_MS = 2_000;
const STDIN_TIMEOUT_MS = 5_000;
const MAX_STDIN = 8 * 1024 * 1024;
/** Textos dos argumentos mandados ao Habblaud (o servidor só mostra uma prévia). */
const MAX_STRING = 8_000;
/** Corpo do pedido (o servidor recusa acima de 256 KB). */
const MAX_BODY = 200_000;
/** Ferramenta das perguntas ao usuário: a resposta é uma escolha (decisão `answer`), não aprovar/recusar. */
const ASK_TOOL = 'AskUserQuestion';

const debug = process.env.HABBLAUD_HOOK_DEBUG === '1' ? (msg) => process.stderr.write(`[habblaud-hook] ${msg}\n`) : () => {};

/** Porta e tempo limite: argumentos (--port, --timeout) ou ambiente (HABBLAUD_PORT, HABBLAUD_PERMISSION_TIMEOUT). */
export function parseOptions(argv, env = process.env) {
  const arg = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const port = Number.parseInt(arg('port') ?? env.HABBLAUD_PORT ?? '', 10);
  const timeout = Number(arg('timeout') ?? env.HABBLAUD_PERMISSION_TIMEOUT ?? '');
  return {
    port: Number.isInteger(port) && port > 0 && port < 65_536 ? port : DEFAULT_PORT,
    timeoutMs: (Number.isFinite(timeout) && timeout > 0 ? Math.min(MAX_TIMEOUT_S, Math.max(MIN_TIMEOUT_S, timeout)) : DEFAULT_TIMEOUT_S) * 1_000,
  };
}

/** Corta textos longos dos argumentos (conteúdo de um Write enorme, por exemplo). */
export function trimInput(v, max = MAX_STRING, depth = 0) {
  if (typeof v === 'string') return v.length > max ? v.slice(0, max) : v;
  if (depth > 8 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.slice(0, 200).map((x) => trimInput(x, max, depth + 1));
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = trimInput(x, max, depth + 1);
  return out;
}

/**
 * Corpo mandado ao Habblaud: só o que ele usa (nada de transcript_path nem do resto do stdin). Se ainda
 * ficar grande (muitas edições de uma vez), os textos são cortados mais curtos.
 */
export function requestBody(input, timeoutMs) {
  const body = { session_id: input.session_id, tool_name: input.tool_name, tool_input: {}, timeout_ms: timeoutMs };
  for (const k of ['agent_id', 'agent_type', 'cwd']) if (typeof input[k] === 'string') body[k] = input[k];
  if (Array.isArray(input.permission_suggestions)) body.permission_suggestions = input.permission_suggestions;
  for (const max of [MAX_STRING, 1_000, 200]) {
    body.tool_input = trimInput(input.tool_input ?? {}, max);
    if (JSON.stringify(body).length <= MAX_BODY) break;
  }
  return body;
}

/** Texto não vazio (as respostas usam os textos do stdin como vieram, sem aparar). */
const text = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * `answers` do AskUserQuestion ({texto ORIGINAL da pergunta: rótulos ORIGINAIS das opções escolhidas, na ordem
 * delas, e o texto livre no fim, juntos com ", "}) a partir das respostas por posição vindas do Habblaud.
 * undefined = não dá para responder (sai sem decidir e vale o terminal): entrada sem `questions`, pergunta
 * sem resposta ou respondida duas vezes, posição inválida, sem multiSelect mais de uma escolha, perguntas
 * com o mesmo texto.
 */
export function answersFor(answers, toolInput) {
  const questions = Array.isArray(toolInput?.questions) ? toolInput.questions : undefined;
  if (!questions || !Array.isArray(answers) || !answers.length) return undefined;
  const out = {};
  const done = new Set();
  for (const a of answers) {
    const q = a && Number.isInteger(a.question) ? questions[a.question] : undefined;
    if (!q || typeof q !== 'object' || !text(q.question) || done.has(a.question) || Object.hasOwn(out, q.question)) return undefined;
    done.add(a.question);
    const options = Array.isArray(q.options) ? q.options : [];
    const parts = [];
    for (const i of Array.isArray(a.options) ? a.options : []) {
      const label = Number.isInteger(i) && i >= 0 ? options[i]?.label : undefined;
      if (!text(label)) return undefined;
      parts.push(label);
    }
    if (text(a.other)) parts.push(a.other.trim());
    if (!parts.length || (q.multiSelect !== true && parts.length > 1)) return undefined;
    out[q.question] = parts.join(', ');
  }
  // Toda pergunta de verdade precisa de resposta (as inválidas o Habblaud nem mostrou).
  if (questions.some((q, i) => q && typeof q === 'object' && text(q.question) && !done.has(i))) return undefined;
  return out;
}

/**
 * Saída do hook para uma decisão do Habblaud (undefined = sair sem decidir). Uma regra "sempre permitir"
 * escolhida na página volta só como a POSIÇÃO: aplica-se a sugestão original que o Claude Code mandou.
 * Pergunta (AskUserQuestion): só `answer` aprova (sem `answers` a chamada não teria resposta); recusar vale.
 */
export function decisionOutput(result, input) {
  if (!result || result.status !== 'decided') return undefined;
  const ask = input?.tool_name === ASK_TOOL;
  if (result.behavior === 'answer') {
    const answers = ask ? answersFor(result.answers, input.tool_input) : undefined;
    if (!answers) return undefined;
    const decision = { behavior: 'allow', updatedInput: { ...input.tool_input, answers } };
    return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } };
  }
  if (result.behavior === 'allow') {
    if (ask) return undefined;
    const decision = { behavior: 'allow' };
    const list = Array.isArray(input?.permission_suggestions) ? input.permission_suggestions : [];
    const chosen = Number.isInteger(result.suggestion) ? list[result.suggestion] : undefined;
    if (chosen && typeof chosen === 'object') decision.updatedPermissions = [chosen];
    return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } };
  }
  if (result.behavior === 'deny') {
    const reason = typeof result.message === 'string' && result.message.trim() ? result.message.trim().slice(0, 1_000) : '';
    const decision = { behavior: 'deny', message: reason ? `Recusado pelo usuário no Habblaud: ${reason}` : 'Recusado pelo usuário no Habblaud.' };
    if (result.interrupt === true) decision.interrupt = true;
    return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } };
  }
  return undefined;
}

function readStdin() {
  return new Promise((ok) => {
    const chunks = [];
    let size = 0;
    const finish = (text) => {
      clearTimeout(timer);
      ok(text);
    };
    const timer = setTimeout(() => finish(undefined), STDIN_TIMEOUT_MS);
    process.stdin.on('data', (c) => {
      size += c.length;
      if (size > MAX_STDIN) return finish(undefined);
      chunks.push(c);
    });
    process.stdin.on('end', () => finish(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => finish(undefined));
  });
}

/** Requisição ao Habblaud local; null = fora do ar, tempo esgotado ou resposta ilegível. */
async function call(base, method, path, body, timeoutMs) {
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { status: res.status, json };
  } catch (err) {
    debug(`${method} ${path}: ${err?.name ?? 'erro'} ${err?.message ?? ''}`);
    return null;
  }
}

/** Decide o pedido (ou não). Devolve a saída a imprimir, ou undefined. Nunca lança. */
export async function run(argv = process.argv.slice(2), env = process.env, stdinText) {
  try {
    const opts = parseOptions(argv, env);
    const raw = stdinText ?? (await readStdin());
    if (!raw) return undefined;
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      return undefined;
    }
    if (!input || typeof input !== 'object' || typeof input.session_id !== 'string' || typeof input.tool_name !== 'string') return undefined;
    if (input.hook_event_name !== undefined && input.hook_event_name !== 'PermissionRequest') return undefined;

    const base = `http://127.0.0.1:${opts.port}`;
    const deadline = Date.now() + opts.timeoutMs;
    const reg = await call(base, 'POST', '/api/permissions', requestBody(input, opts.timeoutMs), REGISTER_TIMEOUT_MS);
    if (!reg || reg.status !== 201 || typeof reg.json?.id !== 'string') {
      debug(`sem desvio (${reg ? `${reg.status} ${JSON.stringify(reg.json ?? null)}` : 'Habblaud fora do ar'})`);
      return undefined;
    }
    const id = encodeURIComponent(reg.json.id);
    for (;;) {
      const left = deadline - Date.now();
      if (left <= 0) {
        debug('tempo esgotado: vale o terminal');
        return undefined;
      }
      const waitS = Math.max(0.05, Math.min(WAIT_S, left / 1_000));
      const r = await call(base, 'GET', `/api/permissions/${id}/wait?timeout=${waitS}`, undefined, waitS * 1_000 + 5_000);
      if (!r || r.status !== 200) return undefined;
      const status = r.json?.status;
      if (status === 'pending') continue;
      debug(`resposta: ${JSON.stringify(r.json)}`);
      return decisionOutput(r.json, input);
    }
  } catch (err) {
    debug(`erro: ${err?.message ?? err}`);
    return undefined;
  }
}

/** Ponto de entrada (exportado para o atalho do caminho antigo, scripts/permission-hook.mjs). */
export async function main() {
  const { timeoutMs } = parseOptions(process.argv.slice(2));
  // Rede de segurança: nada mantém o processo vivo além do tempo limite.
  setTimeout(() => process.exit(0), timeoutMs + 15_000).unref();
  const out = await run();
  // Sem process.exit() logo depois do fetch: no Windows (Node 23 até 24.19) ele derruba o processo com
  // 0xC0000409 enquanto o V8 ainda compila em segundo plano o parser do fetch (assert do libuv,
  // nodejs/node#56645). O processo sai sozinho quando o loop esvazia, o que também espera a escrita da
  // decisão no pipe (assíncrona no macOS); se algo ainda segurar o loop, o process.exit vem 1 s depois.
  const finish = () => setTimeout(() => process.exit(0), 1_000).unref();
  if (out) process.stdout.write(`${JSON.stringify(out)}\n`, finish);
  else finish();
}

function isMain() {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) main().catch(() => process.exit(0));
