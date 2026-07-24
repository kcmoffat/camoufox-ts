import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import * as server from "../src/lib/server";
import * as utils from "../src/lib/utils";

const MODULE_ERRORS = ["Cannot find module", "MODULE_NOT_FOUND"];

describe("server", () => {
  it("exports Python-compatible snake_case aliases", () => {
    expect(server.get_nodejs).toBe(server.getNodejs);
    expect(server.launch_server).toBe(server.launchServer);
  });

  it("resolves Playwright's public driver entrypoint for launchServer", () => {
    const result = spawnSync(
      server.getNodejs(),
      [
        "-e",
        "const pw = require(process.argv[1]); console.log(typeof pw.firefox.launchServer)",
        path.join(server.getDriverPackage(), "index.js"),
      ],
      { encoding: "utf8", timeout: 60_000 },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("function");
  });

  it("launch script resolves the installed Playwright package", () => {
    const result = spawnSync(
      server.getNodejs(),
      [server.getLaunchScript(), server.getDriverPackage()],
      {
        encoding: "utf8",
        input: Buffer.from(
          JSON.stringify({ executablePath: "/nonexistent/camoufox-bin" }),
        ).toString("base64"),
        timeout: 120_000,
      },
    );

    const combined = `${result.stdout}${result.stderr}`;
    for (const error of MODULE_ERRORS) {
      expect(combined).not.toContain(error);
    }
    expect(combined).toContain("Launching server...");
    expect(combined).toContain("executable doesn't exist");
  });

  it("surfaces the child exit code instead of a pipe error", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "camoufox-server-"));
    const scriptPath = path.join(tempDir, "dies-immediately.js");
    await writeFile(scriptPath, "process.exit(3);\n", "utf8");

    vi.spyOn(utils, "launchOptions").mockResolvedValue({ pad: "x".repeat(500_000) });
    vi.spyOn(server.SERVER_INTERNALS, "getLaunchScript").mockReturnValue(scriptPath);

    await expect(server.launchServer()).rejects.toThrow(
      "Server process terminated unexpectedly with exit code 3",
    );
  });
});
