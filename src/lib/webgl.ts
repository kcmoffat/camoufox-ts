import fs from "node:fs";

import { DatabaseSync } from "node:sqlite";

import { assetPath } from "./assets";
import { OS_ARCH_MATRIX } from "./pkgman";

const DB_PATH = assetPath("webgl_data.db");

export function sampleWebgl(
  os: keyof typeof OS_ARCH_MATRIX,
  vendor?: string,
  renderer?: string,
): Record<string, any> {
  if (!(os in OS_ARCH_MATRIX)) {
    throw new Error(`Invalid OS: ${os}. Must be one of: win, mac, lin`);
  }
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`Missing WebGL database at ${DB_PATH}`);
  }

  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    if (vendor && renderer) {
      const row = db
        .prepare(`SELECT vendor, renderer, data, ${os} AS probability FROM webgl_fingerprints WHERE vendor = ? AND renderer = ?`)
        .get(vendor, renderer) as
        | { vendor: string; renderer: string; data: string; probability: number }
        | undefined;
      if (!row) {
        throw new Error(`No WebGL data found for vendor "${vendor}" and renderer "${renderer}"`);
      }
      if (row.probability <= 0) {
        const pairs = db
          .prepare(`SELECT DISTINCT vendor, renderer FROM webgl_fingerprints WHERE ${os} > 0`)
          .all() as Array<{ vendor: string; renderer: string }>;
        throw new Error(
          `Vendor "${vendor}" and renderer "${renderer}" combination not valid for ${os.toUpperCase()}. Possible pairs: ${pairs
            .map((pair) => `(${pair.vendor}, ${pair.renderer})`)
            .join(", ")}`,
        );
      }
      return JSON.parse(row.data) as Record<string, any>;
    }

    const results = db
      .prepare(`SELECT data, ${os} AS probability FROM webgl_fingerprints WHERE ${os} > 0`)
      .all() as Array<{ data: string; probability: number }>;
    if (!results.length) {
      throw new Error(`No WebGL data found for OS: ${os}`);
    }
    const total = results.reduce((sum, result) => sum + result.probability, 0);
    let cursor = Math.random() * total;
    for (const result of results) {
      cursor -= result.probability;
      if (cursor <= 0) {
        return JSON.parse(result.data) as Record<string, any>;
      }
    }
    return JSON.parse(results[results.length - 1].data) as Record<string, any>;
  } finally {
    db.close();
  }
}

export function getPossiblePairs(): Record<string, Array<[string, string]>> {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    const result = {} as Record<string, Array<[string, string]>>;
    for (const os of Object.keys(OS_ARCH_MATRIX) as Array<keyof typeof OS_ARCH_MATRIX>) {
      const rows = db
        .prepare(`SELECT DISTINCT vendor, renderer FROM webgl_fingerprints WHERE ${os} > 0 ORDER BY ${os} DESC`)
        .all() as Array<{ vendor: string; renderer: string }>;
      result[os] = rows.map((row) => [row.vendor, row.renderer]);
    }
    return result;
  } finally {
    db.close();
  }
}
