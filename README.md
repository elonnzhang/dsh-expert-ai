# dsh-expert-ai

English | [中文](README.zh.md)

`dsh-expert-ai` keeps a library of expert identities (persona, avatar, source disclosure) for DeepSeek Harness and serves it to other plugins through the `expertIdentity` Cordis service. It is the identity layer meant to run together with the `dsh-bot` runtime, and it adds exactly one other thing: a conversation with a single expert.

## Features

The plugin does two things:

- **Identity layer**: persists records in the `expert-ai` settings namespace and each identity in `$DSH_HOME/expert-ai/<id>/agents/<id>.md`; provides the `expertIdentity` Cordis service so another plugin, such as a Bot runtime, can read the enabled identities: persona, avatar, source disclosure and revision.
- **Single-expert conversation**: pick an expert in the sidebar Chat Panel to open a conversation bound to that expert's persona. It has no Workspace, is forced to the read-only file sandbox, and gets its opening message from the plugin.
- **Expert mention and consultation**: `@<id>` and `@<name>` in the composer save the mention as model-visible text, and the primary agent can ask one expert through the `consult_expert` tool, whose answer comes back through a persona subagent.

It also adds a Harness-styled settings section for creating, editing, enabling, and deleting records, with imports from agent Markdown files (YAML frontmatter is ignored, the body is the persona) or versioned `mimeographs` method packages.

It does not add an Agent preset selector or group chats (the `dsh-bot` runtime owns those).

## Working with dsh-bot

This plugin only supplies identities; the `dsh-bot` runtime runs the single and group chats. Install both into the same Profile.

- `dsh-bot` asks for the `expertIdentity` service with `ctx.inject(['expertIdentity'], …)`. Without this plugin it behaves like a plain ds-bot, and this plugin needs nothing from `dsh-bot`.
- Identities are created and edited only here, under **Settings → 专家**. `dsh-bot` is designed to take a bound Bot's persona and source disclosure from the service and to follow `expert-identity/changed`.
- This plugin registers no session tools and binds no persona to Harness's own Sessions, so a Bot Session carries one identity.
- A linked checkout is served from `lib/`, which is not committed: run `pnpm run build` after changing the Host half.

The split of responsibilities and the service contract are in [`docs/expert-bot-phase1.md`](docs/expert-bot-phase1.md).

## Demo

<!-- prettier-ignore -->
| Chat Panel | Settings | Create expert |
| ---- | ---- | ------ |
| <img src="pics/chat.png" alt="Expert Chat Panel" width="960"> | <img src="pics/setting.png" alt="Expert settings" width="960"> | <img src="pics/setting2.png" alt="Create expert form" width="960"> |

## Record fields

Each record has an `id`, `name`, `description`, primary-domain `category`, composable `tags[]`, `origin`, `persona`, and `enabled` flag. Metadata (name, title, description, tags, source, avatar) lives only in the record; `origin` says where the identity body is read from:

| `origin.kind` | Body comes from | Editable |
|---|---|---|
| `managed` | `$DSH_HOME/expert-ai/<id>/agents/<id>.md`, written from `persona` when the settings page saves | Yes |
| `file` | The Host Markdown file at `origin.path` (`~`, absolute, or relative to `$DSH_HOME/expert-ai/`) | No, the file is the source |
| `bundled` | A pack directory inside the plugin package, such as `experts/ELON` or `experts/xingtu/clq`; any nesting is allowed | No; **Copy as managed identity** in settings |
| `package` | An imported pack under `$DSH_HOME/expert-ai/mimeographs/<slug>/` | No; can be copied as managed |

Bundled experts and imported method packs share one pack format: `manifest.json` (`schemaVersion: 2`, initial metadata, provenance and the sha256 of every file), `AGENTS.md` (the body, no frontmatter), and optional `SKILL.md`, `LICENSE` and `references/*.md`. Sizes and hashes are verified before a pack is read.

`toolFilter` and `model` are optional: `toolFilter` limits the tools of both the chat and a consultation, while `model` (provider/model) applies to `consult_expert` only. New records using the `custom` category should set `customCategory`; without it the display name is used.

Older records with `agent`, `expertPackage` or `tag` still load: the Host derives `origin` from them, and the settings page writes the new shape on its next save. Leftover `features`, `teams`, `maxBatchSize` and `provider` are ignored.

Presentation fields are optional, so records saved before they existed stay valid:

- `title` (at most 40 characters after trimming) is shown after the name and defaults to “Bot”.
- `avatar` is `{ mime, data }` with an `image/png`, `image/jpeg` or `image/webp` mime and base64 data; the whole data URL must fit in 160,000 characters. The editor crops a picked image to a centered 160 px square and re-encodes it.
- `source` is `{ kind, note? }` with `kind` one of `public`, `organization` or `authorized`; `note` holds at most 200 characters. A record without `source` counts as `public`, and the kind selects the disclosure the identity carries.

## expertIdentity service

Another plugin reads identities with `ctx.inject(['expertIdentity'], ctx => …)`:

- `list()` returns the enabled identities whose persona can be read. `get(id)` returns one with its `persona` and `disclosure`, or `undefined` for an unknown, disabled or unreadable id.
- Every identity carries `origin` (`managed`, `file`, `bundled` or `package`); older consumers may ignore it.
- `revision` is the sha256 of the persona. A change of title, avatar or source does not alter it; it arrives through the changed event and a fresh `get`.
- `disclosure` is a Chinese paragraph chosen by `source.kind`, for the consumer to put into its prompt as is.
- `expert-identity/changed` carries `{ ids, withdrawn? }`. `ids` are the sorted ids that appeared, disappeared or changed. `withdrawn` (sorted, absent when empty) lists those whose record the user disabled or deleted, and `ids` still contains them; an identity whose persona merely cannot be read is not withdrawn. Listeners are not awaited, and nothing is emitted at startup.
- The types `ExpertIdentity`, `ExpertIdentitySummary`, `ExpertIdentityService` and `ExpertIdentityChange` are exported.

## Install from GitHub

`dsh-expert-ai` is installed into a DeepSeek Harness **Web Profile**. The commands below are run from the Harness checkout, not from the plugin repository.

### Prerequisites

- A working DeepSeek Harness checkout
- Node.js and pnpm versions supported by that Harness checkout
- A GitHub URL for this repository

### Install

```sh
cd /path/to/deepseek-harness
pnpm dsh plugin --profile web add https://github.com/elonnzhang/dsh-expert-ai.git
```

The command installs the plugin into `$DSH_HOME/profiles/web`, adds its bundle to the Web Profile, and applies its Host and Client halves on the next boot.

Start the Web Profile:

```sh
pnpm dsh web --port 3080
```

Open `http://127.0.0.1:3080`, then go to **Settings → 专家**.

> GitHub installs run the package's `prepare` script and build `lib/` from source. For a reproducible
> release, run the checks locally before pushing:
>
> ```sh
> cd /path/to/dsh-expert-ai
> pnpm install
> pnpm run check
> git add .gitignore .npmrc src scripts docs package.json pnpm-lock.yaml tsconfig.json tsconfig.types.json tsdown.config.ts tsdown.client.ts cordis.patch.yml README.md README.zh.md
> git commit -m "build: update plugin contract"
> git push
> ```

> With pnpm 10+, a GitHub install may require an explicit `allowBuilds` entry in the target Profile;
> see [docs/publish.md](docs/publish.md).

### Update or uninstall

From the Harness checkout:

```sh
# Update the installed GitHub dependency
pnpm dsh plugin --profile web update dsh-expert-ai

# Remove it from the Web Profile
pnpm dsh plugin --profile web remove dsh-expert-ai
```

Restart `pnpm dsh web` after installing, updating, or removing the plugin.

### Upgrading from a release that offered run modes

The `features` run-mode switch is gone: the identity layer, the Chat Panel, the `@` expert source,
`consult_expert`, `read_expert_reference` and online expert-package import (`expert/catalog`,
`expert/import`) are always on. The `expert-ai-mode` Agent preset and the category/review/team
features have been removed. No data migration is needed. Stop the Profile and drop the fields that
are no longer read from the plugin's patch row:

```yaml
- id: expert-ai
  name: dsh-expert-ai
  config:
    stateDir: …        # keep
    records: […]       # keep
    # no longer read; safe to delete
    features: [identity, conversation]
    teams: […]
    maxBatchSize: 3
    provider: spawn    # consultations always use spawn
```

The data directory is still `$DSH_HOME/expert-ai`. Its `mimeographs/<slug>/` directories hold imported packs, while `.expert-packages/` holds lookup caches and legacy packages; `projects/` and `sessions/` keep working. History you no
longer need can be deleted:

```sh
rm -rf "${DSH_HOME:-$HOME/.dsh}/expert-ai/.expert-packages"
rm -rf "${DSH_HOME:-$HOME/.dsh}/expert-ai/.expert-reviews"
```

### Local development

Link the checkout into the profile once, then iterate against the running server:

```sh
cd /path/to/dsh-expert-ai
pnpm install
pnpm run check

cd /path/to/deepseek-harness
pnpm dsh plugin --profile web add /path/to/dsh-expert-ai
pnpm dsh web --port 3080
```

#### Build

`pnpm run build` runs `tsdown` over both halves and then refreshes the declaration compatibility tree:

| Artifact | Entry | Consumer |
| --- | --- | --- |
| `lib/index.js` | `src/index.ts` | the Host, applied by cordis |
| `lib/index.d.ts` | Host declarations | TypeScript consumers |
| `lib/invariant.js` | `src/invariant.ts` | `exports["./invariant"]` |
| `lib/client.js` | `src/client/index.ts` | the browser loader, which requests the `dsh-expert-ai/client.js` bundle through the versioned combo URL in the boot manifest |
| `lib/types/client/index.d.ts` | Client declarations | TypeScript consumers of `./client` |

`lib/index.d.ts` and `lib/invariant.d.ts` are generated by tsdown. `build:types` additionally emits
the per-file `lib/types/**` declarations required by the dual-face Client export. The Client runtime
entry itself remains a loader-registration artifact rather than a normal importable browser library.

The client artifact is not an ordinary browser bundle. The web shell's module loader requires it to
register itself by calling `window.__ModuleLoader__.load({ id, factory })`; one that loads without
registering fails plugin boot with `bundle … loaded without registering "dsh-expert-ai"`.
`tsdown.client.ts` produces that wrapper (CJS output inside a factory banner and footer), keeps the
shell's module-table specifiers external so they survive as `require()` calls the loader can answer,
and compiles every stylesheet into a style-injection module with hashed class names. Replacing it with
a plain browser-bundle config breaks plugin boot rather than just the styling.

#### Hot reload

A running `dsh web` stat-polls every client bundle it serves, so rewriting `lib/client.js` is the entire trigger — no server restart and no page refresh:

```sh
cd /path/to/dsh-expert-ai
pnpm run dev
```

On a content change the Host broadcasts a `rebuilt` frame over its `GET /plugins/events` channel and the browser half swaps the cordis fiber in place: it drops the stale factory, refetches the bundle, drains the old fiber's disposers, removes the `<style data-plugin="dsh-expert-ai">` tags, and re-applies. Component state inside the swapped subtree is lost; the rest of the page keeps running.

Two kinds of change stay outside that chain and need `dsh web` restarted: the Host half, because node-side plugin reloading is not mounted in the Web Profile, and `cordis.patch.yml`, because composition is read at boot.

Do not reach for the Harness's own `pnpm run dev:web` here. It is the watch build for packages inside the Harness checkout, it must not run concurrently with `pnpm run build` there, and it rebuilds nothing for an out-of-tree package.

For the package contract, local overlays, and distribution choices, see
[`docs/build.md`](docs/build.md), [`docs/load-into-dsh.md`](docs/load-into-dsh.md), and
[`docs/publish.md`](docs/publish.md).

## Usage

### 1. Configure experts

Open **Settings → 专家** after the Web Profile starts. Add or edit a record with:

The plugin UI follows the Harness locale and provides complete English and Simplified Chinese dictionaries. Switching the application language updates Settings and the Chat Panel without translating user-authored names, descriptions, or Persona content.

- **ID**: lowercase letters, numbers, and hyphens, for example `zjh`
- **Name**: the display name, for example `张剑辉`
- **Description**: a short responsibility summary
- **Category**: `business`, `science`, `culture`, or `custom`
- **Custom category**: recommended when `Category` is `custom`
- **Tags**: searchable capabilities such as `储能系统`, `工程化`
- **Persona**: the initial identity and response rules; converted to a managed Agent file when **Agent** is empty
- **Enabled**: only enabled records reach the `expertIdentity` service and the Chat Panel

You can also import an Agent Markdown file. Its YAML frontmatter is ignored and its Markdown body is the identity. A file selected through the browser is imported into the managed file because the browser does not expose a path that the Host can reopen. When no external path is entered, the Persona is written to:

```text
$DSH_HOME/expert-ai/<id>/agents/<id>.md
```

Or choose **Import → From the expert method library**, enter a `mimeographs` branch or tag (default
`main`), load the catalog, and pick an expert. The import pins `AGENTS.md`, `SKILL.md`, `LICENSE` and
the catalog-declared `references/*.md` to the resolved commit under
`$DSH_HOME/expert-ai/mimeographs/<slug>/`. An existing copy for the same slug is reused, regardless of the requested commit. Catalog and ref resolutions are cached in the same directory, so a cached
catalog remains usable while GitHub is unavailable. Imported experts can read these local references
through `read_expert_reference`.

An external Agent file remains the sole source of identity and is not copied or overwritten by the plugin.

The settings document is the Profile's Cordis patch, not `$DSH_HOME/settings.yaml`:

```text
$DSH_HOME/profiles/<profile>/cordis.patch.yml
```

Saving on the settings page rewrites the `expert-ai` row of that file.

### 2. Chat with an expert

Open **Chat Panel** in the sidebar and choose an expert to start a new conversation with that expert. The plugin creates an isolated project under `$DSH_HOME/expert-ai/projects/<datetime>`, then creates a Session and binds the expert's persona on the Host:

- The Session receives a record-specific system prompt through Host binding; the opening message is written by the plugin and does not repeat the full persona.
- The Session is forced to the **read-only file sandbox**: files can be read, not changed.
- The binding is saved under `$DSH_HOME/expert-ai/sessions/`, so reopening the Session after a Host restart keeps its persona.

### 3. Consult one expert from a conversation

Type `@` in the composer to search by expert ID or name. Picking an expert inserts `@<name> ` in the current conversation, matching ds-bot. You can also type `@<id>` or `@<name>` directly, including names with spaces. The mention stays model-visible text and the primary agent decides whether a consultation helps. `consult_expert(id, question)` starts a persona subagent for that expert on the Harness `spawn` provider and returns its answer. The expert answers once, without follow-up questions.

### 4. Update the plugin

After publishing a new GitHub revision, build the plugin before pushing. Then update it from the Harness checkout:

```sh
pnpm dsh plugin --profile web update dsh-expert-ai
pnpm dsh web --port 3080
```

If the profile still uses an old linked installation, remove and add it again:

```sh
pnpm dsh plugin --profile web remove dsh-expert-ai
pnpm dsh plugin --profile web add https://github.com/elonnzhang/dsh-expert-ai.git
```

## Model Experience

The chat and the consultation share one compiler: a record and its body compile into an expert plan (prompt sections plus a tool and model policy) that is then mounted on a Session or a subagent. A chat Session receives the plan's system prompt, the read-only file sandbox and the `toolFilter` tool limit; the plan is saved under `sessions/`, so a Host restart restores it unchanged. The role instruction is carried by the system prompt and remains durable and model-visible in that Session.

`consult_expert` adds its schema to the primary agent's model request. A consultation starts one subagent, installs the expert's persona as the subagent persona, and returns the answer text.

## Known Limitations

- The Chat Panel starts expert conversations in a new Session each time. The `@` menu inserts mention text in the current Session without creating or opening another Session.
- A chat cannot switch models per record: the Session model selection DSH 0.2.0-rc.2 offers plugins also rewrites the deployment default, so `model` applies to `consult_expert` only.
- A same-named file in the data directory no longer overrides a bundled expert; use **Copy as managed identity** to edit one.
- The Chat Panel lives in the sidebar footer action Slot: the current public sidebar has no additive Slot above the workspace browser.
- Expert conversations use the deployment's default Agent preset; the plugin no longer installs one of its own.
