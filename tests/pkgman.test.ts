import { describe, expect, it } from "vitest";

import { RepoConfig, Version } from "../src/lib/pkgman";

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
});
