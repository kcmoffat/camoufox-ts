import { describe, expect, it, vi } from "vitest";

import * as asyncApi from "../src/lib/async_api";
import { generateContextFingerprint } from "../src/lib/fingerprints";
import { Version } from "../src/lib/pkgman";
import {
  Camoufox,
  NewBrowser,
  NewContext,
} from "../src/lib/sync_api";
import { launchOptions, launch_options } from "../src/lib/utils";
import {
  InstalledVersion,
  installedVersionMatchesSpecifier,
} from "../src/lib/multiversion";

describe("sync_api", () => {
  it("exposes dedicated wrappers instead of aliasing async exports directly", () => {
    expect(NewBrowser).not.toBe(asyncApi.AsyncNewBrowser);
    expect(NewContext).not.toBe(asyncApi.AsyncNewContext);
    expect(Camoufox).not.toBe(asyncApi.AsyncCamoufox);
  });

  it("routes browser startup through the sync surface", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const browser = { close } as any;
    const newBrowserSpy = vi
      .spyOn(asyncApi, "AsyncNewBrowser")
      .mockResolvedValue(browser);

    const session = new Camoufox({ headless: true });
    const entered = await session.enter();
    expect(entered).toBe(browser);
    expect(newBrowserSpy).toHaveBeenCalledWith({ headless: true });

    await session.close();
    expect(close).toHaveBeenCalledTimes(1);

    newBrowserSpy.mockRestore();
  });
});

describe("multiversion", () => {
  it("matches repo/full-version shorthand when resolving installed browsers", () => {
    const version = new InstalledVersion({
      repoName: "official",
      version: new Version("beta.20", "134.0.2"),
      path: "/tmp/camoufox-test",
    });

    expect(installedVersionMatchesSpecifier("official/134.0.2-beta.20", version)).toBe(true);
    expect(installedVersionMatchesSpecifier("134.0.2-beta.20", version)).toBe(true);
    expect(installedVersionMatchesSpecifier("official/beta.20", version)).toBe(true);
    expect(installedVersionMatchesSpecifier("other/134.0.2-beta.20", version)).toBe(false);
  });
});

describe("ported upstream helpers", () => {
  it("exports launch_options as an alias of launchOptions", () => {
    expect(launch_options).toBe(launchOptions);
  });

  it("falls back to the runtime timezone expression when no preset timezone exists", () => {
    const { initScript } = generateContextFingerprint({
      preset: {
        navigator: {
          userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:135.0) Gecko/20100101 Firefox/135.0",
          platform: "MacIntel",
          hardwareConcurrency: 8,
        },
        screen: {
          width: 1440,
          height: 900,
          colorDepth: 24,
        },
        webgl: {
          unmaskedVendor: "Intel Inc.",
          unmaskedRenderer: "Intel Iris OpenGL Engine",
        },
      },
    });
    expect(initScript).toContain(
      'w.setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);',
    );
    expect(initScript).not.toContain('"Intl.DateTimeFormat().resolvedOptions().timeZone"');
  });
});
