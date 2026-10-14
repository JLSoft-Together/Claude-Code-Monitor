import { describe, expect, it } from "vitest";
import { AGENT_DEFINITIONS } from "./agent-registry";

const ACTIVE = AGENT_DEFINITIONS.filter((agent) => agent.withdrawn !== true);
const WITHDRAWN = AGENT_DEFINITIONS.filter((agent) => agent.withdrawn === true);
const MAX_COMMAND_LENGTH = 300;

const ENTRIES = ACTIVE.flatMap((agent) =>
  (["macos", "windows"] as const).flatMap((platform) => {
    const entry = agent.install?.[platform];
    return entry ? [{ id: agent.id, platform, ...entry }] : [];
  }),
);

describe("agent install commands", () => {
  it("declares install for every active agent, with both platform keys present", () => {
    for (const agent of ACTIVE) {
      expect(agent.install, agent.id).toBeDefined();
      expect(Object.keys(agent.install ?? {}).sort(), agent.id).toEqual(["macos", "windows"]);
    }
  });

  it("declares none for a withdrawn agent", () => {
    expect(WITHDRAWN.length).toBeGreaterThan(0);
    for (const agent of WITHDRAWN) expect(agent.install, agent.id).toBeUndefined();
  });

  it("keeps at least one verified command to ship", () => {
    expect(ENTRIES.length).toBeGreaterThan(0);
  });

  it.each(ENTRIES)("types $id/$platform as one clean line", ({ command }) => {
    expect(command).not.toBe("");
    expect(command).toBe(command.trim());
    expect(command).not.toMatch(/[\r\n\0]/);
    expect(command.length).toBeLessThanOrEqual(MAX_COMMAND_LENGTH);
  });

  it.each(ENTRIES)("reads $id/$platform off an https page", ({ source }) => {
    expect(new URL(source).protocol).toBe("https:");
  });

  it.each(ENTRIES)(
    "dates $id/$platform with a real day that is not in the future",
    ({ checked }) => {
      expect(checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const parsed = new Date(`${checked}T00:00:00Z`);
      expect(parsed.toISOString().slice(0, 10)).toBe(checked);
      expect(checked <= new Date().toISOString().slice(0, 10)).toBe(true);
    },
  );

  it("writes Windows commands that PowerShell 5.1 can run", () => {
    for (const entry of ENTRIES.filter((e) => e.platform === "windows")) {
      expect(entry.command, entry.id).not.toContain("&&");
      expect(entry.command, entry.id).not.toContain("||");
    }
  });
});
