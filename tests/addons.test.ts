import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  installDir: "/tmp/camoufox-ts-addons-test",
  unzip: vi.fn<(zipFilePath: string, extractPath: string, desc?: string) => Promise<void>>(),
  webdl: vi.fn<
    (
      url: string,
      options: {
        destination: string;
        desc?: string;
        bar?: boolean;
        progressCallback?: (downloaded: number, total: number) => void;
      },
    ) => Promise<string>
  >(),
}));

vi.mock("../src/lib/pkgman", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/pkgman")>("../src/lib/pkgman");
  return {
    ...actual,
    INSTALL_DIR: mocks.installDir,
    unzip: mocks.unzip,
    webdl: mocks.webdl,
  };
});

import {
  ADDONS_DIR,
  DefaultAddons,
  maybeDownloadAddons,
} from "../src/lib/addons";

beforeEach(async () => {
  await fsp.rm(mocks.installDir, { recursive: true, force: true });

  mocks.webdl.mockReset();
  mocks.unzip.mockReset();
  mocks.webdl.mockImplementation(async (_url, options) => options.destination);
  mocks.unzip.mockImplementation(async (_zipFilePath, extractPath) => {
    await fsp.mkdir(extractPath, { recursive: true });
    await fsp.writeFile(path.join(extractPath, "manifest.json"), "{}");
  });
});

afterEach(async () => {
  await fsp.rm(mocks.installDir, { recursive: true, force: true });
});

describe("addons", () => {
  it("stores default addons under the enum name used by the upstream Python wrapper", async () => {
    const addonsList: string[] = [];

    await maybeDownloadAddons([DefaultAddons.UBO], addonsList);

    expect(addonsList).toEqual([path.join(ADDONS_DIR, "UBO")]);
    expect(fs.existsSync(path.join(ADDONS_DIR, "UBO", "manifest.json"))).toBe(true);
    expect(fs.existsSync(path.join(ADDONS_DIR, "https:"))).toBe(false);
  });
});
