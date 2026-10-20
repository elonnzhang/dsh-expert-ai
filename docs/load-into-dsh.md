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

## 运行的内容

插件始终提供身份层（`expertIdentity` 服务、身份文件、设置页）、单聊（侧边栏 Chat Panel 与输入框
`@` 专家候选，走 `project` / `greeting` / `binding` / `bind` / `unbind` 端点），以及 `consult_expert`
工具。没有运行模式开关。

旧配置行里遗留的 `features`、`teams`、`maxBatchSize` 仍可加载但会被忽略；停止 Profile 后可以
直接删掉这些字段。`provider` 仍然有效，是 `consult_expert` 使用的子代理 Provider。

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
Host / Client 路径必须是绝对路径；相对路径会相对 Profile 目录解析。生成的 overlay 只有
Host / Client 两行；`dev:web` 与 `dev:dump` 每次都会先重新生成它。

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
