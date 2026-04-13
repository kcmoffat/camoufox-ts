import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
    "-shmem",
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

  get xvfbCmd(): string[] {
    return [this.xvfbPath, `:${this.display}`, ...VirtualDisplay.xvfbArgs];
  }

  get display(): number {
    if (this.displayNumber == null) {
      this.displayNumber = VirtualDisplay.freeDisplay();
    }
    return this.displayNumber;
  }

  get(): string {
    VirtualDisplay.assertLinux();
    if (!this.proc) {
      if (this.debug) {
        console.log("Starting virtual display:", this.xvfbCmd.join(" "));
      }
      this.proc = spawn(this.xvfbCmd[0], this.xvfbCmd.slice(1), {
        stdio: this.debug ? "inherit" : "ignore",
        detached: true,
      });
      this.proc.unref();
    } else if (this.debug) {
      console.log(`Using virtual display: ${this.display}`);
    }
    return `:${this.display}`;
  }

  kill(): void {
    if (this.proc && this.proc.exitCode == null && !this.proc.killed) {
      if (this.debug) {
        console.log("Terminating virtual display:", this.display);
      }
      this.proc.kill();
    }
  }

  private static getLockFiles(): string[] {
    const tmpDir = process.env.TMPDIR ?? os.tmpdir();
    try {
      return fs
        .readdirSync(tmpDir)
        .filter((entry) => /^\.X\d+-lock$/.test(entry))
        .map((entry) => path.join(tmpDir, entry));
    } catch {
      return [];
    }
  }

  private static freeDisplay(): number {
    const displays = VirtualDisplay.getLockFiles().map((lockFile) =>
      Number.parseInt(lockFile.split("X")[1].split("-")[0], 10),
    );
    return displays.length ? Math.max(99, Math.max(...displays) + randInt(3, 20)) : 99;
  }

  static assertLinux(): void {
    if (OS_NAME !== "lin") {
      throw new VirtualDisplayNotSupported("Virtual display is only supported on Linux.");
    }
  }
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min)) + min;
}
