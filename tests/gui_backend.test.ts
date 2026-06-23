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

  it("resolves duplicate version-build fetch targets by sha", () => {
    vi.spyOn(multiversion, "loadRepoCache").mockReturnValue({
      repos: [
        {
          name: "JWriter20",
          versions: [
            {
              version: "150.0.2",
              build: "beta.25",
              is_prerelease: false,
              url: "https://example.test/newer",
              sha256: "bbbbbbbb22222222",
            },
            {
              version: "150.0.2",
              build: "beta.25",
              is_prerelease: false,
              url: "https://example.test/older",
              sha256: "aaaaaaaa11111111",
            },
          ],
        },
      ],
    });
    vi.spyOn(multiversion, "loadConfig").mockReturnValue({});
    vi.spyOn(RepoConfig, "findByName").mockReturnValue({ name: "JWriter20" } as RepoConfig);

    const backend = new GuiBackend();
    const resolved = (backend as any).resolveFetchTarget(
      "jwriter20/stable/150.0.2-beta.25",
      "aaaaaaaa11111111",
    );

    expect(resolved.repoConfig?.name).toBe("JWriter20");
    expect(resolved.selected?.url).toBe("https://example.test/older");
    expect(resolved.selected?.sha256).toBe("aaaaaaaa11111111");
  });
});
