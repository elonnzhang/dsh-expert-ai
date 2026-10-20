#!/usr/bin/env node
/**
 * Load the built Host artifact and inspect the browser handoff without
 * starting a full Harness profile. Runtime integration still belongs to the
 * loading workflow documented in docs/load-into-dsh.md.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

const root = resolve(import.meta.dirname, "..");
const hostEntry = resolve(root, "lib/index.js");
const invariantEntry = resolve(root, "lib/invariant.js");
const clientEntry = resolve(root, "lib/client.js");
const clientTypes = resolve(root, "lib/types/client/index.d.ts");
const problems = [];

for (const entry of [hostEntry, invariantEntry, clientEntry]) {
  if (!existsSync(entry)) problems.push(`missing build artifact: ${entry}`);
}
if (!existsSync(clientTypes)) problems.push(`missing client declarations: ${clientTypes}`);

if (existsSync(hostEntry)) {
  const plugin = await import(pathToFileURL(hostEntry).href);
  if (plugin.name !== "expert-ai") problems.push("Host export name is not expert-ai");
  if (typeof plugin.apply !== "function") problems.push("Host export apply is missing");
  if (typeof plugin.Config !== "function") problems.push("Host export Config is missing");
}

if (existsSync(invariantEntry)) {
  const invariant = await import(pathToFileURL(invariantEntry).href);
  if (typeof invariant.apply !== "function") problems.push("Invariant export apply is missing");
}

if (existsSync(clientEntry)) {
  const client = readFileSync(clientEntry, "utf8");
  if (!client.includes("window.__ModuleLoader__.load")) {
    problems.push("Client artifact does not register with __ModuleLoader__");
  }
  if (!client.includes("dsh-expert-ai")) {
    problems.push("Client artifact has the wrong loader id");
  }
  let handoff;
  try {
    vm.runInNewContext(client, {
      window: {
        __ModuleLoader__: {
          load(value) {
            handoff = value;
          },
        },
      },
    });
  } catch (error) {
    problems.push(`Client artifact is not executable: ${String(error)}`);
  }
  if (handoff?.id !== "dsh-expert-ai" || typeof handoff?.factory !== "function") {
    problems.push("Client artifact did not hand off a loader factory");
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`x ${problem}`);
  process.exit(1);
}

console.log("ok dsh-expert-ai Host / Client artifacts");
