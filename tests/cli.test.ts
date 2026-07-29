import { afterEach, describe, expect, it, vi } from "vitest";

import { createCliProgram, findInstalled, resolveFetchTarget } from "../src/lib/__main__";
import * as multiversion from "../src/lib/multiversion";

const installedVersions = [
  {
    repoName: "official",
    version: { build: "beta.24", fullString: "135.0.1-beta.24" },
    channelPath: "official/stable/135.0.1-beta.24",
    relativePath: "browsers/official/135.0.1-beta.24",
    isPrerelease: false,
    sha256: "aaaaaaaa11111111",
  },
  {
    repoName: "official",
    version: { build: "beta.25", fullString: "135.0.2-beta.25" },
    channelPath: "official/prerelease/135.0.2-beta.25",
    relativePath: "browsers/official/135.0.2-beta.25",
    isPrerelease: true,
    sha256: "bbbbbbbb22222222",
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
  afterEach(() => {
    vi.restoreAllMocks();
  });

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
      "camoufox fetch 135.0-beta.25",
    );
    expect(
      normalizeHelp(program.commands.find((command) => command.name() === "fetch")?.helpInformation() ?? ""),
    ).toContain(
      "camoufox fetch official/stable/135.0-beta.25",
    );
    expect(
      normalizeHelp(program.commands.find((command) => command.name() === "fetch")?.helpInformation() ?? ""),
    ).toContain(
      "camoufox fetch official/stable/135.0-beta.25-aaaaaaaa",
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

  it("resolves bare version-build fetch specifiers against the default repo", () => {
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

    expect(resolveFetchTarget(cache, {}, "135.0.1-beta.24")).toEqual({
      repoName: "official",
      verString: "135.0.1-beta.24",
      sha256: undefined,
    });
  });

  it("finds installed browsers by repo/channel selectors", () => {
    expect(findInstalled("official/stable")?.channelPath).toBe("official/stable/135.0.1-beta.24");
    expect(findInstalled("official/prerelease")?.channelPath).toBe(
      "official/prerelease/135.0.2-beta.25",
    );
  });

  it("prints the pinned sha suffix for python-style pinned_sha configs", async () => {
    vi.spyOn(multiversion, "loadConfig").mockReturnValue({
      channel: "official/stable",
      pinned: "135.0.1-beta.24",
      pinned_sha: "aaaaaaaa11111111",
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await createCliProgram().parseAsync(["active"], { from: "user" });

    expect(log).toHaveBeenCalledWith("official/stable/135.0.1-beta.24 (aaaaaaaa)");
  });
});
