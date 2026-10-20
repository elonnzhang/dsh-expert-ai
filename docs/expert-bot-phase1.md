# 专家 Bot 第一阶段设计：身份层 + Bot 运行时

- 日期：2026-10-19
- 范围：只做「与数字分身单聊」和「多个分身群聊」。评审、专家团、记忆扩展都不在本阶段；单专家咨询由身份层插件自身提供（`consult_expert`），不属于 dsh-bot 的改动。
- 两个仓库：
  - 身份层 `dsh-expert-ai`（本仓库由早期版本改名而来）：<https://github.com/elonnzhang/dsh-expert-ai>，本地 `/Users/elon/code-space/GitHub/dsh-expert-ai`
  - 运行时 `dsh-bot`（fork 自 Fei2411/DeepSeek-Bot）：<https://github.com/elonnzhang/DeepSeek-Bot>，本地 `/Users/elon/code-space/GitHub/DeepSeek-Bot`

## 1. 分层

```
dsh-expert-ai（身份层）
  身份库：人物档案、人设正文、头像、来源与授权、版本
  提供 cordis 服务 expertIdentity，另注册主 Agent 的 consult_expert
        │ list() / get(id) / 事件 expert-identity/changed
        ▼
dsh-bot（运行时层，fork 的 ds-bot 插件）
  单聊、群聊、记忆、上下文管家、权限、密钥：全部沿用 ds-bot
  新增：Bot 记录可绑定身份；人设按段冻结进系统提示；身份锁定；从身份库创建
```

原则：

- **身份只有一个来源**。绑定身份的 Bot，人设来自 expertIdentity，`instructions` 不再保存人设副本。未绑定的 Bot 行为与 ds-bot 完全一致。
- **按段冻结**。人设快照在每段 Session 首次渲染时冻结，之后逐字节不变（与 ds-bot 记忆快照同一做法，见 ds-bot `docs/plans/2026-10-09-context-and-memory.md`「怎么用」）。身份库更新从下一段生效；撤回是例外，立即生效（见 F1）。
- **可选依赖**。dsh-bot 用 `ctx.inject(['expertIdentity'], …)` 接入；没装身份层时 dsh-bot 就是普通 ds-bot。
- **ds-bot 内核不动**：群聊轮次、派活树、管家、记忆整理的逻辑本阶段不改。

## 2. 为什么 ds-bot 需要 fork（评估结论）

依据 ds-bot `main`（`e13bc34`，v0.1.7，DSH 0.2.0-rc.2）源码：

| 需求 | 现状 | 依据 | 结论 |
|---|---|---|---|
| 单聊 | 长期私聊、分段、管家、记忆 | `src/host/parts.js`、`steward.js`、`memory.js` | 可用 |
| 群聊 | 1–12 人，`admin` / `everyone` 两种模式，`@` 接力，`[PASS]` | `src/host/groups.js`、`constants.js` `ROOM_MODES` | 可用 |
| 头像、名字 | 图片 ≤160 KB；名字 ≤40 字，可含中文和「·」 | `roster.js` `buildBot`、`src/shared/mentions.js` `nameProblem` | 可用 |
| 从身份库创建 | 只能手填，或 Main Bot `create_bot`；只有一个 Create new Bot 入口 | `src/client/create-bot.js`、`tools.js` | 需改（另加独立入口，原入口不动） |
| 人设保真 | 身份段写死 "a Bot on the user's team in DS Bot"；`TEAM_RULES` 要求「像队友发短信、短句、无标题」，排在人设之后 | `src/host/prompt.js` | 需改 |
| 身份不被改写 | `update_bot` 允许 Bot 改自己的 `instructions`；Main Bot 可改任何 Bot | `src/host/tools.js` `update_bot` | 需改 |
| 身份随库更新 | 创建时复制，之后脱钩 | `roster.js` `buildBot` | 需改 |
| 品牌 | "DS Bot" host 46 处、client 49 处；插件 id `bot`、数据 `$DSH_HOME/bot`、路由 `/api/bot` | grep | 不改（F6 已放弃） |

ds-bot 只 inject DSH 服务、不对外提供接口（`index.js` `inject`），以上「需改」项都在它内部，外挂插件做不到。

## 3. 接口契约：`expertIdentity` 服务

由身份层提供。cordis 写法：`class ExpertIdentityService extends Service { constructor(ctx) { super(ctx, 'expertIdentity') } }`（`@deepseek-ai/cordis` `lib/types/service.d.ts`）；消费方 `ctx.inject(['expertIdentity'], ctx => …)`（`registry.d.ts` `inject(deps, callback)`）。契约类型放在身份层并导出，dsh-bot 是纯 JS，用 JSDoc 引用即可。

```ts
interface ExpertIdentitySummary {
  id: string;                 // /^[a-z0-9][a-z0-9-]*$/，稳定
  name: string;               // 人物名，如「张剑辉」
  title: string;              // 展示后缀，如「储能系统思考助手」；缺省「思考助手」
  description: string;
  category: string;
  tags: string[];
  avatar?: { mime: "image/png" | "image/jpeg" | "image/webp"; data: string }; // base64，≤160 KB（ds-bot MAX_AVATAR_IMAGE）
  source: { kind: "public" | "organization" | "authorized"; note?: string };
  revision: string;           // persona 正文的 sha256（hex）
  enabled: boolean;
}
interface ExpertIdentity extends ExpertIdentitySummary {
  persona: string;            // 人设正文 Markdown，已去掉 frontmatter
  disclosure: string;         // 身份层生成的来源声明，一段话；dsh-bot 原样放进提示
}
interface ExpertIdentityService {
  list(): Promise<ExpertIdentitySummary[]>;          // 只列 enabled
  get(id: string): Promise<ExpertIdentity | undefined>;
}
// 变更事件：ctx.emit('expert-identity/changed', { ids: string[]; withdrawn?: string[] })
```

约定：

- `get` 对未启用或不存在的 id 返回 `undefined`，不抛错。dsh-bot 对取不到身份的 Bot：使用已冻结的上一份快照；从未冻结过则在提示里写明「身份暂不可用」，不冒充。
- `ids` 是本次新增、移除或变化的 id（已排序）。`withdrawn`（可选，已排序）列出其中被用户禁用或删除的 id，`ids` 仍包含它们；没有则不带该字段。人设暂时读不到（文件缺失、外部路径不可达）不算撤回，不进 `withdrawn`。消费方据此区分「身份已撤回」与「身份暂不可用」。
- `disclosure` 由身份层按 `source.kind` 生成。`public` 的含义：基于公开资料整理，不代表本人，被问是否本人时如实说明。
- 文件契约备选：若 §6 V1 验证跨插件服务不可行，身份层改为把 `ExpertIdentity` 写到 `$DSH_HOME/expert-ai/identities/<id>.json`（原子写，0600），dsh-bot 只读。接口字段不变。

## 4. dsh-bot（fork）改动

分支 `feat/expert-identity`（基于 `main` / v0.1.7）。新功能尽量写在新文件，原文件只加挂点，便于合并上游。每个改动带单测（`ds-bot/test/`）。

| # | 改动 | 位置 |
|---|---|---|
| F1 | 身份来源：`ctx.inject(['expertIdentity'])` 接入；Bot 记录增加 `identity: { source: 'expert-ai', id, revision }`；每段 Session 冻结人设快照（存在 `bot/` 数据目录下，与记忆快照同样的生命周期）；监听 `expert-identity/changed`：人设更新只改「下一段用的版本」，已冻结的段不变；`withdrawn` 里的身份立即生效，当前段也改说「身份已撤回」，并删除该 Bot 的快照，之后身份重新可用时解除 | 新 `src/host/identity-source.js`；`index.js` MODULES、`store.js`、`roster.js` |
| F2 | 分身提示词：绑定身份时身份段改为「你是 {name} 的数字分身（{title}）」+ disclosure + persona；`TEAM_RULES` 里「Chat like a teammate texting…」一条改为「语气和表达以你的人设为准」，其余协作规则保留；kickoff 问候按人设口吻。未绑定的 Bot 提示词字节不变 | `src/host/prompt.js`、`roster.js`（kickoff） |
| F3 | 身份锁定：绑定身份的 Bot，`update_bot` 改 `name` / `instructions` 时拒绝并说明「人设由身份库管理」（Main Bot 同样）；界面详情里这两项只读，提供「解除绑定」（只有用户能做，解除后把当前人设写入 `instructions`，变成普通 Bot） | `src/host/tools.js`、`channel.js` `update-bot`、`src/client/bot-settings.js` |
| F4 | 从身份库创建：**保留**原有 Create new Bot 入口不变；另加一个独立入口 Create new Expert-AI Bot（新建 Expert-AI Bot），只在 `expertIdentity` 可用时显示。该入口列出 `list()`，每个身份展示头像、`name`、`title`、`description` 与 `source.kind` 标签（`public` / `organization` / `authorized`）；选中后名字取 `{name} · {title}`（超 40 字截断）、头像取 `avatar`、角色标签可编辑。某个身份已经有 Bot 时，由 dsh-bot 自己按 Bot 记录的 `identity.id` 判断并在列表里标「已创建」——身份层不提供该状态。新增 channel 端点 `identities`（列表）与 `create-bot` 的 `identityId` 参数；服务不可用时入口隐藏 | 新 `src/client/create-expert-bot.js`、`src/client/identity-card.js`；`src/host/channel.js`、`roster.js`（原有 `create-bot.js`、`bot-draft.js` 不动） |
| F5 | 群聊默认模式：成员全是绑定身份的 Bot 时新群默认 `everyone`；用户仍可在群设置里改 | `roster.js` `createRoom` |
| F6 | **已放弃**（2026-10-20）：原计划把产品名做成配置（缺省 "DS Bot"），用于提示词与界面文案，不改插件 id、数据目录、路由。放弃原因：产品名改动会侵入上游十多个与身份无关的文件，违反 fork 的「新增不改写」准则，见 dsh-bot 仓库 `docs/upstream-changes.md` | — |

注意：

- `client.js` 是生成文件：改 `src/client/` 后 `npm run build`，两个文件一起提交（ds-bot `AGENTS.md` 硬规则 4）。
- 保留 Apache-2.0 的 LICENSE / NOTICE；改过的文件在头部注释里标明修改（Apache-2.0 §4(b)）。
- 与原版 ds-bot 不能装在同一个 Profile（同一插件 id `bot`）。写进 README。

## 5. dsh-expert-ai（身份层）改动

分支 `feat/expert-ai-identity`（基于 `main`）。

| # | 改动 | 位置 |
|---|---|---|
| E1 | `expertIdentity` 服务（§3）：从现有 records + `identityFor` 生成；`revision` = persona 的 sha256；设置变更（`loader/volatile-update`）时发 `expert-identity/changed` | 新 `src/host/identity-service.ts`；`src/host/index.ts` `apply` |
| E2 | 记录字段：`title?`、`avatar?`、`source?: { kind, note? }`（缺省 `public`）。Schema 向后兼容，旧设置不迁移即可写入 | `src/types.ts`、`index.ts` `RecordSchema` / `normalizeRecord`、设置页编辑器 |
| E3 | `disclosure` 生成：按 `source.kind` 的固定文案（中文） | `identity-service.ts` |
| E4 | **已删除**（2026-10-20，`537d22b`）：运行模式开关 `features` 取消，身份层与 `consult_expert`、`@<id>` 候选始终开启；`read_expert_reference`、`expert-ai-mode` 预设不再提供。旧设置里的 `features` 仍可加载但会被忽略 | — |
| E5 | 改名：`package.json` 包名与 `cordis.patch.yml` 的模块 `name` 为 `dsh-expert-ai`；Host 插件入口 id、导出的 `name`、settings 命名空间均为 `expert-ai`；Client 注册 id 为 `dsh-expert-ai`，启动清单中的 `dsh-expert-ai/client.js` bundle（由 loader 通过带版本号的 combo URL 请求）；RPC `/api/expert-ai/*`；locale namespace 与 `settings.section` id；Agent preset（`expert-ai-mode.patch.yml`，行 id `preset-expert-ai-mode`）；类型 `ExpertRecord`、`ExpertSettings`、`ExpertBinding`、`ExpertTeam` 等与常量 `EXPERT_AI_*`；函数 `expertAiHome`、`expertAiEndpoint`；工具 `consult_expert`、`consult_expert_category`（后者已在 E7 删除）；README 与 docs。数据目录改为 `$DSH_HOME/expert-ai`；旧数据目录与旧 Profile 设置行**不自动迁移**，升级步骤见 README | 全部出现处（包名、插件入口 id、patch 行、RPC 路由、类型与常量、README 与 docs）；之后 `pnpm install` 刷新 lockfile |
| E6 | 星途 9 位专家：补 `title` 与 `source.kind: public` | `cordis.patch.yml` |
| E7 | 精简（2026-10-20）：删除分类咨询 `consult_expert_category`、评审、专家团的代码、工具、RPC、界面与设置字段，只保留身份数据与单专家咨询（E4 删除后 `consult_expert` 始终开启）。旧 `teams`、`maxBatchSize` 设置仍可加载但被忽略，`.expert-reviews/` 不再读取、不自动删除，专家团主持过的会话打开时不带人设；清理步骤见 README | `src/host/`、`src/client/`、`tests/`、README |
| E8 | 只留身份层与单聊（2026-10-20，其后按用户要求恢复第 1、2 项）：删除 `consult_expert`、`read_expert_reference`、`@<id>` 输入源、`expert-ai-mode` 预设与首页选择器、专家包在线导入（`expert/catalog`、`expert/import`、`ExpertLibraryApi`）以及 `features` / `provider` 设置，Host 不再 inject `tools`、`subagents`。保留 `expertIdentity` 服务、身份库设置页、侧边栏 Chat Panel 与 `project` / `greeting` / `binding` / `bind` / `unbind` 端点。旧设置里的 `features`、`teams`、`maxBatchSize` 仍可加载并被忽略。后续恢复：`@<id>` 候选（选择即新建与该专家的单聊，文本仍留在输入框）与 `consult_expert`（一次性 persona 子代理咨询，记录级 `toolFilter` / `model` 重新生效；`provider` 不再是设置项，固定用 `spawn`）；`read_expert_reference`、Agent preset 与专家包在线导入保持删除 | `src/host/`、`src/client/`、`tests/`、`scripts/`、README、docs |

完成后 `pnpm run check`（typecheck + test + build + smoke）全过，并为 E1–E4 加单测（E4 删除后由其余各条的测试覆盖）。

## 6. 验证

先做 V1–V3 再写 F1–F5（F6 已放弃）。全部在独立的 `DSH_HOME` 里跑，不碰 `~/.dsh`；用完停掉进程。

| # | 验证 | 通过标准 |
|---|---|---|
| V1 | 两插件同装，dsh-bot 通过 `ctx.inject` 拿到 `expertIdentity`，并收到变更事件 | 启动与改设置后都能读到；卸载身份层后 dsh-bot 正常运行 |
| V2 | ~~E4 关闭后 Bot 会话的工具列表与系统提示~~（E4 已删除，不再适用） | — |
| V3 | 不改 ds-bot，把人设贴进 `instructions` 的实际语气 | 用 2–3 个真实模型各问 5 个问题，记录 TEAM_RULES 对语气的影响，作为 F2 改写的基线 |
| V4 | F1–F5 完成后（不含已放弃的 F6）：3 位分身群聊 `everyone` | 各自保持人设、不互相模仿；`[PASS]` 正常 |
| V5 | 分身单聊跨过一次换段 | 人设不丢；身份库改动从下一段生效；记忆整理不把分身自己的话记成用户事实 |
| V6 | 身份锁定 | 分身或 Main Bot 用 `update_bot` 改人设被拒；用户解除绑定后可改 |
| V7 | 被问「你是本人吗」 | 如实说明是基于公开资料的分身 |

## 7. 本阶段不做

- 评审、专家团、参考资料检索在 Bot 里的接入（单专家咨询由身份层插件的 `consult_expert` 提供，不涉及 Bot 运行时改造）。
- 修改 ds-bot 的群聊轮次、派活树、管家、记忆算法。
- 改插件 id / 数据目录以与原版 ds-bot 共存。
- 合并 ds-bot 上游 `dev`（已升到 DSH 0.2.1-rc.2，比 `main` 多 140 个提交）。第一阶段稳定后再评估。

## 8. 待用户确认（先按默认值推进）

| 问题 | 默认 |
|---|---|
| 命名 | 身份层 `dsh-expert-ai`，运行时 `dsh-bot`；对外产品名未定 |
| 与原版 ds-bot 共存 | 不共存 |
| Main Bot | 保留（ds-bot 不变量：至少一个），可改名 |
| 人设在哪里改 | 只在身份库改；Bot 侧只能解除绑定 |
| 星途专家授权 | 未知，按 `public` 处理，不用本人照片 |

