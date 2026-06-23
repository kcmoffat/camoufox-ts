import { describe, expect, it } from "vitest";

import { findInstalledForVersion } from "../src/lib/multiversion";
import { Version } from "../src/lib/pkgman";

describe("multiversion", () => {
  it("matches duplicate version-build installs by sha when present", () => {
    const installed = [
      {
        repoName: "jwriter20",
        version: new Version("beta.25", "150.0.2"),
        path: "/tmp/browsers/jwriter20/150.0.2-beta.25-aaaaaaaa",
        sha256: "aaaaaaaa11111111",
      },
      {
        repoName: "jwriter20",
        version: new Version("beta.25", "150.0.2"),
        path: "/tmp/browsers/jwriter20/150.0.2-beta.25-bbbbbbbb",
        sha256: "bbbbbbbb22222222",
      },
    ] as any;

    const matched = findInstalledForVersion(
      "150.0.2-beta.25",
      "bbbbbbbb22222222",
      "jwriter20",
      2,
      installed,
    );

    expect(matched?.path).toContain("bbbbbbbb");
  });

  it("keeps legacy installs addressable when a version-build is unique", () => {
    const installed = [
      {
        repoName: "official",
        version: new Version("beta.24", "135.0.1"),
        path: "/tmp/browsers/official/135.0.1-beta.24",
      },
    ] as any;

    const matched = findInstalledForVersion("135.0.1-beta.24", undefined, "official", 1, installed);

    expect(matched?.path).toContain("135.0.1-beta.24");
  });
});
