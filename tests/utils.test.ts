import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DefaultAddons } from "../src/lib/addons";

const mocks = vi.hoisted(() => ({
  camoufoxPath: vi.fn<() => Promise<string>>(),
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
    installedVerstr: mocks.installedVerstr,
    launchPath: mocks.launchPath,
  };
});

import { launchOptions } from "../src/lib/utils";

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

afterEach(async () => {
  mocks.camoufoxPath.mockReset();
  mocks.installedVerstr.mockClear();
  mocks.launchPath.mockReset();

  while (tempDirs.length > 0) {
    await fsp.rm(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

describe("launchOptions", () => {
  it("resolves Firefox version from the bootstrapped bundle on first launch", async () => {
    const bundleDir = await createBundleDir();
    mocks.camoufoxPath.mockResolvedValue(bundleDir);
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
});
