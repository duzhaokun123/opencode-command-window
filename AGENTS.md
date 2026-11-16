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
- `pipeWindow` 选项（默认关闭）开启时，在 `ctx.tool.hook("execute.before")` 中把命令结尾的 `| head` / `| tail` 管道改写成窗口参数；
- `pipeWarning` 选项（默认关闭）开启时，已完成的 shell 命令仍把输出接到 `head` / `tail`，就在结果前面加一段 `[window warning: ...]` 提醒模型改用窗口参数；
- 在 `ctx.session.hook("context")` 中向主 Agent 请求注入两段系统提示词：用窗口参数限制输出、回读保存文件；
- 不执行命令、默认不改写命令、不接管权限；不传窗口参数时结果与安装前逐字节一致。

主要文件：

```text
src/index.ts    Plugin.define 接线：选项、schema/描述变换、系统提示词注入、execute.before/execute.after hook
src/options.ts  插件选项校验与默认值
src/prompt.ts   截断参数与回读段落、幂等 system part 注入
src/schema.ts   shell 的新 input JSON Schema 与追加描述
src/window.ts   参数解析、校验、marker 渲染（纯函数）
src/scan.ts     文件/内联文本的流式扫描
src/apply.ts    把窗口应用到 execute.after 事件
src/pipe.ts     命令结尾 | head / | tail 管道的解析与改写（纯函数，pipeWindow 开启时生效）与提醒用的检测
src/warn.ts     pipeWarning 开启时给已完成的 shell 结果前置提醒
```

上游依据：OpenCode v2.3.0 的 `packages/core/src/tool/plugin/shell.ts`、`packages/core/src/tool.ts`、`packages/core/src/session/runner/step.ts`、`packages/core/src/tool-output.ts`。插件 API 文档见 <https://opencode.ai/docs/build/plugins/server>。

## 工作纪律

- 每完成一个独立、可验证的步骤（功能改动、清理、类型检查/测试通过、文档与配置更新等）就**立即 `git commit`**。
- 提交信息遵循 conventional commit 风格（如 `feat:`、`fix:`、`docs:`、`refactor:`、`chore:`），并提供简洁正文。
- 提交作者写模型身份：`git commit --author "<模型名> <模型id>@llm.invalid"`。模型名取人类可读名称（如 `DeepSeek Flash`），模型 id 取当前运行环境的模型 ID、不带 provider 前缀（如 `deepseek-flash`），两者都取自**当前正在执行这次提交的 agent/模型自身**，不要照搬别的模型的名字；邮箱固定为 `<模型id>@llm.invalid`（`.invalid` 为保留占位域名，不做投递）。
- Agent 应用身份写在正文末尾的 `Co-authored-by` 尾注（实际运行版本，如 `opencode v2.3.0`，不写邮箱）。
- 不允许把多个步骤攒到会话末尾一次性提交。
- 未获用户明确要求时，不要 `git push`、创建标签、创建 release 或触发发布。
- **禁止 agent 直接向 `github` 远程推送任何内容**，包括 `main`、tag 与 force-push。镜像同步只由 `.gitea/workflows/mirror.yml` 完成；agent 对 `github` 远程只做读取与对照。

## 发布

具体流程只维护在 `docs/release.md`，本节不复述。发布由 GitHub 镜像上的 `.github/workflows/release.yml` 用 npm 可信发布（OIDC）完成：tag 经 `.gitea/workflows/mirror.yml` 同步到镜像后触发。agent 参与发版的门槛与远程限制见「工作纪律」一节：用户明确要求时可以推送 `main` 到 `origin`、创建并推送 tag、创建 release，但任何情况下都不得向 `github` 远程推送。

## 提交前自检

```sh
pnpm check   # tsc --noEmit + vitest run
```

CI（`.github/workflows/ci.yml`）在 push 到 `main` 与 PR 时跑同一组命令；Gitea 只读 `.gitea/workflows/`，所以它要等镜像同步到 GitHub 后才运行。

插件行为只能在真实 OpenCode 会话里验证：安装后保存配置触发热重载，或执行 `/reload`；日志位于 `~/.local/share/opencode/log/opencode.log`。验证项见 README 的“验证”一节；隔离全局插件、`--standalone` 与观察系统提示词的方法，以及历次验证结果，见 `docs/verification.md`。

## 实现约定

- **hook 内绝不抛异常**。Promise hook 的回调用 `Effect.promise` 包装，reject 会成为 defect；所有可预见的失败都降级为“原结果 + 一行说明”。
- `execute.before` 对 `event.input` 的就地修改会原样传给工具执行（v2.3.0 的 `beforeExecute` 把同一引用交给 `executeTool`）；`src/pipe.ts` 的管道改写依赖这一点，改写只动 `command` 与 `head`/`tail`，不添加 schema 之外的字段（input schema 是 `additionalProperties: false`）。
- `pipeWindow` 只改写**单一命令**结尾的管道。命令里出现顶层 `&&`、`||`、`;`、`&` 或未被 `|` 接续的换行时保持原样：管道只作用于最后一段，窗口参数却覆盖整条命令的输出。`>&`（如 `2>&1`）与 `|` 之后的换行不算拼接。
- `pipeWarning` 的检测范围比改写宽：引号深度 0 上任意指向 `head` / `tail` 的 `|` 都算，包括拼接命令与改写器拒绝的形式（`| head -c 100`、裸 `| head`、多余参数），因为它只驱动一行提醒；引号内的 `|`、`||`、`|&` 不算。提醒只加在已完成的 `shell` 结果上，运行中/被终止的结果不处理；`pipeWindow` 已改写的结尾管道在执行前就被移除，不会触发提醒。
- `Tool.Result` 的字段是 `readonly`，替换结果必须整体重新赋值 `event.result = { ...event.result, ... }`，不能逐字段改写。
- `shell` 的 `content` 除正文外还可能有退出码/超时提示；窗口化只能替换正文 part，其余 part 必须保留。
- marker 里的 `full output saved to <path>` 是既有消费者依赖的短语，不得改写。
- 截断参数提示与回读提示都只注入 `context` hook（主 Agent 请求）；`compaction` 与 `generate` 只同步工具描述。两段提示各自用 system part 的 `metadata.kind`（`window-hint` / `read-back`）判断幂等，不靠文本匹配。
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
- `docs/verification.md` 记录真机验证的方法与历史结果，只供维护者使用；每次做完真机会话验证都在此追加，AGENTS.md 与 README 不堆验证记录。
