import { loadYaml } from "./pkgman";

const WARNINGS_DATA = loadYaml("warnings.yml");

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
      warning += "\nIf this is intentional, pass `i_know_what_im_doing=True`.";
    }
    process.emitWarning(warning, {
      type: "LeakWarning",
      ctor: LeakWarning.warn,
    });
  }
}
