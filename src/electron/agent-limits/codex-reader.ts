import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { discoverAgents } from "../agents";
import { codexLimits, type AgentLimitReading } from "../../src/lib/agent-limits";

const REQUEST_TIMEOUT_MS = 25_000;
const MAX_REPLY_BYTES = 256 * 1024;
const KILL_GRACE_MS = 500;

/** A bounded read-only RPC session: never create a thread or invoke a model. */
export async function readCodexLimits(signal?: AbortSignal): Promise<AgentLimitReading> {
  const executable = (await discoverAgents(["codex"])).find(
    (agent) => agent.name === "codex",
  )?.path;
  if (!executable) throw new Error("Codex CLI was not found.");
  if (/\.(cmd|bat)$/i.test(executable))
    throw new Error("Codex limits require a native CLI executable.");
  return codexLimits(await readCodexRateLimits(executable, signal), Date.now());
}

export function readCodexRateLimits(
  executable: string,
  signal?: AbortSignal,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Codex limit read cancelled."));
      return;
    }
    const grouped = process.platform !== "win32";
    const child = spawn(executable, ["app-server", "--stdio"], {
      cwd: homedir(),
      stdio: ["pipe", "pipe", "pipe"],
      detached: grouped,
      windowsHide: true,
    });
    let buffer = "";
    let bytes = 0;
    let finished = false;
    let result: unknown;
    let failure: Error | null = null;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    function kill(kind: NodeJS.Signals): void {
      try {
        if (grouped && child.pid) process.kill(-child.pid, kind);
        else child.kill(kind);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
          console.warn(
            "Deck: failed to stop Codex limit reader",
            (error as NodeJS.ErrnoException).code,
          );
        }
      }
    }
    function finish(error: Error | null, value?: unknown): void {
      if (finished) return;
      finished = true;
      failure = error;
      result = value;
      clearTimeout(timeout);
      child.stdin.end();
      kill("SIGTERM");
      killTimer = setTimeout(() => kill("SIGKILL"), KILL_GRACE_MS);
    }
    const cancel = () => {
      finish(new Error("Codex limit read cancelled."));
      kill("SIGKILL");
    };
    const timeout = setTimeout(() => finish(new Error("Codex limit read timed out.")), timeoutMs);
    signal?.addEventListener("abort", cancel, { once: true });
    const send = (value: unknown) => child.stdin.write(`${JSON.stringify(value)}\n`);
    child.stdin.on("error", () => finish(new Error("Codex limit reader input closed.")));
    child.stderr.resume(); // Diagnostics can contain account details; never forward them to the renderer.
    child.on("error", () => finish(new Error("Could not start Codex limit reader.")));
    child.on("close", () => {
      if (grouped) kill("SIGKILL");
      clearTimeout(timeout);
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", cancel);
      if (!finished || failure)
        reject(failure ?? new Error("Codex limit reader exited without a reply."));
      else resolve(result);
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (finished) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_REPLY_BYTES) {
        finish(new Error("Codex limit reply exceeded its size limit."));
        return;
      }
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0 && !finished) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(line);
        } catch {
          finish(new Error("Codex returned invalid JSON."));
          return;
        }
        if (!message || typeof message !== "object") continue;
        if (message.id === 1) {
          if (message.error) {
            finish(new Error("Codex initialization failed."));
            return;
          }
          send({ method: "initialized", params: {} });
          send({ id: 2, method: "account/rateLimits/read", params: {} });
        } else if (message.id === 2) {
          finish(
            message.error
              ? new Error("Codex account limits are unavailable. Check CLI sign-in.")
              : null,
            message.result,
          );
        }
      }
    });
    send({
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "spacevibe_deck", version: "1.0.0" } },
    });
  });
}
