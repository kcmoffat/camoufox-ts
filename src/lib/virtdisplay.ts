import fs from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";

import which from "which";

import {
  CannotExecuteXvfb,
  CannotFindXvfb,
  VirtualDisplayNotSupported,
} from "./exceptions";
import { OS_NAME } from "./pkgman";

export class VirtualDisplay {
  readonly debug: boolean;
  proc?: ChildProcess;
  private displayNumber?: number;
  private displayPromise?: Promise<number>;
  private static readonly displayFd = 3;
  private static readonly displayReadTimeoutMs = 10_000;

  static readonly xvfbArgs = [
    "-screen",
    "0",
    "1x1x24",
    "-ac",
    "-nolisten",
    "tcp",
    "-extension",
    "RENDER",
    "+extension",
    "GLX",
    "-extension",
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
  ] as const;

  constructor(debug = false) {
    this.debug = debug;
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
      ...VirtualDisplay.xvfbArgs,
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
      this.kill();
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
        this.kill();
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

  kill(): void {
    if (this.proc && this.proc.exitCode == null && !this.proc.killed) {
      if (this.debug) {
        console.log("Terminating virtual display:", this.displayNumber);
      }
      this.proc.kill();
    }
  }

  static assertLinux(): void {
    if (OS_NAME !== "lin") {
      throw new VirtualDisplayNotSupported("Virtual display is only supported on Linux.");
    }
  }
}
