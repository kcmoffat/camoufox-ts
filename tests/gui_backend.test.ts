import { afterEach, describe, expect, it, vi } from "vitest";

import { GuiBackend } from "../src/lib/gui/backend";
import * as multiversion from "../src/lib/multiversion";
import { RepoConfig } from "../src/lib/pkgman";

describe("gui backend", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves repo/channel fetch targets through the shared CLI resolver", () => {
    vi.spyOn(multiversion, "loadRepoCache").mockReturnValue({
      repos: [
        {
          name: "Official",
          versions: [
            { version: "135.0.1", build: "beta.25", is_prerelease: true, url: "https://example.test/pre" },
            { version: "135.0.1", build: "beta.24", is_prerelease: false, url: "https://example.test/stable" },
          ],
        },
      ],
    });
    vi.spyOn(multiversion, "loadConfig").mockReturnValue({});
    vi.spyOn(RepoConfig, "findByName").mockReturnValue({ name: "Official" } as RepoConfig);

    const backend = new GuiBackend();
    const resolved = (backend as any).resolveFetchTarget("official/stable");

    expect(resolved.repoConfig?.name).toBe("Official");
    expect(resolved.selected?.version.fullString).toBe("135.0.1-beta.24");
    expect(resolved.selected?.isPrerelease).toBe(false);
  });
});
