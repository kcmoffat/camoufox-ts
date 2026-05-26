import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import AdmZip from "adm-zip";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

async function makeTempDir(prefix: string): Promise<string> {
  return await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("install-local-build script", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((tempDir) => fsp.rm(tempDir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("installs a custom artifact into the local channel and activates it", async () => {
    const homeDir = await makeTempDir("camoufox-home-");
    const workDir = await makeTempDir("camoufox-artifact-");
    tempDirs.push(homeDir, workDir);

    const appDir = path.join(workDir, "Camoufox", "Camoufox.app", "Contents");
    await fsp.mkdir(appDir, { recursive: true });
    await fsp.writeFile(path.join(appDir, "Info.plist"), "<plist />", "utf8");
    await fsp.writeFile(path.join(appDir, "dummy-bin"), "bin", "utf8");

    const artifactPath = path.join(workDir, "camoufox-150.0.2-beta.25-mac.arm64.zip");
    const zip = new AdmZip();
    zip.addLocalFolder(path.join(workDir, "Camoufox"), "Camoufox");
    zip.writeZip(artifactPath);

    const scriptPath = path.resolve("scripts/install-local-build.sh");
    await execFileAsync("bash", [scriptPath, artifactPath], {
      cwd: path.resolve("."),
      env: { ...process.env, HOME: homeDir },
    });

    const cacheDir = path.join(homeDir, ".cache", "camoufox");
    const installDir = path.join(cacheDir, "browsers", "local", "150.0.2-beta.25");
    const configPath = path.join(cacheDir, "config.json");

    expect(fs.existsSync(path.join(installDir, "Camoufox.app", "Contents", "Info.plist"))).toBe(true);
    expect(
      JSON.parse(await fsp.readFile(path.join(installDir, "version.json"), "utf8")),
    ).toEqual({
      version: "150.0.2",
      build: "beta.25",
      prerelease: false,
      local_build: true,
    });
    expect(JSON.parse(await fsp.readFile(configPath, "utf8"))).toEqual({
      active_version: "browsers/local/150.0.2-beta.25",
    });
  });
});
