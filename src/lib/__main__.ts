import fs from "node:fs";
import fsp from "node:fs/promises";

import { confirm, select } from "@inquirer/prompts";
import chalk from "chalk";
import { Command } from "commander";

import { DefaultAddons, maybeDownloadAddons } from "./addons";
import {
  ALLOW_GEOIP,
  GEOIP_DIR,
  downloadMmdb,
  getMmdbPath,
  loadGeoipConfig,
  loadGeoipRepos,
  saveGeoipConfig,
} from "./geolocation";
import {
  BROWSERS_DIR,
  COMPAT_FLAG,
  CONFIG_FILE,
  REPO_CACHE_FILE,
  InstalledVersion,
  getDefaultChannel,
  listInstalled,
  loadConfig,
  loadRepoCache,
  printTree,
  removeVersion,
  saveConfig,
  saveRepoCache,
  setActive,
} from "./multiversion";
import {
  AvailableVersion,
  CamoufoxFetcher,
  INSTALL_DIR,
  RepoConfig,
  Version,
  installedVerstr,
  listAvailableVersions,
  rprint,
} from "./pkgman";
import { projectRoot } from "./assets";
import { Camoufox } from "./sync_api";
import { main as launchGui } from "./gui/index";
import { launchServer } from "./server";

async function inquirerSelect<T>(
  choices: Array<{ name: string; value: T }>,
  message: string,
): Promise<T | undefined> {
  try {
    return await select({ message, choices });
  } catch {
    return undefined;
  }
}

export function findInstalled(specifier: string): InstalledVersion | undefined {
  const normalized = specifier.toLowerCase();
  const installed = listInstalled();
  const parts = normalized.split("/");

  for (const version of installed) {
    if (
      version.channelPath.toLowerCase() === normalized ||
      version.relativePath.toLowerCase() === normalized ||
      version.version.build.toLowerCase() === normalized ||
      version.version.fullString.toLowerCase() === normalized
    ) {
      return version;
    }
    if (parts.length === 2) {
      const [repo, ver] = parts;
      if (version.repoName === repo && version.version.fullString.toLowerCase() === ver) {
        return version;
      }
    }
  }

  if (parts.length === 2) {
    const [repo, channel] = parts;
    if (channel === "stable" || channel === "prerelease") {
      return installed.find(
        (version) => version.repoName === repo && version.isPrerelease === (channel === "prerelease"),
      );
    }
  }

  return undefined;
}

function getGeoipSourceName(): string {
  try {
    return loadGeoipConfig().name ?? "Default";
  } catch {
    return "Default";
  }
}

export async function doSync(
  spoofOs?: string,
  spoofArch?: string,
  spoofLibraryVersion?: string,
): Promise<boolean> {
  rprint("Syncing repositories...", "yellow");

  const cache: Record<string, any> = {
    repos: [],
    spoof_os: spoofOs,
    spoof_arch: spoofArch,
    spoof_lib_ver: spoofLibraryVersion,
    sync_time: new Date().toISOString().slice(0, 16).replace("T", " "),
  };

  for (const repoConfig of RepoConfig.loadRepos(spoofLibraryVersion)) {
    process.stdout.write(chalk.bold.cyan(`  ${repoConfig.name}...`));
    try {
      const versions = await listAvailableVersions(repoConfig, true, spoofOs, spoofArch);
      cache.repos.push({
        name: repoConfig.name,
        repo: repoConfig.repo,
        versions: versions.map((version) => ({
          version: version.version.version,
          build: version.version.build,
          url: version.url,
          is_prerelease: version.isPrerelease,
          asset_id: version.assetId,
          asset_size: version.assetSize,
          asset_updated_at: version.assetUpdatedAt,
        })),
      });
      rprint(` ${versions.length} versions`, "green");
    } catch (error) {
      rprint(` Error: ${String(error)}`, "red");
    }
  }

  saveRepoCache(cache);
  const total = (cache.repos as Array<Record<string, any>>).reduce(
    (sum, repo) => sum + (repo.versions?.length ?? 0),
    0,
  );
  const platformString = spoofOs ? ` (${spoofOs}/${spoofArch ?? "auto"})` : "";
  rprint(`\nSynced ${total} versions from ${cache.repos.length} repos${platformString}.`, "green");
  return true;
}

function ensureSynced(): boolean {
  if (!fs.existsSync(REPO_CACHE_FILE)) {
    rprint("No repo cache found. Run 'camoufox sync' first.", "red");
    return false;
  }
  return true;
}

export class CamoufoxUpdate extends CamoufoxFetcher {
  currentVerstr?: string;

  constructor(repoConfig?: RepoConfig, selectedVersion?: AvailableVersion) {
    super(repoConfig, selectedVersion);
    try {
      this.currentVerstr = installedVerstr();
    } catch {
      this.currentVerstr = undefined;
    }
  }

  isUpdateNeeded(): boolean {
    return this.currentVerstr == null || this.currentVerstr !== this.verstr;
  }

  async update(replace = false, iKnowWhatImDoing = false): Promise<void> {
    if (!this.isUpdateNeeded() && !replace) {
      rprint("Camoufox binaries up to date!", "green");
      if (this.currentVerstr) {
        rprint(`Current version: v${this.currentVerstr}`, "green");
      }
      return;
    }

    if (this.isPrerelease && !iKnowWhatImDoing) {
      rprint(`Warning: v${this.verstr} is a prerelease version!`, "yellow");
      const accepted = await confirm({
        message: "Continue with prerelease installation?",
        default: false,
      });
      if (!accepted) {
        rprint("Installation cancelled.", "red");
        return;
      }
    }

    rprint(`${this.currentVerstr ? "Installing" : "Fetching"} Camoufox v${this.verstr}...`, "yellow");
    await this.install(replace);
  }
}

export function setChannel(repoName: string, channelType: "stable" | "prerelease"): void {
  const config = loadConfig();
  config.channel = `${repoName}/${channelType}`;
  delete config.pinned;

  const cache = loadRepoCache();
  const candidates = (cache.repos ?? [])
    .find((repo: Record<string, any>) => repo.name.toLowerCase() === repoName.toLowerCase())
    ?.versions?.filter((version: Record<string, any>) => Boolean(version.is_prerelease) === (channelType === "prerelease"));

  if (candidates?.length) {
    const latestBuild = candidates[0].build;
    const installed = listInstalled().find(
      (version) => version.version.build === latestBuild && version.repoName === repoName.toLowerCase(),
    );
    if (installed) {
      config.active_version = installed.relativePath;
      saveConfig(config);
      console.log(chalk.bold.cyan(`Channel: ${repoName.toLowerCase()}/${channelType}`));
      console.log(chalk.green(`Using latest: ${installed.channelPath} (installed)`));
      return;
    }
  }

  delete config.active_version;
  saveConfig(config);
  console.log(chalk.bold.cyan(`Channel: ${repoName.toLowerCase()}/${channelType}`));
  console.log(chalk.yellow("Run 'camoufox fetch' to install latest."));
}

export function setPinned(
  repoName: string,
  channelType: "stable" | "prerelease",
  versionData: Record<string, any>,
  installed?: InstalledVersion,
): void {
  const config = loadConfig();
  const verString = `${versionData.version}-${versionData.build}`;
  config.channel = `${repoName}/${channelType}`;
  config.pinned = verString;
  if (installed) {
    config.active_version = installed.relativePath;
    saveConfig(config);
    console.log(chalk.green(`Pinned: ${repoName.toLowerCase()}/${channelType}/${verString} (installed)`));
    return;
  }
  delete config.active_version;
  saveConfig(config);
  console.log(chalk.bold.cyan(`Pinned: ${repoName.toLowerCase()}/${channelType}/${verString}`));
  console.log(chalk.yellow("Run 'camoufox fetch' to install."));
}

async function selectGeoipSource(): Promise<void> {
  const [repos] = loadGeoipRepos();
  if (!repos.length) {
    rprint("No GeoIP sources configured.", "red");
    return;
  }
  const current = loadGeoipConfig().name ?? "";
  const selected = await inquirerSelect(
    repos.map((repo) => ({
      name: `${repo.name}${repo.name === current ? " [active]" : ""}`,
      value: repo,
    })),
    "Select GeoIP source",
  );
  if (!selected) {
    return;
  }
  await saveGeoipConfig(selected);
  rprint(`GeoIP source: ${selected.name}`, "green");
}

function listInstalledCommand(showPaths: boolean): void {
  printTree(true, showPaths);
  console.log("\ngeoip/");
  if (showPaths && fs.existsSync(GEOIP_DIR)) {
    console.log(`  -> ${GEOIP_DIR}`);
  }
  if (fs.existsSync(GEOIP_DIR)) {
    const mmdb = getMmdbPath();
    if (fs.existsSync(mmdb)) {
      console.log(`    └── ${mmdb.split("/").pop()} (${getGeoipSourceName()})`);
    } else {
      rprint("    └── Not downloaded", "yellow");
    }
  } else {
    rprint("    └── Not configured", "yellow");
  }
}

function listAllCommand(): void {
  if (!ensureSynced()) {
    return;
  }
  const cache = loadRepoCache();
  const installed = new Map(listInstalled().map((version) => [version.version.build, version]));
  rprint("Available versions:\n", "yellow");

  for (const repoData of cache.repos ?? []) {
    console.log(`${repoData.name}/`);
    for (const [index, version] of (repoData.versions ?? []).entries()) {
      const installedVersion = installed.get(version.build);
      const prefix = index === repoData.versions.length - 1 ? "└──" : "├──";
      const status = [
        version.is_prerelease ? "prerelease" : "stable",
        installedVersion ? "installed" : undefined,
        installedVersion?.isActive ? "active" : undefined,
      ]
        .filter(Boolean)
        .join(", ");
      console.log(`    ${prefix} v${version.version}-${version.build} (${status})`);
    }
    console.log("");
  }
}

class VersionInfo {
  private readonly rows: Array<[string, string]> = [];

  private row(label: string, value: string): void {
    this.rows.push([label, value]);
  }

  private packageVersion(label: string, packageName: string): void {
    try {
      const packageJsonPath =
        packageName === "camoufox-ts"
          ? `${projectRoot()}/package.json`
          : `${projectRoot()}/node_modules/${packageName}/package.json`;
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
        version?: string;
      };
      this.row(label, `v${packageJson.version ?? "?"}`);
    } catch {
      this.row(label, "?");
    }
  }

  packages(): void {
    this.row("JavaScript Packages", "");
    this.packageVersion("Camoufox TS", "camoufox-ts");
    this.packageVersion("Fingerprint Generator", "fingerprint-generator");
    this.packageVersion("Playwright", "playwright");
  }

  browser(): void {
    const config = loadConfig();
    const pinned = config.pinned;
    const channel = config.channel ?? getDefaultChannel();
    this.row("Browser", "");
    this.row("Active", pinned ? `${channel.toLowerCase()}/${pinned}` : channel.toLowerCase());

    const active = listInstalled().find((version) => version.isActive);
    this.row("Current browser", active ? `v${active.version.fullString}` : "Not installed");
    this.row("Installed", active ? "Yes" : "No");

    if (active) {
      let isLatest = false;
      const cache = loadRepoCache();
      for (const repoData of cache.repos ?? []) {
        if (repoData.name.toLowerCase() !== active.repoName.toLowerCase()) {
          continue;
        }
        const candidates = (repoData.versions ?? []).filter(
          (version: Record<string, any>) => Boolean(version.is_prerelease) === active.isPrerelease,
        );
        if (candidates.length && candidates[0].build === active.version.build) {
          isLatest = true;
        }
      }
      this.row(
        `Latest in ${active.repoName}/${active.isPrerelease ? "prerelease" : "stable"}?`,
        isLatest ? "Yes" : "No",
      );
    }

    this.row(
      "Last Sync",
      fs.existsSync(REPO_CACHE_FILE)
        ? new Date(fs.statSync(REPO_CACHE_FILE).mtimeMs).toISOString().slice(0, 16).replace("T", " ")
        : "Never",
    );
  }

  geoip(): void {
    this.row("GeoIP", "");
    if (!ALLOW_GEOIP) {
      this.row("Status", "Not supported");
      return;
    }
    const mmdbPath = getMmdbPath();
    if (fs.existsSync(mmdbPath)) {
      this.row("Database", loadGeoipConfig().name ?? "Unknown");
      this.row(
        "Updated",
        new Date(fs.statSync(mmdbPath).mtimeMs).toISOString().slice(0, 16).replace("T", " "),
      );
      return;
    }
    this.row("Database", "Not installed");
  }

  storage(): void {
    this.row("Storage", "");
    this.row("Install path", INSTALL_DIR);
    this.row("Browser(s) directory size", this.dirSize(BROWSERS_DIR));
    if (ALLOW_GEOIP) {
      this.row("GeoIP database size", this.dirSize(GEOIP_DIR));
    }
    this.row("Config file", CONFIG_FILE);
    this.row("Repo cache", REPO_CACHE_FILE);
  }

  printAll(): void {
    this.packages();
    this.browser();
    this.geoip();
    this.storage();
    for (const [label, value] of this.rows) {
      if (value === "") {
        console.log(label);
      } else {
        console.log(`  ${label.padEnd(24)} ${value}`);
      }
    }
  }

  private dirSize(targetPath: string): string {
    if (!fs.existsSync(targetPath)) {
      return "Nothing here";
    }
    const total = walkSize(targetPath);
    const units = ["B", "KB", "MB", "GB"];
    let value = total;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index += 1;
    }
    return units[index] === "B" ? `${value} B` : `${value.toFixed(1)} ${units[index]}`;
  }
}

function walkSize(targetPath: string): number {
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    return stat.size;
  }
  return fs
    .readdirSync(targetPath)
    .map((entry) => walkSize(`${targetPath}/${entry}`))
    .reduce((sum, value) => sum + value, 0);
}

export function resolveFetchTarget(
  cache: Record<string, any>,
  config: Record<string, any>,
  version?: string,
): { repoName?: string; verString?: string; missingChannel?: string } {
  let repoName: string | undefined;
  let verString: string | undefined;

  if (version) {
    const parts = version.split("/");
    if (parts.length === 3) {
      repoName = parts[0];
      verString = parts[2].replace(/^v/, "");
    } else if (parts.length === 2) {
      repoName = parts[0];
      verString = parts[1].replace(/^v/, "");
    } else {
      return {};
    }
    return { repoName, verString };
  }

  if (config.pinned) {
    const channel = config.channel ?? "";
    repoName = channel.includes("/") ? channel.split("/")[0] : channel;
    verString = config.pinned;
    return { repoName, verString };
  }

  const channel = config.channel ?? getDefaultChannel();
  const [repo, channelType = "stable"] = channel.split("/");
  repoName = repo;

  for (const repoData of cache.repos ?? []) {
    if (repoData.name.toLowerCase() !== repo.toLowerCase()) {
      continue;
    }
    const candidates = (repoData.versions ?? []).filter(
      (candidate: Record<string, any>) =>
        Boolean(candidate.is_prerelease) === (channelType === "prerelease"),
    );
    if (candidates.length) {
      verString = `${candidates[0].version}-${candidates[0].build}`;
      return { repoName, verString };
    }
    return { repoName, missingChannel: channel };
  }

  return { repoName, verString };
}

export async function cli(argv = process.argv): Promise<void> {
  const program = new Command();
  program.name("camoufox").description("Camoufox TypeScript interface and package manager");

  program
    .command("sync")
    .option("--spoof-os <os>", "Spoof OS (auto = native)")
    .option("--spoof-arch <arch>", "Spoof architecture (auto = native)")
    .action(async (options) => {
      await doSync(options.spoofOs === "auto" ? undefined : options.spoofOs, options.spoofArch === "auto" ? undefined : options.spoofArch);
    });

  program
    .command("fetch")
    .argument("[version]")
    .action(async (version?: string) => {
      if (fs.existsSync(INSTALL_DIR) && fs.readdirSync(INSTALL_DIR).length > 0 && !fs.existsSync(COMPAT_FLAG)) {
        rprint("Cleaning old data...", "yellow");
        await fsp.rm(INSTALL_DIR, { recursive: true, force: true });
      }

      await doSync();
      const cache = loadRepoCache();
      const config = loadConfig();

      const { repoName, verString, missingChannel } = resolveFetchTarget(cache, config, version);
      if (version && !repoName && !verString) {
        rprint("Format: <repo>/<version> or <repo>/<channel>/<version>", "red");
        return;
      }
      if (missingChannel) {
        rprint(`No versions found for channel '${missingChannel}'.`, "red");
        return;
      }

      if (!repoName || !verString) {
        rprint(`Version '${version ?? "active"}' not found in cache.`, "red");
        return;
      }

      for (const repoData of cache.repos ?? []) {
        if (repoData.name.toLowerCase() !== repoName.toLowerCase()) {
          continue;
        }
        for (const candidate of repoData.versions ?? []) {
          if (`${candidate.version}-${candidate.build}` !== verString) {
            continue;
          }
          const selected = new AvailableVersion({
            version: new Version(candidate.build, candidate.version),
            url: candidate.url,
            isPrerelease: Boolean(candidate.is_prerelease),
            assetId: candidate.asset_id,
            assetSize: candidate.asset_size,
            assetUpdatedAt: candidate.asset_updated_at,
          });
          const repoConfig = RepoConfig.findByName(repoData.name);
          if (!repoConfig) {
            rprint(`Unknown repo '${repoData.name}'.`, "red");
            return;
          }
          try {
            await new CamoufoxUpdate(repoConfig, selected).initialize().then((update) => update.update());
          } catch (error) {
            const message = String(error);
            if (message.includes("404")) {
              rprint("Release not found (404). Asset may have been removed.", "red");
              rprint("Run 'camoufox sync' to refresh available versions.", "yellow");
            } else {
              rprint(`Error: ${message}`, "red");
            }
            return;
          }
          if (ALLOW_GEOIP) {
            await downloadMmdb().catch(() => undefined);
          }
          await maybeDownloadAddons(Object.values(DefaultAddons));
          return;
        }
      }
      rprint(`Version '${version ?? verString}' not found in cache.`, "red");
    });

  program
    .command("set")
    .argument("[specifier]")
    .option("--geoip", "Select GeoIP source instead")
    .action(async (specifier?: string, options?: { geoip?: boolean }) => {
      if (options?.geoip) {
        await selectGeoipSource();
        return;
      }

      if (specifier) {
        const parts = specifier.toLowerCase().split("/");
        if (parts.length === 2) {
          const [repoName, channelType] = parts;
          if (channelType !== "stable" && channelType !== "prerelease") {
            rprint(`Unknown channel type '${channelType}'. Use 'stable' or 'prerelease'.`, "red");
            return;
          }
          setChannel(repoName, channelType);
          return;
        }
        if (parts.length === 3) {
          const [repoName, channelType, verString] = parts;
          if (channelType !== "stable" && channelType !== "prerelease") {
            rprint(`Unknown channel type '${channelType}'. Use 'stable' or 'prerelease'.`, "red");
            return;
          }
          const target = findInstalled(specifier);
          if (target) {
            setActive(target.relativePath);
            rprint(`Pinned: ${target.channelPath} (installed)`, "green");
          } else {
            console.log(chalk.bold.cyan(`Pinned: ${repoName}/${channelType}/${verString}`));
            rprint("Run 'camoufox fetch' to install.", "yellow");
          }
          const config = loadConfig();
          config.channel = `${repoName}/${channelType}`;
          config.pinned = verString;
          saveConfig(config);
          return;
        }
        rprint(`Invalid specifier '${specifier}'.`, "red");
        rprint("Use: repo/channel or repo/channel/version", "yellow");
        return;
      }

      if (!ensureSynced()) {
        return;
      }

      const cache = loadRepoCache();
      const installed = new Map(listInstalled().map((version) => [version.version.build, version]));
      const choices = [];
      for (const repoData of cache.repos ?? []) {
        const stable = (repoData.versions ?? []).find((version: Record<string, any>) => !version.is_prerelease);
        if (stable) {
          choices.push({
            name: `Follow ${repoData.name.toLowerCase()}/stable (latest: v${stable.version}-${stable.build})`,
            value: { kind: "channel", repoName: repoData.name, channelType: "stable" as const },
          });
        }
        const prerelease = (repoData.versions ?? []).find((version: Record<string, any>) => version.is_prerelease);
        if (prerelease) {
          choices.push({
            name: `Follow ${repoData.name.toLowerCase()}/prerelease (latest: v${prerelease.version}-${prerelease.build})`,
            value: { kind: "channel", repoName: repoData.name, channelType: "prerelease" as const },
          });
        }
        for (const version of (repoData.versions ?? []).slice(0, 10)) {
          const fullString = `${version.version}-${version.build}`;
          const installedVersion = installed.get(version.build);
          choices.push({
            name: `Pin ${repoData.name.toLowerCase()}/${version.is_prerelease ? "prerelease" : "stable"}/${fullString}${installedVersion ? " (installed)" : ""}`,
            value: {
              kind: "pin" as const,
              repoName: repoData.name,
              channelType: version.is_prerelease ? "prerelease" : "stable",
              version,
              installedVersion,
            },
          });
        }
      }
      const action = await inquirerSelect(choices, "Select channel or version");
      if (!action) {
        return;
      }
      if (action.kind === "channel") {
        setChannel(action.repoName, action.channelType);
      } else {
        setPinned(
          action.repoName,
          action.channelType as "stable" | "prerelease",
          action.version,
          action.installedVersion,
        );
      }
    });

  program
    .command("list")
    .argument("[mode]", "installed or all", "installed")
    .option("--path", "Show full paths")
    .action((mode = "installed", options?: { path?: boolean }) => {
      if (mode === "all") {
        listAllCommand();
        return;
      }
      listInstalledCommand(Boolean(options?.path));
    });

  program
    .command("remove")
    .argument("[versionPath]")
    .option("--select", "Interactively select a version to remove")
    .option("--yes, -y", "Skip confirmation prompts")
    .action(async (versionPath?: string, options?: { select?: boolean; yes?: boolean }) => {
      if (options?.select) {
        const installed = listInstalled();
        if (!installed.length) {
          rprint("No browser versions installed.", "yellow");
          return;
        }
        const target = await inquirerSelect(
          installed.map((version) => ({
            name: `${version.channelPath}${version.isActive ? " [active]" : ""}`,
            value: version,
          })),
          "Select version to remove",
        );
        if (!target) {
          rprint("Cancelled.", "yellow");
          return;
        }
        if (options.yes || (await confirm({ message: `Remove ${target.channelPath}?`, default: false }))) {
          await removeVersion(target.path);
          rprint(`Removed ${target.channelPath}`, "green");
        }
        return;
      }

      if (versionPath) {
        const target = findInstalled(versionPath);
        if (!target) {
          rprint(`Version '${versionPath}' not found.`, "red");
          return;
        }
        if (options?.yes || (await confirm({ message: `Remove ${target.channelPath}?`, default: false }))) {
          await removeVersion(target.path);
          rprint(`Removed ${target.channelPath}`, "green");
        }
        return;
      }

      if (!fs.existsSync(INSTALL_DIR) || fs.readdirSync(INSTALL_DIR).length === 0) {
        rprint("Nothing to remove.", "yellow");
        return;
      }
      if (options?.yes || (await confirm({ message: `Remove the camoufox data directory (${INSTALL_DIR})?`, default: false }))) {
        await fsp.rm(INSTALL_DIR, { recursive: true, force: true });
        rprint("Removed camoufox data directory.", "green");
      }
    });

  program
    .command("test")
    .argument("[url]")
    .option("--executable-path <path>")
    .action(async (url?: string, options?: { executablePath?: string }) => {
      const session = new Camoufox({
        headless: false,
        env: process.env,
        config: { showcursor: false },
        executablePath: options?.executablePath,
      });
      const browser = await session.enter();
      const page = await browser.newPage();
      if (url) {
        await page.goto(url);
      }
      await page.pause();
      await session.close();
    });

  program.command("server").action(async () => {
    await launchServer();
  });

  program
    .command("gui")
    .option("--debug", "Enable debug options in the GUI.")
    .action(async (options?: { debug?: boolean }) => {
      await launchGui(Boolean(options?.debug));
    });

  program.command("version").action(() => {
    new VersionInfo().printAll();
  });

  program.command("active").action(() => {
    const config = loadConfig();
    const pinned = config.pinned;
    const channel = config.channel ?? getDefaultChannel();
    if (pinned) {
      const display = `${channel.toLowerCase()}/${pinned}`;
      const target = findInstalled(display);
      if (target) {
        console.log(target.channelPath);
      } else {
        process.stdout.write(`${display} `);
        rprint("(not fetched)", "yellow");
      }
      return;
    }
    const active = listInstalled().find((version) => version.isActive);
    if (active) {
      console.log(active.channelPath);
      return;
    }
    process.stdout.write(`${channel.toLowerCase()} `);
    rprint("(not fetched)", "yellow");
  });

  program.command("path").action(() => {
    console.log(INSTALL_DIR);
  });

  await program.parseAsync(argv);
}
