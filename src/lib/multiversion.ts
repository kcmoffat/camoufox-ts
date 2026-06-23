import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  AvailableVersion,
  CamoufoxFetcher,
  formatAssetDate,
  INSTALL_DIR,
  RepoConfig,
  Version,
  rprint,
  unzip,
  OS_NAME,
} from "./pkgman";

export const BROWSERS_DIR = path.join(INSTALL_DIR, "browsers");
export const CONFIG_FILE = path.join(INSTALL_DIR, "config.json");
export const REPO_CACHE_FILE = path.join(INSTALL_DIR, "repo_cache.json");
export const COMPAT_FLAG = path.join(INSTALL_DIR, ".0.5_FLAG");

export type StoredConfig = {
  active_version?: string | null;
  channel?: string;
  pinned?: string;
  pinnedSha?: string;
  active_repo?: string;
  active_build?: string;
  active_version_value?: string;
};

export function loadConfig(): Record<string, any> {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as Record<string, any>;
    } catch {}
  }
  return {};
}

export function getDefaultChannel(): string {
  return `${RepoConfig.getDefaultName().toLowerCase()}/stable`;
}

export function saveConfig(config: Record<string, any>): void {
  fs.mkdirSync(INSTALL_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function loadRepoCache(): Record<string, any> {
  if (fs.existsSync(REPO_CACHE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(REPO_CACHE_FILE, "utf8")) as Record<string, any>;
    } catch {}
  }
  return {};
}

export function saveRepoCache(cache: Record<string, any>): void {
  fs.mkdirSync(INSTALL_DIR, { recursive: true });
  fs.writeFileSync(REPO_CACHE_FILE, JSON.stringify(cache, null, 2));
}

export function getCachedVersions(repoName?: string): AvailableVersion[] {
  const cache = loadRepoCache();
  if (!cache.repos) {
    return [];
  }
  const versions: AvailableVersion[] = [];
  for (const repoData of cache.repos as Array<Record<string, any>>) {
    if (repoName && repoData.name.toLowerCase() !== repoName.toLowerCase()) {
      continue;
    }
    for (const version of repoData.versions ?? []) {
      versions.push(
        new AvailableVersion({
          version: new Version(version.build, version.version),
          url: version.url,
          isPrerelease: Boolean(version.is_prerelease),
          assetId: version.asset_id,
          assetSize: version.asset_size,
          assetUpdatedAt: version.asset_updated_at,
          sha256: version.sha256,
          assetCreatedAt: version.created_at,
        }),
      );
    }
  }
  return versions.sort((left, right) => right.version.compare(left.version));
}

export function getCachedRepoNames(): string[] {
  return (loadRepoCache().repos ?? []).map((repo: Record<string, any>) => repo.name);
}

export function getRepoName(githubRepo: string): string {
  for (const repo of RepoConfig.loadRepos()) {
    if (repo.repos.includes(githubRepo)) {
      return repo.name.toLowerCase();
    }
  }
  return githubRepo.split("/")[0].toLowerCase();
}

export class InstalledVersion {
  repoName: string;
  version: Version;
  path: string;
  isActive: boolean;
  isPrerelease: boolean;
  assetId?: number;
  assetSize?: number;
  assetUpdatedAt?: string;
  sha256?: string;
  createdAt?: string;

  constructor(input: {
    repoName: string;
    version: Version;
    path: string;
    isActive?: boolean;
    isPrerelease?: boolean;
    assetId?: number;
    assetSize?: number;
    assetUpdatedAt?: string;
    sha256?: string;
    createdAt?: string;
  }) {
    this.repoName = input.repoName;
    this.version = input.version;
    this.path = input.path;
    this.isActive = Boolean(input.isActive);
    this.isPrerelease = Boolean(input.isPrerelease);
    this.assetId = input.assetId;
    this.assetSize = input.assetSize;
    this.assetUpdatedAt = input.assetUpdatedAt;
    this.sha256 = input.sha256;
    this.createdAt = input.createdAt;
  }

  get relativePath(): string {
    return `browsers/${this.repoName}/${path.basename(this.path)}`;
  }

  get channelPath(): string {
    return `${this.repoName}/${this.isPrerelease ? "prerelease" : "stable"}/${this.version.fullString}`;
  }

  getChanges(available: AvailableVersion): string[] {
    const changes: string[] = [];
    if (this.isPrerelease && !available.isPrerelease) {
      changes.push("prerelease -> stable");
    } else if (!this.isPrerelease && available.isPrerelease) {
      changes.push("stable -> prerelease");
    }
    if (this.assetUpdatedAt && available.assetUpdatedAt) {
      if (this.assetUpdatedAt !== available.assetUpdatedAt) {
        changes.push("asset updated");
      }
    } else if (this.assetSize && available.assetSize && this.assetSize !== available.assetSize) {
      changes.push("asset updated");
    }
    return changes;
  }
}

export function findInstalledByBuild(build: string, repoName?: string): InstalledVersion | undefined {
  return listInstalled().find(
    (version) => version.version.build === build && (!repoName || version.repoName === repoName),
  );
}

export function versionFolderName(version: string, build: string, sha8 = ""): string {
  const base = `${version}-${build}`;
  return sha8 ? `${base}-${sha8}` : base;
}

export function findInstalledForVersion(
  fullVersion: string,
  sha256?: string,
  repoName?: string,
  count = 1,
  installed = listInstalled(),
): InstalledVersion | undefined {
  const candidates = installed.filter((version) => {
    if (repoName && version.repoName !== repoName) {
      return false;
    }
    return version.version.fullString === fullVersion;
  });
  const sha8 = sha256?.slice(0, 8) ?? "";

  if (sha8) {
    return candidates.find(
      (version) => path.basename(version.path) === `${fullVersion}-${sha8}` || version.sha256 === sha256,
    );
  }

  const legacy = candidates.find((version) => path.basename(version.path) === fullVersion);
  if (!legacy || legacy.sha256) {
    return undefined;
  }
  return count <= 1 ? legacy : undefined;
}

export function listInstalled(): InstalledVersion[] {
  const installed: InstalledVersion[] = [];
  const config = loadConfig();
  const active = config.active_version;
  if (!fs.existsSync(BROWSERS_DIR)) {
    return installed;
  }

  for (const repoEntry of fs.readdirSync(BROWSERS_DIR, { withFileTypes: true })) {
    if (!repoEntry.isDirectory() || repoEntry.name.startsWith(".")) {
      continue;
    }
    const repoDir = path.join(BROWSERS_DIR, repoEntry.name);
    for (const versionEntry of fs.readdirSync(repoDir, { withFileTypes: true })) {
      if (!versionEntry.isDirectory()) {
        continue;
      }
      const versionDir = path.join(repoDir, versionEntry.name);
      const versionJson = path.join(versionDir, "version.json");
      if (!fs.existsSync(versionJson)) {
        continue;
      }
      try {
        const version = Version.fromPath(versionDir);
        const versionData = JSON.parse(fs.readFileSync(versionJson, "utf8")) as Record<string, any>;
        const relativePath = `browsers/${repoEntry.name}/${versionEntry.name}`;
        installed.push(
          new InstalledVersion({
            repoName: repoEntry.name,
            version,
            path: versionDir,
            isActive: relativePath === active,
            isPrerelease: Boolean(versionData.prerelease),
            assetId: versionData.asset_id,
            assetSize: versionData.asset_size,
            assetUpdatedAt: versionData.asset_updated_at,
            sha256: versionData.sha256,
            createdAt: versionData.created_at,
          }),
        );
      } catch {}
    }
  }

  return installed.sort((left, right) => {
    if (left.repoName === right.repoName) {
      return right.version.compare(left.version);
    }
    return right.repoName.localeCompare(left.repoName);
  });
}

export function getActivePath(): string | undefined {
  const config = loadConfig();
  const active = config.active_version;
  if (active) {
    const candidate = path.join(INSTALL_DIR, active);
    if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, "version.json"))) {
      return candidate;
    }
  }
  if (!config.channel && !config.pinned) {
    const installed = listInstalled();
    if (installed.length > 0) {
      config.active_version = installed[0].relativePath;
      saveConfig(config);
      return installed[0].path;
    }
  }
  return undefined;
}

export function setActive(relativePath: string): void {
  const config = loadConfig();
  config.active_version = relativePath;
  saveConfig(config);
}

export function installedVersionMatchesSpecifier(specifier: string, version: InstalledVersion): boolean {
  const lower = specifier.toLowerCase();
  const browserPath = `browsers/${version.repoName}/${version.version.fullString}`.toLowerCase();

  return (
    version.relativePath.toLowerCase() === lower ||
    browserPath.endsWith(lower) ||
    `browsers/${specifier}`.toLowerCase() === version.relativePath.toLowerCase() ||
    `${version.repoName}/${version.version.build}`.toLowerCase() === lower ||
    version.version.build.toLowerCase() === lower ||
    version.version.fullString.toLowerCase() === lower ||
    version.version.version?.toLowerCase() === lower
  );
}

export function findInstalledVersion(specifier: string): string | undefined {
  for (const version of listInstalled()) {
    if (installedVersionMatchesSpecifier(specifier, version)) {
      return version.path;
    }
  }
  return undefined;
}

export async function installVersioned(fetcher: CamoufoxFetcher, replace = false): Promise<boolean> {
  const repoName = getRepoName(fetcher.githubRepo);
  const versionFolder = versionFolderName(
    fetcher.version,
    fetcher.build,
    fetcher["selectedVersion"]?.sha8 ?? fetcher.installedSha256?.slice(0, 8) ?? "",
  );
  const installPath = path.join(BROWSERS_DIR, repoName, versionFolder);

  if (fs.existsSync(installPath) && fs.existsSync(path.join(installPath, "version.json"))) {
    if (!replace) {
      const installed = findInstalledByBuild(fetcher.build, repoName);
      let changeMsg = "";
      if (installed && fetcher["selectedVersion"]) {
        const changes = installed.getChanges(fetcher["selectedVersion"]);
        if (changes.length > 0) {
          changeMsg = ` (${changes.join(", ")})`;
        }
      }
      rprint(`Version v${fetcher.verstr} already installed${changeMsg}.`, "yellow");
      rprint(changeMsg ? "Use --replace to update with the new release." : "Use --replace to reinstall.", "yellow");
      if (!loadConfig().active_version) {
        setActive(`browsers/${repoName}/${versionFolder}`);
      }
      return false;
    }
    rprint(`Replacing: ${installPath}`, "yellow");
    await fsp.rm(installPath, { recursive: true, force: true });
  }

  await fsp.mkdir(installPath, { recursive: true });
  const tempFile = path.join(os.tmpdir(), `camoufox-${Date.now()}-${Math.random().toString(16).slice(2)}.zip`);

  try {
    await CamoufoxFetcher.downloadFile(tempFile, fetcher.url);
    rprint(`Extracting Camoufox: ${installPath}`);
    await unzip(tempFile, installPath);

    const metadata = fetcher["selectedVersion"]
      ? fetcher["selectedVersion"].toMetadata()
      : {
          version: fetcher.version,
          build: fetcher.build,
          prerelease: fetcher.isPrerelease,
          sha256: fetcher.installedSha256,
          created_at: fetcher.installedCreatedAt,
        };
    await fsp.writeFile(path.join(installPath, "version.json"), JSON.stringify(metadata, null, 2));

    if (OS_NAME !== "win") {
      await chmodRecursive(installPath, 0o755);
    }

    setActive(`browsers/${repoName}/${versionFolder}`);
    await fsp.mkdir(INSTALL_DIR, { recursive: true });
    await fsp.writeFile(COMPAT_FLAG, "");
    rprint(`\nCamoufox v${fetcher.verstr} installed.`, "green");
    rprint(`Path: ${installPath}`, "green");
    return true;
  } catch (error) {
    await fsp.rm(installPath, { recursive: true, force: true });
    throw error;
  } finally {
    await fsp.rm(tempFile, { force: true });
  }
}

export async function removeVersion(targetPath: string): Promise<boolean> {
  if (!fs.existsSync(targetPath)) {
    return false;
  }
  rprint(`Removing: ${targetPath}`);
  await fsp.rm(targetPath, { recursive: true, force: true });

  const parent = path.dirname(targetPath);
  if (fs.existsSync(parent) && parent !== BROWSERS_DIR && fs.readdirSync(parent).length === 0) {
    await fsp.rmdir(parent);
  }
  if (fs.existsSync(BROWSERS_DIR) && fs.readdirSync(BROWSERS_DIR).length === 0) {
    await fsp.rmdir(BROWSERS_DIR);
  }

  const config = loadConfig();
  const relativePath = path.relative(INSTALL_DIR, targetPath);
  if (config.active_version === relativePath) {
    const remaining = listInstalled();
    config.active_version = remaining[0]?.relativePath ?? null;
    saveConfig(config);
  }
  return true;
}

export function printTree(showHeader = true, showPaths = false): void {
  const installed = listInstalled();
  if (!installed.length) {
    rprint("No versions installed.", "yellow");
    rprint("Run `camoufox fetch` to install.", "yellow");
    return;
  }
  if (showHeader) {
    rprint("Installed versions:\n", "yellow");
  }
  let currentRepo: string | undefined;
  installed.forEach((version, index) => {
    const next = installed[index + 1];
    const isLast = !next || next.repoName !== version.repoName;
    if (version.repoName !== currentRepo) {
      currentRepo = version.repoName;
      console.log(`${version.repoName}/`);
      if (showPaths) {
        console.log(`  -> ${path.join(BROWSERS_DIR, version.repoName)}`);
      }
    }
    const branch = isLast ? "└──" : "├──";
    const status = [
      version.isPrerelease ? "prerelease" : "stable",
      version.isActive ? "active" : undefined,
      formatAssetDate(version.createdAt) || version.sha256?.slice(0, 8) || undefined,
    ]
      .filter(Boolean)
      .join(", ");
    console.log(`    ${branch} v${version.version.fullString} (${status})`);
  });
}

async function chmodRecursive(targetPath: string, mode: number): Promise<void> {
  const stats = await fsp.stat(targetPath);
  await fsp.chmod(targetPath, mode);
  if (!stats.isDirectory()) {
    return;
  }
  for (const entry of await fsp.readdir(targetPath)) {
    await chmodRecursive(path.join(targetPath, entry), mode);
  }
}
