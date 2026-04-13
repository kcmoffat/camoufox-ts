import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import envPaths from "env-paths";
import maxmind from "maxmind";
import { stringify as stringifyYaml, parse as parseYaml } from "yaml";

import { Geolocation, SELECTOR } from "./locales";
import { NotInstalledGeoIPExtra, UnknownIPLocation } from "./exceptions";
import { validateIp } from "./ip";
import { loadYaml, rprint, unzip, webdl } from "./pkgman";

export const ALLOW_GEOIP = true;
export const GEOIP_DIR = path.join(envPaths("camoufox", { suffix: "" }).cache, "geoip");
export const MMDB_DIR = path.join(GEOIP_DIR, "mmdb");
export const GEOIP_CONFIG = path.join(GEOIP_DIR, "config.yml");

function findIn(data: Record<string, any>, key: string): any {
  let cursor: any = data;
  for (const part of key.split(".")) {
    if (cursor == null || typeof cursor !== "object") {
      return undefined;
    }
    cursor = cursor[part];
  }
  return cursor;
}

export function loadGeoipRepos(): [Array<Record<string, any>>, string] {
  const data = loadYaml("repos.yml");
  return [data.geoip ?? [], data.default?.geoip ?? "GeoLite2"];
}

export function getGeoipConfigByName(name?: string): Record<string, any> {
  const [repos, defaultName] = loadGeoipRepos();
  const targetName = name ?? defaultName;
  const repo = repos.find((entry) => entry.name?.toLowerCase() === targetName.toLowerCase());
  if (repo) {
    if (!repo.urls) {
      throw new Error(`GeoIP repo '${repo.name}' missing required urls`);
    }
    if (!repo.paths) {
      throw new Error(`GeoIP repo '${repo.name}' missing required paths`);
    }
    return repo;
  }
  if (name) {
    throw new Error(
      `GeoIP database '${name}' not found. Available: ${repos.map((entry) => entry.name).join(", ")}`,
    );
  }
  if (!repos.length) {
    throw new Error("No GeoIP repos configured in repos.yml");
  }
  return repos[0];
}

export function loadGeoipConfig(): Record<string, any> {
  if (fs.existsSync(GEOIP_CONFIG)) {
    try {
      const saved = parseYaml(fs.readFileSync(GEOIP_CONFIG, "utf8")) as Record<string, any>;
      return getGeoipConfigByName(saved.name);
    } catch {}
  }
  return getGeoipConfigByName();
}

export async function saveGeoipConfig(config: Record<string, any>): Promise<void> {
  await fsp.mkdir(GEOIP_DIR, { recursive: true });
  await fsp.writeFile(GEOIP_CONFIG, stringifyYaml({ name: config.name }));
}

export function getMmdbPath(ipVersion = "ipv4", config = loadGeoipConfig()): string {
  const name = String(config.name ?? "geolite2").toLowerCase();
  if (config.urls?.combined) {
    return path.join(MMDB_DIR, `${name}-combined.mmdb`);
  }
  return path.join(MMDB_DIR, `${name}-${ipVersion}.mmdb`);
}

export function geoipAllowed(): void {
  if (!ALLOW_GEOIP) {
    throw new NotInstalledGeoIPExtra(
      "Please install the geoip extra to use this feature.",
    );
  }
}

export async function downloadMmdb(
  source?: string,
  progressCallback?: (downloaded: number, total: number) => void,
): Promise<void> {
  geoipAllowed();

  const config = source ? getGeoipConfigByName(source) : loadGeoipConfig();
  const urls = config.urls as Record<string, string | string[]>;
  const name = String(config.name).toLowerCase();
  const extract = Boolean(config.extract);
  const isCombined = "combined" in urls;

  await fsp.mkdir(MMDB_DIR, { recursive: true });

  for (const [ipVersion, urlList] of Object.entries(urls)) {
    const suffix = isCombined ? "" : ` (${ipVersion})`;
    const mmdbPath = path.join(MMDB_DIR, `${name}-${ipVersion}.mmdb`);
    const downloadDesc = `Downloading ${config.name}${suffix}`;
    const extractDesc = `Extracting ${config.name}${suffix}`;

    let lastError: unknown;
    for (const url of Array.isArray(urlList) ? urlList : [urlList]) {
      const tempFile = path.join(os.tmpdir(), `camoufox-geoip-${Date.now()}-${Math.random()}.tmp`);
      try {
        await webdl(url, {
          destination: tempFile,
          desc: downloadDesc,
          progressCallback,
          bar: progressCallback == null,
        });

        if (extract) {
          const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "camoufox-geoip-"));
          try {
            await unzip(tempFile, tempDir, extractDesc);
            const mmdbFile = await findFirstMmdb(tempDir);
            if (!mmdbFile) {
              throw new Error("No .mmdb file found in archive");
            }
            await fsp.rename(mmdbFile, mmdbPath);
          } finally {
            await fsp.rm(tempDir, { recursive: true, force: true });
          }
        } else {
          await fsp.copyFile(tempFile, mmdbPath);
        }
        await fsp.rm(tempFile, { force: true });
        break;
      } catch (error) {
        lastError = error;
        await fsp.rm(tempFile, { force: true });
      }
    }
    if (lastError && !fs.existsSync(mmdbPath)) {
      throw lastError;
    }
  }

  await saveGeoipConfig(config);
}

export async function removeMmdb(): Promise<void> {
  if (!fs.existsSync(GEOIP_DIR)) {
    rprint("GeoIP database not found.");
    return;
  }
  await fsp.rm(GEOIP_DIR, { recursive: true, force: true });
  rprint("GeoIP database removed.");
}

export function needsUpdate(config = loadGeoipConfig()): boolean {
  const target = getMmdbPath(config.urls?.combined ? "combined" : "ipv4", config);
  if (!fs.existsSync(target)) {
    return true;
  }
  const age = Date.now() - fs.statSync(target).mtimeMs;
  return age > 30 * 24 * 60 * 60 * 1000;
}

export async function getGeolocation(ip: string, geoipDb?: string): Promise<Geolocation> {
  validateIp(ip);

  const config = geoipDb ? getGeoipConfigByName(geoipDb) : loadGeoipConfig();
  const mmdbPath = getMmdbPath(ip.includes(":") ? "ipv6" : "ipv4", config);

  if (!fs.existsSync(mmdbPath) || needsUpdate(config)) {
    await downloadMmdb(config.name);
  }

  const reader = await maxmind.open<Record<string, any>>(mmdbPath);
  const response = reader.get(ip);
  if (!response) {
    throw new UnknownIPLocation(`IP not found in database: ${ip}`);
  }

  const paths = config.paths as Record<string, string>;
  const isoCode = String(findIn(response, paths.iso_code)).toUpperCase();
  const longitude = Number(findIn(response, paths.longitude));
  const latitude = Number(findIn(response, paths.latitude));
  const timezone = String(findIn(response, paths.timezone));
  const locale = SELECTOR.fromRegion(isoCode);

  return new Geolocation({
    locale,
    longitude,
    latitude,
    timezone,
  });
}

async function findFirstMmdb(root: string): Promise<string | undefined> {
  const entries = await fsp.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isFile() && entry.name.endsWith(".mmdb")) {
      return fullPath;
    }
    if (entry.isDirectory()) {
      const nested = await findFirstMmdb(fullPath);
      if (nested) {
        return nested;
      }
    }
  }
  return undefined;
}
