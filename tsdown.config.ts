import { defineConfig } from "tsdown";
import { clientBundle } from "./tsdown.client.ts";

/**
 * The Host and Client halves share one package directory but have different
 * runtime contracts. The Host is a normal externalized Node library; the
 * Client is the loader-registration bundle defined in tsdown.client.ts.
 */
export default defineConfig([
  {
    name: "dsh-expert-ai",
    entry: {
      index: "src/index.ts",
      invariant: "src/invariant.ts",
    },
    outDir: "lib",
    format: "esm",
    platform: "node",
    target: "node22",
    fixedExtension: false,
    dts: true,
    clean: true,
    deps: {
      // Cordis and every dsh package are supplied by the running Harness. A
      // second copy would give the plugin a different Context identity.
      neverBundle: true,
      dts: { neverBundle: true },
    },
  },
  clientBundle(),
]);
