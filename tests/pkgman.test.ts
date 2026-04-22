import { describe, expect, it } from "vitest";

import { GitHubDownloader, RepoConfig, Version } from "../src/lib/pkgman";

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
});
