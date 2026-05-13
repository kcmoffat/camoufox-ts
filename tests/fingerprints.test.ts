import { describe, expect, it } from "vitest";

import { resolveFetchTarget } from "../src/lib/__main__";
import {
  fromBrowserforge,
  generateContextFingerprint,
  generateFingerprint,
  getRandomPreset,
  loadPresets,
} from "../src/lib/fingerprints";

describe("fingerprints", () => {
  it("generates a Firefox fingerprint and translates it to Camoufox config", () => {
    const fingerprint = generateFingerprint({ os: "windows" });
    const config = fromBrowserforge(fingerprint, "140");
    expect(config["navigator.userAgent"]).toContain("Firefox/140.0");
    expect(config["navigator.platform"]).toBe("Win32");
    expect(config["screen.width"]).toBeGreaterThan(0);
  });

  it("builds a per-context init script and context options", () => {
    const generated = generateContextFingerprint({ os: "windows", ffVersion: "140" });
    expect(generated.initScript).toContain("setNavigatorUserAgent");
    expect(generated.contextOptions.userAgent).toContain("Firefox/140.0");
    expect(generated.config["fonts:spacing_seed"]).toBeGreaterThan(0);
  });

  it("derives the WebGL OS when no per-context os is supplied", () => {
    const generated = generateContextFingerprint({});

    expect(generated.contextOptions.userAgent).toContain("Firefox/");
    expect(generated.config["webGl:vendor"]).toBeTruthy();
    expect(generated.config["webGl:renderer"]).toBeTruthy();
  });

  it("accepts explicit timezone and locale for per-context fingerprints", () => {
    const generated = generateContextFingerprint({
      os: "windows",
      ffVersion: "140",
      timezone: "Europe/London",
      locale: "en-GB",
    });

    expect(generated.initScript).toContain('w.setTimezone("Europe/London")');
    expect(generated.contextOptions.timezoneId).toBe("Europe/London");
    expect(generated.contextOptions.locale).toBe("en-GB");
    expect(generated.config["locale:region"]).toBe("GB");
    expect(generated.config["navigator.language"]).toBe("en-GB");
  });

  it("prefers explicit timezone over preset timezone in per-context init scripts", () => {
    const generated = generateContextFingerprint({
      preset: {
        navigator: {
          userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0",
          platform: "MacIntel",
          hardwareConcurrency: 8,
        },
        screen: {
          width: 1440,
          height: 900,
          colorDepth: 24,
        },
        timezone: "America/New_York",
        webgl: {
          unmaskedVendor: "Intel Inc.",
          unmaskedRenderer: "Intel Iris OpenGL Engine",
        },
      },
      ffVersion: "140",
      timezone: "Europe/London",
    });

    expect(generated.contextOptions.timezoneId).toBe("Europe/London");
    expect(generated.initScript).toContain('w.setTimezone("Europe/London")');
    expect(generated.initScript).not.toContain('w.setTimezone("America/New_York")');
  });

  it("applies config overrides before rendering the init script", () => {
    const generated = generateContextFingerprint({
      os: "windows",
      ffVersion: "140",
      timezone: "Europe/London",
      locale: "en-GB",
      configOverrides: {
        "fonts:spacing_seed": 0,
        timezone: "America/Los_Angeles",
        "navigator.language": "fr-CA",
      },
    });

    expect(generated.config["fonts:spacing_seed"]).toBe(0);
    expect(generated.config.timezone).toBe("America/Los_Angeles");
    expect(generated.contextOptions.timezoneId).toBe("America/Los_Angeles");
    expect(generated.contextOptions.locale).toBe("fr-CA");
    expect(generated.initScript).toContain('w.setTimezone("America/Los_Angeles")');
  });

  it("loads bundled real presets", () => {
    const preset = getRandomPreset("linux");
    expect(preset).toBeTruthy();
    expect(preset?.navigator?.userAgent).toContain("Firefox");
  });

  it("uses the v150 preset bundle for Firefox 149 and newer", () => {
    const legacyPresets = loadPresets("148");
    const v150Presets = loadPresets("149");

    expect(legacyPresets?.presets?.linux).toHaveLength(18);
    expect(v150Presets?.presets?.linux).toHaveLength(65);
    expect(getRandomPreset("linux", "149")).toBeTruthy();
  });

  it("keeps the v150 preset bundle aligned with upstream coverage", () => {
    const v150Presets = loadPresets("149");
    const allPresets = Object.values(v150Presets?.presets ?? {}).flat() as Array<Record<string, any>>;
    const versions = Array.from(
      new Set(
        allPresets
          .map((preset) => preset.navigator?.userAgent?.match(/Firefox\/(\d+\.0)/)?.[1])
          .filter(Boolean),
      ),
    ).sort();

    expect(v150Presets?.presets?.macos).toHaveLength(67);
    expect(v150Presets?.presets?.windows).toHaveLength(180);
    expect(v150Presets?.presets?.linux).toHaveLength(65);
    expect(versions).toEqual(["149.0", "150.0", "151.0", "152.0"]);
  });

  it("reports when a followed channel has no synced versions", () => {
    const resolved = resolveFetchTarget(
      {
        repos: [
          {
            name: "Official",
            versions: [],
          },
        ],
      },
      {
        channel: "official/stable",
      },
    );

    expect(resolved.repoName).toBe("official");
    expect(resolved.verString).toBeUndefined();
    expect(resolved.missingChannel).toBe("official/stable");
  });

  it("resolves explicit repo/channel fetch targets to the latest synced build", () => {
    const resolved = resolveFetchTarget(
      {
        repos: [
          {
            name: "Official",
            versions: [
              { version: "135.0.1", build: "beta.25", is_prerelease: true },
              { version: "135.0.1", build: "beta.24", is_prerelease: false },
            ],
          },
        ],
      },
      {},
      "official/stable",
    );

    expect(resolved.repoName).toBe("official");
    expect(resolved.verString).toBe("135.0.1-beta.24");
    expect(resolved.missingChannel).toBeUndefined();
  });

  it("reports when an explicit repo/channel fetch target has no synced builds", () => {
    const resolved = resolveFetchTarget(
      {
        repos: [
          {
            name: "Official",
            versions: [{ version: "135.0.1", build: "beta.25", is_prerelease: true }],
          },
        ],
      },
      {},
      "official/stable",
    );

    expect(resolved.repoName).toBe("official");
    expect(resolved.verString).toBeUndefined();
    expect(resolved.missingChannel).toBe("official/stable");
  });
});
