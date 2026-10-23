# 身份层与专家运行时

- 日期：2026-10-21
- 相关：代码审计（2026-10-21）、DeepSeek-Bot `docs/expert-ai-integration.md`

## 为什么

审计发现的问题集中在两处：

1. **身份数据有四种写法。** 内置星途专家用 `agent: experts/xingtu/<id>/AGENTS.md`，元数据同时写在 patch 和 AGENTS.md frontmatter 里；方法包用 `agent` + `expertPackage` + `manifest.json`；托管身份用 `agent: <id>/agents/<id>.md`；外部文件用任意路径。来源靠路径猜，校验、迁移和界面各写一遍，Host 与 Client 的规范化逻辑也不同。
2. **运行时堆在一个文件里，两条入口的语义不一致。** `src/host/index.ts` 同时管配置、提示词、咨询、工具、RPC 和生命周期；单聊不应用记录的工具范围，咨询应用；文档说 `provider` 可配，代码固定 `spawn`；RPC 入参靠类型断言。

## 已定的行为

### 1. 统一的身份记录

设置里的每条记录只有一种规范形状（`src/types.ts` 的 `ExpertRecord`），来源由 `origin` 明确声明：

| `origin.kind` | 正文来自 | 可编辑 | 例子 |
|---|---|---|---|
| `managed` | `$DSH_HOME/expert-ai/<id>/agents/<id>.md` | 是，设置页写回 | 新建、从浏览器导入的 Agent 文件 |
| `file` | `origin.path` 指向的 Host 上的 Markdown | 否，文件为准 | `~/.claude/agents/x.md` |
| `bundled` | 插件包内 `origin.path` 目录（专家包），支持任意子目录 | 否，可复制为托管 | `experts/ELON`、`experts/xingtu/clq` |
| `package` | `$DSH_HOME/expert-ai/mimeographs/<slug>/`（专家包） | 否，可复制为托管 | mimeographs 导入 |

规则：

- **元数据只在设置记录里。** `name`、`title`、`description`、`category`、`tags`、`source`、`avatar` 一律以记录为准；专家包清单只提供导入时的初值、来源和完整性。
- **正文统一是 AGENTS.md 去掉 frontmatter 后的 Markdown。** 四种来源共用一个解析函数。
- **规范化与校验只有一份。** `src/record-model.ts` 是纯函数模块，Host 的设置校验和 Client 的编辑器都调用它，错误以 `{ field, code, message }` 返回。
- **旧记录自动读成新形状，不改写用户文件。** 迁移规则：有 `origin` 用 `origin`；有 `expertPackage` → `package`（缺 `ref` 时用 `revision`）；`agent` 缺失或等于 `<id>/agents/<id>.md` → `managed`；`agent` 形如 `experts/<任意子目录>/AGENTS.md` → `bundled`；其他 → `file`。`tag` 并入 `tags`。设置页下次保存时写出新形状，旧字段不再写。

### 2. 统一的专家包

内置专家与导入的方法包使用同一种目录与清单 `manifest.json`（`schemaVersion: 2`）：

```text
<pack>/
  manifest.json   身份初值、来源、文件哈希
  AGENTS.md       身份正文（内置包不再带 frontmatter）
  SKILL.md        可选
  LICENSE         方法包必有
  references/*.md 可选，read_expert_reference 读取
```

```ts
interface ExpertPackManifest {
  schemaVersion: 2;
  origin: "bundled" | "package";
  id: string; name: string; title?: string; description: string;
  category: ExpertCategory; tags: string[];
  source: { kind: "public" | "organization" | "authorized"; note?: string };
  provenance: { collection: string; slug?: string; revision?: string; importedAt?: string };
  files: Array<{ path: string; sha256: string; bytes: number }>;
}
```

- 内置包的清单由 `scripts/export-xingtu-experts.mjs` 生成并提交；测试校验文件哈希与 `cordis.patch.yml` 的记录一致。
- 方法包导入写 v2 清单；已导入的 v1 清单照常读取，不重写磁盘。
- 两种包读取前都校验 `files` 的大小与 sha256，并拒绝逃出包目录的路径和符号链接。
- 内置包不再接受数据目录里同名文件的覆盖：要改内置专家，用设置页的「复制为托管身份」。

### 3. `expertIdentity` 契约

DeepSeek-Bot 只依赖这个服务。已有字段与语义不变：`list()`、`get(id)`、`expert-identity/changed { ids, withdrawn? }`、`revision` 只由正文决定。新增一个可选字段 `origin`（`managed | file | bundled | package`），旧消费者可以忽略。服务缓存已解析的身份，设置变化后失效重建，`list/get` 不再每次全量读盘。契约变化须同时：升版本、更新本节、更新 DeepSeek-Bot 的假服务；发布顺序是先发本插件的兼容版本，再发 DeepSeek-Bot。

### 4. 编译式专家运行时

运行时分两步：**编译**把「记录 + 身份正文」变成一份可序列化的 `ExpertPlan`；**挂载**把 plan 装到某个执行面上。两条入口共用一个编译器，语义自然一致；plan 落盘即会话绑定，重启后直接重新挂载。

```text
ExpertRecord + identity ──compile──▶ ExpertPlan ──mount──▶ Session 面（单聊）
                                         └──────mount──▶ Subagent 面（consult_expert）
```

```ts
interface ExpertPlan {
  version: 2;
  expertId: string;
  revision: string;               // 正文 sha256
  sections: Array<{ name: string; order: number; text: string }>;
  policy: {
    sandbox: "read-only";
    tools?: string[];             // 记录的 toolFilter
    model?: { provider?: string; model?: string };
  };
}
```

- **单聊**：挂载提示词分段、只读沙箱，并用 `agent.ctx.tools.restrict({ allow })` 应用 `policy.tools`。绑定时 `tools` 里有未注册的工具名就拒绝绑定；恢复旧会话时只应用已注册的名字并记警告。模型见「已知限制」。
- **咨询**：同一份 policy 转成子代理请求的 `persona`、`toolFilter`、`agentOptions`。Provider 固定为 `spawn`，不提供配置项。
- 旧绑定（`{ recordId, prompt }` 与 `{ recordId, pre, persona, suf }`）读取时转成 plan，原提示词保持不变。

模块边界：

```text
src/record-model.ts          记录规范化与校验（Host、Client 共用，纯函数）
src/host/index.ts            组合根，只装配
src/host/config.ts           Schema 与 validateSettings
src/host/identity/           身份层：存储、来源解析、专家包、mimeographs、expertIdentity 服务
src/host/runtime/            运行时：compile、prompts、session 面、consult 面、工具
src/host/rpc/                RPC：带 Schema 校验的端点表、路由注册
```

### 5. RPC

每个端点用 `defineEndpoint(name, schema, handler)` 声明，入参先过 schemastery 校验，失败统一返回 `{ ok: false, error: { code: "invalid-request", message } }`；处理器抛错统一返回 `internal`。端点列表与路径不变。

### 6. 服务层

多专家协作、评审、实验计划等「专家服务」不在本次范围。默认在 DeepSeek-Bot 里做（群聊、派活已有）；若将来放在本仓库，作为独立的 `src/host/services/` 建在运行时的 compile/mount 之上，不改身份层。

## 不做什么

- 不迁移用户磁盘上的旧文件；只在读取时转换。
- 不做可配置的子代理 Provider。
- 不做多专家编排、结构化评审、跨会话记忆。

## 已知限制

- **单聊不能按记录切换模型。** DSH 0.2.0-rc.2 给插件的 `sessionController.selectModel` 会同时保存部署默认模型；客户端 `sessions.create` 也不接受 `agentOptions`。记录的 `model` 目前只作用于咨询，设置页标明「咨询模型」。DSH 提供无副作用的会话级模型接口后再统一。
- 内置专家的数据目录覆盖已取消；依赖它的用户需改用「复制为托管身份」。

## 变更

- 2026-10-21：初版。
- 2026-10-21：`bundled.path` 放宽为 `experts/` 下任意深度的子目录，目录名保留大小写，manifest `id` 仍为小写。

- 2026-10-21：导入包改为 `$DSH_HOME/expert-ai/mimeographs/<slug>/`，同名 slug 复用；提交信息仅作来源追溯，不用于目录分层或版本冲突判断。旧目录保留读取兼容。
