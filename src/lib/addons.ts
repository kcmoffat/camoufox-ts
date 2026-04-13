import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { InvalidAddonPath } from "./exceptions";
import { INSTALL_DIR, unzip, webdl } from "./pkgman";

export const ADDONS_DIR = path.join(INSTALL_DIR, "addons");

export enum DefaultAddons {
  UBO = "https://addons.mozilla.org/firefox/downloads/latest/ublock-origin/latest.xpi",
}

export function confirmPaths(paths: string[]): void {
  for (const addonPath of paths) {
    if (!fs.existsSync(addonPath) || !fs.statSync(addonPath).isDirectory()) {
      throw new InvalidAddonPath(addonPath);
    }
    if (!fs.existsSync(path.join(addonPath, "manifest.json"))) {
      throw new InvalidAddonPath(
        "manifest.json is missing. Addon path must be a path to an extracted addon.",
      );
    }
  }
}

export async function addDefaultAddons(
  addonsList: string[],
  excludeList: DefaultAddons[] = [],
): Promise<void> {
  const addons = Object.values(DefaultAddons).filter(
    (addon) => !excludeList.includes(addon as DefaultAddons),
  ) as DefaultAddons[];
  await maybeDownloadAddons(addons, addonsList);
}

export async function downloadAndExtract(url: string, extractPath: string, name: string): Promise<void> {
  const tempFile = path.join(os.tmpdir(), `camoufox-addon-${name}-${Date.now()}.xpi`);
  try {
    await webdl(url, {
      destination: tempFile,
      desc: `Downloading addon (${name})`,
      bar: false,
    });
    await unzip(tempFile, extractPath, `Extracting addon (${name})`);
  } finally {
    await fsp.rm(tempFile, { force: true });
  }
}

export function getAddonPath(addonName: string): string {
  return path.join(ADDONS_DIR, addonName);
}

export async function maybeDownloadAddons(
  addons: DefaultAddons[],
  addonsList?: string[],
): Promise<void> {
  await fsp.mkdir(ADDONS_DIR, { recursive: true });
  for (const addon of addons) {
    const addonName = addon.split("/").at(-2) === "latest" ? "UBO" : addon;
    const addonPath = getAddonPath(addonName);
    if (fs.existsSync(addonPath)) {
      addonsList?.push(addonPath);
      continue;
    }
    await fsp.mkdir(addonPath, { recursive: true });
    try {
      await downloadAndExtract(addon, addonPath, addonName);
      addonsList?.push(addonPath);
    } catch (error) {
      console.error(`Failed to download and extract ${addonName}:`, error);
    }
  }
}
