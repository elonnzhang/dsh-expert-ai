# 参与贡献

`dsh-expert-ai` 是 DeepSeek Harness（DSH）的身份层插件。它通过 `expertIdentity` 服务向其他插件提供专家身份，并与 DeepSeek-Bot 配合使用。本文件说明分支、提交、测试和发版流程。产品功能与安装方法见 [README.zh.md](README.zh.md)。

## 基本规则

1. **只在 DSH 已文档化的插件 API 上开发，不要修改 DSH。** 需要 DSH 当前没有的能力时，先开 issue 说明，不要在插件里打补丁或依赖 DSH 安装目录内部的文件。
2. **不要提交任何密钥或个人信息。** API key、token、cookie、`DSH_HOME` 内容、日志和带个人信息的截图都不要进入仓库。
3. **只使用原创材料。** 不要复制其他产品或网站的文字、代码、图标和图片。使用兼容许可证的代码时，注明来源并保留许可证要求。
4. **一个 PR 只处理一个 issue、一个主题。** 改动应尽量小，便于审查和回滚。
5. **设计一旦确定，修改需要维护者确认。** 设计文档放在 `docs/plans/`，格式包含 `为什么`、`已定的行为`、`不做什么`、`已知限制`、`变更`。

### `expertIdentity` 契约

DeepSeek-Bot 会消费 `expertIdentity` 服务。破坏该契约时，必须同时：

- 提升 `dsh-expert-ai` 的版本号；
- 更新 `docs/plans/2026-10-21-identity-and-runtime.md`；
- 在 DeepSeek-Bot 的 fake service 中做对应修改。

发版顺序是先发布向后兼容的 `dsh-expert-ai`，再更新 DeepSeek-Bot。这样旧版 DeepSeek-Bot 不会在新身份层上线时立即失效。

## 分支

| 分支 | 用途 |
|---|---|
| `dev` | 日常集成分支。修复、功能和文档先进入这里。 |
| `main` | 只放已发布的代码。只接受 `release: vX.Y.Z` 和紧急热修。 |
| `fix/<issue>-<name>` | 修复，从最新的 `dev` 开始。 |
| `feat/<issue>-<name>` | 功能，从最新的 `dev` 开始。 |
| `docs/<name>` | 文档。 |
| `chore/<name>` | 构建、CI 和维护工作。 |

- 不要创建以 `dev/` 开头的分支。已有 `dev` 分支时 Git 也无法创建 `dev/<name>`。
- 保持分支最新时使用 `git merge dev`，热修分支使用 `git merge main`。
- 已推送的分支不要 rebase，也不要 force-push。
- 热修从 `main` 创建 `fix/hot-<name>`，合入 `main` 后再把 `main` 合回 `dev`。

## Issue 和 PR

1. 提问和想法放在 [Discussions](https://github.com/elonnzhang/dsh-expert-ai/discussions)。确认是 bug 后再开 issue。
2. PR 的目标分支选 `dev`。只有发版和热修才选 `main`。
3. 填写 PR 模板，用 `Fixes #<issue>` 关联 issue；一个 PR 只处理一个 issue。
4. Changelog 写一句用户能感知的变化，没有就写 `none`。
5. CI 通过后用 **Create a merge commit** 合并，不要 squash 或 rebase 合并。合并后删除分支。
6. 修改已定设计时，先在 issue 或 PR 中取得维护者确认，并在同一个 PR 更新 `docs/plans/`。

## 环境与命令

需要 Node.js `^22.19` 或 `>=24`，以及 pnpm `10.30.2`。

```sh
pnpm install
pnpm run check
pnpm run dev
pnpm run dev:web
scripts/real-web.sh start
scripts/real-web.sh stop
```

- `pnpm run check` 依次执行类型检查、测试、构建和 smoke 测试；提交前必须通过。
- `pnpm run dev` 监听 TypeScript 构建。
- `pnpm run dev:web` 生成本地 patch 并启动 DSH Web。
- Host 或 Client 行为有变化时，还要用 `scripts/real-web.sh` 做真实 Web 验证。这个脚本使用独立的 `DSH_HOME`，不要指向 `~/.dsh`。
- 测试依赖已由 `devDependencies` 固定到 DSH `0.2.0-rc.2`，不需要额外安装 DSH。

## 提交与审查

- Commit message 用英文祈使句作标题，例如 `Fix missing avatar fallback`，在正文说明原因。
- 发起改动的人是 commit 作者。AI 工具不能作为作者或 committer，也不要添加 AI 工具的 `Co-authored-by`。
- 不要提交生成文件、缓存、日志或本地 `DSH_HOME`。
- UI 改动附截图。身份契约改动附 DeepSeek-Bot fake service 的同步说明。

## 发版

发版由维护者执行：

1. 通过合入 `dev` 的 PR 修改 `package.json` 中的版本号。
2. 从 `dev` 向 `main` 开 PR，标题为 `release: vX.Y.Z`。
3. 合并后在 `main` 上创建 GitHub Release，标签为 `vX.Y.Z`。这会触发 `release.yml`。
4. 工作流检查标签与 `package.json` 版本一致，确认提交在 `origin/main` 上，运行 `pnpm run check`，然后通过 npm Trusted Publishing 发布。带预发布后缀的版本使用 `next` 标签，正式版本使用 `latest`。
5. 不要手动运行 `npm publish`。需要演练时，手动运行 `release.yml` 并保留 `dry_run: true`。
6. 发布顺序：先发布向后兼容的 `dsh-expert-ai`，再更新 DeepSeek-Bot。

紧急热修从 `main` 创建 `fix/hot-<name>`，合并到 `main` 并发布补丁版本，然后把 `main` 合回 `dev`。

## 许可证

提交贡献即表示同意该贡献按仓库的 [MIT License](LICENSE) 授权。
