# dsh-expert-ai

[English](README.md) | 中文

`dsh-expert-ai` 为 DeepSeek Harness 维护一个专家身份库（人设、头像、来源声明），并通过 `expertIdentity` Cordis 服务提供给其他插件。它是与 `dsh-bot` 运行时配合使用的身份层，另外只提供与单一位专家的对话界面。

## 功能

本插件只做两件事：

- **身份层**：在 `expert-ai` 设置命名空间中持久化专家记录，每条身份保存在 `$DSH_HOME/expert-ai/<id>/agents/<id>.md`；通过 `expertIdentity` Cordis 服务把已启用的身份（人设、头像、来源声明与版本）提供给其他插件，例如 Bot 运行时。
- **单聊**：在侧边栏 Chat Panel 里选择一位专家，打开一个绑定该专家人设的独立会话。会话不依附 Workspace，强制只读文件沙箱，开场消息由插件写入。

同时提供符合 Harness 风格的设置区，用于新增、编辑、启用和删除专家记录，并可导入 Agent Markdown 文件（YAML frontmatter 忽略，正文即人设）。

不提供：向主 Agent 咨询专家的工具、`@<id>` 输入源、Agent preset 选择器、专家包在线导入，以及群聊（群聊由 `dsh-bot` 运行时负责）。

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

每条记录包含 `id`、`name`、`description`、主领域 `category`、能力标签 `tags[]`、`agent`、`persona` 和 `enabled`。`agent` 是唯一的人格来源：未填写 Agent 文件时，保存会将 `persona` 写入托管的 `<id>/agents/<id>.md`，并把相对路径保存到 `agent`；填写 Agent 文件后，以该 Markdown 正文为准，忽略 `persona`。相对 `agent` 路径会先从 `$DSH_HOME/expert-ai/` 读取，文件不存在时再从插件包读取，因此全新 Profile 也能加载包内的 `experts/`；若数据目录下有同名文件，则优先使用该文件覆盖包内版本。新建 `custom` 主领域的记录时建议填写 `customCategory`；旧配置缺少该字段时会回退使用专家名称。Host 会校验设置文档，旧配置里遗留的 `toolFilter`、`model`、`provider`、`features`、`teams`、`maxBatchSize` 会被忽略。

展示字段均为可选，没有它们的旧记录仍然有效：

- `title`：显示在名字后面，去掉首尾空白后不超过 40 个字符，缺省为“思考助手”。
- `avatar`：`{ mime, data }`，`mime` 为 `image/png`、`image/jpeg` 或 `image/webp`，`data` 为 base64；整个 data URL 不超过 160,000 个字符。编辑器会把所选图片居中裁成 160 px 的正方形后重新编码。
- `source`：`{ kind, note? }`，`kind` 为 `public`、`organization` 或 `authorized`；`note` 不超过 200 个字符。没有 `source` 的记录按 `public` 处理，`kind` 决定身份附带的来源声明。

## expertIdentity 服务

其他插件通过 `ctx.inject(['expertIdentity'], ctx => …)` 读取身份：

- `list()` 返回已启用且人设可读取的身份。`get(id)` 返回单个身份（含 `persona` 与 `disclosure`）；id 不存在、未启用或人设无法读取时返回 `undefined`。
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

### 升级到只提供身份层与单聊的版本

本版本删除了向主 Agent 咨询专家的工具（`consult_expert`、`read_expert_reference`）、`@<id>` 输入源、
`expert-ai-mode` Agent preset、专家包在线导入（`expert/catalog`、`expert/import`）以及 `features` 与
`provider` 设置。插件现在始终只提供身份层与单聊。

已有 Profile 无需迁移数据，只需停止 Profile 后清理 patch 行里不再读取的字段：

```yaml
- id: expert-ai
  name: dsh-expert-ai
  config:
    stateDir: …        # 保留
    records: […]       # 保留
    # 以下字段已不再读取，可以删掉
    features: [identity, conversation]
    provider: spawn
    teams: […]
    maxBatchSize: 3
```

数据目录仍是 `$DSH_HOME/expert-ai`。其中 `.expert-packages/` 是旧版在线导入的专家包缓存，
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
- **启用**：只有启用的记录会提供给 `expertIdentity` 服务与 Chat Panel

也可以直接导入一个 Agent Markdown 文件。文件的 YAML frontmatter 会被忽略，Markdown 正文作为唯一人格来源。浏览器不会暴露 Host 可重新读取的文件路径，因此通过文件选择器选中的内容会改为导入托管文件。未填写外部路径时，输入的人格设定会保存到：

```text
$DSH_HOME/expert-ai/<id>/agents/<id>.md
```

外部 Agent 文件不会被插件复制或覆盖。

插件设置保存在 Profile 的 Cordis patch 中，不在 `$DSH_HOME/settings.yaml`：

```text
$DSH_HOME/profiles/<profile>/cordis.patch.yml
```

在设置页保存会改写该文件里的 `expert-ai` 行。

### 2. 与专家单聊

打开侧边栏的 **Chat Panel**，选择一位专家。插件会先在 `$DSH_HOME/expert-ai/projects/<datetime>` 下创建一个独立项目，再新建会话并在 Host 侧绑定该专家的人设：

- 会话通过 Host binding 注入该记录专属的 system prompt，开场消息由插件写入，不重复完整人设。
- 会话被强制使用**只读文件沙箱**：可以读取文件，不能修改。
- 所选身份保存在 `$DSH_HOME/expert-ai/sessions/`，Host 重启后再次打开该会话仍带着原人设。

### 3. 更新插件

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

单聊会话会接收基于具体记录生成的 system prompt，并强制使用只读文件沙箱。人设由 system prompt 承担，对该 Session 持久且对模型可见；本插件不向主 Agent 注册任何工具。

## 已知限制

- 单聊入口在侧边栏 Chat Panel。当前公共 Sidebar 没有 Workspace 浏览器上方的 additive Slot，因此使用受支持的 footer action Slot。
- 单聊会话沿用部署的默认 Agent preset；本插件不再安装自己的 preset。
- 每条记录的独立模型配置不支持。
