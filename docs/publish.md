# 发布与分发

## npm / tarball

预构建发布不需要用户在安装时执行源码：

```sh
pnpm run check
pnpm pack
pnpm dsh plugin --profile web add ./dsh-expert-ai-0.1.1.tgz
```

发布到 npm 时，先确认 `files` 中包含 `lib` 与 `cordis.patch.yml`。`cordis.patch.yml` 的
patch 行 `name` 必须等于 `package.json` 的 `name`。

## GitHub 源码安装

仓库提供 `prepare`（`tsdown` 加声明生成），因此 Git 安装可以从源码生成 `lib/`。pnpm 10 及以上可能会阻止
依赖的安装脚本；用户需要在目标 Profile 的 `pnpm-workspace.yaml` 中显式批准：

```yaml
allowBuilds:
  dsh-expert-ai: true
```

这项授权意味着安装时会在用户机器上执行该包的构建代码。生产环境应锁定 Git commit，或改用
预构建 tarball：

```sh
pnpm dsh plugin --profile web add github:elonnzhang/dsh-expert-ai#<commit-sha>
```

## 发布前清单

- [ ] `pnpm run check` 通过
- [ ] `pnpm pack --dry-run` 包含 `lib/index.js`、`lib/index.d.ts`、`lib/client.js`、`lib/types/client/index.d.ts`
- [ ] `cordis.patch.yml` 已包含在包内且 `name` 与包名一致
- [ ] Host 产物没有打进 `@deepseek-ai/cordis` 或其他宿主 peer
- [ ] Client 产物包含 `window.__ModuleLoader__.load`
- [ ] README 说明了所需 Profile 服务与重启边界
