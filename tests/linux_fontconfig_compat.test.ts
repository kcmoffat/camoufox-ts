import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPath: vi.fn<(file: string) => Promise<string>>(),
}));

vi.mock("../src/lib/pkgman", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/pkgman")>("../src/lib/pkgman");
  return {
    ...actual,
    OS_NAME: "lin",
    getPath: mocks.getPath,
  };
});

import { getEnvVars } from "../src/lib/utils";

const tempDirs: string[] = [];

afterEach(async () => {
  mocks.getPath.mockReset();
  while (tempDirs.length > 0) {
    await fsp.rm(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

describe("linux fontconfig compatibility", () => {
  it("falls back to the older fontconfigs directory when the new path is missing", async () => {
    const bundleDir = await fsp.mkdtemp(path.join(os.tmpdir(), "camoufox-fontconfig-"));
    tempDirs.push(bundleDir);

    const legacyDir = path.join(bundleDir, "fontconfigs", "linux");
    const fontsDir = path.join(bundleDir, "fonts");
    await fsp.mkdir(legacyDir, { recursive: true });
    await fsp.mkdir(fontsDir, { recursive: true });
    await fsp.writeFile(
      path.join(legacyDir, "fonts.conf"),
      '<fontconfig><dir prefix="cwd">fonts</dir></fontconfig>',
    );

    mocks.getPath.mockImplementation(async (file: string) => path.join(bundleDir, file));
    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(bundleDir);

    const env = await getEnvVars({}, "lin");

    expect(env.FONTCONFIG_FILE).toContain(path.join(".cache", "camoufox", "fontconfig", "fonts-"));
    expect(await fsp.readFile(env.FONTCONFIG_FILE, "utf8")).toContain(`<dir>${fontsDir}</dir>`);

    homedirSpy.mockRestore();
  });
});
