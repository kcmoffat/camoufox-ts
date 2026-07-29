import { describe, expect, it } from "vitest";

import { resolveFetchTarget } from "../src/lib/__main__";
import {
  clampWindowDimensions,
  fixNavigatorArch,
  fixScreenNoTaskbar,
  fromBrowserforge,
  generateContextFingerprint,
  generateFingerprint,
  generateRandomVoiceSubset,
  getRandomPreset,
  loadPresets,
  normalizePresetVoices,
  setMediaDevicesDefaults,
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

  it("applies config overrides to init-script setters and viewport options", () => {
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
        webgl: {
          unmaskedVendor: "Intel Inc.",
          unmaskedRenderer: "Intel Iris OpenGL Engine",
        },
      },
      configOverrides: {
        "navigator.userAgent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
        "navigator.platform": "Win32",
        "navigator.hardwareConcurrency": 16,
        "screen.width": 1280,
        "screen.height": 720,
        "screen.colorDepth": 30,
        "webGl:vendor": "Override Vendor",
        "webGl:renderer": "Override Renderer",
      },
    });

    expect(generated.contextOptions.userAgent).toContain("Windows NT 10.0");
    expect(generated.contextOptions.viewport).toEqual({
      width: 1280,
      height: 692,
    });
    expect(generated.initScript).toContain('w.setNavigatorPlatform("Win32")');
    expect(generated.initScript).toContain("w.setNavigatorHardwareConcurrency(16)");
    expect(generated.initScript).toContain('w.setWebGLVendor("Override Vendor")');
    expect(generated.initScript).toContain('w.setWebGLRenderer("Override Renderer")');
    expect(generated.initScript).toContain("w.setScreenDimensions(1280, 720)");
    expect(generated.initScript).toContain("w.setScreenColorDepth(30)");
  });

  it("loads bundled real presets", () => {
    const preset = getRandomPreset("linux");
    expect(preset).toBeTruthy();
    expect(preset?.navigator?.userAgent).toContain("Firefox");
  });

  it("builds non-empty voice objects for every spoofed OS", () => {
    for (const targetOs of ["macos", "windows", "linux"]) {
      const voices = generateRandomVoiceSubset(targetOs, "en-US");
      expect(voices.length).toBeGreaterThan(0);
      expect(voices[0]).toEqual(
        expect.objectContaining({
          name: expect.any(String),
          lang: expect.any(String),
          voiceUri: expect.any(String),
          isDefault: expect.any(Boolean),
          isLocalService: expect.any(Boolean),
        }),
      );
      expect(voices.filter((voice) => voice.isDefault)).toHaveLength(1);
    }
  });

  it("escapes Linux speech-dispatcher voice URIs like Firefox", () => {
    const voices = generateRandomVoiceSubset("linux", "en-GB");
    const voice = voices.find((entry) => entry.name === "English (Great Britain)");

    expect(voice?.voiceUri).toBe("urn:moz-tts:speechd:English%20(Great%20Britain)?en-GB");
    expect(voice?.isDefault).toBe(true);
  });

  it("normalizes preset voice strings into MaskConfig voice objects", () => {
    const voices = normalizePresetVoices(["Albert:en-US:local", "Alice:it-IT:local"], "macos");

    expect(voices[0]).toEqual(
      expect.objectContaining({
        name: "Albert",
        lang: "en-US",
        voiceUri: "urn:moz-tts:osx:albert",
        isDefault: true,
        isLocalService: true,
      }),
    );
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

  it("resolves pinned versions from python-style pinned_sha configs", () => {
    const resolved = resolveFetchTarget(
      {},
      {
        channel: "official/stable",
        pinned: "135.0.1-beta.24",
        pinned_sha: "aaaaaaaa11111111",
      },
    );

    expect(resolved).toEqual({
      repoName: "official",
      verString: "135.0.1-beta.24",
      sha256: "aaaaaaaa11111111",
    });
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

  it("resolves explicit sha-qualified fetch targets to the requested asset", () => {
    const resolved = resolveFetchTarget(
      {
        repos: [
          {
            name: "Official",
            versions: [
              {
                version: "135.0.1",
                build: "beta.24",
                is_prerelease: false,
                sha256: "bbbbbbbb22222222",
              },
              {
                version: "135.0.1",
                build: "beta.24",
                is_prerelease: false,
                sha256: "aaaaaaaa11111111",
              },
            ],
          },
        ],
      },
      {},
      "official/stable/135.0.1-beta.24-aaaaaaaa",
    );

    expect(resolved.repoName).toBe("official");
    expect(resolved.verString).toBe("135.0.1-beta.24");
    expect(resolved.sha256).toBe("aaaaaaaa11111111");
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

  it("corrects BrowserForge navigator arch mismatches on Linux", () => {
    const config = {
      "navigator.userAgent": "Mozilla/5.0 (X11; Linux x86_64; rv:135.0) Gecko/20100101 Firefox/135.0",
      "navigator.platform": "Linux armv81",
      "navigator.oscpu": "Linux armv81",
    };

    fixNavigatorArch(config, "lin");

    expect(config["navigator.platform"]).toBe("Linux x86_64");
    expect(config["navigator.oscpu"]).toBe("Linux x86_64");
  });

  it("fixes screen/taskbar and impossible window geometry", () => {
    const config = {
      "screen.width": 1920,
      "screen.height": 1080,
      "screen.availWidth": 1920,
      "screen.availHeight": 1080,
      "window.outerWidth": 2200,
      "window.innerWidth": 2100,
      "window.outerHeight": 1080,
      "window.innerHeight": 1040,
    };

    fixScreenNoTaskbar(config, "lin");
    clampWindowDimensions(config);

    expect(config["screen.availHeight"]).toBe(1053);
    expect(config["window.outerWidth"]).toBe(1920);
    expect(config["window.innerWidth"]).toBeLessThanOrEqual(config["window.outerWidth"]);
    expect(config["window.outerHeight"]).toBe(1053);
    expect(config["window.innerHeight"]).toBe(1013);
  });

  it("defaults headless media devices to one mic and one camera", () => {
    const config: Record<string, any> = {};

    setMediaDevicesDefaults(config);

    expect(config).toMatchObject({
      "mediaDevices:enabled": true,
      "mediaDevices:micros": 1,
      "mediaDevices:webcams": 1,
      "mediaDevices:speakers": 0,
    });
  });
});
