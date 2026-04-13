import { describe, expect, it } from "vitest";

import { sampleWebgl } from "../src/lib/webgl";

describe("webgl", () => {
  it("samples a WebGL profile from the bundled database", () => {
    const sampled = sampleWebgl("win");
    expect(sampled["webGl:vendor"]).toBeTruthy();
    expect(sampled["webGl:renderer"]).toBeTruthy();
  });
});
