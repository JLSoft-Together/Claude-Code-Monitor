import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  truncateSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";

export const UPDATER_LOG_MAX_BYTES = 64 * 1024;
const MAX_FIELD_LENGTH = 2048;
export type UpdateOperation = "check" | "download" | "install";

export interface UpdaterErrorEntry {
  readonly operation: UpdateOperation;
  readonly name: string;
  readonly message: string;
}

/** Flat renderer payload; the renderer cannot choose a file or its size cap. */
export function parseUpdaterError(value: unknown): UpdaterErrorEntry {
  if (typeof value !== "object" || value === null) throw new Error("Invalid updater log entry");
  const { operation, name, message } = value as Record<string, unknown>;
  if (operation !== "check" && operation !== "download" && operation !== "install") {
    throw new Error("Invalid updater log operation");
  }
  if (
    typeof name !== "string" ||
    typeof message !== "string" ||
    name.length > MAX_FIELD_LENGTH ||
    message.length > MAX_FIELD_LENGTH
  ) {
    throw new Error("Invalid updater log message");
  }
  return { operation, name, message };
}

function redact(value: string): string {
  return (
    value
      // Response bodies, stacks and release notes must never become log entries.
      .split(/\r?\n/, 1)[0]
      .replace(/https?:\/\/[^\s"'<>]+/gi, (raw) => {
        try {
          const url = new URL(raw);
          return `${url.protocol}//${url.host}${url.pathname}`;
        } catch {
          return "[url]";
        }
      })
      .replace(/\b(?:gh[pousr]_[\w]+|github_pat_[\w]+)\b/gi, "[redacted]")
      .replace(/\b(?:bearer|basic)\s+[\w.+/=-]+/gi, "[redacted]")
      .replace(
        /\b(token|authorization|password|secret|api[-_]?key)["']?\s*[:=]\s*["']?[^\s,;"'}]+/gi,
        "$1=[redacted]",
      )
      .replace(/\{.*\}|\[.*\]/g, "[details omitted]")
      .slice(0, MAX_FIELD_LENGTH)
  );
}

/** Synchronous, main-owned writes survive an imminent installer exit. */
export function createUpdaterErrorLog(userData: string, operation: () => UpdateOperation) {
  const file = join(userData, "updater.log");
  const rotated = `${file}.1`;
  const write = (entry: UpdaterErrorEntry): void => {
    try {
      mkdirSync(userData, { recursive: true });
      const line = `${JSON.stringify({
        timestamp: new Date().toISOString(),
        operation: entry.operation,
        name: redact(entry.name),
        message: redact(entry.message),
      })}\n`;
      const size = existsSync(file) ? statSync(file).size : 0;
      if (size + Buffer.byteLength(line) > UPDATER_LOG_MAX_BYTES) {
        if (existsSync(rotated)) unlinkSync(rotated);
        if (size > UPDATER_LOG_MAX_BYTES) truncateSync(file, UPDATER_LOG_MAX_BYTES);
        if (existsSync(file)) renameSync(file, rotated);
      }
      appendFileSync(file, line, { mode: 0o600 });
    } catch (error) {
      // Do not recurse through the updater logger or let diagnostics block updating.
      console.error("Deck: could not write updater.log", error);
    }
  };
  const report = (message: string, error: unknown): void => {
    const op = /check/i.test(message)
      ? "check"
      : /download/i.test(message)
        ? "download"
        : /install|relaunch|attempt/i.test(message)
          ? "install"
          : operation();
    write({
      operation: op,
      name: error instanceof Error ? error.name : "Error",
      message: `${message}: ${error instanceof Error ? error.message : String(error)}`,
    });
  };
  const log = (value: unknown): void => report("Updater reported an error", value);
  return Object.freeze({
    write,
    report,
    // Only diagnostics: info/debug can contain entire provider response objects.
    logger: { error: log, warn: log, info: () => {}, debug: () => {} },
  });
}
