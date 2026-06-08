import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import chalk from "chalk";
import cliProgress from "cli-progress";
import envPaths from "env-paths";
import extractZip from "extract-zip";
import { parse as parseYaml } from "yaml";

import { assetPath, projectRoot } from "./assets";
import { CONSTRAINTS } from "./__version__";
import {
  CamoufoxNotInstalled,
  MissingRelease,
  UnsupportedArchitecture,
  UnsupportedOS,
} from "./exceptions";

export type SupportedOs = "mac" | "win" | "lin";

export const ARCH_MAP: Record<string, string> = {
  amd64: "x86_64",
  x64: "x86_64",
  x86_64: "x86_64",
  x86: "x86_64",
  i686: "i686",
  i386: "i686",
  ia32: "i686",
  arm64: "arm64",
  aarch64: "arm64",
  arm: "arm64",
  armv5l: "arm64",
  armv6l: "arm64",
  armv7l: "arm64",
};

export const OS_MAP: Record<NodeJS.Platform, SupportedOs | undefined> = {
  aix: undefined,
  android: undefined,
  darwin: "mac",
  freebsd: undefined,
  haiku: undefined,
  linux: "lin",
  openbsd: undefined,
  sunos: undefined,
  win32: "win",
  cygwin: "win",
  netbsd: undefined,
};

const mappedOs = OS_MAP[process.platform];
if (!mappedOs) {
  throw new UnsupportedOS(`OS ${process.platform} is not supported`);
}

export const OS_NAME = mappedOs;
export const INSTALL_DIR = envPaths("camoufox", { suffix: "" }).cache;
export const LOCAL_DATA = assetPath();
export const OS_ARCH_MATRIX: Record<SupportedOs, string[]> = {
  win: ["x86_64", "i686"],
  mac: ["x86_64", "arm64"],
  lin: ["x86_64", "arm64", "i686"],
};

export const LAUNCH_FILE: Record<SupportedOs, string> = {
  win: "camoufox.exe",
  mac: "../MacOS/camoufox",
  lin: "camoufox-bin",
};

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const CHALK_COLORS: Record<string, (value: string) => string> = {
  red: chalk.bold.red,
  green: chalk.bold.green,
  yellow: chalk.bold.yellow,
  cyan: chalk.bold.cyan,
  blue: chalk.bold.blue,
  dim: chalk.dim,
  gray: chalk.gray,
  bright_black: chalk.gray,
};

export function rprint(msg: string, fg?: string, nl = true): void {
  const formatter = (fg && CHALK_COLORS[fg]) || chalk.bold;
  if (nl) {
    console.log(formatter(msg));
    return;
  }
  process.stdout.write(formatter(msg));
}

function parseSemver(version: string): number[] {
  const cleaned = version.replace(/^[~^]/, "");
  const parts = cleaned.split(".").map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  while (parts.length < 3) {
    parts.push(0);
  }
  return parts;
}

function getLibraryVersion(): string {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(projectRoot(), "package.json"), "utf8"),
    ) as { version?: string };
    return packageJson.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function compareArrays(left: number[], right: number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a < b) {
      return -1;
    }
    if (a > b) {
      return 1;
    }
  }
  return 0;
}

function findVersionConstraints(
  versions: Array<Record<string, any>>,
  libraryVersion: string,
): Record<string, any> | undefined {
  const parts = parseSemver(libraryVersion);
  let newest: Record<string, any> | undefined;
  let newestMin: number[] | undefined;

  for (const entry of versions) {
    const pyLibrary = (entry.python_library ?? {}) as Record<string, string>;
    const min = parseSemver(pyLibrary.min ?? "0");
    const max = parseSemver(pyLibrary.max ?? "999");
    if (compareArrays(min, parts) <= 0 && compareArrays(parts, max) < 0) {
      return entry.browser;
    }
    if (!newestMin || compareArrays(min, newestMin) > 0) {
      newestMin = min;
      newest = entry.browser;
    }
  }

  return newest;
}

function getChannelBounds(
  browserConstraint: Record<string, any> | undefined,
  channel: "stable" | "prerelease",
): [string | undefined, string | undefined] {
  if (!browserConstraint) {
    return [undefined, undefined];
  }
  if ("stable" in browserConstraint || "prerelease" in browserConstraint) {
    const section = (browserConstraint[channel] ?? {}) as Record<string, string>;
    return [section.min, section.max];
  }
  return [browserConstraint.min, browserConstraint.max];
}

export class RepoConfig {
  repos: string[];
  name: string;
  pattern: string;
  osMap: Record<string, SupportedOs>;
  archMap: Record<string, string>;
  stableMin?: string;
  stableMax?: string;
  prereleaseMin?: string;
  prereleaseMax?: string;

  constructor(input: {
    repos: string[];
    name: string;
    pattern: string;
    osMap: Record<string, SupportedOs>;
    archMap: Record<string, string>;
    stableMin?: string;
    stableMax?: string;
    prereleaseMin?: string;
    prereleaseMax?: string;
  }) {
    this.repos = input.repos;
    this.name = input.name;
    this.pattern = input.pattern;
    this.osMap = input.osMap;
    this.archMap = input.archMap;
    this.stableMin = input.stableMin;
    this.stableMax = input.stableMax;
    this.prereleaseMin = input.prereleaseMin;
    this.prereleaseMax = input.prereleaseMax;
  }

  get repo(): string {
    return this.repos[0];
  }

  static loadRepos(spoofLibraryVersion?: string): RepoConfig[] {
    const data = loadYaml("repos.yml");
    const browsers = (data.browsers ?? []) as Array<Record<string, any>>;
    return browsers.map((repo) => RepoConfig.fromDict(repo, spoofLibraryVersion));
  }

  static getDefaultName(): string {
    const data = loadYaml("repos.yml");
    return data.default?.browser ?? "Official";
  }

  static fromDict(
    input: Record<string, any>,
    spoofLibraryVersion?: string,
  ): RepoConfig {
    if (!input.pattern) {
      throw new Error(`Repo '${input.name ?? "unknown"}' missing required pattern`);
    }

    let browserConstraint: Record<string, any> | undefined;
    if (input.versions) {
      browserConstraint = findVersionConstraints(
        input.versions,
        spoofLibraryVersion ?? getLibraryVersion(),
      );
    }
    const [stableMin, stableMax] = getChannelBounds(browserConstraint, "stable");
    const [prereleaseMin, prereleaseMax] = getChannelBounds(browserConstraint, "prerelease");

    const repos = Array.isArray(input.repo)
      ? input.repo
      : String(input.repo)
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);

    return new RepoConfig({
      repos,
      name: input.name,
      pattern: input.pattern,
      osMap: { darwin: "mac", linux: "lin", win32: "win", cygwin: "win" },
      archMap: ARCH_MAP,
      stableMin,
      stableMax,
      prereleaseMin,
      prereleaseMax,
    });
  }

  static getDefault(): RepoConfig {
    return RepoConfig.findByName(RepoConfig.getDefaultName()) ?? RepoConfig.loadRepos()[0];
  }

  static findByName(name: string): RepoConfig | undefined {
    const nameLower = name.toLowerCase();
    return RepoConfig.loadRepos().find((repo) => repo.name.toLowerCase() === nameLower);
  }

  getOsName(spoofOs?: string): string {
    if (spoofOs) {
      return spoofOs;
    }
    return OS_NAME;
  }

  getArch(spoofArch?: string): string {
    if (spoofArch) {
      return spoofArch;
    }
    const arch = this.archMap[os.arch().toLowerCase()];
    if (!arch) {
      throw new UnsupportedArchitecture(`Architecture ${os.arch()} is not supported`);
    }
    return arch;
  }

  buildPattern(spoofOs?: string, spoofArch?: string): RegExp {
    const replacements: Record<string, string> = {
      name: "(?<name>\\w+)",
      version: "(?<version>[^-]+)",
      build: "(?<build>[^-]+)",
      os: escapeRegExp(this.getOsName(spoofOs)),
      arch: escapeRegExp(this.getArch(spoofArch)),
    };
    const escaped = this.pattern.replace(/\./g, "\\.");
    const regex = escaped.replace(/\{(\w+)\}/g, (_match, key: string) => replacements[key] ?? key);
    return new RegExp(`^${regex}$`);
  }

  isVersionSupported(version: Version, isPrerelease = false): boolean {
    const buildMin = isPrerelease ? this.prereleaseMin : this.stableMin;
    const buildMax = isPrerelease ? this.prereleaseMax : this.stableMax;
    if (!buildMin || !buildMax) {
      return true;
    }
    const min = new Version(buildMin);
    const max = new Version(buildMax);
    return min.compare(version) <= 0 && version.compare(max) < 0;
  }
}

export class Version {
  build: string;
  version?: string;
  sortedRel: number[];

  constructor(build: string, version?: string) {
    this.build = build;
    this.version = version;
    this.sortedRel = build
      .split(".")
      .map((part) => (/^\d+$/.test(part) ? Number.parseInt(part, 10) : part.charCodeAt(0) - 1024));
    while (this.sortedRel.length < 6) {
      this.sortedRel.push(0);
    }
  }

  static fromPath(targetPath = INSTALL_DIR): Version {
    const versionPath = path.join(targetPath, "version.json");
    if (!fs.existsSync(versionPath)) {
      throw new Error(
        `Version information not found at ${versionPath}. Please run \`camoufox fetch\` to install.`,
      );
    }
    const versionData = JSON.parse(fs.readFileSync(versionPath, "utf8")) as Record<string, any>;
    const build = versionData.build ?? versionData.release ?? versionData.tag;
    return new Version(build, versionData.version);
  }

  static isSupportedPath(targetPath: string): boolean {
    return Version.fromPath(targetPath).compare(VERSION_MIN) >= 0;
  }

  static buildMinMax(): [Version, Version] {
    return [new Version(CONSTRAINTS.MIN_VERSION), new Version(CONSTRAINTS.MAX_VERSION)];
  }

  get fullString(): string {
    return `${this.version}-${this.build}`;
  }

  get isAlpha(): boolean {
    return this.build.split(".")[0]?.toLowerCase() === "alpha";
  }

  compare(other: Version): number {
    return compareArrays(this.sortedRel, other.sortedRel);
  }

  isSupported(): boolean {
    return this.compare(VERSION_MIN) >= 0 && this.compare(VERSION_MAX) < 0;
  }
}

export const [VERSION_MIN, VERSION_MAX] = Version.buildMinMax();

export class AvailableVersion {
  version: Version;
  url: string;
  isPrerelease: boolean;
  assetId?: number;
  assetSize?: number;
  assetUpdatedAt?: string;

  constructor(input: {
    version: Version;
    url: string;
    isPrerelease: boolean;
    assetId?: number;
    assetSize?: number;
    assetUpdatedAt?: string;
  }) {
    this.version = input.version;
    this.url = input.url;
    this.isPrerelease = input.isPrerelease;
    this.assetId = input.assetId;
    this.assetSize = input.assetSize;
    this.assetUpdatedAt = input.assetUpdatedAt;
  }

  get display(): string {
    return `v${this.version.fullString}${this.isPrerelease ? " (prerelease)" : ""}`;
  }

  toMetadata(): Record<string, any> {
    return {
      version: this.version.version,
      build: this.version.build,
      prerelease: this.isPrerelease,
      asset_id: this.assetId,
      asset_size: this.assetSize,
      asset_updated_at: this.assetUpdatedAt,
    };
  }
}

export class GitHubDownloader {
  githubRepos: string[];
  githubRepo: string;
  isPrerelease = false;

  constructor(githubRepos: string | string[]) {
    this.githubRepos = Array.isArray(githubRepos) ? githubRepos : [githubRepos];
    this.githubRepo = this.githubRepos[0];
  }

  checkAsset(asset: Record<string, any>, _release?: Record<string, any>): any {
    return asset.browser_download_url;
  }

  missingAssetError(): never {
    throw new MissingRelease(`Could not find a release asset in ${this.githubRepo}.`);
  }

  protected async getReleases(githubRepo: string): Promise<Array<Record<string, any>>> {
    const headers: HeadersInit = GITHUB_TOKEN
      ? { Authorization: `Bearer ${GITHUB_TOKEN}` }
      : {};
    const response = await fetch(`https://api.github.com/repos/${githubRepo}/releases`, {
      headers,
    });
    if (!response.ok) {
      throw new Error(`GitHub API error ${response.status}: ${response.statusText}`);
    }
    return (await response.json()) as Array<Record<string, any>>;
  }

  async getAsset(): Promise<any> {
    let lastError: unknown;
    for (const repo of this.githubRepos) {
      try {
        const releases = await this.getReleases(repo);
        for (const release of releases) {
          for (const asset of release.assets ?? []) {
            const data = this.checkAsset(asset, release);
            if (data) {
              this.githubRepo = repo;
              this.isPrerelease = Boolean(release.prerelease);
              return data;
            }
          }
        }
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) {
      throw lastError;
    }
    this.missingAssetError();
  }
}

export class CamoufoxFetcher extends GitHubDownloader {
  repoConfig: RepoConfig;
  arch: string;
  pattern: RegExp;
  protected selectedVersion?: AvailableVersion;
  protected versionObj?: Version;
  protected downloadUrl?: string;

  constructor(repoConfig?: RepoConfig, selectedVersion?: AvailableVersion) {
    const resolvedConfig = repoConfig ?? RepoConfig.getDefault();
    super(resolvedConfig.repos);
    this.repoConfig = resolvedConfig;
    this.arch = this.getPlatformArch();
    this.pattern = this.repoConfig.buildPattern();
    if (selectedVersion) {
      this.selectedVersion = selectedVersion;
      this.versionObj = selectedVersion.version;
      this.downloadUrl = selectedVersion.url;
      this.isPrerelease = selectedVersion.isPrerelease;
    }
  }

  async initialize(): Promise<this> {
    if (!this.selectedVersion) {
      await this.fetchLatest();
    }
    return this;
  }

  override checkAsset(
    asset: Record<string, any>,
    release?: Record<string, any>,
  ): [Version, string] | undefined {
    const match = this.pattern.exec(asset.name);
    if (!match?.groups) {
      return undefined;
    }
    const version = new Version(match.groups.build, match.groups.version);
    const isPrerelease = Boolean(release?.prerelease) || version.isAlpha;
    if (!this.repoConfig.isVersionSupported(version, isPrerelease)) {
      return undefined;
    }
    return [version, asset.browser_download_url];
  }

  override missingAssetError(): never {
    throw new MissingRelease(
      `No matching release found for ${OS_NAME} ${this.arch} in the supported range. Please update the TypeScript library.`,
    );
  }

  getPlatformArch(): string {
    const arch = this.repoConfig.getArch();
    if (!OS_ARCH_MATRIX[OS_NAME].includes(arch)) {
      throw new UnsupportedArchitecture(`Architecture ${arch} is not supported for ${OS_NAME}`);
    }
    return arch;
  }

  async fetchLatest(): Promise<void> {
    const asset = await this.getAsset();
    this.versionObj = asset[0];
    this.downloadUrl = asset[1];
  }

  static async downloadFile(destination: string, url: string): Promise<string> {
    rprint(`Downloading package: ${url}`);
    await webdl(url, { destination, desc: "Downloading package" });
    return destination;
  }

  async install(replace = false): Promise<void> {
    const { installVersioned } = await import("./multiversion");
    await installVersioned(this, replace);
  }

  get url(): string {
    if (!this.downloadUrl) {
      throw new Error("Url is not available. Make sure to fetchLatest first.");
    }
    return this.downloadUrl;
  }

  get version(): string {
    if (!this.versionObj?.version) {
      throw new Error("Version is not available. Make sure to fetchLatest first.");
    }
    return this.versionObj.version;
  }

  get build(): string {
    if (!this.versionObj) {
      throw new Error("Build information is not available. Make sure to fetchLatest first.");
    }
    return this.versionObj.build;
  }

  get verstr(): string {
    if (!this.versionObj) {
      throw new Error("Version is not available. Make sure to fetchLatest first.");
    }
    return this.versionObj.fullString;
  }
}

export async function listAvailableVersions(
  repoConfig?: RepoConfig,
  includePrerelease = true,
  spoofOs?: string,
  spoofArch?: string,
): Promise<AvailableVersion[]> {
  const config = repoConfig ?? RepoConfig.getDefault();
  const pattern = config.buildPattern(spoofOs, spoofArch);
  const osName = (spoofOs as SupportedOs | undefined) ?? OS_NAME;
  const arch = config.getArch(spoofArch);
  if (!OS_ARCH_MATRIX[osName].includes(arch)) {
    throw new UnsupportedArchitecture(`Architecture ${arch} is not supported for ${osName}`);
  }

  const headers: HeadersInit = GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {};
  let releases: Array<Record<string, any>> = [];
  let lastError: unknown;

  for (const repo of config.repos) {
    try {
      const response = await fetch(`https://api.github.com/repos/${repo}/releases`, { headers });
      if (!response.ok) {
        throw new Error(`GitHub API error ${response.status}: ${response.statusText}`);
      }
      releases = (await response.json()) as Array<Record<string, any>>;
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!releases.length && lastError) {
    throw lastError;
  }

  const versions: AvailableVersion[] = [];
  const seenBuilds = new Set<string>();

  for (const release of releases) {
    const isPrerelease = Boolean(release.prerelease);
    for (const asset of release.assets ?? []) {
      const match = pattern.exec(asset.name);
      if (!match?.groups) {
        continue;
      }
      const version = new Version(match.groups.build, match.groups.version);
      const assetIsPrerelease = isPrerelease || version.isAlpha;
      if (assetIsPrerelease && !includePrerelease) {
        continue;
      }
      if (seenBuilds.has(version.build) || !config.isVersionSupported(version, assetIsPrerelease)) {
        continue;
      }
      seenBuilds.add(version.build);
      versions.push(
        new AvailableVersion({
          version,
          url: asset.browser_download_url,
          isPrerelease: assetIsPrerelease,
          assetId: asset.id,
          assetSize: asset.size,
          assetUpdatedAt: asset.updated_at,
        }),
      );
    }
  }

  return versions.sort((left, right) => right.version.compare(left.version));
}

export function installedVerstr(): string {
  const { getActivePath, getDefaultChannel, loadConfig } = require("./multiversion") as typeof import("./multiversion");
  const active = getActivePath();
  if (!active) {
    const config = loadConfig();
    const pinned = config.pinned;
    const channel = config.channel ?? getDefaultChannel();
    const activeDisplay = pinned ? `${channel}/${pinned}` : channel;
    throw new CamoufoxNotInstalled(
      `${activeDisplay} is not installed. Please run \`camoufox fetch\` to install.`,
    );
  }
  return Version.fromPath(active).fullString;
}

export async function camoufoxPath(downloadIfMissing = true): Promise<string> {
  const { COMPAT_FLAG, getActivePath, getDefaultChannel, loadConfig } = require("./multiversion") as typeof import("./multiversion");

  if (fs.existsSync(INSTALL_DIR) && fs.readdirSync(INSTALL_DIR).length > 0 && !fs.existsSync(COMPAT_FLAG)) {
    rprint("Cleaning old data...", "yellow");
    await fsp.rm(INSTALL_DIR, { recursive: true, force: true });
  }

  const active = getActivePath();
  if (active && Version.fromPath(active).isSupported()) {
    return active;
  }

  if (!fs.existsSync(INSTALL_DIR) || fs.readdirSync(INSTALL_DIR).length === 0) {
    if (!downloadIfMissing) {
      const config = loadConfig();
      const pinned = config.pinned;
      const channel = config.channel ?? getDefaultChannel();
      const activeDisplay = pinned ? `${channel}/${pinned}` : channel;
      throw new CamoufoxNotInstalled(
        `${activeDisplay} is not installed. Please run \`camoufox fetch\` to install.`,
      );
    }
  } else if (Version.fromPath(INSTALL_DIR).isSupported()) {
    return INSTALL_DIR;
  } else if (!downloadIfMissing) {
    throw new Error("Camoufox executable is outdated.");
  }

  await new CamoufoxFetcher().initialize().then((fetcher) => fetcher.install());
  return camoufoxPath(downloadIfMissing);
}

export async function getPath(file: string): Promise<string> {
  const currentPath = await camoufoxPath();
  if (OS_NAME === "mac") {
    return path.resolve(currentPath, "Camoufox.app", "Contents", "Resources", file);
  }
  return path.join(currentPath, file);
}

export async function launchPath(browserPath?: string): Promise<string> {
  const resolvedBrowserPath = browserPath ?? (await camoufoxPath());
  const executable =
    OS_NAME === "mac"
      ? path.resolve(resolvedBrowserPath, "Camoufox.app", "Contents", "Resources", LAUNCH_FILE[OS_NAME])
      : path.join(resolvedBrowserPath, LAUNCH_FILE[OS_NAME]);

  if (!fs.existsSync(executable)) {
    throw new CamoufoxNotInstalled(
      `Camoufox is not installed at ${resolvedBrowserPath}. Please run \`camoufox fetch\` to install.`,
    );
  }
  return executable;
}

export async function webdl(
  url: string,
  options: {
    desc?: string;
    destination: string;
    bar?: boolean;
    progressCallback?: (downloaded: number, total: number) => void;
  },
): Promise<string> {
  const headers: HeadersInit =
    url.includes("api.github") && GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {};
  const response = await fetch(url, { headers });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed ${response.status}: ${response.statusText}`);
  }

  await fsp.mkdir(path.dirname(options.destination), { recursive: true });
  const stream = fs.createWriteStream(options.destination);
  const totalSize = Number.parseInt(response.headers.get("content-length") ?? "0", 10);
  const bar =
    options.bar === false
      ? undefined
      : new cliProgress.SingleBar(
          {
            format: `${options.desc ?? "Downloading"} |{bar}| {percentage}% | {value}/{total}`,
          },
          cliProgress.Presets.shades_classic,
        );

  if (bar && totalSize > 0) {
    bar.start(totalSize, 0);
  }

  let downloaded = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const chunk = Buffer.from(value);
      downloaded += chunk.length;
      if (!stream.write(chunk)) {
        await onceDrain(stream);
      }
      if (bar && totalSize > 0) {
        bar.update(downloaded);
      }
      options.progressCallback?.(downloaded, totalSize);
    }
  } finally {
    if (bar) {
      bar.stop();
    }
    stream.end();
  }

  return options.destination;
}

export async function unzip(
  zipFilePath: string,
  extractPath: string,
  desc?: string,
): Promise<void> {
  if (desc) {
    rprint(desc);
  }
  await fsp.mkdir(extractPath, { recursive: true });
  await extractZip(zipFilePath, { dir: path.resolve(extractPath) });
}

export function loadYaml(file: string): Record<string, any> {
  return parseYaml(fs.readFileSync(assetPath(file), "utf8")) as Record<string, any>;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function onceDrain(stream: fs.WriteStream): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.once("drain", resolve);
    stream.once("error", reject);
  });
}
