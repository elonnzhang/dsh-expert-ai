# dsh-expert-ai

[English](README.md) | 中文

`dsh-expert-ai` 为 DeepSeek Harness 维护一个数字身份库（人设、头像、来源声明），并通过 `expertIdentity` Cordis 服务提供给其他插件。它是与 `dsh-bot` 运行时配合使用的身份层（见[与 dsh-bot 配合](#与-dsh-bot-配合)）。插件自带的咨询、评审和专家团功能仍然保留，但只有开启 `conversation` 功能后才会运行（见[运行模式](#运行模式)）。

## 功能

始终开启（`identity` 功能）：

- 在 `digital-life` 设置命名空间中持久化数字生命记录。
- 提供符合 Harness 风格的设置区，用于新增、编辑、启用和删除数字生命记录。
- 提供 `expertIdentity` Cordis 服务，供其他插件（如 Bot 运行时）读取已启用的身份：人设、头像、来源声明与版本。

仅在开启 `conversation` 功能时提供（默认关闭）：

- 提供 `consult_digital_life`，用于一次性咨询指定数字生命。
- 提供 `consult_digital_life_category`，用于并行咨询一个分类中的多个数字生命。
- 提供评审工具（`review_expert_plan`、`read_expert_review`）与专家团运行工具，以及设置页的专家团标签和 Expert AI 面板。
- 注册 `@<id>` 输入源，用于选择已配置的数字生命。
- 通过 additive `sidebar.footer.action` Slot 注入 Chat Panel，不替换 Harness 的 Sidebar 或 Workspace 浏览器。
- 创建不附加 Workspace 的独立会话，并使用所选数字生命初始化会话。
- 将 `digital-life-mode` 注册到 Harness 首页原生 Agent preset 选择器及预设设置页（需另外应用的补丁，见[运行模式](#运行模式)）；具体数字生命可从会话选择器或侧边栏 Chat Panel 选择。

## 与 dsh-bot 配合

本插件只提供身份；单聊和群聊由 `dsh-bot` 运行时负责。两者装进同一个 Profile 即可。

- `dsh-bot` 通过 `ctx.inject(['expertIdentity'], …)` 取得 `expertIdentity` 服务。没有装本插件时，它就是普通的 ds-bot；本插件不依赖 `dsh-bot`。
- 身份只在这里新建和编辑（**设置 → 数字生命**）。按设计，`dsh-bot` 从服务读取已绑定 Bot 的人设和来源声明，并跟随 `expert-identity/changed` 更新。
- 默认的 `identity` 模式下，本插件不注册 `consult_*`、评审和专家团工具，也不给会话绑定人设，所以 Bot 会话里只有一份身份。`dsh-bot` 作为运行时时请保持 `conversation` 关闭。
- link 方式加载的 checkout 从 `lib/` 读取，而 `lib/` 不进版本库：改动 Host 半边后请运行 `pnpm run build`。

职责划分与服务契约见 [`docs/expert-bot-phase1.md`](docs/expert-bot-phase1.md)。

## 运行模式

插件入口 `config` 里的 `features` 决定插件做什么。`identity` 始终开启，唯一的另一个取值是 `conversation`，缺省为 `[identity]`。其他名字会在配置校验时被拒绝。

| 功能 | 提供的内容 |
| --- | --- |
| `identity`（始终） | 带「专家」「通用设置」标签的设置区、托管的身份文件、`expertIdentity` 服务及其变更事件、`expert/*` 与 `identity` 端点 |
| `conversation` | `consult_*`、评审与专家团运行工具；新会话的人设与专家团绑定（含 `project`、`greeting`、`binding`、`bind`、`unbind` 和 `review/*` 端点）；Chat Panel；`@<id>` 输入源；Expert AI 面板与侧边栏入口；会话首页的数字生命选择器；设置页的专家团标签 |

在组合包插入的 `digital-life` 入口中开启对话功能时，要保留完整的 `config`：Cordis patch 会整体替换该对象。保留 `provider`、`maxBatchSize` 和所有现有 `records`，再加入 `features: [identity, conversation]`。

`digital-life-mode` Agent preset 不再随安装的组合包提供；需要时另外应用 `digital-life-mode.patch.yml`，没有它时独立会话使用部署的默认 preset。开发 overlay 可用 `pnpm run dev:patch -- --conversation` 生成。

- `features` 没有设置页入口。identity 模式下，**子代理 Provider** 与 **分类最大咨询数** 仍然显示，但不起作用。
- Client 在拿到设置值之后才挂载对话相关界面；设置还在加载、不可用或缺失时，什么都不挂载。
- 修改 `features` 通过 loader 的 volatile 更新原地生效（若没有生效，请重启 Profile）。把 `conversation` 关掉会撤销工具和 Client 界面，但已经绑定过的会话在重建前仍带着原来的身份段。已经在运行的专家团阶段会自行结束，其子代理仍只能输出结构化结果；后续阶段和取消运行需要重新开启 `conversation`。

## 演示

<!-- prettier-ignore -->
| Chat Panel | 设置 | 新增数字生命 |
| ---- | ---- | ------ |
| <img src="pics/chat.png" alt="数字生命 Chat Panel" width="960"> | <img src="pics/setting.png" alt="数字生命设置页面" width="960"> | <img src="pics/setting2.png" alt="新增数字生命表单" width="960"> |

## 数字生命记录字段

每条记录包含 `id`、`name`、`description`、主领域 `category`、能力标签 `tags[]`、`agent`、`persona` 和 `enabled`。`agent` 是运行时唯一的人格来源：未填写 Agent 文件时，保存会将 `persona` 写入托管的 `<id>/agents/<id>.md`，并把相对路径保存到 `agent`；填写 Agent 文件后，以该 Markdown 正文为准，忽略 `persona`。相对 `agent` 路径会先从 `$DSH_HOME/digital-life/` 读取，文件不存在时再从插件包读取，因此全新 Profile 也能加载包内的 `experts/`；若数据目录下有同名文件，则优先使用该文件覆盖包内版本。新建 `custom` 主领域的记录时建议填写 `customCategory`；旧配置缺少该字段时会回退使用数字生命名称。`toolFilter` 与 `model` 为可选字段。Host 会校验设置文档，并使用配置的子代理 Provider 创建一次性咨询。智囊团设计见 [`docs/think-tank-agent-team.md`](docs/think-tank-agent-team.md)。

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

打开 `http://127.0.0.1:3080`，然后进入 **设置 → 数字生命**。

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

### 从 `dsh-digital-life` 升级

包已改名为 `dsh-expert-ai`；settings 命名空间（`digital-life`）、数据目录（`$DSH_HOME/digital-life`）
和所有条目 id 保持不变。已有 Profile 需要换装插件：

```sh
pnpm dsh plugin --profile web remove dsh-digital-life
pnpm dsh plugin --profile web add https://github.com/elonnzhang/dsh-expert-ai.git
```

用旧包名写入的设置覆盖仍留在 `$DSH_HOME/profiles/<profile>/cordis.patch.yml`，形如
`{ id: digital-life, name: dsh-digital-life, config: … }`。loader 只应用 `name` 与条目一致的
行，所以该行会被跳过，条目回落到组合包默认值。请在改动其他设置之前，把这些值重新填进设置页
一次（或把该行的 `name` 改成 `dsh-expert-ai`），然后删除这行旧配置。

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
| `lib/client.js` | `src/client/index.ts` | 浏览器，服务在 `/plugins/dsh-expert-ai/client.js` |
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

步骤 2–4 需要开启 `conversation` 功能（见[运行模式](#运行模式)）；默认的 identity 模式下只有步骤 1 和 5 适用。

### 1. 配置数字生命

启动 Web Profile 后，打开 **设置 → 数字生命**，新增或编辑一条记录：

插件界面跟随 Harness 当前语言，完整支持英文和简体中文。切换应用语言时，设置页、Chat Panel 和会话选择器会即时更新；用户填写的名称、描述和人格内容保持原文，不会自动翻译。

- **ID**：只能使用小写字母、数字和连字符，例如 `startup-mentor`
- **名称**：显示名称，例如 `创业导师`
- **职责描述**：简短说明它负责什么
- **主领域**：`business`、`science`、`culture` 或 `custom`
- **自定义领域**：主领域选择 `custom` 时建议填写
- **能力标签**：用于搜索和分类，例如 `创业`、`现金流`
- **人格设定**：初始身份、人设和回答规则；未配置 Agent 文件时会转换为托管 Agent 文件
- **启用**：只有启用的记录会出现在选择器和分类咨询中

也可以填写 Host 可读取的路径来绑定已有 Agent Markdown 文件。文件的 YAML frontmatter 会被忽略，Markdown 正文作为运行时唯一人格来源。浏览器不会暴露 Host 可重新读取的文件路径，因此通过文件选择器选中的内容会改为导入托管文件。未填写外部路径时，输入的人格设定会保存到：

```text
$DSH_HOME/digital-life/<id>/agents/<id>.md
```

外部 Agent 文件不会被插件复制或覆盖。

默认设置文件是：

```text
$DSH_HOME/settings.yaml
```

### 2. 配置咨询 Provider

**子代理 Provider** 必须填写当前 Harness 已挂载的 subagent Provider ID。没有额外 Provider 时保持默认值 `spawn`。**分类最大咨询数** 控制 `consult_digital_life_category` 一次最多并行咨询多少条已启用记录，不影响独立会话。

### 3. 在输入框中使用数字生命

在输入框输入 `@`，然后选择数字生命，例如 `@startup-mentor`。`@<id>` 只是帮助主 Agent 选择 `consult_digital_life` 的模型可见文本，不是自动命令；是否咨询仍由模型决定。

可用工具：

- `consult_digital_life(id, question)`：咨询一条指定的数字生命
- `consult_digital_life_category(category, question)`：并行咨询一个领域中的已启用数字生命，再比较各自观点

### 4. 创建独立会话

从会话顶部选择一个数字生命，或打开侧边栏 **Chat Panel** 选择。未选择数字生命时输入框会被阻塞；如果没有选择项目，插件会先在 `~/.dsh/digital-life/projects/<datetime>` 下创建独立项目，再打开会话。

独立会话不附加 Workspace，不传 `workspaceId` 或 `cwd`，并通过 Host binding 注入该记录专属的 system prompt。所选身份保存在 `$DSH_HOME/digital-life/sessions/`，Host 重启后仍可恢复。数字生命会话强制使用**只读文件沙箱**；此模式提供数字生命咨询工具，不提供文件修改工具。开场消息是简短提示，不会重复完整人格设定。

在数字生命独立会话中，使用 `@<id>` 点名其他记录时必须调用 `consult_digital_life`，当前数字生命不得模拟或代替对方回答；点名当前数字生命自身的 ID 时直接回答，不进行自我咨询。

### 5. 更新插件

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

### 子代理 Provider

该值必须是当前 Harness 已挂载的 subagent Provider ID，默认值为 `spawn`。它用于一次性咨询工具，不是模型名称，也不是数字生命 ID。Provider 不存在或不支持所需能力时，咨询会返回明确错误。

### 分类最大咨询数

该值默认为 `3`，只影响 `consult_digital_life_category`。工具会筛选指定分类中已启用的记录，并最多并行启动该数量的数字生命子代理。它不影响单个咨询、`@<id>`、Chat Panel 或首页独立会话。

## 模型体验

咨询工具的 schema 会加入主 Agent 的模型请求。单个咨询启动一个子代理并返回文本；分类咨询最多并行启动 `maxBatchSize` 个已启用记录。独立数字生命会话会接收基于具体记录生成的 system prompt，并强制使用只读文件沙箱；角色设定由 system prompt 承担，对该 Session 持久且对模型可见。

## 已知限制与后续工作

在普通 Chat 中，`@<id>` 是帮助 Agent 选择 `consult_digital_life` 的模型可见文本，不是自动命令；在数字生命独立会话中，持久化 system prompt 要求点名其他记录时必须使用咨询工具，点名自身时直接回答。当前公共 Sidebar 没有 Workspace 浏览器上方的 additive Slot，因此 Chat Panel 使用受支持的 footer action Slot。独立会话在 `digital-life-mode` Agent preset 可用时使用该模式（该 preset 是需另外应用的补丁，见[运行模式](#运行模式)），否则使用部署默认 preset；每条记录的独立模型配置尚未应用到 Session 创建过程。
