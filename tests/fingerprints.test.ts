import { describe, expect, it } from "vitest";

import {
  fromBrowserforge,
  generateContextFingerprint,
  generateFingerprint,
  getRandomPreset,
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

  it("loads bundled real presets", () => {
    const preset = getRandomPreset("linux");
    expect(preset).toBeTruthy();
    expect(preset?.navigator?.userAgent).toContain("Firefox");
  });
});
