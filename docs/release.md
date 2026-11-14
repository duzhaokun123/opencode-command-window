# 发版流程

本文件是唯一的发版依据，仅供维护者使用。使用者不需要它，因此两份 README 不记录发版流程。

## 仓库职责

- 规范仓库 <https://git.o0kam1.dev/HumanlessCode/opencode-command-window> 是本地的 `origin`。分支与 tag 的所有推送只发往 `origin`。
- GitHub 仓库 <https://github.com/duzhaokun123/opencode-command-window> 是镜像，只承载必须在 GitHub 上维护的自动化：Dependabot 的依赖更新，以及镜像上的 CI check。它不接收任何推送，因此也不会收到 tag 或 release。Dependabot 的 PR 只作为更新提示，实际改动仍在 `origin` 完成并推送。
- 规范仓库没有启用 Actions（Gitea `has_actions = false`），发布不依赖 CI。`.github/workflows/ci.yml` 在 push 到 `main` 与 PR 时运行 `pnpm check`，只在 GitHub 镜像上生效。

## 版本与 tag

- 版本号写在 `package.json` 的 `version`，tag 形如 `v0.1.0`，两者必须一致。
- 提交版本改动后打 tag，并把 tag 推送到 `origin`。

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
- 不在 GitHub 创建 release，也不向 GitHub 推送 tag。
