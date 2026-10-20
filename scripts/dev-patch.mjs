#!/usr/bin/env node
/**
 * Generate a local --patch overlay for the built Host and Client.
 * The paths must be absolute because dsh resolves overlay module names from
 * the profile directory, not from the overlay file's directory.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderDevPatch } from "./render-dev-patch.mjs";

const root = resolve(import.meta.dirname, "..");
const host = resolve(root, "lib/index.js");
const client = resolve(root, "lib/client.js");
for (const entry of [host, client]) {
  if (!existsSync(entry)) {
    console.error(`missing ${entry}; run \`pnpm run build\` first`);
    process.exit(1);
  }
}

const output = resolve(root, "dev/cordis.dev.local.yml");
mkdirSync(resolve(root, "dev"), { recursive: true });
writeFileSync(output, renderDevPatch({ host, client }));
console.log(`wrote ${output}`);
