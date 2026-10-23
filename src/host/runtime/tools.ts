/** The model-facing tools: `consult_expert` and `read_expert_reference`. */
import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { CanonicalExpertRecord } from "../../types.js";
import { identityFor, listPackReferences, readPackReference } from "../identity/index.js";
import { runConsultation } from "./consult.js";
import { compileConsultationPlan } from "./plan.js";

export interface ToolDeps {
  /** The enabled record with this id, or a thrown error naming why not. */
  record: (id: string) => CanonicalExpertRecord;
  stateDir: () => string | undefined;
}

/** Register both tools on the inherited Host plane, so delegated tool restrictions also constrain them. */
export function registerExpertTools(ctx: Context, deps: ToolDeps): () => void {
  const disposers = [
    ctx.tools.register(defineTool({
      name: "read_expert_reference",
      description: "读取专家方法包中的参考资料。省略 path 列出文件；只返回本地固定版本内容，不会访问资料中的外部链接。",
      parameters: {
        id: { type: "string", required: true, description: "已启用的专家 ID" },
        path: { type: "string", description: "如 references/frameworks.md；省略则列出可读文件" },
      },
      output: { schema: { type: "json" }, render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }] },
      async execute(args) {
        const record = deps.record(args.id);
        if (record.origin.kind !== "package" && record.origin.kind !== "bundled")
          throw new Error("expert-ai: expert has no reference pack");
        if (args.path === undefined) {
          const listed = await listPackReferences(record.origin, deps.stateDir());
          return { id: record.id, ...(listed.revision === undefined ? {} : { revision: listed.revision }), files: listed.files };
        }
        return { ...await readPackReference(record, args.path, deps.stateDir()) };
      },
    })),
    ctx.tools.register(defineTool({
      name: "consult_expert",
      description: "向一个指定的专家咨询问题。使用专家 ID；不要选择 provider 或传输方式。",
      parameters: {
        id: { type: "string", required: true, description: "专家 ID，例如 clq。" },
        question: { type: "string", required: true, description: "需要该专家独立回答的问题。" },
      },
      output: {
        schema: {
          type: "object",
          properties: {
            id: { type: "string", required: true },
            name: { type: "string", required: true },
            tags: { type: "array", items: { type: "string" }, required: true },
            answer: { type: "string", required: true },
          },
          additionalProperties: false,
        },
        render: (_args, value) => [{
          type: "text",
          text: `${value.name}${value.tags.length > 0 ? `（${value.tags.join("、")}）` : ""}：\n${value.answer}`,
        }],
      },
      async execute(args, exec) {
        const record = deps.record(args.id);
        const identity = await identityFor(record, deps.stateDir());
        const plan = compileConsultationPlan(record, identity, args.question);
        return { id: record.id, name: record.name, tags: record.tags, answer: await runConsultation(ctx, plan, exec) };
      },
    })),
  ];
  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}
