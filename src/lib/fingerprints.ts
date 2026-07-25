import fs from "node:fs";

import type {
  Fingerprint,
  FingerprintGeneratorOptions,
  ScreenFingerprint,
} from "fingerprint-generator";
import { FingerprintGenerator } from "fingerprint-generator";

import { assetPath } from "./assets";
import { handleLocale } from "./locales";
import { loadYaml, OS_ARCH_MATRIX } from "./pkgman";
import { sampleWebgl } from "./webgl";

export type ScreenConstraint = {
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
};

const BROWSERFORGE_DATA = loadYaml("browserforge.yml");
const FP_GENERATOR = new FingerprintGenerator({
  browsers: [{ name: "firefox" }],
  operatingSystems: ["linux", "macos", "windows"],
  devices: ["desktop"],
});

const PRESETS_FILE = assetPath("fingerprint-presets.json");
const PRESETS_V150_FILE = assetPath("fingerprint-presets-v150.json");
const PRESETS_V150_MIN_FF = 149;
const presetsCache = new Map<string, Record<string, any>>();
let fontsCache: Record<string, string[]> | undefined;
type VoiceEntry = [name: string, lang: string, voiceType: string];
type VoiceObject = {
  name: string;
  lang: string;
  voiceUri: string;
  isDefault: boolean;
  isLocalService: boolean;
};

let voicesCache: Record<string, VoiceEntry[]> | undefined;

const MACOS_MARKER_FONTS = ["Helvetica Neue", "PingFang HK", "PingFang SC", "PingFang TC"];
const LINUX_MARKER_FONTS = ["Arimo", "Cousine", "Tinos", "Twemoji Mozilla"];
const WINDOWS_MARKER_FONTS = ["Segoe UI", "Tahoma", "Cambria Math", "Nirmala UI"];

const ESSENTIAL_FONTS_MACOS = [
  "Arial",
  "Helvetica",
  "Times New Roman",
  "Courier New",
  "Verdana",
  "Georgia",
  "Trebuchet MS",
  "Tahoma",
  "Helvetica Neue",
  "Lucida Grande",
  "Menlo",
  "Monaco",
  "Geneva",
  "PingFang HK",
  "PingFang SC",
  "PingFang TC",
];

const ESSENTIAL_FONTS_WINDOWS = [
  "Arial",
  "Times New Roman",
  "Courier New",
  "Verdana",
  "Georgia",
  "Trebuchet MS",
  "Tahoma",
  "Segoe UI",
  "Calibri",
  "Cambria Math",
  "Nirmala UI",
  "Consolas",
];

const ESSENTIAL_FONTS_LINUX = [
  "Arimo",
  "Cousine",
  "Tinos",
  "Twemoji Mozilla",
  "Noto Sans Devanagari",
  "Noto Sans JP",
  "Noto Sans KR",
  "Noto Sans SC",
  "Noto Sans TC",
];

const ESSENTIAL_VOICES_MACOS = ["Samantha", "Alex", "Fred", "Victoria", "Karen", "Daniel"];
const VOICE_URI_PREFIX: Record<"mac" | "win" | "lin", string> = {
  mac: "urn:moz-tts:osx:",
  win: "urn:moz-tts:sapi:",
  lin: "urn:moz-tts:speechd:",
};

const OS_TO_PRESET_KEY: Record<string, string> = {
  windows: "windows",
  macos: "macos",
  linux: "linux",
  win: "windows",
  mac: "macos",
  lin: "linux",
};

function ensureMarkerFonts(fonts: string[], markers: string[]): void {
  for (const marker of markers) {
    if (!fonts.includes(marker)) {
      fonts.push(marker);
    }
  }
}

function loadOsFonts(): Record<string, string[]> {
  if (!fontsCache) {
    fontsCache = JSON.parse(fs.readFileSync(assetPath("fonts.json"), "utf8")) as Record<
      string,
      string[]
    >;
  }
  return fontsCache;
}

function loadOsVoices(): Record<string, VoiceEntry[]> {
  if (!voicesCache) {
    const raw = JSON.parse(fs.readFileSync(assetPath("voices.json"), "utf8")) as Record<
      string,
      string[]
    >;
    voicesCache = Object.fromEntries(
      Object.entries(raw).map(([key, values]) => [
        key,
        values.flatMap((value) => {
          const last = value.lastIndexOf(":");
          if (last < 0) {
            return [];
          }
          const voiceType = value.slice(last + 1);
          const before = value.slice(0, last);
          const langSep = before.lastIndexOf(":");
          if (langSep < 0) {
            return [];
          }
          const lang = before.slice(langSep + 1);
          const name = before.slice(0, langSep);
          return name && lang ? [[name, lang, voiceType] satisfies VoiceEntry] : [];
        }),
      ]),
    );
  }
  return voicesCache;
}

function getPlatformTargetOs(platform: string): "macos" | "windows" | "linux" {
  if (platform === "Win32") {
    return "windows";
  }
  if (platform.toLowerCase().includes("linux")) {
    return "linux";
  }
  return "macos";
}

function getContextWebglOsKey(
  os: string | string[] | undefined,
  platform: string,
): keyof typeof OS_ARCH_MATRIX {
  const osKeyMap: Record<"macos" | "windows" | "linux", keyof typeof OS_ARCH_MATRIX> = {
    macos: "mac",
    windows: "win",
    linux: "lin",
  };
  const requestedOs = typeof os === "string" ? OS_TO_PRESET_KEY[os] ?? os : undefined;
  const requestedOsKey = osKeyMap[requestedOs as "macos" | "windows" | "linux"];
  if (requestedOsKey) {
    return requestedOsKey;
  }

  return osKeyMap[getPlatformTargetOs(platform)];
}

function pickRandomSubset<T>(values: T[], percentageMin: number, percentageMax: number): T[] {
  const pct = percentageMin + Math.floor(Math.random() * (percentageMax - percentageMin + 1));
  const count = Math.round((pct / 100) * values.length);
  return shuffle(values).slice(0, Math.min(count, values.length));
}

function shuffle<T>(values: T[]): T[] {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

export function generateRandomFontSubset(targetOs: string): string[] {
  const osFonts = loadOsFonts();
  const osKey = { macos: "mac", windows: "win", linux: "lin" }[targetOs] ?? "mac";
  const fullList = osFonts[osKey] ?? osFonts.mac ?? [];

  let essential = new Set<string>(ESSENTIAL_FONTS_MACOS);
  let markers = MACOS_MARKER_FONTS;
  if (targetOs === "windows") {
    essential = new Set(ESSENTIAL_FONTS_WINDOWS);
    markers = WINDOWS_MARKER_FONTS;
  } else if (targetOs === "linux") {
    essential = new Set(ESSENTIAL_FONTS_LINUX);
    markers = LINUX_MARKER_FONTS;
  }

  const result = fullList.filter((font) => essential.has(font));
  const nonEssential = fullList.filter((font) => !essential.has(font));
  result.push(...pickRandomSubset(nonEssential, 30, 78));
  ensureMarkerFonts(result, markers);
  return Array.from(new Set(result));
}

function voiceUriSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
}

function voiceUri(osKey: "mac" | "win" | "lin", name: string, lang: string): string {
  if (osKey === "lin") {
    let escaped = "";
    for (const ch of name) {
      if (ch === " ") {
        escaped += "%20";
      } else if (ch.charCodeAt(0) <= 0x7f) {
        escaped += ch;
      } else {
        escaped += Array.from(Buffer.from(ch)).map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`).join("");
      }
    }
    return `${VOICE_URI_PREFIX.lin}${escaped}?${lang}`;
  }

  return `${VOICE_URI_PREFIX[osKey]}${voiceUriSlug(name)}`;
}

export function generateRandomVoiceSubset(targetOs: string, locale?: string): VoiceObject[] {
  const osVoices = loadOsVoices();
  const osKey = ({ macos: "mac", windows: "win", linux: "lin" }[targetOs] ?? "mac") as
    | "mac"
    | "win"
    | "lin";
  const fullList = osVoices[osKey] ?? [];
  if (!fullList.length) {
    return [];
  }

  let selected: VoiceEntry[];
  if (osKey === "win" || osKey === "lin") {
    selected = [...fullList];
  } else {
    const essential = new Set(ESSENTIAL_VOICES_MACOS);
    const result = fullList.filter(([name]) => essential.has(name));
    const nonEssential = fullList.filter(([name]) => !essential.has(name));
    result.push(...pickRandomSubset(nonEssential, 40, 80));
    selected = result;
  }

  const unique = new Map<string, VoiceObject>();
  for (const [name, lang, voiceType] of selected) {
    unique.set(`${name}:${lang}:${voiceType}`, {
      name,
      lang,
      voiceUri: voiceUri(osKey, name, lang),
      isDefault: false,
      isLocalService: voiceType === "local",
    });
  }

  const voices = [...unique.values()];
  if (voices.length) {
    const prefix = locale?.split("-")[0]?.toLowerCase() ?? "en";
    const exactMatchIndex = locale
      ? voices.findIndex((voice) => voice.lang.toLowerCase() === locale.toLowerCase())
      : -1;
    const prefixMatchIndex =
      exactMatchIndex >= 0
        ? exactMatchIndex
        : voices.findIndex((voice) => voice.lang.split("-")[0]?.toLowerCase() === prefix);
    voices[(prefixMatchIndex >= 0 ? prefixMatchIndex : 0)].isDefault = true;
  }

  return voices;
}

export function normalizePresetVoices(voices: any, targetOs: string): VoiceObject[] {
  const osKey = ({ macos: "mac", windows: "win", linux: "lin" }[targetOs] ?? "mac") as
    | "mac"
    | "win"
    | "lin";
  const result: VoiceObject[] = [];

  for (const entry of voices ?? []) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      result.push(entry as VoiceObject);
      continue;
    }

    if (typeof entry !== "string") {
      continue;
    }
    const last = entry.lastIndexOf(":");
    if (last < 0) {
      continue;
    }
    const voiceType = entry.slice(last + 1);
    const before = entry.slice(0, last);
    const langSep = before.lastIndexOf(":");
    if (langSep < 0) {
      continue;
    }
    const lang = before.slice(langSep + 1);
    const name = before.slice(0, langSep);
    if (!name || !lang) {
      continue;
    }
    result.push({
      name,
      lang,
      voiceUri: voiceUri(osKey, name, lang),
      isDefault: false,
      isLocalService: voiceType === "local",
    });
  }

  if (result.length && !result.some((voice) => voice.isDefault)) {
    result[0].isDefault = true;
  }

  return result;
}

export function fixNavigatorArch(config: Record<string, any>, targetOs: string): void {
  if (targetOs !== "lin") {
    return;
  }
  const userAgent = config["navigator.userAgent"];
  if (typeof userAgent !== "string") {
    return;
  }

  const target =
    userAgent.includes("Linux x86_64")
      ? "Linux x86_64"
      : userAgent.includes("Linux i686")
        ? "Linux i686"
        : "";
  if (!target) {
    return;
  }
  if (config["navigator.platform"] !== target) {
    config["navigator.platform"] = target;
  }
  if (config["navigator.oscpu"] !== target) {
    config["navigator.oscpu"] = target;
  }
}

export function fixScreenNoTaskbar(config: Record<string, any>, targetOs: string): void {
  const screenWidth = config["screen.width"];
  const screenHeight = config["screen.height"];
  const availWidth = config["screen.availWidth"];
  const availHeight = config["screen.availHeight"];
  if (!(screenWidth && screenHeight && availWidth === screenWidth && availHeight === screenHeight)) {
    return;
  }

  const taskbar = targetOs === "win" ? 40 : targetOs === "mac" ? 25 : 27;
  const newAvailHeight = screenHeight - taskbar;
  config["screen.availHeight"] = newAvailHeight;
  const outerHeight = config["window.outerHeight"];
  if (outerHeight && outerHeight > newAvailHeight) {
    const innerHeight = config["window.innerHeight"];
    const chrome = innerHeight ? outerHeight - innerHeight : 0;
    config["window.outerHeight"] = newAvailHeight;
    if (innerHeight) {
      config["window.innerHeight"] = newAvailHeight - chrome;
    }
  }
}

export function clampWindowDimensions(config: Record<string, any>): void {
  for (const axis of ["Width", "Height"] as const) {
    const screen = config[`screen.${axis.toLowerCase()}`];
    const avail = config[`screen.avail${axis}`];
    const outer = config[`window.outer${axis}`];
    const inner = config[`window.inner${axis}`];

    if (screen && avail && avail > screen) {
      config[`screen.avail${axis}`] = screen;
    }
    const availClamped = config[`screen.avail${axis}`] ?? screen;
    const outerCap = availClamped ?? screen;
    if (outer && outerCap && outer > outerCap) {
      const chrome = inner ? Math.max(0, outer - inner) : 0;
      config[`window.outer${axis}`] = outerCap;
      if (inner) {
        config[`window.inner${axis}`] = Math.max(1, outerCap - chrome);
      }
    }

    const outerClamped = config[`window.outer${axis}`] ?? outer;
    const innerNow = config[`window.inner${axis}`];
    if (innerNow && outerClamped && innerNow > outerClamped) {
      config[`window.inner${axis}`] = outerClamped;
    }
  }
}

export function setMediaDevicesDefaults(config: Record<string, any>): void {
  if (Object.keys(config).some((key) => key.startsWith("mediaDevices:"))) {
    return;
  }
  config["mediaDevices:enabled"] = true;
  config["mediaDevices:micros"] = 1;
  config["mediaDevices:webcams"] = 1;
  config["mediaDevices:speakers"] = 0;
}

function selectPresetsFile(ffVersion?: string | number): string {
  const majorVersion = Number.parseInt(String(ffVersion ?? ""), 10);
  if (
    Number.isFinite(majorVersion) &&
    majorVersion >= PRESETS_V150_MIN_FF &&
    fs.existsSync(PRESETS_V150_FILE)
  ) {
    return PRESETS_V150_FILE;
  }
  return PRESETS_FILE;
}

export function loadPresets(ffVersion?: string | number): Record<string, any> | undefined {
  const presetsFile = selectPresetsFile(ffVersion);
  const cached = presetsCache.get(presetsFile);
  if (cached) {
    return cached;
  }
  if (!fs.existsSync(presetsFile)) {
    return undefined;
  }
  const loaded = JSON.parse(fs.readFileSync(presetsFile, "utf8")) as Record<string, any>;
  presetsCache.set(presetsFile, loaded);
  return loaded;
}

export function getRandomPreset(
  os?: string | string[],
  ffVersion?: string | number,
): Record<string, any> | undefined {
  const presets = loadPresets(ffVersion);
  if (!presets) {
    return undefined;
  }

  const requested = os
    ? (Array.isArray(os) ? os : [os]).map((entry) => OS_TO_PRESET_KEY[entry] ?? entry)
    : ["macos", "windows", "linux"];

  const candidates: Record<string, any>[] = [];
  for (const key of requested) {
    candidates.push(...(presets.presets?.[key] ?? []));
  }
  if (!candidates.length) {
    return undefined;
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}

export function fromPreset(preset: Record<string, any>, ffVersion?: string): Record<string, any> {
  const config: Record<string, any> = {};
  const nav = preset.navigator ?? {};
  const screen = preset.screen ?? {};
  const webgl = preset.webgl ?? {};

  if (nav.userAgent) {
    let userAgent = nav.userAgent as string;
    if (ffVersion) {
      userAgent = userAgent
        .replace(/Firefox\/\d+\.0/g, `Firefox/${ffVersion}.0`)
        .replace(/rv:\d+\.0/g, `rv:${ffVersion}.0`);
    }
    config["navigator.userAgent"] = userAgent;
  }
  if (nav.platform) {
    config["navigator.platform"] = nav.platform;
  }
  if (nav.hardwareConcurrency) {
    config["navigator.hardwareConcurrency"] = nav.hardwareConcurrency;
  }
  if (nav.oscpu) {
    config["navigator.oscpu"] = nav.oscpu;
  } else if (nav.platform === "MacIntel") {
    config["navigator.oscpu"] = "Intel Mac OS X 10.15";
  } else if (nav.platform === "Win32") {
    config["navigator.oscpu"] = "Windows NT 10.0; Win64; x64";
  } else if (String(nav.platform).toLowerCase().includes("linux")) {
    config["navigator.oscpu"] = "Linux x86_64";
  }
  if ("maxTouchPoints" in nav) {
    config["navigator.maxTouchPoints"] = nav.maxTouchPoints;
  }

  if (screen.width) {
    config["screen.width"] = screen.width;
  }
  if (screen.height) {
    config["screen.height"] = screen.height;
  }
  if (screen.colorDepth) {
    config["screen.colorDepth"] = screen.colorDepth;
    config["screen.pixelDepth"] = screen.colorDepth;
  }
  if (screen.availWidth) {
    config["screen.availWidth"] = screen.availWidth;
  }
  if (screen.availHeight) {
    config["screen.availHeight"] = screen.availHeight;
  }
  if (webgl.unmaskedVendor) {
    config["webGl:vendor"] = webgl.unmaskedVendor;
  }
  if (webgl.unmaskedRenderer) {
    config["webGl:renderer"] = webgl.unmaskedRenderer;
  }

  config["fonts:spacing_seed"] = randomSeed();
  config["audio:seed"] = randomSeed();
  config["canvas:seed"] = randomSeed();

  if (preset.timezone) {
    config.timezone = preset.timezone;
  }

  const targetOs =
    nav.platform === "MacIntel"
      ? "macos"
      : nav.platform === "Win32"
        ? "windows"
        : String(nav.platform).toLowerCase().includes("linux")
          ? "linux"
          : "macos";

  try {
    config.fonts = generateRandomFontSubset(targetOs);
  } catch {
    if (preset.fonts) {
      const fonts = [...preset.fonts];
      ensureMarkerFonts(
        fonts,
        targetOs === "windows"
          ? WINDOWS_MARKER_FONTS
          : targetOs === "linux"
            ? LINUX_MARKER_FONTS
            : MACOS_MARKER_FONTS,
      );
      config.fonts = fonts;
    }
  }

  try {
    config.voices = generateRandomVoiceSubset(targetOs);
  } catch {
    if (preset.speechVoices) {
      config.voices = normalizePresetVoices(preset.speechVoices, targetOs);
    }
  }

  return config;
}

function buildInitScript(values: Record<string, any>): string {
  const lines = ["(() => {", "  const w = window;"];
  const setters: Array<[string, string]> = [
    ["fontSpacingSeed", "setFontSpacingSeed"],
    ["audioFingerprintSeed", "setAudioFingerprintSeed"],
    ["canvasSeed", "setCanvasSeed"],
    ["navigatorPlatform", "setNavigatorPlatform"],
    ["navigatorOscpu", "setNavigatorOscpu"],
    ["navigatorUserAgent", "setNavigatorUserAgent"],
    ["hardwareConcurrency", "setNavigatorHardwareConcurrency"],
    ["webglVendor", "setWebGLVendor"],
    ["webglRenderer", "setWebGLRenderer"],
  ];

  for (const [key, fnName] of setters) {
    const value = values[key];
    if (value != null) {
      lines.push(`  if (typeof w.${fnName} === "function") w.${fnName}(${JSON.stringify(value)});`);
    }
  }

  if (values.screenWidth && values.screenHeight) {
    lines.push(
      `  if (typeof w.setScreenDimensions === "function") w.setScreenDimensions(${values.screenWidth}, ${values.screenHeight});`,
    );
    if (values.screenColorDepth) {
      lines.push(
        `  if (typeof w.setScreenColorDepth === "function") w.setScreenColorDepth(${values.screenColorDepth});`,
      );
    }
  }

  if (values.timezone != null) {
    lines.push(
      `  if (typeof w.setTimezone === "function") w.setTimezone(${JSON.stringify(values.timezone)});`,
    );
  }
  lines.push(
    `  if (typeof w.setWebRTCIPv4 === "function") w.setWebRTCIPv4(${JSON.stringify(
      values.webrtcIP ?? "",
    )});`,
  );

  if (Array.isArray(values.fontList) && values.fontList.length) {
    lines.push(
      `  if (typeof w.setFontList === "function") w.setFontList(${JSON.stringify(values.fontList.join(","))});`,
    );
  }
  if (Array.isArray(values.speechVoices) && values.speechVoices.length) {
    const voiceNames = values.speechVoices.map((voice: string | VoiceObject) =>
      typeof voice === "string" ? voice : voice.name,
    );
    lines.push(
      `  if (typeof w.setSpeechVoices === "function") w.setSpeechVoices(${JSON.stringify(
        voiceNames.join(","),
      )});`,
    );
  }
  lines.push("})();");
  return lines.join("\n");
}

export function generateContextFingerprint(input: {
  preset?: Record<string, any>;
  os?: string | string[];
  ffVersion?: string;
  webrtcIp?: string;
  timezone?: string;
  locale?: string;
  configOverrides?: Record<string, any>;
}): Record<string, any> {
  const {
    preset,
    os,
    ffVersion,
    webrtcIp,
    timezone: explicitTimezone,
    locale,
    configOverrides,
  } = input;
  let config: Record<string, any>;
  let nav: Record<string, any>;
  let screen: Record<string, any>;
  let webgl: Record<string, any>;
  let selectedPreset = preset;

  if (preset) {
    config = fromPreset(preset, ffVersion);
    nav = preset.navigator ?? {};
    screen = preset.screen ?? {};
    webgl = preset.webgl ?? {};
  } else {
    const generated = generateFingerprint({ os });
    config = fromBrowserforge(generated, ffVersion);
    config["fonts:spacing_seed"] ??= randomSeed();
    config["audio:seed"] ??= randomSeed();
    config["canvas:seed"] ??= randomSeed();

    const platform = config["navigator.platform"] ?? "";
    const targetOs = getPlatformTargetOs(String(platform));

    config.fonts ??= generateRandomFontSubset(targetOs);
    config.voices ??= generateRandomVoiceSubset(targetOs);
    config["navigator.oscpu"] ??=
      platform === "Win32"
        ? "Windows NT 10.0; Win64; x64"
        : String(platform).toLowerCase().includes("linux")
          ? "Linux x86_64"
          : "Intel Mac OS X 10.15";

    if (!config["webGl:vendor"] || !config["webGl:renderer"]) {
      try {
        const sampled = sampleWebgl(getContextWebglOsKey(os, String(platform)));
        delete sampled.webGl2Enabled;
        Object.assign(config, sampled);
      } catch {}
    }

    nav = {
      platform: config["navigator.platform"],
      hardwareConcurrency: config["navigator.hardwareConcurrency"],
    };
    screen = {
      width: config["screen.width"],
      height: config["screen.height"],
      colorDepth: config["screen.colorDepth"],
      devicePixelRatio: undefined,
    };
    webgl = {
      unmaskedVendor: config["webGl:vendor"],
      unmaskedRenderer: config["webGl:renderer"],
    };
    selectedPreset = { navigator: nav, screen, webgl };
  }

  if (explicitTimezone) {
    config.timezone = explicitTimezone;
  }
  if (locale) {
    const parsedLocale = handleLocale(locale);
    Object.assign(config, parsedLocale.asConfig(), {
      "navigator.language": parsedLocale.asString,
    });
  }
  if (configOverrides) {
    Object.assign(config, configOverrides);
  }

  const navigatorPlatform = config["navigator.platform"] ?? nav.platform;
  const hardwareConcurrency =
    config["navigator.hardwareConcurrency"] ?? nav.hardwareConcurrency;
  const webglVendor = config["webGl:vendor"] ?? webgl.unmaskedVendor;
  const webglRenderer = config["webGl:renderer"] ?? webgl.unmaskedRenderer;
  const screenWidth = config["screen.width"] ?? screen.width;
  const screenHeight = config["screen.height"] ?? screen.height;
  const screenColorDepth = config["screen.colorDepth"] ?? screen.colorDepth;
  const timezoneId = config.timezone ?? selectedPreset?.timezone;

  const initValues = {
    fontSpacingSeed: config["fonts:spacing_seed"],
    audioFingerprintSeed: config["audio:seed"],
    canvasSeed: config["canvas:seed"],
    navigatorPlatform,
    navigatorOscpu: config["navigator.oscpu"],
    navigatorUserAgent: config["navigator.userAgent"],
    hardwareConcurrency,
    webglVendor,
    webglRenderer,
    screenWidth,
    screenHeight,
    screenColorDepth,
    timezone: timezoneId,
    fontList: config.fonts,
    speechVoices: config.voices,
    webrtcIP: webrtcIp ?? "",
  };

  const initScript = buildInitScript(initValues);
  const contextOptions: Record<string, any> = {};

  if (config["navigator.userAgent"]) {
    contextOptions.userAgent = config["navigator.userAgent"];
  }
  if (screenWidth && screenHeight) {
    contextOptions.viewport = {
      width: screenWidth,
      height: Math.max(screenHeight - 28, 600),
    };
  }
  if (screen.devicePixelRatio) {
    contextOptions.deviceScaleFactor = screen.devicePixelRatio;
  }
  if (timezoneId) {
    contextOptions.timezoneId = timezoneId;
  }
  if (config["navigator.language"]) {
    contextOptions.locale = config["navigator.language"];
  }

  return {
    initScript,
    contextOptions,
    config,
    preset: selectedPreset,
  };
}

type ExtendedScreen = ScreenFingerprint & { screenY?: number };

function castToProperties(
  target: Record<string, any>,
  castEnum: Record<string, any>,
  source: Record<string, any>,
  ffVersion?: string,
): void {
  for (const [key, value] of Object.entries(source)) {
    if (value == null || value === false || value === "") {
      continue;
    }
    const mapped = castEnum[key];
    if (!mapped) {
      continue;
    }
    if (typeof value === "object" && !Array.isArray(value)) {
      castToProperties(target, mapped, value as Record<string, any>, ffVersion);
      continue;
    }
    let nextValue: any = value;
    if (typeof nextValue === "number" && String(mapped).startsWith("screen.") && nextValue < 0) {
      nextValue = 0;
    }
    if (ffVersion && typeof nextValue === "string") {
      nextValue = nextValue.replace(/(?<!\d)(1[0-9]{2})(\.0)(?!\d)/g, `${ffVersion}$2`);
    }
    target[mapped] = nextValue;
  }
}

function handleScreenXY(target: Record<string, any>, screen: ScreenFingerprint): void {
  if ("window.screenY" in target) {
    return;
  }
  const screenX = screen.screenX ?? 0;
  if (!screenX) {
    target["window.screenX"] = 0;
    target["window.screenY"] = 0;
    return;
  }
  if (screenX >= -50 && screenX <= 50) {
    target["window.screenY"] = screenX;
    return;
  }
  const maxY = screen.availHeight - screen.outerHeight;
  if (maxY === 0) {
    target["window.screenY"] = 0;
  } else if (maxY > 0) {
    target["window.screenY"] = Math.floor(Math.random() * maxY);
  } else {
    target["window.screenY"] = Math.floor(Math.random() * Math.abs(maxY)) * -1;
  }
}

export function fromBrowserforge(fingerprint: Fingerprint, ffVersion?: string): Record<string, any> {
  const target: Record<string, any> = {};
  castToProperties(target, BROWSERFORGE_DATA, fingerprint as unknown as Record<string, any>, ffVersion);
  handleScreenXY(target, fingerprint.screen);
  return target;
}

function handleWindowSize(fingerprint: Fingerprint, outerWidth: number, outerHeight: number): void {
  const screen = fingerprint.screen as ExtendedScreen;
  screen.screenX += Math.floor((screen.width - outerWidth) / 2);
  screen.screenY = Math.floor((screen.height - outerHeight) / 2);
  if (screen.innerWidth) {
    screen.innerWidth = Math.max(outerWidth - screen.outerWidth + screen.innerWidth, 0);
  }
  if (screen.innerHeight) {
    screen.innerHeight = Math.max(outerHeight - screen.outerHeight + screen.innerHeight, 0);
  }
  screen.outerWidth = outerWidth;
  screen.outerHeight = outerHeight;
}

export function generateFingerprint(input: {
  window?: [number, number];
  os?: string | string[];
  screen?: ScreenConstraint;
}): Fingerprint {
  const operatingSystems = normalizeOperatingSystems(input.os);
  const options: Partial<FingerprintGeneratorOptions> = {
    operatingSystems,
    screen: input.screen ?? {},
  };
  const generated = FP_GENERATOR.getFingerprint(options).fingerprint;
  if (input.window) {
    handleWindowSize(generated, input.window[0], input.window[1]);
  }
  return generated;
}

function normalizeOperatingSystems(os?: string | string[]): Array<"linux" | "macos" | "windows"> | undefined {
  if (!os) {
    return undefined;
  }
  const values = Array.isArray(os) ? os : [os];
  return values.map((value) => {
    const normalized = OS_TO_PRESET_KEY[value];
    if (normalized === "linux" || normalized === "macos" || normalized === "windows") {
      return normalized;
    }
    return value as "linux" | "macos" | "windows";
  });
}

function randomSeed(): number {
  return Math.floor(Math.random() * 4_294_967_295) + 1;
}
