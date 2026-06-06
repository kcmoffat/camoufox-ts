import { describe, expect, it, vi } from "vitest";

import { LeakWarning } from "../src/lib/_warnings";

describe("LeakWarning", () => {
  it("matches the python opt-out guidance", () => {
    const warningSpy = vi.spyOn(process, "emitWarning").mockImplementation(() => process);

    LeakWarning.warn("ff_version", false);

    expect(warningSpy).toHaveBeenCalledWith(
      expect.stringContaining("pass `i_know_what_im_doing=True`"),
      expect.objectContaining({
        type: "LeakWarning",
        ctor: LeakWarning.warn,
      }),
    );

    warningSpy.mockRestore();
  });

  it("does not emit warnings when the opt-out flag is enabled", () => {
    const warningSpy = vi.spyOn(process, "emitWarning").mockImplementation(() => process);

    LeakWarning.warn("ff_version", true);

    expect(warningSpy).not.toHaveBeenCalled();
    warningSpy.mockRestore();
  });
});
