import { describe, expect, it } from "vitest";

import {
  getNodejs,
  get_nodejs,
  launchServer,
  launch_server,
} from "../src/lib/server";

describe("server", () => {
  it("exports Python-compatible snake_case aliases", () => {
    expect(get_nodejs).toBe(getNodejs);
    expect(launch_server).toBe(launchServer);
  });
});
