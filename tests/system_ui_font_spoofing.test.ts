import type { Browser } from "playwright";
import { describe, expect, it } from "vitest";

import { AsyncNewBrowser, AsyncNewContext } from "../src";

const describeE2E = process.env.CAMOUFOX_E2E === "1" ? describe : describe.skip;
const OS_CASES = [
  { os: "macos", expectedPlatform: "MacIntel", expectedSystemFont: "Helvetica" },
  { os: "windows", expectedPlatform: "Win32", expectedSystemFont: "Segoe UI" },
] as const;

describeE2E("system-ui font spoofing", () => {
  for (const testCase of OS_CASES) {
    it(`resolves system-ui like ${testCase.expectedSystemFont} for ${testCase.os} contexts`, async () => {
      const browser = (await AsyncNewBrowser({
        headless: true,
        iKnowWhatImDoing: true,
      })) as Browser;

      try {
        const context = await AsyncNewContext(browser, {
          os: testCase.os,
        });

        try {
          const page = await context.newPage();
          const result = await page.evaluate((expectedSystemFont) => {
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              throw new Error("2D canvas context unavailable");
            }

            const sample = "The quick brown fox jumps over the lazy dog 0123456789";
            const measure = (fontFamily: string) => {
              ctx.font = `32px ${fontFamily}`;
              return ctx.measureText(sample).width;
            };

            return {
              platform: navigator.platform,
              systemUiWidth: measure("system-ui"),
              expectedFontWidth: measure(`"${expectedSystemFont}"`),
            };
          }, testCase.expectedSystemFont);

          expect(result.platform).toBe(testCase.expectedPlatform);
          expect(result.systemUiWidth).toBe(result.expectedFontWidth);
        } finally {
          await context.close();
        }
      } finally {
        await browser.close();
      }
    }, 120_000);
  }
});
