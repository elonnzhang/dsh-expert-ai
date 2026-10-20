# dsh-expert-ai

English | [中文](README.zh.md)

`dsh-expert-ai` keeps a library of digital identities (persona, avatar, source disclosure) for DeepSeek Harness and serves it to other plugins through the `expertIdentity` Cordis service. It is the identity layer meant to run together with the `dsh-bot` runtime (see [Working with dsh-bot](#working-with-dsh-bot)). Its only other job, single-expert consultation, runs only when the `conversation` feature is switched on (see [Run modes](#run-modes)).

## Features

Always on (the `identity` feature):

- Persists records in the `expert-ai` settings namespace and each identity in `$DSH_HOME/expert-ai/<id>/agents/<id>.md`.
- Imports persona identities from agent Markdown files such as `~/.agent/agents/xxx.md` and `~/.claude/agents/xxx.md` (YAML frontmatter is ignored).
- Adds a Harness-styled settings section for creating, editing, enabling, and deleting records.
- Provides the `expertIdentity` Cordis service, so another plugin such as a Bot runtime can read the enabled identities: persona, avatar, source disclosure and revision.

Only with the `conversation` feature (off by default):

- Adds `consult_expert` for one independent consultation, and `read_expert_reference` for the reference files of an imported expert package.
- Registers an `@<id>` input source for selecting configured records.
- Injects a Chat Panel through the additive `sidebar.footer.action` Slot without replacing the Harness sidebar or workspace browser.
- Creates conversations without a Workspace and starts standalone conversations initialized with a selected expert persona.
- Registers `expert-ai-mode` in Harness's native Agent preset selector and Agent presets settings (an opt-in patch, see [Run modes](#run-modes)). Choose a specific identity from the conversation selector or the sidebar Chat Panel.

## Working with dsh-bot

This plugin only supplies identities; the `dsh-bot` runtime runs the single and group chats. Install both into the same Profile.

- `dsh-bot` asks for the `expertIdentity` service with `ctx.inject(['expertIdentity'], …)`. Without this plugin it behaves like a plain ds-bot, and this plugin needs nothing from `dsh-bot`.
- Identities are created and edited only here, under **Settings → 专家**. `dsh-bot` is designed to take a bound Bot's persona and source disclosure from the service and to follow `expert-identity/changed`.
- In the default `identity` mode this plugin registers no consultation tools and binds no persona to Sessions, so a Bot Session carries one identity. Leave `conversation` off while `dsh-bot` is the runtime.
- A linked checkout is served from `lib/`, which is not committed: run `pnpm run build` after changing the Host half.

The split of responsibilities and the service contract are in [`docs/expert-bot-phase1.md`](docs/expert-bot-phase1.md).

## Run modes

`features` in the plugin entry's `config` selects what the plugin does. `identity` is always on, `conversation` is the only other value, and the default is `[identity]`. Any other name is rejected when the configuration is validated.

| Feature | What it adds |
| --- | --- |
| `identity` (always) | the settings section with the 专家 and 通用设置 tabs, the managed identity files, the `expertIdentity` service and its changed event, the `expert/*` and `identity` endpoints under `/api/expert-ai/` |
| `conversation` | the `consult_expert` and `read_expert_reference` tools; binding a new Session to one expert's persona, with the `project`, `greeting`, `binding`, `bind` and `unbind` endpoints; the Chat Panel; the `@<id>` input source; the expert selector in the conversation hero |

To enable conversation for an installed bundle, update the existing `expert-ai` entry and preserve its full `config`: Cordis patch rows replace the entire `config` object. Keep `provider`, any `stateDir`, and every existing `records` entry, then add `features: [identity, conversation]`.

The `expert-ai-mode` Agent preset is no longer part of the installed bundle. Apply `expert-ai-mode.patch.yml` to use it; without that patch, standalone sessions use the deployment's default preset. `pnpm run dev:patch -- --conversation` writes both the conversation setting and preset to the development overlay.

- `features` has no settings UI. In identity mode **子代理 Provider** stays visible but unused.
- The Client mounts the conversation surfaces only once the setting is known; while it is loading, unavailable or missing, nothing is mounted.
- A change to `features` is applied in place through the loader's volatile update (restart the Profile if it does not take effect). Switching `conversation` off withdraws the tools and the Client surfaces, but a Session that was already bound keeps its identity sections until it is recreated.

## Demo

<!-- prettier-ignore -->
| Chat Panel | Settings | Create expert |
| ---- | ---- | ------ |
| <img src="pics/chat.png" alt="Expert Chat Panel" width="960"> | <img src="pics/setting.png" alt="Expert settings" width="960"> | <img src="pics/setting2.png" alt="Create expert form" width="960"> |

## Record fields

Each record has an `id`, `name`, `description`, primary-domain `category`, composable `tags[]`, `agent`, `persona`, and `enabled` flag. `agent` is the only runtime identity source. When no Agent file is supplied, saving a record writes `persona` to the managed `<id>/agents/<id>.md` file and stores that relative path in `agent`; when an Agent file is supplied, its Markdown body is authoritative and `persona` is ignored. Relative `agent` paths are read from `$DSH_HOME/expert-ai/` first and then from the plugin package, so bundled `experts/` files work in a fresh Profile; a same-named file under `$DSH_HOME/expert-ai/` overrides the bundled copy. New records using the `custom` category should set `customCategory`; older records without it fall back to the display name. `toolFilter` and `model` are optional. The Host validates the settings document and creates one-shot consultations with the configured subagent provider.

Presentation fields are optional, so records saved before they existed stay valid:

- `title` (at most 40 characters after trimming) is shown after the name and defaults to “思考助手”.
- `avatar` is `{ mime, data }` with an `image/png`, `image/jpeg` or `image/webp` mime and base64 data; the whole data URL must fit in 160,000 characters. The editor crops a picked image to a centered 160 px square and re-encodes it.
- `source` is `{ kind, note? }` with `kind` one of `public`, `organization` or `authorized`; `note` holds at most 200 characters. A record without `source` counts as `public`, and the kind selects the disclosure the identity carries.

## expertIdentity service

Another plugin reads identities with `ctx.inject(['expertIdentity'], ctx => …)`:

- `list()` returns the enabled identities whose persona can be read. `get(id)` returns one with its `persona` and `disclosure`, or `undefined` for an unknown, disabled or unreadable id.
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

### Upgrading from `dsh-digital-life`

The package is `dsh-expert-ai`, and the entry id, settings namespace and data directory are now
`expert-ai`. Nothing is migrated automatically, so an existing Profile needs three manual steps.

**1. Stop the Profile and rewrite its patch row.** Plugin settings are stored in the Profile's Cordis
patch, not in `$DSH_HOME/settings.yaml`. Open `$DSH_HOME/profiles/<profile>/cordis.patch.yml` and find the
row inserted for this plugin:

```yaml
- id: digital-life
  name: dsh-digital-life # or already dsh-expert-ai if the package name was updated earlier
  config: { … }
```

Change `id` to `expert-ai` and `name` to `dsh-expert-ai`, keep the complete `config` (the loader replaces
the whole object, so `provider`, `stateDir` and `records` must stay; `teams` and `maxBatchSize` are no
longer read, see [below](#settings-and-data-left-by-removed-features)), and delete any duplicate left by an
earlier rename.

**2. Reinstall the package under the new id.** From the Harness checkout. If the dependency and
`bundles` entry in the Profile's `package.json` already use `dsh-expert-ai`, skip the `remove` command
and run only `add` again for the current checkout (or update the existing installation).

```sh
pnpm dsh plugin --profile web remove dsh-digital-life
pnpm dsh plugin --profile web add /path/to/dsh-expert-ai
```

This updates the dependency name and the bundle name in the Profile's `package.json`. A local checkout
path works immediately; `https://github.com/elonnzhang/dsh-expert-ai.git` only works after the remote
repository itself has been renamed, which has not happened yet.

**3. Deal with the old data directory.** `$DSH_HOME/digital-life` is no longer read. Delete it:

```sh
rm -rf "${DSH_HOME:-$HOME/.dsh}/digital-life"
```

or, before the first start and only while `$DSH_HOME/expert-ai` does not exist, move it:

```sh
mv "${DSH_HOME:-$HOME/.dsh}/digital-life" "${DSH_HOME:-$HOME/.dsh}/expert-ai"
```

The code does not move this directory. Without the move, imported expert packages (`.expert-packages/`),
standalone projects (`projects/`), session bindings (`sessions/`) and managed identity files (`<id>/agents/`)
are left behind and have to be moved or re-imported; a managed
persona kept in the `config` is rebuilt from `persona` on the next startup (or when the record is saved).

A custom `stateDir` follows the same rule: the data root is that path with `expert-ai` appended, unless it
already ends in `expert-ai`. A `stateDir` that ends in `/digital-life` therefore names the parent, and the
old data has to move into `<stateDir>/expert-ai`.

### Settings and data left by removed features

Category consultation (`consult_expert_category`), plan reviews (`review_expert_plan`,
`read_expert_review` and the `review/*` endpoints) and expert teams (the team-run tools, the 专家团 tab,
and the Expert AI panel with its sidebar entry) have been removed. What they left behind is no longer
read, and nothing is deleted automatically:

- `teams` and `maxBatchSize` in the `expert-ai` patch row still load and are ignored. Drop them the next
  time you edit the row.
- Reviews and team runs were kept in `.expert-reviews/` under the data directory. Delete it once you no
  longer need the history:

  ```sh
  rm -rf "${DSH_HOME:-$HOME/.dsh}/expert-ai/.expert-reviews"
  ```

- A Session that an expert team hosted now opens without a persona.

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

Steps 2–4 need the `conversation` feature (see [Run modes](#run-modes)); in the default identity mode only steps 1 and 5 apply.

### 1. Configure experts

Open **Settings → 专家** after the Web Profile starts. Add or edit a record with:

The plugin UI follows the Harness locale and provides complete English and Simplified Chinese dictionaries. Switching the application language updates Settings, Chat Panel, and conversation selectors without translating user-authored names, descriptions, or Persona content.

- **ID**: lowercase letters, numbers, and hyphens, for example `zjh`
- **Name**: the display name, for example `张剑辉`
- **Description**: a short responsibility summary
- **Category**: `business`, `science`, `culture`, or `custom`
- **Custom category**: recommended when `Category` is `custom`
- **Tags**: searchable capabilities such as `储能系统`, `工程化`
- **Persona**: the initial identity and response rules; converted to a managed Agent file when **Agent** is empty
- **Enabled**: only enabled records reach the `expertIdentity` service, the selectors and consultation

You can enter a Host-readable path to bind an existing Agent Markdown file. Its YAML frontmatter is ignored and its Markdown body is the runtime identity. A file selected through the browser is instead imported into the managed file because the browser does not expose a path that the Host can reopen. When no external path is entered, the Persona is written to:

```text
$DSH_HOME/expert-ai/<id>/agents/<id>.md
```

An external Agent file remains the sole source of identity and is not copied or overwritten by the plugin.

The settings document is the Profile's Cordis patch, not `$DSH_HOME/settings.yaml`:

```text
$DSH_HOME/profiles/<profile>/cordis.patch.yml
```

Saving on the settings page rewrites the `expert-ai` row of that file.

### 2. Choose the consultation provider

Set **子代理 Provider** to a mounted subagent provider. Keep the default `spawn` unless your Harness profile installs another provider.

### 3. Use an expert from the composer

Type `@` in the composer and select a record, for example `@zjh`. The `@<id>` text helps the main Agent choose the `consult_expert` tool; it is not an automatic command. The model may still decide whether a consultation is useful.

The available tools are:

- `consult_expert(id, question)`: ask one configured expert
- `read_expert_reference(id, path?)`: list the reference files of an expert imported from a package, or read one of them

### 4. Start an independent conversation

Choose an expert from the conversation selector or open **Chat Panel** in the sidebar. If no project is selected, the plugin creates an isolated project under `$DSH_HOME/expert-ai/projects/<datetime>` before opening the session. The composer remains blocked until an expert is selected.

The standalone session has no Workspace (`workspaceId`/`cwd`), receives a record-specific system prompt through Host binding, and is forced to the **read-only file sandbox**. The selected identity is saved under `$DSH_HOME/expert-ai/sessions/` so it survives a Host restart. The opening message is brief and does not repeat the full persona. The mode exposes expert consultation tools, not file-editing tools.

Inside a standalone expert session, mentioning another record as `@<id>` requires `consult_expert`; the current expert must not imitate or answer for that record. Mentioning the current record's own ID is answered directly without a self-consultation.

### 5. Update the plugin

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

Consultation tools add their schemas to the main agent's model request. A consultation starts one child agent and returns its text. A standalone expert conversation receives a record-specific system prompt, is set to the read-only file sandbox, and starts with a brief first user message; the role instruction is carried by the system prompt and remains durable and model-visible in that Session.

## Known Limitations and Deferred Work

In a regular Chat, `@<id>` is model-visible text that helps the agent choose `consult_expert`; it is not an automatic command. In a standalone expert session, the durable system prompt requires other-record mentions to use the consultation tool while self-mentions are answered directly. The current public sidebar has no additive Slot above the workspace browser, so Chat Panel uses the supported footer action Slot. Standalone expert sessions use the `expert-ai-mode` Agent preset when it is available (it ships as an opt-in patch, see [Run modes](#run-modes)); otherwise they use the deployment default. Per-record model selection is not yet applied during Session creation.
