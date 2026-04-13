import fs from "node:fs";

import { XMLParser } from "fast-xml-parser";

import { assetPath } from "./assets";
import { LeakWarning } from "./_warnings";
import { InvalidLocale, UnknownLanguage, UnknownTerritory } from "./exceptions";

export class Locale {
  language: string;
  region?: string;
  script?: string;

  constructor(language: string, region?: string, script?: string) {
    this.language = language;
    this.region = region;
    this.script = script;
  }

  get asString(): string {
    return this.region ? `${this.language}-${this.region}` : this.language;
  }

  asConfig(): Record<string, string> {
    if (!this.region) {
      throw new InvalidLocale("Locale region is required for config conversion.");
    }
    const data: Record<string, string> = {
      "locale:region": this.region,
      "locale:language": this.language,
    };
    if (this.script) {
      data["locale:script"] = this.script;
    }
    return data;
  }
}

export class Geolocation {
  locale: Locale;
  longitude: number;
  latitude: number;
  timezone: string;
  accuracy?: number;

  constructor(input: {
    locale: Locale;
    longitude: number;
    latitude: number;
    timezone: string;
    accuracy?: number;
  }) {
    this.locale = input.locale;
    this.longitude = input.longitude;
    this.latitude = input.latitude;
    this.timezone = input.timezone;
    this.accuracy = input.accuracy;
  }

  asConfig(): Record<string, string | number> {
    const data: Record<string, string | number> = {
      "geolocation:longitude": this.longitude,
      "geolocation:latitude": this.latitude,
      timezone: this.timezone,
      ...this.locale.asConfig(),
    };
    if (this.accuracy != null) {
      data["geolocation:accuracy"] = this.accuracy;
    }
    return data;
  }
}

export function verifyLocale(locale: string): void {
  try {
    Intl.getCanonicalLocales(locale);
  } catch {
    throw InvalidLocale.invalidInput(locale);
  }
}

export function normalizeLocale(locale: string): Locale {
  verifyLocale(locale);
  const intlLocale = new Intl.Locale(locale);
  if (!intlLocale.region) {
    throw InvalidLocale.invalidInput(locale);
  }
  const maximized = intlLocale.maximize();
  return new Locale(
    maximized.language.toLowerCase(),
    maximized.region!.toUpperCase(),
    maximized.script ?? undefined,
  );
}

export function handleLocale(locale: string, ignoreRegion = false): Locale {
  if (locale.length > 3) {
    return normalizeLocale(locale);
  }

  try {
    return SELECTOR.fromRegion(locale);
  } catch (error) {
    if (!(error instanceof UnknownTerritory)) {
      throw error;
    }
  }

  if (ignoreRegion) {
    verifyLocale(locale);
    return new Locale(locale.toLowerCase());
  }

  try {
    const normalized = SELECTOR.fromLanguage(locale);
    LeakWarning.warn("no_region");
    return normalized;
  } catch (error) {
    if (!(error instanceof UnknownLanguage)) {
      throw error;
    }
  }

  throw InvalidLocale.invalidInput(locale);
}

export function handleLocales(locales: string | string[], config: Record<string, any>): void {
  const normalized = Array.isArray(locales)
    ? locales
    : locales.split(",").map((locale) => locale.trim()).filter(Boolean);

  const intlLocale = handleLocale(normalized[0]);
  Object.assign(config, intlLocale.asConfig());

  if (normalized.length > 1) {
    config["locale:all"] = joinUnique(
      normalized.map((locale) => handleLocale(locale, true).asString),
    );
  }
}

function joinUnique(values: string[]): string {
  const seen = new Set<string>();
  return values.filter((value) => !seen.has(value) && (seen.add(value), true)).join(", ");
}

type TerritoryRecord = {
  type: string;
  population?: string;
  literacyPercent?: string;
  languagePopulation?: TerritoryLanguagePopulation | TerritoryLanguagePopulation[];
};

type TerritoryLanguagePopulation = {
  type: string;
  populationPercent?: string;
};

function getUnicodeInfo(): TerritoryRecord[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
  });
  const raw = parser.parse(fs.readFileSync(assetPath("territoryInfo.xml"), "utf8")) as Record<
    string,
    any
  >;
  const territories = raw.territoryInfo?.territory;
  return ensureArray(territories) as TerritoryRecord[];
}

function asFloat(value: string | undefined): number {
  return value ? Number.parseFloat(value) : 0;
}

function ensureArray<T>(value: T | T[] | undefined): T[] {
  if (value == null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

export class StatisticalLocaleSelector {
  private readonly territories: TerritoryRecord[];

  constructor() {
    this.territories = getUnicodeInfo();
  }

  private normalizeProbabilities(values: string[], weights: number[]): [string[], number[]] {
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    return [values, weights.map((weight) => weight / total)];
  }

  private weightedPick(values: string[], probabilities: number[]): string {
    let cursor = Math.random();
    for (let index = 0; index < values.length; index += 1) {
      cursor -= probabilities[index];
      if (cursor <= 0) {
        return values[index];
      }
    }
    return values[values.length - 1];
  }

  private loadTerritoryData(isoCode: string): [string[], number[]] {
    const territory = this.territories.find((entry) => entry.type === isoCode.toUpperCase());
    if (!territory) {
      throw new UnknownTerritory(`Unknown territory: ${isoCode}`);
    }
    const populations = ensureArray(territory.languagePopulation);
    if (!populations.length) {
      throw new Error(`No language data found for region: ${isoCode}`);
    }
    const languages = populations.map((population) => population.type);
    const percentages = populations.map((population) => asFloat(population.populationPercent));
    return this.normalizeProbabilities(languages, percentages);
  }

  private loadLanguageData(language: string): [string[], number[]] {
    const regions: string[] = [];
    const weights: number[] = [];
    for (const territory of this.territories) {
      const populations = ensureArray(territory.languagePopulation);
      const match = populations.find((population) => population.type === language.toLowerCase());
      if (!match) {
        continue;
      }
      regions.push(territory.type);
      weights.push(
        (asFloat(match.populationPercent) *
          asFloat(territory.literacyPercent) *
          asFloat(territory.population)) /
          10000,
      );
    }
    if (!regions.length) {
      throw new UnknownLanguage(`No region data found for language: ${language}`);
    }
    return this.normalizeProbabilities(regions, weights);
  }

  fromRegion(region: string): Locale {
    const [languages, probabilities] = this.loadTerritoryData(region);
    const language = this.weightedPick(languages, probabilities).replaceAll("_", "-");
    return normalizeLocale(`${language}-${region.toUpperCase()}`);
  }

  fromLanguage(language: string): Locale {
    const [regions, probabilities] = this.loadLanguageData(language.toLowerCase());
    const region = this.weightedPick(regions, probabilities);
    return normalizeLocale(`${language.toLowerCase()}-${region}`);
  }
}

export const SELECTOR = new StatisticalLocaleSelector();
