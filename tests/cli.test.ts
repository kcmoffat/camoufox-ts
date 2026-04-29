import { describe, expect, it } from "vitest";

import { createCliProgram } from "../src/lib/__main__";

function normalizeHelp(help: string): string {
  return help.replace(/\s+/g, " ").trim();
}

describe("createCliProgram", () => {
  it("surfaces upstream-style command descriptions in top-level help", () => {
    const help = normalizeHelp(createCliProgram().helpInformation());

    expect(help).toContain("fetch");
    expect(help).toContain("Install the active version, or a specific version");
    expect(help).toContain("set");
    expect(help).toContain("Set the active Camoufox version to use and fetch");
    expect(help).toContain("remove");
    expect(help).toContain("Remove downloaded data, or select a specific browser version");
  });

  it("includes guided examples for fetch, set, and remove subcommands", () => {
    const program = createCliProgram();

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
      "camoufox remove --select",
    );
  });
});
