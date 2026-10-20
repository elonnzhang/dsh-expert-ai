#!/usr/bin/env node
/**
 * Generate a local --patch overlay for the built Host and Client.
 * `--conversation` also turns the conversation feature on and adds the
 * expert-ai-mode preset; without it the overlay is identity-only.
 * The paths must be absolute because dsh resolves overlay module names from
 * the profile directory, not from the overlay file's directory.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderDevPatch } from "./render-dev-patch.mjs";

const root = resolve(import.meta.dirname, "..");
const host = resolve(root, "lib/index.js");
const client = resolve(root, "lib/client.js");
const preset = resolve(root, "expert-ai-mode.patch.yml");
const conversation = process.argv.includes("--conversation");
for (const entry of [host, client]) {
  if (!existsSync(entry)) {
    console.error(`missing ${entry}; run \`pnpm run build\` first`);
    process.exit(1);
  }
}

const output = resolve(root, "dev/cordis.dev.local.yml");
mkdirSync(resolve(root, "dev"), { recursive: true });
writeFileSync(
  output,
  renderDevPatch({ host, client, conversation, preset: conversation ? readFileSync(preset, "utf8") : "" }),
);
console.log(`wrote ${output}${conversation ? " (conversation on)" : ""}`);
