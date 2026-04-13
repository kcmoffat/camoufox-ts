import fs from "node:fs";

import type {
  Fingerprint,
  FingerprintGeneratorOptions,
  ScreenFingerprint,
} from "fingerprint-generator";
import { FingerprintGenerator } from "fingerprint-generator";

import { assetPath } from "./assets";
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
let presetsCache: Record<string, any> | undefined;
let fontsCache: Record<string, string[]> | undefined;
let voicesCache: Record<string, string[]> | undefined;

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

function loadOsVoices(): Record<string, string[]> {
  if (!voicesCache) {
    const raw = JSON.parse(fs.readFileSync(assetPath("voices.json"), "utf8")) as Record<
      string,
      string[]
    >;
    voicesCache = Object.fromEntries(
      Object.entries(raw).map(([key, values]) => [key, values.map((value) => value.split(":")[0])]),
    );
  }
  return voicesCache;
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

export function generateRandomVoiceSubset(targetOs: string): string[] {
  const osVoices = loadOsVoices();
  const osKey = { macos: "mac", windows: "win", linux: "lin" }[targetOs] ?? "mac";
  const fullList = osVoices[osKey] ?? [];
  if (!fullList.length) {
    return [];
  }
  if (targetOs === "windows") {
    return [...fullList];
  }
  const essential = new Set(ESSENTIAL_VOICES_MACOS);
  const result = fullList.filter((voice) => essential.has(voice));
  const nonEssential = fullList.filter((voice) => !essential.has(voice));
  result.push(...pickRandomSubset(nonEssential, 40, 80));
  return Array.from(new Set(result));
}

export function loadPresets(): Record<string, any> | undefined {
  if (!presetsCache && fs.existsSync(PRESETS_FILE)) {
    presetsCache = JSON.parse(fs.readFileSync(PRESETS_FILE, "utf8")) as Record<string, any>;
  }
  return presetsCache;
}

export function getRandomPreset(os?: string | string[]): Record<string, any> | undefined {
  const presets = loadPresets();
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
      config.voices = preset.speechVoices;
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

  lines.push(
    `  if (typeof w.setTimezone === "function") w.setTimezone(${JSON.stringify(
      values.timezone ?? 'Intl.DateTimeFormat().resolvedOptions().timeZone',
    )});`,
  );
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
    lines.push(
      `  if (typeof w.setSpeechVoices === "function") w.setSpeechVoices(${JSON.stringify(
        values.speechVoices.join(","),
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
}): Record<string, any> {
  const { preset, os, ffVersion, webrtcIp } = input;
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
    const targetOs =
      platform === "Win32"
        ? "windows"
        : String(platform).toLowerCase().includes("linux")
          ? "linux"
          : "macos";

    config.fonts ??= generateRandomFontSubset(targetOs);
    config.voices ??= generateRandomVoiceSubset(targetOs);
    config["navigator.oscpu"] ??=
      platform === "Win32"
        ? "Windows NT 10.0; Win64; x64"
        : String(platform).toLowerCase().includes("linux")
          ? "Linux x86_64"
          : "Intel Mac OS X 10.15";

    if (!config["webGl:vendor"] || !config["webGl:renderer"]) {
      const osKey =
        OS_ARCH_MATRIX[(os as keyof typeof OS_ARCH_MATRIX) ?? "mac" as keyof typeof OS_ARCH_MATRIX]
          ? (os as keyof typeof OS_ARCH_MATRIX)
          : platform === "Win32"
            ? "win"
            : String(platform).toLowerCase().includes("linux")
              ? "lin"
              : "mac";
      const sampled = sampleWebgl(osKey);
      delete sampled.webGl2Enabled;
      Object.assign(config, sampled);
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

  const initValues = {
    fontSpacingSeed: config["fonts:spacing_seed"],
    audioFingerprintSeed: config["audio:seed"],
    canvasSeed: config["canvas:seed"],
    navigatorPlatform: nav.platform,
    navigatorOscpu: config["navigator.oscpu"],
    navigatorUserAgent: config["navigator.userAgent"],
    hardwareConcurrency: nav.hardwareConcurrency ?? config["navigator.hardwareConcurrency"],
    webglVendor: webgl.unmaskedVendor,
    webglRenderer: webgl.unmaskedRenderer,
    screenWidth: screen.width,
    screenHeight: screen.height,
    screenColorDepth: screen.colorDepth,
    timezone: selectedPreset?.timezone ?? config.timezone,
    fontList: config.fonts,
    speechVoices: config.voices,
    webrtcIP: webrtcIp ?? "",
  };

  const initScript = buildInitScript(initValues);
  const contextOptions: Record<string, any> = {};

  if (config["navigator.userAgent"]) {
    contextOptions.userAgent = config["navigator.userAgent"];
  }
  if (screen.width && screen.height) {
    contextOptions.viewport = {
      width: screen.width,
      height: Math.max(screen.height - 28, 600),
    };
  }
  if (screen.devicePixelRatio) {
    contextOptions.deviceScaleFactor = screen.devicePixelRatio;
  }
  const timezone = config.timezone ?? selectedPreset?.timezone;
  if (timezone) {
    contextOptions.timezoneId = timezone;
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
