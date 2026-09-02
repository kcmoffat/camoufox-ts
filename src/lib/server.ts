import { spawn } from "node:child_process";
import path from "node:path";

import { normalizeSnakeCaseKeys, toCamelCaseDict } from "./case";
import { assetPath } from "./assets";
import * as utils from "./utils";

export function getNodejs(): string {
  return process.execPath;
}

export const get_nodejs = getNodejs;

export function getDriverPackage(): string {
  return path.dirname(require.resolve("playwright/package.json"));
}

export function getLaunchScript(): string {
  return assetPath("launchServer.js");
}

export const SERVER_INTERNALS = {
  getDriverPackage,
  getLaunchScript,
  spawnProcess: spawn,
} as const;

export async function launchServer(options: Record<string, any> = {}): Promise<never> {
  const normalizedOptions = normalizeSnakeCaseKeys(options);

  for (const unsupported of ["persistentContext", "userDataDir"] as const) {
    if (normalizedOptions[unsupported]) {
      throw new Error(
        `launchServer() does not support '${unsupported}': Playwright cannot serve a persistent context over a websocket endpoint. Use Camoufox(persistentContext=true, ...) in-process instead.`,
      );
    }
  }

  const nextOptions = { ...normalizedOptions };
  delete nextOptions.persistentContext;
  delete nextOptions.userDataDir;

  const config = await utils.launchOptions(nextOptions);
  const data = `${Buffer.from(JSON.stringify(toCamelCaseDict(config))).toString("base64")}\n`;
  const driverPackage = SERVER_INTERNALS.getDriverPackage();
  const server = SERVER_INTERNALS.spawnProcess(getNodejs(), [SERVER_INTERNALS.getLaunchScript(), driverPackage], {
    cwd: driverPackage,
    stdio: ["pipe", "inherit", "inherit"],
  });

  server.stdin.on("error", () => undefined);
  server.stdin.end(data);

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    server.once("error", reject);
    server.once("close", resolve);
  });

  throw new Error(`Server process terminated unexpectedly with exit code ${exitCode}`);
}

export const launch_server = launchServer;
