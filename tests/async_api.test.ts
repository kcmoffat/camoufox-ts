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

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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

  it("accepts python-style snake_case browser kwargs", async () => {
    const context = { close: vi.fn().mockResolvedValue(undefined) };
    launchPersistentContextMock.mockResolvedValue(context);

    const result = await AsyncNewBrowser({
      from_options: { headless: true },
      persistent_context: true,
      user_data_dir: "/tmp/camoufox-profile",
    });

    expect(launchOptionsMock).not.toHaveBeenCalled();
    expect(launchPersistentContextMock).toHaveBeenCalledWith(
      "/tmp/camoufox-profile",
      { headless: true },
    );
    expect(result).toBe(context);
  });

  it("serializes concurrent newPage calls across wrapped contexts", async () => {
    const firstPage = deferred<string>();
    const newPageSpy = vi
      .fn()
      .mockImplementationOnce(async () => firstPage.promise)
      .mockResolvedValueOnce("page-2");
    const context = {
      close: vi.fn().mockResolvedValue(undefined),
      newPage: newPageSpy,
    };
    const browser = {
      close: vi.fn().mockResolvedValue(undefined),
      newContext: vi.fn().mockResolvedValue(context),
    };
    launchOptionsMock.mockResolvedValue({ headless: true });
    launchMock.mockResolvedValue(browser);

    const wrappedBrowser = (await AsyncNewBrowser({ headless: true })) as any;
    const wrappedContext = await wrappedBrowser.newContext();
    const pendingFirst = wrappedContext.newPage();
    const pendingSecond = wrappedContext.newPage();

    await Promise.resolve();
    await Promise.resolve();

    expect(newPageSpy).toHaveBeenCalledTimes(1);

    firstPage.resolve("page-1");

    await expect(pendingFirst).resolves.toBe("page-1");
    await expect(pendingSecond).resolves.toBe("page-2");
    expect(newPageSpy).toHaveBeenCalledTimes(2);
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

  it("accepts python-style snake_case context kwargs", async () => {
    const context = {
      addInitScript: vi.fn().mockResolvedValue(undefined),
    };
    const browser = {
      newContext: vi.fn().mockResolvedValue(context),
    } as any;

    generateContextFingerprintMock.mockReturnValue({
      initScript: "/* init */",
      contextOptions: {
        userAgent: "Mozilla/5.0",
      },
    });

    await AsyncNewContext(browser, {
      ff_version: "140",
      webrtc_ip: "203.0.113.9",
      proxy: { server: "http://proxy.example:8080" },
      extra_http_headers: { "x-test": "1" },
    });

    expect(generateContextFingerprintMock).toHaveBeenCalledWith({
      preset: undefined,
      os: undefined,
      ffVersion: "140",
      webrtcIp: "203.0.113.9",
      timezone: undefined,
      locale: undefined,
    });
    expect(browser.newContext).toHaveBeenCalledWith({
      userAgent: "Mozilla/5.0",
      proxy: { server: "http://proxy.example:8080" },
      extraHttpHeaders: { "x-test": "1" },
    });
  });

  it("passes config overrides into fingerprint generation without leaking them to Playwright", async () => {
    const context = {
      addInitScript: vi.fn().mockResolvedValue(undefined),
    };
    const browser = {
      newContext: vi.fn().mockResolvedValue(context),
    } as any;

    generateContextFingerprintMock.mockReturnValue({
      initScript: "/* init */",
      contextOptions: {
        userAgent: "Mozilla/5.0",
      },
    });

    await AsyncNewContext(browser, {
      config_overrides: {
        "fonts:spacing_seed": 0,
      },
      color_scheme: "dark",
    });

    expect(generateContextFingerprintMock).toHaveBeenCalledWith({
      preset: undefined,
      os: undefined,
      ffVersion: undefined,
      webrtcIp: undefined,
      timezone: undefined,
      locale: undefined,
      configOverrides: {
        "fonts:spacing_seed": 0,
      },
    });
    expect(browser.newContext).toHaveBeenCalledWith({
      userAgent: "Mozilla/5.0",
      colorScheme: "dark",
    });
  });
});
