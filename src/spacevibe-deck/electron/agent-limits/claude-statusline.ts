/** Standalone collector generated beside its private manifest; no package/runtime imports. */
export function claudeStatuslineSource(): string {
  return String.raw`"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_SESSIONS = 64;
const original = process.argv[2];
const { ELECTRON_RUN_AS_NODE, ...originalEnv } = process.env;
let delegate = null;
if (typeof original === "string" && original.length) {
  delegate = spawn(original, { shell: true, env: originalEnv, stdio: ["pipe", "inherit", "inherit"] });
  delegate.on("error", () => { console.error("Deck: original status line could not start."); });
  delegate.stdin.on("error", () => {}); // An original command may intentionally stop reading early.
  process.stdin.pipe(delegate.stdin);
}
let size = 0;
const chunks = [];
process.stdin.on("data", (chunk) => {
  size += chunk.length;
  if (size <= MAX_INPUT_BYTES) chunks.push(chunk);
});
process.stdin.on("end", () => {
  if (size > MAX_INPUT_BYTES) { console.error("Deck: status line capture exceeded its size limit."); return; }
  try {
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.session_id || "")) return;
    const limits = {};
    for (const key of ["five_hour", "seven_day"]) {
      const window = input.rate_limits && input.rate_limits[key];
      if (window && Number.isFinite(window.used_percentage) && window.used_percentage >= 0 &&
          window.used_percentage <= 100 && Number.isSafeInteger(window.resets_at) && window.resets_at > 0) {
        limits[key] = { used_percentage: window.used_percentage, resets_at: window.resets_at };
      }
    }
    const dir = path.join(__dirname, "captures");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, input.session_id + ".json");
    // Track receipt from Claude, even when the reported percentage has not changed.
    const capture = { observedAtMs: Date.now(), rateLimits: limits };
    const temp = file + "." + process.pid + ".tmp";
    try {
      fs.writeFileSync(temp, JSON.stringify(capture), { mode: 0o600, flag: "wx" });
      fs.renameSync(temp, file);
    } finally {
      try { fs.unlinkSync(temp); } catch (error) {
        if (error.code !== "ENOENT") console.error("Deck: limit capture cleanup failed.");
      }
    }
    const entries = fs.readdirSync(dir).filter((name) => /^[a-zA-Z0-9_-]+\.json$/.test(name))
      .map((name) => ({ name, at: fs.statSync(path.join(dir, name)).mtimeMs }))
      .sort((a, b) => b.at - a.at);
    for (const entry of entries.slice(MAX_SESSIONS)) {
      try { fs.unlinkSync(path.join(dir, entry.name)); } catch (error) {
        if (error.code !== "ENOENT") console.error("Deck: old limit capture cleanup failed.");
      }
    }
  } catch { console.error("Deck: status line limit capture failed."); }
});
`;
}
