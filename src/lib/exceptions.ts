export class UnsupportedVersion extends Error {}
export class MissingRelease extends Error {}
export class UnsupportedArchitecture extends Error {}
export class UnsupportedOS extends Error {}
export class UnknownProperty extends Error {}
export class InvalidPropertyType extends Error {}
export class InvalidAddonPath extends Error {}
export class InvalidDebugPort extends Error {}
export class MissingDebugPort extends Error {}
export class LocaleError extends Error {}
export class InvalidIP extends Error {}
export class InvalidProxy extends Error {}
export class UnknownIPLocation extends LocaleError {}
export class NotInstalledGeoIPExtra extends Error {}
export class NonFirefoxFingerprint extends Error {}
export class InvalidOS extends Error {}
export class VirtualDisplayError extends Error {}
export class CannotFindXvfb extends VirtualDisplayError {}
export class CannotExecuteXvfb extends VirtualDisplayError {}
export class VirtualDisplayNotSupported extends VirtualDisplayError {}
export class CamoufoxNotInstalled extends Error {}

export class InvalidLocale extends LocaleError {
  static invalidInput(locale: string): InvalidLocale {
    return new InvalidLocale(
      `Invalid locale: '${locale}'. Must be either a region, language, language-region, or language-script-region.`,
    );
  }
}

export class UnknownTerritory extends InvalidLocale {}
export class UnknownLanguage extends InvalidLocale {}
