import fs from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";

import which from "which";

import {
  CannotExecuteXvfb,
  CannotFindXvfb,
  VirtualDisplayNotSupported,
} from "./exceptions";
import { OS_NAME } from "./pkgman";

const DEFAULT_SCREEN = "1x1x24";
const SCREEN_ENV_VAR = "CAMOUFOX_VIRTUAL_DISPLAY_SIZE";
const COMPOSITE_ENV_VAR = "CAMOUFOX_VIRTUAL_DISPLAY_COMPOSITE";

function resolveScreen(): string {
  const value = process.env[SCREEN_ENV_VAR]?.trim() ?? "";
  if (!value) {
    return DEFAULT_SCREEN;
  }

  const parts = value.toLowerCase().split("x");
  if (
    ![2, 3].includes(parts.length) ||
    parts.some((part) => !/^\d+$/.test(part) || Number.parseInt(part, 10) <= 0)
  ) {
    throw new VirtualDisplayNotSupported(
      `${SCREEN_ENV_VAR} must look like '1920x1080' or '1920x1080x24', got ${JSON.stringify(value)}`,
    );
  }

  if (parts.length === 2) {
    parts.push("24");
  }
  return parts.join("x");
}

export class VirtualDisplay {
  readonly debug: boolean;
  readonly screen: string;
  readonly composite: boolean;
  proc?: ChildProcess;
  private displayNumber?: number;
  private displayPromise?: Promise<number>;
  private killPromise?: Promise<void>;
  private static readonly displayFd = 3;
  private static readonly displayReadTimeoutMs = 10_000;
  private static readonly killTimeoutMs = 5_000;
  private static readonly x11SocketDir = "/tmp/.X11-unix";

  constructor(debug = false, screen?: string, composite?: boolean) {
    this.debug = debug;
    this.screen = screen ?? resolveScreen();
    this.composite =
      composite ?? ["1", "true"].includes(process.env[COMPOSITE_ENV_VAR]?.trim() ?? "0");
  }

  get xvfbPath(): string {
    const resolved = which.sync("Xvfb", { nothrow: true });
    if (!resolved) {
      throw new CannotFindXvfb("Please install Xvfb to use headless mode.");
    }
    if (!fs.existsSync(resolved) || (fs.statSync(resolved).mode & 0o111) === 0) {
      throw new CannotExecuteXvfb(`I do not have permission to execute Xvfb: ${resolved}`);
    }
    return resolved;
  }

  async get(): Promise<string> {
    VirtualDisplay.assertLinux();
    if (!this.displayPromise) {
      this.displayPromise = this.start();
    } else if (this.debug) {
      console.log(`Using virtual display: ${this.displayNumber ?? "starting"}`);
    }

    try {
      this.displayNumber = await this.displayPromise;
    } catch (error) {
      this.displayPromise = undefined;
      throw error;
    }

    return `:${this.displayNumber}`;
  }

  private start(): Promise<number> {
    const cmd = [
      this.xvfbPath,
      "-displayfd",
      String(VirtualDisplay.displayFd),
      "-screen",
      "0",
      this.screen,
      "-ac",
      "-nolisten",
      "tcp",
      "-extension",
      "RENDER",
      "+extension",
      "GLX",
      this.composite ? "+extension" : "-extension",
      "COMPOSITE",
      "-extension",
      "XVideo",
      "-extension",
      "XVideo-MotionCompensation",
      "-extension",
      "XINERAMA",
      "-fp",
      "built-ins",
      "-nocursor",
      "-br",
    ];

    if (this.debug) {
      console.log("Starting virtual display:", cmd.join(" "));
    }

    this.proc = spawn(cmd[0], cmd.slice(1), {
      stdio: [
        "ignore",
        this.debug ? "inherit" : "ignore",
        this.debug ? "inherit" : "ignore",
        "pipe",
      ],
      detached: true,
      env: {
        ...process.env,
        __GLX_VENDOR_LIBRARY_NAME: "mesa",
        LIBGL_ALWAYS_SOFTWARE: "1",
      },
    });
    this.proc.unref();

    const displayPipe = this.proc.stdio[VirtualDisplay.displayFd];
    if (!displayPipe) {
      void this.kill();
      throw new CannotExecuteXvfb("Xvfb did not expose a display pipe");
    }

    return new Promise<number>((resolve, reject) => {
      let buffer = "";
      let settled = false;

      const fail = (message: string): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        void this.kill();
        reject(new CannotExecuteXvfb(message));
      };

      const succeed = (value: number): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      };

      const timeout = setTimeout(() => {
        fail(`Xvfb did not report a display within ${VirtualDisplay.displayReadTimeoutMs}ms`);
      }, VirtualDisplay.displayReadTimeoutMs);

      displayPipe.on("data", (chunk: string | Buffer) => {
        if (settled) {
          return;
        }

        buffer += chunk.toString();
        if (!buffer.includes("\n")) {
          return;
        }

        const display = Number.parseInt(buffer.trim(), 10);
        if (!Number.isInteger(display)) {
          fail(`Xvfb wrote non-integer display: ${JSON.stringify(buffer)}`);
          return;
        }

        succeed(display);
      });

      displayPipe.once("close", () => {
        if (!settled && !buffer.includes("\n")) {
          fail(
            `Xvfb did not report a display (got ${JSON.stringify(buffer)}, exit=${this.proc?.exitCode ?? null})`,
          );
        }
      });

      displayPipe.once("error", (error) => {
        fail(`Failed reading Xvfb display pipe: ${error.message}`);
      });
    });
  }

  async kill(): Promise<void> {
    if (this.killPromise) {
      await this.killPromise;
      return;
    }

    const proc = this.proc;
    if (!proc || proc.exitCode != null) {
      this.resetState();
      return;
    }

    this.killPromise = (async () => {
      if (this.debug) {
        console.log("Terminating virtual display:", this.displayNumber);
      }
      proc.kill("SIGKILL");

      if (proc.exitCode == null) {
        const timedOut = Symbol("timedOut");
        const result = await Promise.race([
          once(proc, "exit").then(() => undefined),
          new Promise<symbol>((resolve) => {
            setTimeout(() => resolve(timedOut), VirtualDisplay.killTimeoutMs);
          }),
        ]);
        if (result === timedOut && this.debug) {
          console.log("Xvfb did not exit after SIGKILL");
        }
      }

      this.removeDisplayArtifacts();
    })();

    try {
      await this.killPromise;
    } finally {
      this.resetState();
      this.killPromise = undefined;
    }
  }

  private removeDisplayArtifacts(): void {
    if (this.displayNumber == null) {
      return;
    }
    try {
      fs.rmSync(`/tmp/.X${this.displayNumber}-lock`, { force: true });
    } catch {}
    try {
      fs.rmSync(`${VirtualDisplay.x11SocketDir}/X${this.displayNumber}`, { force: true });
    } catch {}
  }

  private resetState(): void {
    this.proc = undefined;
    this.displayPromise = undefined;
    this.displayNumber = undefined;
  }

  static assertLinux(): void {
    if (OS_NAME !== "lin") {
      throw new VirtualDisplayNotSupported("Virtual display is only supported on Linux.");
    }
  }
}
