import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { IncomingMessage, ServerResponse, createServer } from "node:http";
import { spawn } from "node:child_process";

import { assetPath } from "../assets";
import {
  CamoufoxUpdate,
  doSync,
  findInstalled,
  resolveFetchTarget,
  setChannel,
  setPinned,
} from "../__main__";
import { DefaultAddons, maybeDownloadAddons } from "../addons";
import {
  ALLOW_GEOIP,
  GEOIP_DIR,
  downloadMmdb,
  getGeoipConfigByName,
  getMmdbPath,
  loadGeoipConfig,
  loadGeoipRepos,
  removeMmdb,
  saveGeoipConfig,
} from "../geolocation";
import {
  InstalledVersion,
  listInstalled,
  loadConfig,
  loadRepoCache,
  removeVersion,
} from "../multiversion";
import { AvailableVersion, RepoConfig, Version } from "../pkgman";

type JsonObject = Record<string, any>;

export class GuiBackend {
  async state(): Promise<JsonObject> {
    const config = loadConfig();
    const cache = loadRepoCache();
    const installed = listInstalled();
    return {
      active: {
        channel: config.channel ?? "official/stable",
        pinned: config.pinned ?? null,
      },
      repos: cache.repos ?? [],
      installed: installed.map((version) => serializeInstalledVersion(version)),
      geoip: await this.geoipState(),
    };
  }

  async sync(body: JsonObject): Promise<JsonObject> {
    await doSync(body.spoofOs, body.spoofArch, body.spoofLibraryVersion);
    return this.state();
  }

  async fetch(body: JsonObject): Promise<JsonObject> {
    const { repoConfig, selected } = this.resolveFetchTarget(body.version);
    if (!repoConfig || !selected) {
      throw new Error(`Version '${body.version ?? "active"}' not found in cache.`);
    }
    await new CamoufoxUpdate(repoConfig, selected).initialize().then((update) => update.update());
    if (ALLOW_GEOIP) {
      await downloadMmdb().catch(() => undefined);
    }
    await maybeDownloadAddons(Object.values(DefaultAddons));
    return this.state();
  }

  async setChannel(body: JsonObject): Promise<JsonObject> {
    setChannel(body.repoName, body.channelType);
    return this.state();
  }

  async pinVersion(body: JsonObject): Promise<JsonObject> {
    const target = findInstalled(`${body.repoName}/${body.channelType}/${body.version}`);
    const [version] = String(body.version).split("-", 2);
    setPinned(
      body.repoName,
      body.channelType,
      { version, build: body.version.slice(version.length + 1) },
      target,
    );
    return this.state();
  }

  async remove(body: JsonObject): Promise<JsonObject> {
    const target = body.versionPath ? findInstalled(body.versionPath) : undefined;
    if (target) {
      await removeVersion(target.path);
    } else if (!body.versionPath) {
      await fsp.rm(path.dirname(GEOIP_DIR), { recursive: true, force: true });
    }
    return this.state();
  }

  async geoipDownload(body: JsonObject): Promise<JsonObject> {
    await downloadMmdb(body.source);
    return this.state();
  }

  async geoipDelete(): Promise<JsonObject> {
    await removeMmdb();
    return this.state();
  }

  async geoipActivate(body: JsonObject): Promise<JsonObject> {
    await saveGeoipConfig(getGeoipConfigByName(body.source));
    return this.state();
  }

  async geoipDeleteSource(body: JsonObject): Promise<JsonObject> {
    const config = getGeoipConfigByName(body.source);
    const name = String(config.name).toLowerCase();
    if (fs.existsSync(path.join(GEOIP_DIR, "mmdb"))) {
      for (const entry of await fsp.readdir(path.join(GEOIP_DIR, "mmdb"))) {
        if (entry.startsWith(`${name}-`) && entry.endsWith(".mmdb")) {
          await fsp.rm(path.join(GEOIP_DIR, "mmdb", entry), { force: true });
        }
      }
    }
    return this.state();
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (req.method === "GET" && req.url === "/api/state") {
        return this.json(res, 200, await this.state());
      }
      if (req.method === "POST" && req.url) {
        const body = await readJson(req);
        switch (req.url) {
          case "/api/sync":
            return this.json(res, 200, await this.sync(body));
          case "/api/fetch":
            return this.json(res, 200, await this.fetch(body));
          case "/api/set-channel":
            return this.json(res, 200, await this.setChannel(body));
          case "/api/pin-version":
            return this.json(res, 200, await this.pinVersion(body));
          case "/api/remove":
            return this.json(res, 200, await this.remove(body));
          case "/api/geoip/download":
            return this.json(res, 200, await this.geoipDownload(body));
          case "/api/geoip/delete-data":
            return this.json(res, 200, await this.geoipDelete());
          case "/api/geoip/activate":
            return this.json(res, 200, await this.geoipActivate(body));
          case "/api/geoip/delete-source":
            return this.json(res, 200, await this.geoipDeleteSource(body));
          default:
            break;
        }
      }
      if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(await fsp.readFile(assetPath("gui", "index.html"), "utf8"));
        return;
      }
      res.writeHead(404);
      res.end("Not found");
    } catch (error) {
      this.json(res, 500, {
        error: String(error),
      });
    }
  }

  async start(debug = false): Promise<{ url: string; close: () => Promise<void> }> {
    const server = createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind GUI server");
    }
    const url = `http://127.0.0.1:${address.port}`;
    if (!debug) {
      openUrl(url);
    }
    return {
      url,
      close: () =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    };
  }

  private async geoipState(): Promise<JsonObject> {
    const [sources] = loadGeoipRepos();
    const mmdbDir = path.join(GEOIP_DIR, "mmdb");
    const downloaded: string[] = [];
    for (const source of sources) {
      const lowerName = String(source.name).toLowerCase();
      if (
        fs.existsSync(path.join(mmdbDir, `${lowerName}-combined.mmdb`)) ||
        fs.existsSync(path.join(mmdbDir, `${lowerName}-ipv4.mmdb`))
      ) {
        downloaded.push(source.name);
      }
    }

    const config = loadGeoipConfig();
    const activePath = getMmdbPath("ipv4", config);
    let size = 0;
    if (fs.existsSync(activePath)) {
      size += fs.statSync(activePath).size;
      const ipv6Path = getMmdbPath("ipv6", config);
      if (fs.existsSync(ipv6Path)) {
        size += fs.statSync(ipv6Path).size;
      }
    }

    return {
      available: ALLOW_GEOIP,
      sources: sources.map((source) => source.name),
      installed: fs.existsSync(activePath) ? config.name : null,
      downloaded,
      path: fs.existsSync(activePath) ? path.dirname(activePath) : null,
      size: size ? `${(size / (1024 * 1024)).toFixed(1)} MB` : null,
      updatedAt: fs.existsSync(activePath)
        ? new Date(fs.statSync(activePath).mtimeMs).toISOString().slice(0, 16).replace("T", " ")
        : null,
    };
  }

  private resolveFetchTarget(specifier?: string): {
    repoConfig?: RepoConfig;
    selected?: AvailableVersion;
  } {
    const cache = loadRepoCache();
    const config = loadConfig();
    const { repoName, verString: fullVersion } = resolveFetchTarget(cache, config, specifier);

    const repo = (cache.repos ?? []).find(
      (entry: Record<string, any>) => entry.name.toLowerCase() === repoName?.toLowerCase(),
    );
    const candidate = (repo?.versions ?? []).find(
      (entry: Record<string, any>) => `${entry.version}-${entry.build}` === fullVersion,
    );
    if (!repo || !candidate) {
      return {};
    }
    return {
      repoConfig: RepoConfig.findByName(repo.name),
      selected: new AvailableVersion({
        version: new Version(candidate.build, candidate.version),
        url: candidate.url,
        isPrerelease: Boolean(candidate.is_prerelease),
        assetId: candidate.asset_id,
        assetSize: candidate.asset_size,
        assetUpdatedAt: candidate.asset_updated_at,
      }),
    };
  }

  private json(res: ServerResponse, status: number, data: JsonObject): void {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data));
  }
}

function serializeInstalledVersion(version: InstalledVersion): JsonObject {
  return {
    repoName: version.repoName,
    version: version.version.fullString,
    build: version.version.build,
    path: version.path,
    channelPath: version.channelPath,
    isActive: version.isActive,
    isPrerelease: version.isPrerelease,
  };
}

async function readJson(req: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  if (!chunks.length) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as JsonObject;
}

function openUrl(url: string): void {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args =
    process.platform === "win32" ? ["/c", "start", "", url] : [url];
  spawn(command, args, { detached: true, stdio: "ignore" }).unref();
}
