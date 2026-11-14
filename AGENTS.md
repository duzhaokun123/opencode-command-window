# Agent Memory — opencode-command-window

本文件是本仓库的常驻 agent 指令，跨会话生效（新会话打开本仓库时自动加载）。它不绑定任何具体 CLI、harness 或模型。

## 仓库位置

- 规范仓库：<https://git.o0kam1.dev/HumanlessCode/opencode-command-window>（即 `origin`）。
- GitHub 仓库 <https://github.com/duzhaokun123/opencode-command-window> 是它的镜像：代码改动与 pull request 提交到规范仓库。镜像的 `main` 与 `v*` tag 由 `.gitea/workflows/mirror.yml` 自动推送（细节见 `docs/release.md`）；GitHub 另外承载必须在那边维护的自动化（Dependabot 依赖更新、镜像上的 CI check），其 PR 仅作更新提示，GitHub 的 issue 可用于提问与讨论。
- npm 包名是 `@o0kam1/opencode-command-window`，发布账号为 `o0kam1`。`repository` 指向 GitHub 镜像，因为 npm 的可信发布与 provenance 要求它与发布来源仓库一致；`homepage` 指向规范仓库，`bugs` 指向 GitHub issues；tag 与 release 只在规范仓库创建。
- 修改 `README.md` / `README.zh.md` 时保留顶部的镜像声明。
- 依赖更新由 GitHub 镜像上的 Dependabot 负责，配置在 `.github/dependabot.yml`：`npm` 生态覆盖 `package.json` 与 `pnpm-lock.yaml`，`github-actions` 生态覆盖 workflow 中的 action 版本；每周检查一次，minor 与 patch 合并成一个 PR，major 单独开 PR。Dependabot 只运行在 GitHub 侧，它的 PR 仅作为更新提示，实际改动仍在规范仓库完成并推送。

## 项目说明

`opencode-command-window` 是一个 OpenCode V2 服务端插件（插件 id `command.window`，npm 包 `@o0kam1/opencode-command-window`）：

- 在 `ctx.tool.transform` 中给内置 `shell` 工具补上 `tail`、`head`、`lines`、`max_bytes` 参数；
- 在 `ctx.tool.hook("execute.after")` 中按模型声明的范围重算返回内容；
- 不执行命令、不改写命令、不接管权限；不传窗口参数时结果与安装前逐字节一致。

主要文件：

```text
src/index.ts    Plugin.define 接线：schema/描述变换 + execute.after hook
src/schema.ts   shell 的新 input JSON Schema 与追加描述
src/window.ts   参数解析、校验、marker 渲染（纯函数）
src/scan.ts     文件/内联文本的流式扫描
src/apply.ts    把窗口应用到 execute.after 事件
```

上游依据：OpenCode v2.3.0 的 `packages/core/src/tool/plugin/shell.ts`、`packages/core/src/tool.ts`、`packages/core/src/session/runner/step.ts`、`packages/core/src/tool-output.ts`。插件 API 文档见 <https://opencode.ai/docs/build/plugins/server>。

## 工作纪律

- 每完成一个独立、可验证的步骤（功能改动、清理、类型检查/测试通过、文档与配置更新等）就**立即 `git commit`**。
- 提交信息遵循 conventional commit 风格（如 `feat:`、`fix:`、`docs:`、`refactor:`、`chore:`），并提供简洁正文。
- 模型身份写在提交作者：`git commit --author "DeepSeek Flash <deepseek-flash@llm.invalid>"`；Agent 应用身份写在正文末尾的 `Co-authored-by` 尾注（实际运行版本，如 `opencode v2.3.0`，不写邮箱）。
- 不允许把多个步骤攒到会话末尾一次性提交。
- 未获用户明确要求时，不要 `git push`、创建标签、创建 release 或触发发布。
- **禁止 agent 直接向 `github` 远程推送任何内容**，包括 `main`、tag 与 force-push。镜像同步只由 `.gitea/workflows/mirror.yml` 完成；agent 对 `github` 远程只做读取与对照。

## 发布

具体流程只维护在 `docs/release.md`，本节不复述。发布由 GitHub 镜像上的 `.github/workflows/release.yml` 用 npm 可信发布（OIDC）完成：tag 经 `.gitea/workflows/mirror.yml` 同步到镜像后触发。agent 只在用户明确要求时参与发版准备，且不得 push、打 tag、创建 release 或触发发布。

## 已验证行为

2026-11-15 在真实 OpenCode v2.3.0 会话（临时项目 `.opencode/plugins/command-window` → 本仓库软链）中核实：

- 插件从 `src/index.ts` 加载，`ctx.tool.transform` 生效，模型可直接传 `tail`/`head`。
- `seq 1 100` + `tail: 3` → 正文末尾 `[showing lines 98-100 of 100 (tail 3); full output was not saved because the result was not truncated]`。
- `seq 1 200000` + `head: 2, tail: 2` → `[showing lines 1-2 and 199999-200000 of 200000 (head 2, tail 2); full output saved to /home/<user>/.local/share/opencode/shell/<hash>/sh_<id>.out]`。
- 保存文件的实际路径格式是 `~/.local/share/opencode/shell/<hash>/sh_<id>.out`。
- `metadata.window` 与 `metadata.truncated` 出现在工具结果 metadata 中，日志无 `[command.window]` 警告。
- 2026-11-15 在同一方式搭建的临时项目 `/var/tmp/opencode/verify-cw` 中核实回读路径：`seq 1 200000` + `tail: 3` 返回 marker 与保存路径后，模型用 `read`（`offset`/`limit`）读取保存文件的 1000–1005 行并正确回答第 1001、1003 行，没有重跑命令（命令用一次性 guard 文件保证重跑必然失败）。
- 2026-11-15 从 npm 安装真实产物（`@o0kam1/opencode-command-window@0.1.0`）后，在真实会话中执行 `seq 1 200000` + `{"head":2,"tail":2}`，返回 `[... 199996 lines omitted ...]` 占位与 `[showing lines 1-2 and 199999-200000 of 200000 (head 2, tail 2); full output saved to ...]`，日志无 `[command.window]` 警告。
- 自定义 `readBack` / `readBackText` 未能在真实会话验证：该环境向临时 `opencode.json` 写入被安全策略 `secret.cli.opencode.config` 拦截；选项解析与注入由单元测试覆盖。

## 提交前自检

```sh
pnpm check   # tsc --noEmit + vitest run
```

CI（`.github/workflows/ci.yml`）在 push 到 `main` 与 PR 时跑同一组命令；Gitea 只读 `.gitea/workflows/`，所以它要等镜像同步到 GitHub 后才运行。

插件行为只能在真实 OpenCode 会话里验证：安装后保存配置触发热重载，或执行 `/reload`；日志位于 `~/.local/share/opencode/log/opencode.log`。验证项见 README 的“验证”一节。

## 实现约定

- **hook 内绝不抛异常**。Promise hook 的回调用 `Effect.promise` 包装，reject 会成为 defect；所有可预见的失败都降级为“原结果 + 一行说明”。
- `Tool.Result` 的字段是 `readonly`，替换结果必须整体重新赋值 `event.result = { ...event.result, ... }`，不能逐字段改写。
- `shell` 的 `content` 除正文外还可能有退出码/超时提示；窗口化只能替换正文 part，其余 part 必须保留。
- marker 里的 `full output saved to <path>` 是既有消费者依赖的短语，不得改写。
- 回读提示只注入 `context` hook（主 Agent 请求）；`compaction` 与 `generate` 只同步工具描述。幂等靠 system part 的 `metadata` 判断，不靠文本匹配。
- 插件选项只来自 `opencode.json(c)` 的 `plugins` 条目 `options`；`plugins/` 目录自动发现拿到的是 `{}`。无效值回退默认并告警，绝不抛异常。
- 不实现 `grep` 过滤；需要过滤时由命令自身管道完成。
- 窗口扫描预算 5 秒；内存占用以 `max_bytes` 为上界，`tail` 使用环形缓冲。
- 只用 `node:` 内建模块；`@opencode/plugin` 仅用于类型与 `Plugin.define`。
- 遵循现有代码风格：Tab 缩进、双引号、分号、显式 `.ts` 扩展名导入、TypeScript `strict`。
- 不引入运行时依赖，不修改全局 `tool_output` 配置，不改写命令。

## 文档维护

- `README.md`（英文）与 `README.zh.md`（中文）描述安装、参数、marker 与限制；行为变更时同步更新。
- `LICENSE` 为 MIT，版权人 duzhaokun123（2026）。
- `docs/release.md` 是唯一的发版依据，只供维护者使用。发版流程与包元数据变化时更新该文件；两份 README 不记录发版流程，因为它们面向使用者。
