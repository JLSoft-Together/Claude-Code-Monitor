import { describe, expect, it } from "vitest";
import { unreadAgent, type BuiltinAgent } from "./agents/agent-definition";
import { installCommandFor, installOffer, type InstallOfferInput } from "./agent-install";

const MAC = "curl -fsSL https://example.test/install.sh | bash";
const WIN = "irm https://example.test/install.ps1 | iex";

const AMP: BuiltinAgent = {
  id: "amp",
  label: "Amp",
  url: "https://example.test/amp",
  install: {
    macos: { command: MAC, source: "https://example.test/docs", checked: "2026-10-10" },
    windows: { command: WIN, source: "https://example.test/docs", checked: "2026-10-10" },
  },
};

const NO_WINDOWS: BuiltinAgent = {
  ...AMP,
  install: { macos: AMP.install!.macos, windows: null },
};

const NO_INSTALL: BuiltinAgent = { id: "kimi", label: "Kimi", url: "https://example.test/kimi" };

function input(overrides: Partial<InstallOfferInput> = {}): InstallOfferInput {
  return {
    agent: AMP,
    platform: "macos",
    available: true,
    probed: true,
    enabled: true,
    found: false,
    ...overrides,
  };
}

describe("installCommandFor", () => {
  it("reads the command for the platform", () => {
    expect(installCommandFor(AMP, "macos")).toBe(MAC);
    expect(installCommandFor(AMP, "windows")).toBe(WIN);
  });

  it("is null on an unsupported platform, a null entry and an absent install", () => {
    expect(installCommandFor(AMP, "unsupported")).toBeNull();
    expect(installCommandFor(NO_WINDOWS, "windows")).toBeNull();
    expect(installCommandFor(NO_INSTALL, "macos")).toBeNull();
  });
});

describe("installOffer", () => {
  it("offers the verbatim command for a missing, enabled built-in", () => {
    expect(installOffer(input())).toEqual({ kind: "install", command: MAC });
    expect(installOffer(input({ platform: "windows" }))).toEqual({
      kind: "install",
      command: WIN,
    });
  });

  it("offers Get with the agent url when the platform has no command", () => {
    expect(installOffer(input({ agent: NO_WINDOWS, platform: "windows" }))).toEqual({
      kind: "get",
      url: AMP.url,
    });
    expect(installOffer(input({ agent: NO_INSTALL }))).toEqual({
      kind: "get",
      url: NO_INSTALL.url,
    });
  });

  it.each([
    ["a custom or stale id", { agent: undefined }],
    ["a host that cannot open the pane", { available: false }],
    ["a probe that has not settled", { probed: false }],
    ["a disabled agent", { enabled: false }],
    ["an agent the probe found", { found: true }],
    ["an unsupported platform", { platform: "unsupported" as const }],
  ])("offers nothing for %s", (_name, overrides) => {
    expect(installOffer(input(overrides))).toEqual({ kind: "none" });
  });

  it("lets the E2E override replace a command but never create one", () => {
    expect(installOffer(input({ commandOverride: "sh /tmp/x amp" }))).toEqual({
      kind: "install",
      command: "sh /tmp/x amp",
    });
    expect(
      installOffer(input({ agent: NO_WINDOWS, platform: "windows", commandOverride: "x" })),
    ).toEqual({ kind: "get", url: AMP.url });
  });
});

describe("unreadAgent", () => {
  it("keeps the install commands it is given", () => {
    const agent = unreadAgent({ id: "amp", label: "Amp", url: AMP.url, install: AMP.install });
    expect(agent.install).toBe(AMP.install);
  });
});
