/** Every endpoint the Host serves below `/api/expert-ai/`, each with the payload it accepts. */
import z from "@deepseek-ai/schemastery";
import type { SessionId } from "@deepseek-ai/dsh-session";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { CanonicalExpertRecord } from "../../types.js";
import {
  createProject,
  expertAiHome,
  identityFor,
  importMimeograph,
  loadExpertCatalog,
  recordForPackage,
  resolveRevision,
} from "../identity/index.js";
import { appendOpeningAssistantMessage, loadBinding } from "../runtime/index.js";
import { defineEndpoint, type Endpoint } from "./endpoint.js";

/** Branch used when the client does not name one. */
const DEFAULT_REF = "main";

export const HOST_ENDPOINTS = [
  "project",
  "greeting",
  "identity",
  "binding",
  "unbind",
  "bind",
  "expert/catalog",
  "expert/import",
] as const;

export interface EndpointDeps {
  stateDir: () => string | undefined;
  record: (id: string) => CanonicalExpertRecord;
  agent: (sessionId: string) => Agent | undefined;
  bind: (agent: Agent, record: CanonicalExpertRecord) => Promise<void>;
  /** Unbind a live Session, or forget the saved binding of one that is not loaded. */
  unbind: (sessionId: string, agent: Agent | undefined) => Promise<void>;
  fetch?: typeof fetch;
}

const text = (): z<string> => z.string().required() as z<string>;
const Session = z.object({ sessionId: text() });
const Ref = z.object({ ref: z.string().required(false) });

function refOf(input: { ref?: string | undefined }): string {
  const ref = input.ref?.trim();
  return ref === undefined || ref === "" ? DEFAULT_REF : ref;
}

export function createEndpoints(deps: EndpointDeps): Endpoint[] {
  const agentFor = (sessionId: string): Agent => {
    const agent = deps.agent(sessionId);
    if (agent === undefined) throw new Error(`unknown session "${sessionId}"`);
    return agent;
  };
  const fetcher = (): typeof fetch => deps.fetch ?? fetch;
  const endpoints = [
    defineEndpoint("project", z.object({}), async () => ({ cwd: await createProject(deps.stateDir()) })),
    defineEndpoint("greeting", z.object({ sessionId: text(), text: text() }), async (input) => {
      const agent = agentFor(input.sessionId);
      appendOpeningAssistantMessage(agent.session, input.text);
      return { sessionId: agent.id };
    }),
    defineEndpoint("identity", z.object({ recordId: text() }), async (input) => {
      const record = deps.record(input.recordId);
      return { recordId: record.id, identity: await identityFor(record, deps.stateDir()) };
    }),
    defineEndpoint("binding", Session, async (input) => {
      const loaded = await loadBinding(input.sessionId, deps.stateDir());
      return loaded === undefined ? undefined : { recordId: loaded.plan.expertId };
    }),
    defineEndpoint("unbind", Session, async (input) => {
      await deps.unbind(input.sessionId, deps.agent(input.sessionId as SessionId));
      return { sessionId: input.sessionId };
    }),
    defineEndpoint("bind", z.object({ sessionId: text(), recordId: text() }), async (input) => {
      const record = deps.record(input.recordId);
      const agent = agentFor(input.sessionId);
      await deps.bind(agent, record);
      return { sessionId: agent.id, recordId: record.id };
    }),
    defineEndpoint("expert/catalog", Ref, async (input) => {
      // Branches and tags move; the catalog is read from the commit the ref points to right now.
      const ref = refOf(input);
      const home = expertAiHome(process.env, deps.stateDir());
      const { revision, cached } = await resolveRevision(ref, fetcher(), home);
      return { ref, cached, experts: await loadExpertCatalog(revision, fetcher(), home) };
    }),
    defineEndpoint("expert/import", z.object({ slug: text(), ref: z.string().required(false) }), async (input) => {
      const ref = refOf(input);
      const stateDir = deps.stateDir();
      const { revision } = await resolveRevision(ref, fetcher(), expertAiHome(process.env, stateDir));
      const manifest = await importMimeograph({ source: "mimeographs", slug: input.slug, revision }, stateDir, fetcher());
      return { manifest, record: recordForPackage(manifest, ref) };
    }),
  ] as Endpoint[];
  return endpoints;
}
