import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { transform } from "lightningcss";
import type { UserConfig } from "tsdown";

/** The id used by the web shell's client module loader. */
const PLUGIN_ID = "dsh-expert-ai";

/**
 * Modules seeded by the Web Profile and resolved by the injected `require`.
 * Keep this list aligned with Harness `packages/client/web/src/platform.ts`.
 */
const MODULE_TABLE = [
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-dom/client",
  "@deepseek-ai/cordis",
  "@deepseek-ai/dsh-client-store",
  "@deepseek-ai/dsh-client-ui-slots",
  "@deepseek-ai/dsh-client-ui-primitives",
  "@deepseek-ai/dsh-client-ui-dockkit",
] as const;

const CSS_VIRTUAL_PREFIX = "\0dsh-expert-ai-css:";
const CSS_VIRTUAL_SUFFIX = ".mjs";
const INLINE_CSS_VIRTUAL_PREFIX = "\0dsh-expert-ai-inline-css:";
const GLOBAL_CSS_VIRTUAL_PREFIX = "\0dsh-expert-ai-global-css:";
const INLINE_CSS_QUERY = "?inline";

function isModuleTableSpecifier(source: string): boolean {
  return MODULE_TABLE.includes(source as (typeof MODULE_TABLE)[number]);
}

function sourceAssetPath(source: string, importer: string | undefined): string {
  if (importer === undefined) return resolve(source);
  return resolve(dirname(importer), source);
}

function styleInjectionModule(fileId: string, css: string, classMap?: Record<string, string>): string {
  const tagId = `${PLUGIN_ID}/${basename(fileId)}`;
  return [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(tagId)};`,
    "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {",
    "  const tag = document.createElement('style');",
    `  tag.dataset.plugin = ${JSON.stringify(PLUGIN_ID)};`,
    "  tag.dataset.pluginCss = tagId;",
    "  tag.textContent = css;",
    "  document.head.appendChild(tag);",
    "}",
    classMap === undefined ? "export {};" : `export default ${JSON.stringify(classMap)};`,
  ].join("\n");
}

function cssModulesPlugin() {
  return {
    name: "dsh-expert-ai-css-modules",
    resolveId(source: string, importer: string | undefined) {
      if (source.endsWith(".module.css")) {
        const file = sourceAssetPath(source, importer);
        return `${CSS_VIRTUAL_PREFIX}${file}${CSS_VIRTUAL_SUFFIX}`;
      }
      if (source.endsWith(INLINE_CSS_QUERY) && source.slice(0, -INLINE_CSS_QUERY.length).endsWith(".css")) {
        const file = sourceAssetPath(source.slice(0, -INLINE_CSS_QUERY.length), importer);
        return `${INLINE_CSS_VIRTUAL_PREFIX}${file}${CSS_VIRTUAL_SUFFIX}`;
      }
      if (source.endsWith(".css") && !source.endsWith(".module.css")) {
        const file = sourceAssetPath(source, importer);
        return `${GLOBAL_CSS_VIRTUAL_PREFIX}${file}${CSS_VIRTUAL_SUFFIX}`;
      }
      return null;
    },
    async load(this: { addWatchFile(file: string): void }, id: string) {
      if (id.startsWith(CSS_VIRTUAL_PREFIX)) {
        const file = id.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length);
        this.addWatchFile(file);
        const source = await readFile(file);
        const { code, exports } = transform({
          filename: file,
          code: source,
          cssModules: { pattern: "[hash]_[local]" },
          minify: true,
        });
        const classMap: Record<string, string> = {};
        for (const [local, value] of Object.entries(exports ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
          classMap[local] = value.name;
        }
        return styleInjectionModule(file, code.toString(), classMap);
      }
      if (id.startsWith(INLINE_CSS_VIRTUAL_PREFIX)) {
        const file = id.slice(INLINE_CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length);
        this.addWatchFile(file);
        const source = await readFile(file);
        const { code } = transform({ filename: file, code: source, minify: true });
        return `export default ${JSON.stringify(code.toString())};`;
      }
      if (id.startsWith(GLOBAL_CSS_VIRTUAL_PREFIX)) {
        const file = id.slice(GLOBAL_CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length);
        this.addWatchFile(file);
        const source = await readFile(file);
        const { code } = transform({ filename: file, code: source, minify: true });
        return styleInjectionModule(file, code.toString());
      }
      return null;
    },
  };
}

function clientPurityPlugin() {
  return {
    name: "dsh-expert-ai-client-purity",
    resolveId(source: string) {
      if (source.startsWith("@deepseek-ai/") && !isModuleTableSpecifier(source)) {
        throw new Error(
          `client bundle purity: ${JSON.stringify(source)} is not a Web Profile module-table entry; `
            + "keep cross-plugin runtime collaboration behind Cordis services",
        );
      }
      return null;
    },
  };
}

/** Build the loader-registration Client half next to the Host artifacts. */
export function clientBundle(): UserConfig {
  return {
    name: `${PLUGIN_ID}/client`,
    entry: { client: "src/client/index.ts" },
    outDir: "lib",
    format: "cjs",
    platform: "browser",
    target: "es2022",
    dts: false,
    sourcemap: true,
    clean: false,
    deps: {
      neverBundle: [...MODULE_TABLE],
    },
    define: {
      "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production"),
      "import.meta.env": JSON.stringify({ MODE: process.env.NODE_ENV ?? "production" }),
      "import.meta.env.MODE": JSON.stringify(process.env.NODE_ENV ?? "production"),
    },
    plugins: [clientPurityPlugin(), cssModulesPlugin()],
    outputOptions: {
      entryFileNames: "client.js",
      intro: "var module = { exports: {} }; var exports = module.exports;",
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: "return module.exports; } });",
    },
  };
}
