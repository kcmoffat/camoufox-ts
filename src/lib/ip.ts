import { InvalidIP, InvalidProxy } from "./exceptions";
import { ProxyAgent, fetch as undiciFetch } from "undici";

export class Proxy {
  server: string;
  username?: string;
  password?: string;
  bypass?: string;

  constructor(input: { server: string; username?: string; password?: string; bypass?: string }) {
    this.server = input.server;
    this.username = input.username;
    this.password = input.password;
    this.bypass = input.bypass;
  }

  static parseServer(server: string): { schema?: string; url: string; port?: string } {
    const match = /^(?:(?<schema>\w+):\/\/)?(?<url>.*?)(?::(?<port>\d+))?$/.exec(server);
    if (!match?.groups) {
      throw new InvalidProxy(`Invalid proxy server: ${server}`);
    }
    return match.groups as { schema?: string; url: string; port?: string };
  }

  asString(): string {
    const parsed = Proxy.parseServer(this.server);
    const schema = parsed.schema ?? "http";
    const credentials =
      this.username != null
        ? `${this.username}${this.password != null ? `:${this.password}` : ""}@`
        : "";
    return `${schema}://${credentials}${parsed.url}${parsed.port ? `:${parsed.port}` : ""}`;
  }
}

export function validIPv4(ip: string): boolean {
  return /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(ip);
}

export function validIPv6(ip: string): boolean {
  return /^(([0-9a-fA-F]{0,4}:){1,7}[0-9a-fA-F]{0,4})$/.test(ip);
}

export function validateIp(ip: string): void {
  if (!validIPv4(ip) && !validIPv6(ip)) {
    throw new InvalidIP(`Invalid IP address: ${ip}`);
  }
}

export async function publicIp(proxy?: string): Promise<string> {
  const urls = [
    "https://api.ipify.org",
    "https://checkip.amazonaws.com",
    "https://ipinfo.io/ip",
    "https://icanhazip.com",
    "https://ifconfig.co/ip",
    "https://ipecho.net/plain",
  ];

  let endException: unknown;
  for (const url of urls) {
    try {
      const response = await undiciFetch(url, {
        dispatcher: proxy ? new ProxyAgent(proxy) : undefined,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const ip = (await response.text()).trim();
      validateIp(ip);
      return ip;
    } catch (error) {
      endException = error;
    }
  }
  throw new InvalidIP(`Failed to get IP address: ${String(endException)}`);
}
