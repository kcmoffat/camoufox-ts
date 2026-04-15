import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

mkdirSync(".releases", { recursive: true });

const result = spawnSync("npm", ["pack", "--pack-destination", ".releases"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
