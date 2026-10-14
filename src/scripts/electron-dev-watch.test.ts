import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createReloader, stopChild } from "./electron-dev-watch.mjs";

afterEach(() => vi.useRealTimers());

function setup() {
  vi.useFakeTimers();
  const launch = vi.fn(() => ({ id: launch.mock.calls.length }));
  const stop = vi.fn(async () => {});
  const onError = vi.fn();
  const reloader = createReloader({ launch, stop, onError, delay: 20 });
  return { launch, stop, onError, reloader };
}

describe("Electron dev relaunch coordination", () => {
  it("coalesces rapid successful builds into one launch", async () => {
    const f = setup();
    f.reloader.accept(true);
    f.reloader.invalidate();
    f.reloader.accept(true);
    await vi.advanceTimersByTimeAsync(30);
    expect(f.launch).toHaveBeenCalledTimes(1);
    await f.reloader.close();
  });

  it("keeps the old app on invalid builds and ignores unchanged output", async () => {
    const f = setup();
    f.reloader.accept(true);
    await vi.advanceTimersByTimeAsync(30);
    f.reloader.invalidate();
    await vi.advanceTimersByTimeAsync(30);
    expect(f.stop).not.toHaveBeenCalled();
    f.reloader.accept(false);
    await vi.advanceTimersByTimeAsync(30);
    expect(f.launch).toHaveBeenCalledTimes(1);
    await f.reloader.close();
  });

  it("waits for old-process exit and never launches a superseded build", async () => {
    const f = setup();
    f.reloader.accept(true);
    await vi.advanceTimersByTimeAsync(30);
    let exited!: () => void;
    f.stop.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          exited = resolve;
        }),
    );
    f.reloader.accept(true);
    await vi.advanceTimersByTimeAsync(30);
    expect(f.launch).toHaveBeenCalledTimes(1);
    f.reloader.invalidate();
    exited();
    await vi.advanceTimersByTimeAsync(30);
    expect(f.launch).toHaveBeenCalledTimes(1);
    f.reloader.accept(true);
    await vi.advanceTimersByTimeAsync(30);
    expect(f.launch).toHaveBeenCalledTimes(2);
    await f.reloader.close();
  });

  it("cancels pending relaunches on shutdown", async () => {
    const f = setup();
    f.reloader.accept(true);
    await f.reloader.close();
    await vi.advanceTimersByTimeAsync(30);
    expect(f.launch).not.toHaveBeenCalled();
  });

  it("does not let an asset update launch an invalid main build", async () => {
    const f = setup();
    f.reloader.accept(true);
    await vi.advanceTimersByTimeAsync(30);
    f.reloader.invalidate();
    f.reloader.requestRestart();
    await vi.advanceTimersByTimeAsync(30);
    expect(f.launch).toHaveBeenCalledTimes(1);
    f.reloader.accept(false);
    await vi.advanceTimersByTimeAsync(30);
    expect(f.launch).toHaveBeenCalledTimes(2);
    await f.reloader.close();
  });

  it("waits for an exit event rather than treating kill as completion", async () => {
    const child = Object.assign(new EventEmitter(), {
      exitCode: null,
      signalCode: null,
      kill: vi.fn(),
    });
    const stopped = vi.fn();
    const pending = stopChild(child).then(stopped);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    await Promise.resolve();
    expect(stopped).not.toHaveBeenCalled();
    child.emit("exit", 0, null);
    await pending;
    expect(stopped).toHaveBeenCalledOnce();
  });
});
