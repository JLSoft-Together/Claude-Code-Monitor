// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { absentLimits, LIMIT_REFRESH_MS } from "../../src/lib/agent-limits";
import { createAgentLimitsService } from "./service";

afterEach(() => vi.restoreAllMocks());
describe("shared agent limit service", () => {
  it("does not expose malformed settings contents through parser error logs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const secret = "synthetic-sensitive-setting";
    const service = createAgentLimitsService({
      appData: "/unused",
      executable: "/unused",
      readCodex: async () => absentLimits("codex"),
      connectClaude: async () => {
        throw new SyntaxError(secret);
      },
    });
    expect((await service.snapshot())[0].state).toBe("error");
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain(secret);
    service.close();
  });
  it("coalesces concurrent windows and refreshes Codex at most once per minute", async () => {
    let now = 1000;
    const readCodex = vi.fn(async () => absentLimits("codex"));
    const connectClaude = vi.fn(async () => undefined);
    const service = createAgentLimitsService({
      appData: "/unused",
      executable: "/unused",
      now: () => now,
      readCodex,
      connectClaude,
      readClaude: async () => absentLimits("claude"),
    });
    await Promise.all([service.snapshot(), service.snapshot()]);
    expect(readCodex).toHaveBeenCalledTimes(1);
    expect(connectClaude).toHaveBeenCalledTimes(1);
    await service.snapshot();
    expect(readCodex).toHaveBeenCalledTimes(1);
    now += LIMIT_REFRESH_MS;
    await service.snapshot();
    expect(readCodex).toHaveBeenCalledTimes(2);
    service.close();
  });
  it("fails closed on a failed account refresh and leaves the other provider readable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const service = createAgentLimitsService({
      appData: "/unused",
      executable: "/unused",
      readCodex: async () => {
        throw new Error("signed out");
      },
      connectClaude: async () => undefined,
      readClaude: async () => ({
        agent: "claude",
        state: "ready",
        observedAtMs: 1000,
        windows: [],
      }),
    });
    const result = await service.snapshot();
    expect(result[0].state).toBe("ready");
    expect(result[1]).toEqual(absentLimits("codex", "error"));
    service.close();
    expect(await service.snapshot()).toEqual([absentLimits("claude"), absentLimits("codex")]);
  });
});
