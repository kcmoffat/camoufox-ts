import { describe, expect, it } from "vitest";

import { handleLocale, handleLocales, Locale } from "../src/lib/locales";

describe("locales", () => {
  it("normalizes full locales", () => {
    const locale = handleLocale("en-US");
    expect(locale).toBeInstanceOf(Locale);
    expect(locale.language).toBe("en");
    expect(locale.region).toBe("US");
  });

  it("derives a locale from a territory code", () => {
    const locale = handleLocale("US");
    expect(locale.region).toBe("US");
    expect(locale.language.length).toBeGreaterThan(0);
  });

  it("writes locale config keys", () => {
    const config: Record<string, string> = {};
    handleLocales(["en-US", "fr"], config);
    expect(config["locale:region"]).toBe("US");
    expect(config["locale:language"]).toBe("en");
    expect(config["locale:all"]).toContain("fr");
  });
});
