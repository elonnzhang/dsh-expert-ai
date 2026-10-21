import type { Agent } from "@deepseek-ai/dsh-agent";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { ExpertRecord, ResolvedExpertSettings } from "../types.js";
import { expertAiHome } from "./identity.js";
import {
  importMimeograph,
  loadExpertCatalog,
  loadExpertPackage,
  readExpertReference,
  recordForPackage,
  resolveRevision,
} from "./expert-packages.js";

/** Branch used when the client does not name one. */
const DEFAULT_REF = "main";

interface Options {
  current: () => ResolvedExpertSettings;
  stateDir: () => string | undefined;
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("expert-ai: expected an object");
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`expert-ai: ${label} is required`);
  return value;
}

export function createExpertService(options: Options) {
  const recordFor = (id: string): ExpertRecord => {
    const record = options.current().records.find((item) => item.id === id && item.enabled);
    if (record === undefined) throw new Error(`expert-ai: enabled expert not found: ${id}`);
    return record;
  };

  return {
    registerTools(target: Pick<Agent, "ctx">): () => void {
      return target.ctx.tools.register(defineTool({
        name: "read_expert_reference",
        description: "读取已导入专家包中的参考资料。省略 path 列出文件；只返回本地固定版本内容，不会访问资料中的外部链接。",
        parameters: {
          id: { type: "string", required: true, description: "已启用的专家 ID" },
          path: { type: "string", description: "如 references/frameworks.md；省略则列出可读文件" },
        },
        output: { schema: { type: "json" }, render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }] },
        async execute(args) {
          const record = recordFor(args.id);
          if (record.expertPackage === undefined) throw new Error("expert-ai: expert has no imported package");
          const stateDir = options.stateDir();
          if (args.path === undefined) {
            const manifest = await loadExpertPackage(record.expertPackage, stateDir);
            return {
              id: record.id,
              revision: manifest.revision,
              files: manifest.files.filter((file) => file.path.startsWith("references/")),
            };
          }
          return { ...await readExpertReference(record, args.path, stateDir) };
        },
      }));
    },
    async rpc(endpoint: string, payload: unknown) {
      try {
        const input = object(payload);
        const stateDir = options.stateDir();
        let value: unknown;
        if (endpoint === "expert/catalog") {
          // Branches and tags move; the catalog is read from the commit the ref points to right now.
          const ref = input.ref === undefined ? DEFAULT_REF : string(input.ref, "ref").trim();
          const home = expertAiHome(process.env, stateDir);
          const { revision, cached } = await resolveRevision(ref, fetch, home);
          value = { ref, cached, experts: await loadExpertCatalog(revision, fetch, home) };
        } else if (endpoint === "expert/import") {
          const ref = input.ref === undefined ? DEFAULT_REF : string(input.ref, "ref").trim();
          const { revision } = await resolveRevision(ref, fetch, expertAiHome(process.env, stateDir));
          const manifest = await importMimeograph(
            { source: "mimeographs", slug: string(input.slug, "slug"), revision },
            stateDir,
          );
          value = { manifest, record: recordForPackage(manifest, ref) };
        } else {
          throw new Error(`expert-ai: unknown expert endpoint ${endpoint}`);
        }
        return { ok: true as const, value };
      } catch (error) {
        return {
          ok: false as const,
          error: { code: "internal" as const, message: error instanceof Error ? error.message : String(error), details: {} },
        };
      }
    },
  };
}
