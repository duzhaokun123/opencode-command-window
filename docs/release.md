# 发版流程

本文件是唯一的发版依据，仅供维护者使用。使用者不需要它，因此两份 README 不记录发版流程。

## 仓库职责

- 规范仓库 <https://git.o0kam1.dev/HumanlessCode/opencode-command-window> 是本地的 `origin`。分支与 tag 的所有推送只发往 `origin`。
- GitHub 仓库 <https://github.com/duzhaokun123/opencode-command-window> 是镜像。它的 `main` 与 `v*` tag 由 `.gitea/workflows/mirror.yml` 自动同步，因此 tag 也会出现在 GitHub。它另外承载必须在 GitHub 上维护的自动化：Dependabot 的依赖更新，以及镜像上的 CI check。Dependabot 的 PR 只作为更新提示，实际改动仍在 `origin` 完成并推送。
- 规范仓库已启用 Gitea Actions，但 Gitea 只读 `.gitea/workflows/`，`.github/workflows/ci.yml` 只在 GitHub 镜像上运行，`pnpm check` 不消耗 runner。发布不依赖 CI。
- 注册在 Gitea 上的 runner 使用 `host` 标签，job 直接在 runner 机器上执行。

## 镜像工作流

`.gitea/workflows/mirror.yml` 在 `main` 与 `v*` tag 推送到 `origin` 后运行，也可以在 Gitea 上手动触发 `workflow_dispatch`。

- 需要仓库 Secrets 中的 `MIRROR_TOKEN`：针对镜像仓库的 GitHub fine-grained PAT，只授予 Contents 读写。Gitea 拒绝以 `GITEA_` 或 `GITHUB_` 开头的名称（`services/secrets/validation.go`），所以自动注入的 job token 不会被覆盖。
- 工作流不使用 `uses:`。官方 runner 镜像只装 s6/tini、bash、git 等，不含 node，而 runner v6 已移除 `builtin:checkout`（`refactor!: remove the builtin actions (#1407)`），因此读取与推送全部由 git 完成。
- 分支推送镜像 `main` 与全部 tag；tag 推送只镜像该 tag，避免 tag 落后于 `main` 时把镜像的 `main` 回退。
- 不做 force：镜像上出现独有提交时 push 会因非快进而失败，需要人工处理，不会被静默覆盖。
- 从 `origin` 读取时用匿名 HTTPS（仓库公开）。仓库转为私有后需要改成带凭据读取。
- 重复运行是幂等的；需要补齐时手动运行 `mirror` 即可。

## 版本与 tag

- 版本号写在 `package.json` 的 `version`，tag 形如 `v0.1.0`，两者必须一致。
- 提交版本改动后打 tag，并把 tag 推送到 `origin`；镜像工作流会把它带到 GitHub。

## 发布前检查

```sh
pnpm check                # tsc --noEmit && vitest run
npm pack --dry-run        # 核对文件清单
```

- `npm pack --dry-run` 的清单只应包含非测试的 `src/*.ts`、两份 README、`LICENSE` 与 `package.json`。`files` 字段不含 `docs/`，本文件不会进入发布包。
- 用打出的 tarball 装进临时项目，跑一次真实 OpenCode 会话，确认插件加载且窗口参数生效。

## 发布

- 由维护者在本机执行 `npm publish`，npm 账号为 `o0kam1`，需要浏览器 2FA。
- `publishConfig` 固定 `https://registry.npmjs.org` 与 public access；`prepublishOnly` 会先跑 `pnpm check`，检查失败则中止发布。
- 这样发布的包没有 provenance 证明，因为 npm 只从 GitHub Actions、GitLab CI 与 CircleCI 生成该证明。

## 发布后

- 在 `origin` 手动创建 release，标题与 tag 保持一致。
- 不在 GitHub 创建 release。GitHub 会通过镜像拿到 tag，但不生成 release。
