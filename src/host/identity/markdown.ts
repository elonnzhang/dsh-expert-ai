import type { CanonicalExpertRecord } from "../../types.js";

/** Agent files may carry YAML frontmatter; only the Markdown body is identity. */
export function agentIdentity(markdown: string): string {
  const normalized = markdown.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return normalized.trim();
  const end = normalized.indexOf("\n---\n", 4);
  return (end === -1 ? normalized : normalized.slice(end + 5)).trim();
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

/** Render a Claude/WorkBuddy-compatible agent file. */
export function agentDocument(
  record: Pick<CanonicalExpertRecord, "id" | "name" | "description">,
  identity: string,
): string {
  const lines = [
    "---",
    `name: ${yamlString(record.id)}`,
    `description: ${yamlString(record.description || record.name)}`,
    "---",
    "",
    identity.trim(),
  ];
  return `${lines.join("\n")}\n`;
}
