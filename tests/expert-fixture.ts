import { vi } from "vitest";
/** The commit the fixture packages are pinned to; the plugin never fetches it. */
const MIMEOGRAPHS_REVISION = "a38f5fcad0853be3e98a6cd95d8e6bf8c66f7c7b";

export const packageBinding = { source: "mimeographs", slug: "test-expert", revision: MIMEOGRAPHS_REVISION } as const;

export function packageFetcher(options: { references?: string[]; fail?: string } = {}) {
  const references = options.references ?? ["references/frameworks.md", "references/principles.md", "references/sources.md"];
  const files: Record<string, string> = {
    "catalog.json": JSON.stringify({ experts: [{
      slug: "test-expert", name: "Test expert", description: "Analyze evidence", category: "Scientists & researchers",
      path: "mimeographs/test-expert", files: { agents: true, skill: true, references },
    }] }),
    LICENSE: "MIT License\nCopyright test fixture",
    "mimeographs/test-expert/AGENTS.md": "# Test method\nSeparate evidence from assumptions.",
    "mimeographs/test-expert/SKILL.md": "---\nname: test-expert\n---\nRead references/frameworks.md.",
    "mimeographs/test-expert/references/frameworks.md": "# Framework\nCompare alternatives against a baseline.",
    "mimeographs/test-expert/references/principles.md": "# Principles\nAsk which evidence would change the decision.",
    "mimeographs/test-expert/references/sources.md": "# Sources\nA test fixture, not a real scientist.",
  };
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    const path = url.pathname.split("/").slice(4).join("/");
    if (path === options.fail || files[path] === undefined) return new Response("missing", { status: 404 });
    return new Response(files[path]);
  });
}
