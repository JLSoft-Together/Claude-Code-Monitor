/* oxlint-disable eslint/no-console -- CLI build status is the development interface. */
// Renderer HMR stays in Vite; successful main/preload builds restart Electron.
import { spawn } from "node:child_process";
import { cpSync, rmSync, watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { prepareDevElectron } from "./electron-dev-launch.mjs";
import { watchMain } from "./electron-dev-build.mjs";

const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = path.dirname(path.dirname(SCRIPT));
const RESTART_DELAY_MS = 80;
const STOP_TIMEOUT_MS = 3000;

export function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timeout;
    const finish = (error) => {
      clearTimeout(timeout);
      child.removeListener("exit", onExit);
      child.removeListener("error", onError);
      if (error) reject(error);
      else resolve();
    };
    const onExit = () => finish();
    const onError = (error) => finish(error);
    child.once("exit", onExit);
    child.once("error", onError);
    timeout = setTimeout(() => {
      child.kill("SIGKILL");
      timeout = setTimeout(
        () => finish(new Error("Deck Dev did not exit after SIGKILL")),
        STOP_TIMEOUT_MS,
      );
    }, STOP_TIMEOUT_MS);
    child.kill("SIGTERM");
  });
}

export function createReloader({ launch, stop = stopChild, onError, delay = RESTART_DELAY_MS }) {
  let child = null;
  let timer;
  let valid = false;
  let pending = false;
  let closed = false;
  let flight = null;
  const schedule = () => {
    clearTimeout(timer);
    if (!closed && valid && pending && !flight) timer = setTimeout(run, delay);
  };
  const run = () => {
    if (closed || !valid || !pending || flight) return;
    flight = (async () => {
      const previous = child;
      child = null;
      if (previous) await stop(previous);
      if (!closed && valid) {
        pending = false;
        child = launch();
      }
    })()
      .catch(onError)
      .finally(() => {
        flight = null;
        schedule();
      });
  };
  return {
    invalidate() {
      valid = false;
      clearTimeout(timer);
    },
    accept(changed) {
      valid = true;
      pending ||= changed || child === null;
      schedule();
    },
    requestRestart() {
      pending = true;
      schedule();
    },
    owns(candidate) {
      return child === candidate;
    },
    async close() {
      closed = true;
      clearTimeout(timer);
      await flight;
      const previous = child;
      child = null;
      if (previous) await stop(previous);
    },
  };
}

async function main() {
  let server;
  let compiler;
  let assets;
  let assetTimer;
  let closing = false;
  const shutdown = async (code = 0) => {
    if (closing) return;
    closing = true;
    clearTimeout(assetTimer);
    assets?.close();
    compiler?.close();
    const results = await Promise.allSettled([reloader.close(), server?.close()]);
    for (const result of results) if (result.status === "rejected") console.error(result.reason);
    process.exitCode = results.some((result) => result.status === "rejected") ? 1 : code;
  };
  const fail = (error) => {
    console.error("Deck Dev:", error);
    void shutdown(1);
  };
  const reloader = createReloader({
    onError: fail,
    launch() {
      const child = spawn(
        prepareDevElectron(),
        ["dist-electron/dev/electron/main.cjs", ...process.argv.slice(2)],
        {
          cwd: ROOT,
          stdio: "inherit",
          env: { ...process.env, DECK_DEV_SERVER_URL: server.resolvedUrls.local[0] },
        },
      );
      child.once("error", fail);
      child.once("exit", (code) => {
        if (reloader.owns(child)) void shutdown(code ?? 1);
      });
      return child;
    },
  });
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  try {
    // Own Vite in-process so a busy port fails and shutdown leaves no npm grandchild.
    server = await createServer({
      root: ROOT,
      server: { host: "127.0.0.1", port: 1420, strictPort: true, open: false },
    });
    if (closing) {
      await server.close();
      return;
    }
    await server.listen();
    if (closing) {
      await server.close();
      return;
    }
    console.log(
      "Deck Dev: renderer HMR enabled. Main/preload changes restart the app and interrupt live sessions.",
    );
    compiler = watchMain({
      root: ROOT,
      onError: fail,
      onInvalidated: () => reloader.invalidate(),
      onBuild({ ok, changed, durationMs }) {
        console.log(
          `Deck Dev: main ${ok ? "ready" : "build failed; keeping previous app"} (${Math.round(durationMs)} ms)`,
        );
        if (ok) reloader.accept(changed);
      },
    });
    assets = watch(path.join(ROOT, "electron", "vendor"), { recursive: true }, () => {
      clearTimeout(assetTimer);
      assetTimer = setTimeout(() => {
        try {
          const destination = path.join(ROOT, "dist-electron", "dev", "electron", "vendor");
          rmSync(destination, { recursive: true, force: true });
          cpSync(path.join(ROOT, "electron", "vendor"), destination, { recursive: true });
          reloader.requestRestart();
        } catch (error) {
          fail(error);
        }
      }, RESTART_DELAY_MS);
    });
    assets.on("error", fail);
  } catch (error) {
    fail(error);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT) await main();
