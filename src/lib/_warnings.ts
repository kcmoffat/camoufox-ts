import fs from "node:fs";

import { assetPath } from "./assets";
import { loadYaml } from "./pkgman";

const WARNINGS_DATA = loadYaml("warnings.yml");

function firstExternalFrame(): string | undefined {
  const stack = new Error().stack?.split("\n").slice(1) ?? [];
  for (const line of stack) {
    if (!line.includes(`${pathFragment()}src/lib`) && !line.includes(`${pathFragment()}dist/lib`)) {
      return line.trim();
    }
  }
  return undefined;
}

function pathFragment(): string {
  return fs.existsSync(assetPath()) ? "" : "";
}

export class LeakWarning extends Error {
  static warn(warningKey: string, iKnowWhatImDoing?: boolean): void {
    let warning = WARNINGS_DATA[warningKey];
    if (!warning) {
      return;
    }
    if (iKnowWhatImDoing) {
      return;
    }
    if (iKnowWhatImDoing !== undefined) {
      warning += "\nIf this is intentional, pass `i_know_what_im_doing=true`.";
    }
    const detail = firstExternalFrame();
    process.emitWarning(detail ? `${warning}\n${detail}` : warning, {
      type: "LeakWarning",
    });
  }
}
