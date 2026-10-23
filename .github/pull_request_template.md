<!--
Base branch: dev. Only hotfixes and releases target main.
目标分支选 dev。只有热修和发版才选 main。
-->

## Issue

Fixes #

## What changed / 改了什么



## Changelog

<!-- One sentence that users will notice, or "none". Do not edit CHANGELOG.md. / 一句用户能看到的变化，没有写「无」。不要改 CHANGELOG.md。 -->



## How I checked it / 怎么验证的

- [ ] `pnpm run check`
- [ ] Real Web check with `scripts/real-web.sh`, for Host or Client behavior changes / 改了 Host 或 Client 行为时用 `scripts/real-web.sh` 做真实 Web 验证
- [ ] Screenshot attached, for UI changes / 界面改动已附截图
- [ ] DeepSeek-Bot fake service updated, for an `expertIdentity` contract change / `expertIdentity` 契约有变化时已同步 DeepSeek-Bot 的 fake service

See `docs/plans/2026-10-21-identity-and-runtime.md` when the identity contract changes.
身份契约变化时请查看 `docs/plans/2026-10-21-identity-and-runtime.md`。

## Checklist / 检查

- [ ] One issue, one subject. / 一个 issue 只做一件事。
- [ ] No secrets or personal data, also in screenshots. / 没有密钥或个人信息，截图里也没有。
- [ ] No AI tool as author or `Co-authored-by`. / 没有把 AI 工具写成作者或 `Co-authored-by`。
- [ ] The design doc is updated when a decided design changes. / 已定的设计有变化时已更新设计文档。
