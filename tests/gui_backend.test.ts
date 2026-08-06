import { afterEach, describe, expect, it, vi } from "vitest";

import { GuiBackend } from "../src/lib/gui/backend";
import * as addons from "../src/lib/addons";
import * as main from "../src/lib/__main__";
import * as geolocation from "../src/lib/geolocation";
import * as multiversion from "../src/lib/multiversion";
import { AvailableVersion, RepoConfig, Version } from "../src/lib/pkgman";

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

  it("includes the active installed version in manager state", async () => {
    vi.spyOn(multiversion, "loadConfig").mockReturnValue({
      channel: "Official/stable",
      pinned: "150.0.2-beta.25",
    });
    vi.spyOn(multiversion, "loadRepoCache").mockReturnValue({});
    vi.spyOn(multiversion, "listInstalled").mockReturnValue([
      {
        repoName: "official",
        version: new Version("beta.25", "150.0.2"),
        path: "/tmp/browsers/official/150.0.2-beta.25-aaaaaaaa",
        relativePath: "browsers/official/150.0.2-beta.25-aaaaaaaa",
        channelPath: "official/stable/150.0.2-beta.25",
        isActive: true,
        isPrerelease: false,
      },
    ] as any);

    const backend = new GuiBackend();
    await expect(backend.state()).resolves.toMatchObject({
      active: {
        channel: "Official/stable",
        pinned: "150.0.2-beta.25",
        currentVersion: "150.0.2-beta.25",
        currentPath: "official/stable/150.0.2-beta.25",
        isPrerelease: false,
      },
    });
  });

  it("clears pinned version state without disturbing the followed channel", async () => {
    const saveConfig = vi.spyOn(multiversion, "saveConfig").mockImplementation(() => undefined);
    vi.spyOn(multiversion, "loadConfig").mockReturnValue({
      channel: "official/stable",
      pinned: "150.0.2-beta.25",
      pinned_sha: "aaaaaaaa11111111",
      active_version: "browsers/official/stable/150.0.2-beta.25",
    });
    vi.spyOn(multiversion, "loadRepoCache").mockReturnValue({});
    vi.spyOn(multiversion, "listInstalled").mockReturnValue([]);

    const backend = new GuiBackend();
    await backend.unpinVersion();

    expect(saveConfig).toHaveBeenCalledWith({
      channel: "official/stable",
      active_version: "browsers/official/stable/150.0.2-beta.25",
    });
  });

  it("does not switch the active install when fetching an inactive GUI-selected version", async () => {
    vi.spyOn(multiversion, "loadRepoCache").mockReturnValue({
      repos: [
        {
          name: "Official",
          versions: [
            {
              version: "150.0.2",
              build: "beta.26",
              is_prerelease: false,
              url: "https://example.test/new",
              sha256: "bbbbbbbb22222222",
            },
            {
              version: "150.0.2",
              build: "beta.25",
              is_prerelease: false,
              url: "https://example.test/current",
              sha256: "aaaaaaaa11111111",
            },
          ],
        },
      ],
    });
    vi.spyOn(multiversion, "loadConfig").mockReturnValue({
      channel: "Official/stable",
      pinned: "150.0.2-beta.25",
      pinned_sha: "aaaaaaaa11111111",
      active_version: "browsers/official/150.0.2-beta.25-aaaaaaaa",
    });
    const saveConfig = vi.spyOn(multiversion, "saveConfig").mockImplementation(() => undefined);
    vi.spyOn(multiversion, "listInstalled").mockReturnValue([
      {
        repoName: "official",
        version: new Version("beta.25", "150.0.2"),
        path: "/tmp/browsers/official/150.0.2-beta.25-aaaaaaaa",
        relativePath: "browsers/official/150.0.2-beta.25-aaaaaaaa",
        channelPath: "official/stable/150.0.2-beta.25",
        isActive: true,
        isPrerelease: false,
        sha256: "aaaaaaaa11111111",
      },
    ] as any);
    vi.spyOn(RepoConfig, "findByName").mockReturnValue({ name: "Official" } as RepoConfig);
    vi.spyOn(geolocation, "downloadMmdb").mockResolvedValue(undefined as never);
    vi.spyOn(addons, "maybeDownloadAddons").mockResolvedValue(undefined);

    const update = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(main, "CamoufoxUpdate").mockImplementation(
      () =>
        ({
          initialize: async () => ({
            update,
          }),
        }) as any,
    );

    const backend = new GuiBackend();
    await backend.fetch({
      version: "Official/stable/150.0.2-beta.26",
      sha256: "bbbbbbbb22222222",
    });

    expect(update).toHaveBeenCalled();
    expect(saveConfig).toHaveBeenCalledWith({
      channel: "Official/stable",
      pinned: "150.0.2-beta.25",
      pinned_sha: "aaaaaaaa11111111",
      active_version: "browsers/official/150.0.2-beta.25-aaaaaaaa",
    });
  });

  it("keeps activation when fetching the currently followed GUI target", async () => {
    vi.spyOn(multiversion, "loadRepoCache").mockReturnValue({
      repos: [
        {
          name: "Official",
          versions: [
            {
              version: "150.0.2",
              build: "beta.26",
              is_prerelease: false,
              url: "https://example.test/new",
              sha256: "bbbbbbbb22222222",
            },
          ],
        },
      ],
    });
    vi.spyOn(multiversion, "loadConfig").mockReturnValue({
      channel: "Official/stable",
    });
    const saveConfig = vi.spyOn(multiversion, "saveConfig").mockImplementation(() => undefined);
    vi.spyOn(multiversion, "listInstalled").mockReturnValue([]);
    vi.spyOn(RepoConfig, "findByName").mockReturnValue({ name: "Official" } as RepoConfig);
    vi.spyOn(geolocation, "downloadMmdb").mockResolvedValue(undefined as never);
    vi.spyOn(addons, "maybeDownloadAddons").mockResolvedValue(undefined);

    const update = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(main, "CamoufoxUpdate").mockImplementation(
      () =>
        ({
          initialize: async () => ({
            update,
          }),
        }) as any,
    );

    const backend = new GuiBackend();
    await backend.fetch({
      version: "Official/stable/150.0.2-beta.26",
      sha256: "bbbbbbbb22222222",
    });

    expect(update).toHaveBeenCalled();
    expect(saveConfig).not.toHaveBeenCalled();
  });
});
