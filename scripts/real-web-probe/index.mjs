// Kept outside lib/ and published files; exact Fetch routes retain connection auth and Host/Origin checks.
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export const name = "real-web-probe";
export const inject = ["tools", "connection", "expertIdentity", "agents", "systemPrompt"];

export const SNAPSHOT_PATH = "/api/real-web-probe/snapshot";
const KEPT_EVENTS = 200;

const digest = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);

async function describeIdentity(ctx, id) {
  const identity = await ctx.expertIdentity.get(id);
  if (identity === undefined) return { id, found: false };
  const { name: personName, title, category, source, revision, enabled, avatar, persona, disclosure } = identity;
  return {
    id, found: true, name: personName, title, category, source, revision, enabled, disclosure,
    personaChars: persona.length,
    avatar: avatar === undefined ? null : { mime: avatar.mime, base64Chars: avatar.data.length, digest: digest(avatar.data) },
  };
}

async function describeAgent(ctx, id) {
  const agent = ctx.agents.get(id);
  if (agent === undefined) return { id, found: false };
  // Full assembly can materialize plugin snapshots; inspect disposable test sessions only.
  const assembly = await ctx.systemPrompt.assemble({ agent, scope: agent });
  return {
    id, found: true,
    callableTools: ctx.tools.schemas(agent).map((schema) => schema.name).sort(),
    wireTools: assembly.tools.map((schema) => schema.name).sort(),
    sections: assembly.sections.map(({ name, text }) => ({ name, chars: text.length })),
    contexts: assembly.contexts.map(({ name, text }) => ({ name, chars: text.length })),
  };
}

export function apply(ctx) {
  const home = process.env.DSH_HOME;
  if (home === undefined || home === "") throw new Error("real-web-probe: DSH_HOME is not set; refusing to write anywhere else");
  const directory = join(home, "real-web");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const logFile = join(directory, "probe.jsonl");
  const events = [];
  const record = (entry) => {
    const line = { at: new Date().toISOString(), ...entry };
    events.push(line);
    if (events.length > KEPT_EVENTS) events.shift();
    appendFileSync(logFile, `${JSON.stringify(line)}\n`, { mode: 0o600 });
  };

  record({ event: "probe/started" });
  ctx.on("expert-identity/changed", async (change) => {
    const after = await Promise.all(change.ids.map(async (id) => {
      const identity = await ctx.expertIdentity.get(id);
      return identity === undefined ? { id, found: false } : { id, found: true, revision: identity.revision };
    }));
    record({ event: "expert-identity/changed", ids: change.ids, withdrawn: change.withdrawn ?? [], after });
  });
  ctx.on("settings/document-updated", (namespace, revision) => {
    if (namespace === "digital-life") record({ event: "settings/document-updated", revision });
  });

  ctx.effect(() => ctx.connection.fetch.register({
    path: SNAPSHOT_PATH,
    methods: ["GET"],
    requestBody: "buffered",
    async fetch(request) {
      const params = new URL(request.url).searchParams;
      const listed = await ctx.expertIdentity.list();
      const ids = [...new Set([...listed.map((summary) => summary.id), ...params.getAll("id")])];
      return Response.json({
        agents: await Promise.all([...new Set(params.getAll("agent"))].map((id) => describeAgent(ctx, id))),
        tools: ctx.tools.schemas().map((schema) => schema.name).sort(),
        listed: listed.map(({ id, revision }) => ({ id, revision })),
        identities: await Promise.all(ids.map((id) => describeIdentity(ctx, id))),
        events,
      });
    },
  }), "real-web-probe: snapshot route");
}
