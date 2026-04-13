import type { Browser } from "playwright";

import {
  AsyncNewBrowser,
  AsyncNewContext,
  type CamoufoxBrowser,
} from "./async_api";

export type NewBrowserOptions = Parameters<typeof AsyncNewBrowser>[0];
export type NewContextOptions = Parameters<typeof AsyncNewContext>[1];

/**
 * Node Playwright is async-only, but Camoufox keeps a dedicated sync_api module
 * so the package surface matches the Python layout.
 */
export class Camoufox {
  private readonly options: NewBrowserOptions;
  browser?: CamoufoxBrowser;

  constructor(options: NewBrowserOptions = {}) {
    this.options = options;
  }

  async enter(): Promise<CamoufoxBrowser> {
    this.browser = await NewBrowser(this.options);
    return this.browser;
  }

  async close(): Promise<void> {
    await this.browser?.close();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

export function NewBrowser(input: NewBrowserOptions = {}): Promise<CamoufoxBrowser> {
  return AsyncNewBrowser(input);
}

export function NewContext(
  browser: Browser,
  input: NewContextOptions = {},
): ReturnType<typeof AsyncNewContext> {
  return AsyncNewContext(browser, input);
}
