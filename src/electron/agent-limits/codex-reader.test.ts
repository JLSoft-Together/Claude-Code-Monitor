// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readCodexRateLimits } from "./codex-reader";

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "deck-codex-limits-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function server(reply: string): Promise<string> {
  const executable = path.join(root, "codex");
  await fs.writeFile(
    executable,
    `#!${process.execPath}\n` +
      `
    const readline = require('node:readline');
    const fs = require('node:fs');
    fs.writeFileSync(${JSON.stringify(path.join(root, "pid"))}, String(process.pid));
    readline.createInterface({input: process.stdin}).on('line', line => {
      const message = JSON.parse(line);
      if (message.method === 'initialize') process.stdout.write(JSON.stringify({id:1,result:{}})+'\\n');
      if (message.method === 'account/rateLimits/read') { ${reply} }
      if (message.method.startsWith('thread/') || message.method.startsWith('turn/')) process.exit(10);
    });
  `,
    { mode: 0o700 },
  );
  return executable;
}

describe.skipIf(process.platform === "win32")("Codex account RPC reader", () => {
  it("reads without a model turn and reaps its process after the reply", async () => {
    const executable = await server(
      `process.stdout.write(JSON.stringify({id:2,result:{rateLimits:{primary:{usedPercent:82,windowDurationMins:10080,resetsAt:1800003600}}}})+'\\n');`,
    );
    expect(await readCodexRateLimits(executable)).toMatchObject({
      rateLimits: { primary: { usedPercent: 82 } },
    });
    const pid = Number(await fs.readFile(path.join(root, "pid"), "utf8"));
    expect(() => process.kill(pid, 0)).toThrow(/ESRCH/);
  });
  it("times out an unresponsive CLI and stops it", async () => {
    const executable = await server("");
    await expect(readCodexRateLimits(executable, undefined, 1000)).rejects.toThrow("timed out");
    const pid = Number(await fs.readFile(path.join(root, "pid"), "utf8"));
    expect(() => process.kill(pid, 0)).toThrow(/ESRCH/);
  });
  it("rejects malformed protocol data rather than displaying a guessed limit", async () => {
    const executable = await server(`process.stdout.write('not-json\\n');`);
    await expect(readCodexRateLimits(executable)).rejects.toThrow("invalid JSON");
  });
});
