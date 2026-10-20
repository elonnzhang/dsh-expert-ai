import { createHash } from "node:crypto";
import { Service, type Context } from "@deepseek-ai/cordis";
import { avatarProblem } from "../avatar.js";
import { DEFAULT_EXPERT_TITLE, EXPERT_AI_CATEGORY_LABELS, EXPERT_SOURCE_KINDS } from "../constants.js";
import type {
  ExpertRecord,
  ExpertIdentityAvatar,
  ExpertIdentitySource,
  ExpertIdentitySourceKind,
} from "../types.js";
import { identityFor, initializeIdentities, reconcileIdentities } from "./identity.js";

declare module "@deepseek-ai/cordis" {
  interface Context {
    expertIdentity: ExpertIdentityService;
  }
  interface Events {
    "expert-identity/changed"(change: ExpertIdentityChange): void;
  }
}

/** What a Bot runtime may list and filter by; carries no persona text. */
export interface ExpertIdentitySummary {
  /** Stable record id, matching `/^[a-z0-9][a-z0-9-]*$/`. */
  id: string;
  name: string;
  /** Text shown after the name; "思考助手" when the record sets none. */
  title: string;
  description: string;
  /** Display name of the primary domain; the record's own label when it is custom. */
  category: string;
  tags: string[];
  avatar?: ExpertIdentityAvatar;
  source: ExpertIdentitySource;
  /** sha256 (hex) of the persona text. */
  revision: string;
  enabled: boolean;
}

export interface ExpertIdentity extends ExpertIdentitySummary {
  /** Persona Markdown without frontmatter. */
  persona: string;
  /** Where the persona comes from, as one paragraph the Bot puts into its prompt as is. */
  disclosure: string;
}

export interface ExpertIdentityService {
  /** Enabled identities whose persona can be read, in settings order. */
  list(): Promise<ExpertIdentitySummary[]>;
  /** `undefined` for an unknown, disabled, or unreadable identity; never throws. */
  get(id: string): Promise<ExpertIdentity | undefined>;
}

/**
 * Payload of `expert-identity/changed`: the sorted ids that appeared, disappeared, or changed.
 * `withdrawn` lists, sorted, the ids whose record was disabled or deleted by this change; it is absent
 * when there are none, and an identity whose persona merely cannot be read is never listed there.
 * Every withdrawn id is also in `ids`.
 */
export interface ExpertIdentityChange {
  ids: string[];
  withdrawn?: string[];
}

export interface ExpertIdentityOptions {
  /** Records as saved; the managed identity files are kept in step with them. */
  saved: () => readonly ExpertRecord[];
  /** Records after normalization; these are what the service publishes. */
  records: () => readonly ExpertRecord[];
  stateDir: () => string | undefined;
}

const DISCLOSURES: Record<ExpertIdentitySourceKind, string> = {
  public:
    "你的人设依据公开资料整理而成，由 AI 扮演，并非本人，也未经本人授权或确认；你的观点和表述不代表本人。" +
    "被问到是否本人、资料来源或授权情况时，如实说明你是基于公开资料的数字分身；" +
    "不要声称自己就是本人，也不要编造公开资料之外的个人经历、立场或私下言论。",
  organization:
    "你的人设依据组织内部资料整理而成，由 AI 扮演，并非本人；是否经本人确认以及资料范围以组织说明为准，你的观点和表述不代表本人。" +
    "被问到是否本人、资料来源或授权情况时，如实说明你是基于组织内部资料的数字分身，" +
    "不要声称自己就是本人，也不要编造资料之外的个人经历、立场或私下言论。",
  authorized:
    "你的人设经本人授权，并基于其提供或确认的资料整理而成，由 AI 扮演。" +
    "被问到是否本人时，如实说明你是经授权的数字分身，不是本人在实时回答；" +
    "超出授权资料的问题，不要替本人编造立场或承诺。",
};

/** The statement a persona of this origin must give about itself; the free-text note is never part of it. */
export function disclosureFor(kind: ExpertIdentitySourceKind): string {
  return DISCLOSURES[kind];
}

interface State {
  ctx: Context;
  options: ExpertIdentityOptions;
  /** Tail of the queue that keeps identity files and the published view in step. */
  work: Promise<void>;
  /** Fingerprint of every identity published after the last queued task. */
  visible: Map<string, string>;
  /** Ids of the records that were enabled after the last queued task, whether or not their persona could be read. */
  enabled: Set<string>;
}

interface Loaded {
  summary: ExpertIdentitySummary;
  persona: string;
}

function sourceOf(record: ExpertRecord): ExpertIdentitySource {
  const kind = EXPERT_SOURCE_KINDS.find((candidate) => candidate === record.source?.kind) ?? "public";
  const note = record.source?.note?.trim();
  return note ? { kind, note } : { kind };
}

function avatarOf(state: State, record: ExpertRecord): ExpertIdentityAvatar | undefined {
  if (record.avatar === undefined) return undefined;
  const problem = avatarProblem(record.avatar);
  if (problem === undefined) return { mime: record.avatar.mime, data: record.avatar.data };
  state.ctx.logger.warn(`expert-ai: avatar of "${record.id}" is not published: ${problem}`);
  return undefined;
}

function summaryOf(state: State, record: ExpertRecord, persona: string): ExpertIdentitySummary {
  const avatar = avatarOf(state, record);
  return {
    id: record.id,
    name: record.name,
    title: record.title?.trim() || DEFAULT_EXPERT_TITLE,
    description: record.description,
    category:
      record.category === "custom"
        ? record.customCategory?.trim() || record.name
        : EXPERT_AI_CATEGORY_LABELS[record.category],
    tags: [...new Set(record.tags.map((tag) => tag.trim()))],
    ...(avatar === undefined ? {} : { avatar }),
    source: sourceOf(record),
    revision: createHash("sha256").update(persona, "utf8").digest("hex"),
    enabled: record.enabled,
  };
}

/** Read one persona; an identity whose persona cannot be read is not published. */
async function load(state: State, record: ExpertRecord): Promise<Loaded | undefined> {
  let persona: string;
  try {
    persona = (await identityFor(record, state.options.stateDir())).trim();
  } catch (error) {
    state.ctx.logger.warn(`expert-ai: identity "${record.id}" is unavailable`, error);
    return undefined;
  }
  if (persona === "") {
    state.ctx.logger.warn(`expert-ai: identity "${record.id}" has no persona`);
    return undefined;
  }
  return { summary: summaryOf(state, record, persona), persona };
}

async function loadEnabled(state: State, records: readonly ExpertRecord[]): Promise<Loaded[]> {
  const loaded = await Promise.all(records.filter((record) => record.enabled).map((record) => load(state, record)));
  return loaded.filter((entry): entry is Loaded => entry !== undefined);
}

function fingerprint(summary: ExpertIdentitySummary): string {
  return createHash("sha256").update(JSON.stringify(summary)).digest("hex");
}

/** Only error names are logged for a failed listener, because its message may quote persona text. */
function errorNames(error: unknown): string {
  const causes: unknown[] = error instanceof AggregateError ? error.errors : [error];
  return causes.map((cause) => (cause instanceof Error ? cause.name : typeof cause)).join(", ");
}

/** Remember what is published now and tell listeners which ids differ from before. */
async function settle(state: State, announce: boolean): Promise<void> {
  const records = state.options.records();
  const enabled = new Set(records.filter((record) => record.enabled).map((record) => record.id));
  const published = await loadEnabled(state, records);
  const next = new Map(published.map(({ summary }): [string, string] => [summary.id, fingerprint(summary)]));
  const seen = new Set([...state.visible.keys(), ...next.keys()]);
  const changed = [...seen].filter((id) => state.visible.get(id) !== next.get(id));
  const withdrawn = [...state.enabled].filter((id) => !enabled.has(id)).sort();
  const ids = [...new Set([...changed, ...withdrawn])].sort();
  state.visible = next;
  state.enabled = enabled;
  if (!announce || ids.length === 0) return;
  const change: ExpertIdentityChange = withdrawn.length === 0 ? { ids } : { ids, withdrawn };
  // Not awaited, so a listener that calls get() cannot deadlock the queue; parallel isolates failures.
  void state.ctx.parallel("expert-identity/changed", change).catch((error: unknown) => {
    state.ctx.logger.warn(`expert-ai: listeners of expert-identity/changed failed for ${ids.join(", ")}: ${errorNames(error)}`);
  });
}

/** Run identity maintenance one task at a time, then publish; the queue never rejects. */
function enqueue(state: State, failure: string, announce: boolean, work: () => Promise<void>): void {
  state.work = state.work.then(async () => {
    try {
      await work();
    } catch (error) {
      state.ctx.logger.error(failure, error);
    }
    try {
      await settle(state, announce);
    } catch (error) {
      state.ctx.logger.error("expert-ai: failed to publish identities", error);
    }
  });
}

async function listIdentities(state: State): Promise<ExpertIdentitySummary[]> {
  await state.work;
  return (await loadEnabled(state, state.options.records())).map(({ summary }) => summary);
}

async function getIdentity(state: State, id: string): Promise<ExpertIdentity | undefined> {
  await state.work;
  const record = state.options.records().find((item) => item.enabled && item.id === id);
  const loaded = record === undefined ? undefined : await load(state, record);
  if (loaded === undefined) return undefined;
  return { ...loaded.summary, persona: loaded.persona, disclosure: disclosureFor(loaded.summary.source.kind) };
}

/**
 * Publishes the configured digital lifes as the `expertIdentity` cordis service
 * and announces `expert-identity/changed` after settings change what they publish.
 */
export class ExpertIdentityProvider extends Service implements ExpertIdentityService {
  // Cordis hands consumers a proxy that rebinds `this`, so no #private fields.
  private readonly state: State;

  constructor(ctx: Context, options: ExpertIdentityOptions) {
    super(ctx, "expertIdentity");
    const state: State = { ctx, options, work: Promise.resolve(), visible: new Map(), enabled: new Set() };
    this.state = state;
    const initial = options.saved();
    const initialDir = options.stateDir();
    const onDisk = new Map(initial.map((record) => [record.id, record]));
    let seeded: { dir: string | undefined } | undefined;
    const seed = async (records: readonly ExpertRecord[], dir: string | undefined): Promise<void> => {
      await initializeIdentities(records, dir);
      seeded = { dir };
    };
    enqueue(state, "expert-ai: failed to initialize identities", false, () => seed(initial, initialDir));
    ctx.on("loader/volatile-update", () => {
      const next = options.saved();
      const dir = options.stateDir();
      enqueue(state, "expert-ai: failed to persist identities", true, async () => {
        if (seeded === undefined || seeded.dir !== dir) {
          await seed(next, dir).catch((error: unknown) => {
            ctx.logger.error("expert-ai: failed to initialize identities", error);
          });
        }
        await reconcileIdentities([...onDisk.values()], next, dir, (id, record) => {
          if (record === undefined) onDisk.delete(id);
          else onDisk.set(id, record);
        });
      });
    });
  }

  list(): Promise<ExpertIdentitySummary[]> {
    return listIdentities(this.state);
  }

  get(id: string): Promise<ExpertIdentity | undefined> {
    return getIdentity(this.state, id);
  }
}
