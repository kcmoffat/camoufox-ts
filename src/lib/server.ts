import { firefox } from "playwright";

import { camelCase, toCamelCaseDict } from "./case";
import { launchOptions } from "./utils";

export function getNodejs(): string {
  return process.execPath;
}

export const get_nodejs = getNodejs;

export async function launchServer(options: Record<string, any> = {}): Promise<never> {
  const config = await launchOptions(options);
  const server = await firefox.launchServer(config);
  console.log("Websocket endpoint:", server.wsEndpoint());
  return await new Promise<never>(() => undefined);
}

export const launch_server = launchServer;
