import { afterEach, describe, expect, it, vi } from "vitest";

import { GitHubDownloader, RepoConfig, Version, listAvailableVersions } from "../src/lib/pkgman";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pkgman", () => {
  it("compares build versions in the same order as the Python port", () => {
    const lower = new Version("beta.19", "135.0.1");
    const higher = new Version("beta.24", "135.0.1");
    expect(lower.compare(higher)).toBeLessThan(0);
    expect(higher.compare(lower)).toBeGreaterThan(0);
  });

  it("loads repository configuration from the bundled yaml", () => {
    const repos = RepoConfig.loadRepos();
    expect(repos.length).toBeGreaterThan(0);
    expect(repos[0].name).toBe("Official");
    expect(repos[0].repos.length).toBeGreaterThan(0);
  });

  it("keeps the official repo fallback chain from upstream repos.yml", () => {
    const official = RepoConfig.getDefault();

    expect(official.name).toBe("Official");
    expect(official.repos).toEqual(["daijro/camoufox", "camoufox/camoufox"]);
  });

  it("treats stable and prerelease channel constraints independently", () => {
    const repo = RepoConfig.fromDict({
      repo: "daijro/camoufox",
      name: "Official",
      pattern: "{name}-{version}-{build}-{os}.{arch}.zip",
      versions: [
        {
          python_library: { min: "0.5.0", max: "1" },
          browser: {
            stable: { min: "beta.19", max: "1" },
          },
        },
      ],
    });

    expect(repo.isVersionSupported(new Version("beta.24", "135.0.1"))).toBe(true);
    expect(repo.isVersionSupported(new Version("alpha.26", "135.0.2"), true)).toBe(true);
  });

  it("falls back to the newest repo constraints for source checkouts", () => {
    const repo = RepoConfig.fromDict(
      {
        repo: "daijro/camoufox",
        name: "Official",
        pattern: "{name}-{version}-{build}-{os}.{arch}.zip",
        versions: [
          {
            python_library: { min: "0.4.0", max: "0.5.0" },
            browser: { min: "beta.10", max: "beta.18" },
          },
          {
            python_library: { min: "0.5.0", max: "1" },
            browser: { min: "beta.19", max: "1" },
          },
        ],
      },
      "0.0.0",
    );

    expect(repo.isVersionSupported(new Version("beta.24", "135.0.1"))).toBe(true);
    expect(repo.isVersionSupported(new Version("beta.18", "135.0.1"))).toBe(false);
  });

  it("falls back to secondary GitHub repos when the primary has no matching asset", async () => {
    class TestDownloader extends GitHubDownloader {
      override async getReleases(githubRepo: string): Promise<Array<Record<string, any>>> {
        if (githubRepo === "primary/repo") {
          throw new Error("missing");
        }

        return [
          {
            prerelease: true,
            assets: [{ browser_download_url: "https://example.com/camoufox.zip" }],
          },
        ];
      }
    }

    const downloader = new TestDownloader(["primary/repo", "fallback/repo"]);
    const asset = await downloader.getAsset();

    expect(asset).toBe("https://example.com/camoufox.zip");
    expect(downloader.githubRepo).toBe("fallback/repo");
    expect(downloader.isPrerelease).toBe(true);
  });

  it("treats alpha builds as prereleases even when the GitHub release is stable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => [
        {
          prerelease: false,
          assets: [
            {
              id: 1,
              size: 123,
              updated_at: "2026-06-08T12:00:00Z",
              name: "camoufox-135.0.2-alpha.26-lin.x86_64.zip",
              browser_download_url: "https://example.test/alpha.zip",
            },
            {
              id: 2,
              size: 456,
              updated_at: "2026-06-08T12:00:00Z",
              name: "camoufox-135.0.1-beta.24-lin.x86_64.zip",
              browser_download_url: "https://example.test/stable.zip",
            },
          ],
        },
      ],
    } as Response);

    const stableOnly = await listAvailableVersions(RepoConfig.getDefault(), false, "lin", "x86_64");
    const withPrerelease = await listAvailableVersions(RepoConfig.getDefault(), true, "lin", "x86_64");

    expect(stableOnly.map((version) => version.version.build)).toEqual(["beta.24"]);
    expect(withPrerelease.map((version) => [version.version.build, version.isPrerelease])).toEqual(
      expect.arrayContaining([
        ["alpha.26", true],
        ["beta.24", false],
      ]),
    );
  });
});
