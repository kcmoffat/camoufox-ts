import { afterEach, describe, expect, it, vi } from "vitest";

const launchOptionsMock = vi.hoisted(() => vi.fn());
const virtualDisplayGetMock = vi.hoisted(() => vi.fn());
const virtualDisplayKillMock = vi.hoisted(() => vi.fn());
const launchMock = vi.hoisted(() => vi.fn());
const launchPersistentContextMock = vi.hoisted(() => vi.fn());

vi.mock("../src/lib/utils", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/utils")>("../src/lib/utils");
  return {
    ...actual,
    launchOptions: launchOptionsMock,
  };
});

vi.mock("../src/lib/virtdisplay", () => ({
  VirtualDisplay: class {
    get = virtualDisplayGetMock;
    kill = virtualDisplayKillMock;
  },
}));

vi.mock("playwright", () => ({
  firefox: {
    launch: launchMock,
    launchPersistentContext: launchPersistentContextMock,
  },
}));

import { AsyncNewBrowser } from "../src/lib/async_api";

afterEach(() => {
  launchOptionsMock.mockReset();
  virtualDisplayGetMock.mockReset();
  virtualDisplayKillMock.mockReset();
  launchMock.mockReset();
  launchPersistentContextMock.mockReset();
});

describe("AsyncNewBrowser", () => {
  it("supports headless virtual mode in the typed API surface", async () => {
    const browser = { close: vi.fn().mockResolvedValue(undefined) };
    virtualDisplayGetMock.mockReturnValue(":99");
    launchOptionsMock.mockResolvedValue({ headless: false, env: {} });
    launchMock.mockResolvedValue(browser);

    const result = await AsyncNewBrowser({ headless: "virtual", debug: true });

    expect(launchOptionsMock).toHaveBeenCalledWith({
      headless: false,
      debug: true,
      virtualDisplay: ":99",
    });
    expect(launchMock).toHaveBeenCalledWith({ headless: false, env: {} });
    expect(result).toBe(browser);
  });
});
