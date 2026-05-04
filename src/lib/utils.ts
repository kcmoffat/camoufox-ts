import fs from "node:fs";
import fsp from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

import systeminformation from "systeminformation";
import { UAParser } from "ua-parser-js";
import type { Fingerprint } from "fingerprint-generator";

import { normalizeSnakeCaseKeys } from "./case";
import { DefaultAddons, addDefaultAddons, confirmPaths } from "./addons";
import { LeakWarning } from "./_warnings";
import {
  InvalidOS,
  InvalidPropertyType,
  NonFirefoxFingerprint,
} from "./exceptions";
import {
  fromBrowserforge,
  fromPreset,
  generateFingerprint,
  generateRandomFontSubset,
  generateRandomVoiceSubset,
  getRandomPreset,
  type ScreenConstraint,
} from "./fingerprints";
import { geoipAllowed, getGeolocation } from "./geolocation";
import { Proxy, publicIp, validIPv4, validIPv6 } from "./ip";
import { handleLocales } from "./locales";
import { findInstalledVersion } from "./multiversion";
import { camoufoxPath, getPath, INSTALL_DIR, launchPath, OS_NAME, Version } from "./pkgman";
import { VirtualDisplay } from "./virtdisplay";
import { sampleWebgl } from "./webgl";
import { assetPath } from "./assets";

export type ListOrString = string | string[] | readonly string[];

const CACHE_PREFS = {
  "browser.sessionhistory.max_entries": 10,
  "browser.sessionhistory.max_total_viewers": -1,
  "browser.cache.memory.enable": true,
  "browser.cache.disk_cache_ssl": true,
  "browser.cache.disk.smart_size.enabled": true,
} as const;

export async function getEnvVars(
  configMap: Record<string, any>,
  userAgentOs: "mac" | "win" | "lin",
): Promise<Record<string, string>> {
  const envVars: Record<string, string> = {};
  const configString = JSON.stringify(configMap);
  const chunkSize = OS_NAME === "win" ? 2047 : 32767;

  for (let index = 0; index < configString.length; index += chunkSize) {
    envVars[`CAMOU_CONFIG_${Math.floor(index / chunkSize) + 1}`] = configString.slice(
      index,
      index + chunkSize,
    );
  }

  if (OS_NAME === "lin") {
    const osDir = { lin: "linux", mac: "macos", win: "windows" }[userAgentOs];
    const fontConfigPath = await getPath(path.join("fontconfigs", osDir));
    const bundledFontConfig = path.join(fontConfigPath, "fonts.conf");
    if (!fs.existsSync(bundledFontConfig)) {
      throw new Error(
        `fonts.conf not found in ${fontConfigPath}! Something is wrong with your Camoufox bundle.`,
      );
    }
    envVars.FONTCONFIG_FILE = await generateRuntimeFontConfig(fontConfigPath);
  }

  return envVars;
}

export async function generateRuntimeFontConfig(fontConfigPath: string): Promise<string> {
  const fontsDir = await getPath("fonts");
  const bundledFontConfig = path.join(fontConfigPath, "fonts.conf");
  const confContent = await fsp.readFile(bundledFontConfig, "utf8");
  const runtimeContent = confContent.replace(
    '<dir prefix="cwd">fonts</dir>',
    `<dir>${fontsDir}</dir>`,
  );

  const cacheDir = path.join(INSTALL_DIR, "fontconfig");
  await fsp.mkdir(cacheDir, { recursive: true });

  const contentHash = crypto.createHash("sha256").update(runtimeContent).digest("hex").slice(0, 12);
  const runtimePath = path.join(cacheDir, `fonts-${contentHash}.conf`);

  if (!fs.existsSync(runtimePath)) {
    await fsp.writeFile(runtimePath, runtimeContent, "utf8");
  }

  return runtimePath;
}

async function loadProperties(executablePath?: string): Promise<Record<string, string>> {
  const localPropertyPath = executablePath
    ? path.join(path.dirname(executablePath), "properties.json")
    : fs.existsSync(assetPath("properties.json"))
      ? assetPath("properties.json")
      : await getPath("properties.json");
  const raw = JSON.parse(await fsp.readFile(localPropertyPath, "utf8")) as Array<{
    property: string;
    type: string;
  }>;
  return Object.fromEntries(raw.map((entry) => [entry.property, entry.type]));
}

export async function validateConfig(configMap: Record<string, any>, executablePath?: string): Promise<void> {
  const propertyTypes = await loadProperties(executablePath);
  for (const [key, value] of Object.entries(configMap)) {
    const expectedType = propertyTypes[key];
    if (!expectedType) {
      console.log(`Skipping unknown patch ${key} : ${String(value)}`);
      continue;
    }
    if (!validateType(value, expectedType)) {
      throw new InvalidPropertyType(
        `Invalid type for property ${key}. Expected ${expectedType}, got ${typeof value}`,
      );
    }
  }
}

export function validateType(value: any, expectedType: string): boolean {
  switch (expectedType) {
    case "str":
      return typeof value === "string";
    case "int":
      return Number.isInteger(value);
    case "uint":
      return Number.isInteger(value) && value >= 0;
    case "double":
      return typeof value === "number";
    case "bool":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "dict":
      return value != null && typeof value === "object" && !Array.isArray(value);
    default:
      return false;
  }
}

export function getTargetOs(config: Record<string, any>): "mac" | "win" | "lin" {
  if (config["navigator.userAgent"]) {
    return determineUaOs(config["navigator.userAgent"]);
  }
  return OS_NAME;
}

export function determineUaOs(userAgent: string): "mac" | "win" | "lin" {
  const osName = new UAParser(userAgent).getOS().name ?? "";
  const normalizedOsName = osName.toLowerCase();
  if (normalizedOsName.startsWith("mac")) {
    return "mac";
  }
  if (normalizedOsName.startsWith("windows")) {
    return "win";
  }
  return "lin";
}

export async function getScreenCons(headless?: boolean | "virtual"): Promise<ScreenConstraint | undefined> {
  if (headless === false) {
    return undefined;
  }
  try {
    const graphics = await systeminformation.graphics();
    const display = graphics.displays
      .filter((entry) => entry.currentResX != null && entry.currentResY != null)
      .sort(
        (left, right) =>
          (right.currentResX ?? 0) * (right.currentResY ?? 0) -
          (left.currentResX ?? 0) * (left.currentResY ?? 0),
      )[0];
    if (!display) {
      return undefined;
    }
    return {
      maxWidth: display.currentResX ?? undefined,
      maxHeight: display.currentResY ?? undefined,
    };
  } catch {
    return undefined;
  }
}

export async function updateFonts(config: Record<string, any>, targetOs: "mac" | "win" | "lin"): Promise<void> {
  const fonts = JSON.parse(await fsp.readFile(assetPath("fonts.json"), "utf8")) as Record<
    string,
    string[]
  >;
  const nextFonts = fonts[targetOs] ?? [];
  config.fonts = Array.from(new Set([...(config.fonts ?? []), ...nextFonts]));
}

export function checkCustomFingerprint(fingerprint: Fingerprint): void {
  const browserName = new UAParser(fingerprint.navigator.userAgent).getBrowser().name ?? "Non-Firefox";
  if (browserName !== "Firefox") {
    throw new NonFirefoxFingerprint(
      `"${browserName}" fingerprints are not supported in Camoufox. Using fingerprints from a browser other than Firefox WILL lead to detection. If this is intentional, pass \`i_know_what_im_doing=true\`.`,
    );
  }
  LeakWarning.warn("custom_fingerprint", false);
}

export function checkValidOs(os: ListOrString): void {
  const values = Array.isArray(os) ? [...os] : [os];
  for (const value of values) {
    if (typeof value !== "string") {
      throw new InvalidOS(`OS values must be strings: '${String(value)}'`);
    }
    if (value !== value.toLowerCase()) {
      throw new InvalidOS(`OS values must be lowercase: '${value}'`);
    }
    if (!["windows", "macos", "linux"].includes(value)) {
      throw new InvalidOS(`Camoufox does not support the OS: '${value}'`);
    }
  }
}

export function mergeInto(target: Record<string, any>, source: Record<string, any>): void {
  for (const [key, value] of Object.entries(source)) {
    if (!(key in target)) {
      target[key] = value;
    }
  }
}

export function setInto(target: Record<string, any>, key: string, value: any): void {
  if (!(key in target)) {
    target[key] = value;
  }
}

export function isDomainSet(config: Record<string, any>, ...properties: string[]): boolean {
  return properties.some((property) =>
    property.endsWith(".") || property.endsWith(":")
      ? Object.keys(config).some((key) => key.startsWith(property))
      : property in config,
  );
}

export function warnManualConfig(config: Record<string, any>): void {
  if (isDomainSet(config, "navigator.language", "navigator.languages", "headers.Accept-Language", "locale:")) {
    LeakWarning.warn("locale", false);
  }
  if (isDomainSet(config, "geolocation:", "timezone")) {
    LeakWarning.warn("geolocation", false);
  }
  if (isDomainSet(config, "headers.User-Agent")) {
    LeakWarning.warn("header-ua", false);
  }
  if (isDomainSet(config, "navigator.")) {
    LeakWarning.warn("navigator", false);
  }
  if (isDomainSet(config, "screen.", "window.", "document.body.")) {
    LeakWarning.warn("viewport", false);
  }
}

export async function attachVirtualDisplay<T extends { close: (...args: any[]) => Promise<any> }>(
  browser: T,
  virtualDisplay?: VirtualDisplay,
): Promise<T> {
  if (!virtualDisplay) {
    return browser;
  }
  const close = browser.close.bind(browser);
  browser.close = async (...args: any[]) => {
    try {
      return await close(...args);
    } finally {
      virtualDisplay.kill();
    }
  };
  (browser as any)._virtual_display = virtualDisplay;
  return browser;
}

export async function launchOptions(input: {
  config?: Record<string, any>;
  os?: ListOrString;
  blockImages?: boolean;
  blockWebrtc?: boolean;
  blockWebgl?: boolean;
  disableCoop?: boolean;
  webglConfig?: [string, string];
  geoip?: string | boolean;
  geoipDb?: string;
  humanize?: boolean | number;
  locale?: string | string[];
  addons?: string[];
  fonts?: string[];
  customFontsOnly?: boolean;
  excludeAddons?: DefaultAddons[];
  screen?: ScreenConstraint;
  window?: [number, number];
  fingerprint?: Fingerprint;
  fingerprintPreset?: boolean | Record<string, any>;
  ffVersion?: number | string;
  headless?: boolean | "virtual";
  mainWorldEval?: boolean;
  executablePath?: string;
  browser?: string;
  firefoxUserPrefs?: Record<string, any>;
  proxy?: Record<string, string>;
  enableCache?: boolean;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  iKnowWhatImDoing?: boolean;
  debug?: boolean;
  virtualDisplay?: string;
  [key: string]: any;
}): Promise<Record<string, any>> {
  const normalizedInput = normalizeSnakeCaseKeys(input);
  const {
    config: passedConfig,
    os,
    blockImages,
    blockWebrtc,
    blockWebgl,
    disableCoop,
    webglConfig,
    geoip,
    geoipDb,
    humanize,
    locale,
    addons = [],
    fonts,
    customFontsOnly = false,
    excludeAddons,
    screen,
    window,
    fingerprint,
    fingerprintPreset,
    ffVersion,
    headless = false,
    mainWorldEval,
    executablePath,
    browser,
    firefoxUserPrefs = {},
    proxy,
    enableCache,
    args = [],
    env = process.env,
    iKnowWhatImDoing = false,
    debug,
    virtualDisplay,
    ...extraLaunchOptions
  } = normalizedInput;

  const config = passedConfig ?? {};
  const environment = { ...env } as Record<string, string>;
  const requestedBrowserPath = browser ? resolveInstalledBrowserPath(browser) : undefined;

  if (virtualDisplay) {
    environment.DISPLAY = virtualDisplay;
    // Xvfb exposes an X11 display. Force GTK/Firefox to honor it even when the
    // host session exports Wayland-specific environment variables.
    environment.GDK_BACKEND = "x11";
    delete environment.WAYLAND_DISPLAY;
    environment.MOZ_ENABLE_WAYLAND = "0";
  }

  if (!iKnowWhatImDoing) {
    warnManualConfig(config);
  }
  if (os) {
    checkValidOs(os);
  } else if (webglConfig) {
    throw new Error("OS must be set when using webgl_config");
  }

  await addDefaultAddons(addons, excludeAddons);
  if (addons.length > 0) {
    confirmPaths(addons);
    config.addons = addons;
  }

  const ffVersionStr =
    ffVersion != null
      ? (LeakWarning.warn("ff_version", iKnowWhatImDoing), String(ffVersion))
      : resolveFirefoxVersion(
          await resolveVersionSourcePath({
            browserPath: requestedBrowserPath,
            executablePath,
          }),
        );
  let usedPreset = false;

  if (fingerprint != null) {
    if (!iKnowWhatImDoing) {
      checkCustomFingerprint(fingerprint);
    }
  } else if (fingerprintPreset != null) {
    const preset =
      typeof fingerprintPreset === "object" ? fingerprintPreset : getRandomPreset(os as string | string[]);
    if (preset) {
      mergeInto(config, fromPreset(preset, ffVersionStr));
      usedPreset = true;
    }
  }

  let generatedFingerprint = fingerprint;
  if (!usedPreset && generatedFingerprint == null) {
    generatedFingerprint = generateFingerprint({
      screen: screen ?? (await getScreenCons(headless || "DISPLAY" in environment)),
      window,
      os: os as string | string[] | undefined,
    });
  }

  if (!usedPreset && generatedFingerprint) {
    mergeInto(config, fromBrowserforge(generatedFingerprint, ffVersionStr));
  }

  const targetOs = getTargetOs(config);
  setInto(config, "window.history.length", randRange(1, 6));

  if (fonts) {
    config.fonts = fonts;
  }

  if (customFontsOnly) {
    firefoxUserPrefs["gfx.bundled-fonts.activate"] = 0;
    if (fonts?.length) {
      LeakWarning.warn("custom_fonts_only");
    } else {
      throw new Error("No custom fonts were passed, but `custom_fonts_only` is enabled.");
    }
  } else if (!config.fonts?.length) {
    try {
      config.fonts = generateRandomFontSubset({ win: "windows", mac: "macos", lin: "linux" }[targetOs]);
    } catch {
      await updateFonts(config, targetOs);
    }
  }

  if (!config.voices) {
    try {
      config.voices = generateRandomVoiceSubset({ win: "windows", mac: "macos", lin: "linux" }[targetOs]);
    } catch {}
  }

  setInto(config, "fonts:spacing_seed", randomSeed());
  setInto(config, "audio:seed", randomSeed());
  setInto(config, "canvas:seed", randomSeed());

  if (geoip) {
    geoipAllowed();
    let resolvedIp = geoip;
    if (geoip === true) {
      resolvedIp = proxy ? await publicIp(new Proxy(proxy as { server: string; username?: string; password?: string; bypass?: string }).asString()) : await publicIp();
    }
    if (!blockWebrtc) {
      if (validIPv4(String(resolvedIp))) {
        setInto(config, "webrtc:ipv4", resolvedIp);
        firefoxUserPrefs["network.dns.disableIPv6"] = true;
      } else if (validIPv6(String(resolvedIp))) {
        setInto(config, "webrtc:ipv6", resolvedIp);
      }
    }
    const geolocation = await getGeolocation(String(resolvedIp), geoipDb);
    for (const [key, value] of Object.entries(geolocation.asConfig())) {
      if (key === "timezone" || key.startsWith("locale:")) {
        setInto(config, key, value);
      } else {
        config[key] = value;
      }
    }
  } else if (proxy && !proxy.server?.includes("localhost") && !isDomainSet(config, "geolocation")) {
    LeakWarning.warn("proxy_without_geoip");
  }

  if (locale) {
    handleLocales(locale, config);
  }

  if (humanize) {
    setInto(config, "humanize", true);
    if (typeof humanize === "number") {
      setInto(config, "humanize:maxTime", humanize);
    }
  }

  if (mainWorldEval) {
    setInto(config, "allowMainWorld", true);
  }

  if (blockImages) {
    LeakWarning.warn("block_images", iKnowWhatImDoing);
    firefoxUserPrefs["permissions.default.image"] = 2;
  }
  if (blockWebrtc) {
    firefoxUserPrefs["media.peerconnection.enabled"] = false;
  }
  if (disableCoop) {
    LeakWarning.warn("disable_coop", iKnowWhatImDoing);
    firefoxUserPrefs["browser.tabs.remote.useCrossOriginOpenerPolicy"] = false;
  }

  if (blockWebgl || extraLaunchOptions.allowWebgl === false) {
    firefoxUserPrefs["webgl.disabled"] = true;
    LeakWarning.warn("block_webgl", iKnowWhatImDoing);
  } else {
    const sampled =
      webglConfig != null
        ? sampleWebgl(targetOs, webglConfig[0], webglConfig[1])
        : config["webGl:vendor"] && config["webGl:renderer"]
          ? sampleWebgl(targetOs, config["webGl:vendor"], config["webGl:renderer"])
          : sampleWebgl(targetOs);
    const { webGl2Enabled, ...webglFingerprint } = sampled;
    mergeInto(config, webglFingerprint);
    mergeInto(firefoxUserPrefs, {
      "webgl.enable-webgl2": webGl2Enabled,
      "webgl.force-enabled": true,
    });
  }

  if (enableCache) {
    mergeInto(firefoxUserPrefs, CACHE_PREFS);
  }

  if (debug) {
    console.log("[DEBUG] Config:");
    console.dir(config, { depth: null });
  }

  await validateConfig(config, executablePath);
  const envVars = {
    ...(await getEnvVars(config, targetOs)),
    ...environment,
  };

  const resolvedExecutablePath = executablePath
    ? executablePath
    : requestedBrowserPath
      ? await launchPath(requestedBrowserPath)
      : await launchPath();

  const result: Record<string, any> = {
    executablePath: resolvedExecutablePath,
    args,
    env: envVars,
    firefoxUserPrefs,
    headless,
    ...extraLaunchOptions,
  };
  if (proxy) {
    result.proxy = proxy;
  }
  return result;
}

export const launch_options = launchOptions;

function resolveInstalledBrowserPath(browser: string): string {
  const browserPath = findInstalledVersion(browser);
  if (!browserPath) {
    throw new Error(
      `Browser version '${browser}' not found. Run \`camoufox list\` to see installed versions.`,
    );
  }
  return browserPath;
}

async function resolveVersionSourcePath(input: {
  browserPath?: string;
  executablePath?: string;
}): Promise<string> {
  if (input.browserPath) {
    return input.browserPath;
  }

  if (input.executablePath) {
    const executableBundlePath = findBundleRoot(input.executablePath);
    if (executableBundlePath) {
      return executableBundlePath;
    }
  }

  return camoufoxPath();
}

function findBundleRoot(executablePath: string): string | undefined {
  let current = path.dirname(executablePath);

  while (true) {
    if (fs.existsSync(path.join(current, "version.json"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function resolveFirefoxVersion(bundlePath: string): string {
  const version = Version.fromPath(bundlePath).version;
  if (!version) {
    throw new Error(`Version information not found at ${path.join(bundlePath, "version.json")}.`);
  }
  return version.split(".", 1)[0];
}

function randomSeed(): number {
  return Math.floor(Math.random() * 4_294_967_295) + 1;
}

function randRange(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min)) + min;
}
