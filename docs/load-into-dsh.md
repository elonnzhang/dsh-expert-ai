# 加载到 dsh

## 安装版

在 Harness checkout 中把插件加入 Web Profile：

```sh
pnpm dsh plugin --profile web add https://github.com/elonnzhang/dsh-expert-ai.git
pnpm dsh web --port 3080
```

组合包成员变化需要重启 Profile。配置文件层的覆盖可以用 `--dump-config` 检查：

```sh
pnpm dsh --profile web --dump-config
```

## 运行模式（`features`）

插件入口 `config.features` 决定启用哪些部分：`identity` 始终开启，`conversation` 缺省关闭。两者各自提供的内容见 README 的“运行模式”一节。

开启对话功能时，要更新组合包插入的 `expert-ai` 入口并保留完整的 `config`：Cordis patch 会整体替换该对象。保留 `provider`、`maxBatchSize` 和所有现有 `records`，再加入 `features: [identity, conversation]`。`expert-ai-mode` 预设不再随组合包安装，需要时另外应用 `expert-ai-mode.patch.yml`。

`features` 是 volatile 配置，修改后由 loader 原地应用；拿不准时重启 Profile。

## 本地 link

先在插件仓库构建一次，再从 Harness checkout 执行 `add`：

```sh
cd /path/to/dsh-expert-ai
pnpm install
pnpm run check

cd /path/to/deepseek-harness
pnpm dsh plugin --profile web add /path/to/dsh-expert-ai
pnpm dsh web --port 3080
```

这是把 checkout link 进 Profile；后续只需重建 `lib/client.js` 即可让 Web shell 轮询到新
Client 产物。Host 半边与 `cordis.patch.yml` 变化仍需重启 `dsh web`。

## `--patch` 开发 overlay

不安装到 Profile 时，可生成绝对路径 overlay：

请先在目标 Profile 中移除已安装的 `dsh-expert-ai`，或使用一个未安装插件的开发
Profile。overlay 的 Host 条目与组合包共用 id `expert-ai`（Client 按这个 id 读取设置
表单），两者并存会得到两个同 id 的条目。

```sh
cd /path/to/dsh-expert-ai
pnpm run build
pnpm run dev:patch
pnpm run dev:dump
pnpm run dev:web
```

`scripts/dev-patch.mjs` 生成的 `dev/cordis.dev.local.yml` 已被 gitignore 忽略。overlay 中的
Host / Client 路径必须是绝对路径；相对路径会相对 Profile 目录解析。`dev:web` 与 `dev:dump`
每次都会先重新生成 overlay，生成的总是只开身份层的版本。

默认生成的 overlay 只有 Host / Client 两行，即只开身份层。需要对话功能时加 `--conversation`：

```sh
pnpm run dev:patch -- --conversation
pnpm dsh web --patch /path/to/dsh-expert-ai/dev/cordis.dev.local.yml
```

它在 Host 行写入 `features: [identity, conversation]`，并追加 `expert-ai-mode` 预设。
之后直接用上面的 `pnpm dsh web --patch` 启动；`dev:web` 和 `dev:dump` 会把这个 overlay 覆盖回
只开身份层的版本。

配合 `pnpm run dev` 可以持续重建 Client：

```sh
# 终端 1：插件仓库
pnpm run dev

# 终端 2：Harness checkout
pnpm dsh web --patch /path/to/dsh-expert-ai/dev/cordis.dev.local.yml
```

保存 Client 源码后，Web shell 会替换 Client fiber；组件局部状态会重置。Host 代码、patch
组合关系或 Profile 依赖变化不属于这条热加载路径。

## 排查顺序

```sh
pnpm run dev:dump
```

先确认 patch 层里同时出现 Host 和 Client 两行，再检查 `lib/client.js` 是否包含
`window.__ModuleLoader__.load`。如果插件没有任何反应，检查 Profile 是否提供了
`inject` 声明中的服务；缺少必需服务时 Cordis fiber 会保持 `PENDING`。

`dev:dump` 看到的总是只开身份层的 overlay。检查对话功能的 overlay 时，先生成它，再在
Harness checkout 里直接 dump：

```sh
pnpm run dev:patch -- --conversation
pnpm dsh web --patch /path/to/dsh-expert-ai/dev/cordis.dev.local.yml --dump-config
```

这时 Host 行应带有 `features: [identity, conversation]`，并多出 `preset-expert-ai-mode` 一行。
