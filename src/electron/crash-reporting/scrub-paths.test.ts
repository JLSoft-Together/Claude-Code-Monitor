import { describe, expect, it } from "vitest";
import { homeDirectoryVariants, scrubHomeDirectory } from "./scrub-paths";

describe("scrubHomeDirectory", () => {
  it("rewrites the home directory in nested stack frames and messages", () => {
    const event = {
      message: "ENOENT: no such file, open '/Users/kyan/work/app/.env'",
      exception: {
        values: [
          {
            stacktrace: {
              frames: [{ abs_path: "/Users/kyan/work/app/index.js", lineno: 3 }],
            },
          },
        ],
      },
    };
    const scrubbed = scrubHomeDirectory(event, "/Users/kyan");
    expect(scrubbed.message).toBe("ENOENT: no such file, open '~/work/app/.env'");
    expect(scrubbed.exception.values[0]?.stacktrace.frames[0]).toEqual({
      abs_path: "~/work/app/index.js",
      lineno: 3,
    });
  });

  it("catches Windows paths, their file-URL form and object keys", () => {
    const event = {
      culprit: "C:\\Users\\Kyan Tran\\repo\\main.js",
      request: { url: "file:///C:/Users/Kyan%20Tran/repo/index.html" },
      extra: { "C:\\Users\\Kyan Tran\\notes.txt": 1 },
    };
    const scrubbed = scrubHomeDirectory(event, "C:\\Users\\Kyan Tran");
    expect(scrubbed.culprit).toBe("~\\repo\\main.js");
    expect(scrubbed.request.url).toBe("file:///~/repo/index.html");
    expect(Object.keys(scrubbed.extra)).toEqual(["~\\notes.txt"]);
  });

  it("never modifies the event it was given", () => {
    const event = { frames: [{ abs_path: "/Users/kyan/a.js" }] };
    const snapshot = structuredClone(event);
    scrubHomeDirectory(event, "/Users/kyan");
    expect(event).toEqual(snapshot);
  });

  it("leaves non-string values and events without a home directory alone", () => {
    const event = { level: "error", count: 2, handled: false, data: null };
    expect(scrubHomeDirectory(event, "/Users/kyan")).toEqual(event);
    expect(scrubHomeDirectory(event, "")).toBe(event);
  });
});

describe("homeDirectoryVariants", () => {
  it("orders spellings longest first so a longer one is never half-replaced", () => {
    const variants = homeDirectoryVariants("C:\\Users\\Kyan Tran");
    expect(variants).toEqual([
      "C:/Users/Kyan%20Tran",
      "C:\\Users\\Kyan Tran",
      "C:/Users/Kyan Tran",
    ]);
  });
});
