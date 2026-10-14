import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUpdaterErrorLog, parseUpdaterError, UPDATER_LOG_MAX_BYTES } from "./error-log";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});
function setup() {
  const root = mkdtempSync(join(tmpdir(), "deck-updater-log-"));
  roots.push(root);
  return { root, log: createUpdaterErrorLog(root, () => "install") };
}

describe("local updater error log", () => {
  it("records timestamp, operation, name and message for every report path", () => {
    const { root, log } = setup();
    log.report("Update check failed", new TypeError("offline"));
    log.report("Update download failed", new Error("disk full"));
    log.logger.error(new Error("staging failed"));
    const entries = readFileSync(join(root, "updater.log"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(entries.map((entry) => entry.operation)).toEqual(["check", "download", "install"]);
    expect(entries[0]).toMatchObject({
      name: "TypeError",
      message: "Update check failed: offline",
    });
    expect(Number.isNaN(Date.parse(entries[0].timestamp))).toBe(false);
  });

  it("keeps both files within the byte cap and rotates only once", () => {
    const { root, log } = setup();
    for (let i = 0; i < 200; i += 1)
      log.report("Update download failed", new Error("界".repeat(5000)));
    expect(readdirSync(root).sort()).toEqual(["updater.log", "updater.log.1"]);
    for (const file of readdirSync(root))
      expect(statSync(join(root, file)).size).toBeLessThanOrEqual(UPDATER_LOG_MAX_BYTES);
    expect(() =>
      readFileSync(join(root, "updater.log"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    ).not.toThrow();
  });

  it("drops provider bodies and redacts credentials including signed URL queries", () => {
    const { root, log } = setup();
    log.logger.info("Release notes: private body");
    log.logger.debug({ releaseNotes: "private body" });
    log.logger.error(
      "Failed https://user:pass@example.com/a?token=secret Bearer abc123 ghp_secrettoken\nprivate body",
    );
    const content = readFileSync(join(root, "updater.log"), "utf8");
    for (const secret of [
      "private body",
      "user:pass",
      "token=secret",
      "abc123",
      "ghp_secrettoken",
    ]) {
      expect(content).not.toContain(secret);
    }
    expect(content).toContain("https://example.com/a");
  });

  it("rejects malformed renderer payloads", () => {
    for (const value of [
      null,
      {},
      { operation: "delete", name: "Error", message: "x" },
      { operation: "check", name: "Error", message: "x".repeat(2049) },
    ]) {
      expect(() => parseUpdaterError(value)).toThrow("Invalid updater log");
    }
    expect(
      parseUpdaterError({
        operation: "check",
        name: "Error",
        message: "offline",
        path: "/etc/log",
      }),
    ).toEqual({ operation: "check", name: "Error", message: "offline" });
  });

  it("reports a filesystem failure without breaking the updater", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // A regular file cannot serve as the userData directory.
      const fileLog = createUpdaterErrorLog(import.meta.filename, () => "check");
      expect(() => fileLog.report("Update check failed", new Error("offline"))).not.toThrow();
      expect(error).toHaveBeenCalledWith("Deck: could not write updater.log", expect.any(Error));
    } finally {
      error.mockRestore();
    }
  });
});
