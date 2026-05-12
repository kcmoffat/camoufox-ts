import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DefaultAddons } from "../src/lib/addons";
import * as fingerprints from "../src/lib/fingerprints";

const mocks = vi.hoisted(() => ({
  camoufoxPath: vi.fn<() => Promise<string>>(),
  getPath: vi.fn<(file: string) => Promise<string>>(),
  installedVerstr: vi.fn(() => {
    throw new Error("installedVerstr should not be used during launch option resolution");
  }),
  launchPath: vi.fn<(browserPath?: string) => Promise<string>>(),
}));

vi.mock("../src/lib/pkgman", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/pkgman")>("../src/lib/pkgman");
  return {
    ...actual,
    camoufoxPath: mocks.camoufoxPath,
    getPath: mocks.getPath,
    installedVerstr: mocks.installedVerstr,
    launchPath: mocks.launchPath,
  };
});

import {
  determineUaOs,
  generateRuntimeFontConfig,
  launchOptions,
  validateConfig,
} from "../src/lib/utils";

const FIREFOX_PRESET = {
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
};

const tempDirs: string[] = [];

async function createBundleDir(): Promise<string> {
  const bundleDir = await fsp.mkdtemp(path.join(os.tmpdir(), "camoufox-bundle-"));
  tempDirs.push(bundleDir);
  await fsp.writeFile(
    path.join(bundleDir, "version.json"),
    JSON.stringify({ version: "135.0.1", build: "beta.20" }),
  );
  await fsp.copyFile(
    path.join(process.cwd(), "src/assets/properties.json"),
    path.join(bundleDir, "properties.json"),
  );
  return bundleDir;
}

function readConfigFromEnv(env: NodeJS.ProcessEnv): Record<string, any> {
  const json = Object.keys(env)
    .filter((key) => key.startsWith("CAMOU_CONFIG_"))
    .sort((left, right) => left.localeCompare(right))
    .map((key) => env[key] ?? "")
    .join("");
  return JSON.parse(json);
}

afterEach(async () => {
  mocks.camoufoxPath.mockReset();
  mocks.getPath.mockReset();
  mocks.installedVerstr.mockClear();
  mocks.launchPath.mockReset();

  while (tempDirs.length > 0) {
    await fsp.rm(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

describe("launchOptions", () => {
  it("classifies macOS Firefox user agents as mac", () => {
    expect(determineUaOs(FIREFOX_PRESET.navigator.userAgent)).toBe("mac");
  });

  it("resolves Firefox version from the bootstrapped bundle on first launch", async () => {
    const bundleDir = await createBundleDir();
    mocks.camoufoxPath.mockResolvedValue(bundleDir);
    mocks.getPath.mockImplementation(async (file: string) => path.join(bundleDir, file));
    mocks.launchPath.mockResolvedValue("/tmp/camoufox-bin");

    const options = await launchOptions({
      fingerprintPreset: FIREFOX_PRESET,
      blockWebgl: true,
      excludeAddons: [DefaultAddons.UBO],
      iKnowWhatImDoing: true,
    });

    expect(options.executablePath).toBe("/tmp/camoufox-bin");
    expect(mocks.camoufoxPath).toHaveBeenCalledTimes(1);
    expect(mocks.launchPath).toHaveBeenCalledTimes(1);
    expect(mocks.installedVerstr).not.toHaveBeenCalled();
  });

  it("uses the supplied executable bundle to derive Firefox version", async () => {
    const bundleDir = await createBundleDir();
    const executablePath = path.join(bundleDir, "camoufox-bin");

    const options = await launchOptions({
      executablePath,
      fingerprintPreset: FIREFOX_PRESET,
      blockWebgl: true,
      excludeAddons: [DefaultAddons.UBO],
      iKnowWhatImDoing: true,
    });

    expect(options.executablePath).toBe(executablePath);
    expect(mocks.camoufoxPath).not.toHaveBeenCalled();
    expect(mocks.launchPath).not.toHaveBeenCalled();
    expect(mocks.installedVerstr).not.toHaveBeenCalled();
  });

  it("generates macOS font markers for macOS fingerprints", async () => {
    const bundleDir = await createBundleDir();
    mocks.camoufoxPath.mockResolvedValue(bundleDir);
    mocks.launchPath.mockResolvedValue("/tmp/camoufox-bin");

    const options = await launchOptions({
      os: "macos",
      blockWebgl: true,
      excludeAddons: [DefaultAddons.UBO],
      iKnowWhatImDoing: true,
    });

    const config = readConfigFromEnv(options.env);
    expect(config["navigator.platform"]).toBe("MacIntel");
    expect(config.fonts).toContain("PingFang HK");
    expect(config.fonts).toContain("PingFang SC");
    expect(config.fonts).toContain("PingFang TC");
  });

  it("warns when overriding the Firefox version without opting out", async () => {
    const bundleDir = await createBundleDir();
    mocks.camoufoxPath.mockResolvedValue(bundleDir);
    mocks.launchPath.mockResolvedValue("/tmp/camoufox-bin");
    const warningSpy = vi.spyOn(process, "emitWarning").mockImplementation(() => process);

    await launchOptions({
      os: "macos",
      ffVersion: "140",
      blockWebgl: true,
      excludeAddons: [DefaultAddons.UBO],
    });

    expect(warningSpy).toHaveBeenCalledWith(
      expect.stringContaining("Spoofing the Firefox version will likely lead to detection."),
      expect.objectContaining({ type: "LeakWarning" }),
    );

    warningSpy.mockRestore();
  });

  it("forces X11 environment vars when launching with a virtual display", async () => {
    const bundleDir = await createBundleDir();
    mocks.camoufoxPath.mockResolvedValue(bundleDir);
    mocks.launchPath.mockResolvedValue("/tmp/camoufox-bin");

    const options = await launchOptions({
      os: "linux",
      blockWebgl: true,
      excludeAddons: [DefaultAddons.UBO],
      iKnowWhatImDoing: true,
      virtualDisplay: ":99",
      env: {
        DISPLAY: ":1",
        GDK_BACKEND: "wayland",
        WAYLAND_DISPLAY: "wayland-0",
        MOZ_ENABLE_WAYLAND: "1",
      },
    });

    expect(options.env.DISPLAY).toBe(":99");
    expect(options.env.GDK_BACKEND).toBe("x11");
    expect(options.env.WAYLAND_DISPLAY).toBeUndefined();
    expect(options.env.MOZ_ENABLE_WAYLAND).toBe("0");
  });

  it("accepts python-style snake_case launch kwargs", async () => {
    const bundleDir = await createBundleDir();
    mocks.camoufoxPath.mockResolvedValue(bundleDir);
    mocks.launchPath.mockResolvedValue("/tmp/camoufox-bin");

    const options = await launchOptions({
      fingerprint_preset: FIREFOX_PRESET,
      block_webgl: true,
      firefox_user_prefs: {
        "network.http.http3.enable": false,
      },
      enable_cache: true,
      i_know_what_im_doing: true,
    });

    expect(options.firefoxUserPrefs["network.http.http3.enable"]).toBe(false);
    expect(options.firefoxUserPrefs["browser.cache.memory.enable"]).toBe(true);
  });

  it("passes the resolved Firefox version into bundled preset selection", async () => {
    const bundleDir = await createBundleDir();
    await fsp.writeFile(
      path.join(bundleDir, "version.json"),
      JSON.stringify({ version: "150.0.2", build: "beta.25" }),
    );
    mocks.camoufoxPath.mockResolvedValue(bundleDir);
    mocks.launchPath.mockResolvedValue("/tmp/camoufox-bin");
    const presetSpy = vi.spyOn(fingerprints, "getRandomPreset");

    await launchOptions({
      os: "linux",
      fingerprintPreset: true,
      blockWebgl: true,
      excludeAddons: [DefaultAddons.UBO],
      iKnowWhatImDoing: true,
    });

    expect(presetSpy).toHaveBeenCalledWith("linux", "150");
    presetSpy.mockRestore();
  });

  it("skips deprecated properties removed upstream", async () => {
    const bundleDir = await createBundleDir();
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(
      validateConfig({ enableRemoteSubframes: true }, path.join(bundleDir, "camoufox-bin")),
    ).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith("Skipping unknown patch enableRemoteSubframes : true");

    consoleSpy.mockRestore();
  });
});

describe("generateRuntimeFontConfig", () => {
  it("rewrites cwd-relative bundled font paths to absolute font paths", async () => {
    const bundleDir = await createBundleDir();
    const fontConfigDir = path.join(bundleDir, "fontconfigs", "linux");
    const fontsDir = path.join(bundleDir, "fonts");
    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(bundleDir);
    await fsp.mkdir(fontConfigDir, { recursive: true });
    await fsp.mkdir(fontsDir, { recursive: true });
    await fsp.writeFile(
      path.join(fontConfigDir, "fonts.conf"),
      '<fontconfig><dir prefix="cwd">fonts</dir></fontconfig>',
    );

    mocks.camoufoxPath.mockResolvedValue(bundleDir);
    mocks.getPath.mockImplementation(async (file: string) => path.join(bundleDir, file));

    const runtimePath = await generateRuntimeFontConfig(fontConfigDir);
    const runtimeContent = await fsp.readFile(runtimePath, "utf8");

    expect(runtimePath).toContain(path.join(".cache", "camoufox", "fontconfig", "fonts-"));
    expect(runtimeContent).toContain(`<dir>${fontsDir}</dir>`);
    expect(runtimeContent).not.toContain('prefix="cwd"');

    homedirSpy.mockRestore();
  });
});
