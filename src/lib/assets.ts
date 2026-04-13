import fs from "node:fs";
import path from "node:path";

function resolveAssetRoot(): string {
  const candidate = path.resolve(__dirname, "..", "assets");
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  return path.resolve(process.cwd(), "src", "assets");
}

export const LOCAL_DATA = resolveAssetRoot();

export function assetPath(...parts: string[]): string {
  return path.join(LOCAL_DATA, ...parts);
}

export function projectRoot(): string {
  return path.resolve(LOCAL_DATA, "..", "..");
}
