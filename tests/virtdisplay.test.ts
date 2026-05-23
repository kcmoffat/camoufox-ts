import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

const whichSyncMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("which", () => ({
  default: {
    sync: whichSyncMock,
  },
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    spawn: spawnMock,
  };
});

vi.mock("../src/lib/pkgman", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/pkgman")>("../src/lib/pkgman");
  return {
    ...actual,
    OS_NAME: "lin",
  };
});

import { CannotExecuteXvfb } from "../src/lib/exceptions";
import { VirtualDisplay } from "../src/lib/virtdisplay";

function createChild() {
  const pipe = new PassThrough();
  const child = {
    stdio: [null, null, null, pipe],
    exitCode: null,
    killed: false,
    unref: vi.fn(),
    kill: vi.fn(() => {
      child.killed = true;
      child.exitCode ??= 0;
      pipe.end();
      return true;
    }),
  } as any;
  return { child, pipe };
}

afterEach(() => {
  whichSyncMock.mockReset();
  spawnMock.mockReset();
  vi.useRealTimers();
});

describe("VirtualDisplay", () => {
  it("uses Xvfb displayfd output to claim a display atomically", async () => {
    const { child, pipe } = createChild();
    const xvfbPath = process.execPath;

    whichSyncMock.mockReturnValue(xvfbPath);
    spawnMock.mockReturnValue(child);

    const displayPromise = new VirtualDisplay().get();
    pipe.write("117\n");
    pipe.end();

    await expect(displayPromise).resolves.toBe(":117");
    expect(spawnMock).toHaveBeenCalledWith(
      xvfbPath,
      ["-displayfd", "3", ...VirtualDisplay.xvfbArgs],
      expect.objectContaining({
        detached: true,
        stdio: ["ignore", "ignore", "ignore", "pipe"],
        env: expect.objectContaining({
          __GLX_VENDOR_LIBRARY_NAME: "mesa",
          LIBGL_ALWAYS_SOFTWARE: "1",
        }),
      }),
    );
    expect(child.unref).toHaveBeenCalledOnce();
  });

  it("returns the same display on repeated get calls after startup completes", async () => {
    const { child, pipe } = createChild();

    whichSyncMock.mockReturnValue(process.execPath);
    spawnMock.mockReturnValue(child);

    const display = new VirtualDisplay();
    const first = display.get();
    pipe.end("204\n");

    await expect(first).resolves.toBe(":204");
    await expect(display.get()).resolves.toBe(":204");
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("reuses one in-flight startup when get is called concurrently", async () => {
    const { child, pipe } = createChild();

    whichSyncMock.mockReturnValue(process.execPath);
    spawnMock.mockReturnValue(child);

    const display = new VirtualDisplay();
    const first = display.get();
    const second = display.get();
    pipe.end("204\n");

    await expect(Promise.all([first, second])).resolves.toEqual([":204", ":204"]);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("kills Xvfb when it exits before reporting a display", async () => {
    const { child, pipe } = createChild();

    whichSyncMock.mockReturnValue(process.execPath);
    spawnMock.mockReturnValue(child);

    const displayPromise = new VirtualDisplay().get();
    child.exitCode = 1;
    pipe.end();

    await expect(displayPromise).rejects.toThrow(
      new CannotExecuteXvfb("Xvfb did not report a display (got \"\", exit=1)"),
    );
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("starts a fresh Xvfb process for a new virtual display after the prior one is killed", async () => {
    const firstChild = createChild();
    const secondChild = createChild();

    whichSyncMock.mockReturnValue(process.execPath);
    spawnMock.mockReturnValueOnce(firstChild.child).mockReturnValueOnce(secondChild.child);

    const firstDisplay = new VirtualDisplay();
    const firstGet = firstDisplay.get();
    firstChild.pipe.end("117\n");

    await expect(firstGet).resolves.toBe(":117");

    firstDisplay.kill();
    expect(firstChild.child.kill).toHaveBeenCalledOnce();

    const secondGet = new VirtualDisplay().get();
    secondChild.pipe.end("118\n");

    await expect(secondGet).resolves.toBe(":118");
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });
});
