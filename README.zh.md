# dsh-expert-ai

[English](README.md) | 中文

`dsh-expert-ai` 为 DeepSeek Harness 维护一个专家身份库（人设、头像、来源声明），并通过 `expertIdentity` Cordis 服务提供给其他插件。它是与 `dsh-bot` 运行时配合使用的身份层，另外只提供与单一位专家的对话界面。

## 功能

本插件只做两件事：

- **身份层**：在 `expert-ai` 设置命名空间中持久化专家记录，每条身份保存在 `$DSH_HOME/expert-ai/<id>/agents/<id>.md`；通过 `expertIdentity` Cordis 服务把已启用的身份（人设、头像、来源声明与版本）提供给其他插件，例如 Bot 运行时。
- **单聊**：在侧边栏 Chat Panel 里选择一位专家，打开一个绑定该专家人设的独立会话。会话不依附 Workspace，强制只读文件沙箱，开场消息由插件写入。
- **点名与咨询**：输入框里的 `@<id>` 和 `@<name>` 作为模型可见文本保存；主 Agent 可以用 `consult_expert` 工具向一位专家发起一次性咨询，回答由该专家的 persona 子代理返回。

同时提供符合 Harness 风格的设置区，用于新增、编辑、启用和删除专家记录，可从 Agent Markdown
文件（YAML frontmatter 忽略，正文即人设）或按版本从 `mimeographs` 专家方法库导入。

不提供：Agent preset 选择器，以及群聊（群聊由 `dsh-bot` 运行时负责）。

## 与 dsh-bot 配合

本插件只提供身份；单聊和群聊由 `dsh-bot` 运行时负责。两者装进同一个 Profile 即可。

- `dsh-bot` 通过 `ctx.inject(['expertIdentity'], …)` 取得 `expertIdentity` 服务。没有装本插件时，它就是普通的 ds-bot；本插件不依赖 `dsh-bot`。
- 身份只在这里新建和编辑（**设置 → 专家**）。按设计，`dsh-bot` 从服务读取已绑定 Bot 的人设和来源声明，并跟随 `expert-identity/changed` 更新。
- 本插件不注册任何会话工具，也不给 Harness 自己的会话绑定人设，所以 Bot 会话里只有一份身份。
- link 方式加载的 checkout 从 `lib/` 读取，而 `lib/` 不进版本库：改动 Host 半边后请运行 `pnpm run build`。

职责划分与服务契约见 [`docs/expert-bot-phase1.md`](docs/expert-bot-phase1.md)。

## 演示

<!-- prettier-ignore -->
| Chat Panel | 设置 | 新增专家 |
| ---- | ---- | ------ |
| <img src="pics/chat.png" alt="专家 Chat Panel" width="960"> | <img src="pics/setting.png" alt="专家设置页面" width="960"> | <img src="pics/setting2.png" alt="新增专家表单" width="960"> |

## 专家记录字段

每条记录包含 `id`、`name`、`description`、主领域 `category`、能力标签 `tags[]`、`origin`、`persona` 和 `enabled`。名称、标题、描述、标签、来源声明和头像这些元数据只在记录里，正文由 `origin` 决定从哪里读：

| `origin.kind` | 正文来自 | 可编辑 |
|---|---|---|
| `managed` | `$DSH_HOME/expert-ai/<id>/agents/<id>.md`，设置页保存时写入 `persona` | 是 |
| `file` | `origin.path` 指向的 Host 上的 Markdown（`~`、绝对路径，或相对 `$DSH_HOME/expert-ai/` 的路径） | 否，以文件为准 |
| `bundled` | 插件包内的专家包目录，如 `experts/ELON`、`experts/xingtu/clq`，支持任意子目录 | 否，可在设置页「复制为托管身份」 |
| `package` | 已导入方法包 `$DSH_HOME/expert-ai/mimeographs/<slug>/` | 否，可复制为托管身份 |

内置专家与导入的方法包使用同一种专家包：`manifest.json`（`schemaVersion: 2`，记录初值、来源和每个文件的 sha256）、`AGENTS.md`（不带 frontmatter 的正文），以及可选的 `SKILL.md`、`LICENSE`、`references/*.md`。读取前会校验文件大小与哈希。

`toolFilter` 与 `model` 可选：`toolFilter` 同时限制单聊和咨询可用的工具，`model`（provider/model）只作用于 `consult_expert`。新建 `custom` 主领域的记录时建议填写 `customCategory`；缺少时回退使用专家名称。

旧版记录的 `agent`、`expertPackage`、`tag` 字段仍可读取，Host 会按规则换算成 `origin`；设置页下次保存时写出新形状。旧配置里遗留的 `features`、`teams`、`maxBatchSize`、`provider` 会被忽略。

展示字段均为可选，没有它们的旧记录仍然有效：

- `title`：显示在名字后面，去掉首尾空白后不超过 40 个字符，缺省为“Bot”。
- `avatar`：`{ mime, data }`，`mime` 为 `image/png`、`image/jpeg` 或 `image/webp`，`data` 为 base64；整个 data URL 不超过 160,000 个字符。编辑器会把所选图片居中裁成 160 px 的正方形后重新编码。
- `source`：`{ kind, note? }`，`kind` 为 `public`、`organization` 或 `authorized`；`note` 不超过 200 个字符。没有 `source` 的记录按 `public` 处理，`kind` 决定身份附带的来源声明。

## expertIdentity 服务

其他插件通过 `ctx.inject(['expertIdentity'], ctx => …)` 读取身份：

- `list()` 返回已启用且人设可读取的身份。`get(id)` 返回单个身份（含 `persona` 与 `disclosure`）；id 不存在、未启用或人设无法读取时返回 `undefined`。
- 每个身份带 `origin`（`managed`、`file`、`bundled` 或 `package`），旧版消费者可以忽略。
- `revision` 是人设正文的 sha256。标题、头像或来源的变化不会改变它，而是通过变更事件并重新 `get` 获得。
- `disclosure` 是按 `source.kind` 选择的一段中文来源声明，使用方原样放进提示词。
- `expert-identity/changed` 携带 `{ ids, withdrawn? }`：`ids` 是新增、移除或变化的 id（已排序）；`withdrawn`（已排序，为空时不带）列出其中被用户禁用或删除的 id，`ids` 仍包含它们。人设暂时读不到不算撤回。监听器不会被等待，启动时不会触发。
- 导出的类型有 `ExpertIdentity`、`ExpertIdentitySummary`、`ExpertIdentityService` 和 `ExpertIdentityChange`。

## 从 GitHub 安装

`dsh-expert-ai` 安装到 DeepSeek Harness 的 **Web Profile** 中。下面的命令都在 Harness checkout 中执行，而不是在插件仓库中执行。

### 前置条件

- 已经可以正常运行的 DeepSeek Harness checkout
- 与该 Harness checkout 兼容的 Node.js 和 pnpm
- 本仓库的 GitHub 地址

### 安装

```sh
cd /path/to/deepseek-harness
pnpm dsh plugin --profile web add https://github.com/elonnzhang/dsh-expert-ai.git
```

该命令会把插件安装到 `$DSH_HOME/profiles/web`，将插件 bundle 加入 Web Profile，并在下一次启动时加载 Host 和 Client 两部分。

启动 Web Profile：

```sh
pnpm dsh web --port 3080
```

打开 `http://127.0.0.1:3080`，然后进入 **设置 → 专家**。

> GitHub 安装会运行包里的 `prepare`，从源码构建 `lib/`。为了让发布内容可复现，推送前先在本地完成检查：
>
> ```sh
> cd /path/to/dsh-expert-ai
> pnpm install
> pnpm run check
> git add .gitignore .npmrc src scripts docs package.json pnpm-lock.yaml tsconfig.json tsconfig.types.json tsdown.config.ts tsdown.client.ts cordis.patch.yml README.md README.zh.md
> git commit -m "build: update plugin contract"
> git push
> ```

> pnpm 10 及以上版本安装 GitHub 源码时可能需要在目标 Profile 中显式配置 `allowBuilds`，见
> [docs/publish.md](docs/publish.md)。

### 更新或卸载

在 Harness checkout 中执行：

```sh
# 更新已安装的 GitHub 依赖
pnpm dsh plugin --profile web update dsh-expert-ai

# 从 Web Profile 卸载插件
pnpm dsh plugin --profile web remove dsh-expert-ai
```

安装、更新或卸载后，重新启动 `pnpm dsh web`。

### 从带运行模式的版本升级

`features` 运行模式开关已删除：身份层、Chat Panel、`@` 专家候选、`consult_expert`、
`read_expert_reference` 与专家包在线导入（`expert/catalog`、`expert/import`）始终开启。
`expert-ai-mode` Agent preset、分类咨询、评审与专家团已移除。

已有 Profile 无需迁移数据，只需停止 Profile 后清理 patch 行里不再读取的字段：

```yaml
- id: expert-ai
  name: dsh-expert-ai
  config:
    stateDir: …        # 保留
    records: […]       # 保留
    # 以下字段已不再读取，可以删掉
    features: [identity, conversation]
    teams: […]
    maxBatchSize: 3
    provider: spawn    # 咨询固定使用 spawn
```

数据目录仍是 `$DSH_HOME/expert-ai`。其中 `mimeographs/<slug>/` 保存导入包，`.expert-packages/` 保存查询缓存与旧版包，
`projects/` 与 `sessions/` 中的旧单聊记录继续可用；不再需要的历史可以自行删除：

```sh
rm -rf "${DSH_HOME:-$HOME/.dsh}/expert-ai/.expert-packages"
rm -rf "${DSH_HOME:-$HOME/.dsh}/expert-ai/.expert-reviews"
```

### 本地开发

把插件 checkout link 到 Profile 一次，之后对着运行中的服务迭代：

```sh
cd /path/to/dsh-expert-ai
pnpm install
pnpm run check

cd /path/to/deepseek-harness
pnpm dsh plugin --profile web add /path/to/dsh-expert-ai
pnpm dsh web --port 3080
```

#### 构建

`pnpm run build` 用 `tsdown` 构建两个半边，然后刷新声明兼容目录：

| 产物 | 入口 | 消费方 |
| --- | --- | --- |
| `lib/index.js` | `src/index.ts` | Host，由 cordis apply |
| `lib/index.d.ts` | Host 类型声明 | TypeScript 消费方 |
| `lib/invariant.js` | `src/invariant.ts` | `exports["./invariant"]` |
| `lib/client.js` | `src/client/index.ts` | 浏览器 loader，通过启动清单中的带版本号 combo URL 请求 `dsh-expert-ai/client.js` bundle |
| `lib/types/client/index.d.ts` | Client 类型声明 | `./client` 的 TypeScript 消费方 |

`lib/index.d.ts` 和 `lib/invariant.d.ts` 由 tsdown 生成；`build:types` 额外生成双面 Client
导出所需的 `lib/types/**` 声明。Client 运行时入口仍是 loader 注册用的浏览器产物，不是普通
可 import 的浏览器库。

Client 产物不是普通的浏览器 bundle。web shell 的模块 loader 要求它调用
`window.__ModuleLoader__.load({ id, factory })` 自我注册；加载了却没注册的 bundle 会让插件启动失败，
报 `bundle … loaded without registering "dsh-expert-ai"`。`tsdown.client.ts` 负责产出这层包装
（CJS 输出套在 factory 的 banner 与 footer 里），把 shell 模块表里的 specifier 保持为 external，
使其留成 loader 能应答的 `require()` 调用，并把每个样式表编译成带哈希类名的样式注入模块。
把它换成普通的浏览器打包配置，坏的不只是样式，而是插件启动。

#### 热加载

运行中的 `dsh web` 会 stat 轮询它服务的每个 client bundle，所以重写 `lib/client.js` 就是全部触发条件——不用重启服务，也不用刷新页面：

```sh
cd /path/to/dsh-expert-ai
pnpm run dev
```

内容变化后 Host 会在 `GET /plugins/events` 通道上广播一帧 `rebuilt`，浏览器半边随即原地替换 cordis fiber：丢掉旧 factory、重新拉取 bundle、等旧 fiber 的 disposer 排空、移除 `<style data-plugin="dsh-expert-ai">` 标签，然后重新 apply。被替换子树里的组件状态会丢失，页面其余部分照常运行。

有两类改动落在这条链之外，需要重启 `dsh web`：Host 半边，因为 Web Profile 没有挂载 node 侧的插件重载；以及 `cordis.patch.yml`，因为组合关系只在启动时读取。

不要在这里用 Harness 自己的 `pnpm run dev:web`。它是 Harness checkout 内部包的 watch 构建，不能和那边的 `pnpm run build` 同时跑，而且对仓外包什么都不会重建。

包契约、本地 overlay 和发布方式见 [`docs/build.md`](docs/build.md)、
[`docs/load-into-dsh.md`](docs/load-into-dsh.md) 与 [`docs/publish.md`](docs/publish.md)。

## 使用方法

### 1. 配置专家

启动 Web Profile 后，打开 **设置 → 专家**，新增或编辑一条记录：

插件界面跟随 Harness 当前语言，完整支持英文和简体中文。切换应用语言时，设置页与 Chat Panel 会即时更新；用户填写的名称、描述和人格内容保持原文，不会自动翻译。

- **ID**：只能使用小写字母、数字和连字符，例如 `zjh`
- **名称**：显示名称，例如 `张剑辉`
- **职责描述**：简短说明它负责什么
- **主领域**：`business`、`science`、`culture` 或 `custom`
- **自定义领域**：主领域选择 `custom` 时建议填写
- **能力标签**：用于搜索和分类，例如 `储能系统`、`工程化`
- **人格设定**：初始身份、人设和回答规则；未配置 Agent 文件时会转换为托管 Agent 文件
- **启用**：只有启用的记录会提供给 `expertIdentity` 服务、Chat Panel 与 `@` 候选

也可以直接导入一个 Agent Markdown 文件。文件的 YAML frontmatter 会被忽略，Markdown 正文作为唯一人格来源。浏览器不会暴露 Host 可重新读取的文件路径，因此通过文件选择器选中的内容会改为导入托管文件。未填写外部路径时，输入的人格设定会保存到：

```text
$DSH_HOME/expert-ai/<id>/agents/<id>.md
```

或者点击 **导入 → 从专家方法库导入**，填写 `mimeographs` 的分支或标签（默认 `main`），加载目录后
选择一位专家。导入会把 `AGENTS.md`、`SKILL.md`、`LICENSE` 和目录声明的 `references/*.md` 固定到
解析出的提交，写入 `$DSH_HOME/expert-ai/mimeographs/<slug>/`；同一 slug 已存在时复用本地副本，不按提交区分目录或检查版本冲突。目录与版本解析会缓存在同一目录下，GitHub 暂时不可达时仍可读取已缓存
的目录。导入后的专家可通过 `read_expert_reference` 读取这些本地参考资料。

外部 Agent 文件不会被插件复制或覆盖。

插件设置保存在 Profile 的 Cordis patch 中，不在 `$DSH_HOME/settings.yaml`：

```text
$DSH_HOME/profiles/<profile>/cordis.patch.yml
```

在设置页保存会改写该文件里的 `expert-ai` 行。

### 2. 与专家单聊

打开侧边栏的 **Chat Panel** 并选择一位专家，即可新建一个与该专家的会话。插件会先在 `$DSH_HOME/expert-ai/projects/<datetime>` 下创建一个独立项目，再新建会话并在 Host 侧绑定该专家的人设：

- 会话通过 Host binding 注入该记录专属的 system prompt，开场消息由插件写入，不重复完整人设。
- 会话被强制使用**只读文件沙箱**：可以读取文件，不能修改。
- 所选身份保存在 `$DSH_HOME/expert-ai/sessions/`，Host 重启后再次打开该会话仍带着原人设。

### 3. 在会话中向专家咨询

在输入框输入 `@`，可以按专家 ID 或名字搜索。选择专家后，在当前会话插入 `@<name> `，与 ds-bot 保持一致。也可以直接输入 `@<id>` 或 `@<name>`，名字可以包含空格。点名作为模型可见文本保留，是否发起咨询由主 Agent 决定。`consult_expert(id, question)` 会在 Harness 的 `spawn` 子代理 Provider 上为该专家启动一个 persona 子代理并返回回答。咨询是一次性的，专家不会反问后续问题。

### 4. 更新插件

发布新的 GitHub 版本前，先在插件仓库构建并推送；然后在 Harness checkout 中更新：

```sh
pnpm dsh plugin --profile web update dsh-expert-ai
pnpm dsh web --port 3080
```

如果 Profile 仍然使用旧的 link 或安装内容，可以重新卸载并安装：

```sh
pnpm dsh plugin --profile web remove dsh-expert-ai
pnpm dsh plugin --profile web add https://github.com/elonnzhang/dsh-expert-ai.git
```

## 设置项

通用设置里只有一项：

### 插件数据目录（`stateDir`）

默认为 `$DSH_HOME/expert-ai`。它存放托管身份文件（`<id>/agents/<id>.md`）、单聊项目（`projects/`）和会话绑定（`sessions/`）。显式填写的路径以 `expert-ai` 结尾时直接使用，否则视为父目录并追加 `expert-ai`。

## 模型体验

单聊与咨询共用同一个编译器：记录和正文先编译成专家计划（提示词分段与工具、模型策略），再挂载到会话或子代理上。单聊会话接收计划里的 system prompt，强制只读文件沙箱，并按 `toolFilter` 限制工具；计划保存在 `sessions/` 里，Host 重启后原样恢复。人设由 system prompt 承担，对该 Session 持久且对模型可见。

`consult_expert` 的 schema 会加入主 Agent 的模型请求。每次咨询启动一个子代理，把专家的人设安装为该子代理的 persona，并返回回答文本。

## 已知限制

- 每次通过 Chat Panel 选择专家都会新建会话；`@` 候选只在当前会话插入点名文本，不会新建或打开其他会话。
- 单聊不能按记录切换模型：DSH 0.2.0-rc.2 给插件的会话级模型选择会同时改写部署默认模型，所以 `model` 只作用于 `consult_expert`。
- 内置专家不再能被数据目录里的同名文件覆盖；要修改内置专家，在设置页使用「复制为托管身份」。
- Chat Panel 挂在侧边栏 footer action Slot：当前公共 Sidebar 没有 Workspace 浏览器上方的 additive Slot。
- 单聊会话沿用部署的默认 Agent preset；本插件不再安装自己的 preset。
- `@` 候选的菜单分组标题依赖 Harness 的 `slash.menu` 词典按来源名取值；更早的 Harness 版本会显示原始来源名 `expert-ai`。
