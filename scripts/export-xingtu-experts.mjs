#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { packFiles } from "./pack-manifest.mjs";

/** Snapshot used to regenerate the bundled Xingtu expert method packs. */
const SNAPSHOT = process.argv[2];
const OUT = process.argv[3] ?? "experts/xingtu";
if (SNAPSHOT === undefined) {
  console.error("Usage: node scripts/export-xingtu-experts.mjs <xingtu-snapshot> [output]");
  process.exit(1);
}

const kb = JSON.parse(await readFile(join(SNAPSHOT, "webapp/data/kb.json"), "utf8"));
const TITLE = {
  clq: "固态电池与科研方法思考助手",
  lh: "固态电池与产学研思考助手",
  lzg: "光伏与长期主义思考助手",
  zyq: "动力电池与储能思考助手",
  oyg: "电池安全与产业路线图思考助手",
  wcf: "新能源汽车与电池技术思考助手",
  zjh: "储能系统思考助手",
  yhg: "固态电池工程化思考助手",
  crx: "光伏逆变器与储能思考助手",
};
const META = {
  clq: { category: "science", tags: ["固态电池", "锂电池", "科研方法", "电动中国"] },
  lh: { category: "science", tags: ["固态电池", "纳米硅碳", "产学研", "人才培养"] },
  lzg: { category: "business", tags: ["光伏", "单晶硅", "第一性原理", "长期主义"] },
  zyq: { category: "business", tags: ["动力电池", "储能", "技术成熟度", "体系化"] },
  oyg: { category: "science", tags: ["动力电池", "电池安全", "政策产业", "路线图"] },
  wcf: { category: "business", tags: ["新能源汽车", "电池技术", "工程师思维", "创新"] },
  zjh: { category: "business", tags: ["储能系统", "算电协同", "长期主义", "工程化"] },
  yhg: { category: "business", tags: ["固态电池", "混合固液", "工程化", "产业化"] },
  crx: { category: "business", tags: ["光伏逆变器", "储能", "氢能", "聚焦"] },
};
const MOOD_SECTIONS = [
  ["story", "经历与成长", 3],
  ["method", "方法论与做事方式", 2],
  ["value", "价值观与关键判断", 2],
  ["tech", "技术与产业判断", 2],
];

function sourceOf(item) {
  if (item.src && typeof item.src === "object")
    return [item.src.org, item.src.title, item.src.date].filter(Boolean).join(" · ");
  return item.s ?? "星途公开资料整理";
}

function render(person) {
  const moodMap = { story: [], method: [], value: [], tech: [] };
  const seen = new Set();
  for (const item of person.qa ?? []) {
    const key = item.a.slice(0, 24);
    if (seen.has(key) || moodMap[item.mood] === undefined) continue;
    seen.add(key);
    moodMap[item.mood].push(item);
  }
  const lines = [
    `# ${person.name} · ${person.role}`,
    "",
    "## 身份与语气",
    "",
    person.desc,
    "",
    `语气与人设：${person.persona}`,
    "",
    "## 可用素材",
    "",
  ];
  for (const [mood, title, count] of MOOD_SECTIONS) {
    const items = moodMap[mood].slice(0, count);
    if (items.length === 0) continue;
    lines.push(`### ${title}`, "");
    for (const item of items) lines.push(item.a, `（来源：${sourceOf(item)}）`, "");
  }
  lines.push("## 引导问题", "");
  for (const guide of person.guides ?? []) lines.push(`- ${guide}`);
  lines.push(
    "",
    "## 回答边界",
    "",
    "- 优先使用上方公开素材；素材未覆盖时可基于公开经历与方法论推演，但必须明确说明这是推演。",
    "- 不提供股票、投资、商业合作、技术评审结论、商业背书或广告营销。",
    "- 涉及未公开经营信息、家庭隐私、健康信息或争议话题时，说明不便代答。",
    "- 不要冒充本人实时观点，不要声称获得本人授权。",
    "- 内容来自星途快照中的公开资料整理，仅用于内部原型；正式运营前需取得本人授权。",
    "",
  );
  return lines.join("\n");
}

for (const [id, person] of Object.entries(kb)) {
  const directory = join(OUT, id);
  const file = join(directory, "AGENTS.md");
  const title = TITLE[id];
  if (title === undefined) throw new Error(`missing title for Xingtu expert ${id}`);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  await writeFile(file, `${render({ ...person, id }).trimEnd()}\n`, "utf8");
  const manifest = {
    schemaVersion: 2,
    origin: "bundled",
    id,
    name: person.name,
    title,
    description: person.desc,
    category: META[id].category,
    tags: META[id].tags,
    source: { kind: "public" },
    provenance: { collection: "xingtu" },
    files: await packFiles(directory),
  };
  await writeFile(join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}
console.log(`exported ${Object.keys(kb).length} Xingtu experts to ${OUT}`);
