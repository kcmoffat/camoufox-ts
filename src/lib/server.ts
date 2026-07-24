import { spawn } from "node:child_process";
import path from "node:path";

import { toCamelCaseDict } from "./case";
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
} as const;

export async function launchServer(options: Record<string, any> = {}): Promise<never> {
  const config = await utils.launchOptions(options);
  const data = Buffer.from(JSON.stringify(toCamelCaseDict(config))).toString("base64");
  const driverPackage = SERVER_INTERNALS.getDriverPackage();
  const server = spawn(getNodejs(), [SERVER_INTERNALS.getLaunchScript(), driverPackage], {
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
