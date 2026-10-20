import type { ExpertRecord } from "../types.js";
import { ID_PATTERN } from "./records.js";

function parseAgentMetadata(frontmatter: string): { id?: string; name?: string } {
  const values: { id?: string; name?: string } = {};
  for (const line of frontmatter.split("\n")) {
    const match = /^(id|name|description):\s*["']?(.+?)["']?\s*$/.exec(line.trim());
    if (match === null) continue;
    const value = match[2]?.trim() ?? "";
    if (match[1] === "id") values.id = value;
    // The canonical file uses `name` for the stable record id and stores the
    // display name/tag in description: "名称（标签）".
    if (match[1] === "name" && values.id === undefined) values.id = value;
    if (match[1] === "description" && values.name === undefined) values.name = value;
  }
  return values;
}

/**
 * Import a browser-selected Agent Markdown file into an editor draft.
 * @param markdown File contents.
 * @param fileName Name the browser reports for the file.
 * @param draft Draft the file is imported into.
 * @returns The draft carrying the file's identity inline, or undefined when the file has no identity body.
 */
export function applyAgentMarkdown(
  markdown: string,
  fileName: string,
  draft: ExpertRecord,
): ExpertRecord | undefined {
  const text = markdown.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const end = text.startsWith("---\n") ? text.indexOf("\n---\n", 4) : -1;
  const frontmatter = end === -1 ? "" : text.slice(4, end);
  const identity = (end === -1 ? text : text.slice(end + 5)).trim();
  if (identity === "") return undefined;

  // Prefer the Agent frontmatter as the source of truth for metadata. A
  // browser only exposes the filename, not the local absolute path.
  const metadata = parseAgentMetadata(frontmatter);
  const fileId = metadata.id ?? fileName.replace(/\.md$/i, "");
  const id = ID_PATTERN.test(fileId) ? fileId : draft.id;
  const name = metadata.name ?? draft.name;
  // A browser-selected file cannot be reopened by the Host after the picker closes.
  // Persist the imported identity inline instead of the browser-only filename.
  const { agent: _agent, ...withoutAgent } = draft;
  return { ...withoutAgent, id, name, persona: identity };
}
