import os from "node:os";
import path from "node:path";

import { Browser, BrowserContext, firefox, type LaunchOptions } from "playwright";
import { ProxyAgent, fetch as undiciFetch } from "undici";

import { generateContextFingerprint } from "./fingerprints";
import { launchOptions, attachVirtualDisplay } from "./utils";
import { VirtualDisplay } from "./virtdisplay";

export type CamoufoxBrowser = Browser | BrowserContext;

export class AsyncCamoufox {
  private readonly options: Record<string, any>;
  browser?: CamoufoxBrowser;

  constructor(options: Record<string, any> = {}) {
    this.options = options;
  }

  async enter(): Promise<CamoufoxBrowser> {
    this.browser = await AsyncNewBrowser(this.options);
    return this.browser;
  }

  async close(): Promise<void> {
    await this.browser?.close();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

export async function AsyncNewBrowser(input: Record<string, any> = {}): Promise<CamoufoxBrowser> {
  const {
    headless,
    fromOptions,
    persistentContext = false,
    debug,
    userDataDir,
    ...kwargs
  } = input;

  let virtualDisplay: VirtualDisplay | undefined;
  let nextHeadless = headless;
  if (headless === "virtual") {
    virtualDisplay = new VirtualDisplay(debug);
    kwargs.virtualDisplay = virtualDisplay.get();
    nextHeadless = false;
  }

  const resolvedOptions =
    fromOptions ?? (await launchOptions({ headless: nextHeadless, debug, ...kwargs }));

  if (persistentContext) {
    const context = await firefox.launchPersistentContext(
      userDataDir ?? path.join(os.tmpdir(), "camoufox-persistent-context"),
      resolvedOptions,
    );
    return attachVirtualDisplay(context, virtualDisplay);
  }

  const browser = await firefox.launch(resolvedOptions as LaunchOptions);
  return attachVirtualDisplay(browser, virtualDisplay);
}

function proxyUrlWithCreds(proxy: Record<string, string>): string {
  const server = new URL(proxy.server);
  if (proxy.username && proxy.password) {
    server.username = proxy.username;
    server.password = proxy.password;
  }
  return server.toString();
}

async function resolveProxyGeo(proxy: Record<string, string>): Promise<{
  ip?: string;
  timezone?: string;
}> {
  try {
    const response = await undiciFetch("http://ip-api.com/json?fields=query,timezone", {
      dispatcher: new ProxyAgent(proxyUrlWithCreds(proxy)),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = (await response.json()) as Record<string, string>;
    return {
      ip: data.query ?? undefined,
      timezone: data.timezone ?? undefined,
    };
  } catch {
    return {};
  }
}

export async function AsyncNewContext(
  browser: Browser,
  input: {
    preset?: Record<string, any>;
    os?: string | string[];
    ffVersion?: string;
    webrtcIp?: string;
    timezone?: string;
    locale?: string;
    proxy?: Record<string, string>;
    geolocation?: { latitude: number; longitude: number };
    [key: string]: any;
  } = {},
): Promise<BrowserContext> {
  const {
    preset,
    os,
    ffVersion,
    webrtcIp,
    timezone,
    locale,
    proxy,
    geolocation,
    ...contextOptions
  } = input;

  let resolvedWebrtcIp = webrtcIp;
  if (proxy && (!resolvedWebrtcIp || (timezone == null && !("timezoneId" in contextOptions)))) {
    const geo = await resolveProxyGeo(proxy);
    resolvedWebrtcIp ??= geo.ip;
    if (timezone == null && !("timezoneId" in contextOptions) && geo.timezone) {
      contextOptions.timezoneId = geo.timezone;
    }
  }

  const fingerprint = generateContextFingerprint({
    preset,
    os,
    ffVersion,
    webrtcIp: resolvedWebrtcIp,
    timezone,
    locale,
  });

  const options = {
    ...fingerprint.contextOptions,
    ...contextOptions,
  } as Record<string, any>;

  if (proxy) {
    options.proxy = proxy;
  }
  if (geolocation) {
    options.geolocation = geolocation;
    options.permissions ??= ["geolocation"];
  }

  const context = await browser.newContext(options);
  await context.addInitScript(fingerprint.initScript);
  return context;
}
