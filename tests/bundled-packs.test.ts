import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const patchFile = readFileSync(join(root, "cordis.patch.yml"), "utf8");
const PINS = {
  clq: "1b7cc8d710e395fc0b5cf6ad9f6c9d74e4804902e72f3db563c1b06372f1d526",
  lh: "70f9604769b7f2c3a3cff369459d7c782d5a73a670fa6e16a37abcac9be9d7a3",
  lzg: "45720b83bada5f82850157aa71d45ce23dd164d39d0773f36be507ba43602240",
  zyq: "dfcfd6a0d674e855c653bc2e19f85e19aef0575329ed847fcd35afc563537be4",
  oyg: "d1f798267b2ee2332ebf8b8b7979258d8700d56376cf2ac5d19a2a2bbd5919cb",
  wcf: "cf89c882cc1b532a085cdcd662f1d5a99474d824353a6edf0bd730e7a3164334",
  zjh: "c16bc4a38d7f34859630ee523ac7bd2e6aa39951edd7c4e0e62dde1e0fc25cc2",
  yhg: "fcbbb07ed5b1844649c1480a5d640ce82eb1a81950e3eb142250b5f3d320a8e4",
  crx: "4779c0bef9a90a6d93bf1dd22c1bc7bb9b06b6401b84bab35c20bd70641117be",
} as const;

const experts = join(root, "experts");
const PACKS = readdirSync(experts).flatMap((collection) =>
  readdirSync(join(experts, collection), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ collection, id: entry.name, directory: join(experts, collection, entry.name) })),
);

interface PatchRecord {
  id: string;
  name: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  source: { kind: string; note?: string };
}

function stripFrontmatter(markdown: string): string {
  const normalized = markdown.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return normalized.trim();
  const end = normalized.indexOf("\n---\n", 4);
  return (end === -1 ? normalized : normalized.slice(end + 5)).trim();
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function filesIn(directory: string, prefix = ""): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (prefix === "" && entry.name === "manifest.json") continue;
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...filesIn(join(directory, entry.name), path));
    else files.push(path);
  }
  return files.sort();
}

function yamlScalar(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('"') ? JSON.parse(trimmed) as string : trimmed;
}

function patchRecord(block: string, id: string): PatchRecord {
  const fields = new Map<string, string>();
  const lines = block.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^ {12}([a-z]+):(?: (.*))?$/.exec(lines[index] ?? "");
    if (match?.[1] === undefined || ["tags", "origin", "source"].includes(match[1])) continue;
    if (match[2] !== ">-") {
      fields.set(match[1], match[2] ?? "");
      continue;
    }
    const values: string[] = [];
    while (lines[index + 1]?.startsWith("              ")) {
      index += 1;
      values.push((lines[index] ?? "").trim());
    }
    fields.set(match[1], values.join(" "));
  }

  const tags: string[] = [];
  const tagStart = lines.findIndex((line) => line === "            tags:");
  for (const line of lines.slice(tagStart + 1)) {
    const match = /^ {14}- (.+)$/.exec(line);
    if (match?.[1] === undefined) break;
    tags.push(yamlScalar(match[1]));
  }

  const sourceStart = lines.findIndex((line) => line === "            source:");
  const source: PatchRecord["source"] = { kind: "" };
  for (const line of lines.slice(sourceStart + 1)) {
    const match = /^ {14}(kind|note): (.+)$/.exec(line);
    if (match?.[1] === undefined) break;
    source[match[1] as "kind" | "note"] = yamlScalar(match[2] ?? "");
  }

  const text = (name: string) => {
    const value = fields.get(name);
    if (value === undefined) throw new Error(`${id}: missing ${name}`);
    return yamlScalar(value);
  };
  return {
    id,
    name: text("name"),
    title: text("title"),
    description: text("description"),
    category: text("category"),
    tags,
    source,
  };
}

const records = new Map(
  patchFile.split(/^ {10}- id: /m).slice(1).map((block) => {
    const id = block.slice(0, block.indexOf("\n"));
    return [id, patchRecord(block, id)];
  }),
);

describe("bundled expert packs", () => {
  it("finds at least the nine Xingtu packs", () => {
    expect(PACKS.length).toBeGreaterThanOrEqual(9);
  });

  for (const { collection, id, directory } of PACKS) {
    describe(`${collection}/${id}`, () => {
      const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
      const agents = readFileSync(join(directory, "AGENTS.md"), "utf8");

      it("has a v2 bundled manifest whose file list matches disk", () => {
        expect(manifest.schemaVersion).toBe(2);
        expect(manifest.origin).toBe("bundled");
        expect(manifest.id).toBe(id);
        expect(manifest.provenance.collection).toBe(collection);
        const paths = filesIn(directory);
        expect(manifest.files.map((file: { path: string }) => file.path)).toEqual(paths);
        for (const file of manifest.files) {
          const content = readFileSync(join(directory, file.path));
          expect(file.sha256, file.path).toBe(sha256(content));
          expect(file.bytes, file.path).toBe(content.byteLength);
        }
      });

      it("has a non-empty identity without frontmatter", () => {
        expect(agents.startsWith("---\n")).toBe(false);
        expect(agents.trim()).not.toBe("");
      });

      it("matches the patch record", () => {
        const record = records.get(id);
        expect(record, id).toBeDefined();
        expect(manifest.name).toBe(record?.name);
        expect(manifest.title).toBe(record?.title);
        expect(manifest.description).toBe(record?.description);
        expect(manifest.category).toBe(record?.category);
        expect(manifest.tags).toEqual(record?.tags);
        expect(manifest.source).toEqual(record?.source);
        expect(records.size).toBe(9);
        expect(patchFile).toMatch(new RegExp(`^ {12}origin:\\n {14}kind: bundled\\n {14}path: experts/${collection}/${id}$`, "m"));
      });

      if (id in PINS) {
        it("keeps the pinned identity revision", () => {
          expect(sha256(stripFrontmatter(agents))).toBe(PINS[id as keyof typeof PINS]);
        });
      }
    });
  }

  it("passes the pack manifest check", () => {
    expect(() => execFileSync(process.execPath, ["scripts/pack-manifest.mjs", "--check"], {
      cwd: root,
      encoding: "utf8",
    })).not.toThrow();
  });
});
