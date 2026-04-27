import { afterEach, describe, expect, it, vi } from "vitest";

const launchOptionsMock = vi.hoisted(() => vi.fn());
const virtualDisplayGetMock = vi.hoisted(() => vi.fn());
const virtualDisplayKillMock = vi.hoisted(() => vi.fn());
const launchMock = vi.hoisted(() => vi.fn());
const launchPersistentContextMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());
const proxyAgentMock = vi.hoisted(() => vi.fn());
const generateContextFingerprintMock = vi.hoisted(() => vi.fn());

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

vi.mock("undici", () => ({
  fetch: fetchMock,
  ProxyAgent: proxyAgentMock,
}));

vi.mock("../src/lib/fingerprints", () => ({
  generateContextFingerprint: generateContextFingerprintMock,
}));

import { AsyncNewBrowser, AsyncNewContext } from "../src/lib/async_api";

afterEach(() => {
  launchOptionsMock.mockReset();
  virtualDisplayGetMock.mockReset();
  virtualDisplayKillMock.mockReset();
  launchMock.mockReset();
  launchPersistentContextMock.mockReset();
  fetchMock.mockReset();
  proxyAgentMock.mockReset();
  generateContextFingerprintMock.mockReset();
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

describe("AsyncNewContext", () => {
  it("preserves an explicit timezone over proxy-derived geo fallback", async () => {
    const context = {
      addInitScript: vi.fn().mockResolvedValue(undefined),
    };
    const browser = {
      newContext: vi.fn().mockResolvedValue(context),
    } as any;

    proxyAgentMock.mockReturnValue({});
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        query: "203.0.113.9",
        timezone: "America/New_York",
      }),
    });
    generateContextFingerprintMock.mockReturnValue({
      initScript: "/* init */",
      contextOptions: {
        timezoneId: "Europe/London",
        userAgent: "Mozilla/5.0",
      },
    });

    await AsyncNewContext(browser, {
      proxy: { server: "http://proxy.example:8080" },
      timezone: "Europe/London",
    });

    expect(generateContextFingerprintMock).toHaveBeenCalledWith({
      preset: undefined,
      os: undefined,
      ffVersion: undefined,
      webrtcIp: "203.0.113.9",
      timezone: "Europe/London",
      locale: undefined,
    });
    expect(browser.newContext).toHaveBeenCalledWith({
      timezoneId: "Europe/London",
      userAgent: "Mozilla/5.0",
      proxy: { server: "http://proxy.example:8080" },
    });
    expect(context.addInitScript).toHaveBeenCalledWith("/* init */");
  });
});
