import { firefox } from "playwright";

import { launchOptions } from "./utils";

export function camelCase(snakeStr: string): string {
  if (snakeStr.length < 2) {
    return snakeStr;
  }
  return snakeStr
    .toLowerCase()
    .split("_")
    .map((part, index) => (index === 0 ? part : `${part[0].toUpperCase()}${part.slice(1)}`))
    .join("");
}

export function toCamelCaseDict(data: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [camelCase(key), value]));
}

export function getNodejs(): string {
  return process.execPath;
}

export async function launchServer(options: Record<string, any> = {}): Promise<never> {
  const config = await launchOptions(options);
  const server = await firefox.launchServer(config);
  console.log("Websocket endpoint:", server.wsEndpoint());
  return await new Promise<never>(() => undefined);
}
