import { describe, expect, it, vi } from "vitest";

import { createCliProgram, findInstalled, resolveFetchTarget } from "../src/lib/__main__";

const installedVersions = [
  {
    repoName: "official",
    version: { build: "beta.24", fullString: "135.0.1-beta.24" },
    channelPath: "official/stable/135.0.1-beta.24",
    relativePath: "browsers/official/135.0.1-beta.24",
    isPrerelease: false,
  },
  {
    repoName: "official",
    version: { build: "beta.25", fullString: "135.0.2-beta.25" },
    channelPath: "official/prerelease/135.0.2-beta.25",
    relativePath: "browsers/official/135.0.2-beta.25",
    isPrerelease: true,
  },
];

vi.mock("../src/lib/multiversion", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/multiversion")>(
    "../src/lib/multiversion",
  );
  return {
    ...actual,
    listInstalled: vi.fn(() => installedVersions),
  };
});

function normalizeHelp(help: string): string {
  return help.replace(/\s+/g, " ").trim();
}

describe("createCliProgram", () => {
  it("surfaces upstream-style command descriptions in top-level help", () => {
    const help = normalizeHelp(createCliProgram().helpInformation());

    expect(help).toContain("fetch");
    expect(help).toContain("Install the active version, a channel target, or a specific version");
    expect(help).toContain("set");
    expect(help).toContain("Set the active Camoufox version to use and fetch");
    expect(help).toContain("remove");
    expect(help).toContain("Remove downloaded data, or select a browser channel or version");
  });

  it("includes guided examples for fetch, set, and remove subcommands", () => {
    const program = createCliProgram();

    expect(
      normalizeHelp(program.commands.find((command) => command.name() === "fetch")?.helpInformation() ?? ""),
    ).toContain(
      "camoufox fetch official/stable",
    );
    expect(
      normalizeHelp(program.commands.find((command) => command.name() === "fetch")?.helpInformation() ?? ""),
    ).toContain(
      "camoufox fetch official/stable/135.0-beta.25",
    );
    expect(
      normalizeHelp(program.commands.find((command) => command.name() === "set")?.helpInformation() ?? ""),
    ).toContain(
      "camoufox set official/stable/134.0.2-beta.20",
    );
    expect(
      normalizeHelp(program.commands.find((command) => command.name() === "remove")?.helpInformation() ?? ""),
    ).toContain(
      "camoufox remove official/stable",
    );
    expect(
      normalizeHelp(program.commands.find((command) => command.name() === "remove")?.helpInformation() ?? ""),
    ).toContain(
      "camoufox remove --select",
    );
  });

  it("resolves fetch channel specifiers to the latest cached build", () => {
    const cache = {
      repos: [
        {
          name: "Official",
          versions: [
            { version: "135.0.2", build: "beta.25", is_prerelease: true },
            { version: "135.0.1", build: "beta.24", is_prerelease: false },
          ],
        },
      ],
    };

    expect(resolveFetchTarget(cache, {}, "official/stable")).toEqual({
      repoName: "official",
      verString: "135.0.1-beta.24",
    });
    expect(resolveFetchTarget(cache, {}, "official/prerelease")).toEqual({
      repoName: "official",
      verString: "135.0.2-beta.25",
    });
  });

  it("finds installed browsers by repo/channel selectors", () => {
    expect(findInstalled("official/stable")?.channelPath).toBe("official/stable/135.0.1-beta.24");
    expect(findInstalled("official/prerelease")?.channelPath).toBe(
      "official/prerelease/135.0.2-beta.25",
    );
  });
});
