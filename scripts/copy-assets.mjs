import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const srcAssets = path.join(root, "src", "assets");
const distAssets = path.join(root, "dist", "assets");

if (existsSync(srcAssets)) {
  mkdirSync(distAssets, { recursive: true });
  cpSync(srcAssets, distAssets, { recursive: true });
}
