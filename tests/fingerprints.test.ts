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

  it("loads bundled real presets", () => {
    const preset = getRandomPreset("linux");
    expect(preset).toBeTruthy();
    expect(preset?.navigator?.userAgent).toContain("Firefox");
  });
});
